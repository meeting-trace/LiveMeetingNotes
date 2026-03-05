/**
 * Lightweight WebM Duration patcher.
 *
 * WHY NOT fix-webm-duration?
 * fix-webm-duration reads the ENTIRE blob into a Uint8Array, parses all EBML
 * elements, then REBUILDS the full file via updateByData() / writeSections().
 * For timesliced MediaRecorder WebM, Cluster elements are treated as "Unknown"
 * during parsing — when the Segment container is re-serialized its element-size
 * VARINTs may shift, misaligning block boundaries and producing the symptom:
 *   "correct duration shown, but audio after ~1 min is silent / no waveform".
 *
 * WHAT WE DO INSTEAD:
 * The EBML Duration field is located inside Segment > Info, always within the
 * first few hundred bytes of the file.  We locate it by scanning for its 2-byte
 * EBML ID (0x44 0x89) in the header chunk, then overwrite only the 8 float bytes
 * in-place.  Everything else — audio cluster data, SeekHead offsets, codec
 * privates — is left byte-for-byte identical.
 *
 * MediaRecorder reference:
 *   - Chrome/Edge always write Duration = 0.0 (present, not missing)
 *   - TimecodeScale defaults to 1 000 000 ns → 1 ms per timecode unit
 *   - Therefore: Duration value (ms) == Duration timecodes
 */

/**
 * Scan the first `limitBytes` bytes of `chunk` for the EBML Duration element
 * and overwrite its value with `durationMs`.
 *
 * The function handles both:
 *   - 8-byte IEEE 754 double  (size byte 0x88, used by Chrome/Edge)
 *   - 4-byte IEEE 754 float   (size byte 0x84, rare but possible)
 *
 * If the Duration element is not found the original chunk is returned unchanged.
 */
export async function patchWebmHeaderDuration(
  firstChunk: Blob,
  durationMs: number,
  limitBytes = 8192
): Promise<Blob> {
  try {
    // Read only the header chunk — never the full multi-GB file.
    const ab = await firstChunk.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const view = new DataView(ab);

    const end = Math.min(bytes.length, limitBytes) - 10;

    for (let i = 0; i < end; i++) {
      // Duration EBML ID in 2-byte VARINT form: 0x44 0x89
      if (bytes[i] !== 0x44 || bytes[i + 1] !== 0x89) continue;

      if (bytes[i + 2] === 0x88) {
        // 8-byte double (chrome/edge default)
        view.setFloat64(i + 3, durationMs, false); // big-endian
        console.log(
          `[webmUtils] Duration patched at byte ${i}: ${(durationMs / 60_000).toFixed(1)} min`
        );
        return new Blob([ab], { type: firstChunk.type });
      }

      if (bytes[i + 2] === 0x84) {
        // 4-byte float (uncommon)
        view.setFloat32(i + 3, durationMs, false);
        console.log(
          `[webmUtils] Duration (float32) patched at byte ${i}: ${(durationMs / 60_000).toFixed(1)} min`
        );
        return new Blob([ab], { type: firstChunk.type });
      }
    }

    console.warn('[webmUtils] Duration element not found in header — returning chunk unchanged');
    return firstChunk;
  } catch (e) {
    console.warn('[webmUtils] Failed to patch Duration, returning chunk unchanged:', e);
    return firstChunk;
  }
}
