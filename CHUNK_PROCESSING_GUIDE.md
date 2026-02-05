# 📦 Hướng Dẫn Xử Lý Audio Chunks - Gemini Transcription

## 🎯 Tổng Quan

Khi file audio có **dung lượng hoặc thời lượng vượt ngưỡng cấu hình**, hệ thống tự động:
1. **Chia nhỏ** thành các chunks phù hợp (theo cả size MB và duration)
2. **Xử lý tuần tự** từng chunk với Gemini API
3. **Chuẩn hóa timestamps** để đồng bộ với file gốc
4. **Tổng hợp summaries** bằng Gemini AI (hoặc ghép thủ công nếu lỗi)

---

## 🔄 Quy Trình Xử Lý Chi Tiết

### **Bước 1: Phát hiện file lớn & Chia chunks**

```
Input: Audio 100MB, 139 phút
Config: maxSize=20MB, maxDuration=60 phút

→ Chunks cần thiết:
  - By size: 100MB / 20MB = 5 chunks
  - By duration: 139 phút / 60 phút = 3 chunks
  - Chọn MAX(5, 3) = 5 chunks ✅

→ Mỗi chunk:
  - Size: ~20MB
  - Duration: ~28 phút
```

**Code**: [`aiRefinement.ts#L1326-1365`](d:\Program\Web_MeetingNote\src\services\aiRefinement.ts#L1326-1365)

---

### **Bước 2: Xử lý từng chunk tuần tự**

```
FOR each chunk (i = 0 to chunks.length - 1):
  ├─ Progress: 📦 Phần 1/5: 19.8MB • 28 phút
  ├─ Transcribe với Gemini API
  │   ├─ 10%: 🔍 Đang kiểm tra file...
  │   ├─ 38%: 💾 Đang mã hóa audio...
  │   ├─ 40%: 📤 Đang gửi request tới Gemini AI...
  │   ├─ 70%: 📥 Đã nhận response từ Gemini...
  │   └─ 100%: ✅ Hoàn thành!
  │
  ├─ Parse response → { results: [...], summary: "..." }
  │
  ├─ Adjust timestamps: audioTimeMs += chunk.startTimeMs
  │   Example: Chunk 2 (28-56 phút)
  │   - Raw timestamp: 0:30 → audioTimeMs: 30,000ms
  │   - Adjusted: 30,000 + 1,680,000 = 1,710,000ms (28:30)
  │
  ├─ Collect results:
  │   - allResults.push(...adjustedResults)
  │   - allSummaries.push("Phần 2/5: [summary]")
  │
  ├─ Progress: ✅ Phần 2/5: 156 segments
  │
  └─ IF i < chunks.length - 1:
      └─ Delay 5s để tránh rate limit (15 req/min)
```

**Code**: [`aiRefinement.ts#L1467-1535`](d:\Program\Web_MeetingNote\src\services\aiRefinement.ts#L1467-1535)

---

### **Bước 3: Chuẩn hóa timestamps**

**Vấn đề**: Mỗi chunk được xử lý độc lập → timestamps bắt đầu từ 0:00

**Giải pháp**: Thêm offset tương ứng với thời điểm bắt đầu chunk

```typescript
// Example: Chunk 3 (56-84 phút = startTimeMs: 3,360,000ms)
adjustTimestamps(results, 3360000) {
  return results.map(result => ({
    ...result,
    audioTimeMs: result.audioTimeMs ? 
      result.audioTimeMs + 3360000 : // 0:30 → 56:30
      undefined
  }));
}
```

**Code**: [`aiRefinement.ts#L1625-1636`](d:\Program\Web_MeetingNote\src\services\aiRefinement.ts#L1625-1636)

---

### **Bước 4: Tổng hợp summaries**

#### **Case 1: Không có summary** → `undefined`
```typescript
allSummaries = []
→ combinedSummary = undefined
```

#### **Case 2: Chỉ 1 summary** → Dùng trực tiếp
```typescript
allSummaries = ["Phần 1/1: Cuộc họp bàn về dự án X..."]
→ combinedSummary = "Cuộc họp bàn về dự án X..." // Loại bỏ prefix
```

#### **Case 3: Nhiều summaries** → Gọi Gemini merge

**3.1. Thử gọi Gemini API để tổng hợp**:
```
Progress: 🔄 Đang tổng hợp 5 phần tóm tắt...

Prompt gửi tới Gemini:
┌───────────────────────────────────────────────────┐
│ BẠN LÀ CHUYÊN GIA TÓM TẮT CUỘC HỌP.              │
│                                                   │
│ NHIỆM VỤ: Tổng hợp các tóm tắt riêng lẻ thành    │
│ MỘT tóm tắt tổng quan liền mạch.                 │
│                                                   │
│ === CÁC TÓM TẮT RIÊNG LẺ ===                     │
│                                                   │
│ ### Phần 1/5                                     │
│ Cuộc họp bắt đầu với việc giới thiệu...         │
│                                                   │
│ ### Phần 2/5                                     │
│ Thảo luận về vấn đề kỹ thuật...                 │
│ ...                                              │
└───────────────────────────────────────────────────┘

Response từ Gemini:
"Cuộc họp diễn ra trong 2 giờ 19 phút, bắt đầu với 
việc giới thiệu dự án X. Các thành viên thảo luận 
chi tiết về vấn đề kỹ thuật..."

→ Progress: ✅ Đã tổng hợp tóm tắt hoàn chỉnh
```

**3.2. Nếu gọi Gemini thất bại** → Fallback ghép thủ công:
```typescript
// Gemini merge failed: API quota exceeded

combinedSummary = `
📄 Tóm tắt đoạn 1:
Cuộc họp bắt đầu với việc giới thiệu...

---

📄 Tóm tắt đoạn 2:
Thảo luận về vấn đề kỹ thuật...

---

📄 Tóm tắt đoạn 3:
...
`

→ Progress: ⚠️ Ghép tóm tắt thủ công (5 phần)
```

**Code**: [`aiRefinement.ts#L1540-1580`](d:\Program\Web_MeetingNote\src\services\aiRefinement.ts#L1540-1580)

---

### **Bước 5: Sắp xếp & Return**

```typescript
// Sort tất cả segments theo audioTimeMs
allResults.sort((a, b) => (a.audioTimeMs || 0) - (b.audioTimeMs || 0));

// Return kết quả cuối cùng
return {
  results: allResults,      // 780 segments, timestamps 0:00 → 2:19:00
  summary: combinedSummary  // Tóm tắt tổng hợp hoặc ghép thủ công
};
```

**Progress**: `🎉 Hoàn thành! 780 segments`

---

## 📊 UI Progress Messages

Người dùng sẽ thấy các thông báo sau trên giao diện:

### **Phase 1: Phân tích & Chia chunks**
```
3% : Đang kiểm tra định dạng audio...
5% : Đang chuyển đổi WebM sang WAV...
8% : Đang phân tích và chia file WAV...
10%: Đã chia thành 5 phần. Bắt đầu chuyển đổi...
```

### **Phase 2: Xử lý từng chunk**
```
10%: 📦 Phần 1/5: 19.8MB • 28 phút
12%: 📦 1/5: 🔍 Đang kiểm tra file...
20%: 📦 1/5: 💾 Đang mã hóa audio...
28%: 📦 1/5: 📤 Đang gửi request tới Gemini AI...
40%: 📦 1/5: 📥 Đã nhận response từ Gemini...
42%: ✅ Phần 1/5: 156 segments
43%: ⏳ Đợi 5s trước khi xử lý phần 2/5...

48%: 📦 Phần 2/5: 20.1MB • 28 phút
...
86%: ✅ Phần 5/5: 158 segments
```

### **Phase 3: Tổng hợp**
```
90%: ✅ Đã xử lý 780 segments từ 5 phần
92%: 🔄 Đang tổng hợp 5 phần tóm tắt...
98%: ✅ Đã tổng hợp tóm tắt hoàn chỉnh
100%: 🎉 Hoàn thành! 780 segments
```

**Nếu Gemini merge thất bại**:
```
98%: ⚠️ Ghép tóm tắt thủ công (5 phần)
```

---

## 🛡️ Error Handling

### **Lỗi tại chunk thứ N**:
```
❌ Vượt hạn mức API tại phần 3/5.

✅ Đã xử lý: 2/5 phần
❌ Lỗi: Gemini API error (429): quota exceeded

💡 Đợi 24 giờ hoặc nâng cấp Paid tier.
```

### **Lỗi khi merge summaries**:
```
⚠️ Failed to merge summaries with Gemini:
  → Gemini API error (429): Too Many Requests

→ Fallback: Manual concatenation
→ Output: 📄 Tóm tắt đoạn 1: ...\n---\n📄 Tóm tắt đoạn 2: ...
```

---

## 🧪 Test Cases

### **Test 1: File nhỏ (< 20MB, < 60 phút)**
```
Input: 15MB, 45 phút
→ Không cần chia chunks
→ Gọi transcribeAudioWithGemini trực tiếp
→ Return 1 summary nguyên bản
```

### **Test 2: File vừa (> 20MB HOẶC > 60 phút)**
```
Input: 50MB, 53 phút
→ Chia 3 chunks (by size: 50/20=3, by duration: 53/60=1 → MAX=3)
→ Xử lý 3 chunks
→ Collect 3 summaries
→ Gọi Gemini merge
→ Return 1 summary tổng hợp
```

### **Test 3: File rất lớn (> 100MB, > 120 phút)**
```
Input: 190MB, 139 phút
→ Chia 10 chunks (by size: 190/20=10, by duration: 139/60=3 → MAX=10)
→ Xử lý 10 chunks với delay 5s giữa mỗi chunk
→ Collect 10 summaries
→ Gọi Gemini merge
→ Nếu merge thành công: Return summary tổng hợp
→ Nếu merge thất bại: Return ghép thủ công 10 đoạn
```

### **Test 4: Gemini merge quota exceeded**
```
Input: 5 chunks processed successfully
→ allSummaries.length = 5
→ Try: mergeSummariesWithGemini()
→ Error: 429 Too Many Requests
→ Catch: Manual concatenation
→ Return: "📄 Tóm tắt đoạn 1:\n...\n---\n📄 Tóm tắt đoạn 2:\n..."
```

---

## 📝 Code References

| Function | File | Description |
|----------|------|-------------|
| `transcribeEntireAudioWithGemini` | [aiRefinement.ts#L1420](d:\Program\Web_MeetingNote\src\services\aiRefinement.ts#L1420) | Main orchestrator cho chunk processing |
| `splitAudioIntoChunks` | [aiRefinement.ts#L1326](d:\Program\Web_MeetingNote\src\services\aiRefinement.ts#L1326) | Chia audio thành chunks theo size & duration |
| `extractAudioSegment` | [aiRefinement.ts#L1377](d:\Program\Web_MeetingNote\src\services\aiRefinement.ts#L1377) | Trích xuất 1 đoạn audio dựa trên time range |
| `adjustTimestamps` | [aiRefinement.ts#L1625](d:\Program\Web_MeetingNote\src\services\aiRefinement.ts#L1625) | Chuẩn hóa timestamps với offset |
| `mergeSummariesWithGemini` | [aiRefinement.ts#L1638](d:\Program\Web_MeetingNote\src\services\aiRefinement.ts#L1638) | Tổng hợp summaries bằng Gemini AI |

---

## 🎯 Ưu Điểm

✅ **Tự động**: Không cần user can thiệp  
✅ **Thông minh**: Chia chunks dựa trên CẢ size VÀ duration  
✅ **Chính xác**: Timestamps được chuẩn hóa đúng với file gốc  
✅ **Chuyên nghiệp**: Summary được AI tổng hợp mạch lạc  
✅ **Resilient**: Fallback ghép thủ công nếu AI merge lỗi  
✅ **Transparent**: Progress messages chi tiết cho user  

---

## ⚠️ Lưu Ý

1. **Rate Limit**: Delay 5s giữa các chunks (15 req/min)
2. **Quota**: Free tier 250K tokens/day → ~35 chunks max
3. **Memory**: Browser có thể crash với file quá lớn (>500MB)
4. **Network**: Upload ~20MB/chunk → yêu cầu kết nối ổn định
5. **Cost**: Paid tier ($2/month) cho unlimited requests

---

*Document version: 1.0 | Last updated: 2026-02-05*
