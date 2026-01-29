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
}

export class SmartTranscriptManager {
  private confirmedSegments: ConfirmedSegment[] = [];
  private interimBuffer: InterimBuffer | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private idCounter: number = 0;
  private transcriptionStartTime: number = 0;
  private browserBehavior: BrowserBehavior;
  private lastInterimText: string = ''; // Track last interim text for comparison
  private cumulativeCommittedText: string = ''; // Track ALL committed text to extract only new portions
  
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
        minTextLengthForCommit: 3    // Min 3 chars before commit
      };
    }
    
    // Check for Chrome
    if (userAgent.includes('chrome/') && !userAgent.includes('edg/')) {
      return {
        name: 'chrome',
        silenceTimeout: 1500,        // 1.5s - Chrome finalizes faster
        mergeTimeWindow: 500,        // 500ms - Stricter merge window
        minTextLengthForCommit: 5    // Min 5 chars before commit
      };
    }
    
    // Unknown browser - use conservative defaults
    return {
      name: 'unknown',
      silenceTimeout: 2000,
      mergeTimeWindow: 600,
      minTextLengthForCommit: 3
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
    this.lastInterimText = '';
    this.cumulativeCommittedText = '';
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
    this.lastInterimText = '';
    this.cumulativeCommittedText = '';
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

    if (result.isFinal) {
      // **CONDITION A: API Signal (isFinal = true)**
      this.commitInterimToOfficial(result.transcript, audioTimeMs, timestamp, result.confidence, speaker);
    } else {
      // **INTERIM UPDATE: Update buffer (the "expanding" effect)**
      this.updateInterimBuffer(result.transcript, audioTimeMs, timestamp, result.confidence, speaker, now);
      
      // **CONDITION B: Start silence timer (2 seconds)**
      this.startSilenceTimer();
      
      // Send interim update
      this.sendInterimUpdate();
    }
  }

  /**
   * Force commit current interim buffer (called on stop)
   */
  public forceCommit(): void {
    if (this.interimBuffer && this.interimBuffer.text.trim()) {
      this.commitInterimToOfficial(
        this.interimBuffer.text,
        this.interimBuffer.audioTimeMs,
        this.interimBuffer.startTime,
        this.interimBuffer.confidence,
        this.interimBuffer.speaker
      );
    }
  }

  /**
   * Update interim buffer (creates "expanding" visual effect)
   */
  private updateInterimBuffer(
    text: string,
    audioTimeMs: number,
    timestamp: string,
    confidence: number,
    speaker: string,
    now: number
  ): void {
    // **CRITICAL FIX: Extract only NEW text that hasn't been committed**
    let displayText = text.trim();
    
    if (this.cumulativeCommittedText && displayText.startsWith(this.cumulativeCommittedText)) {
      // Remove already committed text, show only new portion in draft
      displayText = displayText.substring(this.cumulativeCommittedText.length).trim();
      // console.log(`✂️ Draft: Trimming committed text, showing only: "${displayText.substring(0, 30)}..."`);
    }
    
    // If no new text after trimming, don't update
    if (!displayText) {
      return;
    }
    
    if (!this.interimBuffer) {
      // Create new interim buffer with FIXED ID
      this.interimBuffer = {
        id: 'draft-segment-interim', // Fixed ID for smooth UI updates
        text: displayText,
        lastUpdated: now,
        audioTimeMs: audioTimeMs,
        startTime: timestamp,
        confidence: confidence,
        speaker: speaker
      };
      this.lastInterimText = displayText;
    } else {
      // Check if new text is an expansion of old text (append) or completely new (replace)
      const isExpanding = displayText.startsWith(this.lastInterimText) && displayText.length > this.lastInterimText.length;
      
      if (isExpanding) {
        // Text is growing - keep the expansion smooth
        this.interimBuffer.text = displayText;
      } else {
        // Text completely changed - this is a new phrase after silence
        // Replace the text
        this.interimBuffer.text = displayText;
        this.interimBuffer.audioTimeMs = audioTimeMs; // Update time for new phrase
        this.interimBuffer.startTime = timestamp;
      }
      
      this.interimBuffer.lastUpdated = now;
      this.interimBuffer.confidence = confidence;
      this.lastInterimText = displayText;
    }
  }

  /**
   * Commit interim buffer to official segments
   * Implements smart merging logic
   */
  private commitInterimToOfficial(
    text: string,
    audioTimeMs: number,
    timestamp: string,
    confidence: number,
    speaker: string
  ): void {
    let trimmedText = text.trim();
    
    // **CRITICAL FIX: Web Speech API returns CUMULATIVE text**
    // Extract ONLY the new portion that hasn't been committed yet
    if (this.cumulativeCommittedText && trimmedText.startsWith(this.cumulativeCommittedText)) {
      // Remove already committed text, keep only new portion
      const newTextOnly = trimmedText.substring(this.cumulativeCommittedText.length).trim();
      console.log(`📝 Extracting new text: "${this.cumulativeCommittedText.substring(0, 30)}..." → "${newTextOnly.substring(0, 30)}..."`);
      trimmedText = newTextOnly;
    }
    
    // Validate minimum text length
    if (trimmedText.length < this.browserBehavior.minTextLengthForCommit) {
      this.clearInterimBuffer();
      return;
    }

    // **SMART MERGING LOGIC**
    const lastSegment = this.confirmedSegments[this.confirmedSegments.length - 1];
    
    if (lastSegment && !lastSegment.isLocked) {
      const timeSinceLastSegment = audioTimeMs - lastSegment.audioTimeMs;
      const isSameSpeaker = lastSegment.speaker === speaker;
      
      // **CASE 1: MERGE** - Short time gap + same speaker + not locked
      if (timeSinceLastSegment < this.browserBehavior.mergeTimeWindow && isSameSpeaker) {
        console.log(`🔗 MERGE: Gap ${timeSinceLastSegment}ms < ${this.browserBehavior.mergeTimeWindow}ms`);
        
        // Merge: Append text to last segment
        lastSegment.text = lastSegment.text.trim() + ' ' + trimmedText;
        lastSegment.endTime = timestamp;
        lastSegment.confidence = (lastSegment.confidence + confidence) / 2; // Average confidence
        
        // Update cumulative committed text
        this.cumulativeCommittedText = (this.cumulativeCommittedText + ' ' + trimmedText).trim();
        
        // Send updated segment
        this.sendConfirmedSegment(lastSegment);
        
        this.clearInterimBuffer();
        return;
      }
    }

    // **CASE 2: CREATE NEW SEGMENT**
    console.log(`➕ NEW SEGMENT: Creating new official segment`);
    
    const newSegment: ConfirmedSegment = {
      id: `transcription-${++this.idCounter}`,
      text: trimmedText,
      timestamp: Date.now(),
      audioTimeMs: audioTimeMs,
      confidence: confidence,
      speaker: speaker,
      isLocked: false, // Can be merged with next segment
      startTime: timestamp,
      endTime: timestamp
    };

    this.confirmedSegments.push(newSegment);
    
    // Update cumulative committed text
    this.cumulativeCommittedText = (this.cumulativeCommittedText + ' ' + trimmedText).trim();
    
    // Send new segment
    this.sendConfirmedSegment(newSegment);
    
    this.clearInterimBuffer();
  }

  /**
   * Start silence detection timer
   * **CONDITION B: Commit after 2 seconds of silence**
   */
  private startSilenceTimer(): void {
    this.clearSilenceTimer();
    
    this.silenceTimer = setTimeout(() => {
      if (this.interimBuffer && this.interimBuffer.text.trim()) {
        console.log(`⏱️ SILENCE TIMEOUT (${this.browserBehavior.silenceTimeout}ms): Committing interim buffer`);
        
        this.commitInterimToOfficial(
          this.interimBuffer.text,
          this.interimBuffer.audioTimeMs,
          this.interimBuffer.startTime,
          this.interimBuffer.confidence,
          this.interimBuffer.speaker
        );
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
    this.lastInterimText = '';
    
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
   * Send interim update to callback
   */
  private sendInterimUpdate(): void {
    if (this.onTranscriptionResult && this.interimBuffer) {
      this.onTranscriptionResult({
        id: this.interimBuffer.id,
        text: this.interimBuffer.text,
        startTime: this.interimBuffer.startTime,
        endTime: this.interimBuffer.startTime,
        audioTimeMs: this.interimBuffer.audioTimeMs,
        confidence: this.interimBuffer.confidence,
        speaker: this.interimBuffer.speaker,
        isFinal: false,
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
    this.lastInterimText = '';
    this.cumulativeCommittedText = '';
  }
}
