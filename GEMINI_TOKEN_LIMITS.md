# 📊 Giới Hạn Token Gemini API - Hướng Dẫn Chi Tiết

## 🎯 Tổng Quan Giới Hạn (Free Tier)

Gemini API Free Tier có các giới hạn sau:

| Giới hạn | Giá trị | Mô tả |
|----------|---------|-------|
| **RPM** | 15 requests/phút | Số lượng request tối đa mỗi phút |
| **TPM** | 1,000,000 tokens/phút | Tổng tokens (input + output) mỗi phút |
| **RPD** | 1,500 requests/ngày | Số lượng request tối đa mỗi ngày |
| **TPD** | 250,000 tokens/ngày | Tổng tokens (input + output) mỗi ngày ⚠️ |

> ⚠️ **Lưu ý quan trọng**: **TPD (250K tokens/ngày)** là giới hạn người dùng thường gặp nhất.

---

## 🔢 Cách Tính Token

### 1. Input Tokens (Audio)

#### Base64 Encoding (Cũ)
```
Input Tokens = File Size (MB) × 1,917 tokens/MB

Ví dụ: Audio 139 phút = 68 MB
→ Input = 68 × 1,917 ≈ 130,356 tokens
```

#### File API (Mới) ⚡
```
Input Tokens = ~1,000 tokens (chỉ tham chiếu file URI)

Ví dụ: Audio 139 phút = 68 MB
→ Input = 1,000 tokens (tiết kiệm 99.2%)
```

### 2. Output Tokens (Transcription)

```
Output Tokens = Số đoạn × ~40 tokens/đoạn (trung bình)

Ví dụ: 250 đoạn
→ Output = 250 × 40 ≈ 10,000 tokens
→ Nhưng giới hạn maxOutputTokens = 8,192 tokens
```

### 3. Tổng Token Tiêu Thụ

```
Total = Input Tokens + Output Tokens

Base64 (cũ):
  139 phút → 130,356 + 8,192 = 138,548 tokens/query

File API Simple (cũ):
  139 phút → 130,356 + 8,192 = 138,548 tokens/query

Smart Caching (mới) ⚡:
  139 phút → (1,000 + 8,192) × 6 queries = 55,152 tokens TOTAL
```

---

## 📊 So Sánh Chi Tiết

### Kịch Bản: Audio 139 Phút

| Phương pháp | Input/query | Output/query | Queries | Total Tokens | % Quota | Kết quả |
|-------------|-------------|--------------|---------|--------------|---------|---------|
| **Base64** | 130,356 | 8,192 | 1 | 138,548 | 55% | ❌ 42 đoạn (thiếu) |
| **File API Simple** | 130,356 | 8,192 | 1 | 138,548 | 55% | ❌ 42 đoạn (thiếu) |
| **Smart Caching** | 1,000 | 8,192 | 6 | 55,152 | **22%** | ✅ 250 đoạn (đầy đủ) |

> ⚡ **Kết luận**: Smart Caching tiết kiệm **60% quota** và cho kết quả **đầy đủ hơn 6x**.

---

## ⚠️ Các Tình Huống Lỗi

### 1. Lỗi MAX_TOKENS (Output)

```
❌ Error: "Candidate response exceeds max output tokens"

Nguyên nhân:
- Kết quả chuyển đổi quá dài (>8,192 tokens output)
- Audio dài (>60 phút) sinh ra >200 đoạn văn bản

Giải pháp:
✅ Dùng Smart Caching (chia nhỏ thành queries 25 phút)
✅ Mỗi query chỉ xử lý ~40 đoạn = ~1,600 tokens (OK)
```

**Ví dụ cụ thể:**
```
Audio 139 phút:
❌ Single query: Cần ~10,000 output tokens → BỊ CẮT ở 8,192
✅ 6 queries × 25 phút: Mỗi query ~1,600 tokens → HOÀN CHỈNH
```

### 2. Lỗi QUOTA_EXCEEDED (Daily)

```
❌ Error: "Quota exceeded for quota metric 'GenerateContent requests per day'"

Nguyên nhân:
- Vượt quá 250,000 tokens/ngày
- Hoặc >1,500 requests/ngày

Giải pháp:
✅ Chờ đến 00:00 UTC (7:00 sáng giờ VN) để quota reset
✅ Dùng Smart Caching để giảm token tiêu thụ
✅ Ưu tiên audio ngắn (<60 phút) khi quota thấp
```

**Tính toán quota:**
```
Với Smart Caching (139 phút = 55K tokens):
→ 250,000 / 55,000 ≈ 4.5 audio/ngày

Không Smart Caching (139 phút = 138K tokens):
→ 250,000 / 138,000 ≈ 1.8 audio/ngày (và thường bị lỗi)
```

### 3. Lỗi RATE_LIMIT (Per Minute)

```
❌ Error: "Resource has been exhausted (e.g. check quota)"

Nguyên nhân:
- Vượt quá 15 requests/phút
- Hoặc >1,000,000 tokens/phút

Giải pháp:
✅ Hệ thống tự động delay giữa các queries (6 giây)
✅ Smart Caching: 6 queries × 8K tokens = 48K tokens (OK)
✅ Không cần lo lắng về rate limit khi dùng Smart Caching
```

---

## 🎯 Khuyến Nghị Sử Dụng

### 1. Audio Ngắn (<60 phút)

**Dùng chế độ thường** (không Smart Caching):
```
✅ Lợi ích:
- Nhanh hơn (1 query duy nhất)
- Đơn giản hơn
- Đủ quota cho kết quả đầy đủ

Token tiêu thụ:
- 30 phút → ~50K tokens (20% quota/ngày)
- 50 phút → ~80K tokens (32% quota/ngày)
```

### 2. Audio Dài (60-180 phút)

**Dùng Smart Caching** (tự động):
```
✅ Lợi ích:
- Kết quả đầy đủ (không bị cắt)
- Tiết kiệm token (99.6%)
- Cache 48h cho lần sau

Token tiêu thụ:
- 90 phút → ~36K tokens (14% quota/ngày)
- 120 phút → ~45K tokens (18% quota/ngày)
- 150 phút → ~54K tokens (22% quota/ngày)
```

### 3. Audio Rất Dài (>180 phút)

**Tùy chọn**:
```
Option 1: Chia nhỏ file thành nhiều file <180 phút
Option 2: Tăng chunk duration lên 30 phút
Option 3: Nâng cấp lên Gemini API Paid tier
```

---

## 📈 Theo Dõi Token Usage

### 1. Trong Console Log

```javascript
// Smart Caching sẽ log:
⚡ Smart Caching progress: 16% - Query 1/6: 0-25 phút
⚡ Smart Caching progress: 33% - Query 2/6: 25-50 phút
...
✅ Hoàn thành Smart Caching: 250 đoạn
```

### 2. Ước Tính Token

```javascript
// Formula:
const queries = Math.ceil(durationMinutes / 25);
const estimatedTokens = queries * 9000; // ~9K per query

// Ví dụ:
139 phút → 6 queries → ~54K tokens
90 phút → 4 queries → ~36K tokens
60 phút → 3 queries → ~27K tokens
```

### 3. Kiểm Tra Quota Còn Lại

```bash
# Thử request với API key:
curl -X POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=YOUR_API_KEY \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"parts":[{"text":"test"}]}]}'

# Nếu lỗi QUOTA_EXCEEDED → Hết quota ngày hôm nay
```

---

## 🔧 Cấu Hình Token Trong Code

### aiRefinement.ts

```typescript
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
```

### App.tsx

```typescript
// Tự động chọn Smart Caching cho audio dài
if (isLongAudio) {
  // Smart Caching Mode: Upload once, query multiple time ranges
  const chunkDurationMinutes = 25; // 25-minute chunks
  const maxSegmentsPerChunk = 500; // Expect ~40 segments per chunk
  
  parsed = await AIRefinementService.transcribeAudioWithCaching(
    apiKey, audioBlob, modelName,
    onProgress,
    maxSegmentsPerChunk,
    chunkDurationMinutes,
    meetingStartTime,
    summaryPrompt
  );
}
```

---

## 💡 Mẹo Tiết Kiệm Token

### 1. Dùng Smart Caching Khi Có Thể
- ✅ Audio > 60 phút: Luôn dùng Smart Caching
- ✅ Upload 1 lần, query nhiều lần
- ✅ Cache 48h: Lần sau chỉ tốn token query

### 2. Tối Ưu Summary Prompt
```typescript
// Prompt ngắn gọn:
const summaryPrompt = "Summarize key points"; // ~5 tokens

// Thay vì:
const summaryPrompt = "Please provide a comprehensive summary of all the key points discussed in this meeting including action items, decisions made, and important topics covered"; // ~30 tokens
```

### 3. Giảm maxSegmentsPerChunk Nếu Không Cần
```typescript
// Nếu chỉ cần summary, không cần segment chi tiết:
maxSegmentsPerChunk = 100; // Thay vì 500

// → Giảm output tokens, tăng tốc độ
```

---

## 📚 Tài Liệu Liên Quan

- [SMART_CACHING_USER_GUIDE.md](./SMART_CACHING_USER_GUIDE.md) - Hướng dẫn người dùng
- [SMART_CACHING_EXAMPLE.md](./SMART_CACHING_EXAMPLE.md) - Ví dụ kỹ thuật
- [GEMINI_FILE_API_GUIDE.md](./GEMINI_FILE_API_GUIDE.md) - API documentation
- [Gemini API Pricing](https://ai.google.dev/pricing) - Trang chính thức

---

**🎉 Tóm tắt**: Smart Caching giúp bạn xử lý audio dài với **60% token ít hơn** và **6x kết quả nhiều hơn**!
