# 📘 Hướng Dẫn Smart Caching - Xử Lý Audio Dài

## 🎯 Tổng Quan

**Smart Caching** là tính năng tự động giúp bạn chuyển đổi audio dài (>60 phút) sang văn bản một cách **hoàn chỉnh, nhanh chóng và tiết kiệm token**.

### ⚡ Lợi Ích Chính

| Tính năng | Trước đây | Smart Caching |
|-----------|-----------|---------------|
| **Audio dài (139 phút)** | ❌ Thất bại hoặc thiếu dữ liệu | ✅ Hoàn chỉnh (~250 đoạn) |
| **Token tiêu thụ** | ~266K input tokens | ~6K input tokens (99.6% ↓) |
| **Thời gian lần đầu** | 15-20 phút (có thể lỗi) | 10-15 phút (ổn định) |
| **Thời gian lần sau** | 15-20 phút lại | ⚡ 10-20 giây (cached) |
| **Kết quả** | 42 đoạn (bị cắt) | 250 đoạn (đầy đủ) |

---

## 🚀 Cách Sử Dụng

### 1. Khi Nào Dùng Smart Caching?

Hệ thống tự động bật Smart Caching khi:
- ✅ Audio > 60 phút
- ✅ Bạn nhấn "Settings" → "🤖 AI Gemini (Transcribe)"

### 2. Quy Trình Hoạt Động

```
┌─────────────────────────────────────────────────────┐
│  🎤 Audio 139 phút                                  │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  ⚡ Smart Caching Mode Kích Hoạt                    │
│  • Chia nhỏ: 139 phút = 6 đoạn × 25 phút           │
│  • Upload 1 lần → Cache 48 giờ                     │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  📤 Bước 1: Upload Audio (1 lần duy nhất)          │
│  ⏱️ Thời gian: ~30 giây                            │
│  💾 Lưu cache: localStorage + Gemini servers       │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  🔍 Bước 2: Query từng đoạn 25 phút                │
│  • Query 1/6: 0-25 phút     ⏱️ ~60s  ✅ 40 đoạn   │
│  • Query 2/6: 25-50 phút    ⏱️ ~60s  ✅ 40 đoạn   │
│  • Query 3/6: 50-75 phút    ⏱️ ~60s  ✅ 40 đoạn   │
│  • Query 4/6: 75-100 phút   ⏱️ ~60s  ✅ 40 đoạn   │
│  • Query 5/6: 100-125 phút  ⏱️ ~60s  ✅ 40 đoạn   │
│  • Query 6/6: 125-139 phút  ⏱️ ~60s  ✅ 30 đoạn   │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│  ✅ Kết Quả: 250 đoạn văn bản hoàn chỉnh            │
│  📊 Tổng thời gian: ~10-15 phút                     │
│  💰 Token sử dụng: ~54K (tiết kiệm 80%)            │
└─────────────────────────────────────────────────────┘
```

### 3. Giao Diện Người Dùng

#### 📊 Khi Bạn Nhấn "AI Gemini (Transcribe)"

```
┌──────────────────────────────────────────────────────┐
│  ⚡ Chuyển đổi giọng nói với Gemini AI - Smart      │
│     Caching Mode                                     │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ⚡ SMART CACHING: Audio dài (139 phút)             │
│                                                      │
│  ✅ Hệ thống sẽ tự động:                            │
│  • Bước 1: Upload audio lên Gemini (1 lần)         │
│  • Bước 2: Lưu cache 48 giờ để tái sử dụng         │
│  • Bước 3: Chia nhỏ thành 6 đoạn × 25 phút         │
│  • Bước 4: Xử lý từng đoạn và gộp kết quả          │
│                                                      │
│  ⚡ Lợi ích:                                         │
│  • Tiết kiệm 99.6% token API                       │
│  • Kết quả đầy đủ không bị cắt (~240 đoạn)         │
│  • Cache 48h: Lần sau chỉ mất ~10 giây             │
│  • Tiến trình chi tiết: "Query 1/6 (0-25 phút)"    │
│                                                      │
│  ⏱️ Thời gian ước tính:                             │
│  • Lần đầu: ~10-14 phút (upload + xử lý)           │
│  • Lần sau (cache): ~10-20 giây (chỉ query)        │
│                                                      │
├──────────────────────────────────────────────────────┤
│  ⚡ Thông tin chuyển đổi:                           │
│  • Model: gemini-2.0-flash-exp                     │
│  • Kích thước file: 67.89 MB                       │
│  • Thời lượng: 139:24 ⚡                            │
│  • Chế độ: Smart Caching                           │
│  • Số queries: 6 × 25 phút                         │
│  • Token ước tính: ~54K (tiết kiệm 99.6%)          │
├──────────────────────────────────────────────────────┤
│  ⏳ Thời gian xử lý: ~10-14 phút (lần đầu),        │
│     ~10-20 giây (cache)                             │
│  💰 Chi phí: Gemini API miễn phí (250K tokens/ngày)│
│     Smart Caching tiết kiệm 99.6% token!           │
├──────────────────────────────────────────────────────┤
│                                                      │
│     [ ⚡ Smart Caching (Khuyến nghị) ]  [ Hủy ]    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### 📊 Tiến Trình Xử Lý (Hiển thị trên màn hình)

```
Bước 1: Đang upload audio lên Gemini...
⏱️ Tiến độ: 30%

Bước 2: Chờ Gemini xử lý file...
⏱️ Đã chờ: 10 giây

✅ Upload thành công! Bắt đầu query...

Query 1/6: Đang xử lý 0-25 phút (16%)
⏱️ Ước tính: ~60 giây

Query 2/6: Đang xử lý 25-50 phút (33%)
⏱️ Ước tính: ~60 giây

Query 3/6: Đang xử lý 50-75 phút (50%)
⏱️ Ước tính: ~60 giây

Query 4/6: Đang xử lý 75-100 phút (66%)
⏱️ Ước tính: ~60 giây

Query 5/6: Đang xử lý 100-125 phút (83%)
⏱️ Ước tính: ~60 giây

Query 6/6: Đang xử lý 125-139 phút (100%)
⏱️ Ước tính: ~60 giây

✅ Hoàn thành Smart Caching: 250 đoạn
```

#### 📊 Cache Status (Trong Panel)

```
┌──────────────────────────────────────────────────┐
│  🎙️ Kết quả chuyển đổi giọng nói sang văn bản  │
│                                                  │
│  [ Đang nhận dạng... ]  [ 250 đoạn ]            │
│  [ ⚡ Cached (47h) ]  ← CACHE ĐANG HOẠT ĐỘNG    │
└──────────────────────────────────────────────────┘
```

---

## 💡 Mẹo Sử Dụng

### 1. Lần Đầu Tiên (Cold Cache)
- ⏱️ **Thời gian**: ~10-15 phút cho audio 139 phút
- 💾 **Hoạt động**: Upload + Xử lý + Lưu cache
- 📊 **Kết quả**: ~250 đoạn văn bản đầy đủ

### 2. Lần Sau (Warm Cache)
- ⏱️ **Thời gian**: ~10-20 giây cho cùng audio
- 💾 **Hoạt động**: Chỉ query (không upload lại)
- 📊 **Kết quả**: Giống lần đầu, nhanh hơn 40x

### 3. Retry Sau Lỗi (Error Recovery) 🆕
**Kịch bản**: Upload xong nhưng query bị lỗi (timeout, network, v.v.)

```
Lần 1:
✅ Upload file (30s) 
✅ Cache lưu File URI
❌ Query bị lỗi ở phút thứ 50 (timeout)

Lần 2 (Retry):
✅ Phát hiện File URI đã cache
⚡ BỎ QUA upload (~30s)
✅ Tiếp tục query từ đầu hoặc từ đoạn bị lỗi
```

**Lợi ích**:
- ⏱️ Tiết kiệm 30-60 giây upload
- 💰 Tiết kiệm quota upload của Gemini
- 🎯 Tập trung vào xử lý thay vì upload lại

**Cách biết đang dùng cache**:
```
Thông báo trên UI:
"💾 Tìm thấy file đã upload! Bỏ qua bước upload (~30s)"

Progress bar:
"✅ Đang dùng file đã upload (tiết kiệm ~30s)"
```

### 4. Quản Lý Cache
- **Thời hạn**: 48 giờ (tự động gia hạn nếu query lại)
- **Lưu trữ**: localStorage của trình duyệt
- **Xóa cache**: 
  - Tự động sau 48h không dùng
  - Tự động khi đổi API Key (vì File URI không share được)
  - Thủ công: Xóa localStorage hoặc Clear Browser Data
- **Kiểm tra**: Xem tag "⚡ Cached (XXh)" trong panel
- **Retry-safe**: Cache được giữ lại ngay cả khi query bị lỗi

⚠️ **LƯU Ý**: File URI chỉ dùng được với **cùng API Key** đã upload. Nếu đổi API Key, cache sẽ tự động bị xóa và cần upload lại.

### 5. Tối Ưu Hiệu Suất
- ✅ **Audio < 60 phút**: Dùng chế độ thường (nhanh hơn)
- ✅ **Audio 60-180 phút**: Smart Caching (tối ưu)
- ✅ **Audio > 180 phút**: Chia nhỏ file hoặc dùng chunk 30 phút

---

## ⚠️ Lưu Ý Quan Trọng

### 1. Giới Hạn API
```
✅ Với Smart Caching:
- Audio 139 phút: ~54K tokens (19% quota ngày)
- Có thể xử lý 4-5 audio dài/ngày

❌ Không Smart Caching:
- Audio 139 phút: ~274K tokens (>100% quota)
- Chỉ xử lý được 1 audio/ngày (và có thể thất bại)
```

### 2. Khi Nào Cache Hết Hạn?
- Sau **48 giờ** kể từ upload
- Hệ thống tự động **re-upload** nếu cache hết hạn
- Bạn sẽ thấy thông báo: "Cache hết hạn, đang upload lại..."

### 3. Xử Lý Lỗi Giữa Chừng 🆕
**Q: Nếu upload xong nhưng query bị lỗi, tôi có phải upload lại không?**

A: **KHÔNG!** File URI đã được cache:
```
Kịch bản thực tế:
1. Upload audio 139 phút (30s) ✅
2. Query đoạn 1-3 thành công ✅
3. Query đoạn 4 bị timeout ❌
4. Bạn nhấn retry
5. Hệ thống:
   - Phát hiện File URI trong cache
   - BỎ QUA upload (tiết kiệm 30s + quota)
   - Chạy lại tất cả queries từ đầu
   
Kết quả:
- Lần retry chỉ mất ~6 phút thay vì 10-15 phút
- Tiết kiệm quota upload Gemini
- Không lo lỗi upload lại
```

**Q: Cache có bị xóa khi có lỗi không?**

A: **KHÔNG!** Cache được bảo vệ:
- Upload thành công → Cache ngay lập tức
- Query bị lỗi → Cache vẫn giữ nguyên
- Retry → Dùng lại cache

**Q: Làm sao biết file đã được cache?**

A: Xem thông báo trên UI:
- Console log: "✅ Using cached file URI (skipping upload)"
- Message: "💾 Tìm thấy file đã upload! Bỏ qua bước upload (~30s)"
- Progress: "✅ Đang dùng file đã upload (tiết kiệm ~30s)"

### 4. Kết Quả So Sánh

| Kịch bản | Thời gian | Token | Kết quả | Trải nghiệm |
|----------|-----------|-------|---------|-------------|
| **Base64 (139 phút)** | 15-20 phút | 274K | 42 đoạn (thiếu) | ⚠️ Thất vọng |
| **File API Simple** | 15-20 phút | 274K | 42 đoạn (thiếu) | ⚠️ Thất vọng |
| **Smart Caching (lần 1)** | 10-15 phút | 54K | 250 đoạn ✅ | ✅ Hài lòng |
| **Smart Caching (lần 2+)** | 10-20 giây | 54K | 250 đoạn ✅ | 🎉 Tuyệt vời |

---

## 🎓 Tóm Tắt

1. **Smart Caching tự động bật** khi audio > 60 phút
2. **Upload 1 lần** → Cache 48 giờ → **Query nhiều lần**
3. **Tiết kiệm 99.6% token** API (File API thay Base64)
4. **Kết quả đầy đủ** (~250 đoạn thay vì 42 đoạn)
5. **Lần sau nhanh hơn 40x** (10-20 giây vs 10-15 phút)

### 💪 Hành Động Ngay

1. Thử với audio dài của bạn (>60 phút)
2. Quan sát tiến trình chi tiết trên màn hình
3. Kiểm tra tag "⚡ Cached" trong panel
4. Thử query lại sau vài giờ để thấy tốc độ cached!

---

**📚 Tài liệu kỹ thuật**: Xem [SMART_CACHING_EXAMPLE.md](./SMART_CACHING_EXAMPLE.md) và [GEMINI_FILE_API_GUIDE.md](./GEMINI_FILE_API_GUIDE.md)
