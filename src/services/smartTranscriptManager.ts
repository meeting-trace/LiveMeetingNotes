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
  private interimText: string = ''; // ✨ Text tích lũy cho segment tạm thời
  private finalLongest: string = '';
  private lastCommittedHash: string = '';
  private silenceTimer: any = null;
  private idCounter = 0;
  private transcriptionStartTime = 0;
  private browserBehavior: BrowserBehavior;
  private onResult: ((r: TranscriptionResult) => void) | null = null;
  
  // ✨ Lưu timestamp khi bắt đầu tích lũy (dùng cho segment chính thức)
  private accumulationStartTime: string = '';
  private accumulationStartAudioTimeMs: number = 0;
  
  // ✨ Idle detection: tự động commit khi không có text mới trong 2s
  private idleTimer: any = null;
  private lastUpdateTime: number = 0;
  private idleTimeout: number = 2000; // 2 giây
  private onIdleCommit: (() => void) | null = null;

  constructor() {
    this.browserBehavior = this.detectBrowser();
    console.log('🌐 Using SmartTranscriptManager:', this.browserBehavior.name);
  }

  // ✨ Set callback để restart recognition khi idle
  setIdleCallback(callback: () => void) {
    this.onIdleCommit = callback;
  }

  initialize(cb: (r: TranscriptionResult) => void) {
    this.onResult = cb;
    this.confirmedSegments = [];
    this.interimText = ''; // Reset text tạm thời
    this.finalLongest = '';
    this.lastCommittedHash = '';
    this.idCounter = 0;
    this.transcriptionStartTime = Date.now();
    this.accumulationStartTime = '';
    this.accumulationStartAudioTimeMs = 0;
    this.lastUpdateTime = Date.now();
    this.clearSilenceTimer();
    this.clearIdleTimer();
  }

  processResult(r: { transcript: string; confidence: number; isFinal: boolean; speaker?: string; isShortChunk?: boolean }) {
    const text = r.transcript.trim();
    if (!text) return;

    const now = Date.now();
    const audioTimeMs = now - this.transcriptionStartTime;
    const timestamp = new Date().toISOString();
    const speaker = r.speaker || 'Person1';
    const isShortChunk = r.isShortChunk !== false; // Default true nếu không có

    this.clearSilenceTimer();

    // 🔹 INTERIM: Tích lũy text từ các kết quả ngắn (≤5 từ)
    if (!r.isFinal) {
      // const wordCount = text.split(/\s+/).length;
      
      let displayText = text;
      
      // ✨ Ưu tiên tích lũy từ kết quả ngắn
      if (isShortChunk) {
        // ⚡ Nếu đang bắt đầu tích lũy mới, lưu timestamp
        if (!this.interimText) {
          this.accumulationStartTime = timestamp;
          this.accumulationStartAudioTimeMs = audioTimeMs;
          console.log('🎬 Starting new accumulation:', {
            startTime: timestamp,
            startAudioTimeMs: audioTimeMs
          });
        }
        
        const accumulatedText = this.accumulateInterimText(text);
        const accumulatedWordCount = accumulatedText.split(/\s+/).length;
        
        // ⚡ Nếu text tích lũy quá dài (>250 từ), COMMIT thành segment chính thức
        if (accumulatedWordCount > 250) {
          console.log('🔴 INTERIM too long (>250 words), COMMITTING as final segment:', {
            words: accumulatedWordCount,
            text: accumulatedText.substring(0, 100) + '...',
            startTime: this.accumulationStartTime,
            startAudioTimeMs: this.accumulationStartAudioTimeMs
          });
          
          // ⚡ Commit thành segment chính thức với timestamp bắt đầu
          this.finalLongest = accumulatedText;
          this.commitFinal(
            this.accumulationStartAudioTimeMs, // Dùng audioTime bắt đầu
            this.accumulationStartTime,         // Dùng timestamp bắt đầu
            r.confidence, 
            speaker,
            false // Normal commit - có thể merge
          );
          
          // Reset và bắt đầu mới
          this.interimText = '';
          this.finalLongest = '';
          this.accumulationStartTime = '';
          this.accumulationStartAudioTimeMs = 0;
          this.clearInterim();
          return;
        }
        
        this.interimText = accumulatedText;
        displayText = accumulatedText;
        
        // ⚡ Cập nhật thời gian update cuối và restart idle timer
        this.lastUpdateTime = Date.now();
        this.startIdleTimer(audioTimeMs, timestamp, r.confidence, speaker);
        
        // console.log('🔄 INTERIM (SHORT chunk - accumulated):', {
        //   newChunk: text,
        //   chunkWords: wordCount,
        //   accumulated: accumulatedText.substring(0, 100) + (accumulatedText.length > 100 ? '...' : ''),
        //   totalWords: accumulatedWordCount,
        //   confidence: (r.confidence * 100).toFixed(2) + '%'
        // });
      } else {
        // Kết quả dài: hiển thị trực tiếp NHƯNG KHÔNG tích lũy
        // console.log('🔄 INTERIM (LONG chunk - display only, no accumulation):', {
        //   text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        //   words: wordCount,
        //   confidence: (r.confidence * 100).toFixed(2) + '%',
        //   note: 'Waiting for short chunks to accumulate properly'
        // });
        
        // Nếu chưa có text tích lĉy, dùng text dài làm fallback
        if (!this.interimText) {
          displayText = text;
        } else {
          // Đã có text tích lũy, ưu tiên giữ text tích lũy
          displayText = this.interimText;
        }
      }
      
      this.emitInterim(displayText, audioTimeMs, timestamp, r.confidence, speaker);
      this.startSilenceTimer(audioTimeMs, timestamp, r.confidence, speaker);
      return;
    }

    // 🔹 FINAL từ Google: KHÔNG xử lý nữa (segment chính thức chỉ từ tích lũy của chúng ta)
    // Chúng ta tự commit khi >250 từ ở trên
    console.log('⚠️  Ignoring Google isFinal result:', {
      text: text.substring(0, 80) + '...',
      reason: 'We handle commits internally when accumulated text reaches 250 words'
    });
    return;
    
    // Code cũ (bỏ):
    // if (text.length > this.finalLongest.length) {
    //   this.finalLongest = text;
    // }
    // this.emitInterim(this.finalLongest, audioTimeMs, timestamp, r.confidence, speaker);
    // this.startSilenceTimer(audioTimeMs, timestamp, r.confidence, speaker);
  }

  /**
   * ✨ Logic ghép text thông minh cho interim results
   *this.interimText = ''; // ✨ Reset text tích lũy khi commitằng text cũ → chỉ thêm phần mới
   * - Nếu text mới hoàn toàn khác → thay thế
   * - Tránh trùng lặp và tạo cảm giác text được thêm dần
   */
  private accumulateInterimText(newText: string): string {
    if (!this.interimText) {
      // Chưa có text tích lũy → bắt đầu mới
      return newText;
    }

    const current = this.interimText.toLowerCase().trim();
    const incoming = newText.toLowerCase().trim();

    // Case 1: Text mới BẮT ĐẦU bằng text cũ → Web Speech đang mở rộng câu
    if (incoming.startsWith(current)) {
      // Chỉ lấy phần mới thêm vào
      const newPart = newText.substring(this.interimText.length).trim();
      if (newPart) {
        return this.interimText + ' ' + newPart;
      }
      return newText; // Text mới dài hơn nhưng không có khoảng trắng
    }

    // Case 2: Text cũ BẮT ĐẦU bằng text mới → Web Speech đang thu hẹp (hiếm)
    if (current.startsWith(incoming)) {
      // Giữ nguyên text cũ (dài hơn)
      return this.interimText;
    }

    // Case 3: Text mới chứa text cũ ở giữa → tìm phần overlap
    const overlapIndex = incoming.indexOf(current);
    if (overlapIndex > 0) {
      // Có overlap → ghép phần đầu của text mới vào
      const prefix = newText.substring(0, overlapIndex).trim();
      return prefix + ' ' + this.interimText;
    }

    // Case 4: Tìm overlap từ cuối text cũ
    // Ví dụ: cũ="xin chào", mới="chào các bạn" → "xin chào các bạn"
    const words = this.interimText.split(' ');
    for (let i = words.length - 1; i >= 0; i--) {
      const suffix = words.slice(i).join(' ').toLowerCase();
      if (incoming.startsWith(suffix)) {
        const newPart = newText.substring(suffix.length).trim();
        if (newPart) {
          return this.interimText + ' ' + newPart;
        }
        return this.interimText;
      }
    }

    // Case 5: Hoàn toàn khác → KIỂM TRA TRÙNG LẶP trước khi ghép
    // Có thể Google bỏ qua 1 đoạn và nhảy sang phần mới
    
    // ⚡ KIỂM TRA: Nếu text mới đã có trong text cũ → KHÔNG ghép (tránh duplicate)
    if (current.includes(incoming)) {
      console.log('⚠️ DUPLICATE detected, keeping old text:', {
        old: this.interimText,
        duplicate: newText
      });
      return this.interimText; // Giữ nguyên text cũ, không thêm
    }
    
    // Kiểm tra ngược lại: nếu text cũ nằm trong text mới → thay thế bằng text mới (dài hơn)
    if (incoming.includes(current)) {
      console.log('ℹ️ New text contains old text, replacing with longer version:', {
        old: this.interimText,
        new: newText
      });
      return newText;
    }
    
    // ⚡ KIỂM TRA LẶP TỪ: Nếu có quá nhiều từ giống nhau → có thể là duplicate
    const oldWords = current.split(/\s+/);
    const newWords = incoming.split(/\s+/);
    let matchCount = 0;
    
    // Đếm số từ giống nhau
    for (const word of newWords) {
      if (word.length > 2 && oldWords.includes(word)) {
        matchCount++;
      }
    }
    
    const matchRatio = matchCount / newWords.length;
    
    // Nếu >50% từ trùng lặp → có thể là duplicate, KHÔNG ghép
    if (matchRatio > 0.5) {
      console.log('⚠️ High word overlap detected, possible duplicate, keeping old:', {
        matchRatio: (matchRatio * 100).toFixed(1) + '%',
        old: this.interimText,
        new: newText
      });
      return this.interimText;
    }
    
    // Text thực sự khác → Ghép vào cuối
    console.log('ℹ️ Text seems different, APPENDING:', {
      old: this.interimText.substring(0, 50) + '...',
      new: newText.substring(0, 50) + '...',
      matchRatio: (matchRatio * 100).toFixed(1) + '%'
    });
    return this.interimText + ' ' + newText;
  }

  // ================== CORE COMMIT ==================

  private commitFinal(audioTimeMs: number, timestamp: string, confidence: number, speaker: string, isIdleCommit: boolean = false) {
    const text = this.finalLongest.trim();
    if (!text) return;

    const hash = text.toLowerCase();
    
    // ⚡ KIỂM TRA TRÙNG LẶP với hash cũ
    if (hash === this.lastCommittedHash) {
      console.log('🚫 DUPLICATE: Same hash as last commit, skipping:', {
        hash: hash.substring(0, 50) + '...'
      });
      return;
    }
    
    // ⚡ KIỂM TRA TRÙNG LẶP với segment cuối cùng
    const last = this.confirmedSegments[this.confirmedSegments.length - 1];
    if (last) {
      const lastTextLower = last.text.toLowerCase();
      const currentTextLower = text.toLowerCase();
      
      // Nếu text mới nằm trong text cuối → trùng lặp hoàn toàn
      if (lastTextLower.includes(currentTextLower)) {
        console.log('🚫 DUPLICATE: New text already in last segment, skipping:', {
          last: last.text.substring(0, 80) + '...',
          new: text.substring(0, 80) + '...'
        });
        this.lastCommittedHash = hash; // Cập nhật hash để tránh thử lại
        return;
      }
      
      // Nếu text cuối nằm trong text mới → có thể mở rộng, kiểm tra overlap
      if (currentTextLower.includes(lastTextLower)) {
        // Tính tỉ lệ overlap
        const overlapRatio = lastTextLower.length / currentTextLower.length;
        
        if (overlapRatio > 0.7) {
          // >70% trùng lặp → chỉ có thêm 1 chút, có thể là duplicate
          console.log('🚫 DUPLICATE: High overlap with last segment, skipping:', {
            overlapRatio: (overlapRatio * 100).toFixed(1) + '%',
            last: last.text.substring(0, 80) + '...',
            new: text.substring(0, 80) + '...'
          });
          this.lastCommittedHash = hash;
          return;
        }
      }
      
      // Kiểm tra tỉ lệ từ trùng lặp
      const lastWords = lastTextLower.split(/\s+/);
      const currentWords = currentTextLower.split(/\s+/);
      let matchCount = 0;
      
      for (const word of currentWords) {
        if (word.length > 2 && lastWords.includes(word)) {
          matchCount++;
        }
      }
      
      const wordMatchRatio = matchCount / currentWords.length;
      
      if (wordMatchRatio > 0.8) {
        // >80% từ giống nhau → rất có thể là duplicate
        console.log('🚫 DUPLICATE: High word overlap with last segment, skipping:', {
          wordMatchRatio: (wordMatchRatio * 100).toFixed(1) + '%',
          last: last.text.substring(0, 80) + '...',
          new: text.substring(0, 80) + '...'
        });
        this.lastCommittedHash = hash;
        return;
      }
    }

    this.lastCommittedHash = hash;
    this.finalLongest = '';
    // this.interimText = '';

    let finalText = text;
    if (!/[.!?]$/.test(finalText)) finalText += '.';

    // Tái sử dụng biến 'last' đã khai báo ở trên (không khai báo lại)

    // ⚡ IDLE COMMIT: Không merge, tạo segment riêng biệt
    if (!isIdleCommit &&
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
      isLocked: true // 🔒 silence hoặc idle = kết thúc câu, không merge
    };
    
    // 📌 Log nếu là idle commit
    if (isIdleCommit) {
      console.log('🔒 IDLE COMMIT: Created isolated segment (no merge):', {
        id: seg.id,
        text: seg.text.substring(0, 80) + '...',
        words: seg.text.split(/\s+/).length
      });
    }

    this.confirmedSegments.push(seg);
    this.emitFinal(seg);
  }

  // ================== IDLE DETECTION ==================

  private startIdleTimer(_audioTimeMs: number, _timestamp: string, confidence: number, speaker: string) {
    this.clearIdleTimer();
    
    // Nếu có text tích lũy, bắt đầu check định kỳ mỗi 1s
    if (this.interimText) {
      // ⚡ Dùng setInterval để check liên tục mỗi 1 giây
      this.idleTimer = setInterval(() => {
        const timeSinceLastUpdate = Date.now() - this.lastUpdateTime;
        
        // Nếu thực sự không có update trong 2s VÀ vẫn có text
        if (timeSinceLastUpdate >= this.idleTimeout && this.interimText) {
          // console.log('🚨 IDLE DETECTED: No new text for 2s, auto-committing:', {
          //   idleTime: timeSinceLastUpdate + 'ms',
          //   text: this.interimText.substring(0, 80) + '...',
          //   words: this.interimText.split(/\s+/).length
          // });
          
          // Clear timer trước khi commit
          this.clearIdleTimer();
          
          // Commit segment hiện tại với flag isIdleCommit=true
          this.finalLongest = this.interimText;
          this.commitFinal(
            this.accumulationStartAudioTimeMs,
            this.accumulationStartTime,
            confidence,
            speaker,
            true // ⚡ isIdleCommit = true → tạo segment riêng, không merge
          );
          
          // Reset
          this.interimText = '';
          this.finalLongest = '';
          this.accumulationStartTime = '';
          this.accumulationStartAudioTimeMs = 0;
          this.clearInterim();
          
          // ⚡ Gọi callback để restart recognition
          if (this.onIdleCommit) {
            console.log('🔄 Triggering speech recognition restart...');
            setTimeout(() => {
              this.onIdleCommit?.();
            }, 100);
          }
        }
      }, 1000); // Check mỗi 1 giây
    }
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer); // Đổi từ clearTimeout sang clearInterval
      this.idleTimer = null;
    }
  }

  // ================== SILENCE ==================

  private startSilenceTimer(audioTimeMs: number, timestamp: string, confidence: number, speaker: string) {
    this.silenceTimer = setTimeout(() => {
      this.commitFinal(audioTimeMs, timestamp, confidence, speaker, false); // Silence commit - có thể merge
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
    if (ua.includes('edg/')) return { name: 'edge', silenceTimeout: 4000, mergeTimeWindow: 800, maxCharsPerSegment: 250 };
    if (ua.includes('chrome/')) return { name: 'chrome', silenceTimeout: 3000, mergeTimeWindow: 500, maxCharsPerSegment: 250 };
    return { name: 'unknown', silenceTimeout: 3500, mergeTimeWindow: 600, maxCharsPerSegment: 250 };
  }
}
