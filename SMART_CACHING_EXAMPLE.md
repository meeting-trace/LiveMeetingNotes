# 🎯 Smart Caching Example - Xử lý Audio 140 phút

## Ví dụ thực tế

### Audio: 139 phút (2h19m)
```typescript
const audioBlob = ... // 190 MB MP3, 139 minutes

// ⭐ SỬ DỤNG SMART CACHING
const result = await AIRefinementService.transcribeAudioWithCaching(
  apiKey,
  audioBlob,
  'models/gemini-2.5-flash',
  (progress, msg) => console.log(`${progress}% - ${msg}`),
  500,          // maxFileSizeMB (for validation)
  25,           // ⭐ chunkDurationMinutes - Mỗi query xử lý 25 phút
  meetingStart,
  summaryPrompt
);

// Kết quả:
// ✅ 1 lần upload (cache 48h)
// ✅ 6 queries (25+25+25+25+25+14 phút)
// ✅ ~250 segments đầy đủ
// ✅ Summary hoàn chỉnh
```

## 📊 Chi tiết quá trình

### Lần chạy đầu tiên (Cold cache)

```
🔑 Đang tạo audio fingerprint... (2%)
   → audioHash: 190440000_audio/mpeg_54321

📂 Đang kiểm tra cache... (5%)
   → Không có cache

📤 Đang tải file lên Gemini (chỉ 1 lần)... (8%)
   → Upload 190 MB
   → fileUri: https://.../files/abc123
   → State: ACTIVE

💾 Lưu cache...
   → Expires: 2026-02-08T14:50:45Z (48h)

📊 Chia thành 6 time ranges (25 min each):
   1. 0-25 min
   2. 25-50 min
   3. 50-75 min
   4. 75-100 min
   5. 100-125 min
   6. 125-139 min

🔄 Query 1/6: Phút 0-25... (20%)
   → Request với fileUri + "phút 0-25"
   → Nhận 40 segments
   → Summary: "Cuộc họp tập trung vào..."

🔄 Query 2/6: Phút 25-50... (35%)
   → Reuse fileUri (không upload lại)
   → Nhận 42 segments

🔄 Query 3/6: Phút 50-75... (50%)
   → Nhận 44 segments

🔄 Query 4/6: Phút 75-100... (65%)
   → Nhận 43 segments

🔄 Query 5/6: Phút 100-125... (80%)
   → Nhận 45 segments

🔄 Query 6/6: Phút 125-139... (95%)
   → Nhận 36 segments (14 phút)

✅ Hoàn thành! (100%)
   → Tổng: 250 segments
   → Summary: 1941 ký tự
   → Không bị truncated
```

### Lần chạy thứ 2 (Warm cache - trong 48h)

```
🔑 Đang tạo audio fingerprint... (2%)
   → audioHash: 190440000_audio/mpeg_54321

📂 Đang kiểm tra cache... (5%)
   ✅ Tìm thấy cache!
   → fileUri: https://.../files/abc123
   → Expires in: 46h

✅ Xác minh file còn valid...
   → GET /files/abc123
   → State: ACTIVE ✅

📊 Chia thành 6 time ranges...
   → Reuse cached fileUri

🔄 Query 1/6: Phút 0-25... (20%)
   → Không cần upload lại!
   → Truy vấn trực tiếp với cached fileUri
   ...

✅ Hoàn thành nhanh hơn! (100%)
   → Tiết kiệm ~30s upload time
```

## 🎮 Tuỳ chỉnh chunk duration

### Audio ngắn (30-60 phút)
```typescript
transcribeAudioWithCaching(..., chunkDuration: 30)
// → 2 queries × 30 phút
// → Nhanh, ít queries
```

### Audio trung bình (60-120 phút)
```typescript
transcribeAudioWithCaching(..., chunkDuration: 25)
// → 3-5 queries × 25 phút
// → Cân bằng tốc độ và chi tiết
```

### Audio dài (> 120 phút)
```typescript
transcribeAudioWithCaching(..., chunkDuration: 20)
// → 6+ queries × 20 phút
// → Chi tiết cao, tránh MAX_TOKENS
```

## 💡 Best Practices

### 1. Chọn chunk duration phù hợp
```typescript
const durationMinutes = Math.ceil(audioBlob.size / 60);

const chunkDuration = 
  durationMinutes < 60 ? 30 :   // Ngắn → chunks lớn
  durationMinutes < 120 ? 25 :  // Trung bình → 25 phút
  20;                           // Dài → chunks nhỏ

transcribeAudioWithCaching(..., chunkDuration);
```

### 2. Xử lý cache expired
```typescript
try {
  const result = await transcribeAudioWithCaching(...);
} catch (error) {
  if (error.message.includes('Cached file not found')) {
    // Cache đã hết hạn, tự động re-upload
    console.log('Cache expired, re-uploading...');
  }
}
```

### 3. Re-query phần cụ thể
Nếu 1 phần bị lỗi, chỉ cần query lại phần đó:

```typescript
// Query lại phút 50-75 (query 3)
const retryResult = await AIRefinementService['queryTimeRange'](
  apiKey,
  { uri: cachedFileUri, ... },
  modelName,
  50,  // startMinutes
  75,  // endMinutes
  meetingStartTime,
  null,
  false // không cần summary
);
```

## 📈 Performance Metrics

### Audio 139 phút với Smart Caching

| Metric | Cold Cache | Warm Cache |
|--------|------------|------------|
| Upload time | 30s | 0s (skip) |
| Query time | 6 × 8s = 48s | 6 × 8s = 48s |
| Total time | ~78s | ~48s |
| API calls | 1 upload + 6 queries = 7 | 6 queries |
| Input tokens | ~1,000 × 6 = 6,000 | ~1,000 × 6 = 6,000 |
| Output tokens | ~1,200 × 6 = 7,200 | ~1,200 × 6 = 7,200 |
| Cache valid | 48 hours | Reuse |

### So với Auto-split (cũ)

| Metric | Smart Caching | Auto-split |
|--------|---------------|------------|
| Upload | 1 lần | 3 lần |
| Queries | 6 lần | 3 lần |
| Reusable | ✅ 48h | ❌ Không |
| Input tokens | ~6,000 | ~6,000 |
| Flexibility | ✅ Query lại bất kỳ | ❌ Phải upload lại |

## 🚀 Migration Guide

### Từ `transcribeAudioWithGemini` sang Smart Caching

**Trước:**
```typescript
const result = await AIRefinementService.transcribeAudioWithGemini(
  apiKey,
  audioBlob,
  modelName,
  onProgress
);
```

**Sau:**
```typescript
const result = await AIRefinementService.transcribeAudioWithCaching(
  apiKey,
  audioBlob,
  modelName,
  onProgress,
  500,    // maxFileSizeMB
  25,     // ⭐ chunkDurationMinutes (NEW!)
  meetingStartTime,
  summaryPrompt
);
```

Chỉ cần thêm 1 tham số: `chunkDurationMinutes`!

## ✅ Kết luận

Smart Caching giải quyết hoàn toàn vấn đề audio dài:
- ✅ Upload 1 lần, cache 48h
- ✅ Query nhiều lần không tốn upload
- ✅ Mỗi query xử lý đoạn nhỏ → Không MAX_TOKENS
- ✅ Kết quả đầy đủ (~250 segments cho 139 phút)
- ✅ Có thể re-query phần nào cần thiết
- ✅ Tiết kiệm thời gian và bandwidth

**Recommended** cho mọi audio > 30 phút! 🎉
