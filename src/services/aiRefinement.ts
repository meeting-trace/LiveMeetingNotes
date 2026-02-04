import type { TranscriptionResult } from '../types/types';
import type { FileManagerService } from './fileManager';

export interface RawTranscriptData {
  text: string;
  timestamp: string;
  audioTimeMs?: number;
  confidence: number;
  isFinal: boolean;
}

export interface RefinedSegment {
  text: string;
  timestamp: string;
  audioTimeMs?: number;
}

/**
 * AI Refinement Service for Gemini AI
 * Refines raw speech-to-text transcripts with AI
 */
export class AIRefinementService {
  private static readonly GEMINI_MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
  private static readonly GEMINI_API_VERSION = 'v1beta'; // Use v1beta as it's more stable

  // Gemini Free Tier Limits (per day)
  private static readonly FREE_TIER_LIMITS = {
    RPM: 15,           // Requests per minute
    TPM: 1000000,      // Tokens per minute (1M)
    RPD: 1500,         // Requests per day
    TPD: 250000        // Tokens per day (250K) - Main limit users hit
  };

  // Batch processing configuration
  private static readonly BATCH_SIZE = 30; // Reduced from 50 to 30 segments per batch (~5000 tokens)
  private static readonly BATCH_DELAY_MS = 6000; // Increased from 5000 to 6000ms (6 seconds) between batches to avoid rate limit

  /**
   * Estimate token count for transcripts
   * OPTIMIZED: Reduced prompt overhead after optimization (1000 -> 500 tokens)
   */
  private static estimateTokenCount(transcriptions: TranscriptionResult[]): number {
    // Rough estimation: 1 token ≈ 4 characters for English, ~2-3 for Vietnamese
    const totalChars = transcriptions.reduce((sum, t) => sum + t.text.length, 0);
    // Vietnamese: ~2.5 chars per token, English: ~4 chars per token
    // Use 3 as average + reduced overhead for optimized prompt
    const estimatedTokens = Math.ceil(totalChars / 3) + 500; // +500 for compact prompt overhead (reduced from 1000)
    return estimatedTokens;
  }

  /**
   * Save Gemini API request and response to file for debugging
   * Only saves prompt text and response, excludes large binary data (audio base64)
   * Saves to project folder's debug-logs/ directory when folder is selected
   */
  private static async saveGeminiDebugLog(
    requestBody: any,
    responseData: any,
    metadata: { type: 'text' | 'audio'; timestamp: string; error?: string },
    fileManager?: FileManagerService
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `gemini-debug-${metadata.type}-${timestamp}.json`;
      
      // Extract only prompt text from request (exclude base64 audio data)
      let requestSummary: any = null;
      
      if (requestBody) {
        requestSummary = {
          generationConfig: requestBody.generationConfig,
          safetySettings: requestBody.safetySettings
        };

        // Extract prompt text based on request type
        if (requestBody.contents && Array.isArray(requestBody.contents)) {
          requestSummary.contents = requestBody.contents.map((content: any) => {
            if (content.parts && Array.isArray(content.parts)) {
              return {
                parts: content.parts.map((part: any) => {
                  // Keep text prompts, exclude base64 audio data
                  if (part.text) {
                    return { text: part.text };
                  } else if (part.inline_data) {
                    // Replace large base64 data with summary info
                    return {
                      inline_data: {
                        mime_type: part.inline_data.mime_type,
                        data: `[EXCLUDED: ${part.inline_data.mime_type} data, size: ${part.inline_data.data?.length || 0} chars]`
                      }
                    };
                  }
                  return part;
                })
              };
            }
            return content;
          });
        }
      }
      
      const debugData = {
        metadata: {
          ...metadata,
          savedAt: new Date().toISOString(),
          note: 'Audio base64 data excluded to reduce file size'
        },
        request: requestSummary,
        response: responseData
      };

      // Save to project folder's debug-logs/ if fileManager has folder selected
      if (fileManager) {
        try {
          await fileManager.saveMetadataFile(debugData, filename, 'debug-logs', true);
          console.log(`📁 Gemini debug log saved to project: debug-logs/${filename}`);
        } catch (error: any) {
          // If no folder selected, log info (don't save)
          if (error.message === 'No folder selected') {
            console.log(`ℹ️ Debug log not saved (no project folder selected): ${filename}`);
          } else {
            console.error('Failed to save debug log to project folder:', error);
          }
        }
      } else {
        console.log(`ℹ️ Debug log not saved (fileManager not available): ${filename}`);
      }
    } catch (error) {
      console.error('Failed to prepare debug log:', error);
    }
  }

  /**
   * Check if processing would exceed quota
   */
  private static checkQuotaEstimate(transcriptions: TranscriptionResult[]): {
    estimatedTokens: number;
    withinLimit: boolean;
    message: string;
  } {
    const estimatedTokens = this.estimateTokenCount(transcriptions);
    const withinLimit = estimatedTokens < this.FREE_TIER_LIMITS.TPD;

    let message = '';
    if (!withinLimit) {
      message = `⚠️ Ước tính ${estimatedTokens.toLocaleString()} tokens - vượt hạn mức miễn phí (${this.FREE_TIER_LIMITS.TPD.toLocaleString()} tokens/ngày)`;
    } else {
      const percentUsed = Math.round((estimatedTokens / this.FREE_TIER_LIMITS.TPD) * 100);
      message = `✅ Ước tính ${estimatedTokens.toLocaleString()} tokens (~${percentUsed}% hạn mức miễn phí)`;
    }

    return { estimatedTokens, withinLimit, message };
  }

  /**
   * Split transcriptions into batches for processing
   */
  private static splitIntoBatches(transcriptions: TranscriptionResult[], batchSize: number): TranscriptionResult[][] {
    const batches: TranscriptionResult[][] = [];
    for (let i = 0; i < transcriptions.length; i += batchSize) {
      batches.push(transcriptions.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Check quota status by making a minimal test request
   * Returns usage info and recommendations
   */
  public static async checkQuotaStatus(apiKey: string, modelName: string): Promise<{
    status: 'available' | 'limited' | 'exceeded' | 'error';
    message: string;
    recommendations: string[];
  }> {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/${this.GEMINI_API_VERSION}/${modelName}:generateContent`;
      
      const response = await fetch(`${endpoint}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'test' }] }],
          generationConfig: { maxOutputTokens: 1 }
        })
      });
      
      if (response.status === 429) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || '';
        
        if (errorMsg.includes('quota') || errorMsg.includes('250000')) {
          return {
            status: 'exceeded',
            message: '🚫 Đã vượt hạn mức 250,000 tokens/ngày',
            recommendations: [
              '🕒 Đợi 24 giờ để quota reset',
              '💳 Nâng cấp Paid tier: ~$2/tháng, unlimited',
              '📊 Monitor: https://ai.dev/rate-limit'
            ]
          };
        } else {
          return {
            status: 'limited',
            message: '⏱️ Vượt 15 requests/phút',
            recommendations: [
              '⏰ Đợi 1-2 phút rồi thử lại',
              '🔄 App sẽ tự động delay giữa các batch'
            ]
          };
        }
      } else if (response.ok) {
        return {
          status: 'available',
          message: '✅ API Key hoạt động bình thường',
          recommendations: [
            '🎯 Free tier: 250,000 tokens/ngày',
            '📊 Mỗi 50 segments ~ 7,500 tokens',
            '🔍 Monitor: https://ai.dev/rate-limit'
          ]
        };
      } else {
        return {
          status: 'error',
          message: `❌ Lỗi API: ${response.status}`,
          recommendations: [
            'Kiểm tra API Key có hợp lệ',
            'Kiểm tra model đã chọn đúng'
          ]
        };
      }
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Không thể kiểm tra quota',
        recommendations: [
          'Kiểm tra kết nối internet',
          'Thử lại sau vài phút'
        ]
      };
    }
  }

  /**
   * Get usage metadata and quota information from Gemini API
   * Note: Gemini API doesn't provide direct quota endpoint, but we can infer from rate limit headers
   */
  public static async checkQuotaInfo(apiKey: string, modelName: string): Promise<{
    estimatedUsage: string;
    quotaStatus: string;
    recommendations: string[];
  }> {
    try {
      // Make a minimal test request to check quota status
      const endpoint = `https://generativelanguage.googleapis.com/${this.GEMINI_API_VERSION}/${modelName}:generateContent`;
      
      const response = await fetch(`${endpoint}?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: 'test' }]
          }],
          generationConfig: {
            maxOutputTokens: 1
          }
        })
      });

      // Check response headers for quota info (if available)
      // const remainingRequests = response.headers.get('x-ratelimit-remaining');
      // const resetTime = response.headers.get('x-ratelimit-reset');
      
      // Parse response to check for quota errors
      const recommendations: string[] = [];
      let quotaStatus = 'unknown';
      let estimatedUsage = 'Không có thông tin chi tiết';

      if (response.status === 429) {
        quotaStatus = 'exceeded';
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || '';
        
        if (errorMsg.includes('quota')) {
          estimatedUsage = 'Đã vượt hạn mức 250,000 tokens/ngày';
          recommendations.push('Đợi 24 giờ để quota reset');
          recommendations.push('Hoặc nâng cấp lên Paid tier (~$2/tháng)');
        } else {
          estimatedUsage = 'Đã vượt 15 requests/phút';
          recommendations.push('Đợi 1 phút rồi thử lại');
        }
      } else if (response.ok) {
        quotaStatus = 'available';
        estimatedUsage = 'API Key hoạt động bình thường';
        
        // Estimate based on typical usage
        recommendations.push('✅ Free tier: 250,000 tokens/ngày, 15 requests/phút');
        recommendations.push('💡 Mỗi 50 segments ~ 7,500 tokens');
        recommendations.push('📊 Monitor: https://ai.dev/rate-limit');
      }

      return {
        estimatedUsage,
        quotaStatus,
        recommendations
      };
    } catch (error: any) {
      return {
        estimatedUsage: 'Không thể kiểm tra quota',
        quotaStatus: 'error',
        recommendations: [
          'Kiểm tra API Key có hợp lệ',
          'Kiểm tra kết nối internet',
          'Thử lại sau vài phút'
        ]
      };
    }
  }

  /**
   * List available Gemini models for the given API key
   * Useful for debugging and verifying API key access
   */
  public static async listGeminiModels(apiKey: string): Promise<any> {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('API Key is required');
    }

    try {
      const response = await fetch(`${this.GEMINI_MODELS_ENDPOINT}?key=${apiKey}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Failed to list models (${response.status}): ${errorData.error?.message || response.statusText}\n` +
          `URL: ${this.GEMINI_MODELS_ENDPOINT}`
        );
      }

      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error('Error listing Gemini models:', error);
      throw new Error(`Cannot list Gemini models: ${error.message}`);
    }
  }

  /**
   * Refine transcripts using Gemini AI with automatic batching
   * @param transcriptions - Primary data (user-edited, highest reliability)
   * @param rawData - Supplementary data (original Web Speech API output for reference)
   */
  public static async refineTranscripts(
    apiKey: string,
    transcriptions: TranscriptionResult[], // Primary data source
    rawData: RawTranscriptData[], // Optional: supplementary raw data
    modelName: string, // REQUIRED: specific Gemini model (e.g., "models/gemini-2.5-flash")
    onProgress?: (progress: number, message?: string) => void,
    fileManager?: FileManagerService // Optional: for saving debug logs to project folder
  ): Promise<{ segments: RefinedSegment[], summary?: string }> {
    // Check quota estimate first
    const quotaCheck = this.checkQuotaEstimate(transcriptions);
    console.log('📊 Quota Check:', quotaCheck.message);

    // If estimated tokens exceed limit, use batch processing
    if (quotaCheck.estimatedTokens > this.FREE_TIER_LIMITS.TPD * 0.8) { // 80% threshold
      console.log('🔄 Using batch processing to avoid quota limits...');
      return this.refineTranscriptsInBatches(apiKey, transcriptions, rawData, modelName, onProgress, fileManager);
    }

    // Otherwise, process normally
    return this.refineWithGemini(apiKey, transcriptions, rawData, modelName, onProgress, fileManager);
  }

  /**
   * Refine transcripts in batches to avoid quota limits
   */
  private static async refineTranscriptsInBatches(
    apiKey: string,
    transcriptions: TranscriptionResult[],
    rawData: RawTranscriptData[],
    modelName: string,
    onProgress?: (progress: number, message?: string) => void,
    fileManager?: FileManagerService
  ): Promise<{ segments: RefinedSegment[], summary?: string }> {
    const batches = this.splitIntoBatches(transcriptions, this.BATCH_SIZE);
    const allRefinedSegments: RefinedSegment[] = [];
    const allSummaries: string[] = [];

    console.log(`📦 Processing ${transcriptions.length} segments in ${batches.length} batches...`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchProgress = (i / batches.length) * 100;

      console.log(`🔄 Processing batch ${i + 1}/${batches.length} (${batch.length} segments)...`);

      try {
        // Find corresponding raw data for this batch
        const batchStartIndex = i * this.BATCH_SIZE;
        const batchRawData = rawData.slice(batchStartIndex, batchStartIndex + batch.length);

        // Process this batch
        const batchResult = await this.refineWithGemini(
          apiKey,
          batch,
          batchRawData,
          modelName,
          (subProgress) => {
            if (onProgress) {
              const totalProgress = batchProgress + (subProgress / batches.length);
              onProgress(Math.min(totalProgress, 99));
            }
          },
          fileManager
        );

        allRefinedSegments.push(...batchResult.segments);
        if (batchResult.summary) {
          allSummaries.push(batchResult.summary);
        }

        // Add delay between batches to avoid rate limiting (except for last batch)
        if (i < batches.length - 1) {
          console.log(`⏳ Waiting ${this.BATCH_DELAY_MS / 1000} seconds before next batch to avoid rate limit...`);
          await new Promise(resolve => setTimeout(resolve, this.BATCH_DELAY_MS));
        }
      } catch (error: any) {
        // If quota exceeded, throw error with helpful message
        if (error.message.includes('429') || error.message.includes('quota')) {
          throw new Error(
            `Vượt hạn mức API tại batch ${i + 1}/${batches.length}.\n\n` +
            `✅ Đã xử lý: ${allRefinedSegments.length}/${transcriptions.length} segments\n\n` +
            `Nguyên nhân: ${error.message}\n\n` +
            `💡 Giải pháp:\n` +
            `• Đợi 24 giờ để quota reset (hạn mức: 250,000 tokens/ngày)\n` +
            `• Hoặc nâng cấp lên Gemini API trả phí tại console.cloud.google.com`
          );
        }
        throw error;
      }
    }

    if (onProgress) onProgress(100);
    console.log(`✅ Batch processing complete: ${allRefinedSegments.length} segments refined`);
    
    // Combine all batch summaries into one
    const combinedSummary = allSummaries.length > 0 
      ? allSummaries.join('\n\n---\n\n')
      : undefined;
    
    return { segments: allRefinedSegments, summary: combinedSummary };
  }

  /**
   * Refine with Google Gemini API using user-selected model
   */
  private static async refineWithGemini(
    apiKey: string,
    transcriptions: TranscriptionResult[], // Primary data
    rawData: RawTranscriptData[], // Supplementary data
    modelName: string, // REQUIRED: specific model like "models/gemini-2.5-flash"
    onProgress?: (progress: number, message?: string) => void,
    fileManager?: FileManagerService
  ): Promise<{ segments: RefinedSegment[], summary?: string }> {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('API Key is required for AI refinement');
    }

    if (transcriptions.length === 0) {
      throw new Error('No transcript data to refine');
    }

    // Validate model name
    if (!modelName || !modelName.trim() || !modelName.startsWith('models/')) {
      throw new Error(
        'Vui lòng chọn Gemini Model trong Settings.\n\n' +
        'Bước 1: Mở Settings → Nhập Gemini API Key\n' +
        'Bước 2: Chờ hệ thống tải danh sách models\n' +
        'Bước 3: Chọn model từ dropdown (ví dụ: Gemini 2.5 Flash)\n' +
        'Bước 4: Lưu và thử lại'
      );
    }

    try {
      // Prepare primary data from transcriptions (user-edited, highest reliability)
      // OPTIMIZED: Only send essential fields to reduce token usage
      const transcriptData = transcriptions.map((item) => ({
        timestamp: item.startTime,
        audioTimeMs: item.audioTimeMs,
        text: item.text
      }));

      // Prepare supplementary raw data (if available)
      // OPTIMIZED: Only send essential fields to reduce token usage
      const hasRawData = rawData && rawData.length > 0;
      const rawMetadata = hasRawData ? rawData.map((item) => ({
        timestamp: item.timestamp,
        audioTimeMs: item.audioTimeMs,
        text: item.text
      })) : null;

      // Create prompt
      const prompt = this.createRefinementPrompt(transcriptData, rawMetadata);

      if (onProgress) onProgress(10);

      // Build endpoint URL with selected model
      const endpoint = `https://generativelanguage.googleapis.com/${this.GEMINI_API_VERSION}/${modelName}:generateContent`;
      console.log(`🤖 Using Gemini model: ${modelName}`);
      console.log(`📡 Endpoint: ${endpoint}`);

      // Call Gemini API
      const requestBody = {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE"
          }
        ]
      };

      const response = await fetch(`${endpoint}?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (onProgress) onProgress(70, '📥 Đang nhận kết quả từ Gemini...');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || response.statusText;
        
        // Handle quota/rate limit errors (429)
        if (response.status === 429) {
          // Extract retry time if available
          const retryMatch = errorMsg.match(/retry in ([\d.]+)s/);
          const retrySeconds = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
          const retryMinutes = Math.ceil(retrySeconds / 60);

          // Check if it's daily quota or rate limit
          if (errorMsg.includes('quota') || errorMsg.includes('250000')) {
            throw new Error(
              `🚫 Đã vượt hạn mức miễn phí của Gemini API\n\n` +
              `📊 Hạn mức free tier: 250,000 tokens/ngày\n` +
              `⏰ Thời gian reset: Sau ${retrySeconds}s (~ ${retryMinutes} phút)\n\n` +
              `💡 Giải pháp:\n` +
              `1️⃣ Đợi ${retryMinutes} phút rồi thử lại\n` +
              `2️⃣ Xử lý ít segments hơn (chọn đoạn quan trọng để chuẩn hóa)\n` +
              `3️⃣ Nâng cấp lên Gemini API trả phí:\n` +
              `   • Truy cập: https://console.cloud.google.com\n` +
              `   • Enable billing để có quota cao hơn (60 requests/phút)\n\n` +
              `📈 Monitor usage: https://ai.dev/rate-limit\n\n` +
              `Chi tiết: ${errorMsg}`
            );
          } else {
            // Rate limit (RPM)
            throw new Error(
              `⏱️ Vượt giới hạn requests/phút\n\n` +
              `📊 Hạn mức: 15 requests/phút (free tier)\n` +
              `⏰ Thử lại sau: ${retrySeconds}s\n\n` +
              `💡 Giải pháp: Đợi ${Math.ceil(retrySeconds / 60)} phút rồi thử lại\n\n` +
              `Chi tiết: ${errorMsg}`
            );
          }
        }
        
        // Provide helpful error messages for other errors
        if (response.status === 403) {
          if (errorMsg.includes('API has not been used') || errorMsg.includes('SERVICE_DISABLED')) {
            throw new Error(
              'API Key không hợp lệ hoặc chưa enable.\n\n' +
              '✅ Lấy API key miễn phí tại: https://aistudio.google.com/app/apikey\n' +
              'Sau đó paste vào Settings → Gemini API Key'
            );
          } else if (errorMsg.includes('API_KEY_INVALID')) {
            throw new Error('API Key không hợp lệ. Vui lòng kiểm tra lại trong Settings.');
          }
        } else if (response.status === 404) {
          throw new Error(
            `Model "${modelName}" không tồn tại hoặc không khả dụng.\n\n` +
            'Giải pháp:\n' +
            '1. Mở Settings → Click nút "Tải lại" bên cạnh Gemini Model\n' +
            '2. Chọn model khác từ danh sách (khuyên dùng: Gemini 2.5 Flash)\n' +
            '3. Lưu và thử lại\n\n' +
            `Chi tiết lỗi: ${errorMsg}`
          );
        }
        
        throw new Error(`Gemini API error (${response.status}): ${errorMsg}`);
      }

      const result = await response.json();
      
      if (onProgress) onProgress(90);

      // 💾 Save debug log with request and response
      await this.saveGeminiDebugLog(requestBody, result, {
        type: 'text',
        timestamp: new Date().toISOString(),
        error: result.error ? result.error.message : undefined
      }, fileManager);

      // Parse AI response (now returns { segments, summary })
      const parsed = this.parseAIResponse(result);

      if (onProgress) onProgress(100);

      console.log(`✅ Successfully refined ${parsed.segments.length} segments`);
      if (parsed.summary) {
        console.log(`📝 Summary generated (${parsed.summary.length} characters)`);
      }
      return parsed;

    } catch (error: any) {
      console.error('AI Refinement Error:', error);
      throw new Error(`Failed to refine transcripts: ${error.message}`);
    }
  }

  /**
   * Create refinement prompt for AI
   * @param transcriptData - Primary data from transcriptions (user-edited)
   * @param rawMetadata - Optional raw data for reference
   */
  private static createRefinementPrompt(transcriptData: any[], rawMetadata: any[] | null): string {
    // OPTIMIZED: Use compact JSON format (no pretty-print) to save tokens
    const dataJson = JSON.stringify(transcriptData);
    const hasRawData = rawMetadata && rawMetadata.length > 0;
    const rawDataJson = hasRawData ? JSON.stringify(rawMetadata) : null;

    // OPTIMIZED: Shortened prompt to reduce token count while maintaining quality
    return `Vai trò: Thư ký chuyên nghiệp soạn biên bản họp.

Nhiệm vụ: Chuẩn hóa văn bản speech-to-text:
1. Sửa lỗi nhận diện từ
2. Xóa từ đệm (à, ừm, thì, là, mà)
3. Thêm dấu câu, viết hoa danh từ riêng
4. Gộp các đoạn liên tiếp thành câu hoàn chỉnh
5. Giữ nguyên nội dung, không thêm bớt ý
6. Tóm tắt toàn bộ nội dung cuộc họp dựa trên các segment

Output: CHỈ JSON object, KHÔNG markdown/giải thích
Format: {
  "segments": [{"timestamp":"...","audioTimeMs":123,"text":"..."},...],
  "summary": "Tóm tắt nội dung cuộc họp dạng văn xuôi, bao gồm các chủ đề chính, quyết định quan trọng, kết luận."
}

=== DỮ LIỆU CHÍNH ===
${dataJson}
${hasRawData ? `\n=== DỮ LIỆU BỔ TRỢ (tham khảo) ===\n${rawDataJson}` : ''}

Giữ timestamp/audioTimeMs gốc. Trả về JSON object với segments và summary.`;
  }

  /**
   * Parse AI response and create refined segments with summary
   */
  private static parseAIResponse(apiResponse: any): { segments: RefinedSegment[], summary?: string } {
    try {
      // Extract text from Gemini response
      const candidates = apiResponse.candidates;
      if (!candidates || candidates.length === 0) {
        throw new Error('No response from AI');
      }

      const content = candidates[0].content;
      if (!content || !content.parts || content.parts.length === 0) {
        throw new Error('Invalid AI response format');
      }

      let responseText = content.parts[0].text.trim();

      // Remove markdown code blocks if present
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      // Log raw response for debugging
      console.log('🔍 Raw AI response (first 500 chars):', responseText.substring(0, 500));

      // Try to extract JSON if there's additional text (both array and object)
      const jsonMatch = responseText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonMatch) {
        responseText = jsonMatch[0];
        console.log('✂️ Extracted JSON from response');
      }

      // Parse JSON with better error handling
      let refinedData;
      try {
        refinedData = JSON.parse(responseText);
      } catch (parseError: any) {
        console.error('❌ JSON Parse Error:', parseError.message);
        console.log('📄 Full response text:', responseText);
        
        // Try to fix common JSON issues
        let fixedText = responseText
          // Fix unescaped newlines in strings
          .replace(/("text"|"summary")\s*:\s*"([^"]*?)"/g, (_match: string, field: string, text: string) => {
            const escaped = text
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r')
              .replace(/\t/g, '\\t');
            return `${field}: "${escaped}"`;
          });

        console.log('🔧 Attempting to fix JSON...');
        try {
          refinedData = JSON.parse(fixedText);
          console.log('✅ JSON fixed and parsed successfully');
        } catch (secondError) {
          console.error('❌ Still cannot parse after fixes');
          throw parseError; // Throw original error
        }
      }

      // Handle both old format (array) and new format (object with segments + summary)
      let segmentsArray: any[];
      let summary: string | undefined;

      if (Array.isArray(refinedData)) {
        // Old format: just array of segments
        console.log('📦 Received old format (array only)');
        segmentsArray = refinedData;
        summary = undefined;
      } else if (refinedData && typeof refinedData === 'object') {
        // New format: object with segments and summary
        console.log('📦 Received new format (object with segments + summary)');
        segmentsArray = refinedData.segments || [];
        summary = refinedData.summary || undefined;
      } else {
        throw new Error('AI response is neither an array nor an object');
      }

      // Validate and map to RefinedSegment
      const segments: RefinedSegment[] = segmentsArray
        .filter(item => item.text && item.text.trim().length > 0)
        .map(item => ({
          text: item.text.trim(),
          timestamp: item.timestamp || new Date().toISOString(),
          audioTimeMs: item.audioTimeMs
        }));

      return { segments, summary };

    } catch (error: any) {
      console.error('Failed to parse AI response:', error);
      console.log('Raw API response:', JSON.stringify(apiResponse, null, 2));
      throw new Error(`Failed to parse AI response: ${error.message}`);
    }
  }

  /**
   * Format audio time in milliseconds to mm:ss
   */
  // private static formatAudioTime(ms: number): string {
  //   const totalSeconds = Math.floor(ms / 1000);
  //   const minutes = Math.floor(totalSeconds / 60);
  //   const seconds = totalSeconds % 60;
  //   return `${minutes}:${String(seconds).padStart(2, '0')}`;
  // }

  /**
   * Convert refined segments back to TranscriptionResult format
   */
  public static convertToTranscriptionResults(
    refinedSegments: RefinedSegment[],
    speakerPrefix: string = 'Person1'
  ): TranscriptionResult[] {
    return refinedSegments.map((segment, index) => ({
      id: `refined-${Date.now()}-${index}`,
      text: segment.text,
      startTime: segment.timestamp,
      endTime: segment.timestamp, // Same as start for refined segments
      audioTimeMs: segment.audioTimeMs,
      confidence: 1.0, // AI-refined content has high confidence
      speaker: speakerPrefix,
      isFinal: true,
      isManuallyEdited: false,
      isAIRefined: true // Mark as AI-refined
    }));
  }

  /**
   * Transcribe audio file using Gemini Multimodal API
   * Gemini API officially supports: WAV and MP3 only
   * Other formats (WebM, MP4, OGG, AAC, FLAC) must be converted to WAV first
   */
  public static async transcribeAudioWithGemini(
    apiKey: string,
    audioBlob: Blob,
    modelName: string, // e.g., "models/gemini-1.5-flash" or "models/gemini-2.0-flash-exp"
    onProgress?: (progress: number, message?: string) => void,
    skipSizeCheck: boolean = false, // Skip size check when called from auto-split flow
    maxFileSizeMB: number = 20, // Maximum file size in MB (from config)
    meetingStartTime?: Date, // Meeting start time for accurate timestamp calculation
    summaryPrompt?: string, // OPTIONAL: user-provided prompt text for the summary field
    fileManager?: FileManagerService // Optional: for saving debug logs to project folder
  ): Promise<{ results: TranscriptionResult[], summary?: string }> {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('Gemini API Key is required');
    }

    if (!modelName || !modelName.startsWith('models/')) {
      throw new Error('Please select a Gemini model in Settings');
    }

    // Validate file size (limit from config)
    // Skip this check when called from transcribeEntireAudioWithGemini (already split into valid chunks)
    if (!skipSizeCheck) {
      const MAX_FILE_SIZE = maxFileSizeMB * 1024 * 1024;
      const fileSizeMB = audioBlob.size / (1024 * 1024);
      
      console.log(`📊 File size: ${fileSizeMB.toFixed(2)} MB (Limit: ${maxFileSizeMB} MB)`);
      
      if (audioBlob.size > MAX_FILE_SIZE) {
        // Return special error object with file size info
        const error: any = new Error('FILE_TOO_LARGE');
        error.fileSizeMB = fileSizeMB;
        error.maxSizeMB = maxFileSizeMB;
        throw error;
      }
    }

    if (onProgress) onProgress(10, '🔍 Đang kiểm tra file...');

    // Declare requestBody outside try block for error logging
    let requestBody: any = null;

    try {
      // Gemini API officially supports: WAV and MP3 only
      // Convert to optimized WAV (mono, 16kHz) for smaller file size
      let processedAudio = audioBlob;
      const audioType = audioBlob.type.toLowerCase();
      const isWavOrMp3 = audioType.includes('wav') || audioType.includes('mpeg') || audioType.includes('mp3');
      const needsConversion = !isWavOrMp3;
      
      if (needsConversion) {
        console.log(`🔄 Converting ${audioType} to optimized WAV (mono, 16kHz)...`);
        if (onProgress) onProgress(15, `🔄 Đang chuyển đổi sang WAV tối ưu...`);
        
        const originalSizeMB = audioBlob.size / (1024 * 1024);
        
        // ✨ Convert to WAV with mono + 16kHz to reduce file size dramatically
        // 16kHz is optimal for speech recognition (telephony quality)
        // Mono reduces size by 50%, 16kHz reduces by ~70% → total ~85% reduction
        processedAudio = await this.convertToWav(audioBlob, 16000);
        
        const newSizeMB = processedAudio.size / (1024 * 1024);
        const reduction = ((1 - newSizeMB / originalSizeMB) * 100).toFixed(1);
        console.log(`✅ Converted to WAV: ${originalSizeMB.toFixed(2)}MB → ${newSizeMB.toFixed(2)}MB (${reduction}% reduction)`);
        
        // Display conversion result on UI
        if (onProgress) {
          const sizeChange = newSizeMB > originalSizeMB ? '📈 Tăng' : '📉 Giảm';
          onProgress(20, `${sizeChange}: ${originalSizeMB.toFixed(1)}MB → ${newSizeMB.toFixed(1)}MB`);
        }
        
        // Check again after conversion (only if not skipping size check)
        // Note: WAV can be LARGER than original compressed format (WebM, MP4, etc.)
        if (!skipSizeCheck) {
          const MAX_FILE_SIZE = maxFileSizeMB * 1024 * 1024;
          
          if (processedAudio.size > MAX_FILE_SIZE) {
            // Still too large after WAV optimization - use auto-split
            console.warn(`⚠️ File sau WAV conversion vẫn quá lớn (${newSizeMB.toFixed(2)}MB > ${maxFileSizeMB}MB)`);
            console.log(`🔄 Tự động chia nhỏ file và xử lý từng phần...`);
            
            if (onProgress) onProgress(30, '📦 File lớn, đang chia nhỏ và xử lý...');
            
            // Auto-split into chunks
            const result = await this.transcribeEntireAudioWithGemini(
              apiKey,
              processedAudio,
              modelName,
              onProgress,
              maxFileSizeMB,
              5, // requestDelaySeconds
              60, // maxDurationMinutes
              meetingStartTime,
              summaryPrompt,
              fileManager
            );
            
            return result;
          }
        }
        
        if (onProgress) onProgress(25, `✅ Đã tối ưu: ${newSizeMB.toFixed(2)}MB`);
      }

      // Calculate audio duration for adaptive prompting
      if (onProgress) onProgress(30, '⏱️ Đang phân tích thời lượng audio...');
      const audioDuration = await this.getAudioDuration(processedAudio);
      const durationMinutes = Math.ceil(audioDuration / 60);
      
      console.log(`⏱️ Audio duration: ${durationMinutes} minutes (${audioDuration}s)`);

      // Get MIME type (use WAV if converted)
      const mimeType = processedAudio.type || 'audio/wav';

      // Convert audio blob to base64
      if (onProgress) onProgress(38, '💾 Đang mã hóa audio...');
      const base64Audio = await this.blobToBase64(processedAudio);

      // Debug logging before sending
      const audioSizeMB = processedAudio.size / (1024 * 1024);
      const base64SizeKB = (base64Audio.length * 0.75) / 1024; // Approximate size in KB
      console.log('📤 Sending to Gemini:');
      console.log('  • Audio size:', audioSizeMB.toFixed(2), 'MB');
      console.log('  • Duration:', durationMinutes, 'minutes');
      console.log('  • MIME type:', mimeType);
      console.log('  • Base64 size:', base64SizeKB.toFixed(2), 'KB');
      console.log('  • Model:', modelName);
      
      // Display audio info on UI before sending
      if (onProgress) {
        onProgress(39, `📊 ${audioSizeMB.toFixed(1)}MB • ${durationMinutes} phút • ${mimeType.split('/')[1].toUpperCase()}`);
      }

      // Adaptive instruction based on duration
      const adaptiveInstruction = durationMinutes <= 60
        ? `AUDIO NGẮN (${durationMinutes} phút): Hãy phiên âm CHI TIẾT từng câu nói, giữ nguyên wording và ngữ điệu.`
        : durationMinutes <= 90
        ? `AUDIO VỪA (${durationMinutes} phút): Hãy tóm tắt NHÓM CÂU liên quan thành đoạn văn ngắn, vẫn giữ đầy đủ ý chính.`
        : `AUDIO DÀI (${durationMinutes} phút): Chỉ ghi lại Ý CHÍNH của mỗi lượt nói, cô đọng tối đa để tránh vượt giới hạn output.
        
⚠️ QUAN TRỌNG: Nếu cảm thấy output sắp vượt quá giới hạn, hãy tự động chuyển sang chế độ tóm tắt ngắn gọn hơn.`;

      // Prepare request
      const endpoint = `https://generativelanguage.googleapis.com/${this.GEMINI_API_VERSION}/${modelName}:generateContent?key=${apiKey}`;

      requestBody = {
        contents: [{
          parts: [
            {
              text: `BẠN LÀ CHUYÊN GIA GHI CHÉP CUỘC HỌP (AI SCRIBE).
NHIỆM VỤ: Xử lý file âm thanh đầu vào để tạo ra bản ghi chép và tóm tắt điều hành.

${adaptiveInstruction}

HƯỚNG DẪN XỬ LÝ:

PHẦN 1: PHIÊN ÂM/TÓM TẮT (tùy độ dài audio)
1.  Nghe toàn bộ file âm thanh.
2.  Trích xuất nội dung chính xác (hoặc tóm tắt nếu cần).
3.  Phân đoạn hội thoại dựa trên sự thay đổi người nói.
4.  Gán nhãn người nói nhất quán (Speaker 1, Speaker 2...). Cố gắng nhận diện tên nếu họ tự giới thiệu.
5.  Gắn Timestamp [h:mm:ss] chính xác tại thời điểm bắt đầu câu nói (ví dụ: 0:30, 1:05:30, 2:15:45).
6.  Lược bỏ các từ thừa (à, ừ, ờ) nhưng giữ nguyên ý nghĩa.
7.  Nếu âm thanh không rõ, đánh dấu là "[không rõ]".

🎯 BẮT BUỘC GIỮ LẠI (dù có tóm tắt): 
   • Số liệu chính xác
   • Ngày tháng, deadline
   • Tên riêng (người, công ty, dự án)
   • Quyết định quan trọng
   • Yêu cầu hành động (action items)

PHẦN 2: TÓM TẮT TỔNG QUAN (SUMMARY)
Sau khi xử lý xong, hãy tóm tắt nội dung cuộc họp dựa trên yêu cầu sau:
${summaryPrompt || 'Tóm tắt cụ thể các nội dung chính của từng người phát biểu, được thảo luận trong cuộc họp, tổng hợp theo trình tự thời gian. Bao gồm nhưng không giới hạn các chủ đề chính, quyết định quan trọng, và kết luận (nếu có).'}

CHÚ Ý: Viết tóm tắt bằng văn xuôi (paragraph), KHÔNG dùng dấu gạch đầu dòng.

Hãy trả về duy nhất một object JSON hợp lệ, không có markdown, không có lời dẫn. Cấu trúc như sau:
{
  "segments": [
    {
      "timestamp": "0:00",
      "speaker": "Người nói 1",
      "text": "nội dung (chi tiết hoặc tóm tắt tùy độ dài audio)"
    }
  ],
  "summary": "Nội dung tóm tắt chi tiết về cuộc họp dựa trên yêu cầu ở trên. Viết thành văn xuôi liền mạch."
}`
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Audio
              }
            }
          ]
        }],
        // 🛡️ Safety Settings: Disable all filters to prevent blocking transcription
        // Audio meetings may contain loud noises, debates, or sensitive words
        // that could be misinterpreted as harmful content
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE"
          }
        ]
      };

      if (onProgress) onProgress(40, '📤 Đang gửi request tới Gemini AI...');

      // Make API request
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (onProgress) onProgress(70, '📥 Đã nhận response từ Gemini...');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Gemini API error (${response.status}): ${errorData.error?.message || response.statusText}`
        );
      }

      const data = await response.json();
      if (onProgress) onProgress(90, '📝 Đang phân tích kết quả...');

      // Debug: Log response structure
      console.log('🔍 Response keys:', Object.keys(data));
      console.log('🔍 Has candidates?', !!data.candidates);
      console.log('🔍 Has promptFeedback?', !!data.promptFeedback);
      console.log('🔍 Has error?', !!data.error);

      // 🛡️ Check if blocked by safety filter
      if (data.promptFeedback?.blockReason) {
        console.error('❌ Bị chặn bởi Google Safety Filter:', data.promptFeedback);
        console.log('🔍 Block reason:', data.promptFeedback.blockReason);
        console.log('🔍 Safety ratings:', data.promptFeedback.safetyRatings);
        throw new Error(`Gemini Safety Filter chặn nội dung: ${data.promptFeedback.blockReason}. Vui lòng kiểm tra file audio.`);
      }

      // Check for API errors in response
      if (data.error) {
        console.error('❌ Gemini API returned error:', data.error);
        throw new Error(data.error.message || 'Unknown Gemini API error');
      }
      
      // Check if candidates exist before parsing
      if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
        console.error('❌ No candidates in response. Full response:', JSON.stringify(data, null, 2));
        throw new Error('No transcription results from Gemini API. The response may have been blocked or empty.');
      }

      // 💾 Save debug log with request and response
      await this.saveGeminiDebugLog(requestBody, data, {
        type: 'audio',
        timestamp: new Date().toISOString(),
        error: data.error ? data.error.message : undefined
      }, fileManager);

      // Parse response (now returns { results, summary })
      const parsed = this.parseGeminiAudioTranscription(data, meetingStartTime);
      if (onProgress) onProgress(100, '✅ Hoàn thành!');

      return parsed;

    } catch (error: any) {
      console.error('❌ Gemini audio transcription error:', error);
      
      // Save error log
      try {
        await this.saveGeminiDebugLog(requestBody, null, {
          type: 'audio',
          timestamp: new Date().toISOString(),
          error: error.message
        }, fileManager);
      } catch (logError) {
        console.error('Failed to save error log:', logError);
      }
      
      // Don't nest "Failed to transcribe audio" messages
      if (error.message?.startsWith('Failed to transcribe audio:')) {
        throw error;
      }
      throw new Error(`Failed to transcribe audio: ${error.message}`);
    }
  }

  /**
   * Convert Blob to Base64 string
   */
  private static blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1]; // Remove data:audio/...;base64, prefix
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Get audio duration in seconds from Blob
   */
  private static async getAudioDuration(audioBlob: Blob): Promise<number> {
    return new Promise((resolve) => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          const duration = audioBuffer.duration; // in seconds
          await audioContext.close(); // Clean up
          resolve(duration);
        } catch (error) {
          // Fallback: estimate from file size (very rough)
          console.warn('Cannot decode audio for duration, estimating from size');
          const estimatedDuration = audioBlob.size / (16000 * 2); // Assume 16kHz mono 16-bit
          resolve(estimatedDuration);
        }
      };

      reader.onerror = () => {
        // Fallback
        const estimatedDuration = audioBlob.size / (16000 * 2);
        resolve(estimatedDuration);
      };
      
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  /**
   * Convert audio blob to WAV format with optional sample rate optimization
   * Gemini API officially supports WAV and MP3 only
   * @param targetSampleRate - Target sample rate (16000 for smaller files, 44100 for quality)
   */
  private static async convertToWav(audioBlob: Blob, targetSampleRate: number = 44100): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          // Resample if needed to reduce file size
          let finalBuffer = audioBuffer;
          if (audioBuffer.sampleRate !== targetSampleRate) {
            console.log(`🔊 Resampling: ${audioBuffer.sampleRate}Hz → ${targetSampleRate}Hz`);
            finalBuffer = await this.resampleAudioBuffer(audioBuffer, targetSampleRate);
          }

          // Convert to WAV
          const wavBlob = this.audioBufferToWav(finalBuffer);
          resolve(wavBlob);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = reject;
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  /**
   * Resample AudioBuffer to target sample rate (reduces file size)
   */
  private static async resampleAudioBuffer(audioBuffer: AudioBuffer, targetSampleRate: number): Promise<AudioBuffer> {
    const offlineContext = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      audioBuffer.duration * targetSampleRate,
      targetSampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start();

    return await offlineContext.startRendering();
  }

  /**
   * Convert AudioBuffer to WAV Blob
   */
  private static audioBufferToWav(audioBuffer: AudioBuffer): Blob {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numberOfChannels * bytesPerSample;

    const data = [];
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      data.push(audioBuffer.getChannelData(i));
    }

    const interleaved = this.interleave(data);
    const dataLength = interleaved.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    // Write WAV header
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // Write audio data
    this.floatTo16BitPCM(view, 44, interleaved);

    return new Blob([buffer], { type: 'audio/wav' });
  }

  /**
   * Interleave multiple audio channels
   */
  private static interleave(channelData: Float32Array[]): Float32Array {
    const length = channelData[0].length;
    const numberOfChannels = channelData.length;
    const result = new Float32Array(length * numberOfChannels);

    let offset = 0;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        result[offset++] = channelData[channel][i];
      }
    }

    return result;
  }
  /**
   * Split audio into chunks based on size AND duration limits
   * Each chunk must satisfy: size <= maxChunkSizeMB AND duration <= maxDurationMinutes
   * @param audioBlob - Audio blob to split (should be WAV format)
   * @param maxChunkSizeMB - Maximum size per chunk in MB (default: 20)
   * @param maxDurationMinutes - Maximum duration per chunk in minutes (default: 60)
   * @returns Array of chunks with blob, startTimeMs, endTimeMs
   */
  public static async splitAudioIntoChunks(
    audioBlob: Blob,
    maxChunkSizeMB: number = 20,
    maxDurationMinutes: number = 60
  ): Promise<{ blob: Blob; startTimeMs: number; endTimeMs: number }[]> {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          const totalDurationMs = audioBuffer.duration * 1000;
          const totalDurationMinutes = totalDurationMs / (60 * 1000);
          const totalSizeMB = audioBlob.size / (1024 * 1024);

          // Calculate number of chunks needed based on BOTH constraints
          // 1. Chunks needed based on size
          const chunksBySizeCount = Math.ceil(totalSizeMB / maxChunkSizeMB);
          
          // 2. Chunks needed based on duration
          const chunksByDurationCount = Math.ceil(totalDurationMinutes / maxDurationMinutes);
          
          // Take the MAXIMUM to satisfy BOTH constraints
          const numberOfChunks = Math.max(chunksBySizeCount, chunksByDurationCount);
          const chunkDurationMs = totalDurationMs / numberOfChunks;
          const chunkDurationMinutes = chunkDurationMs / (60 * 1000);

          console.log(`📏 Audio info: ${totalSizeMB.toFixed(2)}MB, ${totalDurationMinutes.toFixed(1)} minutes`);
          console.log(`📊 Constraints: maxSize=${maxChunkSizeMB}MB, maxDuration=${maxDurationMinutes} minutes`);
          console.log(`📦 Splitting into ${numberOfChunks} chunks (by size: ${chunksBySizeCount}, by duration: ${chunksByDurationCount})`);
          console.log(`⏱️ Each chunk: ~${chunkDurationMinutes.toFixed(1)} minutes, ~${(totalSizeMB / numberOfChunks).toFixed(2)}MB`);

          const chunks: { blob: Blob; startTimeMs: number; endTimeMs: number }[] = [];

          for (let i = 0; i < numberOfChunks; i++) {
            const startTimeMs = i * chunkDurationMs;
            const endTimeMs = Math.min((i + 1) * chunkDurationMs, totalDurationMs);

            console.log(`⏱️ Extracting chunk ${i + 1}/${numberOfChunks}: ${startTimeMs.toFixed(0)}ms - ${endTimeMs.toFixed(0)}ms`);

            const chunkBlob = await this.extractAudioSegment(audioBlob, startTimeMs, endTimeMs);

            chunks.push({
              blob: chunkBlob,
              startTimeMs,
              endTimeMs
            });
          }

          resolve(chunks);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = reject;
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  /**
   * Extract a segment from audio blob based on time range
   * @param audioBlob - Original audio blob
   * @param startTimeMs - Start time in milliseconds
   * @param endTimeMs - End time in milliseconds
   * @returns Promise<Blob> - Audio segment blob
   */
  public static async extractAudioSegment(
    audioBlob: Blob,
    startTimeMs: number,
    endTimeMs: number
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          // Calculate start and end in samples
          const startSample = Math.floor((startTimeMs / 1000) * audioBuffer.sampleRate);
          const endSample = Math.floor((endTimeMs / 1000) * audioBuffer.sampleRate);
          const segmentLength = endSample - startSample;

          // Create new buffer for the segment
          const segmentBuffer = audioContext.createBuffer(
            audioBuffer.numberOfChannels,
            segmentLength,
            audioBuffer.sampleRate
          );

          // Copy data for each channel
          for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
            const channelData = audioBuffer.getChannelData(channel);
            const segmentData = segmentBuffer.getChannelData(channel);
            for (let i = 0; i < segmentLength; i++) {
              segmentData[i] = channelData[startSample + i];
            }
          }

          // Convert to WAV
          const wavBlob = this.audioBufferToWav(segmentBuffer);
          resolve(wavBlob);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = reject;
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  /**
   * Process entire audio file by automatically splitting into chunks
   * Respects Gemini API limits: 15 req/min, 1500 req/day, configurable MB per file and duration
   * @param apiKey - Gemini API key
   * @param audioBlob - Original audio blob (can be > configurable limit)
   * @param modelName - Gemini model name
   * @param onProgress - Progress callback (progress: number, message: string)
   * @param maxFileSizeMB - Maximum file size in MB (from config, default: 20)
   * @param requestDelaySeconds - Delay between requests in seconds (from config, default: 5)
   * @param maxDurationMinutes - Maximum duration per chunk in minutes (from config, default: 60)
   * @returns Promise<TranscriptionResult[]> - All transcription results, sorted by timestamp
   */
  public static async transcribeEntireAudioWithGemini(
    apiKey: string,
    audioBlob: Blob,
    modelName: string,
    onProgress?: (progress: number, message?: string) => void,
    maxFileSizeMB: number = 20,
    requestDelaySeconds: number = 5,
    maxDurationMinutes: number = 60,
    meetingStartTime?: Date, // Meeting start time for accurate timestamp calculation
    summaryPrompt?: string, // OPTIONAL: user-provided prompt text for the summary field
    fileManager?: FileManagerService // Optional: for saving debug logs to project folder
  ): Promise<{ results: TranscriptionResult[], summary?: string }> {
    const maxSizeMB = maxFileSizeMB;

    // CRITICAL: Convert to WAV first if needed, THEN split based on size
    // Gemini API officially supports: WAV and MP3 only
    // All other formats (WebM, MP4, OGG, AAC, FLAC) must be converted to WAV
    if (onProgress) onProgress(3, 'Đang kiểm tra định dạng audio...');
    
    let wavBlob = audioBlob;
    const audioType = audioBlob.type.toLowerCase();
    const isWavOrMp3 = audioType.includes('wav') || audioType.includes('mpeg') || audioType.includes('mp3');
    const needsConversion = !isWavOrMp3;
    
    if (needsConversion) {
      if (onProgress) onProgress(5, `Đang chuyển đổi ${audioType} sang WAV...`);
      // Convert with lower sample rate for smaller file size
      const targetSampleRate = 16000; // Lower sample rate = smaller file
      wavBlob = await this.convertToWav(audioBlob, targetSampleRate);
      
      const originalSizeMB = audioBlob.size / (1024 * 1024);
      const wavSizeMB = wavBlob.size / (1024 * 1024);
      console.log(`✅ Converted ${audioType}: ${originalSizeMB.toFixed(2)}MB → ${wavSizeMB.toFixed(2)}MB (WAV)`);
    } else {
      console.log(`✅ Audio format ${audioType} is supported by Gemini (WAV/MP3) - no conversion needed`);
    }

    // Now split the WAV file into chunks based on actual WAV size AND duration
    if (onProgress) onProgress(8, 'Đang phân tích và chia file WAV...');
    const chunks = await this.splitAudioIntoChunks(wavBlob, maxSizeMB, maxDurationMinutes);

    if (onProgress) onProgress(10, `Đã chia thành ${chunks.length} phần. Bắt đầu chuyển đổi...`);

    const allResults: TranscriptionResult[] = [];
    const allSummaries: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkProgress = 10 + ((i / chunks.length) * 80);

      if (onProgress) {
        onProgress(
          chunkProgress,
          `Đang xử lý phần ${i + 1}/${chunks.length}...`
        );
      }

      try {
        // Transcribe this chunk (skip size check - already validated and split)
        const parsed = await this.transcribeAudioWithGemini(
          apiKey,
          chunk.blob,
          modelName,
          (subProgress) => {
            if (onProgress) {
              const totalProgress = chunkProgress + (subProgress / chunks.length) * 0.8;
              onProgress(totalProgress, `Phần ${i + 1}/${chunks.length}: ${subProgress.toFixed(0)}%`);
            }
          },
          true, // skipSizeCheck = true (chunks already validated)
          maxSizeMB, // Pass maxFileSizeMB to child call
          meetingStartTime, // Pass meeting start time for accurate timestamps
          summaryPrompt, // Pass user-provided summary prompt through
          fileManager // Pass fileManager for debug logs
        );

        // Adjust timestamps for this chunk
        const adjustedResults = this.adjustTimestamps(parsed.results, chunk.startTimeMs);
        allResults.push(...adjustedResults);
        
        // Collect summary from this chunk
        if (parsed.summary) {
          allSummaries.push(`Phần ${i + 1}/${chunks.length}: ${parsed.summary}`);
        }

        // Add delay between chunks to respect rate limits (15 req/min)
        if (i < chunks.length - 1) {
          if (onProgress) {
            onProgress(
              chunkProgress + 5,
              `Đợi ${requestDelaySeconds}s trước khi xử lý phần tiếp theo...`
            );
          }
          await new Promise(resolve => setTimeout(resolve, requestDelaySeconds * 1000));
        }
      } catch (error: any) {
        // Handle quota errors
        if (error.message.includes('429') || error.message.includes('quota')) {
          throw new Error(
            `Vượt hạn mức API tại phần ${i + 1}/${chunks.length}.\n\n` +
            `✅ Đã xử lý: ${i}/${chunks.length} phần\n` +
            `❌ Lỗi: ${error.message}\n\n` +
            `💡 Đợi 24 giờ hoặc nâng cấp Paid tier.`
          );
        }
        throw error;
      }
    }

    // Sort by timestamp
    allResults.sort((a, b) => (a.audioTimeMs || 0) - (b.audioTimeMs || 0));

    if (onProgress) onProgress(100, `Hoàn thành! ${allResults.length} segments`);

    console.log(`✅ Transcribed entire audio: ${allResults.length} segments from ${chunks.length} chunks`);
    
    // Combine all summaries into one
    const combinedSummary = allSummaries.length > 0 
      ? allSummaries.join('\n\n') 
      : undefined;
    
    return { results: allResults, summary: combinedSummary };
  }

  /**
   * Adjust timestamps in transcription results based on segment start time
   * @param results - Transcription results from segment
   * @param offsetMs - Offset in milliseconds (segment start time)
   * @returns Adjusted transcription results
   */
  public static adjustTimestamps(
    results: TranscriptionResult[],
    offsetMs: number
  ): TranscriptionResult[] {
    return results.map(result => ({
      ...result,
      audioTimeMs: result.audioTimeMs ? result.audioTimeMs + offsetMs : undefined
    }));
  }

  /*
   * FUTURE ENHANCEMENT: optimizeAudioFormat() method
   * Could convert WAV to WebM/Opus to reduce file size by 70-90%
   * Reserved for future implementation
   */
  /**
   * Write string to DataView
   */
  private static writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * Convert Float32 samples to 16-bit PCM
   */
  private static floatTo16BitPCM(view: DataView, offset: number, input: Float32Array): void {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }

  /**
   * Parse Gemini audio transcription response
   */
  private static parseGeminiAudioTranscription(apiResponse: any, meetingStartTime?: Date): { results: TranscriptionResult[], summary?: string } {
    try {
      // Debug log full API response structure
      console.log('🔍 Full Gemini API response:', JSON.stringify(apiResponse, null, 2));
      
      const candidates = apiResponse?.candidates;
      if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        console.error('❌ No candidates in response:', apiResponse);
        throw new Error('No response from Gemini API');
      }

      const content = candidates[0]?.content;
      if (!content || !content.parts || !Array.isArray(content.parts) || content.parts.length === 0) {
        console.error('❌ No content/parts in first candidate:', candidates[0]);
        throw new Error('Empty response from Gemini');
      }

      const textResponse = content.parts[0].text;
      if (!textResponse) {
        throw new Error('No text in Gemini response');
      }

      // Debug logging
      console.log('🔍 Raw Gemini response text:', textResponse);
      console.log('🔍 Response length:', textResponse.length, 'characters');

      // Extract JSON from response (handle markdown code blocks)
      let jsonText = textResponse.trim();
      const jsonMatch = jsonText.match(/```json\s*([\s\S]*?)```/) || jsonText.match(/```\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
        console.log('✂️ Extracted JSON from markdown code block');
      }

      // Clean control characters ONLY (keep valid JSON whitespace)
      // Remove only control characters that are invalid in JSON (0x00-0x1F except \t, \n, \r)
      jsonText = jsonText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

      console.log('🧹 Cleaned JSON length:', jsonText.length, 'characters');
      console.log('📄 JSON to parse (first 500):', jsonText.substring(0, 500) + '...');

      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch (parseError: any) {
        console.error('❌ JSON parse error:', parseError.message);
        console.log('📋 Problematic JSON (around error position):');
        
        // Try to extract position info
        const posMatch = parseError.message.match(/position (\d+)/);
        let errorPosition = -1;
        if (posMatch) {
          errorPosition = parseInt(posMatch[1]);
          const start = Math.max(0, errorPosition - 100);
          const end = Math.min(jsonText.length, errorPosition + 100);
          console.log(jsonText.substring(start, end));
          console.log(' '.repeat(100) + '^--- Error here');
        }
        
        // Try progressive parsing: parse valid parts and mark error parts
        console.log('🔄 Attempting progressive segment extraction...');
        const segments = this.extractSegmentsWithErrorHandling(jsonText, errorPosition);
        
        if (segments && segments.length > 0) {
          console.log(`✅ Extracted ${segments.length} segments (including error markers)`);
          parsed = { segments };
        } else {
          throw parseError;
        }
      }

      if (!parsed.segments || !Array.isArray(parsed.segments)) {
        console.error('❌ Invalid structure:', parsed);
        throw new Error('Invalid JSON structure: missing segments array');
      }

      console.log(`✅ Parsed ${parsed.segments.length} segments from Gemini`);
      
      // Extract summary if available
      const summary = parsed.summary || undefined;
      if (summary) {
        console.log('📋 Summary extracted successfully');
        console.log('📋 Summary length:', summary.length, 'characters');
        console.log('📋 Summary preview:', summary.substring(0, 200) + (summary.length > 200 ? '...' : ''));
      } else {
        console.warn('⚠️ No summary found in Gemini response');
        console.log('📋 Response structure:', Object.keys(parsed));
      }
      
      // Log first few segments for debugging
      if (parsed.segments.length > 0) {
        console.log('📝 First segment:', parsed.segments[0]);
        if (parsed.segments.length > 1) {
          console.log('📝 Second segment:', parsed.segments[1]);
        }
      }

      // Convert to TranscriptionResult format
      const results = parsed.segments.map((segment: any, index: number) => {
        const timestamp = segment.timestamp || '0:00';
        const audioTimeMs = this.parseTimestampToMs(timestamp);

        // Calculate actual time based on meeting start time + audio offset
        let startTime: string;
        let endTime: string;
        
        if (meetingStartTime && !isNaN(meetingStartTime.getTime())) {
          // Use meeting start time as base + audio offset
          const actualTime = new Date(meetingStartTime.getTime() + audioTimeMs);
          startTime = actualTime.toISOString();
          endTime = actualTime.toISOString(); // Same as start since we don't have duration
          
          // Debug log for first segment
          if (index === 0) {
            console.log('🕐 Meeting start time:', meetingStartTime.toISOString());
            console.log('🕐 Audio offset:', audioTimeMs, 'ms');
            console.log('🕐 Calculated time:', actualTime.toISOString());
          }
        } else {
          // Fallback: use current time if meeting start time not provided or invalid
          if (index === 0) {
            console.warn('⚠️ Invalid or missing meeting start time, using current time as fallback');
            console.log('meetingStartTime:', meetingStartTime);
          }
          const now = new Date();
          startTime = now.toISOString();
          endTime = now.toISOString();
        }
        
        return {
          id: `gemini-${Date.now()}-${index}`,
          text: segment.text || '',
          startTime,
          endTime,
          audioTimeMs, // This is the relative position in audio file (mm:ss)
          confidence: 1.0,
          speaker: segment.speaker || 'Unknown',
          isFinal: true,
          isManuallyEdited: false,
          isAIRefined: true
        };
      });
      
      return { results, summary };

    } catch (error: any) {
      console.error('❌ Failed to parse Gemini audio transcription:', error);
      console.log('📋 Raw API response:', JSON.stringify(apiResponse, null, 2));
      throw new Error(`Failed to parse Gemini response: ${error.message}`);
    }
  }

  /**
   * Parse timestamp string (h:mm:ss, mm:ss, or m:ss) to milliseconds
   * Supports: "0:30" (30s), "5:45" (5m45s), "1:23:45" (1h23m45s)
   */
  private static parseTimestampToMs(timestamp: string): number {
    try {
      const parts = timestamp.split(':').map(p => parseInt(p.trim(), 10));
      
      if (parts.length === 3) {
        // h:mm:ss format
        const [hours, minutes, seconds] = parts;
        return (hours * 3600 + minutes * 60 + seconds) * 1000;
      } else if (parts.length === 2) {
        // mm:ss format
        const [minutes, seconds] = parts;
        return (minutes * 60 + seconds) * 1000;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Fallback: Extract segments manually from malformed JSON using regex
   */
  private static extractSegmentsManually(text: string): any[] {
    const segments: any[] = [];
    
    // Pattern to match segment objects
    // Looks for: "timestamp": "...", "speaker": "...", "text": "..."
    const segmentPattern = /"timestamp"\s*:\s*"([^"]+)"\s*,\s*"speaker"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"([^"]+)"/g;
    
    let match;
    while ((match = segmentPattern.exec(text)) !== null) {
      segments.push({
        timestamp: match[1],
        speaker: match[2],
        text: match[3]
      });
    }
    
    // Alternative pattern: handle different field orders
    if (segments.length === 0) {
      const altPattern = /"speaker"\s*:\s*"([^"]+)"\s*,\s*"timestamp"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"([^"]+)"/g;
      while ((match = altPattern.exec(text)) !== null) {
        segments.push({
          timestamp: match[2],
          speaker: match[1],
          text: match[3]
        });
      }
    }
    
    return segments;
  }

  /**
   * Progressive segment extraction with error handling
   * Parse valid parts, mark error parts, continue to end
   */
  private static extractSegmentsWithErrorHandling(text: string, _errorPosition: number): any[] {
    const segments: any[] = [];
    
    // Strategy: Split by segment boundaries and parse each independently
    // Look for segment patterns: { "timestamp": "...", "speaker": "...", "text": "..." }
    
    // Find all potential segment boundaries
    const segmentBoundaries: number[] = [];
    const boundaryPattern = /\{\s*"(timestamp|speaker)"/g;
    let match;
    
    while ((match = boundaryPattern.exec(text)) !== null) {
      segmentBoundaries.push(match.index);
    }
    
    console.log(`📍 Found ${segmentBoundaries.length} potential segment boundaries`);
    
    // Parse each segment independently
    for (let i = 0; i < segmentBoundaries.length; i++) {
      const start = segmentBoundaries[i];
      const end = i < segmentBoundaries.length - 1 ? segmentBoundaries[i + 1] : text.length;
      const segmentText = text.substring(start, end).trim();
      
      // Remove trailing comma and closing braces if present
      let cleanSegmentText = segmentText.replace(/[,\s]*$/, '');
      if (!cleanSegmentText.endsWith('}')) {
        cleanSegmentText += '}';
      }
      
      try {
        // Try to parse this segment as valid JSON
        const segment = JSON.parse(cleanSegmentText);
        
        if (segment.timestamp || segment.speaker || segment.text) {
          segments.push({
            timestamp: segment.timestamp || '0:00',
            speaker: segment.speaker || 'Unknown',
            text: segment.text || ''
          });
        }
      } catch (segmentError) {
        // This segment is corrupted, extract what we can with regex
        const tsMatch = segmentText.match(/"timestamp"\s*:\s*"([^"]+)"/);
        const spMatch = segmentText.match(/"speaker"\s*:\s*"([^"]+)"/);
        const txtMatch = segmentText.match(/"text"\s*:\s*"([^"]*?)"/);
        
        if (tsMatch || spMatch || txtMatch) {
          // Partial data recovered
          segments.push({
            timestamp: tsMatch ? tsMatch[1] : '0:00',
            speaker: spMatch ? spMatch[1] : '❌ LỖI',
            text: txtMatch ? txtMatch[1] : `[Lỗi parse tại vị trí ${start}]`
          });
          console.log(`⚠️ Partial recovery at position ${start}`);
        } else {
          // Completely corrupted segment
          segments.push({
            timestamp: '0:00',
            speaker: '❌ LỖI',
            text: `[Đoạn bị lỗi không thể phục hồi - vị trí ${start}-${end}]`
          });
          console.log(`❌ Failed segment at position ${start}-${end}`);
        }
      }
    }
    
    // If no segments found via boundary method, try full regex extraction
    if (segments.length === 0) {
      console.log('🔄 Falling back to full regex extraction...');
      return this.extractSegmentsManually(text);
    }
    
    return segments;
  }
}
