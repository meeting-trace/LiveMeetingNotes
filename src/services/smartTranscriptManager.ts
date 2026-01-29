/**
 * SmartTranscriptManager - Manages real-time transcript with "Buffer & Commit" strategy
 * 
 * Core Concepts:
 * - **Interim Buffer**: Temporary text that grows as user speaks
 * - **Confirmed Segments**: Official transcripts committed from buffer
 * - **Smart Merging**: Intelligently merge or create new segments based on timing
 */

import type { TranscriptionResult } from '../types/types';

interface ConfirmedSegment {
  id: string;
  text: string;
  timestamp: number;
  audioTimeMs: number;
  confidence: number;
  speaker: string;
  isLocked: boolean; // Locked segments won't be merged
  startTime: string; // ISO timestamp
  endTime: string;   // ISO timestamp
}

interface InterimBuffer {
  id: string;
  text: string;
  lastUpdated: number;
  audioTimeMs: number;
  startTime: string;
  confidence: number;
  speaker: string;
}

interface BrowserBehavior {
  name: 'chrome' | 'edge' | 'unknown';
  silenceTimeout: number;      // Timeout for silence detection
  mergeTimeWindow: number;     // Time window for merging segments
  minTextLengthForCommit: number; // Min text length before commit
  maxCharsPerSegment: number;  // Max CHARACTERS per segment before forcing split
  minTimeGapForNewSegment: number; // Min time gap (ms) to create new segment (2.5s)
}

export class SmartTranscriptManager {
  private confirmedSegments: ConfirmedSegment[] = [];
  private interimBuffer: InterimBuffer | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private idCounter: number = 0;
  private transcriptionStartTime: number = 0;
  private browserBehavior: BrowserBehavior;
  
  // t1/t2 logic variables
  private finalLongest: string = '';  // Text ổn định (isFinal, ≥5 từ)
  private finalLatest: string = '';   // Final mới nhất ≥5 từ (debug)
  private latestFinalResult: string = ''; // Kết quả isFinal gần nhất (debug)
  private t1: string = '';             // Buffer xử lý <5 từ (t-1)
  private t2: string = '';             // Kết quả mới nhất (t)
  private finalView: string = '';      // Text hiển thị realtime (50 từ cuối)
  
  // Callbacks
  private onTranscriptionResult: ((result: TranscriptionResult) => void) | null = null;

  constructor() {
    this.browserBehavior = this.detectBrowser();
    console.log(`🌐 SmartTranscriptManager initialized for: ${this.browserBehavior.name}`);
  }

  /**
   * Detect browser and set behavior accordingly
   */
  private detectBrowser(): BrowserBehavior {
    const userAgent = navigator.userAgent.toLowerCase();
    
    // Check for Edge (Chromium-based)
    if (userAgent.includes('edg/')) {
      return {
        name: 'edge',
        silenceTimeout: 2000,        // 2s - Edge returns interim frequently
        mergeTimeWindow: 800,        // 800ms - More generous merge window
        minTextLengthForCommit: 3,   // Min 3 chars before commit
        maxCharsPerSegment: 250,     // Max 250 CHARACTERS per segment
        minTimeGapForNewSegment: 2500 // 2.5s silence to create new segment
      };
    }
    
    // Check for Chrome
    if (userAgent.includes('chrome/') && !userAgent.includes('edg/')) {
      return {
        name: 'chrome',
        silenceTimeout: 1500,        // 1.5s - Chrome finalizes faster
        mergeTimeWindow: 500,        // 500ms - Stricter merge window
        minTextLengthForCommit: 5,   // Min 5 chars before commit
        maxCharsPerSegment: 250,     // Max 250 CHARACTERS per segment
        minTimeGapForNewSegment: 2500 // 2.5s silence to create new segment
      };
    }
    
    // Unknown browser - use conservative defaults
    return {
      name: 'unknown',
      silenceTimeout: 2000,
      mergeTimeWindow: 600,
      minTextLengthForCommit: 3,
      maxCharsPerSegment: 250,
      minTimeGapForNewSegment: 2500
    };
  }

  /**
   * Initialize manager with start time
   */
  public initialize(onResult: (result: TranscriptionResult) => void): void {
    this.transcriptionStartTime = Date.now();
    this.onTranscriptionResult = onResult;
    this.confirmedSegments = [];
    this.interimBuffer = null;
    this.idCounter = 0;
    this.finalLongest = '';
    this.t1 = '';
    this.finalView = '';
    this.clearSilenceTimer();
  }

  /**
   * Reset manager state
   */
  public reset(): void {
    this.confirmedSegments = [];
    this.interimBuffer = null;
    this.clearSilenceTimer();
    this.idCounter = 0;
    this.finalLongest = '';
    this.t1 = '';
    this.finalView = '';
  }

  /**
   * Process incoming transcription result
   */
  public processResult(result: {
    transcript: string;
    confidence: number;
    isFinal: boolean;
    speaker?: string;
  }): void {
    const now = Date.now();
    const audioTimeMs = now - this.transcriptionStartTime;
    const timestamp = new Date().toISOString();
    const speaker = result.speaker || 'Person1';

    // Clear existing silence timer
    this.clearSilenceTimer();

    // Process with t1/t2 logic
    this.updateInterimBuffer(result.transcript, audioTimeMs, timestamp, result.confidence, speaker, now, result.isFinal);
    
    // Start/reset silence timer
    this.startSilenceTimer();
  }

  /**
   * Force commit current interim buffer (called on stop)
   */
  public forceCommit(): void {
    if (this.finalLongest) {
      console.log('🛑 Force commit: finalLongest');
      this.commitTextToSegment(
        this.finalLongest,
        this.interimBuffer?.audioTimeMs || Date.now() - this.transcriptionStartTime,
        this.interimBuffer?.startTime || new Date().toISOString(),
        this.interimBuffer?.confidence || 0,
        this.interimBuffer?.speaker || 'Person1'
      );
      this.finalLongest = '';
      this.finalLatest = '';
      this.latestFinalResult = '';
      this.t1 = '';
      this.t2 = '';
      this.finalView = '';
      this.clearInterimBuffer();
    }
  }

  /**
   * Update interim buffer with t1/t2 logic for smart text handling
   */
  private updateInterimBuffer(
    text: string,
    audioTimeMs: number,
    timestamp: string,
    confidence: number,
    speaker: string,
    now: number,
    isFinal: boolean
  ): void {
    const trimmedText = text.trim();
    if (!trimmedText) return;
    
    const words = trimmedText.split(/\s+/);
    const wordCount = words.length;
    
    // Track isFinal results
    if (isFinal) {
      this.latestFinalResult = trimmedText;
    }
    
    // Case A: ≥5 từ + isFinal
    if (wordCount >= 5 && isFinal) {
      this.finalLatest = trimmedText; // Track latest ≥5 words final
      
      const firstWord = words[0];
      const finalFirstWord = this.finalLongest ? this.finalLongest.split(/\s+/)[0] : '';
      
      if (!this.finalLongest) {
        this.finalLongest = trimmedText;
        console.log(`🎯 finalLongest init: "${trimmedText.substring(0, 30)}..."`);
      } else if (firstWord === finalFirstWord && trimmedText.length > this.finalLongest.length) {
        this.finalLongest = trimmedText;
        console.log(`📈 finalLongest update: "${trimmedText.substring(0, 30)}..."`);
      } else if (firstWord !== finalFirstWord) {
        // Commit finalLongest to segment
        this.commitTextToSegment(this.finalLongest, audioTimeMs, timestamp, confidence, speaker);
        this.finalLongest = trimmedText;
        console.log(`🔄 finalLongest commit + new: "${trimmedText.substring(0, 30)}..."`);
      }
    }
    // Case B: <5 từ + interim (isFinal=false)
    else if (wordCount < 5 && !isFinal) {
      this.t2 = trimmedText; // Track t (current)
      const t2FirstWord = words[0];
      const t1FirstWord = this.t1 ? this.t1.split(/\s+/)[0] : '';
      
      if (!this.t1) {
        this.t1 = this.t2;
      } else if (t1FirstWord === t2FirstWord) {
        this.t1 = this.t1.length > this.t2.length ? this.t1 : this.t2;
      } else {
        this.finalView = (this.finalView + ' ' + this.t1).trim();
        this.t1 = this.t2;
        
        // Keep only last 50 words in finalView
        const viewWords = this.finalView.split(/\s+/);
        if (viewWords.length > 50) {
          this.finalView = viewWords.slice(-50).join(' ');
        }
      }
    }
    
    // DEBUG DISPLAY
    const displayText = [
      `finalLongest: {${this.finalLongest.substring(0, 50)}${this.finalLongest.length > 50 ? '...' : ''}}`,
      `finalLatest: {${this.finalLatest.substring(0, 50)}${this.finalLatest.length > 50 ? '...' : ''}}`,
      `finalView: {${this.finalView.substring(0, 50)}${this.finalView.length > 50 ? '...' : ''}}`,
      `isFinal: {${this.latestFinalResult.substring(0, 50)}${this.latestFinalResult.length > 50 ? '...' : ''}}`,
      `interim t1: {${this.t1}}`,
      `interim t2: {${this.t2}}`
    ].join('\n');
    
    if (!this.interimBuffer) {
      this.interimBuffer = {
        id: 'draft-segment-interim',
        text: displayText,
        lastUpdated: now,
        audioTimeMs: audioTimeMs,
        startTime: timestamp,
        confidence: confidence,
        speaker: speaker
      };
    } else {
      this.interimBuffer.text = displayText;
      this.interimBuffer.lastUpdated = now;
      this.interimBuffer.confidence = confidence;
    }
    
    // Send to UI
    if (this.onTranscriptionResult) {
      this.onTranscriptionResult({
        id: this.interimBuffer.id,
        text: displayText,
        startTime: timestamp,
        endTime: timestamp,
        audioTimeMs: audioTimeMs,
        confidence: confidence,
        speaker: speaker,
        isFinal: false,
        isManuallyEdited: false
      });
    }
  }

  /**
   * Commit text to segment with auto punctuation
   */
  private commitTextToSegment(
    text: string,
    audioTimeMs: number,
    timestamp: string,
    confidence: number,
    speaker: string
  ): void {
    if (!text || !text.trim()) return;
    
    let finalText = text.trim();
    
    // Add period if no punctuation at end
    if (!/[.!?]$/.test(finalText)) {
      finalText += '.';
    }
    
    const lastSegment = this.confirmedSegments[this.confirmedSegments.length - 1];
    
    // Check conditions for merging or creating new segment
    if (lastSegment && !lastSegment.isLocked) {
      const lastSegmentChars = lastSegment.text.length;
      const timeSinceLastSegment = audioTimeMs - lastSegment.audioTimeMs;
      const isSameSpeaker = lastSegment.speaker === speaker;
      
      // **ĐIỀU KIỆN 1: Segment hiện tại đã >=250 ký tự → tạo segment mới**
      if (lastSegmentChars >= this.browserBehavior.maxCharsPerSegment) {
        console.log(`📄 NEW SEGMENT: Last segment full (${lastSegmentChars} >= 250 chars)`);
        // Create new segment below
      }
      // **ĐIỀU KIỆN 2: Silence >=2.5s → tạo segment mới**
      else if (timeSinceLastSegment >= this.browserBehavior.minTimeGapForNewSegment) {
        console.log(`⏱️ NEW SEGMENT: Silence (${timeSinceLastSegment}ms >= 2500ms)`);
        // Create new segment below
      }
      // **MERGE: Cùng speaker, trong time window, chưa đầy 250 chars**
      else if (isSameSpeaker && timeSinceLastSegment < this.browserBehavior.mergeTimeWindow) {
        lastSegment.text = lastSegment.text.trim() + ' ' + finalText;
        lastSegment.endTime = timestamp;
        lastSegment.confidence = (lastSegment.confidence + confidence) / 2;
        this.sendConfirmedSegment(lastSegment);
        console.log(`🔗 MERGE: "${finalText.substring(0, 30)}..." → segment #${lastSegment.id} (${lastSegment.text.length} chars)`);
        return;
      }
    }
    
    // Create new segment
    const newSegment: ConfirmedSegment = {
      id: `transcription-${++this.idCounter}`,
      text: finalText,
      timestamp: Date.now(),
      audioTimeMs: audioTimeMs,
      confidence: confidence,
      speaker: speaker,
      isLocked: false,
      startTime: timestamp,
      endTime: timestamp
    };
    
    this.confirmedSegments.push(newSegment);
    this.sendConfirmedSegment(newSegment);
    console.log(`➕ NEW SEGMENT #${newSegment.id}: "${finalText.substring(0, 30)}..."`);
  }

  /**
   * Start silence detection timer
   * **CONDITION B: Commit after 2 seconds of silence**
   */
  private startSilenceTimer(): void {
    this.clearSilenceTimer();
    
    this.silenceTimer = setTimeout(() => {
      if (this.finalLongest) {
        console.log(`⏱️ SILENCE TIMEOUT (${this.browserBehavior.silenceTimeout}ms): Committing finalLongest`);
        
        this.commitTextToSegment(
          this.finalLongest,
          this.interimBuffer?.audioTimeMs || Date.now() - this.transcriptionStartTime,
          this.interimBuffer?.startTime || new Date().toISOString(),
          this.interimBuffer?.confidence || 0,
          this.interimBuffer?.speaker || 'Person1'
        );
        
        this.finalLongest = '';
        this.finalLatest = '';
        this.latestFinalResult = '';
        this.t1 = '';
        this.t2 = '';
        this.finalView = '';
        this.clearInterimBuffer();
      }
    }, this.browserBehavior.silenceTimeout);
  }

  /**
   * Clear silence timer
   */
  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /**
   * Clear interim buffer and notify UI to remove draft segment
   */
  private clearInterimBuffer(): void {
    this.interimBuffer = null;
    
    // Send empty interim to UI to remove draft segment
    // This prevents duplicate text between confirmed segment and draft
    if (this.onTranscriptionResult) {
      this.onTranscriptionResult({
        id: 'draft-segment-interim',
        text: '', // Empty text signals removal
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        audioTimeMs: 0,
        confidence: 0,
        speaker: 'Person1',
        isFinal: false,
        isManuallyEdited: false
      });
    }
  }

  /**
   * Lock a segment to prevent future merging
   */
  public lockSegment(id: string): void {
    const segment = this.confirmedSegments.find(s => s.id === id);
    if (segment) {
      segment.isLocked = true;
    }
  }

  /**
   * Get current UI state for rendering
   */
  public getUIState(): {
    segments: TranscriptionResult[];
    currentInterim: TranscriptionResult | null;
  } {
    // Convert confirmed segments to TranscriptionResult format
    const segments: TranscriptionResult[] = this.confirmedSegments.map(seg => ({
      id: seg.id,
      text: seg.text,
      startTime: seg.startTime,
      endTime: seg.endTime,
      audioTimeMs: seg.audioTimeMs,
      confidence: seg.confidence,
      speaker: seg.speaker,
      isFinal: true,
      isManuallyEdited: false
    }));

    // Convert interim buffer to TranscriptionResult format
    const currentInterim: TranscriptionResult | null = this.interimBuffer ? {
      id: this.interimBuffer.id,
      text: this.interimBuffer.text,
      startTime: this.interimBuffer.startTime,
      endTime: this.interimBuffer.startTime,
      audioTimeMs: this.interimBuffer.audioTimeMs,
      confidence: this.interimBuffer.confidence,
      speaker: this.interimBuffer.speaker,
      isFinal: false,
      isManuallyEdited: false
    } : null;

    return { segments, currentInterim };
  }

  /**
   * Send confirmed segment to callback
   */
  private sendConfirmedSegment(segment: ConfirmedSegment): void {
    if (this.onTranscriptionResult) {
      this.onTranscriptionResult({
        id: segment.id,
        text: segment.text,
        startTime: segment.startTime,
        endTime: segment.endTime,
        audioTimeMs: segment.audioTimeMs,
        confidence: segment.confidence,
        speaker: segment.speaker,
        isFinal: true,
        isManuallyEdited: false
      });
    }
  }

  /**
   * Get confirmed segments count
   */
  public getSegmentCount(): number {
    return this.confirmedSegments.length;
  }

  /**
   * Get browser behavior info
   */
  public getBrowserInfo(): BrowserBehavior {
    return { ...this.browserBehavior };
  }

  /**
   * Cleanup on destroy
   */
  public destroy(): void {
    this.clearSilenceTimer();
    this.confirmedSegments = [];
    this.interimBuffer = null;
    this.onTranscriptionResult = null;
  }
}
