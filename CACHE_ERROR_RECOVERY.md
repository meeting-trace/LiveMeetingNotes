# 🔄 Cache Error Recovery - Tái Sử Dụng File URI

## 🎯 Vấn Đề Giải Quyết

Khi xử lý audio dài với Smart Caching, có thể xảy ra lỗi giữa chừng:
- ✅ Upload thành công (30-60 giây)
- ✅ Query đoạn 1-3 thành công
- ❌ Query đoạn 4 bị **timeout/network error/rate limit**
- ❓ **Người dùng retry → Có phải upload lại không?**

**Câu trả lời: KHÔNG!** Hệ thống đã cache File URI.

---

## 🚀 Cách Hoạt Động

### 1. Upload và Cache

```typescript
// Step 1: Upload audio to Gemini
const uploadedFile = await uploadAudioToGemini(apiKey, audioBlob, displayName);

// Step 2: Save File URI to localStorage NGAY LẬP TỨC
const cacheInfo = {
  fileUri: uploadedFile.uri,          // "files/abc123"
  fileName: uploadedFile.name,
  uploadedAt: Date.now(),
  expiresAt: Date.now() + 48h,
  audioHash: "12345_audio/wav_67890"
};
localStorage.setItem('gemini_audio_cache_12345...', JSON.stringify(cacheInfo));

console.log('💾 File URI saved to cache for future reuse');
```

### 2. Query với Error Recovery

```typescript
// Step 3: Query multiple time ranges
for (let i = 0; i < timeRanges.length; i++) {
  try {
    const result = await queryTimeRange(fileUri, range);
    allResults.push(result);
  } catch (error) {
    // ⚠️ Error occurred at range 4/6
    console.error('Query failed:', error);
    
    // ✅ Cache is PRESERVED (not deleted)
    console.log('💡 File URI is still cached. Retry will skip upload.');
    
    throw error; // Propagate to user
  }
}
```

### 3. Retry Tự Động Dùng Cache

```typescript
// User clicks Retry button
const handleRetry = async () => {
  // Step 1: Generate audio hash
  const audioHash = await generateAudioHash(audioBlob);
  
  // Step 2: Load cache
  const cachedFile = loadAudioCache(audioHash);
  
  if (cachedFile) {
    // ✅ Found cache!
    console.log('✅ Using cached file URI (skipping upload)');
    
    // UI feedback
    message.success('💾 Tìm thấy file đã upload! Bỏ qua bước upload (~30s)');
    
    // Step 3: Verify file still valid on Gemini
    const isValid = await checkCachedFileValid(apiKey, cachedFile.fileName);
    
    if (isValid) {
      // Use cached fileUri directly
      uploadedFile = {
        uri: cachedFile.fileUri,
        mimeType: cachedFile.mimeType,
        state: 'ACTIVE',
        name: cachedFile.fileName
      };
      
      // Skip to query step
      startQueries(uploadedFile);
    }
  }
};
```

---

## 📊 So Sánh Trước/Sau

### Trước Khi Có Error Recovery

```
User workflow:
1. Upload audio 139 phút (30s)          ✅
2. Query 1-3 thành công (180s)          ✅
3. Query 4 timeout                      ❌
4. User retry
5. Upload lại audio (30s)               🔄 LÃM PHÍ
6. Query 1-6 lại từ đầu (360s)          🔄 LÃM PHÍ

Total time: 30 + 180 + 30 + 360 = 600s (10 phút)
Total uploads: 2 lần (tốn quota)
User experience: 😞 Thất vọng
```

### Sau Khi Có Error Recovery ✅

```
User workflow:
1. Upload audio 139 phút (30s)          ✅
2. Cache File URI                       ✅
3. Query 1-3 thành công (180s)          ✅
4. Query 4 timeout                      ❌
5. User retry
6. Detect cache → Skip upload           ⚡ TIẾT KIỆM 30s
7. Query 1-6 lại từ đầu (360s)          🔄

Total time: 30 + 180 + 0 + 360 = 570s (9.5 phút)
Total uploads: 1 lần (tiết kiệm quota)
User experience: 😊 Hài lòng
```

**Tiết kiệm**:
- ⏱️ 30 giây upload
- 💰 1 quota upload của Gemini
- 🎯 Giảm stress cho người dùng

---

## 🔍 Kiểm Tra Cache Status

### Trong Code (Console)

```javascript
// Check if cache exists
const audioHash = await generateAudioHash(audioBlob);
const cachedFile = loadAudioCache(audioHash);

if (cachedFile) {
  console.log('✅ Cache found:', {
    fileUri: cachedFile.fileUri,
    fileName: cachedFile.fileName,
    uploadedAt: new Date(cachedFile.uploadedAt).toLocaleString(),
    expiresAt: new Date(cachedFile.expiresAt).toLocaleString(),
    durationSeconds: cachedFile.durationSeconds
  });
  
  // Verify on Gemini servers
  const isValid = await checkCachedFileValid(apiKey, cachedFile.fileName);
  console.log('File on Gemini:', isValid ? '✅ ACTIVE' : '❌ EXPIRED');
}
```

### Trên UI (Người dùng)

#### 1. TranscriptionPanel Header
```
[ 🎙️ Kết quả chuyển đổi ]
[ 250 đoạn ]  [ ⚡ Cached (47h) ] ← Cache status
```

#### 2. Progress Message
```
"🔑 Đang tạo audio fingerprint..."     (2%)
"📂 Đang kiểm tra cache..."            (5%)
"🔍 Tìm thấy file đã upload..."         (7%)
"✅ Đang dùng file đã upload (tiết kiệm ~30s)"  (15%)
"🔄 Đang xử lý phút 0-25 (1/6)..."     (20%)
```

#### 3. Success Notification
```
💾 Tìm thấy file đã upload! Bỏ qua bước upload (~30s)
```

---

## ⚠️ Giới Hạn Quan Trọng

### 1. File URI Chỉ Dùng Với Cùng API Key

**Câu hỏi: File URI có dùng được với API Key khác không?**

**Trả lời: KHÔNG!** Đây là giới hạn bảo mật của Gemini File API.

```
Kịch bản:
1. Upload audio với API Key A
   → File URI: "files/abc123"
   → Cache lưu: fileUri + apiKeyHash(A)

2. Đổi sang API Key B
   → Thử dùng cache cũ
   → System phát hiện: apiKeyHash(B) ≠ apiKeyHash(A)
   → ❌ Cache INVALID, cần upload lại

3. Nếu cố dùng File URI của A với API Key B:
   → Gemini trả về: 403 Forbidden
   → Lý do: File chỉ truy cập được bởi API Key đã upload
```

**Giải pháp của hệ thống:**
```typescript
// Cache structure includes API Key hash
interface AudioFileCacheInfo {
  fileUri: string;
  apiKeyHash: string; // Hash of API Key for validation
  // ...
}

// When loading cache
const cachedFile = loadAudioCache(audioHash, currentApiKey);
if (cachedFile.apiKeyHash !== hashApiKey(currentApiKey)) {
  // ❌ API Key changed, cache invalid
  localStorage.removeItem(cacheKey);
  return null; // Force re-upload
}
```

**Khi nào cache bị invalidate:**
- ✅ Đổi API Key → Cache tự động xóa
- ✅ File hết hạn 48h → Cache tự động xóa
- ✅ User clear localStorage → Cache bị xóa

**Lưu ý cho người dùng:**
```
Nếu bạn:
- Đổi API Key (ví dụ từ free sang paid)
- Dùng nhiều API Key cho các project khác nhau

→ Mỗi API Key sẽ có cache riêng
→ Upload lần đầu với mỗi API Key
→ Không thể share cache giữa các key
```

---

## 🛠️ Implementation Details

### Cache Data Structure

```typescript
interface AudioFileCacheInfo {
  fileUri: string;           // "files/abc123def456"
  fileName: string;          // "audio_1707234567890.wav"
  mimeType: string;          // "audio/wav"
  uploadedAt: number;        // 1707234567890 (timestamp)
  expiresAt: number;         // 1707407367890 (uploadedAt + 48h)
  audioHash: string;         // "12345_audio/wav_67890"
  apiKeyHash: string;        // "32_xyz12345" (API Key validation)
  durationSeconds: number;   // 8364 (139 minutes)
  fileSizeBytes: number;     // 71234567
}
```

### Cache Key Format

```
localStorage key: "gemini_audio_cache_{audioHash}"
                  "gemini_audio_cache_12345_audio/wav_67890"

audioHash = `${size}_${type}_${checksum}`
          = `71234567_audio/wav_123456`
```

### Cache Validation

```typescript
// Step 1: Check expiration (localStorage)
const now = Date.now();
if (now > cachedFile.expiresAt) {
  console.log('⏰ Cache expired (48h+)');
  localStorage.removeItem(cacheKey);
  return null;
}

// Step 2: Verify file on Gemini servers
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/${cachedFile.fileName}?key=${apiKey}`
);

if (response.ok) {
  const fileInfo = await response.json();
  if (fileInfo.state === 'ACTIVE') {
    console.log('✅ File verified on Gemini: ACTIVE');
    return true;
  }
}

console.log('❌ File not found or inactive on Gemini');
return false;
```

---

## 🎓 Best Practices

### 1. Khi Nào Cache Được Tạo?
✅ **Ngay sau upload thành công**
```typescript
// Upload xong
const uploadedFile = await uploadAudioToGemini(...);

// Cache ngay lập tức (trước khi query)
this.saveAudioCache(cacheInfo);
```

❌ **Không nên**: Đợi query xong mới cache
```typescript
// Wrong: Query có thể lỗi, cache không được tạo
for (const range of timeRanges) {
  await queryTimeRange(...);
}
this.saveAudioCache(cacheInfo); // ❌ Quá muộn!
```

### 2. Cache Có Bị Xóa Khi Lỗi Không?
✅ **KHÔNG** - Cache được bảo vệ
```typescript
try {
  // Query có thể lỗi
  await queryTimeRange(...);
} catch (error) {
  // Cache VẪN TỒN TẠI trong localStorage
  throw error;
}
```

### 3. Xử Lý Multiple Retries
```typescript
// Retry 1: Skip upload (dùng cache)
// Retry 2: Skip upload (dùng cache)
// Retry 3: Skip upload (dùng cache)
// ...
// Retry N: Skip upload cho đến khi hết 48h
```

### 4. Xóa Cache Thủ Công (Nếu Cần)
```typescript
// Clear specific cache
const audioHash = await generateAudioHash(audioBlob);
const cacheKey = 'gemini_audio_cache_' + audioHash;
localStorage.removeItem(cacheKey);

// Clear all Gemini caches
Object.keys(localStorage)
  .filter(key => key.startsWith('gemini_audio_cache_'))
  .forEach(key => localStorage.removeItem(key));
```

---

## 📈 Metrics & Monitoring

### Theo Dõi Cache Hit Rate

```typescript
let cacheHits = 0;
let cacheMisses = 0;

if (cachedFile && isValid) {
  cacheHits++;
  console.log('📊 Cache hit rate:', (cacheHits / (cacheHits + cacheMisses) * 100).toFixed(1) + '%');
} else {
  cacheMisses++;
}
```

### Thời Gian Tiết Kiệm

```typescript
const uploadTime = 30; // seconds
const queriesTime = 360; // seconds

// Without cache
const totalTimeWithoutCache = uploadTime + queriesTime; // 390s

// With cache (retry)
const totalTimeWithCache = 0 + queriesTime; // 360s

const saved = totalTimeWithoutCache - totalTimeWithCache; // 30s
console.log(`⏱️ Saved ${saved} seconds (${(saved/totalTimeWithoutCache*100).toFixed(1)}%)`);
```

---

## 🎉 Kết Luận

**Error Recovery với Cache** giải quyết vấn đề:
- ✅ Không phải upload lại khi retry
- ✅ Tiết kiệm thời gian (30-60s)
- ✅ Tiết kiệm quota Gemini
- ✅ Trải nghiệm người dùng tốt hơn
- ✅ Xử lý lỗi mạnh mẽ hơn

**Workflow lý tưởng**:
```
Upload 1 lần → Cache 48h → Query nhiều lần → Retry không cần upload
```

**Người dùng thấy**:
```
💾 Tìm thấy file đã upload! Bỏ qua bước upload (~30s)
```

**Hệ thống log**:
```
✅ Using cached file URI (skipping upload)
   File: audio_1707234567890.wav
   Uploaded at: 2/6/2026, 3:36:07 PM
   Expires at: 2/8/2026, 3:36:07 PM
💡 File URI is still cached. Retry will skip upload.
```

---

**🔗 Xem thêm**:
- [SMART_CACHING_USER_GUIDE.md](./SMART_CACHING_USER_GUIDE.md) - Hướng dẫn người dùng
- [SMART_CACHING_EXAMPLE.md](./SMART_CACHING_EXAMPLE.md) - Ví dụ kỹ thuật
- [GEMINI_FILE_API_GUIDE.md](./GEMINI_FILE_API_GUIDE.md) - API documentation
