// ✅ REFACTORED SmartTranscriptManager
// Mục tiêu:
// - BỎ t1 / t2 / finalView phức tạp
// - CHỈ dựa vào finalLongest + silence
// - CHỐNG DUPLICATE 100%
// - Copy vào là chạy, không cần hiểu sâu

import type { TranscriptionResult } from '../types/types';

interface ConfirmedSegment {
  id: string;
  text: string;
  audioTimeMs: number;
  confidence: number;
  speaker: string;
  startTime: string;
  endTime: string;
  isLocked: boolean;
}

interface BrowserBehavior {
  name: 'chrome' | 'edge' | 'unknown';
  silenceTimeout: number;
  mergeTimeWindow: number;
  maxCharsPerSegment: number;
}

export class SmartTranscriptManager {
  private confirmedSegments: ConfirmedSegment[] = [];
//   private interimText: string = '';
  private finalLongest: string = '';
  private lastCommittedHash: string = '';
  private silenceTimer: any = null;
  private idCounter = 0;
  private transcriptionStartTime = 0;
  private browserBehavior: BrowserBehavior;
  private onResult: ((r: TranscriptionResult) => void) | null = null;

  constructor() {
    this.browserBehavior = this.detectBrowser();
    console.log('🌐 Using SmartTranscriptManager:', this.browserBehavior.name);
  }

  initialize(cb: (r: TranscriptionResult) => void) {
    this.onResult = cb;
    this.confirmedSegments = [];
    // this.interimText = '';
    this.finalLongest = '';
    this.lastCommittedHash = '';
    this.idCounter = 0;
    this.transcriptionStartTime = Date.now();
    this.clearSilenceTimer();
  }

  processResult(r: { transcript: string; confidence: number; isFinal: boolean; speaker?: string }) {
    const text = r.transcript.trim();
    if (!text) return;

    const now = Date.now();
    const audioTimeMs = now - this.transcriptionStartTime;
    const timestamp = new Date().toISOString();
    const speaker = r.speaker || 'Person1';

    this.clearSilenceTimer();

    // 🔹 INTERIM: chỉ hiển thị realtime
    if (!r.isFinal) {
    //   this.interimText = text;
      this.emitInterim(text, audioTimeMs, timestamp, r.confidence, speaker);
      this.startSilenceTimer(audioTimeMs, timestamp, r.confidence, speaker);
      return;
    }

    // 🔹 FINAL: chọn câu dài nhất (Chrome mở rộng dần)
    if (text.length > this.finalLongest.length) {
      this.finalLongest = text;
    }

    this.emitInterim(this.finalLongest, audioTimeMs, timestamp, r.confidence, speaker);
    this.startSilenceTimer(audioTimeMs, timestamp, r.confidence, speaker);
  }

  // ================== CORE COMMIT ==================

  private commitFinal(audioTimeMs: number, timestamp: string, confidence: number, speaker: string) {
    const text = this.finalLongest.trim();
    if (!text) return;

    const hash = text.toLowerCase();
    if (hash === this.lastCommittedHash) return; // 🚫 chống trùng

    this.lastCommittedHash = hash;
    this.finalLongest = '';
    // this.interimText = '';

    let finalText = text;
    if (!/[.!?]$/.test(finalText)) finalText += '.';

    const last = this.confirmedSegments[this.confirmedSegments.length - 1];

    if (
      last &&
      !last.isLocked &&
      last.speaker === speaker &&
      last.text.length + finalText.length < this.browserBehavior.maxCharsPerSegment &&
      audioTimeMs - last.audioTimeMs < this.browserBehavior.mergeTimeWindow
    ) {
      last.text += ' ' + finalText;
      last.endTime = timestamp;
      last.confidence = (last.confidence + confidence) / 2;
      this.emitFinal(last);
      return;
    }

    const seg: ConfirmedSegment = {
      id: `seg-${++this.idCounter}`,
      text: finalText,
      audioTimeMs,
      confidence,
      speaker,
      startTime: timestamp,
      endTime: timestamp,
      isLocked: true // 🔒 silence = kết thúc câu
    };

    this.confirmedSegments.push(seg);
    this.emitFinal(seg);
  }

  // ================== SILENCE ==================

  private startSilenceTimer(audioTimeMs: number, timestamp: string, confidence: number, speaker: string) {
    this.silenceTimer = setTimeout(() => {
      this.commitFinal(audioTimeMs, timestamp, confidence, speaker);
      this.clearInterim();
    }, this.browserBehavior.silenceTimeout);
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  // ================== UI EMIT ==================

  private emitInterim(text: string, audioTimeMs: number, ts: string, conf: number, speaker: string) {
    this.onResult?.({
      id: 'interim',
      text,
      startTime: ts,
      endTime: ts,
      audioTimeMs,
      confidence: conf,
      speaker,
      isFinal: false,
      isManuallyEdited: false
    });
  }

  private emitFinal(seg: ConfirmedSegment) {
    this.onResult?.({
      id: seg.id,
      text: seg.text,
      startTime: seg.startTime,
      endTime: seg.endTime,
      audioTimeMs: seg.audioTimeMs,
      confidence: seg.confidence,
      speaker: seg.speaker,
      isFinal: true,
      isManuallyEdited: false
    });
  }

  private clearInterim() {
    this.onResult?.({
      id: 'interim',
      text: '',
      startTime: '',
      endTime: '',
      audioTimeMs: 0,
      confidence: 0,
      speaker: 'Person1',
      isFinal: false,
      isManuallyEdited: false
    });
  }

  // ================== BROWSER ==================

  private detectBrowser(): BrowserBehavior {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('edg/')) return { name: 'edge', silenceTimeout: 2000, mergeTimeWindow: 800, maxCharsPerSegment: 250 };
    if (ua.includes('chrome/')) return { name: 'chrome', silenceTimeout: 1500, mergeTimeWindow: 500, maxCharsPerSegment: 250 };
    return { name: 'unknown', silenceTimeout: 2000, mergeTimeWindow: 600, maxCharsPerSegment: 250 };
  }
}
