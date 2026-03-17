# 📚 LiveMeetingNote - Hướng dẫn sử dụng

## 🎯 Ứng dụng này dùng để làm gì?

**LiveMeetingNote** giúp bạn ghi âm và ghi chép cuộc họp ngay trên trình duyệt, không cần cài đặt gì thêm.

- 🎙️ Ghi âm trực tiếp từ microphone hoặc âm thanh hệ thống
- 📝 Ghi chú kèm mốc thời gian tự động
- 🤖 Chuyển giọng nói sang văn bản (Speech-to-Text) + chuẩn hóa bằng Gemini AI
- 💾 Lưu file về máy — không upload dữ liệu lên server
- 📴 Hoạt động offline sau lần tải đầu tiên

---

## 🚀 Bắt đầu nhanh

1. Mở ứng dụng trên **Chrome**
2. Điền thông tin cuộc họp (tiêu đề, ngày, chủ trì...)
3. Chọn nguồn âm thanh → Click **"Ghi âm"**
4. Gõ ghi chú trong quá trình họp → **ENTER** để đánh dấu mốc thời gian
5. Click **"Dừng"** → Files tự động lưu vào thư mục đã chọn

---

## ✨ Các tính năng chính

### 1. 🎙️ Ghi âm

**Chọn nguồn âm thanh trước khi bắt đầu:**

| Nguồn | Ghi được | Dùng khi |
|-------|----------|----------|
| 🎤 **Microphone** (mặc định) | Tiếng bạn nói | Họp trực tiếp, ghi chú cá nhân |
| 🔊 **System Audio** | Âm thanh từ máy tính | Chỉ nghe, không cần nói vào mic |
| 🎤+🔊 **Cả hai** *(khuyên dùng)* | Cả bạn lẫn người kia | Tham gia họp online |

**Dùng System Audio (nguồn âm thanh hệ thống):**
1. Chọn **System Audio** hoặc **Cả hai**
2. Click **"Ghi âm"** → trình duyệt hỏi bạn muốn share tab/cửa sổ nào
3. Chọn tab cuộc họp → **⚠️ nhớ tick "Share audio"** trước khi click Share
> Chỉ hỗ trợ Chrome/Edge. Nếu quên tick "Share audio" sẽ không có tiếng.

**Tạm dừng & tiếp tục:** Bạn có thể nhấn **Tạm dừng** trong lúc ghi âm rồi **Tiếp tục** mà không bị mất dữ liệu. File ghi âm vẫn là một file liên tục.

---

### 2. 📝 Ghi chú kèm mốc thời gian

Mỗi dòng ghi chú là một ô riêng, có thể gán **người nói** và **mốc thời gian**.

- Nhấn **ENTER** → tạo dòng mới
- Trong lúc ghi âm, nhấn ENTER → dòng mới **tự động gắn mốc thời gian** tại thời điểm đó
- Click vào **mốc thời gian** `[00:02:15]` → audio player nhảy đến đúng vị trí đó
- Gán **tên người nói** cho từng dòng để dễ phân biệt

---

### 3. 🎵 Nghe lại audio

Sau khi ghi âm hoặc load project, waveform hiển thị để bạn nghe lại:

- **Play/Pause**, tua -10s/+10s, điều chỉnh âm lượng
- **Right-click** vào waveform → chèn mốc thời gian tại vị trí đang nghe
- Click vào mốc thời gian trong ghi chú → nhảy đến đúng vị trí trên audio

---

### 4. 💾 Lưu file

**Chrome/Edge:** Chọn thư mục trước, files sẽ tự lưu vào subfolder khi dừng ghi âm.

Tên folder và file có format: `YYYYMMDD_HHMM_[Tiêu đề cuộc họp]`

```
📁 20260317_0930_Hop_hang_tuan/
├── 20260317_0930_Hop_hang_tuan.webm        ← File ghi âm
├── 20260317_0930_Hop_hang_tuan_meeting_info.json
├── 20260317_0930_Hop_hang_tuan_metadata.json
├── 20260317_0930_Hop_hang_tuan_transcription.json  ← (nếu có speech-to-text)
└── 20260317_0930_Hop_hang_tuan.docx        ← Word document
```

**Safari/Firefox:** Files tự động tải về thư mục Downloads.

> Không cần chọn thư mục trước — nếu chưa chọn, ứng dụng sẽ hỏi khi bạn dừng ghi âm.

---

### 5. 📂 Mở project cũ

1. Click **"Load Project"** → chọn **thư mục** của project cũ
2. Nếu thư mục có nhiều file ghi âm → hiện hộp thoại để chọn/gộp file
3. Dữ liệu load lên: thông tin họp, ghi chú, timestamps, audio

**Chỉnh sửa và lưu lại:**
- Sửa ghi chú hoặc thông tin họp tùy ý
- Click **"Lưu thay đổi"** → tạo phiên bản mới (không ghi đè bản cũ)

---

### 6. 🔄 Tự động sao lưu & Khôi phục

Ứng dụng tự động lưu dữ liệu trong nền để phòng trường hợp mất điện, đóng nhầm trình duyệt...

- **Ghi chú & thông tin họp:** Lưu vào localStorage mỗi khi có thay đổi
- **File ghi âm:** Lưu từng đoạn vào IndexedDB mỗi 30 giây trong lúc ghi

Nếu bạn vào lại ứng dụng mà chưa lưu lần trước, hộp thoại **khôi phục** sẽ xuất hiện:
```
🔄 Khôi phục dữ liệu
Phát hiện dữ liệu sao lưu từ 5 phút trước.
[📝 Chỉ ghi chú]  [🎵 Khôi phục toàn bộ]  [❌ Hủy]
```

> Sao lưu bị xóa sau khi bạn lưu thành công hoặc chủ động hủy.

---

### 7. 🎤 Speech-to-Text (Chuyển giọng nói → văn bản)

Tự động nhận diện giọng nói khi ghi âm, dùng **Google Web Speech API** (miễn phí, cần internet).

**Bật tắt:**
- Toggle **"Tự động chuyển giọng nói"** trên thanh công cụ (mặc định: BẬT)

**Chọn ngôn ngữ:**
- Chọn thẳng từ dropdown ngôn ngữ trên thanh công cụ (Tiếng Việt, English...)
- Có thể đổi ngôn ngữ ngay cả khi đang ghi âm

> ⚠️ Speech-to-Text **chỉ hoạt động với microphone**. Nếu chọn "System Audio" (không có mic), tính năng này tự động tắt.

**Chỉnh sửa kết quả:**
- **Double-click** vào một đoạn transcription → chỉnh sửa nội dung, tên người nói, vị trí audio
- Xóa toàn bộ nội dung rồi lưu → xóa đoạn đó
- **Click vào mốc thời gian** 📍 → nhảy đến vị trí đó trên audio

---

### 8. 🤖 Chuẩn hóa bằng Gemini AI

Dùng **Google Gemini AI** để làm sạch kết quả speech-to-text: sửa lỗi nhận diện, bỏ từ đệm, thêm dấu câu, viết hoa...

**Yêu cầu:**
- Cần **Gemini API Key** (miễn phí tại [aistudio.google.com](https://aistudio.google.com/app/apikey))
- Cần kết nối internet

**Cách lấy API Key:**
1. Vào Settings → mục **Gemini API Key**
2. Paste key vào → hệ thống tự tải danh sách models

**Sử dụng:**
1. Sau khi có kết quả speech-to-text → Click **"🤖 Chuẩn hóa bằng AI"**
2. Xác nhận cảnh báo bảo mật → Đợi xử lý
3. Kết quả được gắn nhãn **"🤖 AI"**, vẫn có thể chỉnh sửa thêm

> 🚫 **KHÔNG dùng** cho: mật khẩu, thông tin tài chính/y tế, bí mật kinh doanh. Dữ liệu được gửi đến Google API.

---

### 9. 📋 Tóm tắt cuộc họp (Meeting Summary)

Panel **"Tóm tắt cuộc họp"** hiển thị tóm tắt do Gemini AI tạo ra sau khi chuẩn hóa transcription.

- **Double-click** vào nội dung để chỉnh sửa thủ công
- Tóm tắt được lưu vào file `.docx` khi xuất Word

---

### 10. 📴 Dùng offline (PWA)

Sau lần đầu tiên tải trang, ứng dụng có thể chạy hoàn toàn offline.

**Cài đặt như app:**
- Chrome/Edge: Click icon "Install" trên thanh địa chỉ
- Safari iOS: **Share** → **Add to Home Screen**

---

## 🎮 Quy trình sử dụng điển hình

### Ghi âm cuộc họp mới
```
1. Điền thông tin: tiêu đề, ngày giờ, chủ trì, thành phần
2. Chọn nguồn âm thanh → Click "Ghi âm"
3. Gõ ghi chú trong lúc họp, nhấn ENTER để đánh dấu mốc
4. Click "Dừng" → files lưu tự động
5. Nghe lại, click mốc thời gian để tua đến đúng chỗ
```

### Chỉ ghi chú, không ghi âm
```
1. Điền thông tin cuộc họp
2. Gõ ghi chú (không nhấn Ghi âm)
3. Click "Lưu ghi chú" → lưu meeting_info.json + metadata.json + .docx
```

### Chỉnh sửa project cũ
```
1. Click "Load Project" → chọn thư mục project
2. Sửa ghi chú hoặc thông tin họp
3. Click "Lưu thay đổi" → tạo phiên bản mới trong cùng thư mục
```

---

## ⌨️ Phím tắt

| Phím | Chức năng |
|------|-----------|
| `Enter` | Tạo dòng ghi chú mới (gắn mốc thời gian nếu đang ghi âm) |
| `Ctrl+Z` | Hoàn tác |
| `Ctrl+Y` | Làm lại |
| `Space` | Play/Pause audio (khi focus vào audio player) |

## 🖱️ Thao tác chuột

| Thao tác | Chức năng |
|----------|-----------|
| Click mốc thời gian `[00:02:15]` | Tua audio đến vị trí đó |
| Click thời gian 📍 trong transcription | Tua audio đến vị trí đó |
| Right-click vào waveform | Chèn mốc thời gian tại vị trí đang nghe |
| Double-click đoạn transcription | Mở chỉnh sửa đoạn đó |

---

## 🔧 Xử lý sự cố thường gặp

### Microphone không hoạt động
Click icon 🔒 trên thanh địa chỉ → **Site settings** → Microphone → **Allow**

### Không có tiếng khi dùng System Audio
Khi chọn share màn hình, phải **tick vào "Also share system audio"** trước khi click Share.

### File không lưu được (Chrome/Edge)
Click lại **"Select Folder"** → chọn lại thư mục → cấp quyền ghi khi hỏi.

### Speech-to-Text không nhận diện
- Kiểm tra kết nối internet (tính năng này cần online)
- Kiểm tra ngôn ngữ đã chọn đúng chưa
- Speech-to-Text không chạy với nguồn "System Audio Only"

---

## 📞 Hỗ trợ

- **Tài liệu:** [README.md](README.md) | [QUICKSTART.md](QUICKSTART.md) | [PRIVACY.md](PRIVACY.md)
- **GitHub Issues:** [github.com/nsmo-public/Web_MeetingNote/issues](https://github.com/nsmo-public/Web_MeetingNote/issues)
