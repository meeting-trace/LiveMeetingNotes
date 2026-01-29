# 🎯 Smart Transcript Manager - Architecture Documentation

## 📚 Overview

**SmartTranscriptManager** là một lớp quản lý transcript thông minh sử dụng chiến lược **"Buffer & Commit"** để xử lý kết quả real-time từ Web Speech API.

### Vấn Đề Trước Đây

- ❌ Logic xử lý interim/final phức tạp, lẫn lộn trong event handler
- ❌ Không có cơ chế merge thông minh giữa các segments
- ❌ Không tối ưu cho các trình duyệt khác nhau (Chrome vs Edge)
- ❌ Segment tracking không nhất quán

### Giải Pháp Mới

- ✅ Tách biệt logic quản lý transcript vào class riêng
- ✅ Implement chiến lược "Buffer & Commit" rõ ràng
- ✅ Tự động detect browser và điều chỉnh behavior
- ✅ Smart merging dựa trên time window

---

## 🏗️ Architecture

### Core Data Structures

```typescript
// 1. Confirmed Segments (Official Storage)
interface ConfirmedSegment {
  id: string;              // Unique ID
  text: string;            // Final text
  timestamp: number;       // Commit time
  audioTimeMs: number;     // Position in audio
  confidence: number;      // API confidence score
  speaker: string;         // Speaker label
  isLocked: boolean;       // Prevent future merging
  startTime: string;       // ISO timestamp
  endTime: string;         // ISO timestamp
}

// 2. Interim Buffer (Temporary Storage)
interface InterimBuffer {
  id: string;              // Fixed ID: 'draft-segment-interim'
  text: string;            // Growing text
  lastUpdated: number;     // Last update time
  audioTimeMs: number;     // Position in audio
  startTime: string;       // ISO timestamp
  confidence: number;      // API confidence score
  speaker: string;         // Speaker label
}

// 3. Browser Behavior Profile
interface BrowserBehavior {
  name: 'chrome' | 'edge' | 'unknown';
  silenceTimeout: number;      // Timeout for silence detection
  mergeTimeWindow: number;     // Time window for merging segments
  minTextLengthForCommit: number; // Min text length before commit
}
```

---

## 🔄 Data Flow

```
┌─────────────────────────────────────────────────────────┐
│         Web Speech API (onresult event)                 │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │   SmartTranscriptManager     │
        │   processResult()            │
        └──────────────┬───────────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
           ▼                       ▼
      isFinal=true           isFinal=false
           │                       │
           │                       ▼
           │          ┌─────────────────────────┐
           │          │  updateInterimBuffer()  │
           │          │  (Expanding Effect)     │
           │          └──────────┬──────────────┘
           │                     │
           │                     ▼
           │          ┌─────────────────────────┐
           │          │  startSilenceTimer()    │
           │          │  (2s countdown)         │
           │          └─────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│         commitInterimToOfficial()                        │
│         (Smart Merging Logic)                            │
└──────────────┬───────────────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌────────┐          ┌──────────┐
│ MERGE  │          │   NEW    │
│ (Case1)│          │ (Case 2) │
└────┬───┘          └────┬─────┘
     │                   │
     ▼                   ▼
┌────────────────────────────────────┐
│  confirmedSegments (Array)         │
│  ✅ Official Storage               │
└────────────────────────────────────┘
```

---

## 🎮 Commit Strategy

### Condition A: API Signal (isFinal = true)

```typescript
// Web Speech API trả về isFinal=true
this.smartManager.processResult({
  transcript: "Hello world",
  confidence: 0.95,
  isFinal: true  // ✅ Commit immediately
});
```

**Result:** Text được commit ngay từ interim buffer → confirmed segments

---

### Condition B: Silence Timeout (2 seconds)

```typescript
// User ngừng nói trong 2 giây
startSilenceTimer() {
  setTimeout(() => {
    // ⏱️ 2 seconds passed without new data
    commitInterimToOfficial();  // Force commit
  }, 2000);
}
```

**Result:** Sau 2s im lặng, interim buffer tự động commit

---

## 🔗 Smart Merging Logic

### Case 1: MERGE (Ghép vào segment cuối)

**Điều kiện:**
- Time gap < `mergeTimeWindow` (500ms Chrome, 800ms Edge)
- Cùng speaker
- Segment cuối chưa bị lock

```typescript
const lastSegment = confirmedSegments[confirmedSegments.length - 1];
const timeSinceLastSegment = audioTimeMs - lastSegment.audioTimeMs;

if (timeSinceLastSegment < mergeTimeWindow && !lastSegment.isLocked) {
  // ✅ MERGE
  lastSegment.text += ' ' + newText;
  lastSegment.endTime = currentTimestamp;
}
```

**Example:**
```
Segment 1: "Hello" (t=0ms)
+ "world"           (t=300ms) ← Gap 300ms < 500ms
= "Hello world"     ✅ MERGED
```

---

### Case 2: NEW SEGMENT (Tạo segment mới)

**Điều kiện:**
- Time gap >= `mergeTimeWindow`
- Khác speaker
- Segment cuối đã bị lock

```typescript
else {
  // ✅ CREATE NEW
  confirmedSegments.push({
    id: `transcription-${++idCounter}`,
    text: newText,
    audioTimeMs: audioTimeMs,
    isLocked: false,
    // ... other fields
  });
}
```

**Example:**
```
Segment 1: "Hello world" (t=0ms, locked)
+ "How are you"          (t=3000ms) ← Gap 3000ms > 500ms
= NEW Segment 2          ✅ NEW SEGMENT
```

---

## 🌐 Browser-Specific Behavior

### Chrome Profile

```typescript
{
  name: 'chrome',
  silenceTimeout: 1500,        // 1.5s (finalizes faster)
  mergeTimeWindow: 500,        // 500ms (stricter merging)
  minTextLengthForCommit: 5    // Min 5 chars
}
```

**Characteristics:**
- ⚡ **Fast finalization:** Trả về final results nhanh hơn
- 🎯 **Fewer interim updates:** Ít interim results hơn Edge
- 🔒 **Stricter merging:** Merge window ngắn hơn (500ms)

---

### Edge Profile

```typescript
{
  name: 'edge',
  silenceTimeout: 2000,        // 2s (more patient)
  mergeTimeWindow: 800,        // 800ms (more generous)
  minTextLengthForCommit: 3    // Min 3 chars
}
```

**Characteristics:**
- 🐌 **Slower finalization:** Final results chậm hơn
- 📊 **More interim updates:** Nhiều interim updates hơn Chrome
- 🤝 **Generous merging:** Merge window dài hơn (800ms)

---

## 📱 UI Integration

### Getting UI State

```typescript
const state = smartManager.getUIState();

// State structure:
{
  segments: TranscriptionResult[],      // Confirmed segments
  currentInterim: TranscriptionResult | null  // Active interim buffer
}
```

### Rendering Logic

```tsx
// Render confirmed segments
{state.segments.map(segment => (
  <TranscriptionItem 
    key={segment.id}
    data={segment}
    isFinal={true}  // ✅ Official
  />
))}

// Render interim buffer (if exists)
{state.currentInterim && (
  <TranscriptionItem 
    key={state.currentInterim.id}
    data={state.currentInterim}
    isFinal={false}  // ❌ Temporary (expanding)
  />
)}
```

---

## 🔧 Usage Example

### Initialization

```typescript
import { SmartTranscriptManager } from './smartTranscriptManager';

const manager = new SmartTranscriptManager();

// Initialize with callback
manager.initialize((segments, interim) => {
  // Send confirmed segments to UI
  segments.forEach(seg => onTranscription(seg));
  
  // Send interim buffer to UI
  if (interim) {
    onTranscription({
      ...interim,
      isFinal: false
    });
  }
});
```

### Processing Results

```typescript
recognition.onresult = (event) => {
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];
    
    // Process through SmartTranscriptManager
    manager.processResult({
      transcript: result[0].transcript,
      confidence: result[0].confidence,
      isFinal: result.isFinal,
      speaker: 'Person1'
    });
  }
};
```

### Stopping

```typescript
// Force commit any pending interim buffer
manager.forceCommit();

// Reset for next session
manager.reset();
```

---

## 📊 Performance Benefits

### Before Refactoring

- 🐌 Complex nested logic in event handler
- 🔄 Multiple setTimeout/setInterval timers
- 🎭 No browser-specific optimization
- 🔀 Inconsistent segment creation

### After Refactoring

- ⚡ Clean separation of concerns
- 🎯 Single source of truth (SmartTranscriptManager)
- 🌐 Browser-aware behavior
- 🔗 Intelligent segment merging

---

## 🔮 Future Enhancements

1. **Speaker Change Detection:** Auto-create new segment on speaker change
2. **Confidence-based Merging:** Only merge high-confidence segments
3. **Sentence Boundary Detection:** Use NLP to detect sentence boundaries
4. **Custom Merge Strategies:** Allow user-defined merge logic
5. **Undo/Redo Support:** Track segment history for undo/redo

---

## 📝 API Reference

### SmartTranscriptManager

#### Methods

- `initialize(callback)` - Initialize manager with update callback
- `reset()` - Reset all state
- `processResult(result)` - Process incoming transcript result
- `forceCommit()` - Force commit current interim buffer
- `getUIState()` - Get current state for rendering
- `lockSegment(id)` - Lock segment to prevent merging
- `getBrowserInfo()` - Get browser behavior profile
- `destroy()` - Cleanup resources

#### Properties

- `confirmedSegments` - Array of confirmed segments (private)
- `interimBuffer` - Current interim buffer (private)
- `browserBehavior` - Browser-specific behavior profile

---

## 🎯 Key Takeaways

1. **Buffer & Commit Strategy:** Tách biệt rõ ràng giữa temporary và official data
2. **Smart Merging:** Merge dựa trên time window và context
3. **Browser Awareness:** Tối ưu cho từng trình duyệt
4. **Clean Architecture:** Separation of concerns, easy to test and maintain
5. **Expanding Effect:** Interim buffer với fixed ID tạo hiệu ứng "growing text"

---

**Created:** January 29, 2026  
**Author:** GitHub Copilot + Human Collaboration  
**Version:** 1.0
