import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { MetadataPanel } from "./components/MetadataPanel";
import { RecordingControls } from "./components/RecordingControls";
import { NotesEditor } from "./components/NotesEditor";
import { AudioPlayer, AudioPlayerRef } from "./components/AudioPlayer";
import { LiveWaveform } from "./components/LiveWaveform";
import { HelpButton } from "./components/HelpButton";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { TranscriptionConfig } from "./components/TranscriptionConfig";
import { TranscriptionPanel } from "./components/TranscriptionPanel";
import { MeetingSummaryPanel } from "./components/MeetingSummaryPanel";
import { UpdateNotification } from "./components/UpdateNotification";
import { FileManagerService } from "./services/fileManager";
import {
  saveBackup,
  loadBackup,
  clearBackup,
  hasBackup,
  getBackupAge,
  getBackupAudioInfo,
} from "./services/autoBackup";
import {
  speechToTextService,
  SpeechToTextService,
} from "./services/speechToText";
import {
  AIRefinementService,
  type RawTranscriptData,
  type GeminiRetryCallback,
} from "./services/aiRefinement";
import { updateManager, UpdateManagerService } from "./services/updateManager";
import { chunkStorage } from "./services/chunkStorage";
import type {
  MeetingInfo,
  SpeechToTextConfig,
  TranscriptionResult,
} from "./types/types";
import { message, App as AntdApp, Progress, Input, Modal } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import "./styles/global.css";

export const App: React.FC = () => {
  const { modal, notification } = AntdApp.useApp();
  const { t } = useTranslation();
  const [folderPath, setFolderPath] = useState<string>("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribingActive, setIsTranscribingActive] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const fileManagerRef = useRef<FileManagerService | undefined>(undefined); // Shared fileManager instance
  const [meetingInfo, setMeetingInfo] = useState<MeetingInfo>({
    title: "",
    date: new Date().toISOString().split("T")[0],
    time: new Date().toTimeString().slice(0, 5),
    location: "",
    host: "",
    attendees: "",
  });
  const [notes, setNotes] = useState<string>("");
  const [timestampMap, setTimestampMap] = useState<Map<number, number>>(
    new Map(),
  );
  const [speakersMap, setSpeakersMap] = useState<Map<number, string>>(
    new Map(),
  );
  const [recordingStartTime, setRecordingStartTime] = useState<number>(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [savedNotesSnapshot, setSavedNotesSnapshot] = useState<string>("");
  const [savedSpeakersSnapshot, setSavedSpeakersSnapshot] = useState<
    Map<number, string>
  >(new Map());
  const [savedTranscriptionsSnapshot, setSavedTranscriptionsSnapshot] =
    useState<TranscriptionResult[]>([]);
  const [savedMeetingInfoSnapshot, setSavedMeetingInfoSnapshot] =
    useState<MeetingInfo>({
      title: "",
      date: new Date().toISOString().split("T")[0],
      time: new Date().toTimeString().slice(0, 5),
      location: "",
      host: "",
      attendees: "",
    });
  const [isLiveMode, setIsLiveMode] = useState(true); // true = live recording, false = loaded project
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [backupAge, setBackupAge] = useState<number | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioPlayerRef = useRef<AudioPlayerRef>(null);

  // ⚡ Live refs: always hold the LATEST state values so that handleSaveComplete
  // (which is passed as a prop and can become stale due to closure) always
  // snapshots the correct data even when called from an older render's closure.
  const transcriptionsRef = useRef<TranscriptionResult[]>([]);
  const notesRef = useRef<string>("");
  const speakersMapRef = useRef<Map<number, string>>(new Map());
  const meetingInfoRef = useRef<MeetingInfo>({
    title: "",
    date: new Date().toISOString().split("T")[0],
    time: new Date().toTimeString().slice(0, 5),
    location: "",
    host: "",
    attendees: "",
  });
  const onWaveformReadyRef = useRef<(() => void) | null>(null);
  const onWaveformErrorRef = useRef<((error: string) => void) | null>(null);
  // Safety timeout: clears the waveform-wait callbacks if WaveSurfer never fires ready/error
  const waveformWaitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Speech-to-Text states
  const [showTranscriptionConfig, setShowTranscriptionConfig] = useState(false);
  const [transcriptionConfig, setTranscriptionConfig] =
    useState<SpeechToTextConfig | null>(null);
  const [transcriptions, setTranscriptions] = useState<TranscriptionResult[]>(
    [],
  );
  const [rawTranscripts, setRawTranscripts] = useState<RawTranscriptData[]>([]); // Raw data from Web Speech API
  const [geminiSummary, setGeminiSummary] = useState<string | undefined>(
    undefined,
  ); // Summary from Gemini AI
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null); // Live audio stream for waveform
  const [audioSourceType, setAudioSourceType] = useState<
    import("./types/types").AudioSourceType
  >("microphone" as import("./types/types").AudioSourceType); // Audio source type for waveform

  // Update manager states
  const [showUpdateNotification, setShowUpdateNotification] = useState(false);
  const [updateConfig, setUpdateConfig] = useState(() =>
    UpdateManagerService.loadConfig(),
  );

  // Keep live refs in sync with state on every render (no overhead, just plain assignment).
  // Must be placed after all relevant state declarations.
  transcriptionsRef.current = transcriptions;
  notesRef.current = notes;
  speakersMapRef.current = speakersMap;
  meetingInfoRef.current = meetingInfo;

  /**
   * Get valid meeting start time for Gemini transcription
   * Priority: 1) meetingInfo, 2) first transcription time, 3) current time
   */
  const getValidMeetingStartTime = useCallback((): Date => {
    // Try meetingInfo first
    if (meetingInfo.date && meetingInfo.time) {
      const meetingStartTime = new Date(
        `${meetingInfo.date}T${meetingInfo.time}:00`,
      );
      if (!isNaN(meetingStartTime.getTime())) {
        console.log(
          "✅ Using meetingInfo time:",
          meetingStartTime.toISOString(),
        );
        return meetingStartTime;
      }
    }

    // Fallback to first transcription time if available
    if (transcriptions.length > 0 && transcriptions[0].startTime) {
      const firstTranscriptionTime = new Date(transcriptions[0].startTime);
      if (!isNaN(firstTranscriptionTime.getTime())) {
        console.log(
          "⚠️ meetingInfo empty, using first transcription time:",
          firstTranscriptionTime.toISOString(),
        );
        return firstTranscriptionTime;
      }
    }

    // Last resort: current time
    const now = new Date();
    console.warn(
      "⚠️ No valid meeting time found, using current time:",
      now.toISOString(),
    );
    return now;
  }, [meetingInfo.date, meetingInfo.time, transcriptions]);

  // Check browser compatibility
  useEffect(() => {
    if (!FileManagerService.isSupported()) {
      console.warn(
        "File System Access API not supported. Files will be downloaded instead.",
      );
    }
    // Dọn dẹp toàn bộ chunk IDB cũ (orphan từ các phiên transcribe bị gián đoạn).
    // Dùng clearOrphanChunks() thay vì cleanupStale(0) để an toàn khi mở nhiều tab:
    // nếu tab khác đang giữ shared Web Lock (đang transcribe), cleanup sẽ tự bỏ qua.
    chunkStorage.clearOrphanChunks().catch(() => {});
  }, []);

  // 🌐 Check browser and device for optimal experience
  useEffect(() => {
    const checkBrowserAndDevice = () => {
      const ua = navigator.userAgent.toLowerCase();
      const isChrome = ua.includes("chrome/") && !ua.includes("edg/");
      const isEdge = ua.includes("edg/");
      const isDesktop =
        !/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
          ua,
        );

      // Detect specific browser
      let browserName = "Unknown";
      if (isChrome) browserName = "Chrome";
      else if (isEdge) browserName = "Edge";
      else if (ua.includes("firefox/")) browserName = "Firefox";
      else if (ua.includes("safari/") && !ua.includes("chrome/"))
        browserName = "Safari";

      // Detect device type
      const deviceType = isDesktop ? "Desktop/Laptop" : "Mobile/Tablet";

      console.log("🌐 Browser:", browserName, "| Device:", deviceType);

      // Show recommendation if not Chrome on Desktop
      if (!isChrome || !isDesktop) {
        const warningKey = "browser-device-warning-shown";
        const hasShownWarning = sessionStorage.getItem(warningKey);

        // Only show once per session
        if (!hasShownWarning) {
          setTimeout(() => {
            let warningMessage = "";

            if (!isChrome && !isDesktop) {
              warningMessage = t('browserWarning.message', { browser: browserName, device: deviceType });
            } else if (!isChrome) {
              warningMessage = t('browserWarning.message', { browser: browserName, device: 'máy tính' });
            } else if (!isDesktop) {
              warningMessage = t('browserWarning.message', { browser: 'Chrome', device: deviceType });
            }

            if (warningMessage) {
              modal.info({
                title: t('browserWarning.title'),
                content: (
                  <div>
                    <p>{warningMessage}</p>
                    <p
                      style={{
                        marginTop: "12px",
                        fontSize: "13px",
                        color: "#666",
                      }}
                    >
                      {t('browserWarning.reason')}
                    </p>
                  </div>
                ),
                okText: t('browserWarning.ok'),
                width: 500,
                onOk: () => {
                  sessionStorage.setItem(warningKey, "true");
                },
              });
            }
          }, 1500); // Delay 1.5s để UI load xong
        }
      }
    };

    // Check when app loads and when coming back online
    checkBrowserAndDevice();

    const handleOnlineCheck = () => {
      setTimeout(checkBrowserAndDevice, 500);
    };

    window.addEventListener("online", handleOnlineCheck);

    return () => {
      window.removeEventListener("online", handleOnlineCheck);
    };
  }, []);

  // Load Speech-to-Text config on mount
  useEffect(() => {
    const savedConfig = SpeechToTextService.loadConfig();
    if (savedConfig) {
      setTranscriptionConfig(savedConfig);
      speechToTextService.initialize(savedConfig);
      // Expose config to window for AudioPlayer access
      (window as any).speechToTextConfig = savedConfig;
      // console.log('🎤 Speech-to-Text config loaded');
    }
  }, []);

  // Update window.speechToTextConfig when transcriptionConfig changes
  useEffect(() => {
    if (transcriptionConfig) {
      (window as any).speechToTextConfig = transcriptionConfig;
    }
  }, [transcriptionConfig]);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Initialize update manager - check once on app load
  useEffect(() => {
    const initUpdateManager = async () => {
      await updateManager.initialize();

      // Listen for update notifications
      updateManager.onUpdateAvailable(() => {
        console.log("🔔 Update notification received");
        setShowUpdateNotification(true);
      });

      // Check for updates once on app load if enabled and online
      if (updateConfig.autoUpdate && navigator.onLine) {
        await updateManager.checkForUpdates();
      }
    };

    initUpdateManager();
  }, []); // Run once on mount

  // Handle auto-update config changes
  const handleUpdateConfigChange = (newConfig: typeof updateConfig) => {
    setUpdateConfig(newConfig);
    UpdateManagerService.saveConfig(newConfig);
  };

  /**
   * Convert all transcription timestamps based on new meeting start time
   * Formula: startTime = newMeetingStartTime + audioTimeMs
   */
  const handleConvertTimestamps = useCallback(
    (newMeetingStartTime: Date) => {
      if (transcriptions.length === 0) {
        message.info(t("transcriptionConfirm.noSegments"));
        return;
      }

      let convertedCount = 0;
      const updatedTranscriptions = transcriptions.map((segment) => {
        // Only convert if audioTimeMs is available
        if (segment.audioTimeMs !== undefined) {
          const newStartTime = new Date(
            newMeetingStartTime.getTime() + segment.audioTimeMs,
          );
          convertedCount++;
          return {
            ...segment,
            startTime: newStartTime.toISOString(),
            endTime: newStartTime.toISOString(), // Keep same as start
          };
        }
        return segment;
      });

      setTranscriptions(updatedTranscriptions);
      setHasUnsavedChanges(true); // Mark as unsaved to show Save button

      message.success(
        t("transcriptionConfirm.convertedSegments", { converted: convertedCount, total: transcriptions.length }),
      );
      console.log("🕐 Converted timestamps:", {
        newMeetingStartTime: newMeetingStartTime.toISOString(),
        totalSegments: transcriptions.length,
        convertedSegments: convertedCount,
      });
    },
    [transcriptions],
  );

  // Function to show options modal when file is too large
  const showSegmentSelectionModal = (fileSizeMB: number, maxSizeMB: number) => {
    if (!audioBlob) return;

    // Get audio duration
    const audioDurationMs = audioPlayerRef.current?.getDuration() || 0;
    const audioDurationSec = Math.floor(audioDurationMs / 1000);
    const durationMinutes = Math.floor(audioDurationSec / 60);
    const durationSeconds = audioDurationSec % 60;

    // Get max duration from config
    const config = speechToTextService.getConfig();
    const maxDurationMinutes = config?.maxAudioDurationMinutes || 30;

    // Show options modal: Auto-split vs Manual selection
    const optionsModal = modal.confirm({
      title: (
        <span
          style={{ fontSize: "18px", fontWeight: "bold", color: "#fa8c16" }}
        >
          {t('fileTooLarge.title')}
        </span>
      ),
      width: 700,
      icon: <ExclamationCircleOutlined style={{ color: "#fa8c16" }} />,
      content: (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              padding: "16px",
              background: "#fff7e6",
              border: "2px solid #ffd591",
              borderRadius: "8px",
              marginBottom: "16px",
            }}
          >
            <div style={{ fontSize: "15px", marginBottom: "12px" }}>
              <strong>{t('fileTooLarge.fileInfo')}</strong>
              <br />• {t('fileTooLarge.duration')}{" "}
              <span style={{ fontWeight: "bold" }}>
                {durationMinutes}:{String(durationSeconds).padStart(2, "0")}
              </span>{" "}
              (≈ {Math.ceil(audioDurationSec / 60)} {t('config.minutesSuffix')})
              <br />• {t('fileTooLarge.currentSize')}{" "}
              <span style={{ color: "#fa8c16", fontWeight: "bold" }}>
                {fileSizeMB.toFixed(2)} MB
              </span>
              <br />• {t('fileTooLarge.geminiLimit')}{" "}
              <span style={{ color: "#52c41a", fontWeight: "bold" }}>
                ≤ {maxSizeMB} MB
              </span>{" "}
              {t('common.and')}{" "}
              <span style={{ color: "#52c41a", fontWeight: "bold" }}>
                ≤ {maxDurationMinutes} {t('config.minutesSuffix')}
              </span>
            </div>
            <div style={{ fontSize: "13px", color: "#666" }}>
              {t('fileTooLarge.exceedsLimit')}
            </div>
          </div>

          <div
            style={{
              fontSize: "16px",
              fontWeight: "bold",
              marginBottom: "16px",
              color: "#1890ff",
            }}
          >
            {t('fileTooLarge.chooseMethod')}
          </div>

          {/* Option 1: Auto-split entire file */}
          <div
            style={{
              padding: "16px",
              background:
                "linear-gradient(135deg, #667eea22 0%, #764ba222 100%)",
              border: "2px solid #667eea",
              borderRadius: "8px",
              marginBottom: "16px",
              cursor: "pointer",
            }}
            onClick={() => {
              optionsModal.destroy(); // Close modal immediately
              handleAutoSplitTranscription();
            }}
          >
            <div
              style={{
                fontSize: "15px",
                fontWeight: "bold",
                marginBottom: "8px",
                color: "#667eea",
              }}
            >
              <span style={{ fontSize: "20px" }}>🤖</span> {t('fileTooLarge.autoMethod')}
            </div>
            <div style={{ fontSize: "13px", color: "#666", lineHeight: "1.6" }}>
              {t('fileTooLarge.autoSplit', { maxSizeMB })}
              <br />
              {t('fileTooLarge.autoSend')}
              <br />
              {t('fileTooLarge.autoMerge')}
              <br />{" "}
              <strong style={{ color: "#52c41a" }}>{t('fileTooLarge.autoRecommend')}</strong>
            </div>
          </div>

          {/* Option 2: Manual segment selection */}
          <div
            style={{
              padding: "16px",
              background: "#f0f5ff",
              border: "2px solid #91d5ff",
              borderRadius: "8px",
              cursor: "pointer",
            }}
            onClick={() => {
              optionsModal.destroy(); // Close modal immediately
              showManualSegmentSelectionModal(fileSizeMB, maxSizeMB);
            }}
          >
            <div
              style={{
                fontSize: "15px",
                fontWeight: "bold",
                marginBottom: "8px",
                color: "#1890ff",
              }}
            >
              <span style={{ fontSize: "20px" }}>✂️</span> {t('fileTooLarge.manualMethod')}
            </div>
            <div style={{ fontSize: "13px", color: "#666", lineHeight: "1.6" }}>
              {t('fileTooLarge.manualDesc1')}
              <br />
              {t('fileTooLarge.manualDesc2')}
              <br />
              {t('fileTooLarge.manualDesc3')}
              <br />{t('fileTooLarge.manualDesc4')}
            </div>
          </div>

          <div
            style={{
              padding: "12px",
              background: "#fffbe6",
              border: "1px solid #ffe58f",
              borderRadius: "6px",
              fontSize: "13px",
              color: "#666",
              marginTop: "16px",
            }}
          >
            <strong>{t('fileTooLarge.tip').split(':')[0]}:</strong>{t('fileTooLarge.tip').split(':').slice(1).join(':')}
          </div>
        </div>
      ),
      okText: t('common.close'),
      cancelButtonProps: { style: { display: "none" } },
      okButtonProps: { size: "large", style: { height: "40px" } },
    });
  };

  // Function to show manual segment selection modal
  const showManualSegmentSelectionModal = (
    fileSizeMB: number,
    maxSizeMB: number,
  ) => {
    if (!audioBlob) return;

    const audioDurationMs = audioPlayerRef.current?.getDuration() || 0;
    const audioDurationSec = Math.floor(audioDurationMs / 1000);
    const durationMinutes = Math.floor(audioDurationSec / 60);
    const durationSeconds = audioDurationSec % 60;

    let startTimeInput: HTMLInputElement | null = null;
    let endTimeInput: HTMLInputElement | null = null;

    modal.confirm({
      title: (
        <span
          style={{ fontSize: "18px", fontWeight: "bold", color: "#1890ff" }}
        >
          ✂️ {t('manualSegment.title')}
        </span>
      ),
      width: 600,
      icon: null,
      content: (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              padding: "16px",
              background: "#e6f7ff",
              border: "1px solid #91d5ff",
              borderRadius: "8px",
              marginBottom: "16px",
            }}
          >
            <div style={{ fontSize: "15px", marginBottom: "12px" }}>
              <strong>{t('fileTooLarge.fileInfo')}</strong>
              <br />• {t('fileTooLarge.currentSize')}{" "}
              <span style={{ fontWeight: "bold" }}>
                {fileSizeMB.toFixed(2)} MB
              </span>{" "}
              / {maxSizeMB} MB
              <br />• {t('fileTooLarge.duration')}{" "}
              <span style={{ fontWeight: "bold" }}>
                {durationMinutes}:{String(durationSeconds).padStart(2, "0")}
              </span>
            </div>
          </div>

          <div
            style={{
              padding: "12px",
              background: "#f0f5ff",
              border: "1px dashed #adc6ff",
              borderRadius: "6px",
              marginBottom: "16px",
              fontSize: "13px",
              color: "#1890ff",
            }}
          >
            🎵 <strong>{t('manualSegment.tip').split(':')[0]}:</strong> {t('manualSegment.tip').split(':').slice(1).join(':')}
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "4px",
                fontSize: "14px",
                fontWeight: "bold",
              }}
            >
              {t('manualSegment.startTime')}
            </label>
            <input
              ref={(el) => (startTimeInput = el)}
              type="text"
              placeholder="VD: 5:30 hoặc 0:00"
              defaultValue="0:00"
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: "14px",
                border: "1px solid #d9d9d9",
                borderRadius: "4px",
                outline: "none",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#1890ff")}
              onBlur={(e) => (e.target.style.borderColor = "#d9d9d9")}
            />
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "4px",
                fontSize: "14px",
                fontWeight: "bold",
              }}
            >
              {t('manualSegment.endTime')}
            </label>
            <input
              ref={(el) => (endTimeInput = el)}
              type="text"
              placeholder={`VD: ${durationMinutes}:${String(durationSeconds).padStart(2, "0")}`}
              defaultValue={`${durationMinutes}:${String(durationSeconds).padStart(2, "0")}`}
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: "14px",
                border: "1px solid #d9d9d9",
                borderRadius: "4px",
                outline: "none",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#1890ff")}
              onBlur={(e) => (e.target.style.borderColor = "#d9d9d9")}
            />
          </div>

          <div
            style={{
              padding: "12px",
              background: "#fffbe6",
              border: "1px solid #ffe58f",
              borderRadius: "6px",
              fontSize: "13px",
              color: "#666",
            }}
          >
            <strong>📝 {t('manualSegment.note').split(':')[0]}:</strong> {t('manualSegment.note').split(':').slice(1).join(':')}
          </div>
        </div>
      ),
      okText: t('manualSegment.convert'),
      cancelText: t('common.back'),
      okButtonProps: { size: "large", style: { height: "40px" } },
      cancelButtonProps: { size: "large", style: { height: "40px" } },
      onOk: async () => {
        await handleManualSegmentTranscription(
          startTimeInput,
          endTimeInput,
          maxSizeMB,
        );
      },
      onCancel: () => {
        // Go back to options modal
        showSegmentSelectionModal(fileSizeMB, maxSizeMB);
      },
    });
  };

  // Handler for auto-split transcription
  const handleAutoSplitTranscription = async () => {
    if (!audioBlob) return;

    const config = speechToTextService.getConfig();
    if (!config || !config.geminiApiKey || !config.geminiModel) {
      message.error(t('missingApiKey.description'));
      return;
    }

    // Get config values with defaults
    const maxFileSizeMB = config.maxFileSizeMB || 20;
    const requestDelaySeconds = config.requestDelaySeconds || 5;
    const maxDurationMinutes = config.maxAudioDurationMinutes || 30;

    // ⚠️ Kiểm tra thời lượng và cảnh báo nếu quá dài
    const audioDurationMs = audioPlayerRef.current?.getDuration() || 0;
    const durationMinutes = Math.floor(audioDurationMs / 60000);

    if (durationMinutes > 60) {
      // Hiện cảnh báo cho audio dài, nhưng với tone khác (tính năng này đã được tối ưu cho audio dài)
      const confirmed = await new Promise<boolean>((resolve) => {
        modal.warning({
          title: t('longAudio.title'),
          width: 600,
          content: (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  padding: "16px",
                  background: "#fffbe6",
                  border: "1px solid #ffe58f",
                  borderRadius: "8px",
                  marginBottom: "16px",
                }}
              >
                <div
                  style={{
                    fontSize: "15px",
                    color: "#d48806",
                    lineHeight: "1.8",
                  }}
                >
                  <strong>{t('longAudio.info')}</strong>
                  <br />• {t('longAudio.duration', { minutes: durationMinutes })}
                  <br />• {t('longAudio.estimatedParts', { parts: Math.ceil(durationMinutes / maxDurationMinutes) })}
                  <br />• {t('longAudio.estimatedTime', { min: Math.ceil(durationMinutes / 10), max: Math.ceil(durationMinutes / 5) })}
                  <br />• {t('longAudio.delay', { seconds: requestDelaySeconds })}
                  <br />
                  <br />
                  <strong style={{ color: "#ff7a45" }}>{t('longAudio.notes')}</strong>
                  <br />
                  {t('longAudio.note1')}
                  <br />
                  {t('longAudio.note2')}
                  <br />{t('longAudio.note3')}
                </div>
              </div>
              <div style={{ fontSize: "13px", color: "#666" }}>
                <strong>{t('longAudio.tip').split(':')[0]}:</strong>{t('longAudio.tip').split(':').slice(1).join(':')}
              </div>
            </div>
          ),
          okText: t('longAudio.continue'),
          cancelText: t('common.cancel'),
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });

      if (!confirmed) return;
    }

    // Create progress notification at bottom-right (non-blocking)
    let currentProgress = 0;
    let currentMessage = t("autoSplit.starting");
    const notificationKey = `gemini-auto-split-${Date.now()}`;

    const updateProgressNotification = () => {
      notification.open({
        key: notificationKey,
        message: (
          <span
            style={{ fontSize: "16px", fontWeight: "bold", color: "#667eea" }}
          >
            <span style={{ fontSize: "20px" }}>🤖</span> {t("autoSplit.notificationTitle")}
          </span>
        ),
        description: (
          <div style={{ width: 320 }}>
            <div
              style={{
                padding: "12px",
                background:
                  "linear-gradient(135deg, #667eea22 0%, #764ba222 100%)",
                borderRadius: "6px",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  marginBottom: "8px",
                  fontSize: "13px",
                  fontWeight: "bold",
                  color: "#333",
                }}
              >
                {currentMessage}
              </div>
              <Progress
                percent={currentProgress}
                status={currentProgress === 100 ? "success" : "active"}
                strokeColor={{
                  "0%": "#667eea",
                  "100%": "#764ba2",
                }}
                size="small"
              />
            </div>
            <div style={{ fontSize: "12px", color: "#666", lineHeight: "1.5" }}>
              💡 Đang xử lý từng phần với delay để tuân thủ rate limit
            </div>
          </div>
        ),
        placement: "bottomRight",
        duration: 0,
        style: {
          width: 400,
        },
      });
    };

    updateProgressNotification();

    try {
      // Start transcription with progress callback and config values
      // Get valid meeting start time (fallback to transcription time or current time if meetingInfo is empty)
      const meetingStartTime = getValidMeetingStartTime();
      console.log(
        "📅 Meeting start time for Gemini:",
        meetingStartTime.toISOString(),
      );

      const parsed = await AIRefinementService.transcribeEntireAudioWithGemini(
        config.geminiApiKey,
        audioBlob,
        config.geminiModel,
        (progress, msg) => {
          currentProgress = progress;
          currentMessage = msg || t("autoSplit.defaultProgress");

          // Update notification
          updateProgressNotification();
        },
        maxFileSizeMB,
        requestDelaySeconds,
        maxDurationMinutes,
        meetingStartTime,
        config.summaryPrompt,
        fileManagerRef.current, // Pass fileManager for debug logs
        undefined, // languageCode
        // Retry callback giống handleTranscribeAudio
        (ctx) =>
          new Promise((resolve) => {
            let newKey = ctx.currentApiKey;
            modal.confirm({
              title: t('retryError.title'),
              width: 520,
              icon: null,
              content: (
                <div style={{ marginTop: 8 }}>
                  <div
                    style={{
                      padding: "10px 14px",
                      background: "#fff2f0",
                      border: "1px solid #ffccc7",
                      borderRadius: 6,
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>
                      {ctx.chunkTotal === 0
                        ? t('retryError.errorAtSummary')
                        : t('retryError.errorAt', { current: ctx.chunkIndex, total: ctx.chunkTotal })}
                    </div>
                    <div style={{ color: "#cf1322", fontSize: 13 }}>{ctx.error}</div>
                  </div>
                  <div style={{ marginBottom: 12, color: "#595959", fontSize: 13 }}>
                    {ctx.isNonRetryable
                      ? t('retryError.nonRetryableMsg')
                      : t('retryError.retriedFailed', { count: ctx.attempt })}
                  </div>
                  <div style={{ marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
                    {t('retryError.apiKeyLabel')}
                  </div>
                  <Input.Password
                    defaultValue={ctx.currentApiKey}
                    onChange={(e) => { newKey = e.target.value; }}
                    placeholder={t('retryError.apiKeyPlaceholder')}
                    autoComplete="off"
                    style={{ fontFamily: "monospace", fontSize: 12 }}
                  />
                  <div style={{ marginTop: 6, fontSize: 12, color: "#8c8c8c" }}>
                    {t('retryError.apiKeyHint')}
                  </div>
                  <div style={{ marginTop: 12, textAlign: 'right', borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#ff4d4f', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}
                      onClick={() => { Modal.destroyAll(); resolve({ retry: false }); }}
                    >
                      🛑 {t('retryError.stopBtn')}
                    </button>
                  </div>
                </div>
              ),
              okText: t('retryError.retryBtn'),
              cancelText: t('retryError.skipBtn'),
              onOk: () => resolve({ retry: true, newApiKey: newKey?.trim() || undefined }),
              onCancel: () => resolve({ retry: false, skip: true }),
            });
          }),
      );

      // Close progress notification on success
      notification.destroy(notificationKey);

      // Show success message
      message.success(t("transcriptionConfirm.completed"));

      // Save summary
      if (parsed.summary) {
        console.log("📋 Received summary from Gemini:", parsed.summary);
        setGeminiSummary(parsed.summary);
      }

      // Show truncation warning if detected
      if (parsed.isTruncated && parsed.truncationWarning) {
        modal.warning({
          title: t('truncationWarning.title'),
          width: 600,
          content: (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  padding: "12px 16px",
                  background: "#fffbe6",
                  border: "1px solid #ffe58f",
                  borderRadius: "6px",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    color: "#d48806",
                    fontSize: "14px",
                    whiteSpace: "pre-line",
                  }}
                >
                  {parsed.truncationWarning}
                </div>
              </div>
              <div
                style={{ marginTop: 12, color: "#595959", fontSize: "13px" }}
              >
                {t('truncationWarning.received', { count: parsed.results.length })}
              </div>
            </div>
          ),
          okText: t('common.close'),
        });
      }

      // Show merge/replace options modal
      showMergeOrReplaceModal(parsed.results);
    } catch (error: any) {
      // Close progress notification on error
      notification.destroy(notificationKey);

      // Check if error is RECITATION or SAFETY (content policy violations)
      const isRecitationError = error.message?.includes("RECITATION_ERROR");
      const isSafetyError = error.message?.includes("SAFETY_ERROR");

      if (isRecitationError || isSafetyError) {
        // Show warning modal (yellow) for policy violations
        modal.warning({
          title: isRecitationError
            ? t('contentPolicy.recitationTitle')
            : t('contentPolicy.safetyTitle'),
          width: 480,
          content: (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  padding: "12px 16px",
                  background: "#fffbe6",
                  border: "1px solid #ffe58f",
                  borderRadius: "6px",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    color: "#d48806",
                    fontSize: "14px",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {error.message
                    .replace("RECITATION_ERROR:", "")
                    .replace("SAFETY_ERROR:", "")
                    .trim()}
                </div>
              </div>
            </div>
          ),
          okText: t('common.close'),
        });
        console.warn("Auto-split policy violation:", error);
        return;
      }

      // Show error modal (red) for other errors
      modal.error({
        title: t('transcriptionError.title'),
        width: 480,
        content: (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                padding: "12px 16px",
                background: "#fff2f0",
                border: "1px solid #ffccc7",
                borderRadius: "6px",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  color: "#cf1322",
                  fontSize: "14px",
                  wordBreak: "break-word",
                }}
              >
                {error.message}
              </div>
            </div>
          </div>
        ),
        okText: t('common.close'),
      });
      console.error("Auto-split transcription error:", error);
    }
  };

  // Handler for manual segment transcription
  const handleManualSegmentTranscription = async (
    startTimeInput: HTMLInputElement | null,
    endTimeInput: HTMLInputElement | null,
    maxSizeMB: number,
  ) => {
    if (!audioBlob || !startTimeInput || !endTimeInput) {
      message.error(t("transcriptionConfirm.missingInfo"));
      return;
    }

    const audioDurationMs = audioPlayerRef.current?.getDuration() || 0;
    const audioDurationSec = Math.floor(audioDurationMs / 1000);
    const durationMinutes = Math.floor(audioDurationSec / 60);
    const durationSeconds = audioDurationSec % 60;

    // Parse time input (format: "mm:ss" or "m:ss")
    const parseTime = (timeStr: string): number => {
      const parts = timeStr.trim().split(":");
      if (parts.length !== 2) {
        throw new Error(t("transcriptionConfirm.invalidTimeFormat"));
      }
      const minutes = parseInt(parts[0]);
      const seconds = parseInt(parts[1]);
      if (isNaN(minutes) || isNaN(seconds)) {
        throw new Error(t("transcriptionConfirm.timeNotNumber"));
      }
      return (minutes * 60 + seconds) * 1000; // Convert to milliseconds
    };

    try {
      const startMs = parseTime(startTimeInput.value);
      const endMs = parseTime(endTimeInput.value);

      if (startMs >= endMs) {
        message.error(t("transcriptionConfirm.startBeforeEnd"));
        return;
      }

      if (endMs > audioDurationMs) {
        message.error(
          t("transcriptionConfirm.endExceedsDuration", { duration: `${durationMinutes}:${String(durationSeconds).padStart(2, "0")}` }),
        );
        return;
      }

      // Show processing modal
      const hideLoading = message.loading(t("autoSplit.convertingSegment"), 0);

      try {
        // Extract audio segment
        const segmentBlob = await AIRefinementService.extractAudioSegment(
          audioBlob,
          startMs,
          endMs,
        );

        hideLoading();

        const segmentSizeMB = segmentBlob.size / (1024 * 1024);
        console.log(`✂️ Segment extracted: ${segmentSizeMB.toFixed(2)} MB`);

        if (segmentBlob.size > maxSizeMB * 1024 * 1024) {
          message.error(
            `Đoạn đã chọn vẫn quá lớn (${segmentSizeMB.toFixed(2)} MB). ` +
              `Vui lòng chọn khoảng thời gian ngắn hơn.`,
          );
          return;
        }

        // Transcribe the segment
        const config = speechToTextService.getConfig();
        if (!config) return;

        const hideProcessing = message.loading(
          t("autoSplit.convertingSegment"),
          0,
        );

        try {
          const maxFileSizeMB = config.maxFileSizeMB || 200;
          const maxDurationMinutes = config.maxAudioDurationMinutes || 30;
          const meetingStartTime = getValidMeetingStartTime();

          const parsed = await AIRefinementService.transcribeAudioWithGemini(
            config.geminiApiKey!,
            segmentBlob,
            config.geminiModel!,
            undefined,
            false,
            maxFileSizeMB,
            meetingStartTime,
            config.summaryPrompt,
            fileManagerRef.current, // Pass fileManager for debug logs
            undefined, // chunkInfo
            config.languageCode, // Pass language code for output language
            maxDurationMinutes,
          );

          // Adjust timestamps to match original audio
          const adjustedResults = AIRefinementService.adjustTimestamps(
            parsed.results,
            startMs,
          );

          hideProcessing();

          // Save summary if available
          if (parsed.summary) {
            console.log("📋 Received summary from segment:", parsed.summary);
            setGeminiSummary(parsed.summary);
          }

          // Show truncation warning if detected
          if (parsed.isTruncated && parsed.truncationWarning) {
            modal.warning({
              title: t("truncationWarning.title"),
              width: 600,
              content: (
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      padding: "12px 16px",
                      background: "#fffbe6",
                      border: "1px solid #ffe58f",
                      borderRadius: "6px",
                    }}
                  >
                    <div
                      style={{
                        color: "#d48806",
                        fontSize: "14px",
                        whiteSpace: "pre-line",
                      }}
                    >
                      {parsed.truncationWarning}
                    </div>
                  </div>
                </div>
              ),
              okText: t("common.close"),
            });
          }

          // Show merge/replace options modal
          showMergeOrReplaceModal(adjustedResults);
        } catch (error: any) {
          hideProcessing();

          // Check if error is RECITATION or SAFETY (content policy violations)
          const isRecitationError = error.message?.includes("RECITATION_ERROR");
          const isSafetyError = error.message?.includes("SAFETY_ERROR");

          if (isRecitationError || isSafetyError) {
            // Show warning modal (yellow) for policy violations
            modal.warning({
              title: isRecitationError
                ? t("contentPolicy.recitationTitle")
                : t("contentPolicy.safetyTitle"),
              width: 480,
              content: (
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      padding: "12px 16px",
                      background: "#fffbe6",
                      border: "1px solid #ffe58f",
                      borderRadius: "6px",
                      marginBottom: "12px",
                    }}
                  >
                    <div
                      style={{
                        color: "#d48806",
                        fontSize: "14px",
                        wordBreak: "break-word",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {error.message
                        .replace("RECITATION_ERROR:", "")
                        .replace("SAFETY_ERROR:", "")
                        .trim()}
                    </div>
                  </div>
                </div>
              ),
              okText: t("common.close"),
            });
            console.warn("Manual segment policy violation:", error);
            return;
          }

          // Show error message for other errors
          message.error(t("transcriptionError.conversionError", { message: error.message }));
          console.error("Transcription error:", error);
        }
      } catch (error: any) {
        hideLoading();
        message.error(t("transcriptionError.audioCutError", { message: error.message }));
        console.error("Audio extraction error:", error);
      }
    } catch (error: any) {
      message.error(error.message);
    }
  };

  // Show modal to ask user: merge or replace?
  const showMergeOrReplaceModal = (newResults: TranscriptionResult[]) => {
    modal.confirm({
      title: (
        <span
          style={{ fontSize: "18px", fontWeight: "bold", color: "#52c41a" }}
        >
          ✅ Chuyển đổi thành công!
        </span>
      ),
      width: 600,
      icon: null,
      content: (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              padding: "16px",
              background: "linear-gradient(135deg, #52c41a 0%, #73d13d 100%)",
              borderRadius: "8px",
              color: "white",
              marginBottom: "16px",
            }}
          >
            <div
              style={{
                fontSize: "15px",
                fontWeight: "bold",
                marginBottom: "8px",
              }}
            >
              {t('mergeOrReplace.result')}
            </div>
            <div style={{ fontSize: "14px" }}>
              {t('mergeOrReplace.newSegments', { count: newResults.length })}
            </div>
          </div>

          <div
            style={{
              fontSize: "16px",
              fontWeight: "bold",
              marginBottom: "16px",
              color: "#1890ff",
            }}
          >
            {t('mergeOrReplace.choose')}
          </div>

          {/* Option 1: Merge */}
          <div
            style={{
              padding: "16px",
              background: "#f0f5ff",
              border: "2px solid #1890ff",
              borderRadius: "8px",
              marginBottom: "16px",
            }}
          >
            <div
              style={{
                fontSize: "15px",
                fontWeight: "bold",
                marginBottom: "8px",
                color: "#1890ff",
              }}
            >
              <span style={{ fontSize: "20px" }}>🔄</span> {t('mergeOrReplace.mergeOption')}
            </div>
            <div style={{ fontSize: "13px", color: "#666", lineHeight: "1.6" }}>
              {t('mergeOrReplace.mergeDesc1', { oldCount: transcriptions.length })}
              <br />{t('mergeOrReplace.mergeDesc2', { newCount: newResults.length })}
              <br />
              {t('mergeOrReplace.mergeDesc3')}
              <br />•{" "}
              <strong style={{ color: "#52c41a" }}>{t('mergeOrReplace.mergeDesc4')}</strong>
            </div>
          </div>

          {/* Option 2: Replace */}
          <div
            style={{
              padding: "16px",
              background: "#fff7e6",
              border: "2px solid #fa8c16",
              borderRadius: "8px",
            }}
          >
            <div
              style={{
                fontSize: "15px",
                fontWeight: "bold",
                marginBottom: "8px",
                color: "#fa8c16",
              }}
            >
              <span style={{ fontSize: "20px" }}>🔁</span> {t('mergeOrReplace.replaceOption')}
            </div>
            <div style={{ fontSize: "13px", color: "#666", lineHeight: "1.6" }}>
              •{" "}
              <strong style={{ color: "#fa8c16" }}>
                {t('mergeOrReplace.replaceDesc1', { oldCount: transcriptions.length })}
              </strong>
              <br />• {t('mergeOrReplace.replaceDesc2', { newCount: newResults.length })}
              <br />
              • {t('mergeOrReplace.replaceDesc3')}
              <br />• <strong style={{ color: "#ff4d4f" }}>{t('mergeOrReplace.replaceDesc4')}</strong>
            </div>
          </div>

          <div
            style={{
              padding: "12px",
              background: "#fffbe6",
              border: "1px solid #ffe58f",
              borderRadius: "6px",
              fontSize: "13px",
              color: "#666",
              marginTop: "16px",
            }}
          >
            💡 <strong>{t('mergeOrReplace.tip').split(':')[0]}:</strong> {t('mergeOrReplace.tip').split(':').slice(1).join(':')}
          </div>
        </div>
      ),
      okText: t('mergeOrReplace.mergeBtn'),
      cancelText: t('mergeOrReplace.replaceBtn'),
      okButtonProps: { size: "large", style: { height: "40px" } },
      cancelButtonProps: {
        size: "large",
        style: {
          height: "40px",
          background: "#fa8c16",
          borderColor: "#fa8c16",
          color: "white",
        },
      },
      onOk: () => {
        // Merge: Sort and add to existing
        setTranscriptions((prev) => {
          const merged = [...prev, ...newResults];
          return merged.sort(
            (a, b) => (a.audioTimeMs || 0) - (b.audioTimeMs || 0),
          );
        });
        setHasUnsavedChanges(true);

        message.success(
          t("mergeOrReplace.mergedSuccess", { newCount: newResults.length, total: transcriptions.length + newResults.length }),
        );
        console.log(
          `✅ Merged ${newResults.length} segments, total: ${transcriptions.length + newResults.length}`,
        );
      },
      onCancel: () => {
        // Replace: Clear old and use only new
        setTranscriptions(newResults);
        setHasUnsavedChanges(true);

        message.success(
          t("mergeOrReplace.replacedSuccess", { count: newResults.length }),
        );
        console.log(
          `✅ Replaced all transcriptions with ${newResults.length} new segments`,
        );
      },
    });
  };

  // Listen for 'transcribe-audio' event from TranscriptionConfig
  useEffect(() => {
    const handleTranscribeAudio = async (event: Event) => {
      const customEvent = event as CustomEvent<{
        apiKey: string;
        modelName: string;
      }>;

      if (!audioBlob) {
        message.error(t("audioPlayer.noAudio"));
        return;
      }

      // Get config from event detail or settings
      let apiKey: string | undefined;
      let modelName: string | undefined;
      let maxDurationMinutes: number;
      let maxFileSizeMB: number;

      if (customEvent.detail) {
        apiKey = customEvent.detail.apiKey;
        modelName = customEvent.detail.modelName;
        const config = speechToTextService.getConfig();
        maxDurationMinutes = config?.maxAudioDurationMinutes || 30;
        maxFileSizeMB = config?.maxFileSizeMB || 200;
      } else {
        // Fallback to getting from settings
        const config = speechToTextService.getConfig();
        apiKey = config?.geminiApiKey;
        modelName = config?.geminiModel;
        maxDurationMinutes = config?.maxAudioDurationMinutes || 30;
        maxFileSizeMB = config?.maxFileSizeMB || 200;
      }

      // Check if API key is provided
      if (!apiKey || apiKey.trim().length === 0) {
        modal.error({
          title: t("missingApiKey.title"),
          content: (
            <div style={{ marginTop: 16 }}>
              <p>{t("missingApiKey.description")}</p>
              <div
                style={{
                  marginTop: "12px",
                  padding: "12px",
                  background: "#f0f5ff",
                  borderRadius: "6px",
                }}
              >
                <strong>{t("missingApiKey.guide")}</strong>
                <br />
                {t("missingApiKey.step1")}{" "}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  https://aistudio.google.com/app/apikey
                </a>
                <br />
                {t("missingApiKey.step2")}
                <br />
                {t("missingApiKey.step3")}
                <br />
                {t("missingApiKey.step4")}
              </div>
            </div>
          ),
          okText: t("common.ok"),
        });
        return;
      }

      // Validate model is selected
      if (!modelName || !modelName.startsWith("models/")) {
        modal.error({
          title: t("missingModel.title"),
          content: (
            <div style={{ marginTop: 16 }}>
              <p>{t("missingModel.description")}</p>
              <div
                style={{
                  marginTop: "12px",
                  padding: "12px",
                  background: "#f0f5ff",
                  borderRadius: "6px",
                }}
              >
                <strong>{t("missingModel.steps")}</strong>
                <br />
                {t("missingModel.step1")}
                <br />
                {t("missingModel.step2")}
                <br />
                {t("missingModel.step3")}
                <br />
                {t("missingModel.step4")}
              </div>
            </div>
          ),
          okText: t("common.ok"),
        });
        return;
      }

      // Check audio duration (if available)
      const audioDurationMs = audioPlayerRef.current?.getDuration() || 0;
      const durationMinutes = Math.floor(audioDurationMs / 60000);

      if (audioDurationMs === 0) {
        message.warning(
          t("transcriptionConfirm.cannotDetermineAudio"),
        );
      }

      // ⚠️ Kiểm tra và cảnh báo nếu audio > maxDurationMinutes phút
      const isLongAudio = durationMinutes > maxDurationMinutes;

      // Show confirmation modal with enhanced UI
      modal.confirm({
        title: (
          <span
            style={{ fontSize: "18px", fontWeight: "bold", color: "#ff4d4f" }}
          >
            <span style={{ fontSize: "24px" }}></span>{t("transcriptionConfirm.title")}
          </span>
        ),
        width: 600,
        icon: null,
        content: (
          <div style={{ marginTop: 16 }}>
            {/* ℹ️ THÔNG BÁO cho audio dài - sẽ tự động xử lý */}
            {isLongAudio && (
              <div
                style={{
                  padding: "16px",
                  background:
                    "linear-gradient(135deg, #e6f7ff 0%, #bae7ff 100%)",
                  border: "2px solid #1890ff",
                  borderRadius: "8px",
                  marginBottom: "16px",
                }}
              >
                <div
                  style={{
                    fontSize: "15px",
                    color: "#0050b3",
                    lineHeight: "1.8",
                  }}
                >
                  <strong style={{ fontSize: "16px" }}>
                    {t("transcriptionConfirm.longAudio", { minutes: durationMinutes })}
                  </strong>
                  <br />
                  <strong style={{ color: "#1890ff" }}>
                    {t("transcriptionConfirm.autoSteps")}
                  </strong>
                  <br />• {t("transcriptionConfirm.step1", { maxMin: maxDurationMinutes, maxMB: maxFileSizeMB })}
                  <br />
                  • {t("transcriptionConfirm.step2")}
                  <br />
                  • {t("transcriptionConfirm.step3")}
                  <br />
                  • {t("transcriptionConfirm.step4")}
                  <br />
                  <strong style={{ color: "#0050b3" }}>
                    {t("transcriptionConfirm.estimatedTime")}
                  </strong>
                  <br />• {t("transcriptionConfirm.timeRange", { min: Math.ceil(durationMinutes / 15), max: Math.ceil(durationMinutes / 10) })}
                  <br />
                  • {t("transcriptionConfirm.delay")}
                  <br />
                  • {t("transcriptionConfirm.canMonitor")}
                  <br />
                </div>
              </div>
            )}

            <div
              style={{
                padding: "16px",
                background:
                  "linear-gradient(135deg, #667eea22 0%, #764ba222 100%)",
                borderRadius: "8px",
                marginBottom: "16px",
              }}
            >
              <div style={{ fontSize: "15px", marginBottom: "12px" }}>
                <strong>{t("transcriptionConfirm.info")}</strong>
                <br />• {t("transcriptionConfirm.model")}{" "}
                <span style={{ fontWeight: "bold", color: "#667eea" }}>
                  {modelName.replace("models/", "")}
                </span>
                <br />• {t("transcriptionConfirm.originalSize")}{" "}
                <span style={{ fontWeight: "bold" }}>
                  {(audioBlob.size / (1024 * 1024)).toFixed(2)} MB
                </span>
                <br />
                {audioDurationMs > 0 && (
                  <>
                    • {t("transcriptionConfirm.audioDuration")}{" "}
                    <span
                      style={{
                        fontWeight: "bold",
                        color: isLongAudio ? "#ff4d4f" : "inherit",
                      }}
                    >
                      {Math.floor(audioDurationMs / 60000)}:
                      {String(
                        Math.floor((audioDurationMs % 60000) / 1000),
                      ).padStart(2, "0")}
                      {isLongAudio && " ⚠️"}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Lợi ích - chỉ hiện khi không phải audio dài */}
            {!isLongAudio && (
              <div
                style={{
                  padding: "16px",
                  background: "#f0f5ff",
                  border: "1px solid #adc6ff",
                  borderRadius: "8px",
                  marginBottom: "16px",
                }}
              >
                <div
                  style={{ fontSize: "14px", color: "#666", lineHeight: "1.8" }}
                >
                  <strong style={{ color: "#1890ff" }}>
                    {t("transcriptionConfirm.benefits")}
                  </strong>
                  <br />
                  • {t("transcriptionConfirm.benefit1")}
                  <br />
                  • {t("transcriptionConfirm.benefit2")}
                  <br />
                  • {t("transcriptionConfirm.benefit3")}
                  <br />• {t("transcriptionConfirm.benefit4")}
                </div>
              </div>
            )}

            <div
              style={{
                padding: "12px",
                background: isLongAudio ? "#fff2e8" : "#fffbe6",
                border: `1px solid ${isLongAudio ? "#ffbb96" : "#ffe58f"}`,
                borderRadius: "6px",
                fontSize: "13px",
                color: "#666",
              }}
            >
              <strong>{t("transcriptionConfirm.processingTime")}</strong>{" "}
              {isLongAudio
                ? t("transcriptionConfirm.timeRange", { min: Math.ceil(durationMinutes / 15), max: Math.ceil(durationMinutes / 10) })
                : t("transcriptionConfirm.processingTimeShort")}
              {isLongAudio && (
                <>
                  <br />
                  <strong style={{ color: "#1890ff" }}>
                    {t("transcriptionConfirm.longAudioNote")}
                  </strong>
                </>
              )}
            </div>
          </div>
        ),
        okText: isLongAudio
          ? t("transcriptionConfirm.startAutoBtn")
          : t("transcriptionConfirm.startBtn"),
        cancelText: t("transcriptionConfirm.cancelBtn"),
        okButtonProps: {
          size: "large",
          danger: false,
          style: {
            height: "40px",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            border: "none",
          },
        },
        cancelButtonProps: { size: "large", style: { height: "40px" } },
        onOk: () => {
          // CRITICAL: Don't use async onOk - modal will stay open until Promise resolves
          // Instead, start processing in background and return immediately to close modal
          const startProcessing = async () => {
            // Create progress notification at bottom-right (non-blocking)
            let progressPercent = 0;
            let progressMessage = t("transcriptionConfirm.progressInit");
            const notificationKey = `gemini-progress-${Date.now()}`;

            notification.open({
              key: notificationKey,
              message: (
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: "bold",
                    color: "#667eea",
                  }}
                >
                  <span style={{ fontSize: "20px" }}></span> {t("transcriptionConfirm.progressTitle")}
                </span>
              ),
              description: (
                <div style={{ width: 320 }}>
                  <Progress
                    percent={progressPercent}
                    status="active"
                    strokeColor={{
                      "0%": "#667eea",
                      "100%": "#764ba2",
                    }}
                    size="small"
                  />
                  <div
                    style={{
                      marginTop: 8,
                      padding: "8px 12px",
                      background:
                        "linear-gradient(135deg, #f0f5ff 0%, #e6f7ff 100%)",
                      borderRadius: "6px",
                      fontSize: "13px",
                      color: "#0050b3",
                      minHeight: "50px",
                      display: "flex",
                      alignItems: "center",
                      wordBreak: "break-word",
                    }}
                  >
                    {progressMessage}
                  </div>
                </div>
              ),
              placement: "bottomRight",
              duration: 0, // Don't auto close
              style: {
                width: 400,
              },
            });

            try {
              const config = speechToTextService.getConfig();
              const maxFileSizeMB = config?.maxFileSizeMB || 200;
              const maxDurationMinutes = config?.maxAudioDurationMinutes || 30;
              const meetingStartTime = getValidMeetingStartTime();

              // Retry callback: hiển thị modal sau khi tự động thử 3 lần thất bại.
              // Cho phép người dùng nhập API key mới nếu key cũ hết quota.
              const onRetryNeeded: GeminiRetryCallback = (ctx) =>
                new Promise((resolve) => {
                  let newKey = ctx.currentApiKey;
                  modal.confirm({
                    title: t("retryError.title"),
                    width: 520,
                    icon: null,
                    content: (
                      <div style={{ marginTop: 8 }}>
                        <div
                          style={{
                            padding: "10px 14px",
                            background: "#fff2f0",
                            border: "1px solid #ffccc7",
                            borderRadius: 6,
                            marginBottom: 12,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              marginBottom: 4,
                              fontSize: 14,
                            }}
                          >
                            {ctx.chunkTotal === 0
                              ? t("retryError.errorAtSummary")
                              : t("retryError.errorAt", { current: ctx.chunkIndex, total: ctx.chunkTotal })}
                          </div>
                          <div style={{ color: "#cf1322", fontSize: 13 }}>
                            {ctx.error}
                          </div>
                        </div>
                        <div
                          style={{
                            marginBottom: 12,
                            color: "#595959",
                            fontSize: 13,
                          }}
                        >
                          {t("retryError.retriedFailed", { count: ctx.attempt })}
                        </div>
                        <div
                          style={{
                            marginBottom: 6,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          {t("retryError.apiKeyLabel")}
                        </div>
                        <Input.Password
                          defaultValue={ctx.currentApiKey}
                          onChange={(e) => {
                            newKey = e.target.value;
                          }}
                          placeholder={t("retryError.apiKeyPlaceholder")}
                          autoComplete="off"
                          style={{ fontFamily: "monospace", fontSize: 12 }}
                        />
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: 12,
                            color: "#8c8c8c",
                          }}
                        >
                          {t("retryError.apiKeyHint")}
                        </div>
                        <div style={{ marginTop: 12, textAlign: "right", borderTop: "1px solid #f0f0f0", paddingTop: 8 }}>
                          <button
                            type="button"
                            style={{ background: "none", border: "none", color: "#ff4d4f", cursor: "pointer", fontSize: 13, padding: "0 4px" }}
                            onClick={() => { Modal.destroyAll(); resolve({ retry: false }); }}
                          >
                            🛑 {t("retryError.stopBtn")}
                          </button>
                        </div>
                      </div>
                    ),
                    okText: t("retryError.retryBtn"),
                    cancelText: t("retryError.skipBtn"),
                    onOk: () =>
                      resolve({
                        retry: true,
                        newApiKey: newKey?.trim() || undefined,
                      }),
                    onCancel: () => resolve({ retry: false, skip: true }),
                  });
                });

              const parsed =
                await AIRefinementService.transcribeAudioWithGemini(
                  apiKey,
                  audioBlob,
                  modelName,
                  (progress, msg) => {
                    // Update progress with message
                    progressPercent = Math.round(progress);
                    progressMessage = msg || `Xử lý: ${progressPercent}%`;

                    // Update notification content
                    notification.open({
                      key: notificationKey,
                      message: (
                        <span
                          style={{
                            fontSize: "16px",
                            fontWeight: "bold",
                            color:
                              progressPercent === 100 ? "#52c41a" : "#667eea",
                          }}
                        >
                          <span style={{ fontSize: "20px" }}></span> {t("transcriptionConfirm.progressTitle")}
                        </span>
                      ),
                      description: (
                        <div style={{ width: 320 }}>
                          <Progress
                            percent={progressPercent}
                            status={
                              progressPercent === 100 ? "success" : "active"
                            }
                            strokeColor={{
                              "0%": "#667eea",
                              "100%": "#764ba2",
                            }}
                            size="small"
                          />
                          <div
                            style={{
                              marginTop: 8,
                              padding: "8px 12px",
                              background:
                                progressPercent === 100
                                  ? "linear-gradient(135deg, #f6ffed 0%, #d9f7be 100%)"
                                  : "linear-gradient(135deg, #f0f5ff 0%, #e6f7ff 100%)",
                              borderRadius: "6px",
                              fontSize: "13px",
                              color:
                                progressPercent === 100 ? "#237804" : "#0050b3",
                              minHeight: "50px",
                              display: "flex",
                              alignItems: "center",
                              lineHeight: "1.6",
                              wordBreak: "break-word",
                            }}
                          >
                            {progressMessage}
                          </div>
                        </div>
                      ),
                      placement: "bottomRight",
                      duration: 0,
                      style: {
                        width: 400,
                      },
                    });

                    console.log(
                      `Transcription progress: ${progressPercent}% - ${progressMessage}`,
                    );
                  },
                  false,
                  maxFileSizeMB,
                  meetingStartTime,
                  config?.summaryPrompt,
                  fileManagerRef.current, // Pass fileManager for debug logs
                  undefined, // chunkInfo
                  config?.languageCode, // Pass language code for output language
                  maxDurationMinutes,
                  onRetryNeeded,
                );

              // Close progress notification on success
              notification.destroy(notificationKey);

              // Show success message
              message.success(t("transcriptionConfirm.completed"));

              // Save summary if available
              if (parsed.summary) {
                console.log("📋 Received summary:", parsed.summary);
                setGeminiSummary(parsed.summary);
              }

              // Show truncation warning if detected
              if (parsed.isTruncated && parsed.truncationWarning) {
                modal.warning({
                  title: t("truncationWarning.title"),
                  width: 600,
                  content: (
                    <div style={{ marginTop: 16 }}>
                      <div
                        style={{
                          padding: "12px 16px",
                          background: "#fffbe6",
                          border: "1px solid #ffe58f",
                          borderRadius: "6px",
                        }}
                      >
                        <div
                          style={{
                            color: "#d48806",
                            fontSize: "14px",
                            whiteSpace: "pre-line",
                          }}
                        >
                          {parsed.truncationWarning}
                        </div>
                      </div>
                    </div>
                  ),
                  okText: t("common.close"),
                });
              }

              // Show merge/replace options modal
              showMergeOrReplaceModal(parsed.results);
            } catch (error: any) {
              // Close progress notification on error
              notification.destroy(notificationKey);

              // Check if error is FILE_TOO_LARGE
              if (error.message === "FILE_TOO_LARGE") {
                // Show segment selection modal
                showSegmentSelectionModal(error.fileSizeMB, error.maxSizeMB);
                return;
              }

              // Check if error is RECITATION or SAFETY (special handling)
              const isRecitationError =
                error.message?.includes("RECITATION_ERROR");
              const isSafetyError = error.message?.includes("SAFETY_ERROR");

              if (isRecitationError || isSafetyError) {
                // Show warning modal with special styling for content policy violations
                modal.warning({
                  title: isRecitationError
                    ? t("contentPolicy.recitationTitle")
                    : t("contentPolicy.safetyTitle"),
                  width: 600,
                  content: (
                    <div style={{ marginTop: 16 }}>
                      <div
                        style={{
                          padding: "16px",
                          background: "#fffbe6",
                          border: "2px solid #ffe58f",
                          borderRadius: "8px",
                          marginBottom: "16px",
                        }}
                      >
                        <div
                          style={{
                            color: "#d48806",
                            fontSize: "14px",
                            lineHeight: "1.8",
                            whiteSpace: "pre-line",
                          }}
                        >
                          {error.message
                            .replace("RECITATION_ERROR: ", "")
                            .replace("SAFETY_ERROR: ", "")}
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: "13px",
                          color: "#666",
                          lineHeight: "1.6",
                        }}
                      >
                        <strong>{t("contentPolicy.info")}</strong>
                        <br />
                      </div>
                    </div>
                  ),
                  okText: t("common.ok"),
                  okButtonProps: { size: "large" },
                });
                return;
              }

              // Show error modal for other errors
              modal.error({
                title: t("transcriptionError.title"),
                width: 480,
                content: (
                  <div style={{ marginTop: 16 }}>
                    <div
                      style={{
                        padding: "12px 16px",
                        background: "#fff2f0",
                        border: "1px solid #ffccc7",
                        borderRadius: "6px",
                        marginBottom: "12px",
                      }}
                    >
                      <div
                        style={{
                          color: "#cf1322",
                          fontSize: "14px",
                          wordBreak: "break-word",
                        }}
                      >
                        <strong>{t("transcriptionError.details")}</strong>
                        <br />
                        {error.message}
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: "13px",
                        color: "#666",
                        lineHeight: "1.6",
                      }}
                    >
                      <strong>{t("transcriptionError.fixSuggestion")}</strong>
                      <ul style={{ marginTop: "8px", paddingLeft: "20px" }}>
                        <li>{t("transcriptionError.fix1")}</li>
                        <li>{t("transcriptionError.fix2")}</li>
                        <li>{t("transcriptionError.fix3")}</li>
                        <li>{t("transcriptionError.fix4")}</li>
                      </ul>
                    </div>
                  </div>
                ),
                okText: t("common.ok"),
                okButtonProps: { size: "large" },
              });
              console.error("Gemini transcription error:", error);
            }
          }; // End of startProcessing function

          // Start processing in background (don't await - let modal close immediately)
          startProcessing();

          // Return immediately to close modal
          return Promise.resolve();
        },
      });
    };

    window.addEventListener("transcribe-audio", handleTranscribeAudio);
    return () => {
      window.removeEventListener("transcribe-audio", handleTranscribeAudio);
    };
  }, [audioBlob, transcriptionConfig]);

  // Check for existing backup on mount
  useEffect(() => {
    const checkBackup = async () => {
      if (hasBackup()) {
        const age = getBackupAge();
        setBackupAge(age);
        setShowBackupDialog(true);
      }
    };
    checkBackup();
  }, []);

  // Track unsaved changes
  useEffect(() => {
    // Check if speakers have been modified
    const speakersModified =
      isSaved && !mapsAreEqual(savedSpeakersSnapshot, speakersMap);

    // Check if transcriptions have been modified
    const transcriptionsModified =
      isSaved &&
      !transcriptionsAreEqual(savedTranscriptionsSnapshot, transcriptions);

    // Check if meeting info has been modified
    const meetingInfoModified =
      isSaved && !meetingInfosAreEqual(savedMeetingInfoSnapshot, meetingInfo);

    // Có dữ liệu chưa lưu nếu:
    // 1. Đang recording
    // 2. Có audio/notes/speakers/transcriptions hoặc meetingInfo đã điền nhưng chưa save lần đầu
    // 3. Đã save nhưng notes, speakers, transcriptions hoặc meetingInfo bị sửa đổi
    const notesModified = isSaved && savedNotesSnapshot !== notes;
    const hasData =
      isRecording ||
      (!isSaved &&
        (audioBlob !== null ||
          notes.trim().length > 0 ||
          speakersMap.size > 0 ||
          transcriptions.length > 0 ||
          meetingInfo.title.trim().length > 0 ||
          meetingInfo.location.trim().length > 0 ||
          meetingInfo.host.trim().length > 0 ||
          meetingInfo.attendees.trim().length > 0)) ||
      notesModified ||
      speakersModified ||
      transcriptionsModified ||
      meetingInfoModified;

    console.log("🔍 hasUnsavedChanges check:", {
      isSaved,
      speakersModified,
      notesModified,
      meetingInfoModified,
      notesLength: notes.length,
      speakersMapSize: speakersMap.size,
      savedSpeakersSnapshotSize: savedSpeakersSnapshot.size,
      hasData,
    });

    setHasUnsavedChanges(hasData);
  }, [
    isRecording,
    audioBlob,
    notes,
    speakersMap,
    transcriptions,
    meetingInfo,
    isSaved,
    savedNotesSnapshot,
    savedSpeakersSnapshot,
    savedTranscriptionsSnapshot,
    savedMeetingInfoSnapshot,
  ]);

  // Helper function to compare two Maps
  function mapsAreEqual(
    map1: Map<number, string>,
    map2: Map<number, string>,
  ): boolean {
    if (map1.size !== map2.size) return false;
    for (const [key, value] of map1) {
      if (map2.get(key) !== value) return false;
    }
    return true;
  }

  // Helper function to compare two MeetingInfo objects
  function meetingInfosAreEqual(a: MeetingInfo, b: MeetingInfo): boolean {
    return (
      a.title === b.title &&
      a.date === b.date &&
      a.time === b.time &&
      a.location === b.location &&
      a.host === b.host &&
      a.attendees === b.attendees
    );
  }

  // Helper function to compare two transcription arrays
  function transcriptionsAreEqual(
    arr1: TranscriptionResult[],
    arr2: TranscriptionResult[],
  ): boolean {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
      const t1 = arr1[i];
      const t2 = arr2[i];
      if (
        t1.id !== t2.id ||
        t1.text !== t2.text ||
        t1.speaker !== t2.speaker ||
        t1.startTime !== t2.startTime ||
        t1.audioTimeMs !== t2.audioTimeMs ||
        t1.isManuallyEdited !== t2.isManuallyEdited
      ) {
        return false;
      }
    }
    return true;
  }

  // Auto-save to localStorage with debounce (every 3 seconds after changes)
  // Must include all backup data dependencies to ensure latest state is saved
  useEffect(() => {
    // Auto-save whenever there are unsaved changes (including after first save)
    // Backup will be cleared only when user explicitly saves
    if (hasUnsavedChanges) {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      autoSaveTimeoutRef.current = setTimeout(() => {
        const meetingInfoForBackup = {
          projectName: meetingInfo.title,
          location: meetingInfo.location,
          participants: meetingInfo.attendees,
          date: meetingInfo.date,
          time: meetingInfo.time,
          host: meetingInfo.host,
        };

        console.log("💾 Auto-backup saving:", {
          notesLength: notes.length,
          speakersMapSize: speakersMap.size,
          timestampMapSize: timestampMap.size,
          entries: Array.from(speakersMap.entries()),
        });

        saveBackup(
          meetingInfoForBackup,
          notes,
          timestampMap,
          recordingStartTime,
          audioBlob,
          isSaved,
          transcriptions,
          rawTranscripts,
          speakersMap,
          geminiSummary,
        );
      }, 3000); // Auto-save 3 seconds after last change
    }

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [
    hasUnsavedChanges,
    notes,
    speakersMap,
    timestampMap,
    meetingInfo,
    audioBlob,
    isSaved,
    transcriptions,
    rawTranscripts,
    geminiSummary,
    recordingStartTime,
  ]);

  // Switch to live mode when starting a new recording
  useEffect(() => {
    if (isRecording) {
      setIsLiveMode(true);
    }
  }, [isRecording]);

  // Debug: Log when meetingInfo changes
  useEffect(() => {
    // console.log('📝 App meetingInfo state updated:', meetingInfo);
  }, [meetingInfo]);

  // Prevent accidental page close/reload when recording or has unsaved data
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        // Chuẩn modern browsers
        e.preventDefault();
        // Chrome requires returnValue to be set
        e.returnValue =
          "Bạn có dữ liệu chưa lưu. Bạn có chắc muốn rời khỏi trang?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Clear unsaved changes flag after successful save
  const handleAudioBlobChange = (blob: Blob | null) => {
    setAudioBlob(blob);
  };

  const handleSaveComplete = () => {
    setIsSaved(true);
    setHasUnsavedChanges(false);
    // Use live refs instead of potentially-stale closure values.
    // This is critical when handleSaveComplete is called from an older render's
    // closure (e.g. after forceCommit fires setTranscriptions asynchronously).
    setSavedNotesSnapshot(notesRef.current);
    setSavedSpeakersSnapshot(new Map(speakersMapRef.current));
    setSavedTranscriptionsSnapshot([...transcriptionsRef.current]);
    setSavedMeetingInfoSnapshot({ ...meetingInfoRef.current });
    // Clear auto-backup after successful save
    clearBackup();
  };

  const handleRestoreBackup = async () => {
    const NOTIF_KEY = "restore-progress";

    // Helper: update bottom-right progress notification
    const showProgress = (percent: number, step: string) => {
      notification.open({
        key: NOTIF_KEY,
        message: t("backup.restoring"),
        description: (
          <div>
            <div style={{ marginBottom: 6, color: "#595959", fontSize: 13 }}>
              {step}
            </div>
            <Progress
              percent={percent}
              size="small"
              status={percent < 100 ? "active" : "success"}
            />
          </div>
        ),
        placement: "bottomRight",
        duration: 0,
        closable: false,
      });
    };

    // Close backup dialog immediately
    setShowBackupDialog(false);

    // ── Step 1: Read audio metadata (no blob loaded yet) ──────────────────────
    const audioInfo = await getBackupAudioInfo();
    const hasAudio = audioInfo.chunkCount > 0 || audioInfo.hasMonolithicBlob;

    // ── Step 2: ONE decision modal ────────────────────────────────────────────
    // Collect: cancel / notes-only / full-restore.
    // For full-restore with directory support, collect the dirHandle HERE using
    // showDirectoryPicker — this only opens a folder picker, it does NOT create
    // any files on disk yet, so there is no premature empty-file problem.
    type Decision =
      | { action: "cancel" }
      | { action: "notesOnly" }
      | { action: "full"; dirHandle: FileSystemDirectoryHandle | null };

    let decision: Decision = { action: "full", dirHandle: null };

    if (hasAudio) {
      const durationMin = audioInfo.estimatedDurationMin;
      const ramMB = Math.round(durationMin * 11);
      const isLarge = durationMin > 45;
      const hasDirPicker = "showDirectoryPicker" in window;

      decision = await new Promise<Decision>((resolve) => {
        const modalRef = modal.info({
          title: t("backup.selectMethod"),
          width: 500,
          // Prevent X / ESC — every footer button calls resolve() so the Promise
          // always settles and handleRestoreBackup never hangs.
          closable: false,
          maskClosable: false,
          content: (
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  padding: "10px 14px",
                  background: "#f5f5f5",
                  borderRadius: 6,
                  fontSize: 13,
                  marginBottom: 12,
                  lineHeight: 1.7,
                }}
              >
                {t("backup.estimatedAudio", { minutes: durationMin })}
                <br />
                {t("backup.ramUsage", { mb: ramMB })}
              </div>

              {isLarge && (
                <div
                  style={{
                    padding: "10px 14px",
                    background: "#fff2e8",
                    border: "1px solid #ffbb96",
                    borderRadius: 6,
                    fontSize: 13,
                    marginBottom: 12,
                    lineHeight: 1.7,
                  }}
                >
                  {t("backup.largeFileWarning")}
                </div>
              )}

              <div style={{ fontSize: 13, color: "#595959", lineHeight: 1.7 }}>
                {hasDirPicker
                  ? t("backup.fullRestoreNoteFSAPI")
                  : t("backup.fullRestoreNoteFallback")}
              </div>
            </div>
          ),
          footer: (
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 16,
              }}
            >
              <button
                style={{
                  padding: "6px 14px",
                  cursor: "pointer",
                  borderRadius: 4,
                  border: "1px solid #d9d9d9",
                }}
                onClick={() => {
                  modalRef.destroy();
                  resolve({ action: "cancel" });
                }}
              >
                {t("backup.cancelBtn")}
              </button>

              <button
                style={{
                  padding: "6px 14px",
                  cursor: "pointer",
                  borderRadius: 4,
                  border: "1px solid #d9d9d9",
                }}
                onClick={() => {
                  modalRef.destroy();
                  resolve({ action: "notesOnly" });
                }}
              >
                {t("backup.notesOnlyBtn")}
              </button>

              <button
                style={{
                  padding: "6px 14px",
                  backgroundColor: "#1890ff",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 4,
                  fontWeight: 600,
                }}
                onClick={async () => {
                  modalRef.destroy();
                  if (hasDirPicker) {
                    try {
                      // showDirectoryPicker only selects a folder — NO files are
                      // created on disk at this point. Actual writing happens in
                      // Step 4, after all chunks have been assembled.
                      const dh = await (window as any).showDirectoryPicker({
                        mode: "readwrite",
                      });
                      resolve({ action: "full", dirHandle: dh });
                    } catch {
                      // AbortError (user closed picker) or other error → proceed
                      // without pre-selected dir (fallback <a download> later)
                      resolve({ action: "full", dirHandle: null });
                    }
                  } else {
                    // Firefox/Safari: no directory picker — will use <a download>
                    resolve({ action: "full", dirHandle: null });
                  }
                }}
              >
                {t("backup.fullRestoreBtn")}
              </button>
            </div>
          ),
        });
      });

      if (decision.action === "cancel") {
        setShowBackupDialog(true);
        return;
      }
    }

    const skipAudio = decision.action === "notesOnly";
    const dirHandle =
      decision.action === "full"
        ? (
            decision as {
              action: "full";
              dirHandle: FileSystemDirectoryHandle | null;
            }
          ).dirHandle
        : null;
    // Use <a download> fallback when: full restore + no dir handle + no directory picker
    const useFallbackDownload =
      decision.action === "full" &&
      dirHandle === null &&
      !("showDirectoryPicker" in window);

    // ── Step 3: Load from localStorage + IndexedDB with progress ─────────────
    showProgress(0, t("backup.start"));
    const backup = await loadBackup({
      skipAudio,
      onProgress: (pct, step) => showProgress(pct, step),
    });

    if (!backup) {
      notification.destroy(NOTIF_KEY);
      return;
    }

    console.log("🔍 Backup data structure:", {
      hasAudioBlob: !!backup.audioBlob,
      audioBlobSize: backup.audioBlob?.size || 0,
      transcriptionsCount: backup.transcriptions?.length || 0,
      rawTranscriptsCount: backup.rawTranscripts?.length || 0,
      hasSummary: !!backup.geminiSummary,
    });

    // ── Step 4: Save files to disk BEFORE WaveSurfer rendering ───────────────
    // Chunks are now fully assembled in backup.audioBlob. Writing happens here,
    // so an OOM crash during WaveSurfer decode cannot cause data loss.
    let dataSavedToDisk = false;

    const mime = backup.audioBlob?.type || "audio/webm";
    const ext = mime.includes("mp4")
      ? "mp4"
      : mime.includes("ogg")
        ? "ogg"
        : mime.includes("wav")
          ? "wav"
          : "webm";

    // Build project folder name using the same convention as "Lưu ghi chú":
    // YYYYMMDD_HHmm_TênCuộcHọp_backup
    const backupDate =
      backup.meetingInfo.date || new Date().toISOString().split("T")[0];
    const backupTime =
      backup.meetingInfo.time || new Date().toTimeString().slice(0, 5);
    const dateStr = backupDate.replace(/-/g, ""); // "2026-03-05" → "20260305"
    const timeStr = backupTime.replace(":", ""); // "14:30" → "1430"
    const safeName =
      (backup.meetingInfo.projectName || "Meeting")
        .replace(/[<>:"/\\|?*]/g, "_")
        .replace(/[\s_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 50) || "Meeting";
    const projectFolderName = `${dateStr}_${timeStr}_${safeName}_backup`;
    const audioFilename = `${projectFolderName}.${ext}`;
    const notesFilename = `${projectFolderName}_notes.json`;

    if (backup.audioBlob && !skipAudio) {
      showProgress(96, t("backup.saving"));

      // Notes payload — everything useful for the user to have on disk
      const notesPayload = {
        projectName: backup.meetingInfo.projectName,
        date: backup.meetingInfo.date,
        time: backup.meetingInfo.time,
        location: backup.meetingInfo.location,
        host: backup.meetingInfo.host,
        participants: backup.meetingInfo.participants,
        notes: backup.notes,
        transcriptions: backup.transcriptions ?? [],
        geminiSummary: backup.geminiSummary ?? "",
        savedAt: new Date().toISOString(),
      };

      try {
        if (dirHandle) {
          // ── FSAPI path: create subfolder then write both files into it ──────
          // Folder: <dirHandle>/<YYYYMMDD_HHmm_TênCuộcHọp_backup>/
          const subDirHandle = await dirHandle.getDirectoryHandle(
            projectFolderName,
            { create: true },
          );

          // Audio
          const audioHandle = await subDirHandle.getFileHandle(audioFilename, {
            create: true,
          });
          const audioWritable = await audioHandle.createWritable();
          await audioWritable.write(backup.audioBlob);
          await audioWritable.close();

          // Notes JSON
          const notesHandle = await subDirHandle.getFileHandle(notesFilename, {
            create: true,
          });
          const notesWritable = await notesHandle.createWritable();
          await notesWritable.write(
            new Blob([JSON.stringify(notesPayload, null, 2)], {
              type: "application/json",
            }),
          );
          await notesWritable.close();

          dataSavedToDisk = true;
          notification.open({
            key: "files-saved-ok",
            message: t("backup.savedTitle"),
            description: `📁 ${dirHandle.name}/${projectFolderName}/`,
            duration: 5,
            placement: "bottomRight",
            closable: true,
          });
        } else if (useFallbackDownload) {
          // ── Fallback: <a download> for audio + notes ────────────────────────
          // Audio
          const audioUrl = URL.createObjectURL(backup.audioBlob);
          const a1 = document.createElement("a");
          a1.href = audioUrl;
          a1.download = audioFilename;
          document.body.appendChild(a1);
          a1.click();
          document.body.removeChild(a1);
          setTimeout(() => URL.revokeObjectURL(audioUrl), 10_000);

          // Notes JSON
          const notesUrl = URL.createObjectURL(
            new Blob([JSON.stringify(notesPayload, null, 2)], {
              type: "application/json",
            }),
          );
          const a2 = document.createElement("a");
          a2.href = notesUrl;
          a2.download = notesFilename;
          document.body.appendChild(a2);
          a2.click();
          document.body.removeChild(a2);
          setTimeout(() => URL.revokeObjectURL(notesUrl), 10_000);

          dataSavedToDisk = true;
        }
        // dirHandle === null && hasDirPicker → user cancelled picker → skip pre-save
      } catch (saveErr) {
        console.error("Failed to save files to disk:", saveErr);
        // Non-fatal — restore continues; download button appears on OOM error
      }
    }

    // ── Step 5: Apply all state ───────────────────────────────────────────────
    setMeetingInfo({
      title: backup.meetingInfo.projectName,
      date: backup.meetingInfo.date || new Date().toISOString().split("T")[0],
      time: backup.meetingInfo.time || new Date().toTimeString().slice(0, 5),
      location: backup.meetingInfo.location,
      host: backup.meetingInfo.host || "",
      attendees: backup.meetingInfo.participants,
    });
    setNotes(backup.notes);
    setTimestampMap(backup.timestampMap);
    setSpeakersMap(backup.speakersMap);
    setRecordingStartTime(backup.recordingStartTime);

    setIsSaved(backup.isSaved);

    if (backup.transcriptions && backup.transcriptions.length > 0) {
      setTranscriptions(backup.transcriptions);
    } else {
      setTranscriptions([]);
    }
    if (backup.rawTranscripts && backup.rawTranscripts.length > 0) {
      setRawTranscripts(backup.rawTranscripts);
    } else {
      setRawTranscripts([]);
    }
    if (backup.geminiSummary) {
      setGeminiSummary(backup.geminiSummary);
    } else {
      setGeminiSummary("");
    }

    // If we successfully saved to disk, treat this as a "save complete" event
    // so the session is marked saved and the autosave backup is cleared.
    if (dataSavedToDisk) {
      // Snapshots will be set immediately after; mark saved synchronously
      setIsSaved(true);
      setHasUnsavedChanges(false);
      clearBackup(); // safe to clear — data is on disk
    } else {
      setHasUnsavedChanges(!backup.isSaved);
    }

    setSavedNotesSnapshot(backup.notes);
    setSavedSpeakersSnapshot(new Map(backup.speakersMap));
    setSavedTranscriptionsSnapshot(
      backup.transcriptions ? [...backup.transcriptions] : [],
    );
    setSavedMeetingInfoSnapshot({
      title: backup.meetingInfo.projectName,
      date: backup.meetingInfo.date || new Date().toISOString().split("T")[0],
      time: backup.meetingInfo.time || new Date().toTimeString().slice(0, 5),
      location: backup.meetingInfo.location,
      host: backup.meetingInfo.host || "",
      attendees: backup.meetingInfo.participants,
    });

    setShowBackupDialog(false);

    // ── Step 6: Trigger WaveSurfer rendering (setAudioBlob → AudioPlayer) ────
    if (backup.audioBlob) {
      setIsLiveMode(false);
      setAudioBlob(backup.audioBlob);

      // Show "rendering" progress — closable so user can dismiss if decode is very slow
      notification.open({
        key: NOTIF_KEY,
        message: t("backup.restoring"),
        description: (
          <div>
            <div style={{ marginBottom: 6, color: "#595959", fontSize: 13 }}>
              {t("backup.renderingWaveform")}
            </div>
            <Progress percent={95} size="small" status="active" />
          </div>
        ),
        placement: "bottomRight",
        duration: 0,
        closable: true,
      });

      // Clear any stale waveform callbacks from a previous restore
      if (waveformWaitTimeoutRef.current) {
        clearTimeout(waveformWaitTimeoutRef.current);
      }
      const clearWaveformRefs = () => {
        onWaveformReadyRef.current = null;
        onWaveformErrorRef.current = null;
        if (waveformWaitTimeoutRef.current) {
          clearTimeout(waveformWaitTimeoutRef.current);
          waveformWaitTimeoutRef.current = null;
        }
      };

      // Inline download helper — safety net when WaveSurfer errors and audio wasn't saved yet
      const downloadBackupAudio = () => {
        if (!backup.audioBlob) return;
        const mime = backup.audioBlob.type || "audio/webm";
        const ext = mime.includes("mp4")
          ? "mp4"
          : mime.includes("ogg")
            ? "ogg"
            : mime.includes("wav")
              ? "wav"
              : "webm";
        const safeName =
          (backup.meetingInfo.projectName || "Meeting")
            .replace(/[\\/:*?"<>|]/g, "_")
            .trim() || "Meeting";
        const url = URL.createObjectURL(backup.audioBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeName}_Backup.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      };

      // WaveSurfer fired 'ready' → decode successful
      onWaveformReadyRef.current = () => {
        clearWaveformRefs();
        notification.open({
          key: NOTIF_KEY,
          message: t("backup.restoredSuccess"),
          description: (
            <div>
              <div style={{ marginBottom: 6, color: "#595959", fontSize: 13 }}>
                {t("backup.restoredWithAudio")}
              </div>
              <Progress percent={100} size="small" status="success" />
            </div>
          ),
          placement: "bottomRight",
          duration: 3,
          closable: true,
        });
      };

      // WaveSurfer fired 'error' → decode failed (OOM or corrupt)
      onWaveformErrorRef.current = (errMsg: string) => {
        clearWaveformRefs();
        const isOOM = errMsg.startsWith("OOM:");
        // Show download button only if audio wasn't already saved to disk
        const showDownload = isOOM && !dataSavedToDisk;
        notification.open({
          key: NOTIF_KEY,
          message: t("backup.restoredNoWaveform"),
          description: (
            <div>
              <div style={{ marginBottom: 6, color: "#faad14", fontSize: 13 }}>
                {errMsg}
              </div>
              {showDownload && (
                <div style={{ marginTop: 10 }}>
                  <div
                    style={{ marginBottom: 6, fontSize: 13, color: "#595959" }}
                  >
                    {t("backup.audioInMemory")}
                  </div>
                  <button
                    onClick={downloadBackupAudio}
                    style={{
                      padding: "6px 16px",
                      backgroundColor: "#1890ff",
                      color: "#fff",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {t("backup.downloadAudioBtn")}
                  </button>
                </div>
              )}
              <Progress
                percent={100}
                size="small"
                status="exception"
                style={{ marginTop: 10 }}
              />
            </div>
          ),
          placement: "bottomRight",
          duration: showDownload ? 0 : 6,
          closable: true,
        });
      };

      // Safety timeout: clear stale refs if WaveSurfer never fires ready/error
      waveformWaitTimeoutRef.current = setTimeout(
        () => {
          if (onWaveformReadyRef.current || onWaveformErrorRef.current) {
            clearWaveformRefs();
            const showDownload = !dataSavedToDisk;
            notification.open({
              key: NOTIF_KEY,
              message: t("backup.restoredWaveformTimeout"),
              description: (
                <div>
                  <div
                    style={{ marginBottom: 6, color: "#faad14", fontSize: 13 }}
                  >
                    {t("backup.notesRestoredWaveformLoading")}
                  </div>
                  {showDownload && (
                    <div style={{ marginTop: 10 }}>
                      <button
                        onClick={downloadBackupAudio}
                        style={{
                          padding: "6px 16px",
                          backgroundColor: "#1890ff",
                          color: "#fff",
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        {t("backup.downloadAudioBtn")}
                      </button>
                    </div>
                  )}
                  <Progress
                    percent={100}
                    size="small"
                    status="exception"
                    style={{ marginTop: 10 }}
                  />
                </div>
              ),
              placement: "bottomRight",
              duration: 0,
              closable: true,
            });
          }
        },
        10 * 60 * 1000,
      ); // 10 minutes safety net
    } else {
      // No audio — show success immediately
      notification.open({
        key: NOTIF_KEY,
        message: t("backup.restoredSuccess"),
        description: (
          <div>
            <div style={{ marginBottom: 6, color: "#595959", fontSize: 13 }}>
              {t("backup.restoredNoAudio")}
            </div>
            <Progress percent={100} size="small" status="success" />
          </div>
        ),
        placement: "bottomRight",
        duration: 3,
        closable: true,
      });
    }

    console.log("✅ Backup restored successfully:", {
      speakersMapSize: backup.speakersMap.size,
      transcriptionsRestored: backup.transcriptions?.length || 0,
      audioRestored: !!backup.audioBlob,
      dataSavedToDisk,
    });
  };

  const handleDiscardBackup = async () => {
    await clearBackup();
    setShowBackupDialog(false);
    // console.log('🗑️ Backup discarded');
  };

  const handleLoadProject = (loadedData: {
    meetingInfo: MeetingInfo;
    notes: string;
    timestampMap: Map<number, number>;
    speakersMap: Map<number, string>;
    audioBlob: Blob | null;
    recordingStartTime: number;
    transcriptions?: TranscriptionResult[]; // Add transcriptions array
    rawTranscripts?: RawTranscriptData[]; // Add raw transcripts for AI refinement
    summary?: string; // Add summary field
  }) => {
    // console.log('📂 App.handleLoadProject - Data received:', {
    //   meetingInfo: loadedData.meetingInfo,
    //   notesLength: loadedData.notes.length,
    //   timestampMapSize: loadedData.timestampMap.size,
    //   speakersMapSize: loadedData.speakersMap.size,
    //   audioBlobSize: loadedData.audioBlob?.size || 0,
    //   hasAudio: loadedData.audioBlob !== null,
    //   transcriptionsCount: loadedData.transcriptions?.length || 0
    // });

    setMeetingInfo(loadedData.meetingInfo);
    setNotes(loadedData.notes);
    setTimestampMap(loadedData.timestampMap);
    setSpeakersMap(loadedData.speakersMap);
    setAudioBlob(loadedData.audioBlob);
    setRecordingStartTime(loadedData.recordingStartTime);

    // Load transcriptions if available
    if (loadedData.transcriptions && loadedData.transcriptions.length > 0) {
      setTranscriptions(loadedData.transcriptions);
    } else {
      setTranscriptions([]); // Clear transcriptions if none
    }

    // Load raw transcripts if available
    if (loadedData.rawTranscripts && loadedData.rawTranscripts.length > 0) {
      setRawTranscripts(loadedData.rawTranscripts);
    } else {
      setRawTranscripts([]); // Clear raw transcripts if none
    }

    // Load summary if available
    if (loadedData.summary) {
      setGeminiSummary(loadedData.summary);
    }

    setIsSaved(true);
    setHasUnsavedChanges(false);
    setSavedNotesSnapshot(loadedData.notes);
    setSavedSpeakersSnapshot(new Map(loadedData.speakersMap));
    setSavedTranscriptionsSnapshot(
      loadedData.transcriptions ? [...loadedData.transcriptions] : [],
    ); // Save transcriptions snapshot
    setSavedMeetingInfoSnapshot({ ...loadedData.meetingInfo }); // Save meetingInfo snapshot
    setIsLiveMode(false); // Switch to timestamp mode when loading project
  };

  // Handle transcription config save
  const handleSaveTranscriptionConfig = (config: SpeechToTextConfig) => {
    setTranscriptionConfig(config);
    speechToTextService.initialize(config);
    // console.log('✅ Transcription config updated');
  };

  // Handle edit transcription
  const handleEditTranscription = useCallback(
    (
      id: string,
      newText: string,
      newSpeaker: string,
      newStartTime?: string,
      newAudioTimeMs?: number,
    ) => {
      // Check if user deleted all text (wants to remove segment)
      if (!newText || newText.trim() === "") {
        modal.confirm({
          title: t("deleteSegment.title"),
          icon: <ExclamationCircleOutlined style={{ color: "#ff4d4f" }} />,
          content: (
            <div style={{ fontSize: "14px", lineHeight: "1.6" }}>
              <p>{t("deleteSegment.deletedAll")}</p>
              <p style={{ marginBottom: "8px" }}>{t("deleteSegment.wantTo")}</p>
              <ul style={{ paddingLeft: "20px", margin: "0" }}>
                <li>
                  <strong>{t("deleteSegment.doDelete")}</strong>
                </li>
                <li>
                  <strong>{t("deleteSegment.doCancel")}</strong>
                </li>
              </ul>
            </div>
          ),
          okText: t("deleteSegment.confirmDelete"),
          cancelText: t("deleteSegment.cancelBtn"),
          okButtonProps: {
            danger: true,
          },
          onOk: () => {
            // Remove the segment
            setTranscriptions((prev) => prev.filter((item) => item.id !== id));
            setHasUnsavedChanges(true);
            message.success(t("deleteSegment.deleted"));
            // console.log('🗑️ Transcription segment deleted:', id);
          },
          // onCancel: do nothing (keep original segment)
        });
        return;
      }

      // Normal edit: update text and other fields
      setTranscriptions((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                text: newText,
                speaker: newSpeaker,
                startTime:
                  newStartTime !== undefined ? newStartTime : item.startTime,
                audioTimeMs:
                  newAudioTimeMs !== undefined
                    ? newAudioTimeMs
                    : item.audioTimeMs,
                isManuallyEdited: true,
              }
            : item,
        ),
      );
      setHasUnsavedChanges(true);
      // console.log('✏️ Transcription edited:', { id, newText, newSpeaker, newStartTime, newAudioTimeMs });
    },
    [setTranscriptions, setHasUnsavedChanges],
  ); // Memoized

  // Handle new transcription result
  const handleNewTranscription = (result: TranscriptionResult) => {
    try {
      // Validate result has text
      if (!result || !result.text) {
        console.warn("⚠️ Received invalid transcription result:", result);
        return;
      }

      // Collect raw transcript data for AI refinement
      const rawData: RawTranscriptData = {
        text: result.text,
        timestamp: result.startTime,
        audioTimeMs: result.audioTimeMs,
        confidence: result.confidence,
        isFinal: result.isFinal,
      };
      setRawTranscripts((prev) => [...prev, rawData]);

      setTranscriptions((prev) => {
        // Nếu là kết quả final
        if (result.isFinal) {
          // Tách final results và draft segment (nếu có)
          const finalResults = prev.filter((item) => item.isFinal);
          const existingDraft = prev.find((item) => !item.isFinal);

          // Kiểm tra xem có nên ghép text vào segment cuối không (cùng timestamp)
          if (finalResults.length > 0) {
            const lastResult = finalResults[finalResults.length - 1];

            // Validate both texts exist
            if (!lastResult.text) {
              // If last result has no text, replace it with new result
              finalResults[finalResults.length - 1] = result;
              return existingDraft
                ? [...finalResults, existingDraft]
                : finalResults;
            }

            // ** LOGIC MỚI: ghép text vào segment cuối **
            const lastText = lastResult.text || "";
            const lastWordCount =
              lastText.trim().length === 0
                ? 0
                : lastText.trim().split(/\s+/).filter(Boolean).length;

            // Nếu last segment chưa >= 150 từ → merge, ngược lại tạo segment mới (fall through)
            if (lastWordCount < 150) {
              // Ghép text: lastText + " " + newText
              const updatedText =
                lastResult.text.trim() + ". " + result.text.trim();

              finalResults[finalResults.length - 1] = {
                ...lastResult,
                text: updatedText,
                confidence: Math.min(lastResult.confidence, result.confidence), // Take lower confidence
                // Keep original timestamps (segment start)
                startTime: lastResult.startTime,
                endTime: lastResult.endTime,
                audioTimeMs: lastResult.audioTimeMs,
              };

              return existingDraft
                ? [...finalResults, existingDraft]
                : finalResults;
            }

            // ** Nếu nhiều hơn 150 từ → tạo segment mới (logic cũ không cần thiết nữa) **
          }

          // Thêm kết quả final mới và giữ draft segment nếu có
          return existingDraft
            ? [...finalResults, result, existingDraft]
            : [...finalResults, result];
        } else {
          // Nếu là kết quả tạm thời, giữ tất cả final + update/thêm 1 draft segment cố định
          const finalResults = prev.filter((item) => item.isFinal);
          const existingDraft = prev.find((item) => !item.isFinal);

          // ⚠️ trường hợp đặc biệt: Empty text means remove draft segment (clear signal from SmartTranscriptManager)
          if (!result.text || result.text.trim() === "") {
            // Remove draft segment, keep only final results
            return finalResults;
          }

          // Nếu đã có draft segment, CHỈ update nếu text thực sự thay đổi
          if (existingDraft) {
            // If text hasn't changed, return prev to prevent re-render
            if (existingDraft.text === result.text) {
              return prev;
            }

            // Update text and confidence, keep ID but allow timestamp to update
            const updatedDraft = {
              ...existingDraft,
              text: result.text,
              confidence: result.confidence,
              // Allow timestamps to update for draft (keep only ID)
              startTime: result.startTime,
              endTime: result.endTime,
              audioTimeMs: result.audioTimeMs,
            };

            return [...finalResults, updatedDraft];
          }

          // Nếu chưa có, tạo draft segment mới
          return [...finalResults, result];
        }
      });

      if (result.isFinal) {
        // console.log('✅ Final transcription:', result.text.substring(0, 50) + '...');
      }
    } catch (error) {
      console.error("❌ Error handling transcription:", error);
    }
  };

  // Handle seek to audio time
  const handleSeekToAudio = useCallback(
    (timeMs: number, shouldPlay: boolean = false) => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.seekTo(timeMs);
        if (shouldPlay) {
          audioPlayerRef.current.play();
        }
        // console.log(`⏭️ Seeking to ${(timeMs / 1000).toFixed(2)}s${shouldPlay ? ' + playing' : ''}`);
      }
    },
    [],
  ); // No dependencies - audioPlayerRef is stable

  // Handle AI refinement
  const handleAIRefine = async () => {
    if (!transcriptionConfig) {
      message.warning(t("aiRefine.noConfig"));
      setShowTranscriptionConfig(true);
      return;
    }

    // Check for Gemini API key
    const apiKeyToUse =
      transcriptionConfig.geminiApiKey || transcriptionConfig.apiKey;
    if (!apiKeyToUse) {
      message.error({
        content: (
          <div>
            <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
              {t("aiRefine.needApiKey")}
            </div>
            <div style={{ fontSize: "13px", lineHeight: "1.6" }}>
              <strong>{t("aiRefine.getKeyFree")}</strong>
              <ol style={{ paddingLeft: "20px", margin: "8px 0" }}>
                <li>
                  {t("aiRefine.getKeyStep1")}{" "}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                  >
                    Google AI Studio
                  </a>
                </li>
                <li>{t("aiRefine.getKeyStep2")}</li>
                <li>{t("aiRefine.getKeyStep3")}</li>
                <li>{t("aiRefine.getKeyStep4")}</li>
                <li>{t("aiRefine.getKeyStep5")}</li>
              </ol>
            </div>
          </div>
        ),
        duration: 10,
      });
      setShowTranscriptionConfig(true);
      return;
    }

    // Check for model selection
    const selectedModel = transcriptionConfig.geminiModel;
    if (!selectedModel || !selectedModel.startsWith("models/")) {
      message.error({
        content: (
          <div>
            <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
              {t("aiRefine.needModel")}
            </div>
            <div style={{ fontSize: "13px", lineHeight: "1.6" }}>
              <strong>{t("aiRefine.selectModelSteps")}</strong>
              <ol style={{ paddingLeft: "20px", margin: "8px 0" }}>
                <li>{t("aiRefine.modelStep1")}</li>
                <li>{t("aiRefine.modelStep2")}</li>
                <li>{t("aiRefine.modelStep3")}</li>
                <li>{t("aiRefine.modelStep4")}</li>
                <li>{t("aiRefine.modelStep5")}</li>
              </ol>
            </div>
          </div>
        ),
        duration: 10,
      });
      setShowTranscriptionConfig(true);
      return;
    }

    if (transcriptions.length === 0) {
      message.warning(t("aiRefine.noData"));
      return;
    }

    // Show warning modal with better design
    modal.confirm({
      title: (
        <div style={{ fontSize: "18px", fontWeight: "bold", color: "#ff4d4f" }}>
          {t("aiRefine.warningTitle")}
        </div>
      ),
      icon: <ExclamationCircleOutlined style={{ color: "#ff4d4f" }} />,
      width: 680,
      content: (
        <div style={{ fontSize: "14px", lineHeight: "1.8" }}>
          <div style={{ marginBottom: "16px" }}>
            <div
              style={{
                fontWeight: "bold",
                marginBottom: "8px",
                color: "#52c41a",
              }}
            >
              {t("aiRefine.willDo")}
            </div>
            <ul style={{ paddingLeft: "20px", margin: "0" }}>
              <li>{t("aiRefine.task1")}</li>
              <li>{t("aiRefine.task2")}</li>
              <li>{t("aiRefine.task3")}</li>
              <li>{t("aiRefine.task4")}</li>
            </ul>
          </div>

          <div
            style={{
              background: "#fff7e6",
              border: "2px solid #ffa940",
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "16px",
            }}
          >
            <div
              style={{
                fontWeight: "bold",
                marginBottom: "12px",
                color: "#fa8c16",
                fontSize: "15px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span style={{ fontSize: "20px" }}>⚠️</span>
              {t("aiRefine.securityTitle")}
            </div>

            <div style={{ marginBottom: "12px", color: "#595959" }}>
              {t("aiRefine.dataSentTo")}
            </div>

            <div
              style={{
                background: "#fff1f0",
                border: "1px solid #ffccc7",
                borderRadius: "6px",
                padding: "12px",
                marginBottom: "12px",
              }}
            >
              <div
                style={{
                  fontWeight: "bold",
                  marginBottom: "8px",
                  color: "#cf1322",
                }}
              >
                {t("aiRefine.noSensitive")}
              </div>
              <ul
                style={{ paddingLeft: "20px", margin: "0", color: "#595959" }}
              >
                <li>{t("aiRefine.sensitive1")}</li>
                <li>{t("aiRefine.sensitive2")}</li>
                <li>{t("aiRefine.sensitive3")}</li>
                <li>{t("aiRefine.sensitive4")}</li>
                <li>{t("aiRefine.sensitive5")}</li>
              </ul>
            </div>

            <div
              style={{
                fontStyle: "italic",
                color: "#8c8c8c",
                fontSize: "13px",
              }}
            >
              {t("aiRefine.reviewAdvice")}
            </div>
          </div>

          <div
            style={{
              background: "#e6f7ff",
              border: "1px solid #91d5ff",
              borderRadius: "6px",
              padding: "12px",
              fontSize: "13px",
              color: "#595959",
            }}
          >
            {t("aiRefine.replaceNote")}
          </div>
        </div>
      ),
      okText: t("aiRefine.confirmBtn"),
      cancelText: t("aiRefine.cancelBtn"),
      okButtonProps: {
        danger: false,
        type: "primary",
      },
      onOk: () => {
        // Get checkbox state before modal closes
        const checkboxElement = document.getElementById(
          "useRawTranscripts",
        ) as HTMLInputElement;
        const shouldUseRawData = checkboxElement
          ? checkboxElement.checked
          : false;
        // Do NOT await — modal must close immediately so user can interact with UI.
        // Progress is shown via non-blocking notification at bottom-right.
        void performAIRefinement(shouldUseRawData);
      },
    });
  };

  // Separate function to perform AI refinement
  const performAIRefinement = async (useRawData: boolean = false) => {
    const apiKeyToUse =
      transcriptionConfig!.geminiApiKey || transcriptionConfig!.apiKey;
    const selectedModel = transcriptionConfig!.geminiModel;

    if (!selectedModel) {
      message.error(t("aiRefine.noModelSelected"));
      return;
    }

    // Step 1: Check quota status (non-blocking — only block if exceeded)
    const hideCheckingMsg = message.loading(
      t("aiRefine.checkingQuota"),
      0,
    );
    try {
      const quotaStatus = await AIRefinementService.checkQuotaStatus(
        apiKeyToUse,
        selectedModel,
      );
      hideCheckingMsg();

      if (quotaStatus.status === "exceeded") {
        // Quota exceeded — notify and abort (non-blocking message, no modal)
        message.error({ content: t("aiRefine.quotaExceeded", { message: quotaStatus.message }), duration: 8 });
        return;
      }

      if (quotaStatus.status === "limited") {
        // Quota limited — warn but continue
        message.warning({
          content: t("aiRefine.quotaLimited", { message: quotaStatus.message }),
          duration: 6,
        });
      }
    } catch (error: any) {
      hideCheckingMsg();
      // Continue even if quota check fails
      message.warning({
        content: t("aiRefine.quotaCheckFailed"),
        duration: 3,
      });
    }

    // Step 2: Show progress as non-blocking notification at bottom-right (same as speech-to-text)
    let currentProgress = 0;
    let currentMessage = t("aiRefine.progressPrepare");
    const notificationKey = `ai-refine-${Date.now()}`;

    const updateProgressNotification = () => {
      notification.open({
        key: notificationKey,
        message: (
          <span
            style={{ fontSize: "16px", fontWeight: "bold", color: "#5046e4" }}
          >
            <span style={{ fontSize: "20px" }}>🤖</span> {t("aiRefine.progressTitle")}
          </span>
        ),
        description: (
          <div style={{ width: 320 }}>
            <div
              style={{
                padding: "12px 14px",
                background: "#eeecfd",
                border: "1px solid rgba(80,70,228,.20)",
                borderRadius: "8px",
                marginBottom: "10px",
              }}
            >
              <div
                style={{
                  marginBottom: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#111827",
                }}
              >
                {currentMessage}
              </div>
              <Progress
                percent={currentProgress}
                status={currentProgress === 100 ? "success" : "active"}
                strokeColor={{ "0%": "#5046e4", "100%": "#7c3aed" }}
                size="small"
              />
            </div>
            <div
              style={{ fontSize: "12px", color: "#6b7280", lineHeight: "1.5" }}
            >
              {t("aiRefine.progressRateLimit")}
            </div>
          </div>
        ),
        placement: "bottomRight",
        duration: 0,
        style: { width: 400 },
      });
    };

    const updateProgress = (progress: number) => {
      currentProgress = Math.floor(progress);
      if (progress < 10) {
        currentMessage = t("aiRefine.progressPrepare");
      } else if (progress < 30) {
        currentMessage = t("aiRefine.progressBatch");
      } else if (progress < 90) {
        const totalBatches = Math.ceil(transcriptions.length / 50);
        const currentBatch = Math.max(
          1,
          Math.floor((progress / 100) * totalBatches),
        );
        if (totalBatches > 1) {
          currentMessage = t("aiRefine.progressProcessing", { current: currentBatch, total: totalBatches, percent: Math.floor(progress) });
        } else {
          currentMessage = t("aiRefine.progressSending", { percent: Math.floor(progress) });
        }
      } else {
        currentMessage = t("aiRefine.progressDone");
      }
      updateProgressNotification();
    };

    updateProgressNotification();

    try {
      // Prepare raw data for supplementary reference
      let rawData: RawTranscriptData[] = [];
      if (useRawData && rawTranscripts && rawTranscripts.length > 0) {
        // Use saved raw data (preserves original Web Speech API output)
        rawData = rawTranscripts;
        console.log(
          "📦 Using saved raw transcripts as supplementary data:",
          rawData.length,
          "items",
        );
      } else {
        // No raw data available or user chose not to use it
        console.log(
          "ℹ️ Not using raw data - processing transcriptions only (faster, uses less tokens)",
        );
      }

      // Call AI refinement service with model selection
      // Primary data: transcriptions (user-edited, highest reliability)
      // Supplementary data: rawTranscripts (original Web Speech API output for reference)
      const refinedResult = await AIRefinementService.refineTranscripts(
        apiKeyToUse,
        transcriptions, // Primary data
        rawData, // Supplementary data
        selectedModel, // Pass required model name
        updateProgress,
        // fileManagerRef.current // Pass fileManager for debug logs
      );

      // Convert to TranscriptionResult format
      const refinedResults = AIRefinementService.convertToTranscriptionResults(
        refinedResult.segments,
        "Person1",
      );

      // Update transcriptions
      setTranscriptions(refinedResults);

      // Update summary if generated
      if (refinedResult.summary) {
        setGeminiSummary(refinedResult.summary);
        console.log("📝 Summary updated from AI refinement");
      }

      setHasUnsavedChanges(true);

      // Close progress notification
      notification.destroy(notificationKey);

      // ── Partial result: daily quota hit mid-way ──
      if (refinedResult.isPartial && refinedResult.partialWarning) {
        // Still saved everything refined so far — notify user clearly
        message.warning({
          content: t("aiRefine.partialSaved", { count: refinedResults.length }),
          duration: 6,
        });
        modal.warning({
          title: t("aiRefine.partialTitle"),
          width: 620,
          content: (
            <div style={{ fontSize: "14px", lineHeight: "1.8" }}>
              <div
                style={{
                  padding: "16px",
                  background: "#fffbe6",
                  border: "1px solid #ffe58f",
                  borderRadius: "8px",
                  marginBottom: "16px",
                  whiteSpace: "pre-line",
                  color: "#614700",
                }}
              >
                {refinedResult.partialWarning}
              </div>
              <div
                style={{
                  padding: "12px 16px",
                  background: "#f6ffed",
                  border: "1px solid #b7eb8f",
                  borderRadius: "6px",
                  color: "#135200",
                }}
              >
                {t("aiRefine.partialAutoSaved", { count: refinedResults.length })}
              </div>
            </div>
          ),
          okText: t("common.ok"),
        });
      } else {
        message.success(
          refinedResult.summary
            ? t("aiRefine.successMsgWithSummary", { count: refinedResults.length })
            : t("aiRefine.successMsg", { count: refinedResults.length })
        );
      }

      // Show truncation warning if detected
      if (refinedResult.isTruncated && refinedResult.truncationWarning) {
        modal.warning({
          title: t("aiRefine.truncTitle"),
          width: 600,
          content: (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  padding: "12px 16px",
                  background: "#fffbe6",
                  border: "1px solid #ffe58f",
                  borderRadius: "6px",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    color: "#d48806",
                    fontSize: "14px",
                    whiteSpace: "pre-line",
                  }}
                >
                  {refinedResult.truncationWarning}
                </div>
              </div>
              <div
                style={{ marginTop: 12, color: "#595959", fontSize: "13px" }}
              >
                <strong>{t("aiRefine.truncReceived", { count: refinedResults.length })}</strong>
              </div>
            </div>
          ),
          okText: t("common.close"),
        });
      }
    } catch (error: any) {
      notification.destroy(notificationKey);

      console.error("AI Refinement Error:", error);

      // Show detailed error modal for quota issues
      if (
        error.message.includes("quota") ||
        error.message.includes("429") ||
        error.message.includes("Vượt hạn mức")
      ) {
        modal.error({
          title: t("aiRefine.quotaExceededTitle"),
          width: 600,
          content: (
            <div style={{ fontSize: "14px", lineHeight: "1.8" }}>
              <div
                style={{
                  padding: "16px",
                  background: "#fff2f0",
                  border: "1px solid #ffccc7",
                  borderRadius: "8px",
                  marginBottom: "16px",
                  whiteSpace: "pre-wrap",
                  color: "#5c0011",
                }}
              >
                {error.message}
              </div>

              <div
                style={{
                  padding: "12px 16px",
                  background: "#e6f7ff",
                  border: "1px solid #91d5ff",
                  borderRadius: "6px",
                }}
              >
                <div
                  style={{
                    fontWeight: "bold",
                    marginBottom: "8px",
                    color: "#0050b3",
                  }}
                >
                  {t("aiRefine.quotaFreeInfo")}
                </div>
                <ul
                  style={{ margin: 0, paddingLeft: "20px", color: "#003a8c" }}
                >
                  <li>{t("aiRefine.quota1")}</li>
                  <li>{t("aiRefine.quota2")}</li>
                  <li><strong>{t("aiRefine.quota3")}</strong></li>
                  <li>{t("aiRefine.quota4")}</li>
                </ul>
              </div>
            </div>
          ),
          okText: t("common.ok"),
        });
      } else {
        // Regular error message
        message.error({
          content: t("aiRefine.errorMsg", { message: error.message }),
          duration: 8,
        });
      }
    }
  };

  return (
    <AntdApp>
      <div className="app-container">
        {/* Backup Restoration Dialog */}
        {showBackupDialog && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
            }}
          >
            <div
              style={{
                backgroundColor: "#1e1e1e",
                border: "2px solid #ffa500",
                borderRadius: "8px",
                padding: "24px",
                maxWidth: "500px",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.5)",
              }}
            >
              <h2 style={{ marginTop: 0, color: "#ffa500" }}>
                {t("backup.restoreTitle")}
              </h2>
              <p
                style={{
                  fontSize: "16px",
                  lineHeight: "1.6",
                  color: "#fffefecc",
                }}
              >
                {t("backup.detected", { age: backupAge !== null ? `${backupAge} phút` : "một lúc" })}
                <br />
                {t("backup.detectedReason")}
              </p>
              <p style={{ fontSize: "14px", color: "#fffefecc" }}>
                {t("backup.question")}
              </p>
              <div style={{ display: "flex", gap: "12px", marginTop: "20px" }}>
                <button
                  onClick={() => handleRestoreBackup()}
                  style={{
                    flex: 1,
                    padding: "12px 20px",
                    backgroundColor: "#1890ff",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "16px",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                >
                  {t("backup.doRestore")}
                </button>
                <button
                  onClick={handleDiscardBackup}
                  style={{
                    flex: 1,
                    padding: "12px 20px",
                    backgroundColor: "#434343",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "16px",
                    cursor: "pointer",
                  }}
                >
                  {t("backup.doDiscard")}
                </button>
              </div>
            </div>
          </div>
        )}

        <header className="app-header">
          <h1>{t("app.title")}</h1>
          <div className="status-indicator">
            {navigator.onLine ? t("app.online") : t("app.offline")}
            {hasUnsavedChanges && (
              <span
                className="unsaved-indicator"
                title={t("app.unsavedTitle")}
              >
                {t("app.unsaved")}
              </span>
            )}
            <LanguageSwitcher />
            <HelpButton />
          </div>
        </header>

        {/* Update Notification */}
        {showUpdateNotification && (
          <UpdateNotification
            onClose={() => setShowUpdateNotification(false)}
          />
        )}

        <MetadataPanel
          meetingInfo={meetingInfo}
          onChange={setMeetingInfo}
          hasSegments={transcriptions.length > 0}
          onConvertTimestamps={handleConvertTimestamps}
        />

        <RecordingControls
          folderPath={folderPath}
          onFolderSelect={setFolderPath}
          isRecording={isRecording}
          onRecordingChange={setIsRecording}
          onAudioBlobChange={handleAudioBlobChange}
          onSaveComplete={handleSaveComplete}
          onLoadProject={handleLoadProject}
          meetingInfo={meetingInfo}
          notes={notes}
          timestampMap={timestampMap}
          speakersMap={speakersMap}
          recordingStartTime={recordingStartTime}
          onRecordingStartTimeChange={setRecordingStartTime}
          audioBlob={audioBlob}
          isSaved={isSaved}
          hasUnsavedChanges={hasUnsavedChanges}
          onShowTranscriptionConfig={() => setShowTranscriptionConfig(true)}
          transcriptionConfig={transcriptionConfig}
          shouldBlink={!transcriptionConfig}
          onNewTranscription={handleNewTranscription}
          transcriptions={transcriptions}
          geminiSummary={geminiSummary}
          onFileManagerReady={(fm) => {
            fileManagerRef.current = fm;
          }}
          onAudioStreamChange={setAudioStream}
          onAudioSourceChange={setAudioSourceType}
          onTranscribingChange={setIsTranscribingActive}
          onTranscriptionConfigChange={setTranscriptionConfig}
        />

        {/* Live Waveform - Show when recording */}
        <LiveWaveform
          audioStream={audioStream}
          isRecording={isRecording}
          audioSourceType={audioSourceType}
        />

        {/* Meeting Summary Panel - Always show to allow manual input */}
        <MeetingSummaryPanel
          summary={geminiSummary || ""}
          onSummaryChange={setGeminiSummary}
          onMarkUnsaved={() => setHasUnsavedChanges(true)}
        />
        {/* Transcription Panel - Show when has transcriptions OR (online and configured for real-time) */}
        {(transcriptions.length > 0 || (isOnline && transcriptionConfig)) && (
          <TranscriptionPanel
            transcriptions={transcriptions}
            isTranscribing={isTranscribingActive}
            isOnline={isOnline}
            onSeekAudio={handleSeekToAudio}
            onEditTranscription={handleEditTranscription}
            onAIRefine={handleAIRefine}
            canRefineWithAI={
              !isRecording &&
              transcriptions.length > 0 &&
              (!!transcriptionConfig?.geminiApiKey ||
                !!transcriptionConfig?.apiKey) &&
              !!transcriptionConfig?.geminiModel &&
              isOnline
            }
          />
        )}

        <NotesEditor
          notes={notes}
          onNotesChange={setNotes}
          timestampMap={timestampMap}
          onTimestampMapChange={setTimestampMap}
          recordingStartTime={recordingStartTime}
          isLiveMode={isLiveMode}
          onSpeakersChange={setSpeakersMap}
          initialSpeakers={speakersMap}
          timestampDelay={transcriptionConfig?.timestampDelay || 8}
        />

        <AudioPlayer
          ref={audioPlayerRef}
          audioBlob={audioBlob}
          transcriptionConfig={transcriptionConfig}
          onWaveformReady={() => onWaveformReadyRef.current?.()}
          onWaveformError={(err) => onWaveformErrorRef.current?.(err)}
        />

        {/* Transcription Configuration Modal */}
        <TranscriptionConfig
          visible={showTranscriptionConfig}
          onClose={() => setShowTranscriptionConfig(false)}
          onSave={handleSaveTranscriptionConfig}
          currentConfig={transcriptionConfig}
          updateConfig={updateConfig}
          onUpdateConfigChange={handleUpdateConfigChange}
        />
      </div>
    </AntdApp>
  );
};
