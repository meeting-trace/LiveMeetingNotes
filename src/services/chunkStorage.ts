/**
 * IndexedDB-backed storage for WebM audio chunks.
 *
 * PURPOSE:
 *   When splitting a large WebM file into smaller chunks, we need to store
 *   chunk Blobs somewhere other than JS heap (which OOMs at ~2GB for a 180-minute
 *   recording).  IndexedDB can hold several GB of Blobs without touching the JS heap,
 *   and browsers serialize Blob objects directly (no base64 overhead).
 *
 * LIFECYCLE:
 *   1. Before processing: storeChunks(sessionId, chunks[])
 *   2. Processing loop  : getChunk(sessionId, index)  — one at a time
 *   3. After each chunk : deleteChunk(sessionId, index) — free disk space incrementally
 *   4. On completion    : deleteSession(sessionId)      — cleanup any leftovers
 *
 * Each "session" is identified by a unique string (e.g., UUID derived from file
 * size + timestamp) so concurrent transcription sessions never collide.
 */

const DB_NAME = 'MeetingNoteChunksDB';
const STORE_NAME = 'chunks';
const DB_VERSION = 1;

export interface StoredChunk {
  /** Composite key: `${sessionId}_${chunkIndex}` */
  key: string;
  sessionId: string;
  chunkIndex: number;
  /** Start time of this chunk in the original recording (ms) */
  startMs: number;
  /** End time of this chunk in the original recording (ms) */
  endMs: number;
  /** The WebM chunk Blob — stored natively without base64 encoding */
  blob: Blob;
  /** Unix timestamp when this record was written (for stale-data cleanup) */
  createdAt: number;
}

class ChunkStorageService {
  private db: IDBDatabase | null = null;
  private openPromise: Promise<void> | null = null;

  // ── Open (idempotent) ───────────────────────────────────────────────────────
  private open(): Promise<void> {
    if (this.db) return Promise.resolve();
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('sessionId', 'sessionId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
          this.openPromise = null;
        };
        resolve();
      };

      request.onerror = () => {
        this.openPromise = null;
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };

      request.onblocked = () => {
        console.warn('[ChunkStorage] IndexedDB open blocked — another tab has an older version open');
      };
    });

    return this.openPromise;
  }

  // ── Write ───────────────────────────────────────────────────────────────────
  async storeChunk(
    sessionId: string,
    chunkIndex: number,
    startMs: number,
    endMs: number,
    blob: Blob
  ): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: StoredChunk = {
        key: `${sessionId}_${chunkIndex}`,
        sessionId,
        chunkIndex,
        startMs,
        endMs,
        blob,
        createdAt: Date.now(),
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error(`Failed to store chunk: ${req.error?.message}`));
    });
  }

  /** Write all chunks of a session in parallel (faster than sequential puts) */
  async storeChunks(
    sessionId: string,
    chunks: Array<{ startMs: number; endMs: number; blob: Blob }>
  ): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      let pending = chunks.length;

      if (pending === 0) { resolve(); return; }

      chunks.forEach(({ startMs, endMs, blob }, index) => {
        const record: StoredChunk = {
          key: `${sessionId}_${index}`,
          sessionId,
          chunkIndex: index,
          startMs,
          endMs,
          blob,
          createdAt: Date.now(),
        };
        const req = store.put(record);
        req.onsuccess = () => { if (--pending === 0) resolve(); };
        req.onerror = () => reject(new Error(`Failed to store chunk ${index}: ${req.error?.message}`));
      });
    });
  }

  // ── Read ────────────────────────────────────────────────────────────────────
  async getChunk(sessionId: string, chunkIndex: number): Promise<StoredChunk | null> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(`${sessionId}_${chunkIndex}`);
      req.onsuccess = () => resolve((req.result as StoredChunk) ?? null);
      req.onerror = () => reject(new Error(`Failed to get chunk: ${req.error?.message}`));
    });
  }

  async getChunkCount(sessionId: string): Promise<number> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('sessionId');
      const req = index.count(IDBKeyRange.only(sessionId));
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(new Error(`Failed to count chunks: ${req.error?.message}`));
    });
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async deleteChunk(sessionId: string, chunkIndex: number): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(`${sessionId}_${chunkIndex}`);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error(`Failed to delete chunk: ${req.error?.message}`));
    });
  }

  /** Remove all chunks for a session (call after processing is complete or on error) */
  async deleteSession(sessionId: string): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('sessionId');
      const req = index.openCursor(IDBKeyRange.only(sessionId));

      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(new Error(`Failed to delete session: ${req.error?.message}`));
    });
  }

  /**
   * Remove stale sessions older than `maxAgeMs` (default: 24 hours).
   * Call this opportunistically on startup to prevent IDB from growing unbounded.
   */
  async cleanupStale(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    try {
      await this.open();
      const cutoff = Date.now() - maxAgeMs;
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('createdAt');
        const range = IDBKeyRange.upperBound(cutoff);
        const req = index.openCursor(range);

        req.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      // Non-fatal — just log
      console.warn('[ChunkStorage] Stale cleanup failed:', e);
    }
  }
}

/** Singleton instance shared across the application */
export const chunkStorage = new ChunkStorageService();
