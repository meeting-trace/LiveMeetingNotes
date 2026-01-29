# Test Plan - Performance Optimization

## 🎯 Mục tiêu
Kiểm tra các cải tiến hiệu năng đã triển khai không làm ảnh hưởng đến chức năng hiện có.

---

## ✅ Test Case 1: NotesEditor - Typing Performance

### Scenario 1.1: Gõ text nhanh liên tục
**Steps:**
1. Mở ứng dụng
2. Bắt đầu recording (hoặc load project)
3. Click vào NotesEditor
4. Gõ nhanh 30-50 ký tự liên tục không ngừng nghỉ

**Expected:**
- ✅ Text xuất hiện mượt mà, không lag
- ✅ Không có delay giữa việc gõ và hiển thị ký tự
- ✅ CPU usage ổn định, không spike cao

**Actual:** _____________________

---

### Scenario 1.2: Timestamp tự động tạo
**Steps:**
1. Bắt đầu recording
2. Gõ ký tự đầu tiên vào dòng mới (Live Mode)
3. Kiểm tra cột timestamp

**Expected:**
- ✅ Timestamp xuất hiện ngay lập tức (immediate sync)
- ✅ Timestamp chính xác với thời gian hiện tại - delay config
- ✅ Format: YYYY-MM-DD HH:mm:ss

**Actual:** _____________________

---

### Scenario 1.3: Sync với parent delayed
**Steps:**
1. Gõ text trong NotesEditor
2. Mở DevTools Console
3. Quan sát số lần `onTimestampMapChange` được call

**Expected:**
- ✅ Khi gõ liên tục 10 ký tự → chỉ 1-2 calls (debounced 300ms)
- ✅ Khi dừng gõ → sync sau 300ms
- ✅ Timestamp creation → sync ngay lập tức (không debounce)

**Actual:** _____________________

---

## ✅ Test Case 2: TranscriptionPanel - Many Segments

### Scenario 2.1: Collapse/Expand với nhiều segments
**Steps:**
1. Tạo 50+ transcription segments (bằng cách ghi âm dài hoặc test data)
2. Collapse TranscriptionPanel
3. Expand lại
4. Lặp lại 5-10 lần

**Expected:**
- ✅ Animation mượt mà (60 FPS)
- ✅ Không lag khi expand
- ✅ Height auto-adjust đúng
- ✅ Scroll position được giữ

**Actual:** _____________________

---

### Scenario 2.2: Edit transcription segment
**Steps:**
1. Có nhiều segments
2. Double-click vào một segment để edit
3. Thay đổi text, speaker, timestamp
4. Click Save

**Expected:**
- ✅ Chỉ segment đó re-render
- ✅ Các segment khác không bị re-render (check bằng React DevTools Profiler)
- ✅ Edit được lưu đúng
- ✅ hasUnsavedChanges flag được set

**Actual:** _____________________

---

### Scenario 2.3: Add new segment realtime
**Steps:**
1. Bật Speech-to-Text
2. Ghi âm và nói
3. Quan sát segments xuất hiện

**Expected:**
- ✅ New segment xuất hiện mượt mà
- ✅ Auto-scroll to bottom
- ✅ Không lag khi add segment
- ✅ Old segments không re-render

**Actual:** _____________________

---

## ✅ Test Case 3: Auto-save Optimization

### Scenario 3.1: Auto-save trigger frequency
**Steps:**
1. Mở DevTools Console
2. Uncomment dòng console.log trong auto-save useEffect (App.tsx line ~990)
3. Gõ text liên tục trong 1 phút
4. Đếm số lần "💾 Auto-backup saving" xuất hiện

**Expected:**
- ✅ Chỉ xuất hiện 1 lần (sau 3s khi dừng gõ)
- ✅ Không xuất hiện liên tục mỗi lần gõ
- ✅ hasUnsavedChanges được set = true sau khi gõ

**Actual:** _____________________

---

### Scenario 3.2: Auto-save content integrity
**Steps:**
1. Gõ text "Test auto-save 123"
2. Đợi 3s
3. Mở DevTools → Application → Local Storage
4. Tìm key `meetingNote_autoBackup`
5. Parse JSON và kiểm tra field `notes`

**Expected:**
- ✅ Backup được lưu sau 3s
- ✅ Content chứa "Test auto-save 123"
- ✅ timestampMap, speakersMap được lưu đúng
- ✅ timestamp field là thời gian hiện tại

**Actual:** _____________________

---

### Scenario 3.3: Auto-save không trigger khi không cần
**Steps:**
1. Mở project đã lưu
2. Không thay đổi gì
3. Đợi 5 phút
4. Kiểm tra Console

**Expected:**
- ✅ Không có log "💾 Auto-backup saving"
- ✅ hasUnsavedChanges = false
- ✅ Không có auto-save trigger

**Actual:** _____________________

---

## ✅ Test Case 4: Integration Tests

### Scenario 4.1: Full recording workflow
**Steps:**
1. Tạo meeting mới
2. Bắt đầu recording
3. Gõ notes trong khi recording
4. Nói vào mic (Speech-to-Text)
5. Dừng recording
6. Save project

**Expected:**
- ✅ Tất cả chức năng hoạt động bình thường
- ✅ Notes được lưu đúng với timestamps
- ✅ Transcriptions được lưu đúng
- ✅ Audio được lưu
- ✅ Export Word hoạt động

**Actual:** _____________________

---

### Scenario 4.2: Load project và edit
**Steps:**
1. Load project đã lưu
2. Thêm notes mới
3. Edit transcription
4. Save lại

**Expected:**
- ✅ Project load đúng data
- ✅ Edit hoạt động bình thường
- ✅ Save ghi đè được
- ✅ Không mất dữ liệu

**Actual:** _____________________

---

### Scenario 4.3: Multi-line selection trong NotesEditor
**Steps:**
1. Gõ 5-10 dòng notes
2. Ctrl+Click để chọn nhiều dòng
3. Shift+Click để chọn range
4. Copy (Ctrl+C)
5. Delete selected

**Expected:**
- ✅ Selection UI hoạt động (highlight background)
- ✅ Copy được
- ✅ Delete được nhiều dòng cùng lúc
- ✅ Timestamps của các dòng còn lại shift đúng

**Actual:** _____________________

---

## ✅ Test Case 5: Edge Cases

### Scenario 5.1: Gõ cực nhanh (~10 ký tự/giây)
**Steps:**
1. Recording
2. Spam keyboard cực nhanh trong 10s

**Expected:**
- ✅ Không bị drop characters
- ✅ Không crash
- ✅ Tất cả ký tự được hiển thị

**Actual:** _____________________

---

### Scenario 5.2: Nhiều segments (100+)
**Steps:**
1. Tạo 100+ transcription segments (test data hoặc long recording)
2. Scroll qua lại
3. Collapse/expand panel

**Expected:**
- ✅ Không lag nghiêm trọng
- ✅ Memory usage chấp nhận được (<500MB)
- ✅ Scroll smooth

**Actual:** _____________________

---

### Scenario 5.3: Undo/Redo nhiều lần
**Steps:**
1. Gõ text
2. Ctrl+Z (undo) 10 lần
3. Ctrl+Shift+Z (redo) 10 lần

**Expected:**
- ✅ Undo/Redo hoạt động đúng
- ✅ History limit 50 entries
- ✅ Timestamps được restore đúng

**Actual:** _____________________

---

## 📊 Performance Metrics

### Baseline (Trước tối ưu):
- NotesEditor typing: _______ ms/keystroke
- TranscriptionPanel expand: _______ ms
- Auto-save triggers: _______ times/minute
- Memory usage: _______ MB

### After Optimization (Sau tối ưu):
- NotesEditor typing: _______ ms/keystroke
- TranscriptionPanel expand: _______ ms
- Auto-save triggers: _______ times/minute
- Memory usage: _______ MB

---

## 🐛 Bugs Found

| Bug ID | Description | Severity | Status |
|--------|-------------|----------|--------|
| #1 | | | |
| #2 | | | |
| #3 | | | |

---

## ✅ Sign-off

**Tester**: _____________________  
**Date**: _____________________  
**Result**: ☐ Pass  ☐ Fail  ☐ Pass with issues  

**Notes**:
_____________________________________________________________________
_____________________________________________________________________
_____________________________________________________________________
