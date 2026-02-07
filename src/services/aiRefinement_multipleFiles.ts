/**
 * Multiple Files Strategy for Gemini API
 * 
 * STRATEGY:
 * 1. Split audio into chunks first (avoid memory overflow)
 * 2. Convert each chunk to MP3 format (smaller size, Gemini-compatible)
 * 3. Upload each chunk separately to Gemini
 * 4. Query each chunk: brief summary + transcription
 * 5. Progressive results: append to UI after each chunk
 * 6. Delays between chunks to avoid TPM limits
 * 
 * BENEFITS:
 * - Each chunk uses minimal input tokens (~47K for 25min vs 265K for 139min)
 * - No MAX_TOKENS truncation (full transcription per chunk)
 * - Progressive UX (results appear incrementally)
 * - Quota-friendly (controlled TPM usage)
 * - Memory-efficient (split before conversion avoids overflow)
 */

import { AIRefinementService } from './aiRefinement';
import type { TranscriptionResult } from '../types/types';

export interface MultipleFilesOptions {
  apiKey: string;
  audioBlob: Blob;
  modelName: string;
  maxChunkDurationMinutes: number; // e.g., 25 minutes
  maxChunkSizeMB: number; // e.g., 20 MB
  delayBetweenChunks: number; // e.g., 10 seconds
  meetingStartTime?: Date;
  outputLanguage?: string;
  onProgress?: (progress: number, message?: string) => void;
  onChunkReady?: (chunkIndex: number, totalChunks: number, results: TranscriptionResult[], summary: string) => void;
}

export class MultipleFilesTranscriptionService {
  
  /**
   * 🎯 Main method: Transcribe audio with Multiple Files Strategy
   * 
   * WORKFLOW:
   * 1. Convert to WAV
   * 2. Split into chunks
   * 3. For each chunk:
   *    a. Upload to Gemini (separate file)
   *    b. Query: brief summary + transcription
   *    c. Call onChunkReady callback
   *    d. Delay before next chunk
   * 4. Return aggregated results
   */
  public static async transcribeWithMultipleFiles(
    options: MultipleFilesOptions
  ): Promise<{ 
    results: TranscriptionResult[], 
    summaries: string[], 
    isTruncated?: boolean, 
    truncationWarning?: string 
  }> {
    const {
      apiKey,
      audioBlob,
      modelName,
      maxChunkDurationMinutes,
      maxChunkSizeMB,
      delayBetweenChunks,
      meetingStartTime,
      outputLanguage,
      onProgress,
      onChunkReady
    } = options;

    try {
      // Step 1: Split first (BEFORE conversion to avoid memory overflow)
      if (onProgress) onProgress(5, '✂️ Đang chia nhỏ file audio...');
      console.log(`✂️ Splitting original audio into chunks (max ${maxChunkDurationMinutes}min)...`);
      console.log(`📊 Original file size: ${(audioBlob.size / (1024 * 1024)).toFixed(2)} MB`);
      
      // Split based on duration only (size will be controlled after WAV conversion)
      const originalChunks = await AIRefinementService.splitAudioIntoChunks(
        audioBlob,
        maxChunkSizeMB * 10, // High limit for original format (we'll convert each chunk later)
        maxChunkDurationMinutes
      );
      console.log(`✅ Split into ${originalChunks.length} chunks (original format)`);

      // Step 2: Convert each chunk to MP3
      if (onProgress) onProgress(10, '🔄 Đang chuyển đổi từng chunk sang MP3...');
      console.log('📝 Converting each chunk to MP3 format...');
      
      const chunks: { blob: Blob; startTimeMs: number; endTimeMs: number }[] = [];
      for (let i = 0; i < originalChunks.length; i++) {
        const chunk = originalChunks[i];
        console.log(`🔄 Converting chunk ${i + 1}/${originalChunks.length} to MP3...`);
        
        try {
          const mp3Chunk = await AIRefinementService.convertToMp3(chunk.blob);
          const mp3SizeMB = mp3Chunk.size / (1024 * 1024);
          console.log(`✅ Chunk ${i + 1} MP3: ${mp3SizeMB.toFixed(2)} MB`);
          
          chunks.push({
            blob: mp3Chunk,
            startTimeMs: chunk.startTimeMs,
            endTimeMs: chunk.endTimeMs
          });
        } catch (error: any) {
          console.error(`❌ Failed to convert chunk ${i + 1} to MP3:`, error);
          throw new Error(`MP3 conversion failed for chunk ${i + 1}: ${error.message}`);
        }
      }
      
      console.log(`✅ All chunks converted to MP3 format`);

      // Step 3: Process each chunk
      const allResults: TranscriptionResult[] = [];
      const allSummaries: string[] = [];
      let hasTruncation = false;
      const warnings: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkProgress = 15 + ((i / chunks.length) * 80); // 15-95%
        const chunkDurationMin = Math.floor((chunk.endTimeMs - chunk.startTimeMs) / 60000);

        if (onProgress) {
          onProgress(
            chunkProgress,
            `📤 Đang xử lý file ${i + 1}/${chunks.length} (${chunkDurationMin} phút)...`
          );
        }

        console.log(`\n📦 Processing chunk ${i + 1}/${chunks.length}:`);
        console.log(`   Duration: ${chunkDurationMin} minutes`);
        console.log(`   Size: ${(chunk.blob.size / (1024 * 1024)).toFixed(2)} MB`);
        console.log(`   Time range: ${Math.floor(chunk.startTimeMs / 1000)}s - ${Math.floor(chunk.endTimeMs / 1000)}s`);

        try {
          // 3a. Upload chunk
          if (onProgress) onProgress(chunkProgress, `📤 Đang tải chunk ${i + 1}/${chunks.length}...`);
          const uploadedFile = await AIRefinementService.uploadAudioToGemini(
            apiKey,
            chunk.blob,
            `chunk_${i + 1}_${Date.now()}.mp3`,
            (uploadProgress) => {
              console.log(`📤 Upload chunk ${i + 1}: ${uploadProgress}%`);
            }
          );
          console.log(`✅ Chunk ${i + 1} uploaded: ${uploadedFile.uri}`);

          // 3b. Query chunk: brief summary + transcription
          if (onProgress) onProgress(chunkProgress + 2, `🤖 Đang phiên âm chunk ${i + 1}/${chunks.length}...`);
          const result = await this.queryChunk(
            apiKey,
            uploadedFile,
            modelName,
            chunkDurationMin,
            chunk.startTimeMs,
            meetingStartTime,
            outputLanguage,
            i + 1,
            chunks.length
          );

          // Adjust timestamps
          result.results.forEach(item => {
            if (item.audioTimeMs !== undefined) {
              item.audioTimeMs += chunk.startTimeMs;
            }
          });

          // Collect results
          allResults.push(...result.results);
          allSummaries.push(result.summary);

          if (result.isTruncated) {
            hasTruncation = true;
            if (result.truncationWarning) {
              warnings.push(`Chunk ${i + 1}: ${result.truncationWarning}`);
            }
          }

          // 3c. Callback with results
          if (onChunkReady) {
            console.log(`📤 Sending chunk ${i + 1} results to UI (${result.results.length} segments)...`);
            onChunkReady(i + 1, chunks.length, result.results, result.summary);
          }

          console.log(`✅ Chunk ${i + 1}/${chunks.length} completed: ${result.results.length} segments`);

        } catch (error: any) {
          console.error(`❌ Chunk ${i + 1} failed:`, error);
          warnings.push(`Chunk ${i + 1}: ${error.message}`);
          // Continue with next chunk instead of failing completely
        }

        // 3d. Delay before next chunk
        if (i < chunks.length - 1) {
          if (onProgress) {
            onProgress(chunkProgress + 5, `⏳ Chờ ${delayBetweenChunks}s trước chunk tiếp theo...`);
          }
          console.log(`⏳ Waiting ${delayBetweenChunks}s before next chunk...`);
          await new Promise(resolve => setTimeout(resolve, delayBetweenChunks * 1000));
        }
      }

      if (onProgress) onProgress(100, '✅ Hoàn thành!');

      // Build final warning
      let finalWarning: string | undefined;
      if (hasTruncation || warnings.length > 0) {
        finalWarning = warnings.join('\n');
      }

      return {
        results: allResults,
        summaries: allSummaries,
        isTruncated: hasTruncation,
        truncationWarning: finalWarning
      };

    } catch (error: any) {
      console.error('❌ Multiple Files transcription failed:', error);
      throw new Error(`Failed to transcribe with multiple files: ${error.message}`);
    }
  }

  /**
   * Query single chunk: brief summary + full transcription
   * 
   * @param apiKey - Gemini API key
   * @param uploadedFile - Uploaded file info
   * @param modelName - Gemini model name
   * @param chunkDurationMin - Chunk duration in minutes
   * @param chunkStartTimeMs - Chunk start time offset in milliseconds
   * @param meetingStartTime - Meeting start time for timestamps
   * @param outputLanguage - Output language code
   * @param chunkIndex - Current chunk index (for logging)
   * @param totalChunks - Total number of chunks
   */
  private static async queryChunk(
    apiKey: string,
    uploadedFile: any,
    modelName: string,
    chunkDurationMin: number,
    chunkStartTimeMs: number,
    meetingStartTime: Date | undefined,
    outputLanguage: string | undefined,
    chunkIndex: number,
    totalChunks: number
  ): Promise<{ 
    results: TranscriptionResult[], 
    summary: string, 
    isTruncated?: boolean, 
    truncationWarning?: string 
  }> {
    
    // Detect language instruction
    const languageName = AIRefinementService['getLanguageName'](outputLanguage);
    const languageInstruction = languageName ? `\n- TRẢ VỀ BẰNG ${languageName.toUpperCase()}` : '';

    // Compact prompt: brief summary + transcription
    const prompt = `PHIÊN ÂM AUDIO CHUNK ${chunkIndex}/${totalChunks} (${chunkDurationMin} phút)

PHẦN 1: TÓM TẮT NGẮN (2-3 câu)
Tóm tắt CỰC NGẮN nội dung chính của đoạn này.${languageInstruction}

PHẦN 2: PHIÊN ÂM CHI TIẾT
- Phân biệt người nói (Speaker 1, Speaker 2...)
- Timestamp bắt đầu từ 0:00 (tương đối trong chunk này)
- Loại bỏ từ đệm (à, ừm, ơ)
- Gộp câu liên tiếp của cùng 1 người${languageInstruction}

Output JSON:
{
  "summary": "Tóm tắt ngắn...",
  "segments": [{"timestamp": "0:00", "speaker": "Speaker 1", "text": "..."}]
}`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [{
        parts: [
          { text: prompt },
          {
            fileData: {
              mimeType: uploadedFile.mimeType,
              fileUri: uploadedFile.uri
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 16384,
        responseMimeType: 'application/json'
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };

    console.log(`📤 Querying chunk ${chunkIndex} with fileUri: ${uploadedFile.uri}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API error (${response.status}): ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();

    // Adjust meeting time for this chunk
    const adjustedMeetingTime = meetingStartTime 
      ? new Date(meetingStartTime.getTime() + chunkStartTimeMs)
      : undefined;

    // Parse response
    const parsed = AIRefinementService['parseGeminiAudioTranscription'](
      data,
      adjustedMeetingTime
    );

    return {
      results: parsed.results,
      summary: parsed.summary || `Chunk ${chunkIndex}/${totalChunks}`,
      isTruncated: parsed.isTruncated,
      truncationWarning: parsed.truncationWarning
    };
  }
}
