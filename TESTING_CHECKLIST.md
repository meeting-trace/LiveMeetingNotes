# 🧪 Testing Checklist - SmartTranscriptManager Integration

## ✅ Critical Features to Test

### 1️⃣ **Live Recording (Web Speech API)**

#### Chrome Testing
- [ ] **Start recording** → Verify console shows: `Using Web Speech API on chrome`
- [ ] **Speak continuously** → Interim segment should show "expanding" text
- [ ] **Pause 1.5 seconds** → Interim should commit to final segment
- [ ] **Speak again quickly (< 500ms after previous)** → Should MERGE into last segment
- [ ] **Speak after 1 second** → Should create NEW segment
- [ ] **Stop recording** → Any pending interim should commit

**Expected Console Logs:**
```
🌐 Using Web Speech API on chrome (silence: 1500ms, merge: 500ms)
➕ NEW SEGMENT: Creating new official segment
🔗 MERGE: Gap 300ms < 500ms
⏱️ SILENCE TIMEOUT (1500ms): Committing interim buffer
```

#### Edge Testing
- [ ] **Start recording** → Verify console shows: `Using Web Speech API on edge`
- [ ] **Speak continuously** → Interim segment should show "expanding" text
- [ ] **Pause 2 seconds** → Interim should commit to final segment
- [ ] **Speak again quickly (< 800ms after previous)** → Should MERGE into last segment
- [ ] **Speak after 1.5 seconds** → Should create NEW segment
- [ ] **Stop recording** → Any pending interim should commit

**Expected Console Logs:**
```
🌐 Using Web Speech API on edge (silence: 2000ms, merge: 800ms)
➕ NEW SEGMENT: Creating new official segment
🔗 MERGE: Gap 600ms < 800ms
⏱️ SILENCE TIMEOUT (2000ms): Committing interim buffer
```

---

### 2️⃣ **Segment Display Behavior**

#### Interim Segment (Draft)
- [ ] **ID is fixed:** `draft-segment-interim` (check in React DevTools)
- [ ] **Text expands** when speaking (smooth update, no flicker)
- [ ] **Background color** is different from final segments
- [ ] **Timestamp updates** in real-time

#### Final Segment (Confirmed)
- [ ] **ID is unique:** `transcription-{counter}`
- [ ] **Text is locked** (no more updates)
- [ ] **Can be edited** via edit button
- [ ] **Timestamp is fixed** (from segment start)

---

### 3️⃣ **Merging Logic**

#### Scenario A: Quick Speech (Should Merge)
**Steps:**
1. Say "Hello"
2. Wait 200ms
3. Say "world"

**Expected Result:**
- ✅ Single segment: "Hello world"
- ✅ Console: `🔗 MERGE: Gap 200ms < 500ms` (Chrome)

#### Scenario B: Slow Speech (Should NOT Merge)
**Steps:**
1. Say "Hello"
2. Wait 2 seconds
3. Say "world"

**Expected Result:**
- ✅ Two segments: "Hello" and "world"
- ✅ Console: `➕ NEW SEGMENT: Creating new official segment`

---

### 4️⃣ **File Transcription (NOT Affected)**

- [ ] **Load audio file** with transcription
- [ ] **Verify Web Speech API is used** (if no API key)
- [ ] **Verify Google Cloud API is used** (if API key + speaker diarization enabled)
- [ ] **Progress bar** updates correctly
- [ ] **All transcriptions appear** after completion

**Important:** SmartTranscriptManager should **NOT** be used for file transcription, only for live recording.

---

### 5️⃣ **Google Cloud API Path (NOT Affected)**

- [ ] **Configure API key** in settings
- [ ] **Enable speaker diarization**
- [ ] **Start recording** → Should use Google Cloud API (fallback)
- [ ] **Verify speaker labels** appear (Person 1, Person 2, etc.)

**Expected Console Log:**
```
⚠️ Web Speech API not available, falling back to Google Cloud API
```

---

### 6️⃣ **Edge Cases**

#### Empty Text
- [ ] **API returns empty string** → Should be ignored (min length check)

#### Very Short Text (< 3 chars on Edge, < 5 chars on Chrome)
- [ ] **Say "hi"** on Chrome → Should commit or wait?
- [ ] **Say "ok"** on Edge → Should commit

#### Multiple Final Results Rapidly
- [ ] **API sends 3 final results in 100ms** → All should be handled correctly

#### Stop Recording Mid-Speech
- [ ] **Start speaking** (interim appears)
- [ ] **Stop recording immediately** → Interim should commit via `forceCommit()`

---

### 7️⃣ **Backward Compatibility**

#### Existing Projects
- [ ] **Load old project** (saved before refactor) → Should load correctly
- [ ] **Play audio** → Transcriptions should sync with audio
- [ ] **Edit transcriptions** → Edits should save correctly

#### API Interface
- [ ] `speechToTextService.startTranscription()` → Still works
- [ ] `speechToTextService.stopTranscription()` → Still works
- [ ] `speechToTextService.transcribeAudioFile()` → Still works
- [ ] `SpeechToTextService.loadConfig()` → Still works

---

### 8️⃣ **Performance**

- [ ] **No duplicate renders** (check React DevTools Profiler)
- [ ] **Smooth interim updates** (no lag or stutter)
- [ ] **Memory leaks** (check DevTools Memory tab after 5-minute recording)
- [ ] **Console errors** (should be zero during normal operation)

---

## 🎯 Success Criteria

### Must Have
- ✅ Live recording works on both Chrome and Edge
- ✅ Interim segment shows expanding text
- ✅ Silence timeout triggers commit correctly
- ✅ Merge logic works based on time window
- ✅ File transcription still works (not affected)
- ✅ Google Cloud API path still works (not affected)
- ✅ No breaking changes to existing features

### Nice to Have
- ✅ Console logs are clear and helpful for debugging
- ✅ No duplicate renders or performance issues
- ✅ Smooth user experience with no flicker

---

## 🐛 Known Issues (If Any)

### Issue #1: [Description]
**Status:** 🔴 Open / 🟡 In Progress / 🟢 Resolved  
**Impact:** High / Medium / Low  
**Workaround:** [If available]

---

## 📝 Test Results

| Test Case | Chrome | Edge | Notes |
|-----------|--------|------|-------|
| Live recording starts | ⬜ | ⬜ | |
| Interim text expands | ⬜ | ⬜ | |
| Silence timeout works | ⬜ | ⬜ | |
| Merge on quick speech | ⬜ | ⬜ | |
| New segment on slow speech | ⬜ | ⬜ | |
| File transcription works | ⬜ | ⬜ | |
| Google Cloud API works | ⬜ | ⬜ | |
| No duplicate renders | ⬜ | ⬜ | |
| No memory leaks | ⬜ | ⬜ | |
| Backward compatibility | ⬜ | ⬜ | |

**Legend:** ⬜ Not Tested | ✅ Pass | ❌ Fail | ⚠️ Issue Found

---

**Last Updated:** January 29, 2026  
**Tester:** [Your Name]  
**Version:** 1.0
