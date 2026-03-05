import React, { useState, useEffect, useRef, useCallback } from "react";
import { MetadataPanel } from "./components/MetadataPanel";
import { RecordingControls } from "./components/RecordingControls";
import { NotesEditor } from "./components/NotesEditor";
import { AudioPlayer, AudioPlayerRef } from "./components/AudioPlayer";
import { LiveWaveform } from "./components/LiveWaveform";
import { HelpButton } from "./components/HelpButton";
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
} from "./services/aiRefinement";
import { updateManager, UpdateManagerService } from "./services/updateManager";
import type {
  MeetingInfo,
  SpeechToTextConfig,
  TranscriptionResult,
} from "./types/types";
import { message, App as AntdApp, Progress } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import "./styles/global.css";

export const App: React.FC = () => {
  const { modal, notification } = AntdApp.useApp();
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
              warningMessage = `Bạn đang sử dụng ${browserName} trên ${deviceType}. Để có trải nghiệm tốt nhất với tính năng nhận dạng giọng nói, chúng tôi khuyến nghị sử dụng Google Chrome trên máy tính/laptop.`;
            } else if (!isChrome) {
              warningMessage = `Bạn đang sử dụng ${browserName}. Để có trải nghiệm tốt nhất với tính năng nhận dạng giọng nói, chúng tôi khuyến nghị sử dụng Google Chrome trên máy tính/laptop.`;
            } else if (!isDesktop) {
              warningMessage = `Bạn đang sử dụng thiết bị ${deviceType}. Để có trải nghiệm tốt nhất với tính năng nhận dạng giọng nói, chúng tôi khuyến nghị sử dụng Google Chrome trên máy tính/laptop.`;
            }

            if (warningMessage) {
              modal.info({
                title: "💡 Khuyến nghị trình duyệt & thiết bị",
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
                      <strong>Lý do:</strong> Các thuật toán nhận dạng giọng nói
                      đã được tối ưu hóa cho Web Speech API của Google Chrome
                      trên máy tính, mang lại độ chính xác và hiệu suất cao
                      nhất.
                    </p>
                  </div>
                ),
                okText: "Đã hiểu",
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
        message.info("Không có segments để convert");
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
        `✅ Đã convert ${convertedCount}/${transcriptions.length} segments`,
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
          ⚠️ File audio quá lớn
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
              <strong>📊 Thông tin file:</strong>
              <br />• Thời lượng:{" "}
              <span style={{ fontWeight: "bold" }}>
                {durationMinutes}:{String(durationSeconds).padStart(2, "0")}
              </span>{" "}
              (≈ {Math.ceil(audioDurationSec / 60)} phút)
              <br />• Kích thước hiện tại:{" "}
              <span style={{ color: "#fa8c16", fontWeight: "bold" }}>
                {fileSizeMB.toFixed(2)} MB
              </span>
              <br />• Giới hạn Gemini:{" "}
              <span style={{ color: "#52c41a", fontWeight: "bold" }}>
                ≤ {maxSizeMB} MB
              </span>{" "}
              và{" "}
              <span style={{ color: "#52c41a", fontWeight: "bold" }}>
                ≤ {maxDurationMinutes} phút
              </span>
            </div>
            <div style={{ fontSize: "13px", color: "#666" }}>
              💡 File vượt quá giới hạn của Gemini API
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
            🎯 Chọn phương án xử lý:
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
              <span style={{ fontSize: "20px" }}>🤖</span> Phương án 1: Chuyển
              đổi toàn bộ file (Tự động)
            </div>
            <div style={{ fontSize: "13px", color: "#666", lineHeight: "1.6" }}>
              • Hệ thống tự động chia file thành các phần nhỏ (≤ {maxSizeMB}MB)
              <br />
              • Gửi lần lượt đến Gemini AI (tuân thủ 15 req/min, 1500 req/day)
              <br />
              • Tự động gộp và sắp xếp kết quả theo timeline
              <br />•{" "}
              <strong style={{ color: "#52c41a" }}>✅ Khuyên dùng:</strong> Tiết
              kiệm thời gian, xử lý toàn bộ nội dung
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
              <span style={{ fontSize: "20px" }}>✂️</span> Phương án 2: Chọn
              đoạn thủ công
            </div>
            <div style={{ fontSize: "13px", color: "#666", lineHeight: "1.6" }}>
              • Bạn tự chọn khoảng thời gian cụ thể cần chuyển đổi
              <br />
              • Phù hợp khi chỉ cần transcribe một phần quan trọng
              <br />
              • Tiết kiệm quota API nếu chỉ cần xử lý đoạn ngắn
              <br />• Có thể chọn nhiều đoạn khác nhau trong cùng file
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
            <strong>💡 Gợi ý:</strong> Nếu cần toàn bộ nội dung cuộc họp, chọn
            Phương án 1. Nếu chỉ cần một phần, chọn Phương án 2.
          </div>
        </div>
      ),
      okText: "Đóng",
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
          ✂️ Chọn đoạn cần chuyển đổi
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
              <strong>📊 Thông tin file:</strong>
              <br />• Kích thước:{" "}
              <span style={{ fontWeight: "bold" }}>
                {fileSizeMB.toFixed(2)} MB
              </span>{" "}
              / {maxSizeMB} MB
              <br />• Thời lượng:{" "}
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
            🎵 <strong>Mẹo:</strong> Phát audio và pause ở vị trí muốn chọn, rồi
            xem thời gian trên audio player để nhập chính xác!
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
              ⏱️ Thời gian bắt đầu (phút:giây)
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
              ⏱️ Thời gian kết thúc (phút:giây)
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
            <strong>📝 Lưu ý:</strong> Kết quả sẽ được gắn timestamp chính xác
            theo thời gian bạn chọn
          </div>
        </div>
      ),
      okText: "✂️ Chuyển đổi đoạn đã chọn",
      cancelText: "Quay lại",
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
      message.error("Vui lòng cấu hình Gemini API Key và Model trong Settings");
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
          title: "⚠️ Audio rất dài",
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
                  <strong>Thông tin:</strong>
                  <br />• Thời lượng: <strong>{durationMinutes} phút</strong>
                  <br />• Số phần ước tính:{" "}
                  <strong>
                    ~{Math.ceil(durationMinutes / maxDurationMinutes)} phần
                  </strong>
                  <br />• Thời gian xử lý:{" "}
                  <strong>
                    ~{Math.ceil(durationMinutes / 10)}-
                    {Math.ceil(durationMinutes / 5)} phút
                  </strong>
                  <br />• Delay giữa các phần:{" "}
                  <strong>{requestDelaySeconds}s</strong>
                  <br />
                  <br />
                  <strong style={{ color: "#ff7a45" }}>Lưu ý:</strong>
                  <br />
                  • Quá trình này sẽ mất khá nhiều thời gian
                  <br />
                  • Tốn nhiều token API (audio dài)
                  <br />• Vui lòng không đóng trình duyệt trong lúc xử lý
                </div>
              </div>
              <div style={{ fontSize: "13px", color: "#666" }}>
                <strong>💡 Gợi ý:</strong> Nếu chỉ cần tóm tắt một phần, hãy
                chọn "Chuyển đổi đoạn đã chọn" và chọn khoảng thời gian ngắn
                hơn.
              </div>
            </div>
          ),
          okText: "✅ Tiếp tục xử lý",
          cancelText: "Hủy",
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });

      if (!confirmed) return;
    }

    // Create progress notification at bottom-right (non-blocking)
    let currentProgress = 0;
    let currentMessage = "🚀 Đang bắt đầu...";
    const notificationKey = `gemini-auto-split-${Date.now()}`;

    const updateProgressNotification = () => {
      notification.open({
        key: notificationKey,
        message: (
          <span
            style={{ fontSize: "16px", fontWeight: "bold", color: "#667eea" }}
          >
            <span style={{ fontSize: "20px" }}>🤖</span> Xử lý toàn bộ file
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
          currentMessage = msg || "⏳ Đang xử lý...";

          // Update notification
          updateProgressNotification();
        },
        maxFileSizeMB,
        requestDelaySeconds,
        maxDurationMinutes,
        meetingStartTime,
        config.summaryPrompt,
        fileManagerRef.current, // Pass fileManager for debug logs
      );

      // Close progress notification on success
      notification.destroy(notificationKey);

      // Show success message
      message.success("✅ Gemini xử lý hoàn tất!");

      // Save summary
      if (parsed.summary) {
        console.log("📋 Received summary from Gemini:", parsed.summary);
        setGeminiSummary(parsed.summary);
      }

      // Show truncation warning if detected
      if (parsed.isTruncated && parsed.truncationWarning) {
        modal.warning({
          title: "⚠️ Cảnh báo: Kết quả bị cắt ngắn",
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
                <strong>Kết quả nhận được:</strong> {parsed.results.length}{" "}
                segments
              </div>
            </div>
          ),
          okText: "Đóng",
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
            ? "⚠️ Phát hiện nội dung có bản quyền"
            : "⚠️ Nội dung bị từ chối",
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
          okText: "Đóng",
        });
        console.warn("Auto-split policy violation:", error);
        return;
      }

      // Show error modal (red) for other errors
      modal.error({
        title: "❌ Lỗi chuyển đổi",
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
        okText: "Đóng",
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
      message.error("Thiếu thông tin cần thiết");
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
        throw new Error("Định dạng thời gian không hợp lệ");
      }
      const minutes = parseInt(parts[0]);
      const seconds = parseInt(parts[1]);
      if (isNaN(minutes) || isNaN(seconds)) {
        throw new Error("Thời gian phải là số");
      }
      return (minutes * 60 + seconds) * 1000; // Convert to milliseconds
    };

    try {
      const startMs = parseTime(startTimeInput.value);
      const endMs = parseTime(endTimeInput.value);

      if (startMs >= endMs) {
        message.error("Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc");
        return;
      }

      if (endMs > audioDurationMs) {
        message.error(
          `Thời gian kết thúc không được vượt quá ${durationMinutes}:${String(durationSeconds).padStart(2, "0")}`,
        );
        return;
      }

      // Show processing modal
      const hideLoading = message.loading("✂️ Đang cắt đoạn audio...", 0);

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
          "🤖 Đang chuyển đổi đoạn audio...",
          0,
        );

        try {
          const maxFileSizeMB = config.maxFileSizeMB || 150;
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
              title: "⚠️ Cảnh báo: Kết quả bị cắt ngắn",
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
              okText: "Đóng",
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
                ? "⚠️ Phát hiện nội dung có bản quyền"
                : "⚠️ Nội dung bị từ chối",
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
              okText: "Đóng",
            });
            console.warn("Manual segment policy violation:", error);
            return;
          }

          // Show error message for other errors
          message.error(`Lỗi chuyển đổi: ${error.message}`);
          console.error("Transcription error:", error);
        }
      } catch (error: any) {
        hideLoading();
        message.error(`Lỗi cắt audio: ${error.message}`);
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
              📊 Kết quả chuyển đổi:
            </div>
            <div style={{ fontSize: "14px" }}>
              🤖 {newResults.length} đoạn văn bản từ Gemini AI
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
            💾 Chọn cách xử lý dữ liệu:
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
              <span style={{ fontSize: "20px" }}>🔄</span> Gộp vào dữ liệu hiện
              tại
            </div>
            <div style={{ fontSize: "13px", color: "#666", lineHeight: "1.6" }}>
              • Giữ nguyên {transcriptions.length} đoạn cũ
              <br />• Thêm {newResults.length} đoạn mới từ AI
              <br />
              • Tự động sắp xếp theo thời gian (timeline)
              <br />•{" "}
              <strong style={{ color: "#52c41a" }}>✅ Khuyên dùng:</strong> Khi
              bạn đã có transcription và muốn bổ sung
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
              <span style={{ fontSize: "20px" }}>🔁</span> Thay thế toàn bộ dữ
              liệu cũ
            </div>
            <div style={{ fontSize: "13px", color: "#666", lineHeight: "1.6" }}>
              •{" "}
              <strong style={{ color: "#fa8c16" }}>
                ⚠️ Xóa {transcriptions.length} đoạn cũ
              </strong>
              <br />• Chỉ giữ lại {newResults.length} đoạn mới từ AI
              <br />
              • Dùng khi transcription cũ kém chất lượng
              <br />• <strong style={{ color: "#ff4d4f" }}>
                Cảnh báo:
              </strong>{" "}
              Không thể hoàn tác!
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
            💡 <strong>Gợi ý:</strong> Nếu bạn chưa chắc, hãy chọn "Gộp" để
            không mất dữ liệu cũ.
          </div>
        </div>
      ),
      okText: "🔄 Gộp vào dữ liệu cũ",
      cancelText: "🔁 Thay thế toàn bộ",
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
          `✅ Đã gộp ${newResults.length} đoạn mới vào dữ liệu (tổng: ${transcriptions.length + newResults.length})`,
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
          `✅ Đã thay thế toàn bộ dữ liệu cũ bằng ${newResults.length} đoạn mới từ AI`,
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
        message.error("Chưa có audio để chuyển đổi");
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
        maxFileSizeMB = config?.maxFileSizeMB || 150;
      } else {
        // Fallback to getting from settings
        const config = speechToTextService.getConfig();
        apiKey = config?.geminiApiKey;
        modelName = config?.geminiModel;
        maxDurationMinutes = config?.maxAudioDurationMinutes || 30;
        maxFileSizeMB = config?.maxFileSizeMB || 150;
      }

      // Check if API key is provided
      if (!apiKey || apiKey.trim().length === 0) {
        modal.error({
          title: "⚠️ Thiếu Gemini API Key",
          content: (
            <div style={{ marginTop: 16 }}>
              <p>
                Vui lòng thêm <strong>Gemini API Key</strong> trong Settings
                trước khi sử dụng tính năng này.
              </p>
              <div
                style={{
                  marginTop: "12px",
                  padding: "12px",
                  background: "#f0f5ff",
                  borderRadius: "6px",
                }}
              >
                <strong>Hướng dẫn lấy API Key:</strong>
                <br />
                1️⃣ Truy cập:{" "}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  https://aistudio.google.com/app/apikey
                </a>
                <br />
                2️⃣ Đăng nhập với Google Account
                <br />
                3️⃣ Click "Create API Key"
                <br />
                4️⃣ Copy và paste vào Settings
              </div>
            </div>
          ),
          okText: "Đã hiểu",
        });
        return;
      }

      // Validate model is selected
      if (!modelName || !modelName.startsWith("models/")) {
        modal.error({
          title: "⚠️ Chưa chọn Gemini Model",
          content: (
            <div style={{ marginTop: 16 }}>
              <p>
                Vui lòng chọn <strong>Gemini Model</strong> trong Settings.
              </p>
              <div
                style={{
                  marginTop: "12px",
                  padding: "12px",
                  background: "#f0f5ff",
                  borderRadius: "6px",
                }}
              >
                <strong>Các bước:</strong>
                <br />
                1️⃣ Mở Settings → Nhập API Key
                <br />
                2️⃣ Chờ hệ thống tải danh sách models
                <br />
                3️⃣ Chọn model từ dropdown (khuyên dùng: Gemini 2.5 Flash)
                <br />
                4️⃣ Lưu và thử lại
              </div>
            </div>
          ),
          okText: "Đã hiểu",
        });
        return;
      }

      // Check audio duration (if available)
      const audioDurationMs = audioPlayerRef.current?.getDuration() || 0;
      const durationMinutes = Math.floor(audioDurationMs / 60000);

      if (audioDurationMs === 0) {
        message.warning(
          "Không thể xác định thời lượng audio. Đang thử chuyển đổi...",
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
            <span style={{ fontSize: "24px" }}></span>Gemini AI có thể đưa ra
            thông tin không chính xác, HÃY THẬN TRỌNG!!!
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
                    🤖 Audio dài ({durationMinutes} phút) - Tự động xử lý thông
                    minh
                  </strong>
                  <br />
                  <br />
                  <strong style={{ color: "#1890ff" }}>
                    ✨ Hệ thống sẽ tự động:
                  </strong>
                  <br />• 📦 Chia file thành các phần nhỏ (≤{" "}
                  {maxDurationMinutes}p hoặc ≤ {maxFileSizeMB}MB/phần)
                  <br />
                  • 🔄 Xử lý tuần tự từng phần với Gemini AI
                  <br />
                  • 🧩 Tự động ghép kết quả theo timeline
                  <br />
                  • 📝 Tổng hợp tóm tắt hoàn chỉnh
                  <br />
                  <br />
                  <strong style={{ color: "#0050b3" }}>
                    ⏱️ Thời gian dự kiến:
                  </strong>
                  <br />• Khoảng {Math.ceil(durationMinutes / 15)}-
                  {Math.ceil(durationMinutes / 10)} phút để xử lý toàn bộ
                  <br />
                  • Có delay 5s giữa các phần (tuân thủ rate limit)
                  <br />
                  • Bạn có thể theo dõi tiến trình trực tiếp
                  <br />
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
                <strong>🎯 Thông tin chuyển đổi:</strong>
                <br />• Model:{" "}
                <span style={{ fontWeight: "bold", color: "#667eea" }}>
                  {modelName.replace("models/", "")}
                </span>
                <br />• Kích thước file gốc:{" "}
                <span style={{ fontWeight: "bold" }}>
                  {(audioBlob.size / (1024 * 1024)).toFixed(2)} MB
                </span>
                <br />
                {audioDurationMs > 0 && (
                  <>
                    • Thời lượng:{" "}
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
                    ✨ Lợi ích của Gemini AI:
                  </strong>
                  <br />
                  • Độ chính xác cao hơn Web Speech API
                  <br />
                  • Tự động phân biệt người nói
                  <br />
                  • Làm sạch văn bản (loại bỏ từ đệm, sửa lỗi)
                  <br />• Hỗ trợ tiếng Việt tốt hơn
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
              <strong>⏳ Thời gian xử lý:</strong>{" "}
              {isLongAudio
                ? `Khoảng ${Math.ceil(durationMinutes / 15)}-${Math.ceil(durationMinutes / 10)} phút (tự động chia nhỏ)`
                : "Tùy thuộc vào độ dài audio (khoảng 1-3 phút cho file 10-20 phút)"}
              <br />
              <strong>💰 Chi phí:</strong> Gemini API miễn phí cho mục đích cá
              nhân (250K tokens/ngày)
              {isLongAudio && (
                <>
                  <br />
                  <strong style={{ color: "#1890ff" }}>
                    ℹ️ Audio dài sẽ được xử lý thông minh, an toàn!
                  </strong>
                </>
              )}
            </div>
          </div>
        ),
        okText: isLongAudio
          ? "🤖 Bắt đầu (Tự động chia nhỏ)"
          : "🚀 Bắt đầu chuyển đổi",
        cancelText: "Hủy",
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
            let progressMessage = "Đang khởi tạo...";
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
                  <span style={{ fontSize: "20px" }}>🤖</span> Gemini AI
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
              const maxFileSizeMB = config?.maxFileSizeMB || 150;
              const maxDurationMinutes = config?.maxAudioDurationMinutes || 30;
              const meetingStartTime = getValidMeetingStartTime();

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
                          <span style={{ fontSize: "20px" }}>🤖</span> Gemini AI
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
                );

              // Close progress notification on success
              notification.destroy(notificationKey);

              // Show success message
              message.success("✅ Gemini xử lý hoàn tất!");

              // Save summary if available
              if (parsed.summary) {
                console.log("📋 Received summary:", parsed.summary);
                setGeminiSummary(parsed.summary);
              }

              // Show truncation warning if detected
              if (parsed.isTruncated && parsed.truncationWarning) {
                modal.warning({
                  title: "⚠️ Cảnh báo: Kết quả bị cắt ngắn",
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
                  okText: "Đóng",
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
                    ? "⚠️ Phát hiện nội dung có bản quyền"
                    : "⚠️ Vấn đề về an toàn nội dung",
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
                        <strong>ℹ️ Thông tin:</strong>
                        <br />
                        Đây là cơ chế bảo vệ tự động của Google Gemini API để
                        tuân thủ chính sách nội dung và luật bản quyền.
                      </div>
                    </div>
                  ),
                  okText: "Đã hiểu",
                  okButtonProps: { size: "large" },
                });
                return;
              }

              // Show error modal for other errors
              modal.error({
                title: "❌ Lỗi chuyển đổi",
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
                        <strong>Chi tiết lỗi:</strong>
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
                      <strong>💡 Gợi ý khắc phục:</strong>
                      <ul style={{ marginTop: "8px", paddingLeft: "20px" }}>
                        <li>Kiểm tra kết nối internet</li>
                        <li>Xác nhận Gemini API Key còn hợp lệ</li>
                        <li>Thử lại với file audio nhỏ hơn</li>
                        <li>Kiểm tra Console để xem chi tiết lỗi</li>
                      </ul>
                    </div>
                  </div>
                ),
                okText: "Đã hiểu",
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
    setSavedNotesSnapshot(notes); // Save snapshot to detect future changes
    setSavedSpeakersSnapshot(new Map(speakersMap)); // Save speakers snapshot
    setSavedTranscriptionsSnapshot([...transcriptions]); // Save transcriptions snapshot
    setSavedMeetingInfoSnapshot({ ...meetingInfo }); // Save meetingInfo snapshot
    // Clear auto-backup after successful save
    clearBackup();
  };

  const handleRestoreBackup = async (skipAudio = false) => {
    const NOTIF_KEY = "restore-progress";

    // Helper: update the bottom-right progress notification
    const showProgress = (percent: number, step: string) => {
      notification.open({
        key: NOTIF_KEY,
        message: "🔄 Đang khôi phục dữ liệu tự động lưu",
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

    // ── If audio exists and not yet decided to skip, check size first
    if (!skipAudio) {
      const audioInfo = await getBackupAudioInfo();
      // Warn when estimated duration > 45 min:
      // WaveSurfer will need ~450 MB RAM to decode the waveform
      const WARN_DURATION_MIN = 45;
      if (
        (audioInfo.chunkCount > 0 || audioInfo.hasMonolithicBlob) &&
        audioInfo.estimatedDurationMin > WARN_DURATION_MIN
      ) {
        // Use modal.info with custom footer buttons so closing by X/ESC
        // does NOT accidentally trigger a partial restore (onCancel side-effect)
        const modalRef = modal.info({
          title: "⚠️ File ghi âm lớn — nguy cơ thiếu RAM",
          content: (
            <div>
              <p>
                File ghi âm ước tính{" "}
                <strong>~{audioInfo.estimatedDurationMin} phút</strong>. Khi tải
                toàn bộ, WaveSurfer cần giải mã âm thanh và có thể dùng{" "}
                <strong>
                  ~{Math.round(audioInfo.estimatedDurationMin * 11)} MB RAM
                </strong>
                , dễ gây treo tab trên các máy ít bộ nhớ.
              </p>
              <p style={{ marginTop: 8 }}>Bạn muốn khôi phục thế nào?</p>
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
                }}
              >
                ❌ Hủy
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
                  handleRestoreBackup(true);
                }}
              >
                📝 Chỉ ghi chú
              </button>
              <button
                style={{
                  padding: "6px 14px",
                  backgroundColor: "#1890ff",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 4,
                }}
                onClick={() => {
                  modalRef.destroy();
                  handleRestoreBackup(false);
                }}
              >
                🎵 Khôi phục đầy đủ
              </button>
            </div>
          ),
        });
        return; // wait for user choice
      }
    }

    showProgress(0, "Đang bắt đầu khôi phục...");
    const backup = await loadBackup({
      skipAudio,
      onProgress: (pct, step) => showProgress(pct, step),
    });
    if (backup) {
      console.log("🔍 Backup data structure:", {
        hasAudioBlob: !!backup.audioBlob,
        audioBlobSize: backup.audioBlob?.size || 0,
        transcriptionsCount: backup.transcriptions?.length || 0,
        rawTranscriptsCount: backup.rawTranscripts?.length || 0,
        hasSummary: !!backup.geminiSummary,
        summaryLength: backup.geminiSummary?.length || 0,
      });

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
      if (backup.audioBlob) {
        setAudioBlob(backup.audioBlob);
      }
      setIsSaved(backup.isSaved);

      // Restore transcriptions and rawTranscripts if available
      if (backup.transcriptions && backup.transcriptions.length > 0) {
        setTranscriptions(backup.transcriptions);
      } else {
        setTranscriptions([]); // Clear if no transcriptions in backup
      }
      if (backup.rawTranscripts && backup.rawTranscripts.length > 0) {
        setRawTranscripts(backup.rawTranscripts);
      } else {
        setRawTranscripts([]); // Clear if no raw transcripts in backup
      }

      // Restore geminiSummary if available
      if (backup.geminiSummary) {
        setGeminiSummary(backup.geminiSummary);
      } else {
        setGeminiSummary(""); // Clear if no summary in backup
      }

      // Update snapshots and unsaved changes flag
      setHasUnsavedChanges(!backup.isSaved);
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
      // Switch to playback mode (not live recording) after restoring
      if (backup.audioBlob) {
        setIsLiveMode(false);
      }
      notification.open({
        key: "restore-progress",
        message: "✅ Khôi phục hoàn tất",
        description: (
          <div>
            <div style={{ marginBottom: 6, color: "#595959", fontSize: 13 }}>
              {backup.audioBlob
                ? "Đã khôi phục ghi chú và file ghi âm."
                : "Đã khôi phục ghi chú (không có audio)."}
            </div>
            <Progress percent={100} size="small" status="success" />
          </div>
        ),
        placement: "bottomRight",
        duration: 3,
        closable: true,
      });
      console.log("✅ Backup restored successfully:", {
        speakersMapSize: backup.speakersMap.size,
        transcriptionsRestored: backup.transcriptions?.length || 0,
        audioRestored: !!backup.audioBlob,
      });
    } else {
      // loadBackup returned null (no data or parse error) — close the progress notification
      notification.destroy("restore-progress");
    }
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
          title: "🗑️ Xóa segment này?",
          icon: <ExclamationCircleOutlined style={{ color: "#ff4d4f" }} />,
          content: (
            <div style={{ fontSize: "14px", lineHeight: "1.6" }}>
              <p>Bạn đã xóa toàn bộ nội dung của segment này.</p>
              <p style={{ marginBottom: "8px" }}>Bạn muốn:</p>
              <ul style={{ paddingLeft: "20px", margin: "0" }}>
                <li>
                  <strong>Xóa segment:</strong> Segment này sẽ bị xóa hoàn toàn
                  khỏi danh sách
                </li>
                <li>
                  <strong>Hủy bỏ:</strong> Giữ nguyên segment gốc (không lưu
                  thay đổi)
                </li>
              </ul>
            </div>
          ),
          okText: "Xóa segment",
          cancelText: "Hủy bỏ",
          okButtonProps: {
            danger: true,
          },
          onOk: () => {
            // Remove the segment
            setTranscriptions((prev) => prev.filter((item) => item.id !== id));
            setHasUnsavedChanges(true);
            message.success("✅ Đã xóa segment");
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
      message.warning("Vui lòng cấu hình Speech-to-Text Settings trước");
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
              Cần Gemini API Key để sử dụng tính năng AI
            </div>
            <div style={{ fontSize: "13px", lineHeight: "1.6" }}>
              <strong>Cách lấy API Key miễn phí:</strong>
              <ol style={{ paddingLeft: "20px", margin: "8px 0" }}>
                <li>
                  Truy cập:{" "}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                  >
                    Google AI Studio
                  </a>
                </li>
                <li>Click "Create API Key"</li>
                <li>Copy API key và paste vào Settings → Gemini API Key</li>
                <li>Hệ thống sẽ tự động tải danh sách models</li>
                <li>Chọn model (khuyên dùng: Gemini 2.5 Flash)</li>
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
              Vui lòng chọn Gemini Model trong Settings
            </div>
            <div style={{ fontSize: "13px", lineHeight: "1.6" }}>
              <strong>Các bước:</strong>
              <ol style={{ paddingLeft: "20px", margin: "8px 0" }}>
                <li>Mở Settings</li>
                <li>Nhập Gemini API Key (nếu chưa có)</li>
                <li>Đợi hệ thống tải danh sách models</li>
                <li>Chọn model từ dropdown (khuyên dùng: Gemini 2.5 Flash)</li>
                <li>Lưu và thử lại</li>
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
      message.warning("Không có dữ liệu chuyển đổi để chuẩn hóa");
      return;
    }

    // Show warning modal with better design
    modal.confirm({
      title: (
        <div style={{ fontSize: "18px", fontWeight: "bold", color: "#ff4d4f" }}>
          🤖 Gemini AI có thể đưa ra thông tin không chính xác, HÃY THẬN
          TRỌNG!!!
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
              ✨ AI sẽ thực hiện:
            </div>
            <ul style={{ paddingLeft: "20px", margin: "0" }}>
              <li>Sửa lỗi nhận diện từ Web Speech API</li>
              <li>Loại bỏ từ thừa, từ đệm (à, ừm, thì...)</li>
              <li>Thêm dấu câu và viết hoa đúng quy tắc</li>
              <li>Gộp các đoạn liên quan thành câu hoàn chỉnh</li>
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
              CẢNH BÁO QUAN TRỌNG VỀ BẢO MẬT
            </div>

            <div style={{ marginBottom: "12px", color: "#595959" }}>
              Dữ liệu của bạn sẽ được <strong>gửi đến Google Gemini API</strong>{" "}
              để xử lý.
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
                🚫 KHÔNG sử dụng với thông tin nhạy cảm
              </div>
              <ul
                style={{ paddingLeft: "20px", margin: "0", color: "#595959" }}
              >
                <li>
                  <strong>Tài chính:</strong> Mật khẩu, số tài khoản, số thẻ,
                  giao dịch ngân hàng
                </li>
                <li>
                  <strong>Y tế:</strong> Bệnh án, đơn thuốc, kết quả xét nghiệm
                </li>
                <li>
                  <strong>Cá nhân:</strong> CCCD/CMND, địa chỉ, số điện thoại
                  nhạy cảm
                </li>
                <li>
                  <strong>Doanh nghiệp:</strong> Bí mật thương mại, kế hoạch
                  kinh doanh, các nội dung mật khác
                </li>
                <li>
                  <strong>Bảo mật:</strong> API keys, tokens, credentials
                </li>
              </ul>
            </div>

            <div
              style={{
                fontStyle: "italic",
                color: "#8c8c8c",
                fontSize: "13px",
              }}
            >
              💡 Khuyến nghị: Hãy xem lại nội dung transcript trước khi sử dụng
              chức năng này
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
            <strong>ℹ️ Lưu ý:</strong> Quá trình này sẽ thay thế toàn bộ kết quả
            hiện tại. Bạn có thể chỉnh sửa lại sau nếu cần.
          </div>
        </div>
      ),
      okText: "Đồng ý, tiếp tục",
      cancelText: "Hủy bỏ",
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
      message.error("Model không được chọn. Vui lòng cấu hình lại.");
      return;
    }

    // Step 1: Check quota status (non-blocking — only block if exceeded)
    const hideCheckingMsg = message.loading(
      "🔍 Đang kiểm tra hạn mức API Key...",
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
        message.error({ content: `🚫 ${quotaStatus.message}`, duration: 8 });
        return;
      }

      if (quotaStatus.status === "limited") {
        // Quota limited — warn but continue
        message.warning({
          content: `⚠️ ${quotaStatus.message}. Hệ thống sẽ tự động chia nhỏ để tối ưu quota.`,
          duration: 6,
        });
      }
    } catch (error: any) {
      hideCheckingMsg();
      // Continue even if quota check fails
      message.warning({
        content: "Không thể kiểm tra quota, sẽ tiếp tục xử lý...",
        duration: 3,
      });
    }

    // Step 2: Show progress as non-blocking notification at bottom-right (same as speech-to-text)
    let currentProgress = 0;
    let currentMessage = "🚀 Đang bắt đầu...";
    const notificationKey = `ai-refine-${Date.now()}`;

    const updateProgressNotification = () => {
      notification.open({
        key: notificationKey,
        message: (
          <span
            style={{ fontSize: "16px", fontWeight: "bold", color: "#5046e4" }}
          >
            <span style={{ fontSize: "20px" }}>🤖</span> AI chuẩn hóa văn bản
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
              💡 Đang xử lý từng batch với delay để tuân thủ rate limit
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
        currentMessage = "⏳ Đang chuẩn bị dữ liệu...";
      } else if (progress < 30) {
        currentMessage = "📦 Đang chia batches để tối ưu quota...";
      } else if (progress < 90) {
        const totalBatches = Math.ceil(transcriptions.length / 50);
        const currentBatch = Math.max(
          1,
          Math.floor((progress / 100) * totalBatches),
        );
        if (totalBatches > 1) {
          currentMessage = `🔄 Đang xử lý batch ${currentBatch}/${totalBatches}... (${Math.floor(progress)}%)`;
        } else {
          currentMessage = `📡 Đang gửi đến AI... ${Math.floor(progress)}%`;
        }
      } else {
        currentMessage = "✅ Hoàn thành!";
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
          content: `⚠️ Đã lưu ${refinedResults.length} segments đã chuẩn hóa. Xem chi tiết bên dưới.`,
          duration: 6,
        });
        modal.warning({
          title: "⚠️ Hết hạn mức API — Đã lưu kết quả một phần",
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
                <strong>✅ Đã lưu tự động:</strong> {refinedResults.length}{" "}
                segments đã được chuẩn hóa và cập nhật vào danh sách. Phần còn
                lại giữ nguyên văn bản gốc.
              </div>
            </div>
          ),
          okText: "Đã hiểu",
        });
      } else {
        const summaryMsg = refinedResult.summary
          ? ` và tóm tắt nội dung!`
          : `!`;
        message.success(
          `✅ Đã chuẩn hóa thành công ${refinedResults.length} đoạn văn bản${summaryMsg}`,
        );
      }

      // Show truncation warning if detected
      if (refinedResult.isTruncated && refinedResult.truncationWarning) {
        modal.warning({
          title: "⚠️ Cảnh báo: Kết quả bị cắt ngắn",
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
                <strong>Kết quả nhận được:</strong> {refinedResults.length}{" "}
                segments
              </div>
            </div>
          ),
          okText: "Đóng",
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
          title: "🚫 Vượt hạn mức Gemini API",
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
                  📌 Thông tin hạn mức Gemini Free Tier:
                </div>
                <ul
                  style={{ margin: 0, paddingLeft: "20px", color: "#003a8c" }}
                >
                  <li>15 requests/phút</li>
                  <li>1,500 requests/ngày</li>
                  <li>
                    <strong>250,000 tokens/ngày</strong> ← Giới hạn chính
                  </li>
                  <li>Reset: Mỗi 24 giờ</li>
                </ul>
              </div>
            </div>
          ),
          okText: "Đã hiểu",
        });
      } else {
        // Regular error message
        message.error({
          content: `Lỗi khi chuẩn hóa bằng AI: ${error.message}`,
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
                🔄 Khôi phục dữ liệu
              </h2>
              <p
                style={{
                  fontSize: "16px",
                  lineHeight: "1.6",
                  color: "#fffefecc",
                }}
              >
                Phát hiện dữ liệu tự động sao lưu từ{" "}
                <strong>
                  {backupAge !== null ? `${backupAge} phút` : "một lúc"}
                </strong>{" "}
                trước.
                <br />
                Có thể trình duyệt đã bị đóng đột ngột hoặc bạn chưa lưu dữ
                liệu.
              </p>
              <p style={{ fontSize: "14px", color: "#fffefecc" }}>
                Bạn có muốn khôi phục dữ liệu này không?
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
                  ✅ Khôi phục
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
                  🗑️ Bỏ qua
                </button>
              </div>
            </div>
          </div>
        )}

        <header className="app-header">
          <h1>📝 Live Meeting Notes</h1>
          <div className="status-indicator">
            {navigator.onLine ? "🌐 Online" : "📴 Offline"}
            {hasUnsavedChanges && (
              <span
                className="unsaved-indicator"
                title="Bạn có dữ liệu chưa lưu"
              >
                ⚠️ Chưa lưu
              </span>
            )}
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
