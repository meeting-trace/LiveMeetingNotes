import type { TranscriptionResult } from '../types/types';
import type { FileManagerService } from './fileManager';
import { splitWebmIntoChunks, isLikelyWebm, splitWavIntoChunks, isLikelyWav } from './webmSplitter';
import { chunkStorage } from './chunkStorage';
import i18n from '../i18n';
import { WORLD_LANGUAGES } from '../constants/worldLanguages';

// Build BCP-47 → native language name map from the world languages list.
// Also adds bare language prefix entries (e.g. 'ru' → 'Русский') for loose matching.
const LANG_NAME_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const l of WORLD_LANGUAGES) {
    map[l.value] = l.name;                              // full code: 'ru-RU'
    const prefix = l.value.split('-')[0];               // prefix:    'ru'
    if (!map[prefix]) map[prefix] = l.name;             // first match wins
  }
  return map;
})();

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
 * Callback invoked after automatic retries are exhausted on a transient
 * Gemini API error (503 / network failure). The callback should ask the
 * user whether they want to keep retrying and optionally supply a new API key.
 */
export type GeminiRetryCallback = (ctx: {
  chunkIndex: number;   // 1-based chunk number that failed
  chunkTotal: number;   // total chunks in session
  attempt: number;      // number of auto-retry attempts already made
  error: string;        // last error message
  currentApiKey: string;
  isNonRetryable?: boolean; // true when error is not transient (e.g. RECITATION, SAFETY)
}) => Promise<{ retry: boolean; skip?: boolean; newApiKey?: string }>;

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
  private static readonly BATCH_SIZE = 20; // Max segments per batch (controls granularity)
  private static readonly BATCH_DELAY_MS = 6000; // 6 seconds between batches to respect rate limit

  // Output token budget per API request
  // Gemini 2.5 thinking models use a large portion of outputTokenLimit for internal reasoning.
  // Setting maxOutputTokens to the full model limit (65536) causes truncation because
  // thinking tokens (e.g. ~62000) consume almost all the budget before actual output starts.
  private static readonly MAX_SAFE_OUTPUT_TOKENS = 8192;       // Hard cap per request for actual JSON output
  private static readonly THINKING_BUDGET_TOKENS = 1024;       // Limit thinking for structured JSON tasks (Gemini 2.5+)
  private static readonly EST_OUTPUT_TOKENS_PER_SEGMENT = 150; // Conservative estimate: output tokens per refined segment
  private static readonly EST_SUMMARY_TOKENS = 700;            // Estimated tokens for meeting summary

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
  // private static async saveGeminiDebugLog(
  //   requestBody: any,
  //   responseData: any,
  //   metadata: { type: 'text' | 'audio'; timestamp: string; error?: string },
  //   fileManager?: FileManagerService
  // ): Promise<void> {
  //   try {
  //     const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  //     const filename = `gemini-debug-${metadata.type}-${timestamp}.json`;
      
  //     // Extract only prompt text from request (exclude base64 audio data)
  //     let requestSummary: any = null;
      
  //     if (requestBody) {
  //       requestSummary = {
  //         generationConfig: requestBody.generationConfig,
  //         safetySettings: requestBody.safetySettings
  //       };

  //       // Extract prompt text based on request type
  //       if (requestBody.contents && Array.isArray(requestBody.contents)) {
  //         requestSummary.contents = requestBody.contents.map((content: any) => {
  //           if (content.parts && Array.isArray(content.parts)) {
  //             return {
  //               parts: content.parts.map((part: any) => {
  //                 // Keep text prompts, exclude base64 audio data
  //                 if (part.text) {
  //                   return { text: part.text };
  //                 } else if (part.inline_data) {
  //                   // Replace large base64 data with summary info
  //                   return {
  //                     inline_data: {
  //                       mime_type: part.inline_data.mime_type,
  //                       data: `[EXCLUDED: ${part.inline_data.mime_type} data, size: ${part.inline_data.data?.length || 0} chars]`
  //                     }
  //                   };
  //                 }
  //                 return part;
  //               })
  //             };
  //           }
  //           return content;
  //         });
  //       }
  //     }
      
  //     const debugData = {
  //       metadata: {
  //         ...metadata,
  //         savedAt: new Date().toISOString(),
  //         note: 'Audio base64 data excluded to reduce file size'
  //       },
  //       request: requestSummary,
  //       response: responseData
  //     };

  //     // Save to project folder's debug-logs/ if fileManager has folder selected
  //     if (fileManager) {
  //       try {
  //         await fileManager.saveMetadataFile(debugData, filename, 'debug-logs', true);
  //         console.log(`📁 Gemini debug log saved to project: debug-logs/${filename}`);
  //       } catch (error: any) {
  //         // If no folder selected, log info (don't save)
  //         if (error.message === 'No folder selected') {
  //           console.log(`ℹ️ Debug log not saved (no project folder selected): ${filename}`);
  //         } else {
  //           console.error('Failed to save debug log to project folder:', error);
  //         }
  //       }
  //     } else {
  //       console.log(`ℹ️ Debug log not saved (fileManager not available): ${filename}`);
  //     }
  //   } catch (error) {
  //     console.error('Failed to prepare debug log:', error);
  //   }
  // }

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
            message: i18n.t('quotaStatus.exceededMsg'),
            recommendations: [
              i18n.t('quotaStatus.exceededRec1'),
              i18n.t('quotaStatus.exceededRec2'),
              i18n.t('quotaStatus.exceededRec3')
            ]
          };
        } else {
          return {
            status: 'limited',
            message: i18n.t('quotaStatus.limitedMsg'),
            recommendations: [
              i18n.t('quotaStatus.limitedRec1'),
              i18n.t('quotaStatus.limitedRec2')
            ]
          };
        }
      } else if (response.ok) {
        return {
          status: 'available',
          message: i18n.t('quotaStatus.availableMsg'),
          recommendations: [
            i18n.t('quotaStatus.availableRec1'),
            i18n.t('quotaStatus.availableRec2'),
            i18n.t('quotaStatus.availableRec3')
          ]
        };
      } else {
        return {
          status: 'error',
          message: i18n.t('quotaStatus.errorMsg', { status: response.status }),
          recommendations: [
            i18n.t('quotaStatus.errorRec1'),
            i18n.t('quotaStatus.errorRec2')
          ]
        };
      }
    } catch (error: any) {
      return {
        status: 'error',
        message: i18n.t('quotaStatus.cannotCheck'),
        recommendations: [
          i18n.t('quotaStatus.checkRec2'),
          i18n.t('quotaStatus.checkRec3')
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
      let estimatedUsage = i18n.t('quotaStatus.noDetail');

      if (response.status === 429) {
        quotaStatus = 'exceeded';
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || '';
        
        if (errorMsg.includes('quota')) {
          estimatedUsage = i18n.t('quotaStatus.infoUsageExceeded');
          recommendations.push(i18n.t('quotaStatus.infoWait24h'));
          recommendations.push(i18n.t('quotaStatus.infoUpgradePaid'));
        } else {
          estimatedUsage = i18n.t('quotaStatus.infoUsageLimited');
          recommendations.push(i18n.t('quotaStatus.infoUsageWait1m'));
        }
      } else if (response.ok) {
        quotaStatus = 'available';
        estimatedUsage = i18n.t('quotaStatus.infoUsageAvailable');
        
        // Estimate based on typical usage
        recommendations.push(i18n.t('quotaStatus.infoFreeTier'));
        recommendations.push(i18n.t('quotaStatus.infoSegmentTokens'));
        recommendations.push(i18n.t('quotaStatus.infoMonitor'));
      }

      return {
        estimatedUsage,
        quotaStatus,
        recommendations
      };
    } catch (error: any) {
      return {
        estimatedUsage: i18n.t('quotaStatus.cannotCheck'),
        quotaStatus: 'error',
        recommendations: [
          i18n.t('quotaStatus.checkRec1'),
          i18n.t('quotaStatus.checkRec2'),
          i18n.t('quotaStatus.checkRec3')
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

  // Cache modelInfo per (apiKey+model) to avoid repeated HTTP calls on every batch
  private static readonly _modelInfoCache = new Map<string, { outputTokenLimit: number; inputTokenLimit: number; displayName: string }>();

  /**
   * Get specific model information including outputTokenLimit.
   * Result is cached in memory so subsequent calls within the same session
   * do not make additional HTTP requests (important for batch processing).
   */
  public static async getModelInfo(apiKey: string, modelName: string): Promise<{
    outputTokenLimit: number;
    inputTokenLimit: number;
    displayName: string;
  }> {
    const cacheKey = `${apiKey.slice(-8)}:${modelName}`;
    if (this._modelInfoCache.has(cacheKey)) {
      console.log(`📊 Model info for ${modelName}: (from cache)`);
      return this._modelInfoCache.get(cacheKey)!;
    }
    try {
      const response = await this.listGeminiModels(apiKey);
      const model = response.models?.find((m: any) => m.name === modelName);
      
      if (model) {
        console.log(`📊 Model info for ${modelName}:`, {
          outputTokenLimit: model.outputTokenLimit,
          inputTokenLimit: model.inputTokenLimit,
          displayName: model.displayName
        });
        
        const info = {
          outputTokenLimit: model.outputTokenLimit || 8192,
          inputTokenLimit: model.inputTokenLimit || 1000000,
          displayName: model.displayName || modelName
        };
        this._modelInfoCache.set(cacheKey, info);
        return info;
      } else {
        console.warn(`⚠️ Model ${modelName} not found, using default outputTokenLimit: 8192`);
        const fallback = {
          outputTokenLimit: 8192,
          inputTokenLimit: 1000000,
          displayName: modelName
        };
        this._modelInfoCache.set(cacheKey, fallback);
        return fallback;
      }
    } catch (error: any) {
      console.error('Error getting model info:', error);
      console.warn('⚠️ Falling back to default outputTokenLimit: 8192');
      return {
        outputTokenLimit: 8192,
        inputTokenLimit: 1000000,
        displayName: modelName
      };
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
    modelName: string, // REQUIRED: specific Gemini model (e.g., "models/gemini-flash-latest")
    onProgress?: (progress: number, message?: string) => void,
    // fileManager?: FileManagerService // Optional: for saving debug logs to project folder
  ): Promise<{ segments: RefinedSegment[], summary?: string, isTruncated?: boolean, truncationWarning?: string, isPartial?: boolean, partialWarning?: string }> {
    // Check quota estimate first
    const quotaCheck = this.checkQuotaEstimate(transcriptions);
    console.log('📊 Quota Check:', quotaCheck.message);

    // Calculate safe batch size based on output token budget per request.
    // Each request: thinking (~THINKING_BUDGET_TOKENS) + summary (~EST_SUMMARY_TOKENS) + segments
    // Remaining tokens for segments = MAX_SAFE_OUTPUT_TOKENS - THINKING_BUDGET_TOKENS - EST_SUMMARY_TOKENS
    const outputBudgetForSegments = this.MAX_SAFE_OUTPUT_TOKENS - this.THINKING_BUDGET_TOKENS - this.EST_SUMMARY_TOKENS;
    const safeBatchSize = Math.max(5, Math.min(
      this.BATCH_SIZE,
      Math.floor(outputBudgetForSegments / this.EST_OUTPUT_TOKENS_PER_SEGMENT)
    ));
    console.log(`📐 Safe batch size: ${safeBatchSize} segments/request (output budget: ${outputBudgetForSegments} tokens)`);

    // Auto-batch when:
    // 1. Segments exceed the per-request safe limit (prevents output truncation)
    // 2. Estimated daily tokens exceed 80% of free tier quota
    const needsBatching = transcriptions.length > safeBatchSize ||
      quotaCheck.estimatedTokens > this.FREE_TIER_LIMITS.TPD * 0.8;

    if (needsBatching) {
      const reason = transcriptions.length > safeBatchSize
        ? `${transcriptions.length} segments > safe limit ${safeBatchSize}/request`
        : 'daily quota threshold';
      console.log(`🔄 Using batch processing (${reason})...`);
      return this.refineTranscriptsInBatches(apiKey, transcriptions, rawData, modelName, onProgress, safeBatchSize);
    }

    // Small enough to process in a single request
    return this.refineWithGemini(apiKey, transcriptions, rawData, modelName, onProgress);
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
    // fileManager?: FileManagerService,
    batchSize: number = this.BATCH_SIZE // Dynamic batch size passed from refineTranscripts
  ): Promise<{ segments: RefinedSegment[], summary?: string, isTruncated?: boolean, truncationWarning?: string, isPartial?: boolean, partialWarning?: string }> {
    const batches = this.splitIntoBatches(transcriptions, batchSize);
    const allRefinedSegments: RefinedSegment[] = [];
    const allSummaries: string[] = [];
    let hasTruncation = false;
    const truncationWarnings: string[] = [];
    const MAX_RPM_RETRIES = 3; // Max retries per batch when hitting RPM limit

    console.log(`📦 Processing ${transcriptions.length} segments in ${batches.length} batches (${batchSize} segments/batch)...`);

    let i = 0;
    while (i < batches.length) {
      const batch = batches[i];
      const batchProgress = (i / batches.length) * 100;
      let rpmRetryCount = 0;

      console.log(`🔄 Processing batch ${i + 1}/${batches.length} (${batch.length} segments)...`);

      let batchSucceeded = false;
      while (!batchSucceeded) {
        try {
          // Find corresponding raw data for this batch
          const batchStartIndex = i * batchSize;
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
            // fileManager
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

          batchSucceeded = true;

          // Add delay between batches to avoid rate limiting (except for last batch)
          if (i < batches.length - 1) {
            console.log(`⏳ Waiting ${this.BATCH_DELAY_MS / 1000}s before next batch...`);
            await new Promise(resolve => setTimeout(resolve, this.BATCH_DELAY_MS));
          }

        } catch (error: any) {
          // ── RPM rate limit: auto-retry after the wait time Gemini specifies ──
          if (error.message.startsWith('RPM_RATE_LIMIT:')) {
            rpmRetryCount++;
            if (rpmRetryCount > MAX_RPM_RETRIES) {
              throw new Error(i18n.t('apiErrors.rpmExceeded', {
                current: i + 1, total: batches.length,
                refined: allRefinedSegments.length, totalSeg: transcriptions.length
              }));
            }
            const retrySeconds = parseInt(error.message.split(':')[1], 10) || 60;
            const waitMs = (retrySeconds + 5) * 1000; // +5s buffer
            console.warn(`⏱️ RPM limit hit (retry ${rpmRetryCount}/${MAX_RPM_RETRIES}). Waiting ${retrySeconds + 5}s then retrying batch ${i + 1}...`);
            if (onProgress) {
              onProgress(
                batchProgress,
                i18n.t('geminiProgress.rpmWaiting', { seconds: retrySeconds + 5, current: i + 1, total: batches.length })
              );
            }
            await new Promise(resolve => setTimeout(resolve, waitMs));
            continue; // retry same batch
          }

          // ── Daily quota exhausted: return partial results instead of throwing ──
          // This preserves all segments already refined so they are saved to the UI.
          if (error.message.includes('quota') || error.message.includes('🚫')) {
            console.warn(`🚫 Daily quota hit at batch ${i + 1}. Returning ${allRefinedSegments.length} partial segments.`);
            if (onProgress) onProgress(100);
            const partialSummary = allSummaries.length > 0 ? allSummaries.join('\n\n---\n\n') : undefined;
            const partialWarning = i18n.t('apiErrors.partialWarning', {
              current: i + 1, total: batches.length,
              refined: allRefinedSegments.length,
              totalSeg: transcriptions.length,
              remaining: transcriptions.length - allRefinedSegments.length
            });
            return {
              segments: allRefinedSegments,
              summary: partialSummary,
              isTruncated: hasTruncation,
              truncationWarning: truncationWarnings.length > 0 ? truncationWarnings.join('\n') : undefined,
              isPartial: true,
              partialWarning
            };
          }

          // ── Other errors: propagate immediately ──
          throw error;
        }
      } // end inner while (retry loop)

      i++;
    } // end outer while (batch loop)

    if (onProgress) onProgress(100);
    console.log(`✅ Batch processing complete: ${allRefinedSegments.length} segments refined`);
    
    // Combine all batch summaries into one
    const combinedSummary = allSummaries.length > 0 
      ? allSummaries.join('\n\n---\n\n')
      : undefined;
    
    // Build final truncation warning if any batch was truncated
    let finalTruncationWarning: string | undefined = undefined;
    if (hasTruncation && truncationWarnings.length > 0) {
      finalTruncationWarning = `${i18n.t('apiErrors.batchTruncated')}\n${truncationWarnings.join('\n')}`;
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
    modelName: string, // REQUIRED: specific model like "models/gemini-flash-latest"
    onProgress?: (progress: number, message?: string) => void,
    // fileManager?: FileManagerService
  ): Promise<{ segments: RefinedSegment[], summary?: string, isTruncated?: boolean, truncationWarning?: string, isPartial?: boolean, partialWarning?: string }> {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('API Key is required for AI refinement');
    }

    if (transcriptions.length === 0) {
      throw new Error('No transcript data to refine');
    }

    // Validate model name
    if (!modelName || !modelName.trim() || !modelName.startsWith('models/')) {
      throw new Error(i18n.t('apiErrors.noModelSelected'));
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

      // Get model info to retrieve outputTokenLimit dynamically
      const modelInfo = await this.getModelInfo(apiKey, modelName);
      console.log(`📊 Model ${modelName}: outputTokenLimit = ${modelInfo.outputTokenLimit}`);

      // Build endpoint URL with selected model
      const endpoint = `https://generativelanguage.googleapis.com/${this.GEMINI_API_VERSION}/${modelName}:generateContent`;
      console.log(`🤖 Using Gemini model: ${modelName}`);
      console.log(`📡 Endpoint: ${endpoint}`);

      // Calculate maxOutputTokens for this specific batch to avoid truncation.
      // Gemini 2.5 thinking models use a large portion of the token budget for internal reasoning,
      // so setting maxOutputTokens = full model limit causes the actual JSON output to be truncated.
      // Strategy: cap at MAX_SAFE_OUTPUT_TOKENS, sized to fit expected segments + summary + thinking.
      const estBatchOutputTokens =
        transcriptions.length * this.EST_OUTPUT_TOKENS_PER_SEGMENT + this.EST_SUMMARY_TOKENS;
      const batchMaxOutputTokens = Math.min(
        modelInfo.outputTokenLimit,               // Never exceed model's hard cap
        Math.max(
          this.MAX_SAFE_OUTPUT_TOKENS,            // Always allow at least the safe minimum
          estBatchOutputTokens + this.THINKING_BUDGET_TOKENS + 512 // estimated need + headroom
        )
      );
      console.log(`🎯 maxOutputTokens for this batch: ${batchMaxOutputTokens} (estimated need: ${estBatchOutputTokens} + ${this.THINKING_BUDGET_TOKENS} thinking)`);

      // Gemini 2.5+ models support thinkingConfig to limit reasoning token usage.
      // For structured JSON tasks, deep thinking is not needed — limit it explicitly.
      const isThinkingModel = modelName.includes('gemini-2.5') || modelName.includes('gemini-2-5');

      // Build generationConfig — only add thinkingConfig for models that support it
      const generationConfig: Record<string, any> = {
        temperature: 0.1,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: batchMaxOutputTokens,
        responseMimeType: 'application/json'
      };
      if (isThinkingModel) {
        generationConfig.thinkingConfig = { thinkingBudget: this.THINKING_BUDGET_TOKENS };
        console.log(`🧠 thinkingBudget set to ${this.THINKING_BUDGET_TOKENS} tokens (Gemini 2.5 model)`);
      }

      // Call Gemini API
      const requestBody: Record<string, any> = {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig,
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

      if (onProgress) onProgress(70, i18n.t('geminiProgress.receiving'));

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
            throw new Error(i18n.t('apiErrors.quotaExceededDetail', {
              retrySeconds, retryMinutes, errorMsg
            }));
          } else {
            // Rate limit (RPM) — throw special marker so batch loop can auto-retry
            throw new Error(`RPM_RATE_LIMIT:${retrySeconds}`);
          }
        }
        
        // Provide helpful error messages for other errors
        if (response.status === 403) {
          if (errorMsg.includes('API has not been used') || errorMsg.includes('SERVICE_DISABLED')) {
            throw new Error(i18n.t('apiErrors.apiKeyNotEnabled'));
          } else if (errorMsg.includes('API_KEY_INVALID')) {
            throw new Error(i18n.t('apiErrors.apiKeyInvalid'));
          }
        } else if (response.status === 404) {
          throw new Error(i18n.t('apiErrors.modelNotFound', { modelName, errorMsg }));
        }
        
        throw new Error(`Gemini API error (${response.status}): ${errorMsg}`);
      }

      const result = await response.json();
      
      if (onProgress) onProgress(90);

      // 💾 Save debug log with request and response
      // await this.saveGeminiDebugLog(requestBody, result, {
      //   type: 'text',
      //   timestamp: new Date().toISOString(),
      //   error: result.error ? result.error.message : undefined
      // }, fileManager);

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

    // Prompt for refining existing transcription segments
    return `Chuẩn hóa speech-to-text (thư ký chuyên nghiệp). Giữ đúng ${segmentCount} segments (1:1).
Quy tắc: sửa lỗi từ ("công ti"→"công ty"), bỏ từ đệm (à/ừm/ờ), thêm dấu câu, viết hoa danh từ riêng. KHÔNG gộp/tóm tắt/bỏ segment. Giữ nguyên timestamp và audioTimeMs gốc.
Output: JSON object duy nhất, không markdown:
{"summary":"tóm tắt cuộc họp ~200-400 từ, chủ đề chính, quyết định, kết luận","segments":[{"timestamp":"...","audioTimeMs":123,"text":"..."}]}

=== DỮ LIỆU (${segmentCount} segments) ===
${dataJson}
${hasRawData ? `=== THAM KHẢO (đối chiếu sửa lỗi) ===\n${rawDataJson}` : ''}`;
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
        let parsed = false;
        try {
          refinedData = JSON.parse(fixedText);
          parsed = true;
          console.log('✅ JSON fixed and parsed successfully');
        } catch (_secondError) {
          console.warn('⚠️ Standard fix failed, trying truncation recovery...');
        }

        // If standard fixes failed AND response was truncated (MAX_TOKENS),
        // salvage all complete segments by closing the broken JSON
        if (!parsed && (finishReason === 'MAX_TOKENS')) {
          try {
            refinedData = AIRefinementService.recoverTruncatedJSON(responseText);
            parsed = !!refinedData;
            if (parsed) {
              console.log('✅ Recovered partial data from truncated response');
            }
          } catch (_recoverError) {
            console.error('❌ Truncation recovery also failed');
          }
        }

        if (!parsed) {
          console.error('❌ All JSON repair attempts failed');
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
          truncationWarning = i18n.t('apiErrors.truncatedRefineWithSummary', { count: segments.length });
        } else {
          truncationWarning = i18n.t('apiErrors.truncatedRefine', { count: segments.length });
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
   * Recover partial data from a JSON string that was truncated due to MAX_TOKENS.
   * Strategy:
   * 1. Extract `summary` via regex (appears before `segments`).
   * 2. Find all complete segment objects inside the `"segments"` array
   *    by walking backwards from the end, looking for the last `}` that
   *    closes a complete object at the segment level.
   * 3. Close the array + wrapper object and re-parse.
   */
  private static recoverTruncatedJSON(text: string): { segments: any[], summary?: string } | null {
    // --- 1. Extract summary ---
    let summary: string | undefined;
    const summaryMatch = text.match(/"summary"\s*:\s*"([\s\S]*?)(?<!\\)"\s*,\s*"segments"/);
    if (summaryMatch) {
      try {
        // Use JSON.parse to unescape the captured summary string
        summary = JSON.parse(`"${summaryMatch[1]}"`);
      } catch {
        summary = summaryMatch[1]; // use raw if unescape fails
      }
    }

    // --- 2. Find the start of the segments array ---
    const segmentsIdx = text.indexOf('"segments"');
    if (segmentsIdx === -1) return null;

    const arrayStart = text.indexOf('[', segmentsIdx);
    if (arrayStart === -1) return null;

    // --- 3. Walk backwards from end to find last complete segment object ---
    // A complete segment ends with `}` at the segment level (depth 1 inside array)
    // We close the substring at that `}` and try to parse the array
    const arraySlice = text.substring(arrayStart);

    // Find the last `}` that could close a segment object.
    // Walk through characters tracking depth; collect positions where depth returns to 1
    // (i.e., a `}` that closes a top-level object inside the array).
    let depth = 0;
    let inString = false;
    let escape = false;
    const closePositions: number[] = []; // positions of `}` closing depth-1 objects

    for (let i = 0; i < arraySlice.length; i++) {
      const ch = arraySlice[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        // A `}` at depth 1 (just exited a top-level object inside the array)
        if (ch === '}' && depth === 1) closePositions.push(i);
        if (depth === 0) break; // We've closed the array — stop
      }
    }

    if (closePositions.length === 0) return null;

    // Use the last recorded close position to build a valid array string
    const lastClose = closePositions[closePositions.length - 1];
    const repairedArray = arraySlice.substring(0, lastClose + 1) + ']';

    try {
      const segments = JSON.parse(repairedArray);
      console.log(`🔧 Recovered ${segments.length} complete segments from truncated response`);
      return { segments, summary };
    } catch {
      return null;
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
   * Diagnose "Failed to fetch" and other network errors, returning a user-friendly
   * Vietnamese message with actionable troubleshooting steps.
   * @param error - The caught error from fetch()
   * @param payloadSizeMB - Optional: estimated request payload size in MB
   */
  private static diagnoseNetworkError(error: any, payloadSizeMB?: number): string {
    const msg: string = (error?.message || String(error)).toLowerCase();

    // ── OOM / heap / string too large ─────────────────────────────────────
    if (
      msg.includes('out of memory') ||
      msg.includes('allocation failed') ||
      msg.includes('maximum call stack') ||
      msg.includes('string too long') ||
      msg.includes('invalid string length')
    ) {
      const sizeHint = payloadSizeMB ? i18n.t('apiErrors.oomSizeHint', { size: payloadSizeMB.toFixed(1) }) : '';
      return i18n.t('apiErrors.oom', { sizeHint });
    }

    // ── Network-level failures: Failed to fetch / Load failed / NetworkError ─
    if (
      msg.includes('failed to fetch') ||
      msg.includes('load failed') ||          // Safari
      msg.includes('networkerror') ||          // Firefox
      msg.includes('network request failed') ||
      msg.includes('fetch is aborted') ||
      msg.includes('the internet connection appears to be offline')
    ) {
      const payloadNote =
        payloadSizeMB && payloadSizeMB > 15
          ? i18n.t('apiErrors.networkPayloadNote', { size: payloadSizeMB.toFixed(1) })
          : '';
      return i18n.t('apiErrors.networkFailed', { payloadNote });
    }

    // ── Timeout / abort ───────────────────────────────────────────────────
    if (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('aborted') ||
      msg.includes('abort')
    ) {
      const sizeHint = payloadSizeMB ? i18n.t('apiErrors.timeoutSizeHint', { size: payloadSizeMB.toFixed(1) }) : '';
      return i18n.t('apiErrors.timeout', { sizeHint });
    }

    // ── Fallback: return original message ──────────────────────────────────
    return error?.message || String(error);
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
    fileManager?: FileManagerService, // Optional: for saving debug logs to project folder
    chunkInfo?: { index: number; total: number }, // Optional: chunk info for progress tracking (1-indexed)
    languageCode?: string, // Optional: language code from Web Speech API config (e.g., 'vi-VN', 'en-US', 'ja-JP')
    maxDurationMinutes: number = 60, // Maximum audio duration in minutes for auto-split (from config)
    onRetryNeeded?: GeminiRetryCallback
  ): Promise<{ results: TranscriptionResult[], summary?: string, isTruncated?: boolean, truncationWarning?: string }> {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('Gemini API Key is required');
    }

    if (!modelName || !modelName.startsWith('models/')) {
      throw new Error('Please select a Gemini model in Settings');
    }

    if (onProgress) onProgress(5, i18n.t('geminiProgress.checkingFormat'));

    // Declare requestBody outside try block for error logging
    let requestBody: any = null;

    try {
      // ============================================================
      // BƯỚC 1: PHÂN TÍCH THỜI LƯỢNG AUDIO TỪ FILE GỐC
      // ============================================================
      if (onProgress) onProgress(10, i18n.t('geminiProgress.analyzingDuration'));
      
      const originalAudioSizeMB = audioBlob.size / (1024 * 1024);
      const audioType = audioBlob.type.toLowerCase();
      console.log(`📊 Bước 1: Phân tích file gốc - ${originalAudioSizeMB.toFixed(2)}MB • ${audioType}`);
      
      const audioDuration = await this.getAudioDuration(audioBlob);
      const durationMinutes = Math.ceil(audioDuration / 60);
      
      console.log(`📊 Thời lượng: ${durationMinutes} phút (${audioDuration}s)`);
      console.log(`⚙️ Config: maxDurationMinutes=${maxDurationMinutes}, skipSizeCheck=${skipSizeCheck}`);

      // ⚠️ Tự động chia nhỏ nếu audio quá dài
      if (!skipSizeCheck && durationMinutes > maxDurationMinutes) {
        console.warn(`⚠️ Audio quá dài (${durationMinutes} phút > ${maxDurationMinutes} phút)`);
        console.log(`🔄 Tự động chia nhỏ theo thời lượng - file sẽ được convert toàn bộ sang WAV một lần`);
        
        if (onProgress) {
          onProgress(15, i18n.t('geminiProgress.audioTooLong', { minutes: durationMinutes }));
        }
        
        // Auto-split into chunks based on duration - pass ORIGINAL audioBlob
        // transcribeEntireAudioWithGemini will convert entire file to WAV once,
        // then extract chunks from WAV (no repeated decoding)
        // Wrap progress callback to map 0-100% of auto-split to 15-100% of overall progress
        const wrappedProgress = onProgress 
          ? (subProgress: number, msg?: string) => {
              // Map 0-100% of transcribeEntireAudioWithGemini to 15-100% overall
              const mappedProgress = 15 + (subProgress * 0.85);
              onProgress(mappedProgress, msg);
            }
          : undefined;
        
        const result = await this.transcribeEntireAudioWithGemini(
          apiKey,
          audioBlob, // Pass ORIGINAL blob - will be converted to WAV once inside
          modelName,
          wrappedProgress, // Use wrapped progress callback
          maxFileSizeMB,
          5, // requestDelaySeconds
          maxDurationMinutes, // Pass through from config
          meetingStartTime,
          summaryPrompt,
          fileManager,
          languageCode, // Pass language code through
          onRetryNeeded
        );
        
        return result;
      }
      
      // ============================================================
      // BƯỚC 2: CHUẨN HÓA SANG WAV MONO 16kHz (luôn thực hiện)
      // ============================================================
      // Always normalize to mono 16kHz WAV regardless of input format.
      // convertToWav() internally skips resampling if audio is already mono 16kHz,
      // so there is no extra cost for already-correct files.
      //
      // WHY always normalize even for .WAV input:
      //   • WAV files can be stereo (Zoom, Teams, Audacity exports) → 2× payload size
      //   • WAV files can be 44100Hz or 48kHz → 2.75–3× payload vs 16kHz
      //   • A stereo 44100Hz 60-min WAV = ~635 MB → base64 ~845 MB → "Failed to fetch"
      let processedAudio = audioBlob;
      {
        const originalSizeMB = audioBlob.size / (1024 * 1024);
        console.log(`🔄 Bước 2: Normalizing audio → mono WAV 16kHz (${audioType}, ${originalSizeMB.toFixed(2)}MB)...`);
        
        if (onProgress) {
          onProgress(18, i18n.t('geminiProgress.normalizingAudio'));
        }
        
        processedAudio = await this.convertToWav(audioBlob, 16000);
        
        const newSizeMB = processedAudio.size / (1024 * 1024);
        const reduction = ((1 - newSizeMB / originalSizeMB) * 100).toFixed(1);
        const reductionType = i18n.t(newSizeMB < originalSizeMB ? 'geminiProgress.sizeReduced' : 'geminiProgress.sizeIncreased');
        
        console.log(`✅ Normalized: ${originalSizeMB.toFixed(2)}MB → ${newSizeMB.toFixed(2)}MB (${reductionType} ${Math.abs(parseFloat(reduction))}%)`);
        
        if (onProgress) {
          const sizeChange = newSizeMB > originalSizeMB ? '📈' : '📉';
          onProgress(22, i18n.t('geminiProgress.normalizedResult', { icon: sizeChange, size: newSizeMB.toFixed(1), type: reductionType, percent: Math.abs(parseFloat(reduction)) }));
        }
      }
      
      if (durationMinutes > maxDurationMinutes) {
        console.log(`ℹ️ Audio dài (${durationMinutes} phút) nhưng skipSizeCheck=true, tiếp tục xử lý`);
      } else {
        console.log(`✅ Thời lượng phù hợp (${durationMinutes} phút ≤ ${maxDurationMinutes} phút)`);
      }
      
      if (onProgress) {
        onProgress(25, i18n.t('geminiProgress.duration', { minutes: durationMinutes }));
      }

      // ============================================================
      // BƯỚC 3: MÃ HÓA VÀ CHUẨN BỊ DỮ LIỆU
      // ============================================================
      // Get MIME type (use WAV if converted)
      const mimeType = processedAudio.type || 'audio/wav';

      // Validate processedAudio before base64 conversion
      if (!processedAudio || processedAudio.size === 0) {
        const errorMsg = chunkInfo 
          ? `Processed audio blob is empty for chunk ${chunkInfo.index}/${chunkInfo.total}. Audio extraction may have failed.`
          : 'Processed audio blob is empty or invalid. Audio conversion may have failed.';
        throw new Error(errorMsg);
      }
      
      // Comprehensive validation
      console.log(`📋 Bước 3: Validating processed audio...`);
      console.log(`  • Size: ${(processedAudio.size / 1024).toFixed(2)} KB`);
      console.log(`  • Type: ${mimeType}`);
      console.log(`  • Is Blob: ${processedAudio instanceof Blob}`);
      console.log(`  • Constructor: ${processedAudio.constructor.name}`);
      if (chunkInfo) {
        console.log(`  • Chunk: ${chunkInfo.index}/${chunkInfo.total}`);
      }
      
      // CRITICAL: Test if blob is actually readable before proceeding
      try {
        // Quick test read to validate blob is readable
        const testSlice = processedAudio.slice(0, Math.min(1024, processedAudio.size));
        console.log(`  • Test slice: ${testSlice.size} bytes`);
        
        // Try to read test slice
        await new Promise<void>((resolve, reject) => {
          const testReader = new FileReader();
          testReader.onloadend = () => {
            if (testReader.result) {
              console.log(`  ✅ Blob is readable (test passed)`);
              resolve();
            } else {
              reject(new Error('Test read failed: reader.result is null'));
            }
          };
          testReader.onerror = () => reject(new Error('Test read error: ' + testReader.error?.message));
          testReader.readAsArrayBuffer(testSlice);
          
          // Timeout after 5 seconds
          setTimeout(() => reject(new Error('Test read timeout after 5s')), 5000);
        });
      } catch (testError: any) {
        console.error('❌ Blob readability test FAILED:', testError);
        throw new Error(`Blob is not readable: ${testError.message}. Possible causes: corrupted data, browser memory limit, or invalid blob format.`);
      }

      // Convert audio blob to base64
      if (onProgress) onProgress(28, i18n.t('geminiProgress.encodingBase64'));
      const base64Audio = await this.blobToBase64(processedAudio);

      // Debug logging before sending
      const processedAudioSizeMB = processedAudio.size / (1024 * 1024);
      const base64SizeKB = (base64Audio.length * 0.75) / 1024; // Approximate size in KB
      console.log('📤 Bước 3: Chuẩn bị gửi đến Gemini:');
      console.log('  • Audio size:', processedAudioSizeMB.toFixed(2), 'MB');
      console.log('  • Duration:', durationMinutes, 'minutes');
      console.log('  • MIME type:', mimeType);
      console.log('  • Base64 size:', base64SizeKB.toFixed(2), 'KB');
      console.log('  • Model:', modelName);
      
      // Display audio info on UI before sending
      if (onProgress) {
        const format = mimeType.split('/')[1]?.toUpperCase() || 'WAV';
        onProgress(32, i18n.t('geminiProgress.prepared', { size: processedAudioSizeMB.toFixed(1), minutes: durationMinutes, format }));
      }

      // ============================================================
      // BƯỚC 4: LẤY THÔNG TIN MODEL VÀ GIỚI HẠN TOKENS
      // ============================================================
      if (onProgress) onProgress(35, i18n.t('geminiProgress.fetchingModel'));
      const modelInfo = await this.getModelInfo(apiKey, modelName);
      console.log(`📊 Bước 4: Model info - ${modelName}`);
      console.log(`  • Output token limit: ${modelInfo.outputTokenLimit}`);
      console.log(`  • Input token limit: ${modelInfo.inputTokenLimit}`);

      if (onProgress) {
        onProgress(38, i18n.t('geminiProgress.modelReady', { name: modelInfo.displayName, tokens: modelInfo.outputTokenLimit }));
      }

      // ============================================================
      // BƯỚC 5: GỬI REQUEST ĐẾN GEMINI AI
      // ============================================================
      if (onProgress) onProgress(40, i18n.t('geminiProgress.sendingToGemini'));

      // 🎯 CHIẾN LƯỢC ƯU TIÊN: Summary trước, Segments sau
      // Check if this is a chunk from a larger file
      const isChunk = chunkInfo && chunkInfo.total > 1;
      
      const adaptiveInstruction = isChunk
        ? `Chunk ${chunkInfo!.index}/${chunkInfo!.total}. Timestamp từ 0:00 (đầu chunk này). Ưu tiên segments verbatim đầy đủ; summary ngắn (~100-150 từ, sẽ merge sau).`
        : `Audio ${durationMinutes} phút. Phiên âm verbatim (chính xác từng câu), giữ nguyên wording.`;

      // Prepare request
      const endpoint = `https://generativelanguage.googleapis.com/${this.GEMINI_API_VERSION}/${modelName}:generateContent?key=${apiKey}`;

      // Determine output language based on languageCode config
      const outputLanguage = languageCode ? (LANG_NAME_MAP[languageCode] || languageCode) : 'Tiếng Việt';
      const languageInstruction = `\n🌐 NGÔN NGỮ OUTPUT: Toàn bộ kết quả (summary và segments) PHẢI viết bằng ${outputLanguage}.`;

      requestBody = {
        contents: [{
          parts: [
            {
              text: `Chuyên gia phiên âm cuộc họp. Nghe file audio và xuất JSON.
${adaptiveInstruction}
${languageInstruction}
Max output: ~${modelInfo.outputTokenLimit} tokens. Audio: ${durationMinutes} phút (đến ${Math.floor(audioDuration/60)}:${String(Math.floor(audioDuration%60)).padStart(2,'0')}).

**SUMMARY** (xuất trước):
${summaryPrompt || 'Tóm tắt chủ đề chính, quyết định, kết luận theo trình tự thời gian. Dùng gạch đầu dòng.'} ${isChunk ? 'Giữ ~100-150 từ.' : 'Giữ ~300-700 từ.'}

**SEGMENTS** (phiên âm chi tiết):
1. ${durationMinutes <= 45 ? 'Verbatim - ghi chính xác từng câu, giữ nguyên wording.' : 'Ghi lại nội dung chính từng lượt nói.'}
2. Gán Speaker 1, Speaker 2... (nhận diện tên nếu tự giới thiệu).
3. Timestamp BẮT ĐẦU lượt nói: ${durationMinutes < 60 ? '[mm:ss]' : '[h:mm:ss]'}, không vượt ${Math.floor(audioDuration/60)}:${String(Math.floor(audioDuration%60)).padStart(2,'0')}.
4. Bỏ từ đệm (à/ừ/ờ/ừm); sửa lỗi nhận dạng; thêm dấu câu; âm không rõ → "[không rõ]".
5. KHÔNG gộp lượt nói, KHÔNG bịa đặt/suy diễn, CHỈ phiên âm nội dung có trong audio.
6. Nếu gần hết token → đóng JSON hợp lệ ngay (summary đã an toàn).

JSON output (không markdown):
{"summary":"...","segments":[{"timestamp":"0:00","speaker":"Người nói 1","text":"..."}]}`
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Audio
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1, // Low temperature for consistent, rule-following behavior
          topK: 40,
          topP: 0.95,
          maxOutputTokens: modelInfo.outputTokenLimit, // Dynamic limit based on selected model
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

      if (onProgress) onProgress(48, i18n.t('geminiProgress.sendingRequest'));

      // Estimate payload size (base64 ≈ 1.33× original) for error diagnostics
      const estimatedPayloadMB = (processedAudio.size * 1.33) / (1024 * 1024);
      console.log(`📤 Estimated request payload: ~${estimatedPayloadMB.toFixed(1)} MB`);

      // Make API request — wrap separately so OOM errors during JSON.stringify are caught
      let bodyString: string;
      try {
        bodyString = JSON.stringify(requestBody);
      } catch (serializeError: any) {
        throw new Error(this.diagnoseNetworkError(serializeError, estimatedPayloadMB));
      }

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: bodyString
        });
      } catch (fetchError: any) {
        // "Failed to fetch" and other network-level errors land here
        throw new Error(this.diagnoseNetworkError(fetchError, estimatedPayloadMB));
      }

      if (onProgress) onProgress(70, i18n.t('geminiProgress.processingResponse'));

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Gemini API error (${response.status}): ${errorData.error?.message || response.statusText}`
        );
      }

      const data = await response.json();
      if (onProgress) onProgress(85, i18n.t('geminiProgress.parsingResult'));

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
        throw new Error(i18n.t('apiErrors.safetyFilter', { reason: data.promptFeedback.blockReason }));
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
      // await this.saveGeminiDebugLog(requestBody, data, {
      //   type: 'audio',
      //   timestamp: new Date().toISOString(),
      //   error: data.error ? data.error.message : undefined
      // }, fileManager);

      // Parse response (now returns { results, summary, isTruncated, truncationWarning })
      const parsed = this.parseGeminiAudioTranscription(data, meetingStartTime);
      
      // ============================================================
      // BƯỚC 6: HOÀN THÀNH
      // ============================================================
      console.log(`✅ Bước 6: Hoàn thành - ${parsed.results.length} segments${parsed.summary ? ' + summary' : ''}`);
      
      // Show completion or warning
      if (parsed.isTruncated && parsed.truncationWarning) {
        console.warn(parsed.truncationWarning);
        if (onProgress) {
          onProgress(100, i18n.t('geminiProgress.completeWithWarning', { count: parsed.results.length }));
        }
      } else {
        if (onProgress) {
          onProgress(100, i18n.t(parsed.summary ? 'geminiProgress.completeWithSummary' : 'geminiProgress.complete', { count: parsed.results.length }));
        }
      }

      return parsed;

    } catch (error: any) {
      console.error('❌ Gemini audio transcription error:', error);
      
      // Save error log
      // try {
      //   await this.saveGeminiDebugLog(requestBody, null, {
      //     type: 'audio',
      //     timestamp: new Date().toISOString(),
      //     error: error.message
      //   }, fileManager);
      // } catch (logError) {
      //   console.error('Failed to save error log:', logError);
      // }
      
      // Don't nest or wrap sentinel errors that App.tsx needs to detect by prefix
      if (error.message?.startsWith('Failed to transcribe audio:') ||
          error.message?.startsWith('RECITATION_ERROR:') ||
          error.message?.startsWith('SAFETY_ERROR:') ||
          error.message?.startsWith('CHUNK_SKIPPED:')) {
        throw error;
      }
      throw new Error(`Failed to transcribe audio: ${error.message}`);
    }
  }

  /**
   * Convert Blob to Base64 string with retry logic
   */
  private static blobToBase64(blob: Blob, retryCount: number = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      // Validate blob before reading
      if (!blob) {
        reject(new Error('Cannot read blob: blob is null or undefined'));
        return;
      }
      
      if (blob.size === 0) {
        reject(new Error('Cannot read blob: blob size is 0 bytes'));
        return;
      }
      
      console.log(`📖 Reading blob (attempt ${retryCount + 1}/3): ${(blob.size / 1024).toFixed(2)} KB, type: ${blob.type || 'unknown'}`);
      
      const reader = new FileReader();
      let timeoutId: NodeJS.Timeout | null = null;
      let completed = false;
      
      // Timeout handler - 30 seconds for large files
      const timeout = Math.max(30000, blob.size / 1024 * 10); // At least 30s, or 10ms per KB
      timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          console.error(`❌ FileReader timeout after ${timeout}ms`);
          console.error('   Blob size:', blob.size);
          console.error('   Reader readyState:', reader.readyState);
          
          // Retry logic
          if (retryCount < 2) {
            console.warn(`⚠️ Retrying blobToBase64 (attempt ${retryCount + 2}/3)...`);
            this.blobToBase64(blob, retryCount + 1)
              .then(resolve)
              .catch(reject);
          } else {
            reject(new Error(`FileReader timeout after ${timeout}ms. Blob may be too large or corrupted.`));
          }
        }
      }, timeout);
      
      reader.onloadend = () => {
        if (completed) return; // Already handled by timeout
        completed = true;
        if (timeoutId) clearTimeout(timeoutId);
        
        console.log(`📊 FileReader completed - readyState: ${reader.readyState}, has result: ${!!reader.result}`);
        
        if (!reader.result) {
          console.error('❌ FileReader.result is null after reading blob');
          console.error('   Blob size:', blob.size);
          console.error('   Blob type:', blob.type);
          console.error('   Blob constructor:', blob.constructor.name);
          console.error('   Reader readyState:', reader.readyState);
          console.error('   Reader error:', reader.error);
          
          // Retry logic
          if (retryCount < 2) {
            console.warn(`⚠️ Retrying blobToBase64 after null result (attempt ${retryCount + 2}/3)...`);
            setTimeout(() => {
              this.blobToBase64(blob, retryCount + 1)
                .then(resolve)
                .catch(reject);
            }, 1000); // Wait 1s before retry
          } else {
            reject(new Error('Failed to read blob: reader.result is null after 3 attempts. Blob may be corrupted or invalid.'));
          }
          return;
        }
        
        const resultStr = reader.result as string;
        const parts = resultStr.split(',');
        
        if (parts.length < 2) {
          console.error('❌ Invalid base64 format - missing comma separator');
          console.error('   Result preview:', resultStr.substring(0, 100));
          reject(new Error('Invalid base64 data: missing comma separator'));
          return;
        }
        
        const base64 = parts[1]; // Remove data:audio/...;base64, prefix
        
        if (!base64 || base64.length === 0) {
          console.error('❌ Base64 data is empty after split');
          reject(new Error('Failed to extract base64 data: empty result'));
          return;
        }
        
        console.log(`✅ Successfully converted blob to base64: ${(base64.length / 1024).toFixed(2)} KB`);
        resolve(base64);
      };
      
      reader.onerror = (event) => {
        if (completed) return; // Already handled
        completed = true;
        if (timeoutId) clearTimeout(timeoutId);
        
        console.error('❌ FileReader.onerror triggered:', event);
        console.error('   Reader error:', reader.error);
        console.error('   Error name:', reader.error?.name);
        console.error('   Error code:', (reader.error as any)?.code);
        
        // Retry logic for errors
        if (retryCount < 2) {
          console.warn(`⚠️ Retrying blobToBase64 after error (attempt ${retryCount + 2}/3)...`);
          setTimeout(() => {
            this.blobToBase64(blob, retryCount + 1)
              .then(resolve)
              .catch(reject);
          }, 1000);
        } else {
          reject(new Error('FileReader error after 3 attempts: ' + (reader.error?.message || 'Unknown error')));
        }
      };
      
      reader.onabort = () => {
        if (completed) return; // Already handled
        completed = true;
        if (timeoutId) clearTimeout(timeoutId);
        
        console.error('❌ FileReader.onabort triggered');
        reject(new Error('FileReader aborted - possible memory limit or browser constraint'));
      };
      
      // Start reading
      try {
        reader.readAsDataURL(blob);
      } catch (readError: any) {
        if (completed) return;
        completed = true;
        if (timeoutId) clearTimeout(timeoutId);
        console.error('❌ Exception when calling readAsDataURL:', readError);
        reject(new Error('Failed to start reading blob: ' + readError.message));
      }
    });
  }

  /**
   * Get audio duration in seconds from Blob
   */
  /**
   * Get audio duration WITHOUT calling decodeAudioData (which OOMs large files).
   *
   * Uses the HTML5 <audio> element's loadedmetadata event instead.
   * For streaming WebM files whose `duration` is Infinity, falls back to seeking
   * to a large timestamp so the browser scans to the end and reports real duration.
   *
   * If the element cannot determine duration within 10 s, falls back to a rough
   * byte-based estimate to avoid blocking the caller indefinitely.
   */
  private static async getAudioDuration(audioBlob: Blob): Promise<number> {
    return new Promise((resolve) => {
      const url   = URL.createObjectURL(audioBlob);
      const audio = new Audio();
      audio.preload = 'metadata';

      let settled = false;
      const settle = (dur: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(bail);
        URL.revokeObjectURL(url);
        resolve(dur > 0 && isFinite(dur) ? dur : estimateFromSize(audioBlob));
      };

      // Bail-out after 10 seconds — don't block transcription forever
      const bail = setTimeout(() => {
        console.warn('[getAudioDuration] Timeout — estimating from file size');
        settle(estimateFromSize(audioBlob));
      }, 10_000);

      const onTimeUpdate = () => {
        if (isFinite(audio.duration) && audio.duration > 0) {
          audio.removeEventListener('timeupdate', onTimeUpdate);
          settle(audio.duration);
        }
      };

      audio.addEventListener('loadedmetadata', () => {
        if (isFinite(audio.duration) && audio.duration > 0) {
          settle(audio.duration);
        } else {
          // Infinity duration: streaming WebM without Duration header.
          // Seek trick: jump to end so the browser scans the whole file.
          audio.addEventListener('timeupdate', onTimeUpdate);
          audio.currentTime = 1e9;
        }
      }, { once: true });

      audio.addEventListener('error', () => {
        console.warn('[getAudioDuration] Audio element error — estimating from size');
        settle(estimateFromSize(audioBlob));
      }, { once: true });

      audio.src = url;
    });

    function estimateFromSize(blob: Blob): number {
      // WebM/Opus  ≈ 16 000 bytes/s (128 kbps)
      // WAV 16-bit mono 16 kHz = 32 000 bytes/s
      const isWav = blob.type.includes('wav');
      return blob.size / (isWav ? 32_000 : 16_000);
    }
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
          
          if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            throw new Error('Failed to read audio file: ArrayBuffer is empty');
          }
          
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          // Always resample+downmix: ensures mono output at target sample rate
          // even if decodeAudioData already returns the right sample rate (could still be stereo)
          const needsProcessing = audioBuffer.sampleRate !== targetSampleRate || audioBuffer.numberOfChannels > 1;
          let finalBuffer = audioBuffer;
          if (needsProcessing) {
            console.log(`🔊 Resampling+Downmix: ${audioBuffer.numberOfChannels}ch ${audioBuffer.sampleRate}Hz → 1ch ${targetSampleRate}Hz`);
            finalBuffer = await this.resampleAudioBuffer(audioBuffer, targetSampleRate);
          } else {
            console.log(`✅ Audio đã đúng format (mono, ${targetSampleRate}Hz) - bỏ qua convert`);
          }

          // Convert to WAV
          const wavBlob = this.audioBufferToWav(finalBuffer);
          
          // Validate the output blob
          if (!wavBlob || wavBlob.size === 0) {
            throw new Error('Failed to convert audio: Output WAV blob is empty');
          }
          
          // CRITICAL: Verify blob is actually valid
          console.log(`✅ Converted to WAV: ${(wavBlob.size / 1024).toFixed(2)} KB`);
          console.log(`   • Blob type: ${wavBlob.type}`);
          console.log(`   • Blob size: ${wavBlob.size} bytes`);
          console.log(`   • Is Blob: ${wavBlob instanceof Blob}`);
          console.log(`   • Constructor: ${wavBlob.constructor.name}`);
          
          resolve(wavBlob);
        } catch (error) {
          console.error('❌ Error in convertToWav:', error);
          reject(error);
        } finally {
          // Clean up audio context
          try {
            await audioContext.close();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      };

      reader.onerror = (event) => {
        console.error('❌ FileReader error in convertToWav:', event);
        reject(new Error('Failed to read audio file: ' + (reader.error?.message || 'Unknown error')));
      };
      
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  /**
   * Resample AudioBuffer to target sample rate AND force mono
   * Always outputs 1-channel (mono) regardless of input channels.
   * Web Audio API automatically downmixes stereo→mono when destination has 1 channel.
   * This ensures deterministic WAV size across different machines/browsers.
   */
  private static async resampleAudioBuffer(audioBuffer: AudioBuffer, targetSampleRate: number): Promise<AudioBuffer> {
    const outputChannels = 1; // Force mono — reduces file size by 50% for stereo sources
    // Use Math.ceil to ensure integer sample count (required by OfflineAudioContext)
    const outputLength = Math.ceil(audioBuffer.duration * targetSampleRate);
    const offlineContext = new OfflineAudioContext(outputChannels, outputLength, targetSampleRate);

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    // Web Audio API automatically downmixes multi-channel → mono destination
    source.connect(offlineContext.destination);
    source.start();

    return await offlineContext.startRendering();
  }

  /**
   * Convert AudioBuffer to WAV Blob
   */
  private static audioBufferToWav(audioBuffer: AudioBuffer): Blob {
    // Validate input
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Cannot convert empty AudioBuffer to WAV');
    }
    
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
    
    if (dataLength === 0) {
      throw new Error('Cannot create WAV: No audio data to write');
    }
    
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
   * Calculate chunk boundaries based on DURATION only WITHOUT extracting blobs
   * This saves memory by not creating all chunk blobs upfront
   * Note: With just-in-time extraction, size is no longer a memory concern
   * @param audioBlob - Audio blob to analyze (should be WAV format)
   * @param _maxChunkSizeMB - (Unused, kept for API compatibility)
   * @param maxDurationMinutes - Maximum duration per chunk in minutes (default: 60)
   * @returns Array of chunk boundaries with startTimeMs, endTimeMs (NO blobs)
   */
  public static async calculateChunkBoundaries(
    audioBlob: Blob,
    maxChunkSizeMB: number = 200,
    maxDurationMinutes: number = 60
  ): Promise<{ startTimeMs: number; endTimeMs: number }[]> {
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

          // Calculate number of chunks needed based on BOTH duration AND size
          // Take the MORE RESTRICTIVE of the two constraints
          const chunksNeededByDuration = Math.ceil(totalDurationMinutes / maxDurationMinutes);
          const chunksNeededBySize = Math.ceil(totalSizeMB / maxChunkSizeMB);
          const numberOfChunks = Math.max(chunksNeededByDuration, chunksNeededBySize);
          
          const chunkDurationMs = totalDurationMs / numberOfChunks;
          const chunkDurationMinutes = chunkDurationMs / (60 * 1000);
          const chunkSizeMB = totalSizeMB / numberOfChunks;

          console.log(`📏 Audio info: ${totalSizeMB.toFixed(2)}MB, ${totalDurationMinutes.toFixed(1)} minutes`);
          console.log(`📊 Limits: ${maxDurationMinutes}min OR ${maxChunkSizeMB}MB per chunk`);
          console.log(`📊 Chunks needed: ${chunksNeededByDuration} (duration) vs ${chunksNeededBySize} (size)`);
          console.log(`📦 Will split into ${numberOfChunks} chunks (most restrictive)`);
          console.log(`⏱️ Each chunk: ~${chunkDurationMinutes.toFixed(1)}min, ~${chunkSizeMB.toFixed(2)}MB`);

          const boundaries: { startTimeMs: number; endTimeMs: number }[] = [];

          for (let i = 0; i < numberOfChunks; i++) {
            const startTimeMs = i * chunkDurationMs;
            const endTimeMs = Math.min((i + 1) * chunkDurationMs, totalDurationMs);

            console.log(`📍 Boundary ${i + 1}/${numberOfChunks}: ${startTimeMs.toFixed(0)}ms - ${endTimeMs.toFixed(0)}ms`);

            boundaries.push({
              startTimeMs,
              endTimeMs
            });
          }

          resolve(boundaries);
        } catch (error) {
          console.error('❌ Error in calculateChunkBoundaries:', error);
          reject(error);
        } finally {
          // Clean up audio context
          try {
            await audioContext.close();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      };

      reader.onerror = reject;
      reader.readAsArrayBuffer(audioBlob);
    });
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

            try {
              const chunkBlob = await this.extractAudioSegment(audioBlob, startTimeMs, endTimeMs);
              
              // Validate chunk blob
              if (!chunkBlob || chunkBlob.size === 0) {
                throw new Error(`Extracted blob is empty`);
              }
              
              console.log(`  ✅ Chunk ${i + 1}: ${(chunkBlob.size / 1024).toFixed(2)} KB`);

              chunks.push({
                blob: chunkBlob,
                startTimeMs,
                endTimeMs
              });
            } catch (error: any) {
              throw new Error(`Failed to extract chunk ${i + 1}/${numberOfChunks} (${startTimeMs.toFixed(0)}-${endTimeMs.toFixed(0)}ms): ${error.message}`);
            }
            
            // Small delay between extractions to prevent browser overload
            if (i < numberOfChunks - 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }

          resolve(chunks);
        } catch (error) {
          console.error('❌ Error in splitAudioIntoChunks:', error);
          reject(error);
        } finally {
          // Clean up audio context
          try {
            await audioContext.close();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      };

      reader.onerror = reject;
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  /**
   * Extract WAV segment using direct binary slicing (FAST, memory-efficient)
   * Works by slicing the WAV data chunk directly without decoding
   * 
   * CRITICAL: This assumes WAV is mono 16kHz 16-bit (our standard format)
   * If WAV format differs, this may not work correctly
   */
  private static async extractWavSegmentDirect(
    wavBlob: Blob,
    startTimeMs: number,
    endTimeMs: number
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          if (!arrayBuffer) {
            throw new Error('Failed to read WAV blob');
          }
          
          const view = new DataView(arrayBuffer);
          
          // Parse WAV header (assuming standard format)
          // RIFF header: "RIFF" (4) + file size (4) + "WAVE" (4) = 12 bytes
          // fmt chunk: "fmt " (4) + size (4) + format data = ~24 bytes
          // data chunk: "data" (4) + size (4) + PCM data
          
          // Find data chunk (typically starts at byte 44 for standard WAV)
          let dataOffset = 44;
          const dataMarker = view.getUint32(36, false); // Should be "data" = 0x64617461
          if (dataMarker !== 0x64617461) {
            // Try to find data chunk
            for (let i = 12; i < arrayBuffer.byteLength - 8; i++) {
              if (view.getUint32(i, false) === 0x64617461) {
                dataOffset = i + 8; // Skip "data" + size
                break;
              }
            }
          }
          
          // Get sample rate and calculate byte rate
          const sampleRate = view.getUint32(24, true); // Sample rate at byte 24
          const numChannels = view.getUint16(22, true); // Channels at byte 22
          const bitsPerSample = view.getUint16(34, true); // Bits per sample at byte 34
          const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
          
          console.log(`📊 WAV format: ${sampleRate}Hz, ${numChannels}ch, ${bitsPerSample}-bit`);
          console.log(`📊 Byte rate: ${byteRate} bytes/sec, data offset: ${dataOffset}`);
          
          // Calculate byte positions for segment
          const startByte = dataOffset + Math.floor((startTimeMs / 1000) * byteRate);
          const endByte = dataOffset + Math.floor((endTimeMs / 1000) * byteRate);
          
          // Ensure byte alignment (samples should be aligned to frame boundary)
          const frameSize = numChannels * (bitsPerSample / 8);
          const alignedStartByte = Math.floor((startByte - dataOffset) / frameSize) * frameSize + dataOffset;
          const alignedEndByte = Math.floor((endByte - dataOffset) / frameSize) * frameSize + dataOffset;
          
          console.log(`🔪 Extracting bytes ${alignedStartByte} to ${alignedEndByte}`);
          
          // Extract segment data
          const segmentDataSize = alignedEndByte - alignedStartByte;
          const segmentData = arrayBuffer.slice(alignedStartByte, alignedEndByte);
          
          // Build new WAV header for segment
          const wavHeader = new ArrayBuffer(44);
          const headerView = new DataView(wavHeader);
          
          // RIFF header
          headerView.setUint32(0, 0x52494646, false); // "RIFF"
          headerView.setUint32(4, 36 + segmentDataSize, true); // File size - 8
          headerView.setUint32(8, 0x57415645, false); // "WAVE"
          
          // fmt chunk
          headerView.setUint32(12, 0x666d7420, false); // "fmt "
          headerView.setUint32(16, 16, true); // fmt chunk size
          headerView.setUint16(20, 1, true); // Audio format (1 = PCM)
          headerView.setUint16(22, numChannels, true); // Channels
          headerView.setUint32(24, sampleRate, true); // Sample rate
          headerView.setUint32(28, byteRate, true); // Byte rate
          headerView.setUint16(32, frameSize, true); // Block align
          headerView.setUint16(34, bitsPerSample, true); // Bits per sample
          
          // data chunk
          headerView.setUint32(36, 0x64617461, false); // "data"
          headerView.setUint32(40, segmentDataSize, true); // Data size
          
          // Combine header + segment data
          const segmentBlob = new Blob([wavHeader, segmentData], { type: 'audio/wav' });
          
          console.log(`✅ Direct WAV extraction: ${(segmentBlob.size / 1024).toFixed(2)} KB`);
          resolve(segmentBlob);
          
        } catch (error) {
          console.error('❌ Direct WAV extraction failed:', error);
          reject(error);
        }
      };
      
      reader.onerror = () => {
        reject(new Error('Failed to read WAV blob: ' + (reader.error?.message || 'Unknown error')));
      };
      
      reader.readAsArrayBuffer(wavBlob);
    });
  }

  /**
   * Extract a segment from audio blob based on time range
   * @param audioBlob - Audio blob (should be WAV for best performance)
   * @param startTimeMs - Start time in milliseconds
   * @param endTimeMs - End time in milliseconds
   * @returns Promise<Blob> - Audio segment blob in WAV format
   */
  public static async extractAudioSegment(
    audioBlob: Blob,
    startTimeMs: number,
    endTimeMs: number
  ): Promise<Blob> {
    // OPTIMIZATION: For WAV files, use direct binary slicing instead of decoding
    // This is MUCH faster and uses minimal memory compared to AudioContext
    const isWav = audioBlob.type.includes('wav');
    
    if (isWav) {
      try {
        console.log(`🚀 Using direct WAV extraction (fast, memory-efficient)`);
        return await this.extractWavSegmentDirect(audioBlob, startTimeMs, endTimeMs);
      } catch (error) {
        console.warn('⚠️ Direct WAV extraction failed, falling back to AudioContext:', error);
        // Fall through to AudioContext method
      }
    }
    
    // Fallback: Use AudioContext for non-WAV or if direct extraction fails
    console.log(`⚠️ Using AudioContext extraction (slow, memory-intensive)`);
    return new Promise((resolve, reject) => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          
          if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            throw new Error('Failed to read audio blob: ArrayBuffer is empty');
          }
          
          console.warn(`⚠️ Decoding ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)}MB audio - may be slow...`);
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          // Calculate start and end in samples
          const startSample = Math.floor((startTimeMs / 1000) * audioBuffer.sampleRate);
          const endSample = Math.floor((endTimeMs / 1000) * audioBuffer.sampleRate);
          const segmentLength = endSample - startSample;
          
          if (segmentLength <= 0) {
            throw new Error(`Invalid segment length: ${segmentLength} samples (start: ${startSample}, end: ${endSample})`);
          }

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
          
          // Validate output blob
          if (!wavBlob || wavBlob.size === 0) {
            throw new Error('Failed to create WAV blob: Output is empty');
          }
          
          console.log(`✅ Extracted segment: ${startTimeMs}ms-${endTimeMs}ms`);
          console.log(`   • Blob size: ${(wavBlob.size / 1024).toFixed(2)} KB`);
          console.log(`   • Blob type: ${wavBlob.type}`);
          console.log(`   • Is Blob: ${wavBlob instanceof Blob}`);
          
          resolve(wavBlob);
        } catch (error) {
          console.error('❌ Error in extractAudioSegment:', error);
          reject(error);
        } finally {
          // CRITICAL: Clean up audio context to prevent browser limits
          try {
            await audioContext.close();
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      };

      reader.onerror = (event) => {
        console.error('❌ FileReader error in extractAudioSegment:', event);
        reject(new Error('Failed to read audio blob: ' + (reader.error?.message || 'Unknown error')));
      };
      
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  // ============================================================
  // MEMORY-SAFE BINARY CHUNKED PROCESSING (IndexedDB-backed)
  // ============================================================

  /**
   * Calls `fn(apiKey)` and automatically retries up to 2 times on ANY error
   * with linear back-off (5 s → 10 s).  After exhausting auto retries, delegates
   * to `onRetryNeeded` so the user can decide whether to continue, optionally
   * supply a replacement API key, or skip the chunk entirely.
   *
   * All errors are treated uniformly — no special-casing for 429, quota,
   * transient server errors, RECITATION, SAFETY, etc.  The raw error message
   * is always surfaced to the user so they have full context to decide.
   */
  private static async callWithGeminiRetry<T>(
    fn: (apiKey: string) => Promise<T>,
    initialApiKey: string,
    chunkIdx: number,
    chunkTotal: number,
    onProgress: ((p: number, msg?: string) => void) | undefined,
    progressVal: number,
    onRetryNeeded: GeminiRetryCallback | undefined,
    logPrefix: string
  ): Promise<{ result: T; finalApiKey: string }> {
    const MAX_AUTO = 2;
    const BASE_DELAY_MS = 5_000;
    let currentKey = initialApiKey;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const result = await fn(currentKey);
        return { result, finalApiKey: currentKey };
      } catch (err: any) {
        attempt++;
        if (attempt <= MAX_AUTO) {
          const delayMs = BASE_DELAY_MS * attempt;
          console.warn(`[${logPrefix}] Chunk ${chunkIdx}/${chunkTotal} error (attempt ${attempt}/${MAX_AUTO}), retrying in ${delayMs/1000}s: ${err.message}`);
          onProgress?.(progressVal,
            i18n.t('geminiProgress.autoRetry', { current: chunkIdx, total: chunkTotal, attempt, maxAttempt: MAX_AUTO, delay: delayMs / 1000 }));
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }

        // Auto-retries exhausted — ask the user
        if (onRetryNeeded) {
          onProgress?.(progressVal,
            i18n.t('geminiProgress.askUserRetry', { current: chunkIdx, total: chunkTotal, maxAttempt: MAX_AUTO }));
          const { retry, skip, newApiKey } = await onRetryNeeded({
            chunkIndex: chunkIdx,
            chunkTotal,
            attempt: MAX_AUTO, // how many auto-retries were done (not attempt+1)
            error: err.message,
            currentApiKey: currentKey,
            isNonRetryable: false, // no longer distinguished — user sees raw error
          });
          if (retry) {
            if (newApiKey && newApiKey.trim()) currentKey = newApiKey.trim();
            attempt = 0; // reset counter for user-approved round
            continue;
          }
          if (skip) throw new Error(`CHUNK_SKIPPED: ${err.message}`);
        }
        throw err; // user chose Stop, or no callback provided
      }
    }
  }

  /**
   * Shared IDB processing loop used by both WebM (EBML) and WAV binary-split paths.
   *
   * Precondition: chunks have already been stored in `chunkStorage` under `sessionId`.
   * Each stored chunk Blob may be WebM or WAV — `convertToWav()` handles both.
   *
   * Memory profile per chunk:
   *   read from IDB → decode small chunk (~50–200 MB PCM peak) → send WAV to Gemini
   *   → delete from IDB immediately → GC
   */
  private static async processChunksFromIDB(
    sessionId: string,
    chunkBoundaries: Array<{ startMs: number; endMs: number }>,
    apiKey: string,
    modelName: string,
    onProgress: ((p: number, msg?: string) => void) | undefined,
    progressBase: number,    // progress value at start of loop  (e.g. 15)
    progressRange: number,   // progress points allocated to loop (e.g. 80)
    maxFileSizeMB: number,
    requestDelaySeconds: number,
    maxDurationMinutes: number,
    meetingStartTime: Date | undefined,
    summaryPrompt: string | undefined,
    fileManager: FileManagerService | undefined,
    languageCode: string | undefined,
    logPrefix: string,
    onRetryNeeded?: GeminiRetryCallback
  ): Promise<{ results: TranscriptionResult[], summary?: string, isTruncated?: boolean, truncationWarning?: string }> {
    const chunkCount = chunkBoundaries.length;
    const allResults: TranscriptionResult[] = [];
    const allSummaries: string[] = [];
    let hasTruncation = false;
    const truncationWarnings: string[] = [];
    let currentApiKey = apiKey; // may be updated by onRetryNeeded callback

    for (let i = 0; i < chunkCount; i++) {
      const boundary = chunkBoundaries[i];
      const chunkProgressBase = progressBase + Math.round((i / chunkCount) * progressRange);
      const chunkDurationMin = Math.round((boundary.endMs - boundary.startMs) / 60000);

      if (onProgress) {
        onProgress(
          chunkProgressBase,
          i18n.t('geminiProgress.idbChunkStart', { current: i + 1, total: chunkCount, from: (boundary.startMs / 60000).toFixed(0), to: (boundary.endMs / 60000).toFixed(0), dur: chunkDurationMin })
        );
      }

      let chunkRecord: import('./chunkStorage').StoredChunk | null = null;
      try {
        // Read chunk from IDB
        chunkRecord = await chunkStorage.getChunk(sessionId, i);
        if (!chunkRecord) {
          throw new Error(`Chunk ${i} not found in IndexedDB`);
        }

        const chunkSizeMB = (chunkRecord.blob.size / 1024 / 1024).toFixed(1);
        console.log(`[${logPrefix}] Processing chunk ${i + 1}/${chunkCount}: ${chunkSizeMB} MB`);

        // Convert small chunk → WAV (safe: small decode footprint)
        if (onProgress) {
          onProgress(chunkProgressBase + 1, i18n.t('geminiProgress.chunkConverting', { current: i + 1, total: chunkCount }));
        }
        const wavBlob = await this.convertToWav(chunkRecord.blob, 16000);

        // Send WAV to Gemini (with transient-error auto-retry + user prompt after)
        const { result: parsed, finalApiKey: usedKey } = await AIRefinementService.callWithGeminiRetry(
          (key) => this.transcribeAudioWithGemini(
            key,
            wavBlob,
            modelName,
            (subProgress, subMsg) => {
              if (onProgress) {
                const mapped = chunkProgressBase + Math.round((subProgress / 100) * (progressRange / chunkCount));
                onProgress(mapped, `📦 ${i + 1}/${chunkCount}: ${subMsg ?? subProgress.toFixed(0) + '%'}`);
              }
            },
            true, // skipSizeCheck
            maxFileSizeMB,
            meetingStartTime,
            summaryPrompt,
            fileManager,
            { index: i + 1, total: chunkCount },
            languageCode,
            maxDurationMinutes
          ),
          currentApiKey,
          i + 1, chunkCount, onProgress, chunkProgressBase + 1, onRetryNeeded, logPrefix
        );
        currentApiKey = usedKey;

        // Adjust timestamps and collect results
        const adjustedResults = this.adjustTimestamps(parsed.results, boundary.startMs);
        allResults.push(...adjustedResults);
        console.log(`[${logPrefix}] Chunk ${i + 1}: ${adjustedResults.length} segments`);

        if (parsed.summary) {
          allSummaries.push(`Phần ${i + 1}/${chunkCount}: ${parsed.summary}`);
        }
        if (parsed.isTruncated) {
          hasTruncation = true;
          if (parsed.truncationWarning) truncationWarnings.push(parsed.truncationWarning);
        }

        if (onProgress) {
          onProgress(
            chunkProgressBase + Math.round(progressRange / chunkCount),
            i18n.t('geminiProgress.chunkDone', { current: i + 1, total: chunkCount, count: adjustedResults.length })
          );
        }

      } catch (chunkErr: any) {
        if (chunkErr.message?.startsWith('CHUNK_SKIPPED:')) {
          const originalMsg = chunkErr.message.replace(/^CHUNK_SKIPPED:\s*/, '');
          console.warn(`[${logPrefix}] Chunk ${i + 1} skipped by user: ${originalMsg}`);
          truncationWarnings.push(i18n.t('apiErrors.idbChunkSkipped', { current: i + 1, total: chunkCount, reason: originalMsg }));
          if (onProgress) onProgress(chunkProgressBase + Math.round(progressRange / chunkCount), i18n.t('geminiProgress.chunkSkipped', { current: i + 1 }));
          continue; // finally still runs (IDB cleanup), then skip rate-limit delay
        } else if (chunkErr.message?.includes('429') || chunkErr.message?.includes('quota')) {
          await chunkStorage.deleteSession(sessionId).catch(() => {});
          throw new Error(
            i18n.t('apiErrors.idbChunkQuota', { current: i + 1, total: chunkCount, done: i, errorMsg: chunkErr.message })
          );
        } else {
          await chunkStorage.deleteSession(sessionId).catch(() => {});
          throw chunkErr;
        }
      } finally {
        // Delete from IDB immediately to free browser quota
        if (chunkRecord) {
          await chunkStorage.deleteChunk(sessionId, i).catch(() => {});
        }
      }

      // Rate-limit delay (skip after last chunk)
      if (i < chunkCount - 1) {
        if (onProgress) onProgress(
          chunkProgressBase + Math.round(progressRange / chunkCount),
          i18n.t('geminiProgress.waitingRateLimit', { seconds: requestDelaySeconds })
        );
        await new Promise(r => setTimeout(r, requestDelaySeconds * 1000));
      }
    }

    // Final IDB cleanup (safety net for any leftover records)
    await chunkStorage.deleteSession(sessionId).catch(() => {});

    allResults.sort((a, b) => (a.audioTimeMs ?? 0) - (b.audioTimeMs ?? 0));

    console.log(`[${logPrefix}] Complete: ${allResults.length} segments from ${chunkCount} chunks`);
    if (onProgress) onProgress(progressBase + progressRange, i18n.t('geminiProgress.allChunksDone', { segments: allResults.length, parts: chunkCount }));

    // ── Tổng hợp tóm tắt (Bước cuối) ───────────────────────────────────────────
    let combinedSummary: string | undefined;
    if (allSummaries.length === 0) {
      combinedSummary = undefined;
    } else if (allSummaries.length === 1) {
      combinedSummary = allSummaries[0].replace(/^Phần \d+\/\d+:\s*/, '');
    } else {
      // Nhiều phần → gọi Gemini để tổng hợp thành 1 bản liền mạch
      if (onProgress) onProgress(progressBase + progressRange + 2, i18n.t('geminiProgress.mergingSummary', { count: allSummaries.length }));
      combinedSummary = await this.mergeSummariesWithRetry(
        currentApiKey, modelName, allSummaries, summaryPrompt, languageCode,
        onProgress, progressBase + progressRange + 2, logPrefix, onRetryNeeded
      );
      if (onProgress) onProgress(progressBase + progressRange + 4, i18n.t('geminiProgress.summaryMerged'));
    }

    if (onProgress) onProgress(100, i18n.t('geminiProgress.allDone', { count: allResults.length }));

    return {
      results           : allResults,
      summary           : combinedSummary,
      isTruncated       : hasTruncation || truncationWarnings.length > 0,
      truncationWarning : truncationWarnings.length > 0 ? truncationWarnings.join('\n') : undefined,
    };
  }

  /**
   * Memory-safe path for large WebM files: EBML binary scan → IDB → chunked decode.
   * Avoids decoding the entire file into PCM (which OOMs for 180-min recordings).
   */
  private static async transcribeEntireAudioWithGeminiChunked(
    apiKey: string,
    audioBlob: Blob,
    modelName: string,
    onProgress?: (progress: number, message?: string) => void,
    maxFileSizeMB: number = 20,
    requestDelaySeconds: number = 5,
    maxDurationMinutes: number = 30,
    meetingStartTime?: Date,
    summaryPrompt?: string,
    fileManager?: FileManagerService,
    languageCode?: string,
    onRetryNeeded?: GeminiRetryCallback
  ): Promise<{ results: TranscriptionResult[], summary?: string, isTruncated?: boolean, truncationWarning?: string }> {

    const sessionId = `wmc_${Date.now()}_${audioBlob.size}`;
    const maxChunkMs = maxDurationMinutes * 60 * 1000;
    const audioSizeMB = audioBlob.size / (1024 * 1024);

    console.log(`[ChunkedGemini] EBML-based chunked transcription: ${audioSizeMB.toFixed(1)} MB`);

    // Pre-transcription setup errors use the 'EBML_PRE_TRANSCRIPTION_FAILED' sentinel
    // so the outer caller can fall back to the legacy path safely.
    // Gemini API errors (Phase 3) are NOT sentinels and must always propagate.
    if (onProgress) onProgress(2, i18n.t('geminiProgress.analyzingWebm'));

    // ── Phase 1: EBML split (pure computation, no IDB) ───────────────────────
    let webmChunks: import('./webmSplitter').WebmChunk[];
    try {
      webmChunks = await splitWebmIntoChunks(audioBlob, maxChunkMs, (p, msg) => {
        if (onProgress) onProgress(2 + Math.round(p * 0.13), msg);
      });

      if (webmChunks.length === 1 && webmChunks[0].blob === audioBlob) {
        throw new Error('EBML_NO_CLUSTERS');
      }

      console.log(`[ChunkedGemini] Split into ${webmChunks.length} WebM chunks`);
    } catch (setupErr: any) {
      // Re-throw as a well-known sentinel so the outer caller recognises this
      // as a pre-transcription failure (safe to fall back to legacy).
      if (setupErr.message === 'EBML_NO_CLUSTERS') throw setupErr; // passthrough
      throw new Error(`EBML_PRE_TRANSCRIPTION_FAILED: ${setupErr.message}`);
    }

    // ── Phase 2+3: IDB storage + Gemini processing ───────────────────────────
    // Hold a shared Web Lock for the entire IDB session so that startup cleanup
    // in other tabs (clearOrphanChunks) cannot delete these chunks mid-flight.
    return chunkStorage.withActiveSession(async () => {
      let chunkBoundaries: Array<{ startMs: number; endMs: number }>;
      try {
        if (onProgress) onProgress(15, i18n.t('geminiProgress.savingChunksWebm', { count: webmChunks.length }));
        await chunkStorage.storeChunks(sessionId, webmChunks.map(c => ({
          startMs: c.startMs, endMs: c.endMs, blob: c.blob,
        })));

        chunkBoundaries = webmChunks.map(c => ({ startMs: c.startMs, endMs: c.endMs }));
        (webmChunks as any) = null; // release from JS heap (now in IDB)
      } catch (storeErr: any) {
        throw new Error(`EBML_PRE_TRANSCRIPTION_FAILED: ${storeErr.message}`);
      }

      // Errors from this phase are transcription errors and must NOT fall back.
      return this.processChunksFromIDB(
        sessionId, chunkBoundaries,
        apiKey, modelName, onProgress,
        15, 81, // progressBase=15, progressRange=81 → reaches 96
        maxFileSizeMB, requestDelaySeconds, maxDurationMinutes,
        meetingStartTime, summaryPrompt, fileManager, languageCode,
        'ChunkedGemini', onRetryNeeded
      );
    });
  }

  /**
   * Memory-safe path for large WAV files: binary header parse → direct PCM slice
   * → IDB → chunked decode.  No AudioContext.decodeAudioData() on the full file.
   */
  private static async transcribeEntireAudioWithGeminiChunkedWav(
    apiKey: string,
    audioBlob: Blob,
    modelName: string,
    onProgress?: (progress: number, message?: string) => void,
    maxFileSizeMB: number = 20,
    requestDelaySeconds: number = 5,
    maxDurationMinutes: number = 30,
    meetingStartTime?: Date,
    summaryPrompt?: string,
    fileManager?: FileManagerService,
    languageCode?: string,
    onRetryNeeded?: GeminiRetryCallback
  ): Promise<{ results: TranscriptionResult[], summary?: string, isTruncated?: boolean, truncationWarning?: string }> {

    const sessionId = `wmcwav_${Date.now()}_${audioBlob.size}`;
    const maxChunkMs = maxDurationMinutes * 60 * 1000;
    const audioSizeMB = audioBlob.size / (1024 * 1024);

    console.log(`[ChunkedGeminiWav] WAV binary-split chunked transcription: ${audioSizeMB.toFixed(1)} MB`);

    // Same sentinel strategy as the WebM path: WAV_PRE_TRANSCRIPTION_FAILED for
    // setup failures (safe to fall back), direct throw for Gemini API errors.
    if (onProgress) onProgress(2, i18n.t('geminiProgress.analyzingWav'));

    // ── Phase 1: WAV binary split (pure computation, no IDB) ────────────────
    let wavChunks: import('./webmSplitter').WebmChunk[];
    try {
      wavChunks = await splitWavIntoChunks(audioBlob, maxChunkMs, (p, msg) => {
        if (onProgress) onProgress(2 + Math.round(p * 0.13), msg);
      });

      console.log(`[ChunkedGeminiWav] Split into ${wavChunks.length} WAV chunks`);
    } catch (setupErr: any) {
      throw new Error(`WAV_PRE_TRANSCRIPTION_FAILED: ${setupErr.message}`);
    }

    // ── Phase 2+3: IDB storage + Gemini processing ───────────────────────────
    // Hold a shared Web Lock for the entire IDB session so that startup cleanup
    // in other tabs (clearOrphanChunks) cannot delete these chunks mid-flight.
    return chunkStorage.withActiveSession(async () => {
      let chunkBoundaries: Array<{ startMs: number; endMs: number }>;
      try {
        if (onProgress) onProgress(15, i18n.t('geminiProgress.savingChunksWav', { count: wavChunks.length }));
        await chunkStorage.storeChunks(sessionId, wavChunks.map(c => ({
          startMs: c.startMs, endMs: c.endMs, blob: c.blob,
        })));

        chunkBoundaries = wavChunks.map(c => ({ startMs: c.startMs, endMs: c.endMs }));
        (wavChunks as any) = null; // release from JS heap
      } catch (storeErr: any) {
        throw new Error(`WAV_PRE_TRANSCRIPTION_FAILED: ${storeErr.message}`);
      }

      return this.processChunksFromIDB(
        sessionId, chunkBoundaries,
        apiKey, modelName, onProgress,
        15, 81,
        maxFileSizeMB, requestDelaySeconds, maxDurationMinutes,
        meetingStartTime, summaryPrompt, fileManager, languageCode,
        'ChunkedGeminiWav', onRetryNeeded
      );
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
    fileManager?: FileManagerService, // Optional: for saving debug logs to project folder
    languageCode?: string, // Optional: language code from Web Speech API config
    onRetryNeeded?: GeminiRetryCallback
  ): Promise<{ results: TranscriptionResult[], summary?: string, isTruncated?: boolean, truncationWarning?: string }> {
    const maxSizeMB = maxFileSizeMB;

    // ============================================================
    // FAST PATH: EBML-based chunking for large WebM files (avoids OOM)
    // ============================================================
    // For WebM files, calling convertToWav() on the ENTIRE blob requires
    // AudioContext.decodeAudioData() which allocates ~830 MB – 2.5 GB of PCM
    // memory for a 180-minute file, causing an Out-of-Memory crash.
    //
    // Solution: use the EBML binary splitter to cut the WebM file into smaller
    // chunks WITHOUT decoding, store them in IndexedDB, then decode each chunk
    // individually (small memory footprint) before sending to Gemini.
    //
    // Threshold: activate for files larger than 50 MB (a 180-min WebM is ~180 MB).
    const SAFE_CHUNK_THRESHOLD_MB = 50;
    const audioSizeMBForCheck = audioBlob.size / (1024 * 1024);

    if (audioSizeMBForCheck > SAFE_CHUNK_THRESHOLD_MB && await isLikelyWebm(audioBlob)) {
      console.log(`[transcribeEntireAudio] Large WebM (${audioSizeMBForCheck.toFixed(1)} MB) → EBML IDB chunked path`);
      try {
        return await this.transcribeEntireAudioWithGeminiChunked(
          apiKey, audioBlob, modelName, onProgress,
          maxFileSizeMB, requestDelaySeconds, maxDurationMinutes,
          meetingStartTime, summaryPrompt, fileManager, languageCode, onRetryNeeded
        );
      } catch (chunkedErr: any) {
        const msg = chunkedErr.message ?? '';
        // Only fall back to legacy for pre-transcription setup failures.
        // Gemini API / network errors (thrown from Phase 3) must propagate.
        if (msg === 'EBML_NO_CLUSTERS' || msg.startsWith('EBML_PRE_TRANSCRIPTION_FAILED:')) {
          console.warn(`[transcribeEntireAudio] WebM setup issue (${msg}) — falling back to legacy path`);
          // fall through
        } else {
          throw chunkedErr;
        }
      }
    }

    // ============================================================
    // FAST PATH: WAV binary-split for large WAV files (avoids OOM)
    // ============================================================
    // WAV is uncompressed PCM — decoding a 180-min stereo 44.1 kHz WAV
    // in one shot produces ~1.8 GB of PCM, causing OOM on most devices.
    //
    // Solution: read the 44-byte WAV header to get sample rate / channels /
    // bits-per-sample, then slice into chunks by byte offset (no decode needed).
    // Each chunk is a valid standalone WAV file.
    if (audioSizeMBForCheck > SAFE_CHUNK_THRESHOLD_MB && await isLikelyWav(audioBlob)) {
      console.log(`[transcribeEntireAudio] Large WAV (${audioSizeMBForCheck.toFixed(1)} MB) → WAV binary IDB chunked path`);
      try {
        return await this.transcribeEntireAudioWithGeminiChunkedWav(
          apiKey, audioBlob, modelName, onProgress,
          maxFileSizeMB, requestDelaySeconds, maxDurationMinutes,
          meetingStartTime, summaryPrompt, fileManager, languageCode, onRetryNeeded
        );
      } catch (wavErr: any) {
        const msg = wavErr.message ?? '';
        // Only fall back to legacy for pre-transcription setup failures.
        // Gemini API / network errors (thrown from Phase 3) must propagate.
        if (msg.startsWith('WAV_PRE_TRANSCRIPTION_FAILED:')) {
          console.warn(`[transcribeEntireAudio] WAV setup issue (${msg}) — falling back to legacy path`);
          // fall through to legacy
        } else {
          throw wavErr;
        }
      }
    }

    // ============================================================
    // LEGACY PATH (MP3/MP4/OGG, or format-specific fast paths failed):
    // Convert entire file to WAV first, then chunk by AudioContext extraction.
    // ⚠️ Only safe for files ≤ 50 MB or unsplittable compressed formats.
    // ============================================================
    if (onProgress) onProgress(3, i18n.t('geminiProgress.checkingAudio'));
    
    let wavBlob = audioBlob;
    const audioType = audioBlob.type.toLowerCase();
    
    const audioSizeMB = audioBlob.size / (1024 * 1024);
    console.log(`📦 Processing file: ${audioSizeMB.toFixed(2)}MB • ${audioType}`);
    
    // CRITICAL WARNING: Very large files may cause browser memory issues
    // However, with direct WAV slicing, we can handle much larger files
    if (audioSizeMB > 1000) {
      console.error(`❌ File cực kỳ lớn: ${audioSizeMB.toFixed(0)}MB - vượt giới hạn!`);
      throw new Error(i18n.t('apiErrors.fileTooLarge', { size: audioSizeMB.toFixed(0) }));
    }
    
    // Always normalize to mono WAV 16kHz before chunking.
    // convertToWav() skips resampling internally if audio is already mono 16kHz,
    // so no extra cost for already-normalized files.
    //
    // WHY always normalize even for .WAV input:
    //   • WAV from Zoom/Teams/Audacity is typically stereo 44100Hz or 48kHz
    //   • Stereo 44100Hz 60-min WAV ≈ 635 MB → chunked fine, but each chunk base64 too large
    //   • Without normalization, "Failed to fetch" can occur even on correctly-chunked files
    {
      const originalSizeMB = audioBlob.size / (1024 * 1024);
      if (onProgress) {
        onProgress(5, i18n.t('geminiProgress.normalizingType', { type: audioType.split('/')[1]?.toUpperCase() || 'audio' }));
      }
      
      console.log(`🔄 Normalizing entire file to mono WAV 16kHz (required for consistent chunking)`);
      console.log(`📊 Original: ${originalSizeMB.toFixed(2)}MB ${audioType}`);
      
      wavBlob = await this.convertToWav(audioBlob, 16000);
      
      const wavSizeMB = wavBlob.size / (1024 * 1024);
      const reduction = ((1 - wavSizeMB / originalSizeMB) * 100).toFixed(1);
      const reductionType = i18n.t(wavSizeMB < originalSizeMB ? 'geminiProgress.sizeReduced' : 'geminiProgress.sizeIncreased');
      
      console.log(`✅ Normalized: ${originalSizeMB.toFixed(2)}MB → ${wavSizeMB.toFixed(2)}MB (${reductionType} ${Math.abs(parseFloat(reduction))}%)`);
      
      if (onProgress) {
        onProgress(7, i18n.t('geminiProgress.normalizedSize', { size: wavSizeMB.toFixed(1), type: reductionType, percent: Math.abs(parseFloat(reduction)) }));
      }
    }

    // ============================================================
    // BƯỚC 2: TÍNH TOÁN CHUNK BOUNDARIES TỪ WAV
    // ============================================================
    // Calculate boundaries will automatically handle BOTH size and duration constraints
    // It will choose the MORE RESTRICTIVE limit to ensure all chunks are safe
    if (onProgress) onProgress(8, i18n.t('geminiProgress.calculatingParts'));
    
    const wavSizeMB = wavBlob.size / (1024 * 1024);
    console.log(`📦 Calculating chunk boundaries from WAV: ${wavSizeMB.toFixed(2)}MB`);
    console.log(`📊 Constraints: max ${maxSizeMB}MB OR ${maxDurationMinutes}min per chunk`);
    
    // CRITICAL: Pass BOTH maxSizeMB and maxDurationMinutes - function will respect BOTH
    const chunkBoundaries = await this.calculateChunkBoundaries(wavBlob, maxSizeMB, maxDurationMinutes);
    console.log(`✅ Calculated ${chunkBoundaries.length} chunk boundaries`);

    if (onProgress) {
      onProgress(10, i18n.t('geminiProgress.partsCalculated', { count: chunkBoundaries.length }));
    }

    const allResults: TranscriptionResult[] = [];
    const allSummaries: string[] = [];
    let hasTruncation = false;
    const truncationWarnings: string[] = [];
    let hasSkippedChunk = false; // tracks any user-skipped chunk (language-agnostic)
    let currentLegacyApiKey = apiKey; // may be updated by onRetryNeeded callback
    
    // Get total duration once for progress estimation
    const totalAudioDurationSec = await this.getAudioDuration(wavBlob);
    const totalWavSizeMB = wavBlob.size / (1024 * 1024);

    for (let i = 0; i < chunkBoundaries.length; i++) {
      const boundary = chunkBoundaries[i];
      const chunkProgress = 10 + ((i / chunkBoundaries.length) * 80);
      const chunkDurationMin = Math.ceil((boundary.endTimeMs - boundary.startTimeMs) / 60000);
      
      // Estimate chunk size based on duration ratio
      const chunkDurationSec = (boundary.endTimeMs - boundary.startTimeMs) / 1000;
      const estimatedSizeMB = (chunkDurationSec / totalAudioDurationSec) * totalWavSizeMB;

      if (onProgress) {
        onProgress(
          chunkProgress,
          i18n.t('geminiProgress.legacyChunkStart', { current: i + 1, total: chunkBoundaries.length, size: estimatedSizeMB.toFixed(1), minutes: chunkDurationMin })
        );
      }

      try {
        // CRITICAL: Extract chunk from WAV (not original file!)
        // WAV is uncompressed PCM, so extraction is fast and memory-efficient
        console.log(`🔪 Extracting chunk ${i + 1}/${chunkBoundaries.length} from WAV: ${boundary.startTimeMs}ms-${boundary.endTimeMs}ms`);
        const chunkBlob = await this.extractAudioSegment(wavBlob, boundary.startTimeMs, boundary.endTimeMs);
        const chunkSizeMB = chunkBlob.size / (1024 * 1024);
        console.log(`  ✅ Extracted WAV chunk: ${chunkSizeMB.toFixed(2)}MB`);
        
        // Transcribe this chunk (skip size check - already validated and split)
        const { result: parsed, finalApiKey: usedLegacyKey } = await AIRefinementService.callWithGeminiRetry(
          (key) => this.transcribeAudioWithGemini(
            key,
            chunkBlob, // Just-in-time extracted chunk
            modelName,
            (subProgress, subMessage) => {
              if (onProgress) {
                const totalProgress = chunkProgress + (subProgress / chunkBoundaries.length) * 0.8;
                const progressMessage = subMessage 
                  ? `📦 ${i + 1}/${chunkBoundaries.length}: ${subMessage}`
                  : `📦 Phần ${i + 1}/${chunkBoundaries.length}: ${subProgress.toFixed(0)}%`;
                onProgress(totalProgress, progressMessage);
              }
            },
            true, // skipSizeCheck = true (chunks already validated)
            maxSizeMB, // Pass maxFileSizeMB to child call
            meetingStartTime, // Pass meeting start time for accurate timestamps
            summaryPrompt, // Pass user-provided summary prompt through
            fileManager, // Pass fileManager for debug logs
            { index: i + 1, total: chunkBoundaries.length }, // Pass chunk info for context-aware prompting
            languageCode, // Pass language code through
            maxDurationMinutes // Pass through for consistency (not used due to skipSizeCheck=true)
          ),
          currentLegacyApiKey,
          i + 1, chunkBoundaries.length, onProgress, chunkProgress, onRetryNeeded, 'Legacy'
        );
        currentLegacyApiKey = usedLegacyKey;
        
        // Adjust timestamps for this chunk
        const adjustedResults = this.adjustTimestamps(parsed.results, boundary.startTimeMs);
        allResults.push(...adjustedResults);
        
        // Log chunk completion
        console.log(`✅ Chunk ${i + 1}/${chunkBoundaries.length}: ${adjustedResults.length} segments (${boundary.startTimeMs}ms - ${boundary.endTimeMs}ms)`);
        
        // Collect summary from this chunk
        if (parsed.summary) {
          allSummaries.push(`Phần ${i + 1}/${chunkBoundaries.length}: ${parsed.summary}`);
          console.log(`📝 Chunk ${i + 1}/${chunkBoundaries.length}: Summary collected (${parsed.summary.length} chars)`);
        }
        
        // Track truncation
        if (parsed.isTruncated) {
          hasTruncation = true;
          if (parsed.truncationWarning) {
            truncationWarnings.push(`Phần ${i + 1}/${chunkBoundaries.length}: ${parsed.truncationWarning}`);
          }
        }

        // Show completion for this chunk
        if (onProgress) {
          onProgress(
            chunkProgress + (80 / chunkBoundaries.length) * 0.9,
            i18n.t('geminiProgress.legacyChunkDone', { current: i + 1, total: chunkBoundaries.length, count: adjustedResults.length })
          );
        }

        // ⏰ CRITICAL: Add delay between chunks to respect Gemini rate limits
        // Gemini API limits: 15 requests/minute, 1500 requests/day
        // Delay prevents 429 errors (quota exceeded)
        if (i < chunkBoundaries.length - 1) {
          console.log(`⏳ Waiting ${requestDelaySeconds}s before processing next chunk (rate limit protection)...`);
          
          if (onProgress) {
            onProgress(
              chunkProgress + (80 / chunkBoundaries.length),
              i18n.t('geminiProgress.waitingRateLimit', { seconds: requestDelaySeconds })
            );
          }
          
          await new Promise(resolve => setTimeout(resolve, requestDelaySeconds * 1000));
          
          console.log(`✅ Delay completed, processing chunk ${i + 2}/${chunkBoundaries.length}`);
        }
      } catch (error: any) {
        if (error.message?.startsWith('CHUNK_SKIPPED:')) {
          const originalMsg = error.message.replace(/^CHUNK_SKIPPED:\s*/, '');
          console.warn(`⚠️ Chunk ${i + 1}/${chunkBoundaries.length} skipped by user: ${originalMsg}`);
          hasSkippedChunk = true;
          truncationWarnings.push(i18n.t('apiErrors.idbChunkSkipped', { current: i + 1, total: chunkBoundaries.length, reason: originalMsg }));
          if (onProgress) {
            onProgress(
              chunkProgress + (80 / chunkBoundaries.length),
              i18n.t('geminiProgress.legacyChunkSkipped', { current: i + 1, total: chunkBoundaries.length })
            );
          }
          continue;
        }

        // Handle quota errors
        if (error.message.includes('429') || error.message.includes('quota')) {
          throw new Error(i18n.t('apiErrors.legacyQuotaExceeded', {
            current: i + 1, done: i, total: chunkBoundaries.length, errorMsg: error.message
          }));
        }
        throw error;
      }
    }

    // Sort by timestamp
    allResults.sort((a, b) => (a.audioTimeMs || 0) - (b.audioTimeMs || 0));

    console.log(`✅ Đã xử lý toàn bộ: ${allResults.length} segments từ ${chunkBoundaries.length} chunks`);
    
    if (onProgress) {
      onProgress(90, i18n.t('geminiProgress.legacyAllDone', { segments: allResults.length, parts: chunkBoundaries.length }));
    }

    // ============================================================
    // BƯỚC 3: TỔNG HỢP TÓM TẮT (nếu có nhiều phần)
    // ============================================================
    let combinedSummary: string | undefined = undefined;
    
    if (allSummaries.length === 0) {
      // No summaries at all
      combinedSummary = undefined;
    } else if (allSummaries.length === 1) {
      // Only one summary - use directly
      combinedSummary = allSummaries[0].replace(/^Phần \d+\/\d+: /, ''); // Remove "Phần 1/1: " prefix
      console.log(`✅ Sử dụng 1 tóm tắt trực tiếp (${combinedSummary.length} ký tự)`);
    } else {
      // Multiple summaries - try to merge with Gemini API (with retry + user dialog on failure)
      if (onProgress) onProgress(92, i18n.t('geminiProgress.mergingSummary', { count: allSummaries.length }));
      combinedSummary = await this.mergeSummariesWithRetry(
        currentLegacyApiKey, modelName, allSummaries, summaryPrompt, languageCode,
        onProgress, 92, 'Legacy', onRetryNeeded
      );
      if (onProgress) onProgress(98, i18n.t('geminiProgress.summaryMergedChars', { count: combinedSummary.length }));
    }

    if (onProgress) onProgress(100, i18n.t('geminiProgress.allDone', { count: allResults.length }));
    
    // Build final truncation/warning message
    let finalTruncationWarning: string | undefined = undefined;
    if (truncationWarnings.length > 0) {
      // Check if any chunks were skipped by the user (language-agnostic flag)
      const hasSkippedChunks = hasSkippedChunk;
      
      if (hasSkippedChunks) {
        finalTruncationWarning = i18n.t('apiErrors.chunksFailed', { items: truncationWarnings.join('\n\n') });
      } else if (hasTruncation) {
        finalTruncationWarning = i18n.t('apiErrors.chunksTruncated', { items: truncationWarnings.join('\n\n') });
      }
      
      console.warn('⚠️ Final warnings:', finalTruncationWarning);
    }
    
    return { 
      results: allResults, 
      summary: combinedSummary, 
      isTruncated: hasTruncation || truncationWarnings.length > 0, // Mark as truncated if ANY warnings
      truncationWarning: finalTruncationWarning 
    };
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

  /**
   * Merge summaries with automatic retry + user dialog on failure.
   * Uses the same callWithGeminiRetry logic as chunk processing.
   * If the user skips/stops, falls back to manual concatenation so the rest
   * of the result (transcription segments) is never discarded.
   */
  private static async mergeSummariesWithRetry(
    apiKey: string,
    modelName: string,
    summaries: string[],
    summaryPrompt: string | undefined,
    languageCode: string | undefined,
    onProgress: ((p: number, msg?: string) => void) | undefined,
    progressVal: number,
    logPrefix: string,
    onRetryNeeded?: GeminiRetryCallback
  ): Promise<string> {
    try {
      const { result, finalApiKey: _key } = await AIRefinementService.callWithGeminiRetry(
        (key) => AIRefinementService.mergeSummariesWithGemini(key, modelName, summaries, summaryPrompt, languageCode),
        apiKey,
        0, 0, // chunkIdx=0, chunkTotal=0 → dialog shows "Summary step"
        onProgress,
        progressVal,
        onRetryNeeded,
        `${logPrefix}/MergeSummary`
      );
      return result;
    } catch (err: any) {
      // User skipped or stopped — fall back to manual concatenation (segments are preserved)
      console.warn(`⚠️ [${logPrefix}] Summary merge failed/skipped: ${err.message}`);
      if (onProgress) onProgress(progressVal, i18n.t('geminiProgress.manualMergeSummary', { count: summaries.length }));
      return summaries
        .map((s, idx) => `📄 ${i18n.t('geminiProgress.summaryPart', { n: idx + 1 })}:\n${s.replace(/^Phần \d+\/\d+:\s*/, '')}`)
        .join('\n\n---\n\n');
    }
  }

  private static async mergeSummariesWithGemini(
    apiKey: string,
    modelName: string,
    summaries: string[],
    userPrompt?: string,
    // fileManager?: FileManagerService,
    languageCode?: string
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

    // Determine output language
    const langMap: Record<string, string> = {
      'vi': 'Tiếng Việt', 'vi-VN': 'Tiếng Việt',
      'en': 'English', 'en-US': 'English', 'en-GB': 'English', 'en-AU': 'English',
      'ja': '日本語', 'ja-JP': '日本語',
      'ko': '한국어', 'ko-KR': '한국어',
      'zh': '中文', 'zh-CN': '中文 (简体)', 'zh-TW': '中文 (繁體)',
      'fr': 'Français', 'fr-FR': 'Français',
      'de': 'Deutsch', 'de-DE': 'Deutsch',
      'es': 'Español', 'es-ES': 'Español',
      'pt': 'Português', 'pt-BR': 'Português',
      'th': 'ภาษาไทย', 'th-TH': 'ภาษาไทย',
      'id': 'Bahasa Indonesia', 'id-ID': 'Bahasa Indonesia',
    };
    const outputLanguage = languageCode ? (langMap[languageCode] || languageCode) : 'Tiếng Việt';

    const mergePrompt = `BẠN LÀ CHUYÊN GIA TÓM TẮT CUỘC HỌP.

NHIỆM VỤ: Tổng hợp các tóm tắt riêng lẻ từ các đoạn audio thành MỘT tóm tắt tổng quan liền mạch cho toàn bộ cuộc họp.

🌐 NGÔN NGỮ: Viết toàn bộ kết quả bằng ${outputLanguage}.

YÊU CẦU:
1. ĐỌC kỹ tất cả các tóm tắt bên dưới (mỗi tóm tắt tương ứng với 1 đoạn audio)
2. TỔNG HỢP thành 1 bài tóm tắt tổng quan dễ đọc và dễ quét thông tin
3. GIỮ LẠI toàn bộ thông tin quan trọng: số liệu, ngày tháng, tên riêng, quyết định, action items
4. SẮP XẾP theo trình tự thời gian logic (từ đầu đến cuối cuộc họp)
5. LOẠI BỎ thông tin trùng lặp giữa các đoạn
6. ĐẢM BẢO văn phong chuyên nghiệp, mạch lạc, dễ hiểu, hãy chỉ cung cấp nội dung kết quả, không có lời dẫn 'Đây là bản tóm tắt...' hay bất kỳ câu xã giao nào.
7. KHÔNG để dòng trống giữa các gạch đầu dòng hoặc đoạn văn

✅ FORMAT KHUYẾN KHÍCH:
   • SỬ DỤNG gạch đầu dòng (-, •, *) hoặc danh sách đánh số (1. 2. 3.) để tổ chức nội dung
   • CÓ THỂ thêm tiêu đề ngắn gọn (vd: **Chủ đề chính:**, **Quyết định:**, **Action items:**) để phân chia các phần
   • NHÓM các ý theo chủ đề/người nói/giai đoạn cuộc họp
   • Ưu tiên tính READABLE - người đọc có thể quét nhanh và nắm được nội dung chính

${userPrompt ? `\nYÊU CẦU BỔ SUNG TỪ NGƯỜI DÙNG:\n${userPrompt}\n` : ''}

=== CÁC TÓM TẮT RIÊNG LẺ CẦN TỔNG HỢP ===

${summariesText}

=== OUTPUT ===

Hãy trả về MỘT bài tóm tắt tổng hợp có cấu trúc rõ ràng, dễ đọc. Ưu tiên sử dụng bullets/lists/headings để tổ chức thông tin.`;


    try {
      // Get model info to retrieve outputTokenLimit dynamically
      const modelInfo = await this.getModelInfo(apiKey, modelName);
      console.log(`📊 Model ${modelName} (merge summaries): outputTokenLimit = ${modelInfo.outputTokenLimit}`);

      const endpoint = `https://generativelanguage.googleapis.com/${this.GEMINI_API_VERSION}/${modelName}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [{
          parts: [{ text: mergePrompt }]
        }],
        generationConfig: {
          temperature: 0.2, // Lower temperature for more focused, consistent merging
          topK: 40,
          topP: 0.95,
          maxOutputTokens: modelInfo.outputTokenLimit, // Dynamic limit based on selected model
          responseMimeType: 'text/plain' // Plain text for summary merging
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      };

      let mergeResponse: Response;
      try {
        mergeResponse = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
      } catch (fetchError: any) {
        throw new Error(this.diagnoseNetworkError(fetchError));
      }
      const response = mergeResponse;

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Gemini API error (${response.status}): ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();

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
  private static parseGeminiAudioTranscription(apiResponse: any, meetingStartTime?: Date): { results: TranscriptionResult[], summary?: string, isTruncated?: boolean, truncationWarning?: string } {
    try {
      // Debug log full API response structure
      console.log('🔍 Full Gemini API response:', JSON.stringify(apiResponse, null, 2));
      
      const candidates = apiResponse?.candidates;
      if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        console.error('❌ No candidates in response:', apiResponse);
        throw new Error('No response from Gemini API');
      }

      // Check finishReason for various response states
      const finishReason = candidates[0].finishReason;
      
      // Handle different finish reasons
      if (finishReason === 'RECITATION') {
        console.warn('⚠️ Gemini refused to transcribe due to potential copyright violation (RECITATION)');
        throw new Error(i18n.t('apiErrors.recitation'));
      }
      
      if (finishReason === 'SAFETY') {
        console.warn('⚠️ Gemini refused to process due to safety concerns');
        throw new Error(i18n.t('apiErrors.safety'));
      }
      
      if (finishReason === 'MAX_TOKENS') {
        console.warn('⚠️ Response truncated due to MAX_TOKENS');
        // Continue processing - we'll handle truncation later
      }
      
      if (finishReason === 'OTHER' || (finishReason && !['STOP', 'MAX_TOKENS'].includes(finishReason))) {
        console.warn(`⚠️ Gemini stopped with reason: ${finishReason}`);
        // Continue trying to parse if there's content
      }

      const content = candidates[0]?.content;
      if (!content || !content.parts || !Array.isArray(content.parts) || content.parts.length === 0) {
        console.error('❌ No content/parts in first candidate:', candidates[0]);
        console.error('   finishReason:', finishReason);
        throw new Error(`Empty response from Gemini (finishReason: ${finishReason || 'unknown'})`);
      }

      const textResponse = content.parts[0].text;
      if (!textResponse) {
        throw new Error(`No text in Gemini response (finishReason: ${finishReason || 'unknown'})`);
      }
      
      // Mark as truncated if MAX_TOKENS
      const isTruncated = finishReason === 'MAX_TOKENS';

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
          truncationWarning = i18n.t('apiErrors.truncatedAudioWithSummary', { count: results.length });
        } else {
          truncationWarning = i18n.t('apiErrors.truncatedAudio', { count: results.length });
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
