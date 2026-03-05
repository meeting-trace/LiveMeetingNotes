// Auto-backup service using localStorage and IndexedDB
// Protects against browser crashes and accidental closures

import { patchWebmHeaderDuration } from './webmUtils';

// Must match the timeslice used in audioRecorder.ts → MediaRecorder.start(5000)
const RECORDING_TIMESLICE_MS = 5000;

const STORAGE_KEY = 'meetingNote_autoBackup';
const DB_NAME = 'MeetingNoteDB';
const DB_VERSION = 2;          // v2: added audioChunks store for delta backup
const AUDIO_STORE = 'audioBlobs';
const CHUNKS_STORE = 'audioChunks'; // Stores individual Blob chunks with auto-increment key

interface BackupData {
  timestamp: number;
  meetingInfo: {
    projectName: string;
    location: string;
    participants: string;
    date?: string;
    time?: string;
    host?: string;
  };
  notes: string;
  timestampMap: [number, number][]; // Array of [position, datetime] for serialization
  speakersMap?: [number, string][]; // Array of [lineIndex, speaker] for serialization
  recordingStartTime: number;
  hasAudioBlob: boolean;
  isSaved: boolean;
  transcriptions?: any[]; // Speech-to-Text results
  rawTranscripts?: any[]; // Raw Speech-to-Text data for AI refinement
  geminiSummary?: string; // AI-generated meeting summary
}

// Open IndexedDB connection
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE);
      }
      // v2: chunk store for delta (incremental) audio backup during recording
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        db.createObjectStore(CHUNKS_STORE, { autoIncrement: true });
      }
    };
  });
};

// Save audio blob to IndexedDB
const saveAudioBlob = async (blob: Blob): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([AUDIO_STORE], 'readwrite');
    const store = transaction.objectStore(AUDIO_STORE);
    const request = store.put(blob, 'currentRecording');
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// Load audio blob from IndexedDB.
// Prefers reconstructing from delta chunks (crash-during-recording case);
// falls back to the monolithic 'currentRecording' key (stop-then-crash case).
// onProgress receives 0-100.
const loadAudioBlobWithProgress = async (
  onProgress?: (pct: number) => void
): Promise<Blob | null> => {
  try {
    const db = await openDB();
    // ── Step 1: read mimeType + count chunks (no data loaded yet)
    const { totalCount, mimeType } = await new Promise<{ totalCount: number; mimeType: string }>(
      (resolve, reject) => {
        const tx = db.transaction([AUDIO_STORE, CHUNKS_STORE], 'readonly');
        let count = 0;
        let mime = 'audio/webm';
        const countReq = tx.objectStore(CHUNKS_STORE).count();
        countReq.onsuccess = () => { count = countReq.result; };
        const mimeReq = tx.objectStore(AUDIO_STORE).get('mimeType');
        mimeReq.onsuccess = () => { if (mimeReq.result) mime = mimeReq.result as string; };
        tx.oncomplete = () => resolve({ totalCount: count, mimeType: mime });
        tx.onerror = () => reject(tx.error);
      }
    );

    if (totalCount > 0) {
      // ── Step 2: load chunks one-by-one via cursor for fine-grained progress
      const chunks = await new Promise<Blob[]>((resolve, reject) => {
        const tx = db.transaction([CHUNKS_STORE], 'readonly');
        const collected: Blob[] = [];
        let loaded = 0;
        const cursorReq = tx.objectStore(CHUNKS_STORE).openCursor();
        cursorReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (cursor) {
            collected.push(cursor.value as Blob);
            loaded++;
            onProgress?.(Math.round((loaded / totalCount) * 100));
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve(collected);
        tx.onerror = () => reject(tx.error);
      });
      const estimatedDurationMs = totalCount * RECORDING_TIMESLICE_MS;
      console.log(
        `[Backup] Assembled ${totalCount} chunks → ~${
          Math.round(estimatedDurationMs / 60_000)
        } min | total size: ${((new Blob(chunks)).size / 1_048_576).toFixed(1)} MB | mime: ${mimeType}`
      );

      // ── Patch WebM Duration field in the FIRST CHUNK ONLY ─────────────────
      // We do NOT feed the assembled blob through fix-webm-duration because
      // that library rebuilds the full file (EBML parse → Uint8Array rewrite),
      // and its re-serialisation of Unknown-type Cluster elements can shift
      // block boundaries, producing "correct duration, but audio corrupted
      // after the first cluster" (silence / no waveform past ~1 min).
      //
      // Instead: scan the first chunk's header (<8 KB) for the Duration field
      // (EBML ID 0x4489) and overwrite only those 8 float bytes.  All audio
      // cluster data in every chunk stays byte-for-byte identical.
      if (chunks.length > 0 && (mimeType.includes('webm') || mimeType.includes('ogg'))) {
        chunks[0] = await patchWebmHeaderDuration(chunks[0], estimatedDurationMs);
      }

      return new Blob(chunks, { type: mimeType });
    }

    // ── Fallback: monolithic blob written by saveAudioBlob (stop-then-crash case)
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([AUDIO_STORE], 'readonly');
      const store = transaction.objectStore(AUDIO_STORE);
      const request = store.get('currentRecording');
      request.onsuccess = () => { onProgress?.(100); resolve(request.result || null); };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to load audio blob:', error);
    return null;
  }
};

// Delete audio blob and all accumulated chunks from IndexedDB
const deleteAudioBlob = async (): Promise<void> => {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([AUDIO_STORE, CHUNKS_STORE], 'readwrite');
      tx.objectStore(AUDIO_STORE).delete('currentRecording');
      tx.objectStore(AUDIO_STORE).delete('mimeType');
      tx.objectStore(CHUNKS_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error('Failed to delete audio blob:', error);
  }
};

// Append new delta chunks to IndexedDB (O(newChunks) cost, not O(totalSize)).
// Also persists mimeType and flags hasAudioBlob=true in localStorage.
export const appendAudioChunks = async (chunks: Blob[], mimeType: string): Promise<void> => {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([AUDIO_STORE, CHUNKS_STORE], 'readwrite');
      // Store mimeType once (overwrites same value each time, cheap)
      tx.objectStore(AUDIO_STORE).put(mimeType, 'mimeType');
      const chunkStore = tx.objectStore(CHUNKS_STORE);
      chunks.forEach(chunk => chunkStore.add(chunk));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    // Flip hasAudioBlob flag in localStorage metadata
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      const backupData = JSON.parse(data) as BackupData;
      if (!backupData.hasAudioBlob) {
        backupData.hasAudioBlob = true;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(backupData));
      }
    }
  } catch (error) {
    console.error('Failed to append audio chunks:', error);
  }
};

// Save backup to localStorage and IndexedDB
export const saveBackup = async (
  meetingInfo: { projectName: string; location: string; participants: string; date?: string; time?: string; host?: string },
  notes: string,
  timestampMap: Map<number, number>,
  recordingStartTime: number,
  audioBlob: Blob | null,
  isSaved: boolean,
  transcriptions?: any[],
  rawTranscripts?: any[],
  speakersMap?: Map<number, string>,
  geminiSummary?: string
): Promise<void> => {
  try {
    // Convert Map to array for JSON serialization
    const timestampArray = Array.from(timestampMap.entries());
    const speakersArray = speakersMap ? Array.from(speakersMap.entries()) : undefined;

    // If audioBlob is null (e.g. mid-recording autosave), preserve hasAudioBlob=true
    // if an intermediate blob was already saved to IndexedDB by the recording interval.
    let hasAudioBlob = audioBlob !== null;
    if (!hasAudioBlob) {
      try {
        const existingData = localStorage.getItem(STORAGE_KEY);
        if (existingData) {
          const existing = JSON.parse(existingData) as BackupData;
          if (existing.hasAudioBlob) hasAudioBlob = true;
        }
      } catch { /* ignore parse errors */ }
    }
    
    const backupData: BackupData = {
      timestamp: Date.now(),
      meetingInfo,
      notes,
      timestampMap: timestampArray,
      speakersMap: speakersArray,
      recordingStartTime,
      hasAudioBlob,
      isSaved,
      transcriptions,
      rawTranscripts,
      geminiSummary
    };
    
    // Save to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(backupData));
    
    // Save audio blob to IndexedDB if exists
    if (audioBlob) {
      await saveAudioBlob(audioBlob);
    }
    
    // console.log('💾 Auto-backup saved at', new Date().toLocaleTimeString());
  } catch (error) {
    console.error('Failed to save backup:', error);
  }
};

// Get audio backup metadata (chunk count + estimated duration) WITHOUT loading
// the actual binary data. Used to warn the user before attempting a large restore.
export const getBackupAudioInfo = async (): Promise<{
  chunkCount: number;
  estimatedDurationMin: number; // each chunk ≈ 5 s (MediaRecorder timeslice)
  hasMonolithicBlob: boolean;
  mimeType: string; // stored mime type — used for save-picker suggested extension
}> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([AUDIO_STORE, CHUNKS_STORE], 'readonly');
      let count = 0;
      let hasMonolithic = false;
      let mime = 'audio/webm';
      const countReq = tx.objectStore(CHUNKS_STORE).count();
      countReq.onsuccess = () => { count = countReq.result; };
      const keyReq = tx.objectStore(AUDIO_STORE).getKey('currentRecording');
      keyReq.onsuccess = () => { hasMonolithic = keyReq.result !== undefined; };
      const mimeReq = tx.objectStore(AUDIO_STORE).get('mimeType');
      mimeReq.onsuccess = () => { if (mimeReq.result) mime = mimeReq.result as string; };
      tx.oncomplete = () => resolve({
        chunkCount: count,
        estimatedDurationMin: Math.round((count * 5) / 60), // 5 s per chunk
        hasMonolithicBlob: hasMonolithic,
        mimeType: mime,
      });
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return { chunkCount: 0, estimatedDurationMin: 0, hasMonolithicBlob: false, mimeType: 'audio/webm' };
  }
};

// Load backup from localStorage and IndexedDB
export const loadBackup = async (options?: {
  /** Reports overall progress 0-100 with a human-readable step label */
  onProgress?: (percent: number, step: string) => void;
  /** When true, skip loading audio (useful for very large recordings) */
  skipAudio?: boolean;
}): Promise<{
  meetingInfo: { projectName: string; location: string; participants: string; date?: string; time?: string; host?: string };
  notes: string;
  timestampMap: Map<number, number>;
  speakersMap: Map<number, string>;
  recordingStartTime: number;
  audioBlob: Blob | null;
  isSaved: boolean;
  backupTimestamp: number;
  transcriptions?: any[];
  rawTranscripts?: any[];
  geminiSummary?: string;
} | null> => {
  const { onProgress, skipAudio = false } = options ?? {};
  try {
    onProgress?.(5, 'Đọc dữ liệu cuộc họp...');
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    
    const backupData: BackupData = JSON.parse(data);
    
    onProgress?.(20, 'Khôi phục ghi chú và mốc thời gian...');
    // Convert array back to Map
    const timestampMap = new Map(backupData.timestampMap);
    const speakersMap = backupData.speakersMap ? new Map(backupData.speakersMap) : new Map();
    
    // Load audio blob if it exists and user hasn't opted to skip
    let audioBlob: Blob | null = null;
    if (backupData.hasAudioBlob && !skipAudio) {
      onProgress?.(35, 'Đang tải file ghi âm...');
      audioBlob = await loadAudioBlobWithProgress((pct) => {
        // Map 0–100 of audio loading → overall 35–92
        onProgress?.(35 + Math.round(pct * 0.57), 'Đang tải file ghi âm...');
      });
    } else if (skipAudio) {
      onProgress?.(92, 'Bỏ qua file ghi âm theo yêu cầu...');
    }
    
    onProgress?.(95, 'Hoàn thiện khôi phục...');
    return {
      meetingInfo: backupData.meetingInfo,
      notes: backupData.notes,
      timestampMap,
      speakersMap,
      recordingStartTime: backupData.recordingStartTime,
      audioBlob,
      isSaved: backupData.isSaved,
      backupTimestamp: backupData.timestamp,
      transcriptions: backupData.transcriptions,
      rawTranscripts: backupData.rawTranscripts,
      geminiSummary: backupData.geminiSummary
    };
  } catch (error) {
    console.error('Failed to load backup:', error);
    return null;
  }
};

// Clear backup
export const clearBackup = async (): Promise<void> => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    await deleteAudioBlob();
    // console.log('🗑️ Auto-backup cleared');
  } catch (error) {
    console.error('Failed to clear backup:', error);
  }
};

// Check if backup exists
export const hasBackup = (): boolean => {
  return localStorage.getItem(STORAGE_KEY) !== null;
};

// Get backup age in minutes
export const getBackupAge = (): number | null => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    
    const backupData: BackupData = JSON.parse(data);
    const ageMs = Date.now() - backupData.timestamp;
    return Math.floor(ageMs / 60000); // Convert to minutes
  } catch (error) {
    return null;
  }
};
