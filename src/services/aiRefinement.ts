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

interface UploadedFileInfo {
  uri: string;
  mimeType: string;
  state: string;
  name: string;
}

/**
 * 💾 Cache information for uploaded audio files
 * Files are valid for 48 hours on Gemini servers
 * ⚠️ IMPORTANT: File URI only works with the same API Key that uploaded it
 */
interface AudioFileCacheInfo {
  fileUri: string;
  fileName: string;
  mimeType: string;
  uploadedAt: number; // Timestamp
  expiresAt: number; // Timestamp (uploadedAt + 48h)
  audioHash: string; // Simple hash to identify same audio
  apiKeyHash: string; // Hash of API Key (for validation)
  durationSeconds: number;
  fileSizeBytes: number;
}

/**
 * AI Refinement Service for Gemini AI
 * Refines raw speech-to-text transcripts with AI
 */
export class AIRefinementService {
  private static readonly GEMINI_MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
  private static readonly CACHE_KEY_PREFIX = 'gemini_audio_cache_';
  private static readonly GEMINI_API_VERSION = 'v1beta'; // Use v1beta as it's more stable

  // Gemini Free Tier Limits (per day)
  // ✅ SMART CACHING STRATEGY: File API reduces input tokens by 99.6%
  // - Without caching: 139-min audio = 266K input + 8K output = 274K tokens (FAILS)
  // - With caching: 139-min audio = 1K input × 6 queries + 8K output × 6 = 54K tokens (SUCCESS)
  private static readonly FREE_TIER_LIMITS = {
    RPM: 15,           // Requests per minute (6 time-range queries OK)
    TPM: 1000000,      // Tokens per minute (1M) - File API saves 99.6% input tokens
    RPD: 1500,         // Requests per day
    TPD: 250000,       // Tokens per day (250K)
    
    // Smart Caching reduces token usage dramatically:
    // - Base64: ~266K input tokens for 139-min audio
    // - File API: ~1K input tokens per query (cached file reference)
    // - Recommended: Use transcribeAudioWithCaching() for audio > 60 minutes
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
   * 🌍 Map language code to readable language name
   * @param languageCode - Language code (e.g., 'vi-VN', 'en-US', 'ja-JP')
   * @returns Language name for prompt instruction
   */
  private static getLanguageName(languageCode?: string): string | null {
    if (!languageCode) return null;
    
    const languageMap: Record<string, string> = {
      'vi': 'Tiếng Việt',
      'vi-VN': 'Tiếng Việt',
      'en': 'English',
      'en-US': 'English',
      'en-GB': 'English',
      'ja': '日本語 (Japanese)',
      'ja-JP': '日本語 (Japanese)',
      'ko': '한국어 (Korean)',
      'ko-KR': '한국어 (Korean)',
      'zh': '中文 (Chinese)',
      'zh-CN': '中文 (Chinese)',
      'zh-TW': '中文 (Chinese)',
      'th': 'ภาษาไทย (Thai)',
      'th-TH': 'ภาษาไทย (Thai)',
      'fr': 'Français (French)',
      'fr-FR': 'Français (French)',
      'de': 'Deutsch (German)',
      'de-DE': 'Deutsch (German)',
      'es': 'Español (Spanish)',
      'es-ES': 'Español (Spanish)',
      'pt': 'Português (Portuguese)',
      'pt-BR': 'Português (Portuguese)',
      'ru': 'Русский (Russian)',
      'ru-RU': 'Русский (Russian)',
      'ar': 'العربية (Arabic)',
      'ar-SA': 'العربية (Arabic)',
      'hi': 'हिन्दी (Hindi)',
      'hi-IN': 'हिन्दी (Hindi)'
    };
    
    // Try exact match first, then prefix match
    const exactMatch = languageMap[languageCode];
    if (exactMatch) return exactMatch;
    
    const prefix = languageCode.split('-')[0];
    return languageMap[prefix] || null;
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
   * 🔑 Generate hash for API Key
   * Used to validate cache can only be used with same API Key
   */
  private static hashApiKey(apiKey: string): string {
    // Simple hash: last 8 chars + length
    const suffix = apiKey.slice(-8);
    return `${apiKey.length}_${suffix}`;
  }

  /**
   * � Generate simple hash for audio blob
   * Used to identify same audio file for caching
   */
  private static async generateAudioHash(audioBlob: Blob): Promise<string> {
    // Simple hash based on size, type, and first/last bytes
    const size = audioBlob.size;
    const type = audioBlob.type;
    
    // Read first and last 1KB for hash
    const firstChunk = audioBlob.slice(0, 1024);
    const lastChunk = audioBlob.slice(-1024);
    
    const firstBuffer = await firstChunk.arrayBuffer();
    const lastBuffer = await lastChunk.arrayBuffer();
    
    // Simple hash: size + type + first/last bytes checksum
    const firstBytes = new Uint8Array(firstBuffer);
    const lastBytes = new Uint8Array(lastBuffer);
    
    let checksum = 0;
    for (let i = 0; i < Math.min(100, firstBytes.length); i++) {
      checksum += firstBytes[i];
    }
    for (let i = 0; i < Math.min(100, lastBytes.length); i++) {
      checksum += lastBytes[i];
    }
    
    return `${size}_${type}_${checksum}`;
  }

  /**
   * 💾 Save audio file cache info to localStorage
   */
  private static saveAudioCache(cacheInfo: AudioFileCacheInfo): void {
    try {
      const cacheKey = this.CACHE_KEY_PREFIX + cacheInfo.audioHash;
      localStorage.setItem(cacheKey, JSON.stringify(cacheInfo));
      console.log(`💾 Saved cache: ${cacheKey}`);
      console.log(`   File URI: ${cacheInfo.fileUri}`);
      console.log(`   Expires at: ${new Date(cacheInfo.expiresAt).toISOString()}`);
    } catch (error) {
      console.warn('Failed to save audio cache:', error);
    }
  }

  /**
   * 📂 Load audio file cache info from localStorage
   * ⚠️ Validates API Key hash to ensure file can be accessed
   */
  private static loadAudioCache(audioHash: string, apiKey: string): AudioFileCacheInfo | null {
    try {
      const cacheKey = this.CACHE_KEY_PREFIX + audioHash;
      const cached = localStorage.getItem(cacheKey);
      
      if (!cached) {
        console.log(`📂 No cache found for: ${audioHash}`);
        return null;
      }
      
      const cacheInfo: AudioFileCacheInfo = JSON.parse(cached);
      
      // Check API Key hash match
      const currentApiKeyHash = this.hashApiKey(apiKey);
      if (cacheInfo.apiKeyHash && cacheInfo.apiKeyHash !== currentApiKeyHash) {
        console.log(`⚠️ API Key changed, cache invalid for: ${audioHash}`);
        console.log(`   Cached with: ${cacheInfo.apiKeyHash}, Current: ${currentApiKeyHash}`);
        localStorage.removeItem(cacheKey);
        return null;
      }
      
      // Check if expired (48h + 1h buffer)
      const now = Date.now();
      if (now > cacheInfo.expiresAt) {
        console.log(`⏰ Cache expired for: ${audioHash}`);
        localStorage.removeItem(cacheKey);
        return null;
      }
      
      console.log(`✅ Found valid cache for: ${audioHash}`);
      console.log(`   File URI: ${cacheInfo.fileUri}`);
      console.log(`   Expires in: ${Math.round((cacheInfo.expiresAt - now) / 1000 / 60 / 60)}h`);
      
      return cacheInfo;
    } catch (error) {
      console.warn('Failed to load audio cache:', error);
      return null;
    }
  }

  /**
   * ✅ Check if cached file is still valid on Gemini servers
   */
  private static async checkCachedFileValid(
    apiKey: string,
    fileName: string
  ): Promise<boolean> {
    try {
      const getFileEndpoint = `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`;
      const response = await fetch(getFileEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        console.log(`❌ Cached file not found: ${fileName}`);
        return false;
      }

      const file = await response.json();
      
      if (file.state === 'ACTIVE') {
        console.log(`✅ Cached file still valid: ${fileName}`);
        return true;
      } else {
        console.log(`⚠️ Cached file state: ${file.state}`);
        return false;
      }
    } catch (error) {
      console.warn('Failed to check cached file:', error);
      return false;
    }
  }

  /**
   * �🚀 Upload audio file to Gemini File API
   * This saves MASSIVE input tokens compared to base64 inline data
   * 
   * @param apiKey - Gemini API key
   * @param audioBlob - Audio file to upload
   * @param displayName - Display name for the file
   * @param onProgress - Progress callback
   * @returns UploadedFileInfo with uri, mimeType, state, name
   */
  public static async uploadAudioToGemini(
    apiKey: string,
    audioBlob: Blob,
    displayName: string,
    onProgress?: (progress: number, message?: string) => void
  ): Promise<UploadedFileInfo> {
    try {
      console.log(`📤 Uploading audio to Gemini File API: ${displayName}`);
      if (onProgress) onProgress(5, '📤 Đang tải file lên Gemini...');

      // 🌐 Browser-compatible upload using REST API directly
      // GoogleAIFileManager is Node.js only, so we use fetch API instead
      
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Create File object for upload
      const file = new File([uint8Array], displayName, { 
        type: audioBlob.type || 'audio/wav' 
      });
      
      // Metadata for the file
      const metadata = {
        file: {
          displayName: displayName
        }
      };
      
      // Create multipart form data
      const formData = new FormData();
      const metadataBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
      formData.append('metadata', metadataBlob);
      formData.append('file', file);
      
      // Upload using Gemini REST API
      const uploadEndpoint = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
      
      const uploadResponse = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'multipart',
          'X-Goog-Upload-Command': 'upload, finalize',
        },
        body: formData
      });

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json().catch(() => ({}));
        throw new Error(`Upload failed (${uploadResponse.status}): ${errorData.error?.message || uploadResponse.statusText}`);
      }

      const uploadResult = await uploadResponse.json();
      const fileName = uploadResult.file.name;
      
      console.log(`✅ File uploaded: ${fileName}`);
      console.log(`   URI: ${uploadResult.file.uri}`);
      console.log(`   State: ${uploadResult.file.state}`);
      
      if (onProgress) onProgress(10, '⏳ Đang xử lý file trên server...');

      // Wait for file to be ACTIVE (processing may take time for large files)
      const activeFile = await this.waitForFileActive(apiKey, fileName, onProgress);

      return {
        uri: activeFile.uri,
        mimeType: activeFile.mimeType,
        state: activeFile.state,
        name: activeFile.name
      };

    } catch (error: any) {
      console.error('❌ Failed to upload audio to Gemini:', error);
      throw new Error(`Upload failed: ${error.message}`);
    }
  }

  /**
   * ⏳ Wait for uploaded file to be in ACTIVE state
   * Uses polling with exponential backoff
   * 
   * @param apiKey - Gemini API key
   * @param fileName - File name returned from upload (e.g., "files/abc123")
   * @param onProgress - Progress callback
   * @returns File info when state is ACTIVE
   */
  private static async waitForFileActive(
    apiKey: string,
    fileName: string,
    onProgress?: (progress: number, message?: string) => void
  ): Promise<any> {
    const maxAttempts = 30; // Max 30 attempts
    const baseDelay = 2000; // Start with 2 seconds
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Get file status using REST API
        const getFileEndpoint = `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`;
        const response = await fetch(getFileEndpoint, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to get file status (${response.status})`);
        }

        const file = await response.json();
        
        console.log(`📋 File state check (${attempt}/${maxAttempts}): ${file.state}`);
        
        if (file.state === 'ACTIVE') {
          console.log(`✅ File is ACTIVE and ready: ${fileName}`);
          if (onProgress) onProgress(15, '✅ File đã sẵn sàng');
          return file;
        }
        
        if (file.state === 'FAILED') {
          throw new Error(`File processing failed: ${fileName}`);
        }
        
        // File is still PROCESSING - wait and retry
        const delay = Math.min(baseDelay * Math.pow(1.5, attempt - 1), 10000); // Max 10s
        console.log(`⏳ File still processing, waiting ${delay}ms...`);
        
        if (onProgress) {
          const progressPercent = 10 + (attempt / maxAttempts) * 5; // 10-15%
          onProgress(progressPercent, `⏳ Đang xử lý file (${attempt}/${maxAttempts})...`);
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
        
      } catch (error: any) {
        console.error(`Error checking file state (attempt ${attempt}):`, error);
        
        // Retry with exponential backoff for transient errors
        if (attempt < maxAttempts) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }
    
    throw new Error(`Timeout waiting for file to be ready: ${fileName}`);
  }

  /**
   * 🔄 Make API call with exponential backoff retry for 429/503 errors
   * Handles rate limiting and server overload gracefully
   * 
   * @param url - API endpoint URL
   * @param options - Fetch options
   * @param maxRetries - Maximum retry attempts (default: 3)
   * @returns Response
   */
  private static async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number = 3
  ): Promise<Response> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);
        
        // Success - return response
        if (response.ok) {
          return response;
        }
        
        // Rate limit or server error - retry with backoff
        if (response.status === 429 || response.status === 503) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.error?.message || response.statusText;
          
          console.warn(`⚠️ ${response.status} error (attempt ${attempt}/${maxRetries}): ${errorMsg}`);
          
          if (attempt < maxRetries) {
            // Exponential backoff: 5s, 10s, 20s
            const delay = 5000 * Math.pow(2, attempt - 1);
            console.log(`⏳ Retrying in ${delay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          
          // Max retries exceeded
          throw new Error(`${response.status} error after ${maxRetries} retries: ${errorMsg}`);
        }
        
        // Other errors - don't retry
        return response;
        
      } catch (error: any) {
        lastError = error;
        
        // Network errors - retry
        if (attempt < maxRetries && error.message?.includes('fetch')) {
          const delay = 3000 * attempt;
          console.warn(`⚠️ Network error (attempt ${attempt}/${maxRetries}), retrying in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError || new Error('Request failed after retries');
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
  ): Promise<{ segments: RefinedSegment[], summary?: string, isTruncated?: boolean, truncationWarning?: string }> {
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
  ): Promise<{ segments: RefinedSegment[], summary?: string, isTruncated?: boolean, truncationWarning?: string }> {
    const batches = this.splitIntoBatches(transcriptions, this.BATCH_SIZE);
    const allRefinedSegments: RefinedSegment[] = [];
    const allSummaries: string[] = [];
    let hasTruncation = false;
    const truncationWarnings: string[] = [];

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
        
        // Track truncation
        if (batchResult.isTruncated) {
          hasTruncation = true;
          if (batchResult.truncationWarning) {
            truncationWarnings.push(`Batch ${i + 1}/${batches.length}: ${batchResult.truncationWarning}`);
          }
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
    
    // Build final truncation warning if any batch was truncated
    let finalTruncationWarning: string | undefined = undefined;
    if (hasTruncation && truncationWarnings.length > 0) {
      finalTruncationWarning = `⚠️ Một số batch bị truncated:\n${truncationWarnings.join('\n')}`;
      console.warn(finalTruncationWarning);
    }
    
    return { segments: allRefinedSegments, summary: combinedSummary, isTruncated: hasTruncation, truncationWarning: finalTruncationWarning };
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
  ): Promise<{ segments: RefinedSegment[], summary?: string, isTruncated?: boolean, truncationWarning?: string }> {
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
          temperature: 0.1, // Lowered from 0.2 for better consistency and rule-following
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json' // Ensure valid JSON output structure
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

      // Parse AI response (now returns { segments, summary, isTruncated, truncationWarning })
      const parsed = this.parseAIResponse(result);

      if (onProgress) onProgress(100);

      console.log(`✅ Successfully refined ${parsed.segments.length} segments`);
      if (parsed.summary) {
        console.log(`📝 Summary generated (${parsed.summary.length} characters)`);
      }
      
      // Log warning if truncated
      if (parsed.isTruncated && parsed.truncationWarning) {
        console.warn(parsed.truncationWarning);
        if (onProgress) {
          onProgress(100, `⚠️ ${parsed.truncationWarning}`);
        }
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
    const segmentCount = transcriptData.length;

    // OPTIMIZED: Shortened prompt to reduce token count while maintaining quality
    return `Vai trò: Thư ký chuyên nghiệp soạn biên bản họp.

Nhiệm vụ: Chuẩn hóa văn bản speech-to-text:
1. Sửa lỗi nhận diện từ
2. Xóa từ đệm (à, ừm, thì, là, mà)
3. Thêm dấu câu, viết hoa danh từ riêng
4. Giữ nguyên nội dung, không thêm bớt ý
5. Tóm tắt toàn bộ nội dung cuộc họp dựa trên các segment

📊 NGÂN SÁCH TOKEN (OUTPUT BUDGET):
Bạn có tối đa ~8000 tokens cho output. Hiện có ${segmentCount} segments cần xử lý.

🎯 CHIẾN LƯỢC 2 BƯỚC - ƯU TIÊN SUMMARY:

📝 BƯỚC 1 - BẮT BUỘC HOÀN THÀNH TRƯỚC:
   • Tạo "summary" HOÀN CHỈNH (~300-400 từ)
   • Bao gồm: Chủ đề chính, quyết định, kết luận
   • GIỮ LẠI: Tên riêng, số liệu, deadline, Action Items
   • ƯỚC TÍNH: Summary tốn ~500-800 tokens

🔢 BƯỚC 2 - XỬ LÝ SEGMENTS (nếu còn token):
   • NẾU ÍT SEGMENTS (<30): Chuẩn hóa CHI TIẾT từng câu
   • NẾU VỪA (30-100): GỘP các câu liên quan, cô đọng nhẹ
   • NẾU NHIỀU (>100): GỘP MẠNH, chỉ giữ ý chính
   
⚠️ QUY TẮC TỰ ĐỘNG DỪNG (AUTO-STOP):
   • THEO DÕI token usage khi xử lý segments
   • NẾU ước tính đã dùng ~6000 tokens (75% budget):
     → DỪNG NGAY việc thêm segments
     → ĐÓNG JSON đúng cú pháp: }] }
     → KHÔNG cần xử lý hết segments
   • TỐT HƠN: Summary đầy đủ + Segments một phần
   • TỆ HƠN: JSON bị cắt ngang không hợp lệ

💡 CHIẾN THUẬT THÔNG MINH:
   • Nếu có >50 segments: Chỉ xử lý 20-30 segments ĐẦU TIÊN đại diện
   • Nếu có >100 segments: Chỉ xử lý 10-15 segments QUAN TRỌNG NHẤT
   • Ưu tiên segments có số liệu, quyết định, kết luận

⚠️ QUAN TRỌNG - THỨ TỰ OUTPUT:
- Trả về "summary" TRƯỚC (đầy đủ, hoàn chỉnh)
- Sau đó "segments" (có thể chỉ một phần nếu hết token)

Output: CHỈ JSON object, KHÔNG markdown/giải thích
Format: {
  "summary": "Tóm tắt nội dung cuộc họp dạng văn xuôi, bao gồm các chủ đề chính, quyết định quan trọng, kết luận.",
  "segments": [{"timestamp":"...","audioTimeMs":123,"text":"..."},...]
}

=== DỮ LIỆU CHÍNH (${segmentCount} segments) ===
${dataJson}
${hasRawData ? `\n=== DỮ LIỆU BỔ TRỢ (tham khảo) ===\n${rawDataJson}` : ''}

Giữ timestamp/audioTimeMs gốc. Trả về JSON object với summary TRƯỚC, rồi segments sau. HÃY TỰ CÂN ĐỐI ĐỘ CHI TIẾT để đảm bảo JSON hoàn chỉnh!`;
  }

  /**
   * Parse AI response and create refined segments with summary
   */
  private static parseAIResponse(apiResponse: any): { segments: RefinedSegment[], summary?: string, isTruncated?: boolean, truncationWarning?: string } {
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

      // Check for truncation via finishReason
      const finishReason = candidates[0].finishReason;
      const isTruncated = finishReason === 'MAX_TOKENS' || finishReason === 'STOP' && content.parts[0].text.includes('...');
      
      if (isTruncated || finishReason === 'MAX_TOKENS') {
        console.warn('⚠️ Response truncated due to MAX_TOKENS:', finishReason);
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

      // Build truncation warning if detected
      let truncationWarning: string | undefined = undefined;
      if (isTruncated) {
        // Check if summary might be truncated (incomplete sentence)
        const summaryTruncated = summary && (
          !summary.endsWith('.') && 
          !summary.endsWith('!') && 
          !summary.endsWith('?') &&
          !summary.endsWith('。') // Vietnamese period
        );
        
        if (summaryTruncated) {
          truncationWarning = `⚠️ Kết quả bị cắt ngắn do vượt giới hạn MAX_TOKENS.\n` +
            `• Summary: Có thể chưa đầy đủ (câu cuối chưa kết thúc)\n` +
            `• Segments: Đã nhận được ${segments.length} segments (có thể thiếu)\n\n` +
            `💡 Giải pháp: Chia nhỏ dữ liệu đầu vào hoặc tăng maxOutputTokens trong cấu hình.`;
        } else {
          truncationWarning = `⚠️ Kết quả có thể bị cắt ngắn do vượt giới hạn MAX_TOKENS. ` +
            `Đã nhận được ${segments.length} segments. ` +
            `Nếu cần đầy đủ hơn, vui lòng chia nhỏ file hoặc sử dụng batch processing.`;
        }
        console.warn(truncationWarning);
      }

      return { segments, summary, isTruncated, truncationWarning };

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
  ): Promise<{ results: TranscriptionResult[], summary?: string, isTruncated?: boolean, truncationWarning?: string }> {
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
        
        // ✨ Convert to MP3 with 16kHz to reduce file size dramatically
        // 16kHz is optimal for speech recognition (telephony quality)
        // MP3 compression reduces size by ~80% → optimal bandwidth usage
        processedAudio = await this.convertToMp3(audioBlob, 16000);
        
        const newSizeMB = processedAudio.size / (1024 * 1024);
        const reduction = ((1 - newSizeMB / originalSizeMB) * 100).toFixed(1);
        console.log(`✅ Converted to MP3: ${originalSizeMB.toFixed(2)}MB → ${newSizeMB.toFixed(2)}MB (${reduction}% reduction)`);
        
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

      // ⚠️ CẢNH BÁO: Audio dài có rủi ro cao bị cắt ngang
      if (durationMinutes > 60) {
        console.warn(`⚠️ CẢNH BÁO: Audio quá dài (${durationMinutes} phút > 60 phút)`);
        console.warn('   Rủi ro: Có thể bị lỗi chuyển đổi do vượt giới hạn token');
        console.warn('   Khuyến nghị: Sử dụng tính năng "Tự động chia nhỏ và xử lý" để đảm bảo kết quả tốt nhất');
        
        if (onProgress) {
          onProgress(35, `⚠️ Audio dài ${durationMinutes} phút - Có thể mất thời gian và rủi ro lỗi`);
        }
      }

      // Get MIME type (use WAV if converted)
      const mimeType = processedAudio.type || 'audio/wav';

      // 🚀 UPLOAD TO GEMINI FILE API (tiết kiệm input tokens)
      // Instead of sending base64 inline, upload file and use fileUri
      if (onProgress) onProgress(20, '📤 Đang tải file lên Gemini...');
      
      const displayName = `audio_${Date.now()}.${mimeType.split('/')[1] || 'wav'}`;
      const uploadedFile = await this.uploadAudioToGemini(
        apiKey,
        processedAudio,
        displayName,
        onProgress
      );

      // Debug logging before sending
      const audioSizeMB = processedAudio.size / (1024 * 1024);
      console.log('📤 Using Gemini File API:');
      console.log('  • Audio size:', audioSizeMB.toFixed(2), 'MB');
      console.log('  • Duration:', durationMinutes, 'minutes');
      console.log('  • MIME type:', mimeType);
      console.log('  • File URI:', uploadedFile.uri);
      console.log('  • File state:', uploadedFile.state);
      console.log('  • Model:', modelName);
      
      // Display audio info on UI before sending
      if (onProgress) {
        onProgress(20, `📊 ${audioSizeMB.toFixed(1)}MB • ${durationMinutes} phút • ${mimeType.split('/')[1].toUpperCase()}`);
      }

      // 🎯 CHIẾN LƯỢC ƯU TIÊN: Summary trước, Segments sau
      const adaptiveInstruction = durationMinutes <= 60
        ? `AUDIO NGẮN (${durationMinutes} phút): Hãy phiên âm CHI TIẾT từng câu nói, giữ nguyên wording và ngữ điệu.`
        : durationMinutes <= 90
        ? `AUDIO DÀI (${durationMinutes} phút):
1️⃣ ƯU TIÊN: Tạo summary HOÀN CHỈNH trước (~200-300 từ)
2️⃣ SAU ĐÓ: Tóm tắt segments cô đọng, nhóm nhiều câu thành 1 segment
3️⃣ NẾU GẦN HẾT TOKEN (ước tính ~6000 tokens đã dùng): DỪNG NGAY, đóng JSON hợp lệ. TỐT HƠN CÓ SUMMARY ĐẦY ĐỦ + ÍT SEGMENTS, hơn là BỊ CẮT NGANG.

⚠️ LƯU Ý: Chỉ làm segments cho phần ĐẦU của audio nếu thấy không đủ token cho toàn bộ.`
        : `AUDIO RẤT DÀI (${durationMinutes} phút):
🎯 CHIẾN LƯỢC 2 BƯỚC:

1️⃣ BƯỚC 1 - BẮT BUỘC: Tạo summary HOÀN CHỈNH
   • Độ dài: ~200-300 từ
   • Bao gồm: Chủ đề chính, quyết định quan trọng, kết luận
   • GIỮ LẠI: Tên riêng, số liệu, deadline

2️⃣ BƯỚC 2 - NẾU CÒN TOKEN: Tạo segments cực kỳ cô đọng
   • GỘP 5-10 câu liên quan thành 1 segment
   • CHỈ GHI ý chính, bỏ chi tiết không quan trọng
   • THEO DÕI token usage: Nếu ước tính đã dùng ~6000 tokens → DỪNG NGAY
   • ĐÓNG JSON đúng cú pháp: }] }

⚠️ QUY TẮC VÀNG: Summary đầy đủ + Ít segments > Summary + Segments bị cắt ngang
💡 GỢI Ý: Có thể chỉ làm 10-20 segments đại diện cho phần ĐẦU audio, sau đó dừng lại.`;

      // Prepare request
      const endpoint = `https://generativelanguage.googleapis.com/${this.GEMINI_API_VERSION}/${modelName}:generateContent?key=${apiKey}`;

      requestBody = {
        contents: [{
          parts: [
            {
              text: `BẠN LÀ CHUYÊN GIA GHI CHÉP CUỘC HỌP (AI SCRIBE).
NHIỆM VỤ: Xử lý file âm thanh đầu vào để tạo ra bản ghi chép và tóm tắt điều hành.

${adaptiveInstruction}

📊 NGÂN SÁCH TOKEN (OUTPUT BUDGET):
Bạn có tối đa ~8000 tokens cho output. Âm thanh dài ${durationMinutes} phút.

🎯 CHIẾN LƯỢC TỰ THÍCH NGHI:
• AUDIO NGẮN (<10 phút): Phiên âm CHI TIẾT (Verbatim) từng câu nói
• AUDIO VỪA (10-30 phút): Chuẩn hóa và gộp câu, giữ đầy đủ ý chính
• AUDIO DÀI (30-60 phút): Tóm tắt THÔNG MINH mỗi lượt nói, ưu tiên thông tin quan trọng
• AUDIO RẤT DÀI (>60 phút): Chỉ ghi ý chính + từ khóa, cực kỳ cô đọng

⚠️ QUY TẮC AN TOÀN (SAFETY BREAK):
Nếu bạn ước tính mình đã dùng ~70% token budget (khoảng 5600 tokens):
→ NGAY LẬP TỨC chuyển sang "Chế độ khẩn cấp": Chỉ ghi TÓM TẮT CỰC NGẮN (1 câu/lượt nói) cho phần còn lại
→ PHẢI đảm bảo ĐÓNG JSON hợp lệ: }} với đủ dấu ngoặc
→ NGUYÊN TẮC VÀNG: TỐT HƠN LÀ NGẮN GỌN NHƯNG HOÀN CHỈNH, chứ không phải DÀI MÀ BỊ CẮT NGANG

HƯỚNG DẪN XỬ LÝ:

PHẦN 1: TÓM TẮT TỔNG QUAN (SUMMARY) - LÀM TRƯỚC
Sau khi nghe toàn bộ file âm thanh, hãy tóm tắt nội dung cuộc họp dựa trên yêu cầu sau:
${summaryPrompt || 'Tóm tắt cụ thể các nội dung chính của từng người phát biểu, được thảo luận trong cuộc họp, tổng hợp theo trình tự thời gian. Bao gồm nhưng không giới hạn các chủ đề chính, quyết định quan trọng, và kết luận (nếu có).'}

CHÚ Ý: Viết tóm tắt bằng văn xuôi (paragraph), KHÔNG dùng dấu gạch đầu dòng. Giữ summary ở mức ~200-300 từ.

PHẦN 2: PHIÊN ÂM/TÓM TẮT SEGMENTS (tùy độ dài audio) - LÀM SAU
1.  Nghe toàn bộ file âm thanh.
2.  Trích xuất nội dung chính xác (hoặc tóm tắt nếu cần).
3.  Gán nhãn người nói nhất quán (Speaker 1, Speaker 2...). Cố gắng nhận diện tên nếu họ tự giới thiệu.
4.  Gắn Timestamp [h:mm:ss] chính xác tại thời điểm BẮT ĐẦU lượt nói của người đó (ví dụ: 0:30, 1:05:30, 2:15:45).
5.  Lược bỏ các từ thừa (à, ừ, ờ) nhưng giữ nguyên ý nghĩa.
6.  Nếu âm thanh không rõ, đánh dấu là "[không rõ]".

🎯 BẮT BUỘC GIỮ LẠI (dù có tóm tắt): 
   • Số liệu chính xác
   • Ngày tháng, deadline
   • Quyết định quan trọng
   • Yêu cầu hành động (action items)

⚠️ QUAN TRỌNG - THỨ TỰ OUTPUT:
- Trả về "summary" TRƯỚC (Phần 1)
- Sau đó mới đến "segments" (Phần 2)

Hãy trả về duy nhất một object JSON hợp lệ, không có markdown, không có lời dẫn. Cấu trúc như sau:
{
  "summary": "Nội dung tóm tắt chi tiết về cuộc họp dựa trên yêu cầu ở trên. Viết thành văn xuôi liền mạch.",
  "segments": [
    {
      "timestamp": "0:00",
      "speaker": "Người nói 1",
      "text": "nội dung tóm tắt của cả lượt nói"
    },
    {
      "timestamp": "0:45",
      "speaker": "Người nói 2",
      "text": "nội dung tóm tắt của cả lượt nói"
    }
  ]
}
HÃY TỰ CÂN ĐỐI ĐỘ CHI TIẾT để đảm bảo JSON hoàn chỉnh trong ngân sách token!`
            },
            {
              // 🚀 Use File API (fileData) instead of inline_data (base64)
              // This MASSIVELY reduces input tokens
              fileData: {
                mimeType: uploadedFile.mimeType,
                fileUri: uploadedFile.uri
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1, // Low temperature for consistent, rule-following behavior
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json' // Ensure valid JSON output, helps prevent truncation issues
        },
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

      if (onProgress) onProgress(25, '📤 Đang gửi request tới Gemini AI...');

      // Make API request with retry logic (handles 429/503 errors)
      const response = await this.fetchWithRetry(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      }, 3); // Max 3 retries

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

      // Parse response (now returns { results, summary, isTruncated, truncationWarning })
      const parsed = this.parseGeminiAudioTranscription(data, meetingStartTime);
      
      // Show completion or warning
      if (parsed.isTruncated && parsed.truncationWarning) {
        console.warn(parsed.truncationWarning);
        if (onProgress) {
          onProgress(100, `⚠️ Hoàn thành (có cảnh báo)`);
        }
      } else {
        if (onProgress) onProgress(100, '✅ Hoàn thành!');
      }

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
   * 🎯 Transcribe audio with smart caching and time-range queries
   * Upload once, query multiple times for different time ranges
   * 
   * SMART CACHING BENEFITS:
   * - File API: 99.6% token savings vs base64 encoding
   * - Optimized prompts: All chunks use transcription-only prompt (consistent, efficient)
   * - Cache duration: 48 hours (can process multiple times without re-upload)
   * - API Key bound: Cache validated against API key to prevent cross-key usage
   * 
   * PROMPT OPTIMIZATION:
   * - Summary: Generated FIRST via generateSummaryFromAudio() (SEPARATE call)
   *   → Gemini processes audio directly with focus on second half (conclusions/actions)
   *   → Compact prompt to reduce TPM (Tokens Per Minute) usage
   *   → maxOutputTokens: 2048 (200-400 words target, saves quota)
   *   → 90-second delay after summary before transcription (full quota reset)
   * - Transcription: Each chunk via queryTimeRange() (SEPARATE calls, transcription-only)
   *   → Pure transcription prompt (~50 tokens, no summary logic)
   *   → Token savings: ~150 tokens per chunk vs old mixed prompt
   *   → maxOutputTokens: 16384 (full 25-min transcription without truncation)
   *   → 90-second delays between chunks (full quota reset for 265K input tokens)
   *   → Progressive results: Each batch saved immediately to UI
   * 
   * @param apiKey - Gemini API key
   * @param audioBlob - Audio file to transcribe
   * @param modelName - Gemini model name
   * @param onProgress - Progress callback
   * @param chunkDurationMinutes - Duration per query chunk (default: 25 minutes)
   * @param meetingStartTime - Meeting start time for accurate timestamps
   * @param summaryPrompt - Optional custom summary prompt
   * @returns Transcription results with summary
   */
  public static async transcribeAudioWithCaching(
    apiKey: string,
    audioBlob: Blob,
    modelName: string,
    onProgress?: (progress: number, message?: string) => void,
    chunkDurationMinutes: number = 25,
    meetingStartTime?: Date,
    summaryPrompt?: string,
    onSummaryReady?: (summary: string) => void, // 🆕 Callback when summary is ready
    onSegmentReady?: (segments: TranscriptionResult[], chunkIndex: number, totalChunks: number) => void, // 🆕 Callback when each segment batch is ready
    outputLanguage?: string // 🆕 Output language (from Web Speech API config, e.g., 'vi-VN', 'en-US')
  ): Promise<{ results: TranscriptionResult[], summary?: string, isTruncated?: boolean, truncationWarning?: string }> {
    try {
      console.log('🎯 Starting transcription with smart caching...');
      
      // Step 1: Generate audio hash for cache lookup
      if (onProgress) onProgress(2, '🔑 Đang tạo audio fingerprint...');
      const audioHash = await this.generateAudioHash(audioBlob);
      console.log(`🔑 Audio hash: ${audioHash}`);
      
      // Step 2: Check cache (with API Key validation)
      if (onProgress) onProgress(5, '📂 Đang kiểm tra cache...');
      let cachedFile = this.loadAudioCache(audioHash, apiKey);
      let uploadedFile: UploadedFileInfo | null = null;
      
      if (cachedFile) {
        // Verify cached file still valid
        console.log('✅ Found cached file, verifying...');
        if (onProgress) onProgress(7, '🔍 Tìm thấy file đã upload, đang xác minh...');
        
        const isValid = await this.checkCachedFileValid(apiKey, cachedFile.fileName);
        
        if (isValid) {
          console.log('✅ Using cached file URI (skipping upload)');
          console.log(`   File: ${cachedFile.fileName}`);
          console.log(`   Uploaded at: ${new Date(cachedFile.uploadedAt).toLocaleString()}`);
          console.log(`   Expires at: ${new Date(cachedFile.expiresAt).toLocaleString()}`);
          
          if (onProgress) {
            onProgress(15, `✅ Đang dùng file đã upload (tiết kiệm ~30s)`);
          }
          
          uploadedFile = {
            uri: cachedFile.fileUri,
            mimeType: cachedFile.mimeType,
            state: 'ACTIVE',
            name: cachedFile.fileName
          };
        } else {
          console.log('❌ Cached file expired, will re-upload');
          if (onProgress) onProgress(7, '⚠️ File cache hết hạn, đang upload lại...');
          cachedFile = null;
        }
      }
      
      // Step 3: Upload if no valid cache
      if (!uploadedFile) {
        if (onProgress) onProgress(8, '📤 Đang tải file lên Gemini (chỉ 1 lần)...');
        
        // Convert to MP3 if needed (Gemini supports WAV and MP3)
        let processedAudio = audioBlob;
        const audioType = audioBlob.type.toLowerCase();
        const isWavOrMp3 = audioType.includes('wav') || audioType.includes('mpeg') || audioType.includes('mp3');
        
        if (!isWavOrMp3) {
          console.log(`🔄 Converting ${audioType} to MP3...`);
          processedAudio = await this.convertToMp3(audioBlob, 16000);
        } else if (!audioType.includes('mp3') && !audioType.includes('mpeg')) {
          // Convert WAV to MP3 for better compression
          console.log(`🔄 Converting WAV to MP3 for compression...`);
          processedAudio = await this.convertToMp3(audioBlob, 16000);
        }
        
        // Get duration
        const audioDuration = await this.getAudioDuration(processedAudio);
        const durationMinutes = Math.ceil(audioDuration / 60);
        console.log(`⏱️ Audio duration: ${durationMinutes} minutes`);
        
        // Upload
        const displayName = `audio_${Date.now()}.${processedAudio.type.split('/')[1] || 'wav'}`;
        uploadedFile = await this.uploadAudioToGemini(apiKey, processedAudio, displayName, onProgress);
        
        // Save to cache immediately after upload success
        const cacheInfo: AudioFileCacheInfo = {
          fileUri: uploadedFile.uri,
          fileName: uploadedFile.name,
          mimeType: uploadedFile.mimeType,
          uploadedAt: Date.now(),
          expiresAt: Date.now() + (48 * 60 * 60 * 1000), // 48 hours
          audioHash: audioHash,
          apiKeyHash: this.hashApiKey(apiKey), // ⚠️ Bind to API Key
          durationSeconds: audioDuration,
          fileSizeBytes: processedAudio.size
        };
        this.saveAudioCache(cacheInfo);
        console.log('💾 File URI saved to cache (bound to current API Key)');
      }
      
      // Step 4: Get audio duration from cache or calculate
      const audioDuration = cachedFile?.durationSeconds || await this.getAudioDuration(audioBlob);
      const totalMinutes = Math.ceil(audioDuration / 60);
      
      // Step 5: Calculate time ranges
      const timeRanges: { startMin: number; endMin: number }[] = [];
      for (let start = 0; start < totalMinutes; start += chunkDurationMinutes) {
        const end = Math.min(start + chunkDurationMinutes, totalMinutes);
        timeRanges.push({ startMin: start, endMin: end });
      }
      
      console.log(`📊 Will query ${timeRanges.length} time ranges (${chunkDurationMinutes} min each)`);
      
      // ⚠️ Quota warning for very long audio
      if (totalMinutes > 100) {
        console.warn(`⚠️ Long audio (${totalMinutes} min) may exceed quota (250K tokens/minute)`);
        console.warn(`   Summary: ~${Math.floor(totalMinutes * 0.7)}K tokens`);
        console.warn(`   Transcription: ~${timeRanges.length * 20}K tokens`);
        console.warn(`   Total estimate: ~${Math.floor(totalMinutes * 0.7) + timeRanges.length * 20}K tokens`);
        if (onProgress) {
          onProgress(12, `⚠️ Audio dài - có thể vượt quota...`);
        }
      }
      
      // Step 6: Generate summary FIRST (directly from audio, focus on second half)
      let globalSummary: string | undefined;
      
      if (onProgress) onProgress(12, '📝 Đang tạo tóm tắt từ audio (ưu tiên nửa cuối)...');
      
      console.log(`\n📝 Generating summary directly from audio (${totalMinutes} min)...`);
      try {
        globalSummary = await this.generateSummaryFromAudio(
          apiKey,
          uploadedFile!,
          modelName,
          totalMinutes,
          summaryPrompt,
          outputLanguage // Pass language for output
        );
        console.log('✅ Summary generated successfully');
        
        // 🆕 Immediately save summary to UI
        if (onSummaryReady && globalSummary) {
          console.log('📤 Sending summary to UI immediately...');
          onSummaryReady(globalSummary);
        }
        
        // ⏳ Delay to ensure quota resets (long audio needs more time)
        const delaySeconds = totalMinutes > 60 ? 90 : 10; // 90s for long audio (>60min), 10s for short
        console.log(`⏳ Waiting ${delaySeconds}s for quota reset before transcription...`);
        if (onProgress) onProgress(15, `⏳ Chờ ${delaySeconds}s để quota reset...`);
        
        // Countdown for user feedback
        for (let i = delaySeconds; i > 0; i -= 10) {
          if (i !== delaySeconds && onProgress) {
            onProgress(15, `⏳ Còn ${i}s...`);
          }
          await new Promise(resolve => setTimeout(resolve, Math.min(10000, i * 1000)));
        }
      } catch (error: any) {
        console.error('⚠️ Failed to generate summary:', error);
        globalSummary = '⚠️ Không thể tạo tóm tắt tự động. Vui lòng xem chi tiết transcript bên dưới.';
      }
      
      // Step 7: Query each time range for transcription
      const allResults: TranscriptionResult[] = [];
      let hasTruncation = false;
      const warnings: string[] = [];
      
      for (let i = 0; i < timeRanges.length; i++) {
        const range = timeRanges[i];
        const rangeProgress = 20 + ((i / timeRanges.length) * 75); // 20-95%
        
        if (onProgress) {
          onProgress(
            rangeProgress,
            `🔄 Đang phiên âm phút ${range.startMin}-${range.endMin} (${i + 1}/${timeRanges.length})...`
          );
        }
        
        console.log(`\n🔄 Processing range ${i + 1}/${timeRanges.length}: ${range.startMin}-${range.endMin} minutes`);
        
        // 🎯 TRANSCRIPTION ONLY: Request transcription for this time range
        // Summary is generated separately via generateSummaryFromAudio()
        // All results use same fileUri (no re-upload needed)
        const parsed = await this.queryTimeRange(
          apiKey,
          uploadedFile!,
          modelName,
          range.startMin,
          range.endMin,
          meetingStartTime,
          outputLanguage // Pass language for output
        );
        
        // Collect results
        allResults.push(...parsed.results);
        
        if (parsed.isTruncated) {
          hasTruncation = true;
          if (parsed.truncationWarning) {
            warnings.push(`Phần ${i + 1}: ${parsed.truncationWarning}`);
          }
        }
        
        // 🆕 Immediately save this segment batch to UI
        if (onSegmentReady && parsed.results.length > 0) {
          console.log(`📤 Sending segment batch ${i + 1}/${timeRanges.length} to UI (${parsed.results.length} items)...`);
          onSegmentReady(parsed.results, i + 1, timeRanges.length);
        }
        
        // ⏳ Delay between queries to avoid quota (90s for very long audio)
        if (i < timeRanges.length - 1) {
          const delayBetweenQueries = 90; // 90 seconds (audio 139min = 265K tokens/query)
          console.log(`⏳ Waiting ${delayBetweenQueries}s before next query...`);
          if (onProgress) {
            onProgress(
              rangeProgress,
              `⏳ Chờ ${delayBetweenQueries}s để quota reset...`
            );
          }
          
          // Countdown for better UX
          for (let wait = delayBetweenQueries; wait > 0; wait -= 10) {
            if (wait !== delayBetweenQueries && onProgress) {
              onProgress(rangeProgress, `⏳ Còn ${wait}s...`);
            }
            await new Promise(resolve => setTimeout(resolve, Math.min(10000, wait * 1000)));
          }
        }
      }
      
      if (onProgress) onProgress(100, '✅ Hoàn thành!');
      
      // Build final warning
      let finalWarning: string | undefined;
      if (hasTruncation) {
        finalWarning = `⚠️ Một số phần bị cắt ngắn:\n${warnings.join('\n')}`;
      }
      
      return {
        results: allResults,
        summary: globalSummary,
        isTruncated: hasTruncation,
        truncationWarning: finalWarning
      };
      
    } catch (error: any) {
      console.error('❌ Transcription with caching failed:', error);
      
      // Important: Cache is preserved even on error!
      // User can retry and will skip re-upload step
      console.log('💡 File URI is still cached. Retry will skip upload.');
      
      // Check if quota error
      if (error.message && (error.message.includes('quota') || error.message.includes('429'))) {
        // Extract wait time if available
        const retryMatch = error.message.match(/retry in ([\d.]+)s/);
        const waitTime = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
        
        // Ensure progress is cleared by throwing error
        const quotaError = new Error(
          `⛔ Vượt giới hạn 250K tokens/phút.\n\n` +
          `🕒 Vui lòng chờ ${waitTime}s rồi nhấn "Thử lại".\n` +
          `💡 File đã upload - lần sau sẽ nhanh hơn.\n` +
          `📊 Monitor: https://ai.dev/rate-limit`
        );
        (quotaError as any).isQuotaError = true; // Flag for UI handling
        throw quotaError;
      }
      
      throw new Error(`Failed to transcribe: ${error.message}`);
    }
  }

  /**
   * 🎬 Query specific time range from uploaded audio file
   * Uses fileUri to avoid re-uploading
   * 
   * TRANSCRIPTION-ONLY STRATEGY:
   * - This method ONLY handles transcription (no summary)
   * - Summary is generated separately via generateSummaryFromAudio()
   * - All timestamps are relative to absolute audio position (adjusted by offsetMs)
   * - Compact prompt for token efficiency
   */
  private static async queryTimeRange(
    apiKey: string,
    uploadedFile: UploadedFileInfo,
    modelName: string,
    startMinutes: number,
    endMinutes: number,
    meetingStartTime?: Date,
    outputLanguage?: string // Language code (e.g., 'vi-VN', 'en-US')
  ): Promise<{ results: TranscriptionResult[], isTruncated?: boolean, truncationWarning?: string }> {
    
    // Detect language name from code
    const languageName = this.getLanguageName(outputLanguage);
    const languageInstruction = languageName ? `\n- TRẢ VỀ BẰNG ${languageName.toUpperCase()}` : '';
    
    // 🎯 TRANSCRIPTION-ONLY PROMPT (compact, token-efficient)
    const prompt = `PHIÊN ÂM AUDIO - PHẦN ${startMinutes} ĐẾN ${endMinutes} PHÚT

Nhiệm vụ:
- Phân biệt người nói (Speaker 1, Speaker 2...)
- Timestamp bắt đầu từ ${startMinutes}:00 (vị trí tuyệt đối trong audio)
- Loại bỏ từ đệm (à, ừm, ơ)
- Gộp câu liên tiếp của cùng 1 người${languageInstruction}

Output JSON:
{
  "segments": [{"timestamp": "${startMinutes}:00", "speaker": "Speaker 1", "text": "..."}]
}`;

    const endpoint = `https://generativelanguage.googleapis.com/${this.GEMINI_API_VERSION}/${modelName}:generateContent?key=${apiKey}`;

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
        maxOutputTokens: 16384, // Increased for full 25-min transcription (25min ≈ 500-800 words ≈ 1000-1600 tokens + JSON overhead)
        responseMimeType: 'application/json'
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };

    console.log(`📤 Querying time range ${startMinutes}-${endMinutes}min with fileUri: ${uploadedFile.uri}`);

    const response = await this.fetchWithRetry(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    }, 3);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API error (${response.status}): ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();

    // Parse response with time offset (transcription only)
    const offsetMs = startMinutes * 60 * 1000;
    const adjustedMeetingTime = meetingStartTime 
      ? new Date(meetingStartTime.getTime() + offsetMs)
      : undefined;
    
    const parsed = this.parseGeminiAudioTranscription(
      data,
      adjustedMeetingTime
    );

    // Adjust timestamps in results to account for offset
    parsed.results.forEach((result: TranscriptionResult) => {
      if (result.audioTimeMs) {
        result.audioTimeMs += offsetMs;
      }
    });

    // Return transcription results only (no summary)
    return {
      results: parsed.results,
      isTruncated: parsed.isTruncated,
      truncationWarning: parsed.truncationWarning
    };
  }

  /**
   * 📝 Generate comprehensive summary directly from audio file
   * Queries Gemini with audio file to generate summary (NOT from text transcript)
   * 
   * STRATEGY:
   * - Query second half of audio for detailed summary (where conclusions typically occur)
   * - Gemini processes audio directly without text intermediary
   * - Token-efficient and captures audio nuances (tone, emphasis)
   * - maxOutputTokens controlled to prevent truncation
   * 
   * @param apiKey - Gemini API key
   * @param uploadedFile - Uploaded audio file info (cached)
   * @param modelName - Gemini model name
   * @param audioDurationMinutes - Total audio duration in minutes
   * @param customPrompt - Optional custom summary requirements
   * @returns Generated summary
   */
  private static async generateSummaryFromAudio(
    apiKey: string,
    uploadedFile: UploadedFileInfo,
    modelName: string,
    audioDurationMinutes: number,
    customPrompt?: string,
    outputLanguage?: string // Language code (e.g., 'vi-VN', 'en-US')
  ): Promise<string> {
    
    // Calculate second half time range for focused summary
    const halfwayPoint = Math.floor(audioDurationMinutes / 2);
    const endPoint = audioDurationMinutes;
    
    // Detect language name from code
    const languageName = this.getLanguageName(outputLanguage);
    const languageInstruction = languageName ? `\n- TRẢ VỀ BẰNG ${languageName.toUpperCase()}` : '';
    
    // Build compact prompt to reduce TPM usage
    const summaryPrompt = `Tóm tắt cuộc họp (${audioDurationMinutes} phút):

- ƯU TIÊN chi tiết nửa cuối (phút ${halfwayPoint}-${endPoint}): kết luận, quyết định, action items
- Phần đầu: tóm tắt ngắn context/chủ đề
- Giữ: số liệu, ngày tháng, tên riêng, deadlines
- Văn xuôi, 200-400 từ${languageInstruction}
${customPrompt ? `\n${customPrompt}` : ''}`;

    try {
      const endpoint = `https://generativelanguage.googleapis.com/${this.GEMINI_API_VERSION}/${modelName}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [{
          parts: [
            { text: summaryPrompt },
            {
              fileData: {
                mimeType: uploadedFile.mimeType,
                fileUri: uploadedFile.uri
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048, // Reduced to save quota and TPM (200-400 words ~ 400-800 tokens)
          responseMimeType: 'text/plain'
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      };

      console.log(`📝 Generating summary directly from audio (${audioDurationMinutes} min, focus on second half)...`);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ API Error Response:', errorData);
        
        let errorMessage = `Gemini API error (${response.status})`;
        if (errorData.error?.message) {
          errorMessage += `: ${errorData.error.message}`;
        } else {
          errorMessage += `: ${response.statusText}`;
        }
        
        // Check for specific quota errors
        if (response.status === 429) {
          errorMessage = 'Quota exceeded. Please wait a moment and try again.';
        } else if (response.status === 400 && errorData.error?.message?.includes('audio')) {
          errorMessage = 'Audio format not supported or corrupted. Try converting to WAV first.';
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();

      // Log full response for debugging
      console.log('📊 API Response structure:', {
        hasCandidates: !!data.candidates,
        candidatesLength: data.candidates?.length,
        firstCandidate: data.candidates?.[0] ? {
          hasContent: !!data.candidates[0].content,
          hasParts: !!data.candidates[0].content?.parts,
          partsLength: data.candidates[0].content?.parts?.length
        } : null
      });

      // Extract summary from response with multiple fallback strategies
      let summary: string | undefined;
      
      // Strategy 1: Standard path
      summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      // Strategy 2: Check if it's in different structure
      if (!summary && data.candidates?.[0]?.output) {
        summary = data.candidates[0].output;
      }
      
      // Strategy 3: Check text field directly
      if (!summary && data.text) {
        summary = data.text;
      }
      
      // Strategy 4: Check if blocked by safety
      if (!summary && data.candidates?.[0]?.finishReason) {
        const finishReason = data.candidates[0].finishReason;
        console.warn('⚠️ Response finish reason:', finishReason);
        
        if (finishReason === 'SAFETY' || finishReason === 'BLOCKED_SAFETY') {
          throw new Error('Summary blocked by safety filters. Try with different audio or adjust safety settings.');
        } else if (finishReason === 'MAX_TOKENS') {
          throw new Error('Summary exceeded max tokens limit. Audio might be too long.');
        } else if (finishReason === 'RECITATION') {
          throw new Error('Summary blocked due to recitation detection.');
        }
      }
      
      if (!summary || summary.trim().length === 0) {
        console.error('❌ No summary in response. Full data:', JSON.stringify(data, null, 2));
        throw new Error('No summary returned from API. Check console for full response.');
      }

      console.log(`✅ Summary generated successfully (${summary.length} chars)`);
      return summary.trim();

    } catch (error: any) {
      console.error('❌ Failed to generate summary from audio:', error);
      throw new Error(`Failed to generate summary: ${error.message}`);
    }
  }

  /**
   * Convert Blob to Base64 string
   * @deprecated - Kept for backward compatibility. New code should use File API instead.
   */
  // private static blobToBase64(blob: Blob): Promise<string> {
  //   return new Promise((resolve, reject) => {
  //     const reader = new FileReader();
  //     reader.onloadend = () => {
  //       const base64 = (reader.result as string).split(',')[1]; // Remove data:audio/...;base64, prefix
  //       resolve(base64);
  //     };
  //     reader.onerror = reject;
  //     reader.readAsDataURL(blob);
  //   });
  // }

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
   * Convert audio blob to MP3 format for optimal compression
   * Gemini API officially supports WAV and MP3
   * MP3 provides ~80% size reduction vs WAV
   * @param targetSampleRate - Target sample rate (16000 for smaller files, 44100 for quality)
   */
  public static async convertToMp3(audioBlob: Blob, targetSampleRate: number = 16000): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          // Resample to reduce file size
          let finalBuffer = audioBuffer;
          if (audioBuffer.sampleRate !== targetSampleRate) {
            console.log(`🔊 Resampling: ${audioBuffer.sampleRate}Hz → ${targetSampleRate}Hz`);
            finalBuffer = await this.resampleAudioBuffer(audioBuffer, targetSampleRate);
          }

          // Convert to MP3 format
          const mp3Blob = await this.audioBufferToMp3(finalBuffer);
          resolve(mp3Blob);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = reject;
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  /**
   * Convert AudioBuffer to MP3 Blob using lamejs
   * lamejs is a pure JavaScript MP3 encoder (no external compilation needed)
   */
  private static async audioBufferToMp3(audioBuffer: AudioBuffer): Promise<Blob> {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const channelData = [];
    
    // Extract audio data from each channel
    for (let i = 0; i < numberOfChannels; i++) {
      channelData.push(audioBuffer.getChannelData(i));
    }

    // Initialize MP3 encoder with lamejs (assuming it's available)
    // If lamejs is not available, provide helpful error
    if (!(window as any).lamejs) {
      throw new Error(
        'MP3 encoder (lamejs) not loaded. Please ensure lamejs library is included in your HTML: '
        + '<script src="https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js"></script>'
      );
    }

    const encoder = new ((window as any).lamejs.Mp3Encoder)(numberOfChannels, sampleRate, 128);
    const mp3Data: number[] = [];

    // Maximum samples to process at once (prevents memory issues)
    const samplesPerFrame = 1152;
    const totalSamples = audioBuffer.length;

    // Process audio in chunks
    for (let i = 0; i < totalSamples; i += samplesPerFrame) {
      const sampleChunk = Math.min(samplesPerFrame, totalSamples - i);
      
      if (numberOfChannels === 2) {
        const left = channelData[0].slice(i, i + sampleChunk);
        const right = channelData[1].slice(i, i + sampleChunk);
        const encoded = encoder.encodeBuffer(left, right);
        if (encoded.length > 0) {
          mp3Data.push(...encoded);
        }
      } else {
        const mono = channelData[0].slice(i, i + sampleChunk);
        const encoded = encoder.encodeBuffer(mono);
        if (encoded.length > 0) {
          mp3Data.push(...encoded);
        }
      }
    }

    // Flush remaining data
    const finalData = encoder.flush();
    if (finalData.length > 0) {
      mp3Data.push(...finalData);
    }

    return new Blob([new Uint8Array(mp3Data)], { type: 'audio/mpeg' });
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
   * Split audio into chunks based on size AND duration limits
   * Each chunk must satisfy: size <= maxChunkSizeMB AND duration <= maxDurationMinutes
   * @param audioBlob - Audio blob to split (any format supported by browser)
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

          // Convert to MP3
          const mp3Blob = await this.audioBufferToMp3(segmentBuffer);
          resolve(mp3Blob);
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
  ): Promise<{ results: TranscriptionResult[], summary?: string, isTruncated?: boolean, truncationWarning?: string }> {
    const maxSizeMB = maxFileSizeMB;

    // CRITICAL: Convert to WAV first if needed, THEN split based on size
    // Gemini API officially supports: WAV and MP3 only
    // All other formats (WebM, MP4, OGG, AAC, FLAC) must be converted to WAV
    if (onProgress) onProgress(3, 'Đang kiểm tra định dạng audio...');
    
    let mp3Blob = audioBlob;
    const audioType = audioBlob.type.toLowerCase();
    const isWavOrMp3 = audioType.includes('wav') || audioType.includes('mpeg') || audioType.includes('mp3');
    const needsConversion = !isWavOrMp3;
    
    if (needsConversion) {
      if (onProgress) onProgress(5, `Đang chuyển đổi ${audioType} sang MP3...`);
      // Convert with lower sample rate for smaller file size
      const targetSampleRate = 16000; // Lower sample rate = smaller file
      mp3Blob = await this.convertToMp3(audioBlob, targetSampleRate);
      
      const originalSizeMB = audioBlob.size / (1024 * 1024);
      const mp3SizeMB = mp3Blob.size / (1024 * 1024);
      console.log(`✅ Converted ${audioType}: ${originalSizeMB.toFixed(2)}MB → ${mp3SizeMB.toFixed(2)}MB (MP3)`);
    } else {
      console.log(`✅ Audio format ${audioType} is supported by Gemini (WAV/MP3) - no conversion needed`);
    }

    // Now split the MP3 file into chunks based on actual size AND duration
    if (onProgress) onProgress(8, 'Đang phân tích và chia file MP3...');
    const chunks = await this.splitAudioIntoChunks(mp3Blob, maxSizeMB, maxDurationMinutes);

    if (onProgress) onProgress(10, `Đã chia thành ${chunks.length} phần. Bắt đầu chuyển đổi...`);

    const allResults: TranscriptionResult[] = [];
    const allSummaries: string[] = [];
    let hasTruncation = false;
    const truncationWarnings: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkProgress = 10 + ((i / chunks.length) * 80);
      const chunkDurationMin = Math.ceil((chunk.endTimeMs - chunk.startTimeMs) / 60000);
      const chunkSizeMB = (chunk.blob.size / (1024 * 1024)).toFixed(1);

      if (onProgress) {
        onProgress(
          chunkProgress,
          `📦 Phần ${i + 1}/${chunks.length}: ${chunkSizeMB}MB • ${chunkDurationMin} phút`
        );
      }

      try {
        // Transcribe this chunk (skip size check - already validated and split)
        const parsed = await this.transcribeAudioWithGemini(
          apiKey,
          chunk.blob,
          modelName,
          (subProgress, subMessage) => {
            if (onProgress) {
              const totalProgress = chunkProgress + (subProgress / chunks.length) * 0.8;
              const progressMessage = subMessage 
                ? `📦 ${i + 1}/${chunks.length}: ${subMessage}`
                : `📦 Phần ${i + 1}/${chunks.length}: ${subProgress.toFixed(0)}%`;
              onProgress(totalProgress, progressMessage);
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
        
        // Log chunk completion
        console.log(`✅ Chunk ${i + 1}/${chunks.length}: ${adjustedResults.length} segments (${chunk.startTimeMs}ms - ${chunk.endTimeMs}ms)`);
        
        // Collect summary from this chunk
        if (parsed.summary) {
          allSummaries.push(`Phần ${i + 1}/${chunks.length}: ${parsed.summary}`);
          console.log(`📝 Chunk ${i + 1}/${chunks.length}: Summary collected (${parsed.summary.length} chars)`);
        }
        
        // Track truncation
        if (parsed.isTruncated) {
          hasTruncation = true;
          if (parsed.truncationWarning) {
            truncationWarnings.push(`Phần ${i + 1}/${chunks.length}: ${parsed.truncationWarning}`);
          }
        }

        // Show completion for this chunk
        if (onProgress) {
          onProgress(
            chunkProgress + (80 / chunks.length) * 0.9,
            `✅ Phần ${i + 1}/${chunks.length}: ${adjustedResults.length} segments`
          );
        }

        // Add delay between chunks to respect rate limits (15 req/min)
        if (i < chunks.length - 1) {
          if (onProgress) {
            onProgress(
              chunkProgress + (80 / chunks.length),
              `⏳ Đợi ${requestDelaySeconds}s trước khi xử lý phần ${i + 2}/${chunks.length}...`
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

    if (onProgress) onProgress(90, `✅ Đã xử lý ${allResults.length} segments từ ${chunks.length} phần`);

    console.log(`✅ Transcribed entire audio: ${allResults.length} segments from ${chunks.length} chunks`);
    
    // Combine summaries: Use Gemini to merge if multiple summaries, otherwise return as-is
    let combinedSummary: string | undefined = undefined;
    
    if (allSummaries.length === 0) {
      // No summaries at all
      combinedSummary = undefined;
    } else if (allSummaries.length === 1) {
      // Only one summary - use directly
      combinedSummary = allSummaries[0].replace(/^Phần \d+\/\d+: /, ''); // Remove "Phần 1/1: " prefix
    } else {
      // Multiple summaries - try to merge with Gemini API
      if (onProgress) onProgress(92, `🔄 Đang tổng hợp ${allSummaries.length} phần tóm tắt...`);
      
      try {
        // Call Gemini to merge summaries into one cohesive summary
        combinedSummary = await this.mergeSummariesWithGemini(
          apiKey,
          modelName,
          allSummaries,
          summaryPrompt,
          fileManager
        );
        
        if (onProgress) onProgress(98, `✅ Đã tổng hợp tóm tắt hoàn chỉnh`);
        console.log(`✅ Merged ${allSummaries.length} summaries with Gemini API`);
      } catch (mergeError: any) {
        // Fallback: Manual concatenation if Gemini merge fails
        console.warn(`⚠️ Failed to merge summaries with Gemini, using manual concatenation:`, mergeError.message);
        
        // Manual fallback format
        combinedSummary = allSummaries
          .map((summary, index) => `📄 Tóm tắt đoạn ${index + 1}:\n${summary.replace(/^Phần \d+\/\d+: /, '')}`)
          .join('\n\n---\n\n');
        
        if (onProgress) onProgress(98, `⚠️ Ghép tóm tắt thủ công (${allSummaries.length} phần)`);
      }
    }

    if (onProgress) onProgress(100, `🎉 Hoàn thành! ${allResults.length} segments`);
    
    // Build final truncation warning
    let finalTruncationWarning: string | undefined = undefined;
    if (hasTruncation && truncationWarnings.length > 0) {
      finalTruncationWarning = `⚠️ Một số phần audio bị truncated do MAX_TOKENS:\n${truncationWarnings.join('\n')}\n\nKhuyến nghị: Giảm thời lượng mỗi phần hoặc tăng maxOutputTokens trong cấu hình.`;
      console.warn(finalTruncationWarning);
    }
    
    return { results: allResults, summary: combinedSummary, isTruncated: hasTruncation, truncationWarning: finalTruncationWarning };
  }

  /**
   * Merge multiple summaries into one cohesive summary using Gemini API
   * This is used when audio is split into chunks and each chunk has its own summary
   * @param apiKey - Gemini API key
   * @param modelName - Gemini model name
   * @param summaries - Array of summaries from chunks (e.g., ["Phần 1/3: ...", "Phần 2/3: ..."])
   * @param userPrompt - Optional user-provided prompt for summary customization
   * @param fileManager - Optional file manager for debug logs
   * @returns Merged summary as a single cohesive paragraph
   */
  private static async mergeSummariesWithGemini(
    apiKey: string,
    modelName: string,
    summaries: string[],
    userPrompt?: string,
    fileManager?: FileManagerService
  ): Promise<string> {
    if (summaries.length === 0) {
      throw new Error('No summaries to merge');
    }

    if (summaries.length === 1) {
      // Only one summary - return directly without "Phần X/Y:" prefix
      return summaries[0].replace(/^Phần \d+\/\d+: /, '');
    }

    // Build prompt for Gemini to merge summaries
    const summariesText = summaries
      .map((summary, index) => `### Phần ${index + 1}/${summaries.length}\n${summary.replace(/^Phần \d+\/\d+: /, '')}`)
      .join('\n\n');

    const mergePrompt = `BẠN LÀ CHUYÊN GIA TÓM TẮT CUỘC HỌP.

NHIỆM VỤ: Tổng hợp các tóm tắt riêng lẻ từ các đoạn audio thành MỘT tóm tắt tổng quan liền mạch cho toàn bộ cuộc họp.

YÊU CẦU:
1. ĐỌC kỹ tất cả các tóm tắt bên dưới (mỗi tóm tắt tương ứng với 1 đoạn audio)
2. TỔNG HỢP thành 1 đoạn văn xuôi liền mạch, KHÔNG dùng dấu gạch đầu dòng
3. GIỮ LẠI toàn bộ thông tin quan trọng: số liệu, ngày tháng, tên riêng, quyết định, action items
4. SẮP XẾP theo trình tự thời gian logic (từ đầu đến cuối cuộc họp)
5. LOẠI BỎ thông tin trùng lặp giữa các đoạn
6. ĐẢM BẢO văn phong chuyên nghiệp, mạch lạc, dễ hiểu

${userPrompt ? `\nYÊU CẦU BỔ SUNG TỪ NGƯỜI DÙNG:\n${userPrompt}\n` : ''}

=== CÁC TÓM TẮT RIÊNG LẺ CẦN TỔNG HỢP ===

${summariesText}

=== OUTPUT ===

Hãy trả về MỘT đoạn văn xuôi tổng hợp, KHÔNG có tiêu đề, KHÔNG có dấu gạch đầu dòng, KHÔNG có cấu trúc danh sách.`;

    try {
      const endpoint = `https://generativelanguage.googleapis.com/${this.GEMINI_API_VERSION}/${modelName}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [{
          parts: [{ text: mergePrompt }]
        }],
        generationConfig: {
          temperature: 0.2, // Lower temperature for more focused, consistent merging
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
          responseMimeType: 'text/plain' // Plain text for summary merging
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Gemini API error (${response.status}): ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();

      // Save debug log
      await this.saveGeminiDebugLog(requestBody, data, {
        type: 'text',
        timestamp: new Date().toISOString(),
        error: data.error ? data.error.message : undefined
      }, fileManager);

      // Extract merged summary from response
      const candidates = data?.candidates;
      if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        throw new Error('No response from Gemini API');
      }

      const content = candidates[0]?.content;
      if (!content || !content.parts || !Array.isArray(content.parts) || content.parts.length === 0) {
        throw new Error('Invalid response format from Gemini API');
      }

      const mergedSummary = content.parts[0].text.trim();
      
      if (!mergedSummary || mergedSummary.length === 0) {
        throw new Error('Empty summary from Gemini API');
      }

      return mergedSummary;

    } catch (error: any) {
      console.error('❌ Failed to merge summaries with Gemini:', error);
      throw new Error(`Cannot merge summaries: ${error.message}`);
    }
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
   * Parse Gemini audio transcription response
   * Extracts segments and summary from API response
   * Handles JSON parsing errors with fallback extraction
   */
  public static parseGeminiAudioTranscription(
    apiResponse: any,
    meetingStartTime?: Date
  ): { results: TranscriptionResult[], summary?: string, isTruncated?: boolean, truncationWarning?: string } {
    try {
      // Check for truncation
      const finishReason = apiResponse?.candidates?.[0]?.finishReason;
      const isTruncated = finishReason === 'MAX_TOKENS';
      if (isTruncated) {
        console.warn('⚠️ Response truncated due to MAX_TOKENS:', finishReason);
      }

      const content = apiResponse?.candidates?.[0]?.content;
      if (!content || !content.parts || !Array.isArray(content.parts) || content.parts.length === 0) {
        console.error('❌ No content/parts in first candidate:', apiResponse?.candidates?.[0]);
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
        const extractResult = this.extractSegmentsWithErrorHandling(jsonText, errorPosition);
        
        if (extractResult && extractResult.segments && extractResult.segments.length > 0) {
          console.log(`✅ Extracted ${extractResult.segments.length} segments (including error markers)`);
          parsed = extractResult; // Use the whole result object (includes summary if found)
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
      
      // Build truncation warning if detected
      let truncationWarning: string | undefined = undefined;
      if (isTruncated) {
        // Check if summary might be truncated (incomplete sentence)
        const summaryTruncated = summary && (
          !summary.endsWith('.') && 
          !summary.endsWith('!') && 
          !summary.endsWith('?') &&
          !summary.endsWith('。')
        );
        
        if (summaryTruncated) {
          truncationWarning = `⚠️ Kết quả bị cắt ngắn do vượt giới hạn MAX_TOKENS.\n` +
            `• Summary: Có thể chưa đầy đủ (câu cuối chưa kết thúc)\n` +
            `• Segments: Đã nhận được ${results.length} segments (có thể thiếu)\n\n` +
            `💡 Giải pháp: Giảm thời lượng audio mỗi phần hoặc tăng maxOutputTokens.`;
        } else {
          truncationWarning = `⚠️ Kết quả có thể bị cắt ngắn do vượt giới hạn MAX_TOKENS. ` +
            `Đã nhận được ${results.length} segments. ` +
            `Nếu cần đầy đủ hơn, vui lòng giảm thời lượng audio hoặc sử dụng auto-split.`;
        }
        console.warn(truncationWarning);
      }
      
      return { results, summary, isTruncated, truncationWarning };

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
   * Also attempts to extract summary if present
   */
  private static extractSegmentsWithErrorHandling(text: string, _errorPosition: number): { segments: any[], summary?: string } {
    const segments: any[] = [];
    let summary: string | undefined = undefined;
    
    // First, try to extract summary if it exists
    const summaryMatch = text.match(/"summary"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/s);
    if (summaryMatch) {
      try {
        // Unescape the summary text
        summary = summaryMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        console.log(`✅ Extracted summary from truncated JSON (${summary.length} chars)`);
      } catch (err) {
        console.warn('⚠️ Failed to extract summary:', err);
      }
    }
    
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
      const manualResult = this.extractSegmentsManually(text);
      return { segments: manualResult, summary };
    }
    
    return { segments, summary };
  }
}
