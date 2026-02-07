# SmartTranscriptManager - Chiến Lược Accumulation & Duplicate Detection

## 📚 Tổng Quan Cơ Chế

SmartTranscriptManager (`smartTranscriptManager.ts`) là **trái tim của live transcription**, chịu trách nhiệm:

1. **Tích lũy text từ Web Speech API** (buffer strategy)
2. **Phát hiện & loại bỏ duplicate** (3 cấp độ)
3. **Commit thành segments chính thức** (khi im lặng hoặc quá dài)
4. **Ngăn chặn cảm giác text bị nhảy cóc**

---

## 🎬 Luồng Chính

### Initialization
```javascript
constructor() {
  this.confirmedSegments = [];    // Segments đã hoàn tất
  this.interimText = '';         // Text tạm thời đang tích lũy
  this.finalLongest = '';        // Text longest từ công bố final
  this.lastCommittedHash = '';   // Hash của segment vừa commit
  this.silenceTimer = null;      // Timer đợi im lặng
  this.browserBehavior = this.detectBrowser();  // Chrome vs Edge
}

initialize(callback) {
  this.confirmedSegments = [];
  this.interimText = '';
  this.finalLongest = '';
  this.lastCommittedHash = '';
  this.accumulationStartTime = '';
  this.accumulationStartAudioTimeMs = 0;
}
```

---

## 🔄 Xử Lý Interim Results

### Bước 1: Phân Loại Kết Quả

```javascript
processResult(result) {
  const { transcript, confidence, isFinal, isShortChunk } = result;
  const text = transcript.trim();
  
  if (!text) return;  // Bỏ qua text rỗng
  
  // 🔹 Nếu là FINAL từ Google Cloud
  if (isFinal) {
    console.warn('⚠️ Ignoring Google isFinal result');
    // Tại sao? Vì chúng ta tự commit khi accumulated >250 words
    // Ignoring Google's final giúp kiểm soát timing tốt hơn
    return;
  }
  
  // 🔹 Nếu là INTERIM từ Web Speech API
  if (!isFinal) {
    // Tiếp tục xử lý...
  }
}
```

### Bước 2: Quyết Định Tích Lũy Hay Hiển Thị

```javascript
// Phân biệt Short Chunk (≤10 từ) vs Long Chunk (>10 từ)
const wordCount = text.split(/\s+/).length;
const isShortChunk = wordCount <= 10;

if (isShortChunk) {
  // ✨ SHORT CHUNK: Ưu tiên tích lũy
  
  if (!this.interimText) {
    // Bắt đầu tích lũy mới → Lưu startTime
    this.accumulationStartTime = timestamp;
    this.accumulationStartAudioTimeMs = audioTimeMs;
    console.log('🎬 Starting new accumulation:', {
      startTime: timestamp,
      startAudioTimeMs: audioTimeMs
    });
  }
  
  // Ghép text mới vào text tích lũy
  const accumulatedText = this.accumulateInterimText(text);
  const accumulatedWordCount = accumulatedText.split(/\s+/).length;
  
  // Kiểm tra nếu quá dài → COMMIT NGAY
  if (accumulatedWordCount > 250) {
    console.log('🔴 INTERIM too long (>250 words), COMMITTING');
    this.finalLongest = accumulatedText;
    this.commitFinal(
      this.accumulationStartAudioTimeMs,  // Dùng timestamp bắt đầu
      this.accumulationStartTime,
      confidence,
      speaker,
      false  // Normal commit - có thể merge
    );
    // Reset để tích lũy mới
    this.interimText = '';
    this.finalLongest = '';
    this.accumulationStartTime = '';
    this.accumulationStartAudioTimeMs = 0;
    this.clearInterim();
    return;
  }
  
  // Update interim text để hiển thị
  this.interimText = accumulatedText;
  displayText = accumulatedText;
  
} else {
  // ❌ LONG CHUNK: Hiển thị trực tiếp, KHÔNG tích lũy
  // Tại sao? Vì long chunk thường là "câu hoàn chỉnh"
  // Ghép tiếp sẽ làm mất đúc kết cấu
  
  if (!this.interimText) {
    // Nếu chưa có interim text, dùng long chunk làm fallback
    displayText = text;
  } else {
    // Nếu đã có interim text, ưu tiên giữ interim
    // (để tiếp tục tích lũy short chunks)
    displayText = this.interimText;
  }
}

// Emit interim result (để hiển thị real-time)
this.emitInterim(displayText, audioTimeMs, timestamp, confidence, speaker);

// Bắt đầu timer đợi im lặng
this.startSilenceTimer(audioTimeMs, timestamp, confidence, speaker);
```

---

## 🧮 Cơ Chế Tích Lũy Text (accumulateInterimText)

### Các Cases Xử Lý

```javascript
accumulateInterimText(newText: string): string {
  if (!this.interimText) {
    return newText;  // Khởi tạo lần đầu
  }

  const current = this.interimText.toLowerCase().trim();
  const incoming = newText.toLowerCase().trim();

  // ========================================
  // Case 1: Text mới BẮT ĐẦU bằng text cũ
  // ========================================
  // Ví dụ:
  //   current: "xin chào"
  //   incoming: "xin chào các bạn"
  // → Web Speech đang mở rộng câu
  
  if (incoming.startsWith(current)) {
    const newPart = newText.substring(this.interimText.length).trim();
    if (newPart) {
      return this.interimText + ' ' + newPart;
    }
    return newText;
  }

  // ========================================
  // Case 2: Text cũ BẮT ĐẦU bằng text mới
  // ========================================
  // Ví dụ:
  //   current: "xin chào các bạn"
  //   incoming: "xin chào"
  // → Web Speech đang thu hẹp (hiếm)
  
  if (current.startsWith(incoming)) {
    return this.interimText;  // Giữ text cũ (dài hơn)
  }

  // ========================================
  // Case 3: Text mới chứa text cũ ở giữa
  // ========================================
  // Ví dụ:
  //   current: "xin chào"
  //   incoming: "à xin chào các bạn"
  // → Có overlap → Ghép phần đầu
  
  const overlapIndex = incoming.indexOf(current);
  if (overlapIndex > 0) {
    const prefix = newText.substring(0, overlapIndex).trim();
    return prefix + ' ' + this.interimText;
  }

  // ========================================
  // Case 4: Tìm overlap từ cuối text cũ
  // ========================================
  // Ví dụ:
  //   current: "xin chào"
  //   incoming: "chào các bạn"
  // → Giữ "xin" + thêm "các bạn"
  
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

  // ========================================
  // Case 5: HOÀN TOÀN KHÁC → Kiểm tra duplicate
  // ========================================
  
  // Case 5a: Text mới đã nằm trong text cũ?
  if (current.includes(incoming)) {
    console.log('⚠️ DUPLICATE detected, keeping old text');
    return this.interimText;  // BỎSAU, không thêm
  }
  
  // Case 5b: Text cũ nằm trong text mới?
  if (incoming.includes(current)) {
    console.log('ℹ️ New text contains old text, replacing');
    return newText;  // Thay thế bằng text mới (dài hơn)
  }
  
  // Case 5c: Kiểm tra word overlap
  const oldWords = current.split(/\s+/);
  const newWords = incoming.split(/\s+/);
  let matchCount = 0;
  
  for (const word of newWords) {
    if (word.length > 2 && oldWords.includes(word)) {
      matchCount++;
    }
  }
  
  const matchRatio = matchCount / newWords.length;
  
  // Nếu >50% từ giống → Có thể là duplicate
  if (matchRatio > 0.5) {
    console.log('⚠️ High word overlap detected (50%+), possible duplicate');
    return this.interimText;
  }
  
  // ========================================
  // Text thực sự khác → GHÉP BÌNH THƯỜNG
  // ========================================
  return this.interimText + ' ' + newText;
}
```

---

## ⏳ Cơ Chế Silence Detection & Commit

### Silence Timer Logic

```javascript
startSilenceTimer(audioTimeMs: number, timestamp: string, confidence: number, speaker: string) {
  this.clearSilenceTimer();  // Clear timer cũ
  
  // Lấy giá trị từ browser behavior
  const silenceTimeout = this.browserBehavior.silenceTimeout;  // Thường 800ms
  
  this.silenceTimer = setTimeout(() => {
    if (this.finalLongest.length > 0) {
      // Có text để commit
      this.commitFinal(audioTimeMs, timestamp, confidence, speaker, true);  // isIdleCommit = true
    }
  }, silenceTimeout);
}

clearSilenceTimer() {
  if (this.silenceTimer) {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }
}
```

### Commit Logic

```javascript
private commitFinal(
  audioTimeMs: number,
  timestamp: string,
  confidence: number,
  speaker: string,
  isIdleCommit: boolean = false  // true = từ silence, false = từ length check
) {
  const text = this.finalLongest.trim();
  if (!text) return;  // Không có text để commit

  // ========================================
  // 🚫 KIỂM TRA TRÙNG LẶP - CẤP 1: Hash
  // ========================================
  const hash = text.toLowerCase();
  
  if (hash === this.lastCommittedHash) {
    console.log('🚫 DUPLICATE: Same hash as last commit, skipping');
    return;  // SKIP, không commit
  }

  // ========================================
  // 🚫 KIỂM TRA TRÙNG LẶP - CẤP 2: Last Segment
  // ========================================
  const last = this.confirmedSegments[this.confirmedSegments.length - 1];
  if (last) {
    const lastTextLower = last.text.toLowerCase();
    const currentTextLower = text.toLowerCase();
    
    // Exact match?
    if (lastTextLower === currentTextLower) {
      console.log('🚫 DUPLICATE: Exact match with last segment');
      return;
    }
    
    // Similarity check?
    const similarity = this.calculateSimilarity(lastTextLower, currentTextLower);
    if (similarity > 0.8) {
      console.log('🚫 DUPLICATE: High similarity (80%+) with last segment');
      return;
    }
  }

  // ========================================
  // ✅ Không phải duplicate → COMMIT
  // ========================================
  
  // Tạo ID unique
  const id = `segment-${this.idCounter++}`;
  
  // Lấy speaker từ mapping hoặc default
  const confirmedSegment: ConfirmedSegment = {
    id,
    text,
    audioTimeMs,
    confidence,
    speaker,
    startTime: timestamp,
    endTime: timestamp,
    isLocked: true  // Locked = không cho user edit từ interim
  };

  // Thêm vào confirmed segments
  this.confirmedSegments.push(confirmedSegment);
  
  // Cập nhật lastCommittedHash
  this.lastCommittedHash = hash;

  // Convert to TranscriptionResult format
  const result: TranscriptionResult = {
    id,
    text,
    startTime: timestamp,
    endTime: timestamp,
    audioTimeMs,
    confidence,
    speaker,
    isFinal: true
  };

  // ✅ Emit kết quả chính thức
  if (this.onResult) {
    this.onResult(result);
  }

  // Reset để tích lũy mới
  this.interimText = '';
  this.finalLongest = '';
  this.accumulationStartTime = '';
  this.accumulationStartAudioTimeMs = 0;
  
  console.log('✅ Segment committed:', {
    id,
    text: text.substring(0, 50) + '...',
    audioTimeMs,
    speaker
  });
}
```

---

## 🎯 Cơ Chế Similarity Check

```javascript
private calculateSimilarity(text1: string, text2: string): number {
  // Simple Levenshtein-based similarity
  // Hoặc: Jaccard similarity của từ
  
  const words1 = new Set(text1.split(/\s+/));
  const words2 = new Set(text2.split(/\s+/));
  
  // Intersection / Union
  let intersection = 0;
  for (const word of words1) {
    if (words2.has(word)) {
      intersection++;
    }
  }
  
  const union = words1.size + words2.size - intersection;
  return intersection / union;  // 0 = khác hoàn toàn, 1 = giống hệt
}
```

---

## 🌐 Browser Behavior Detection

```javascript
detectBrowser(): BrowserBehavior {
  const ua = navigator.userAgent.toLowerCase();
  const isChrome = ua.includes('chrome/') && !ua.includes('edg');
  const isEdge = ua.includes('edg/');
  
  if (isChrome) {
    return {
      name: 'chrome',
      silenceTimeout: 800,      // Chrome: 800ms
      mergeTimeWindow: 2000,     // 2 giây
      maxCharsPerSegment: 500
    };
  } else if (isEdge) {
    return {
      name: 'edge',
      silenceTimeout: 1200,      // Edge: 1200ms (chậm hơn)
      mergeTimeWindow: 3000,
      maxCharsPerSegment: 400
    };
  } else {
    return {
      name: 'unknown',
      silenceTimeout: 1000,
      mergeTimeWindow: 2500,
      maxCharsPerSegment: 450
    };
  }
}
```

---

## 📊 State Diagram

```
┌──────────────────────────┐
│   Khởi Tạo               │
│ interimText = ''         │
│ finalLongest = ''        │
│ lastCommittedHash = ''   │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────────────────────┐
│  Nhận Result từ Web Speech API            │
│  (interim hoặc final)                    │
└───────────┬───────────────────────────────┘
            │
            ▼
    ┌───────┴───────┐
    │               │
 INTERIM         FINAL
    │               │
    ├─ Short        └─ IGNORE
    │ Chunk           (self-handled)
    │ (≤10)
    │
    ▼
 ┌─────────────────────┐
 │ accumulateInterimText│
 │ - Ghép smart        │
 │ - KT duplicate      │
 └────────┬────────────┘
          │
          ▼
   ┌──────────────────┐
   │ Update           │
   │ interimText      │
   │ Emit (interim)   │
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────────────┐
   │ startSilenceTimer        │
   │ ждать 800ms im lặng      │
   └────────┬─────────────────┘
            │
    ┌───────┴──────────────┐
    │                      │
  🔊 Speech              ⏳ Silence
  Continues             Timeout
    │                      │
    ▼                      ▼
  Reset               ┌─────────────┐
  Timer               │ commitFinal │
  (go back            │ - KT dup    │
   to emit)           │ - Add seg   │
                      │ - Emit      │
                      │ - Reset     │
                      └─────────────┘
```

---

## 🔑 Key Insights

### 1. **Tại sao phân biệt Short vs Long Chunks?**
- **Short Chunks** (≤10 từ) = thường là fragments, cần ghép
- **Long Chunks** (>10 từ) = thường là complete thoughts, không ghép
- Ghép thông minh = tránh cảm giác text nhảy cóc

### 2. **Tại sao Ignore isFinal từ Google?**
- isFinal từ Web Speech API quá sớm (khi user pause 1s)
- Nếu ghép isFinal, sẽ tạo nhiều segments nhỏ
- Self-managed commits dựa trên **accumulated length** tốt hơn

### 3. **3 Cấp Độ Duplicate Detection**
```
Level 1: Hash match (text được commit bao giờ)
Level 2: Last segment compare (segment cuối cùng)
Level 3: Word overlap (>50% từ giống = duplicate)
```

### 4. **Cách Tránh "Duplicate Commits"**
1. **lastCommittedHash** - Lưu hash của segment vừa commit
2. **Similarity check** - So sánh với last segment
3. **Skip commit** - Nếu match → return (không commit)

### 5. **Browser-Specific Tuning**
- Chrome: 800ms silence (nhanh)
- Edge: 1200ms silence (chậm - Edge delay audio)
- Timeout không cố định → có thể adjust trong `detectBrowser()`

---

## 🧪 Test Cases for SmartTranscriptManager

```javascript
// Test 1: Basic accumulation
processResult({ transcript: 'xin', isFinal: false, isShortChunk: true });
processResult({ transcript: 'xin chào', isFinal: false, isShortChunk: true });
// Expected: interimText = "xin chào" (not "xin xin chào")

// Test 2: Long chunk fallback
processResult({ transcript: 'xin chào cô gái xinh đẹp', isFinal: false, isShortChunk: false });
// Expected: Display long chunk, but don't accumulate

// Test 3: Silence commit
processResult({ transcript: 'hello', isFinal: false, isShortChunk: true });
// Wait 800ms → commitFinal() called
// Expected: confirmedSegments.push({ text: 'hello', ... })

// Test 4: Duplicate detection - exact
processResult({ transcript: 'hello', isFinal: false, isShortChunk: true });
// Commit → "hello"
processResult({ transcript: 'hello', isFinal: false, isShortChunk: true });
// Commit attempted → 🚫 Skip (hash match)
// Expected: Only one segment

// Test 5: Duplicate detection - high similarity
processResult({ transcript: 'hello world', isFinal: false, isShortChunk: true });
// Commit → "hello world"
processResult({ transcript: 'hello world!', isFinal: false, isShortChunk: true });
// Commit attempted → 🚫 Skip (>80% similarity)
// Expected: Only one segment
```

---

## 💡 Optimization Ideas

1. **Progressive Refinement**
   - Refine segments individually khi commit
   - Không chờ cuối recording

2. **Context-Aware Merging**
   - Dùng NLP để detect sentence boundaries
   - Merge ở punctuation thay vì word count

3. **Confidence-Based Weighting**
   - If confidence < 0.5 → Treat as uncertain
   - Merge lại với segments trước/sau

4. **Language-Specific Timeouts**
   - Vietnamese: Tones matter → adjust timeout
   - English: Different speech patterns

---

Cuối cùng, **SmartTranscriptManager** là một **state machine thông minh** giải quyết vấn đề:
- ✅ Accumulating fragments
- ✅ Preventing duplicates
- ✅ Optimizing segment boundaries
- ✅ Providing confidence & speaker info

