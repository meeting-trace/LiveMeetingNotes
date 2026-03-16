/**
 * EBML-based WebM binary splitter.
 *
 * PROBLEM SOLVED:
 *   AudioContext.decodeAudioData() must decode the ENTIRE file before you can
 *   access any frame.  For a 180-minute 180 MB WebM/Opus file the intermediate
 *   PCM buffer is ~830 MB (16 kHz mono) to ~2.5 GB (48 kHz stereo), inevitably
 *   exceeding the JS heap and crashing with "out-of-memory".
 *
 * APPROACH:
 *   WebM is a Matroska/EBML container.  Audio samples are stored in "Cluster"
 *   elements.  Each Cluster is independently decodable (it starts at a position
 *   where the decoder can be re-initialised from the Tracks/CodecPrivate header).
 *   We scan the raw bytes to find Cluster boundaries and their timestamps, then
 *   group them by target duration and reassemble each group as a standalone,
 *   playable WebM file — WITHOUT ever decoding audio data.
 *
 * OUTPUT:
 *   An array of { startMs, endMs, blob } where each blob is a valid WebM file
 *   containing the original EBML/Segment/Tracks header plus the cluster data
 *   for that time range.  Each chunk can be decoded independently by
 *   AudioContext.decodeAudioData() at a much smaller memory footprint.
 *
 * LIMITATIONS:
 *   • Only works for WebM containers (audio/webm, video/webm).
 *   • The first few frames of each chunk may have minor codec-state artifacts
 *     (inaudible glitches of < 20 ms) because Opus resets its internal state.
 *     This is acceptable for speech-recognition purposes.
 *   • Cluster boundaries are NOT on the exact target time; splits happen at the
 *     nearest cluster boundary (typically ≤ 1 second of overshoot).
 */

// ── EBML helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a VINT (Variable-length Integer) used throughout EBML for element sizes
 * and IDs.  Returns the numeric value and the number of bytes consumed.
 *
 * "Unknown size" VINTs (all data bits = 1, used by MediaRecorder for streaming
 * Segment / Cluster sizes) are returned as -1.
 */
function readVint(bytes: Uint8Array, offset: number): { value: number; width: number } {
  if (offset >= bytes.length) return { value: 0, width: 1 };
  const b = bytes[offset];

  let width: number;
  let mask: number;

  if      ((b & 0x80) !== 0) { width = 1; mask = 0x7F; }
  else if ((b & 0x40) !== 0) { width = 2; mask = 0x3F; }
  else if ((b & 0x20) !== 0) { width = 3; mask = 0x1F; }
  else if ((b & 0x10) !== 0) { width = 4; mask = 0x0F; }
  else if ((b & 0x08) !== 0) { width = 5; mask = 0x07; }
  else if ((b & 0x04) !== 0) { width = 6; mask = 0x03; }
  else if ((b & 0x02) !== 0) { width = 7; mask = 0x01; }
  else                        { width = 8; mask = 0x00; }

  // Accumulate value from remaining bytes (big-endian)
  let value = b & mask;
  let allOnes = value === mask; // potential "unknown size"

  for (let i = 1; i < width; i++) {
    if (offset + i >= bytes.length) break;
    const next = bytes[offset + i];
    value = value * 256 + next;   // keep in safe-integer range (avoid bit-shift overflow)
    allOnes = allOnes && next === 0xFF;
  }

  return { value: allOnes ? -1 : value, width };
}

// ── Data structures ───────────────────────────────────────────────────────────

interface ClusterInfo {
  /** Byte offset of the Cluster element (0x1F 0x43 0xB6 0x75) in the blob */
  byteOffset: number;
  /**
   * Cluster Timestamp in milliseconds (after converting with TimestampScale).
   * Falls back to the previous cluster's timestamp if not found in this cluster.
   */
  timestampMs: number;
}

export interface WebmChunk {
  /** Start time of this chunk in the original recording (ms) */
  startMs: number;
  /** Estimated end time of this chunk in the original recording (ms) */
  endMs: number;
  /** Standalone playable WebM Blob (header + clusters for this range) */
  blob: Blob;
}

// ── Internal scanning functions ───────────────────────────────────────────────

/**
 * Read the TimestampScale from the WebM Info element.
 * Element ID: 0x2A 0xD7 0xB1 (3 bytes).
 * Default: 1,000,000 ns/tick  →  1 ms per tick.
 * This is almost universally 1,000,000 for MediaRecorder output.
 */
async function readTimestampScale(blob: Blob): Promise<number> {
  const HEADER_LIMIT = Math.min(32 * 1024, blob.size); // first 32 KB is always enough
  const ab = await blob.slice(0, HEADER_LIMIT).arrayBuffer();
  const bytes = new Uint8Array(ab);

  for (let i = 0; i < bytes.length - 8; i++) {
    if (bytes[i] !== 0x2A || bytes[i + 1] !== 0xD7 || bytes[i + 2] !== 0xB1) continue;

    // Found TimestampScale element (3-byte ID).  Next bytes = size VINT + value.
    const { value: size, width } = readVint(bytes, i + 3);
    if (size <= 0 || size > 8) continue;

    let value = 0;
    const dataStart = i + 3 + width;
    for (let j = 0; j < size && dataStart + j < bytes.length; j++) {
      value = value * 256 + bytes[dataStart + j];
    }
    if (value > 0) {
      console.log(`[webmSplitter] TimestampScale = ${value} ns/tick (${(value / 1_000_000).toFixed(3)} ms/tick)`);
      return value;
    }
  }

  console.log('[webmSplitter] TimestampScale not found — using default 1 ms/tick');
  return 1_000_000; // default
}

/**
 * Scan the entire WebM blob for Cluster element boundaries and their timestamps.
 * Reads the file in sequential 4 MB windows with an 8-byte tail overlap to handle
 * IDs that straddle window boundaries.
 *
 * Memory usage: only ~4 MB in JS heap at a time regardless of file size.
 */
async function findClusters(
  blob: Blob,
  timestampScale: number,
  onProgress?: (progress: number) => void
): Promise<ClusterInfo[]> {
  const WINDOW = 4 * 1024 * 1024; // 4 MB scan window
  const TAIL   = 8;                // overlap to catch IDs on window boundaries

  const clusters: ClusterInfo[] = [];
  let tail = new Uint8Array(0);
  let scanPos = 0;

  while (scanPos < blob.size) {
    if (onProgress) {
      onProgress(Math.round((scanPos / blob.size) * 100));
    }

    const chunkEnd = Math.min(scanPos + WINDOW, blob.size);
    const rawAb = await blob.slice(scanPos, chunkEnd).arrayBuffer();
    const raw   = new Uint8Array(rawAb);

    // Prepend tail from previous window so boundary-spanning IDs are caught
    const bytes = new Uint8Array(tail.length + raw.length);
    bytes.set(tail, 0);
    bytes.set(raw, tail.length);
    const baseOffset = scanPos - tail.length; // byte offset of bytes[0] in original blob

    const searchEnd = bytes.length - 12; // leave room to read ~12 bytes after match

    for (let i = 0; i < searchEnd; i++) {
      // Fast first-byte filter: Cluster ID starts with 0x1F
      if (bytes[i] !== 0x1F) continue;
      if (bytes[i + 1] !== 0x43) continue;
      if (bytes[i + 2] !== 0xB6) continue;
      if (bytes[i + 3] !== 0x75) continue;

      const clusterFileOffset = baseOffset + i;

      // Skip the 4-byte Cluster element ID + its size VINT to reach the cluster body
      const sizeResult = readVint(bytes, i + 4);
      // Note: sizeResult.value may be -1 (unknown size) — that's fine, we don't need it
      const bodyStart = i + 4 + sizeResult.width;

      // Search for the Timestamp element (EBML ID 0xE7, single-byte ID) in first 64 bytes
      // of cluster body.  Timestamp is always the first element in a Cluster.
      let timestampMs = clusters.length > 0 ? clusters[clusters.length - 1].timestampMs : 0;
      const bodySearchEnd = Math.min(bodyStart + 64, bytes.length - 4);

      for (let k = bodyStart; k < bodySearchEnd; k++) {
        if (bytes[k] !== 0xE7) continue;

        // 0xE7 found — read size VINT immediately after (k+1)
        const tSizeResult = readVint(bytes, k + 1);
        if (tSizeResult.value <= 0 || tSizeResult.value > 8) continue;

        const tDataStart = k + 1 + tSizeResult.width;
        if (tDataStart + tSizeResult.value > bytes.length) break;

        // Read big-endian integer (tSizeResult.value bytes)
        let ticks = 0;
        for (let t = 0; t < tSizeResult.value; t++) {
          ticks = ticks * 256 + bytes[tDataStart + t];
        }

        // Convert ticks → milliseconds:  ticks × timestampScale ns/tick ÷ 1,000,000 = ms
        timestampMs = Math.round((ticks * timestampScale) / 1_000_000);
        break;
      }

      clusters.push({ byteOffset: clusterFileOffset, timestampMs });
      i += 3; // skip past this match (loop i++ gives us i+4 on next iteration)
    }

    // Save tail for next iteration
    tail = bytes.slice(Math.max(0, bytes.length - TAIL));
    scanPos = chunkEnd;
  }

  return clusters;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Split a WebM audio blob into independently decodable chunks based on a
 * target maximum duration, WITHOUT decoding any audio data.
 *
 * Each returned chunk Blob is a valid standalone WebM file:
 *   [original EBML/Segment/Tracks header] + [subset of Cluster elements]
 *
 * The caller is responsible for:
 *   1. Storing the chunks (e.g., in IndexedDB) before processing them.
 *   2. Adjusting result timestamps by `chunk.startMs` after transcription.
 *   3. Releasing the original blob after all chunks are stored.
 *
 * @param blob              WebM audio Blob (any size)
 * @param maxChunkDurationMs  Target max duration per chunk in milliseconds (e.g., 30*60*1000)
 * @param onProgress        Optional progress callback (0–100 during the scan phase)
 * @returns                 Array of WebmChunk objects (never empty — at least one chunk)
 */
export async function splitWebmIntoChunks(
  blob: Blob,
  maxChunkDurationMs: number,
  onProgress?: (progress: number, message?: string) => void
): Promise<WebmChunk[]> {
  if (onProgress) onProgress(0, '🔍 Đang đọc thông tin định dạng WebM...');

  // Step 1: Read TimestampScale (reads only first 32 KB)
  const timestampScale = await readTimestampScale(blob);

  if (onProgress) onProgress(2, '📊 Đang quét toàn bộ file tìm ranh giới Cluster...');

  // Step 2: Scan for all cluster boundaries (streaming, low memory)
  const clusters = await findClusters(blob, timestampScale, (p) => {
    if (onProgress) onProgress(2 + Math.round(p * 0.58), '🔍 Đang quét file...');
  });

  console.log(`[webmSplitter] Found ${clusters.length} clusters in ${(blob.size / 1024 / 1024).toFixed(1)} MB blob`);

  // Edge case: no clusters found — return blob as-is
  if (clusters.length === 0) {
    console.warn('[webmSplitter] No Cluster elements found — returning original blob unchanged');
    return [{ startMs: 0, endMs: 0, blob }];
  }

  if (onProgress) onProgress(60, `✅ Tìm thấy ${clusters.length} clusters, đang phân chia...`);

  // Step 3: Estimate total duration
  const firstTs  = clusters[0].timestampMs;
  const lastTs   = clusters[clusters.length - 1].timestampMs;
  // Average cluster duration (used only to estimate the last cluster's end time)
  const avgClusterDurationMs = clusters.length > 1
    ? (lastTs - firstTs) / (clusters.length - 1)
    : 1000; // fallback: assume 1 s/cluster
  const totalDurationMs = lastTs + avgClusterDurationMs;

  console.log(`[webmSplitter] Duration estimate: ${(totalDurationMs / 60000).toFixed(1)} min`);
  console.log(`[webmSplitter] Splitting into ≤ ${(maxChunkDurationMs / 60000).toFixed(0)} min chunks`);

  // Step 4: Group clusters into chunks by target duration
  interface ChunkGroup {
    startClusterIdx: number;
    endClusterIdx: number; // inclusive
    startMs: number;
    endMs: number;
  }

  const groups: ChunkGroup[] = [];
  let groupStart   = 0;
  let groupStartMs = clusters[0].timestampMs;

  for (let i = 1; i <= clusters.length; i++) {
    const isLast     = i === clusters.length;
    const currentMs  = isLast ? totalDurationMs : clusters[i].timestampMs;
    const groupSpan  = currentMs - groupStartMs;

    if (groupSpan >= maxChunkDurationMs || isLast) {
      groups.push({
        startClusterIdx : groupStart,
        endClusterIdx   : i - 1, // inclusive
        startMs         : groupStartMs,
        endMs           : isLast ? totalDurationMs : clusters[i].timestampMs,
      });

      if (!isLast) {
        groupStart   = i;
        groupStartMs = clusters[i].timestampMs;
      }
    }
  }

  console.log(`[webmSplitter] Grouped into ${groups.length} chunks (target: ${(maxChunkDurationMs / 60000).toFixed(0)} min each)`);

  if (onProgress) onProgress(65, `📦 Chia thành ${groups.length} phần, đang tạo chunk files...`);

  // Step 5: Build chunk Blobs
  //   Each chunk = [header bytes (0..firstClusterOffset-1)] + [cluster byte range]
  //   We read the header only ONCE (typically < 4 KB), then append cluster ranges.
  const headerEnd  = clusters[0].byteOffset;
  const headerBlob = blob.slice(0, headerEnd); // original EBML+Segment+Tracks header

  const chunks: WebmChunk[] = [];

  for (let c = 0; c < groups.length; c++) {
    const group = groups[c];

    if (onProgress) {
      const pct = 65 + Math.round((c / groups.length) * 30);
      onProgress(pct, `📦 Đang tạo phần ${c + 1}/${groups.length}...`);
    }

    const clusterByteStart = clusters[group.startClusterIdx].byteOffset;
    const clusterByteEnd   = group.endClusterIdx < clusters.length - 1
      ? clusters[group.endClusterIdx + 1].byteOffset  // exclusive: start of NEXT cluster
      : blob.size;                                     // last group → end of file

    const clusterBlob = blob.slice(clusterByteStart, clusterByteEnd);
    const chunkBlob   = new Blob([headerBlob, clusterBlob], { type: 'audio/webm' });

    chunks.push({
      startMs : group.startMs,
      endMs   : group.endMs,
      blob    : chunkBlob,
    });

    const durationMin = ((group.endMs - group.startMs) / 60000).toFixed(1);
    const sizeMB      = (chunkBlob.size / 1024 / 1024).toFixed(1);
    console.log(
      `[webmSplitter] Chunk ${c + 1}: ${(group.startMs / 60000).toFixed(1)}–${(group.endMs / 60000).toFixed(1)} min` +
      ` | ${durationMin} min | ${sizeMB} MB` +
      ` | bytes ${clusterByteStart}–${clusterByteEnd}`
    );
  }

  if (onProgress) onProgress(95, `✅ Đã tạo ${chunks.length} chunk`);

  return chunks;
}

/**
 * Quick heuristic: is this blob a WebM file that benefits from EBML splitting?
 * Returns true if the MIME type is webm OR if the first 4 bytes match the EBML
 * magic number (0x1A 0x45 0xDF 0xA3).
 */
export async function isLikelyWebm(blob: Blob): Promise<boolean> {
  if (blob.type.toLowerCase().includes('webm')) return true;
  if (blob.size < 4) return false;
  try {
    const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    return header[0] === 0x1A && header[1] === 0x45 && header[2] === 0xDF && header[3] === 0xA3;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAV BINARY SPLITTER
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Split a WAV audio blob into independently decodable chunks using pure binary
 * slicing — NO AudioContext.decodeAudioData() call is made at any point.
 *
 * WAV is uncompressed PCM with a flat structure:
 *   [RIFF header 44 bytes] [raw PCM samples...]
 * This makes byte-accurate splitting trivial: we read the header once (44 bytes),
 * compute byte offsets from time positions, then slice.
 *
 * Each returned chunk is a complete, valid WAV file:
 *   [new 44-byte header with corrected sizes] + [PCM data slice]
 *
 * The caller is responsible for:
 *   1. Adjusting result timestamps by chunk.startMs after transcription.
 *   2. Releasing the original blob after all chunks are stored.
 *
 * @param blob              WAV audio Blob (any size, any sample rate / channel count)
 * @param maxChunkDurationMs  Target max duration per chunk in milliseconds
 * @param onProgress        Optional progress callback (0–100)
 * @returns                 Array of WebmChunk-compatible objects (same interface)
 */
export async function splitWavIntoChunks(
  blob: Blob,
  maxChunkDurationMs: number,
  onProgress?: (progress: number, message?: string) => void
): Promise<WebmChunk[]> {
  if (onProgress) onProgress(0, '🔍 Đang đọc header WAV...');

  // ── Step 1: Parse WAV header (first 44 bytes) ──────────────────────────────
  const WAV_HEADER_SIZE = 44;
  if (blob.size < WAV_HEADER_SIZE) {
    throw new Error('File WAV quá nhỏ, không thể đọc header');
  }

  const headerAb = await blob.slice(0, WAV_HEADER_SIZE).arrayBuffer();
  const view = new DataView(headerAb);

  // Validate RIFF magic
  const riff = view.getUint32(0, false); // big-endian
  if (riff !== 0x52494646) { // "RIFF"
    throw new Error('Không phải file WAV hợp lệ (thiếu RIFF header)');
  }

  const numChannels  = view.getUint16(22, true);
  const sampleRate   = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const byteRate     = sampleRate * numChannels * (bitsPerSample / 8);
  const frameSize    = numChannels * (bitsPerSample / 8); // bytes per sample frame

  // Find the actual 'data' chunk offset — standard WAV has it at 36, but some
  // encoders (JUNK, LIST chunks etc.) push it further.
  let dataOffset = WAV_HEADER_SIZE;
  {
    // Scan up to first 256 bytes for 'data' marker (0x64617461)
    const scanSize = Math.min(256, blob.size);
    const scanAb   = await blob.slice(0, scanSize).arrayBuffer();
    const scanView = new DataView(scanAb);
    for (let i = 12; i < scanSize - 8; i++) {
      if (scanView.getUint32(i, false) === 0x64617461) { // 'data'
        dataOffset = i + 8; // skip 'data' ID (4) + chunk size (4)
        break;
      }
    }
  }

  const pcmDataSize      = blob.size - dataOffset;
  const totalDurationMs  = Math.round((pcmDataSize / byteRate) * 1000);

  if (totalDurationMs <= 0 || pcmDataSize <= 0) {
    throw new Error('Không thể xác định thời lượng WAV từ header');
  }

  console.log(`[wavSplitter] WAV: ${sampleRate} Hz, ${numChannels}ch, ${bitsPerSample}-bit`);
  console.log(`[wavSplitter] Duration: ${(totalDurationMs / 60000).toFixed(1)} min, PCM: ${(pcmDataSize / 1024 / 1024).toFixed(1)} MB`);

  // ── Step 2: Calculate chunk count ─────────────────────────────────────────
  const chunkCount      = Math.max(1, Math.ceil(totalDurationMs / maxChunkDurationMs));
  const chunkDurationMs = totalDurationMs / chunkCount;

  console.log(`[wavSplitter] Splitting into ${chunkCount} chunks (target: ${(maxChunkDurationMs / 60000).toFixed(0)} min each)`);

  if (onProgress) onProgress(10, `📦 Chia thành ${chunkCount} phần WAV...`);

  // ── Step 3: Build original header bytes for reuse ─────────────────────────
  // We need to copy the header into each chunk but update sizes.
  const origHeaderBytes = new Uint8Array(headerAb);

  // ── Step 4: Emit chunk Blobs ───────────────────────────────────────────────
  const chunks: WebmChunk[] = [];

  for (let i = 0; i < chunkCount; i++) {
    if (onProgress) {
      const pct = 10 + Math.round((i / chunkCount) * 85);
      onProgress(pct, `📦 Đang tạo phần WAV ${i + 1}/${chunkCount}...`);
    }

    const startMs = i * chunkDurationMs;
    const endMs   = Math.min((i + 1) * chunkDurationMs, totalDurationMs);

    // Convert time → byte offset (aligned to frame boundary)
    const rawStartByte   = dataOffset + Math.floor((startMs / 1000) * byteRate);
    const rawEndByte     = dataOffset + Math.floor((endMs   / 1000) * byteRate);
    const alignedStart   = dataOffset + Math.floor((rawStartByte - dataOffset) / frameSize) * frameSize;
    const alignedEnd     = Math.min(
      dataOffset + Math.ceil((rawEndByte - dataOffset) / frameSize) * frameSize,
      blob.size
    );

    const segmentDataSize = alignedEnd - alignedStart;

    // Build a fresh 44-byte WAV header for this chunk
    const chunkHeaderAb  = origHeaderBytes.buffer.slice(0); // copy
    const chunkHeaderView = new DataView(chunkHeaderAb);

    // Update RIFF chunk size: 36 + segmentDataSize (excludes 'RIFF' + size fields = 8 bytes)
    chunkHeaderView.setUint32(4, 36 + segmentDataSize, true);

    // Locate 'data' size field inside copied header and update it
    // (it's 4 bytes before the data offset)
    if (dataOffset <= WAV_HEADER_SIZE) {
      // Standard 44-byte header: 'data' size is at byte 40
      chunkHeaderView.setUint32(40, segmentDataSize, true);
    } else {
      // Non-standard header: find 'data' in copied bytes and patch it
      const hdrView = new DataView(chunkHeaderAb);
      for (let k = 12; k < dataOffset - 8; k++) {
        if (hdrView.getUint32(k, false) === 0x64617461) {
          hdrView.setUint32(k + 4, segmentDataSize, true);
          break;
        }
      }
    }

    // Combine new header + PCM slice
    const chunkBlob = new Blob(
      [chunkHeaderAb, blob.slice(alignedStart, alignedEnd)],
      { type: 'audio/wav' }
    );

    const durationMin = ((endMs - startMs) / 60000).toFixed(1);
    const sizeMB      = (chunkBlob.size / 1024 / 1024).toFixed(1);
    console.log(
      `[wavSplitter] Chunk ${i + 1}: ${(startMs / 60000).toFixed(1)}–${(endMs / 60000).toFixed(1)} min` +
      ` | ${durationMin} min | ${sizeMB} MB`
    );

    chunks.push({ startMs, endMs, blob: chunkBlob });
  }

  if (onProgress) onProgress(95, `✅ Đã tạo ${chunkCount} chunk WAV`);

  return chunks;
}

/**
 * Quick heuristic: is this blob a WAV file?
 * Returns true if MIME type contains 'wav' OR first 4 bytes are "RIFF" and
 * bytes 8-11 are "WAVE".
 */
export async function isLikelyWav(blob: Blob): Promise<boolean> {
  const mime = blob.type.toLowerCase();
  if (mime.includes('wav') || mime.includes('wave')) return true;
  if (blob.size < 12) return false;
  try {
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const riff = (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46); // RIFF
    const wave = (header[8] === 0x57 && header[9] === 0x41 && header[10] === 0x56 && header[11] === 0x45); // WAVE
    return riff && wave;
  } catch {
    return false;
  }
}
