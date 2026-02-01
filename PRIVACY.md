# 🔒 Privacy & Security Policy

## LiveMeetingNote - Chính sách bảo mật

**Cập nhật:** 19/01/2026

---

## 🎯 Tóm tắt ngắn gọn

**LiveMeetingNote** cam kết:
- ✅ **100% Client-side** - Không upload dữ liệu lên server
- ✅ **Không thu thập thông tin cá nhân**
- ✅ **Không tracking hành vi người dùng**
- ✅ **Không có analytics/cookies**
- ✅ **Open source** - Code công khai, kiểm tra được

---

## 📊 Dữ liệu được lưu trữ

### 1. Dữ liệu local (trên máy người dùng)

Tất cả dữ liệu được lưu **100% trên máy tính của bạn**, không upload lên server:

#### a) File System (Chrome/Edge với File System Access API)
- **Audio recordings** (.wav) - Ghi âm cuộc họp
- **Meeting metadata** (.json) - Thông tin cuộc họp (title, date, attendees...)
- **Notes content** (.json) - Nội dung ghi chép + timestamps
- **Word documents** (.docx) - Export document

**Vị trí:** Folder mà bạn chọn qua dialog "Select Folder"

#### b) Browser Storage (Auto-backup)
- **localStorage** - Meeting info, notes text, timestamps
- **IndexedDB** - Audio blob (để backup khi browser crash)

**Mục đích:** Khôi phục dữ liệu khi browser đóng đột ngột
**Thời gian:** Xóa tự động sau khi save thành công

#### c) Service Worker Cache
- **HTML, CSS, JavaScript files** - Để hoạt động offline
- **External libraries** (WaveSurfer.js, Quill.js, RecordRTC)

**Mục đích:** PWA offline capability
**Thời gian:** Cache vĩnh viễn (xóa khi uninstall app)

### 2. Dữ liệu KHÔNG được thu thập

**LiveMeetingNote KHÔNG thu thập:**
- ❌ Thông tin cá nhân (tên, email, số điện thoại)
- ❌ IP address
- ❌ Browser fingerprint
- ❌ Vị trí địa lý (geolocation)
- ❌ Hành vi sử dụng (analytics)
- ❌ Cookie tracking
- ❌ Audio content (không upload lên server)
- ❌ Meeting content (không upload lên server)

---

## 🔐 Quyền truy cập

Ứng dụng yêu cầu các quyền sau:

### 1. Microphone Access
**Mục đích:** Ghi âm cuộc họp
**API:** `navigator.mediaDevices.getUserMedia()`
**Phạm vi:** Chỉ trong khi đang recording
**Lưu trữ:** Audio blob lưu local, không upload

### 2. File System Access (Chrome/Edge only)
**Mục đích:** Lưu files trực tiếp vào folder bạn chọn
**API:** `window.showDirectoryPicker()`
**Phạm vi:** Chỉ folder bạn cấp quyền
**Lưu trữ:** Write files local, không upload

### 3. Storage Access
**Mục đích:** Auto-backup, PWA cache
**API:** `localStorage`, `IndexedDB`, `Service Worker Cache`
**Phạm vi:** Chỉ domain của app
**Lưu trữ:** Local only

---

## 🌐 Network Activity

### Khi nào ứng dụng kết nối internet?

#### Lần đầu tiên load app:
- Download HTML, CSS, JavaScript từ GitHub Pages
- Download external libraries (WaveSurfer.js, Quill.js, RecordRTC, Ant Design)

#### Khi sử dụng Speech-to-Text:
- **Web Speech API** (Chrome/Edge) stream audio đến Google servers
- Miễn phí, không cần API key
- Audio được xử lý real-time và trả về kết quả

#### Khi sử dụng AI Refinement:
- Gửi transcripts đến Google Gemini API
- Cần API key (miễn phí)
- Nhận văn bản đã chuẩn hóa và tóm tắt cuộc họp

#### Chế độ offline (sau khi đã load):
- ✅ Xem/chỉnh sửa notes
- ✅ Phát audio
- ✅ Load/save projects
- ✅ Export Word
- ❌ KHÔNG thể Speech-to-Text mới
- ❌ KHÔNG thể AI Refinement

### Không có third-party services:
- ❌ Google Analytics
- ❌ Facebook Pixel
- ❌ Advertising networks
- ❌ Cloud storage (Google Drive, Dropbox, etc.)
- ❌ Backend API servers

---

## 🛡️ Bảo mật

### 1. Data Encryption
**At Rest:**
- Files lưu trên máy người dùng (không mã hóa trong app, phụ thuộc OS encryption)
- Browser storage không mã hóa (phụ thuộc browser security)

**In Transit:**
- HTTPS cho lần đầu load app từ GitHub Pages
- ⚠️ **Web Speech API:** Audio stream được mã hóa HTTPS gửi đến Google servers
- ⚠️ **Gemini API:** Transcripts được mã hóa HTTPS gửi đến Google servers
- **Khuyến cáo:** Không sử dụng với thông tin nhạy cảm, mật, bảo mật cao

### 2. Code Integrity
- **Open Source:** Source code công khai tại GitHub
- **No obfuscation:** Code không bị làm xáo trộn
- **Auditable:** Bất kỳ ai cũng có thể review code

### 3. Dependencies
- Sử dụng các thư viện open source phổ biến:
  - React 18.3
  - WaveSurfer.js 7.8
  - Quill.js 2.0
  - RecordRTC 5.6
  - Ant Design 5.22
  - docx.js 9.0

**Security:** Các library được cập nhật thường xuyên, không có CVE nghiêm trọng

---

## 👤 Quyền riêng tư người dùng

### Bạn có toàn quyền:
✅ **Xóa dữ liệu** - Xóa files local, clear browser storage bất kỳ lúc nào
✅ **Export dữ liệu** - Files lưu dưới dạng standard (WAV, JSON, DOCX)
✅ **Kiểm soát quyền** - Revoke microphone/file system permissions qua browser settings
✅ **Uninstall** - Xóa PWA, xóa tất cả cache

### Không có vendor lock-in:
- Files sử dụng standard formats (không proprietary)
- Metadata tương thích C# TranscriptionProject
- Có thể import vào tools khác

---

## 📜 Compliance

### GDPR (General Data Protection Regulation)
✅ **Compliant** - Không thu thập personal data, không cần consent

### CCPA (California Consumer Privacy Act)
✅ **Compliant** - Không bán dữ liệu, không tracking

### HIPAA (Health Insurance Portability and Accountability Act)
⚠️ **Not certified** - Nếu ghi âm thông tin y tế, người dùng tự chịu trách nhiệm bảo mật files

---

## 🔄 Cập nhật chính sách

**Lịch sử:**
- 19/01/2026 - Version 1.0 - Initial policy

**Thay đổi:**
- Chính sách có thể cập nhật khi thêm tính năng mới
- Thông báo qua GitHub Releases
- Không ảnh hưởng đến dữ liệu đã lưu

---

## 📞 Liên hệ

Nếu có câu hỏi về privacy & security:

- **GitHub Issues:** [https://github.com/nsmo-public/Web_MeetingNote/issues](https://github.com/nsmo-public/Web_MeetingNote/issues)
- **Security Issues:** Report via GitHub Security Advisories (private disclosure)

---

## ✅ Cam kết

**LiveMeetingNote** cam kết:

1. **Transparency** - Code open source, không ẩn giấu logic
2. **Privacy-first** - Không thu thập dữ liệu người dùng
3. **Security** - Cập nhật dependencies thường xuyên
4. **User control** - Người dùng kiểm soát 100% dữ liệu của mình

---

**Cuối cùng:**

Ứng dụng này được tạo ra với mục đích giúp đỡ cộng đồng, hoàn toàn miễn phí và tôn trọng quyền riêng tư của người dùng.

**Your data stays with you. Always.** 🔒

---

_Last updated: January 19, 2026_
