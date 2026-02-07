# Rà Soát Luồng Xử Lý: Chuyển Đổi Giọng Nói Sang Văn Bản Bằng Gemini

## 📋 Tổng Quan

Ứng dụng sử dụng **2 API khác nhau** cho chuyển đổi giọng nói sang văn bản:

1. **Web Speech API** (Miễn phí) - Dùng cho **ghi âm trực tiếp** (live recording)
2. **Google Cloud Speech-to-Text API** - Dùng khi cần diarization hoặc fallback
3. **Gemini AI API** - Dùng cho **chuẩn hóa & tóm tắt** văn bản đã ghi âm

---

## 🔄 Luồng 1: Ghi Âm Trực Tiếp (Live Recording)

### 1.1 Khởi Động Ghi Âm
```
┌─────────────────────────────────────────────────────────────┐
│                   App.tsx (Component)                        │
│  - Lấy config từ localStorage                               │
│  - Khởi tạo SpeechToTextService                             │
│  - Bắt đầu ghi âm (RecordingControls.tsx)                   │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│            AudioRecorderService.startRecording()             │
│  ❌ Microphone: getUserMedia()                              │
│  ❌ System Audio: getDisplayMedia()                         │
│  ❌ Both: Kết hợp cả hai                                    │
│  Returns: MediaStream                                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│         SpeechToTextService.startTranscription()            │
│  1. Kiểm tra Web Speech API có sẵn không                    │
│  2. Nếu có: Dùng Web Speech API                            │
│  3. Nếu không: Fallback Google Cloud API                   │
└─────────────────────┬───────────────────────────────────────┘
```

### 1.2 Web Speech API - Xử Lý Live
```
┌─────────────────────────────────────────────────────────────┐
│         SpeechToTextService.tryWebSpeechAPI()               │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   INTERIM      INTERIM          FINAL
   (Short)      (Long)           (Rare)
   ≤10 từ       >10 từ           từ Google
     │            │               │
     │            ▼               ▼
     │    Display trực tiếp   Ignore (xử lý
     │    Không tích lũy      nội bộ thay)
     │
     ▼
  ✨ SmartTranscriptManager
     ├─ Accumulate Text (tích lũy)
     │  • Ghép text ngắn dần dần
     │  • Phát hiện duplicate
     │  • Lưu timestamp bắt đầu
     │
     ├─ Silence Detection (im lặng)
     │  • Đợi ~800ms im lặng
     │  • COMMIT text tích lũy thành segment chính thức
     │  • Reset để tích lũy màu
     │
     └─ Force Commit (khi quá dài)
        • Nếu tích lũy >250 từ
        • COMMIT ngay thành segment
```

### 1.3 SmartTranscriptManager - Cơ Chế Buffer & Commit

**Chiến lược tích lũy thông minh:**

```
┌──────────────────────────────────────────────────┐
│     Xử Lý Interim Text từ Web Speech API         │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────┐
    │  Phân loại kết quả              │
    ├─────────────────────────────────┤
    │  isShortChunk? (≤10 từ)         │
    └────┬──────────────────────────┬─┘
         │ YES                      │ NO
         ▼                          ▼
    ACCUMULATE              DISPLAY ONLY
    (tích lũy)              (không tích lũy)
    ├─ Lưu start time       │
    ├─ Ghép vào interim     │  Nếu không có
    ├─ KT trùng lặp         │  interim text
    └─ Kiểm tra độ dài      │  → dùng làm
       (>250 từ?)           │     fallback
         │
         ├─ YES → COMMIT NGAY
         │
         └─ NO → Đợi silence
            (800ms im lặng)
               │
               ▼
            COMMIT
            (segment chính thức)
               │
               ├─ Hash verification
               │  (tránh duplicate)
               │
               ├─ Timestamp verification
               │
               └─ Emit TranscriptionResult
```

**Phát hiện Duplicate - 3 cấp độ:**

1. **Hash Check** - Kiểm tra text đã commit trước
2. **Last Segment Check** - So sánh với segment cuối cùng
3. **Word Overlap Check** - Nếu >50% từ giống → duplicate (bỏ)

### 1.4 Ghép Text Thông Minh (accumulateInterimText)

```
┌─────────────────────────────────────────────────────┐
│  Khi nhận text mới từ Web Speech API                │
│  So sánh với interim text hiện tại                  │
└─────────────────────┬───────────────────────────────┘
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
    ▼                 ▼                 ▼
Case 1:           Case 2:           Case 3-5:
Text mới          Text cũ            Khác hoàn
BẮT ĐẦU          BẮT ĐẦU các         toàn
bằng text         từ text mới
cũ                (hiếm)            ├─ Tìm overlap
│                 │                 │  từ cuối
├─ Lấy phần      ├─ Giữ text       │
│  mới thêm      │  cũ (dài hơn)   └─ KT trùng lặp
│                │                  (nếu >50%
└─ Ghép vào     └─ Return text      từ giống)
   cuối            cũ

Result: accumulatedText (ghép hợp lý)
```

---

## 🧠 Luồng 2: AI Refinement Với Gemini

### 2.1 Khi Nào Dùng Gemini?
```
Sau khi kết thúc ghi âm hoặc load project:
1. User click nút "Refine với AI" / "Tinh chỉnh với Gemini"
2. App.tsx gọi AIRefinementService.refineTranscripts()
3. Gửi danh sách TranscriptionResult đến Gemini
4. Nhận lại kết quả đã chuẩn hóa + summary
```

### 2.2 Quy Trình Refinement Chi Tiết

```
┌──────────────────────────────────────────────────────┐
│  App.tsx: handleRefineWithAI()                       │
│  ├─ Kiểm tra API Key & Model                        │
│  ├─ Kiểm tra Gemini API có sẵn                      │
│  ├─ Hiển thị dialog chọn phương án nếu file dài     │
│  └─ Gọi AIRefinementService                         │
└─────────────┬──────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────┐
│  AIRefinementService.refineTranscripts()             │
│  ├─ Kiểm tra quota (ước tính tokens)                │
│  │  estimatedTokens = (totalChars / 3) + 500        │
│  │                                                  │
│  │  Nếu > 80% hạn mức (250K tokens/ngày)           │
│  │  → Dùng batch processing                         │
│  │                                                  │
│  └─ Gọi refineWithGemini() hoặc                     │
│     refineTranscriptsInBatches()                    │
└─────────────┬──────────────────────────────────────┘
```

### 2.3 Batch Processing (Nếu Dữ Liệu Lớn)

```
┌────────────────────────────────────────────────────┐
│  refineTranscriptsInBatches()                      │
│  ├─ Split thành batches                           │
│  │  • BATCH_SIZE = 30 segments/batch               │
│  │  • ~5000 tokens/batch                          │
│  │                                                │
│  └─ Loop qua từng batch:                          │
│     ├─ Gọi refineWithGemini() cho batch           │
│     ├─ Cộng dồn kết quả                           │
│     ├─ Delay 6 giây giữa các batches              │
│     │  (tránh rate limit 15 req/min)              │
│     └─ Kiểm tra quota (429 error)                 │
│        Nếu vượt → throw lỗi với gợi ý            │
└────────────────────────────────────────────────────┘
```

### 2.4 Gọi Gemini API

```
┌──────────────────────────────────────────────────────┐
│  refineWithGemini()                                  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  1️⃣ Validate Input                                  │
│     • API Key không rỗng                            │
│     • Transcriptions không rỗng                     │
│     • Model name = "models/gemini-2.5-flash"       │
│                                                      │
│  2️⃣ Chuẩn bị dữ liệu                                │
│     Transcript Data (chính):                        │
│     [                                               │
│       {timestamp, audioTimeMs, text},               │
│       {timestamp, audioTimeMs, text},               │
│       ...                                           │
│     ]                                               │
│                                                      │
│     Raw Data (tham khảo, tùy chọn):                │
│     [                                               │
│       {timestamp, audioTimeMs, text},               │
│       ...                                           │
│     ]                                               │
│                                                      │
│  3️⃣ Tạo Prompt                                      │
│     • Vai trò: "Thư ký chuyên nghiệp"              │
│     • Nhiệm vụ: Chuẩn hóa văn bản                  │
│     • Token budget: 8000 output tokens              │
│     • Auto-stop nếu hết token                      │
│                                                      │
│  4️⃣ Gọi Gemini API                                 │
│     POST https://generativelanguage.../generateContent
│     Headers: Content-Type: application/json        │
│     Body: {                                         │
│       contents: [{ parts: [{ text: prompt }] }],   │
│       generationConfig: {                          │
│         temperature: 0.1,  // Consistent           │
│         topK: 40,                                   │
│         topP: 0.95,                                │
│         maxOutputTokens: 8192,                     │
│         responseMimeType: 'application/json'       │
│       },                                            │
│       safetySettings: [...]  // All BLOCK_NONE     │
│     }                                               │
│                                                      │
│  5️⃣ Xử Lý Response                                  │
│     ├─ Success (200)                              │
│     │  └─ Parse JSON response                     │
│     │     (summary + segments)                     │
│     │                                              │
│     ├─ Error 429 (Quota/Rate Limit)               │
│     │  └─ Phân biệt:                              │
│     │     • Daily quota (250K tokens) → đợi 24h   │
│     │     • Rate limit (15 req/min) → đợi vài phút│
│     │                                              │
│     ├─ Error 403 (Invalid Key)                    │
│     │  └─ Hướng dẫn lấy key từ aistudio.google    │
│     │                                              │
│     └─ Error 404 (Model không tồn tại)            │
│        └─ Hướng dẫn reload model list             │
│                                                      │
│  6️⃣ Parse & Return                                 │
│     {                                               │
│       segments: [ RefinedSegment[] ],              │
│       summary?: string,                            │
│       isTruncated?: boolean,                       │
│       truncationWarning?: string                   │
│     }                                               │
└──────────────────────────────────────────────────────┘
```

### 2.5 Xử Lý Response từ Gemini

```
┌───────────────────────────────────────────────────┐
│  parseAIResponse()                                │
├───────────────────────────────────────────────────┤
│                                                   │
│  Input:                                           │
│  {                                                │
│    candidates: [{                                │
│      finishReason: "MAX_TOKENS" | "STOP",        │
│      content: {                                   │
│        parts: [{                                 │
│          text: "...JSON string..."               │
│        }]                                         │
│      }                                            │
│    }]                                             │
│  }                                                │
│                                                   │
│  ├─ Kiểm tra truncation                         │
│  │  (finishReason === "MAX_TOKENS")              │
│  │                                                │
│  ├─ Extract JSON từ response                     │
│  │  • Remove markdown code blocks                │
│  │  • Tìm { ... } hoặc [ ... ]                  │
│  │                                                │
│  ├─ Parse JSON                                   │
│  │  • Xử lý unescaped newlines                   │
│  │  • Fix common JSON issues                     │
│  │                                                │
│  ├─ Support 2 format:                            │
│  │  • Array: [{text, timestamp, ...}, ...]      │
│  │  • Object: {summary: "...", segments: [...]} │
│  │                                                │
│  ├─ Validate segments                            │
│  │  • Filter empty text                          │
│  │  • Map to RefinedSegment                      │
│  │                                                │
│  └─ Build truncation warning                     │
│     Nếu response bị cắt                          │
│                                                   │
│  Output:                                          │
│  {                                                │
│    segments: [                                    │
│      { text, timestamp, audioTimeMs },           │
│      ...                                          │
│    ],                                             │
│    summary: "...",                               │
│    isTruncated: boolean,                         │
│    truncationWarning: string?                    │
│  }                                                │
└───────────────────────────────────────────────────┘
```

### 2.6 Prompt Template Usado para Gemini

```
Vai trò: Thư ký chuyên nghiệp soạn biên bản họp.

Nhiệm vụ: Chuẩn hóa văn bản speech-to-text:
1. Sửa lỗi nhận diện từ
2. Xóa từ đệm (à, ừm, thì, là, mà)
3. Thêm dấu câu, viết hoa danh từ riêng
4. Giữ nguyên nội dung, không thêm bớt ý
5. Tóm tắt toàn bộ nội dung cuộc họp

📊 NGÂN SÁCH TOKEN:
Bạn có tối đa ~8000 tokens cho output

🎯 CHIẾN LƯỢC 2 BƯỚC - ƯU TIÊN SUMMARY:

📝 BƯỚC 1 - BẮT BUỘC HOÀN THÀNH TRƯỚC:
   • Tạo "summary" HOÀN CHỈNH (~300-400 từ)
   • Bao gồm: Chủ đề chính, quyết định, kết luận

🔢 BƯỚC 2 - XỬ LÝ SEGMENTS:
   • NẾU ÍT SEGMENTS (<30): Chuẩn hóa CHI TIẾT
   • NẾU VỪA (30-100): GỘP nhẹ, cô đọng
   • NẾU NHIỀU (>100): GỘP MẠNH, chỉ ý chính

⚠️ QUY TẮC TỰ ĐỘNG DỪNG (AUTO-STOP):
   • NẾU ước tính ~6000 tokens (75% budget):
     → DỪNG NGAY xử lý segments
     → ĐÓNG JSON đúng cú pháp
   • TỐT HƠN: Summary đầy đủ + Segments một phần
   • TỆ HƠN: JSON bị cắt ngang không hợp lệ

Output: CHỈ JSON object, KHÔNG markdown
Format: {
  "summary": "...",
  "segments": [{"timestamp":"...","text":"..."},...]
}
```

---

## 🎯 Xử Lý Lỗi & Quota

### 3.1 Quota Management

```
┌───────────────────────────────────────────────┐
│         Gemini Free Tier Limits                │
├───────────────────────────────────────────────┤
│  • 250,000 tokens/ngày (TPD)                  │
│  • 1,000,000 tokens/phút (TPM)                │
│  • 15 requests/phút (RPM)                     │
│  • 1,500 requests/ngày (RPD)                  │
└───────────────────────────────────────────────┘

┌───────────────────────────────────────────────┐
│         Ước Tính Token                         │
├───────────────────────────────────────────────┤
│  Formula:                                     │
│  estimatedTokens = (totalChars / 3) + 500    │
│                                               │
│  - totalChars = tổng ký tự transcriptions    │
│  - 500 = overhead cho prompt (optimized)     │
│  - 1 token ≈ 3 ký tự (Vietnamese)            │
│                                               │
│  Example: 100 segments × 50 chars = 5000 chars
│           5000/3 + 500 = ~2,166 tokens ✅    │
└───────────────────────────────────────────────┘
```

### 3.2 Rate Limiting

```
┌─────────────────────────────────────────────────┐
│  Batch Processing Delay                         │
├─────────────────────────────────────────────────┤
│  • Giữa các batch: 6 giây (BATCH_DELAY_MS)     │
│  • Lý do: Tránh vượt 15 requests/phút           │
│  • 30 segments/batch + 6s delay                │
│    → ~2-3 req/phút (an toàn)                   │
└─────────────────────────────────────────────────┘
```

### 3.3 Error Handling

```
┌────────────────────────────────────────────┐
│  HTTP 429 (Rate Limit/Quota Exceeded)      │
├────────────────────────────────────────────┤
│                                            │
│  if error.includes('quota' or '250000'):  │
│    ├─ Daily quota vượt                    │
│    ├─ Đợi 24 giờ để reset                │
│    └─ Hoặc nâng cấp paid tier             │
│                                            │
│  else (trong rate limit):                 │
│    ├─ Vượt 15 reqs/phút                  │
│    ├─ Đợi vài phút (retry header)        │
│    └─ Batch delay đã tự động              │
│       kéo dài                              │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│  HTTP 403 (Invalid/Disabled API)           │
├────────────────────────────────────────────┤
│  ├─ Key không hợp lệ                      │
│  ├─ API chưa enable                       │
│  └─ Hướng dẫn: Lấy key tại aistudio       │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│  HTTP 404 (Model không tồn tại)           │
├────────────────────────────────────────────┤
│  ├─ Model name sai format                 │
│  ├─ Model không khả dụng                  │
│  └─ Hướng dẫn: Reload model list          │
└────────────────────────────────────────────┘
```

---

## 🗺️ Luồng Đầu Cuối (End-to-End)

```
┌───────────────────────────────────────────────────────────┐
│                    USER FLOW                              │
├───────────────────────────────────────────────────────────┤
│                                                            │
│  1. Click "Bắt đầu ghi âm"                              │
│     ↓                                                     │
│  2. AudioRecorderService.startRecording()                │
│     ├─ Lấy microphone / system audio / cả hai           │
│     └─ Returns: MediaStream                              │
│     ↓                                                     │
│  3. SpeechToTextService.startTranscription()            │
│     ├─ Try Web Speech API (prioritized)                 │
│     └─ Fallback Google Cloud API                        │
│     ↓                                                     │
│  4. SmartTranscriptManager xử lý interim results         │
│     ├─ Accumulate short chunks                          │
│     ├─ Detect silence → COMMIT                          │
│     ├─ Prevent duplicates                               │
│     └─ Emit TranscriptionResult to UI                   │
│     ↓                                                     │
│  5. TranscriptionPanel hiển thị kết quả live            │
│     ├─ Scroll auto-bottom                               │
│     ├─ User có thể edit từng segment                    │
│     └─ Hiển thị waveform & audio player                │
│     ↓                                                     │
│  6. Click "Tinh chỉnh với AI" / "Refine with Gemini"   │
│     ├─ Kiểm tra quota (estimate tokens)                │
│     ├─ Nếu cần: Hiển thị dialog chọn phương án         │
│     │  - Full auto-split                               │
│     │  - Manual segment selection                       │
│     └─ Gửi data đến Gemini API                         │
│     ↓                                                     │
│  7. AIRefinementService.refineTranscripts()             │
│     ├─ Split thành batches (nếu cần)                   │
│     ├─ Loop + batch processing với 6s delay            │
│     └─ Accumulate results                               │
│     ↓                                                     │
│  8. Parse & Display Results                             │
│     ├─ Update transcriptions với refined text           │
│     ├─ Display Gemini summary                           │
│     ├─ Show truncation warning (nếu có)                │
│     └─ Save to project folder (tùy chọn)               │
│                                                            │
└───────────────────────────────────────────────────────────┘
```

---

## 🔍 Data Flow Diagram

```
                    ┌─────────────────┐
                    │   App.tsx       │
                    │  (State Mgmt)   │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
   ┌─────────┐    ┌──────────────┐       ┌──────────────┐
   │Audio    │    │Speech-to-Text│       │AI Refinement │
   │Recorder │    │Service       │       │Service       │
   │Service  │    │(Live)        │       │(Gemini)      │
   └────┬────┘    └──────┬───────┘       └──────┬───────┘
        │                │                      │
        │          ┌─────▼────────┐             │
        │          │SmartTranscript│             │
        │          │Manager        │             │
        │          └─────┬─────────┘             │
        │                │                      │
        └────────────────┼──────────────────────┘
                         │
              ┌──────────▼──────────┐
              │TranscriptionResult  │
              │ - id                │
              │ - text              │
              │ - startTime         │
              │ - endTime           │
              │ - audioTimeMs       │
              │ - confidence        │
              │ - speaker           │
              └────────┬────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
   ┌─────────┐  ┌──────────┐  ┌─────────────┐
   │Transcr. │  │Audio     │  │Save to      │
   │Panel    │  │Player    │  │Project      │
   │(Display)│  │(Seek)    │  │(FileSystem) │
   └─────────┘  └──────────┘  └─────────────┘
```

---

## ⚙️ Configuration

### API Keys & Settings

```javascript
// SpeechToTextConfig (lưu trong localStorage)
{
  apiKey: "AIza...",  // Google Cloud API Key (optional)
  geminiApiKey: "AIza...",  // Gemini API Key (required for refinement)
  geminiModel: "models/gemini-2.5-flash",  // Selected Gemini model
  languageCode: "vi-VN",  // Language
  enableSpeakerDiarization: false,  // Diarization (requires Google API)
  enableAutomaticPunctuation: true,
  maxAlternatives: 1,
  minSpeakerCount: 2,
  maxSpeakerCount: 6,
  segmentTimeout: 2500,  // ms
  segmentMaxLength: 300,  // chars
  timestampDelay: 8,  // seconds
  
  // Gemini limits
  maxAudioDurationMinutes: 60,
  maxFileSizeMB: 20,
  requestDelaySeconds: 5,
  summaryPrompt: "..."  // Custom prompt
}
```

---

## 📌 Key Points to Remember

### ✅ Ưu Điểm Của Thiết Kế Hiện Tại

1. **Web Speech API Priority** - Miễn phí, nhanh cho live streaming
2. **SmartTranscriptManager** - Tích lũy thông minh, phát hiện duplicate tốt
3. **Batch Processing** - Xử lý file dài mà không vượt quota
4. **Error Handling** - Phân biệt rõ loại lỗi (quota vs rate limit)
5. **Flexible Refinement** - Support 2 cách gửi: toàn bộ hoặc manual range

### ⚠️ Lưu Ý Khi Kiểm Thử

1. **Web Speech API** chỉ hoạt động trong trình duyệt hỗ trợ (Chrome, Edge)
2. **Gemini quota** reset mỗi 24h, không phải mỗi giờ
3. **Batch delay 6s** là an toàn cho rate limit 15 req/min
4. **SmartTranscriptManager** phụ thuộc vào time bắt đầu tích lũy
5. **Silence timeout 800ms** có thể điều chỉnh trong `smartTranscriptManager.ts`

### 🔧 Có Thể Tối Ưu

1. **Detect browser** để điều chỉnh silence timeout (Chrome vs Edge)
2. **Progressive refinement** - Refine từng segment khi commit (không chờ cuối)
3. **Caching** - Cache kết quả Gemini để tránh gọi lại
4. **Confidence score** - Filter low-confidence segments trước khi refine

---

## 📄 File Liên Quan

| File | Chức Năng |
|------|----------|
| `speechToText.ts` | Quản lý Web Speech API + Google Cloud API (live) |
| `smartTranscriptManager.ts` | Buffer & commit strategy, duplicate detection |
| `aiRefinement.ts` | Gọi Gemini API, batch processing, quota mgmt |
| `audioRecorder.ts` | Ghi âm từ microphone / system audio |
| `App.tsx` | Wiring tất cả services, state management |
| `TranscriptionPanel.tsx` | Hiển thị transcriptions, cho phép edit |
| `TranscriptionConfig.tsx` | Config API keys & settings |

---

## 🎓 Công Thức Ước Tính Token

```
estimatedTokens = (totalChars / 3) + 500

Ví dụ:
- 10 segments × 50 chars = 500 chars
- 500 / 3 = ~167 tokens (content)
- 167 + 500 = 667 tokens (với overhead)
- Safety margin: 667 / 250000 = 0.27% hạn mức ✅

- 100 segments × 100 chars = 10,000 chars
- 10000 / 3 = ~3,333 tokens
- 3,333 + 500 = 3,833 tokens ✅
```

---

**Cuối cùng:** Đây là thiết kế **production-ready** với:
- Fallback mechanisms
- Quota management
- Error handling
- Batch processing
- Duplicate detection
- Auto-retry logic

