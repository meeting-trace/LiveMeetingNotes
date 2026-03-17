import React, { useState, useEffect, useRef } from "react";
import { Button, Space, Switch, Tooltip, App, Select, Modal } from "antd";
import {
  FolderOpenOutlined,
  AudioOutlined,
  StopOutlined,
  SaveOutlined,
  FolderAddOutlined,
  SettingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import 'flag-icons/css/flag-icons.min.css';
import { useTranslation } from "react-i18next";
import { AudioRecorderService } from "../services/audioRecorder";
import {
  FileManagerService,
  FileDownloadService,
} from "../services/fileManager";
import { MetadataBuilder } from "../services/metadataBuilder";
import { WordExporter } from "../services/wordExporter";
import {
  speechToTextService,
  SpeechToTextService,
} from "../services/speechToText";
import { appendAudioChunks } from "../services/autoBackup";
import type { RawTranscriptData } from "../services/aiRefinement";
import { AudioFileMergeDialog } from "./AudioFileMergeDialog";
import type { AudioFileItem } from "./AudioFileMergeDialog";
import type {
  MeetingInfo,
  SpeechToTextConfig,
  TranscriptionResult,
  AudioSourceType,
} from "../types/types";

// Speech recognition language list with ISO 3166-1 alpha-2 country codes for flag-icons
const SPEECH_LANGUAGES = [
  { value: 'vi-VN', fiCode: 'vn', labelKey: 'recording.langVi',   shortLabel: 'Tiếng Việt' },
  { value: 'en-US', fiCode: 'us', labelKey: 'recording.langEnUS', shortLabel: 'English (US)' },
  { value: 'en-GB', fiCode: 'gb', labelKey: 'recording.langEnGB', shortLabel: 'English (UK)' },
  { value: 'ja-JP', fiCode: 'jp', labelKey: 'recording.langJa',   shortLabel: '日本語' },
  { value: 'ko-KR', fiCode: 'kr', labelKey: 'recording.langKo',   shortLabel: '한국어' },
  { value: 'zh-CN', fiCode: 'cn', labelKey: 'recording.langZhCN', shortLabel: '中文 (简体)' },
  { value: 'zh-TW', fiCode: 'tw', labelKey: 'recording.langZhTW', shortLabel: '中文 (繁體)' },
  { value: 'fr-FR', fiCode: 'fr', labelKey: 'recording.langFr',   shortLabel: 'Français' },
  { value: 'de-DE', fiCode: 'de', labelKey: 'recording.langDe',   shortLabel: 'Deutsch' },
  { value: 'es-ES', fiCode: 'es', labelKey: 'recording.langEs',   shortLabel: 'Español' },
];

/**
 * Helper: Get file extension from audio blob MIME type
 */
function getAudioExtensionFromBlob(audioBlob: Blob): string {
  const mimeType = audioBlob.type.toLowerCase();
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "mp4";
  return "webm"; // Default fallback
}

interface Props {
  folderPath: string;
  onFolderSelect: (path: string) => void;
  isRecording: boolean;
  onRecordingChange: (recording: boolean) => void;
  onAudioBlobChange: (blob: Blob | null) => void;
  onSaveComplete: () => void;
  onLoadProject: (loadedData: {
    meetingInfo: MeetingInfo;
    notes: string;
    timestampMap: Map<number, number>;
    speakersMap: Map<number, string>;
    audioBlob: Blob | null;
    recordingStartTime: number;
    transcriptions?: TranscriptionResult[]; // Add transcriptions array
    rawTranscripts?: RawTranscriptData[]; // Add raw transcripts for AI refinement
    summary?: string; // Add summary field
  }) => void;
  meetingInfo: MeetingInfo;
  notes: string;
  timestampMap: Map<number, number>;
  speakersMap: Map<number, string>;
  recordingStartTime: number;
  onRecordingStartTimeChange: (time: number) => void;
  audioBlob: Blob | null;
  isSaved: boolean;
  hasUnsavedChanges: boolean;
  // Speech-to-Text props
  onShowTranscriptionConfig: () => void;
  transcriptionConfig: SpeechToTextConfig | null;
  shouldBlink?: boolean;
  onNewTranscription: (result: TranscriptionResult) => void;
  transcriptions: TranscriptionResult[];
  onSpeakerChange?: (lineIndex: number, speaker: string) => void; // Add handler for speaker changes
  geminiSummary?: string; // Add geminiSummary prop
  onFileManagerReady?: (fileManager: FileManagerService) => void; // Pass fileManager instance to parent
  onAudioStreamChange?: (stream: MediaStream | null) => void; // Callback for audio stream changes
  onAudioSourceChange?: (source: AudioSourceType) => void; // Callback for audio source changes
  onTranscribingChange?: (isTranscribing: boolean) => void; // Callback when transcription starts/stops
  onTranscriptionConfigChange?: (config: SpeechToTextConfig) => void; // Callback when config is changed internally (e.g. language)
}

export const RecordingControls: React.FC<Props> = ({
  folderPath,
  onFolderSelect,
  isRecording,
  onRecordingChange,
  onAudioBlobChange,
  onSaveComplete,
  onLoadProject,
  meetingInfo,
  notes,
  timestampMap,
  speakersMap,
  recordingStartTime,
  onRecordingStartTimeChange,
  audioBlob,
  isSaved,
  hasUnsavedChanges,
  onShowTranscriptionConfig,
  transcriptionConfig,
  onNewTranscription,
  transcriptions,
  geminiSummary,
  onFileManagerReady,
  onAudioStreamChange,
  onAudioSourceChange,
  onTranscribingChange,
  onTranscriptionConfigChange,
}) => {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const [duration, setDuration] = useState<number>(0);
  const [recorder] = useState(() => new AudioRecorderService());
  const [fileManager] = useState(() => new FileManagerService());
  const [lastProjectName, setLastProjectName] = useState<string>("");
  const [lastRecordingDuration, setLastRecordingDuration] = useState<number>(0);
  const [autoTranscribe, setAutoTranscribe] = useState<boolean>(true);

  // Audio file merge dialog state
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [pendingAudioFiles, setPendingAudioFiles] = useState<AudioFileItem[]>(
    [],
  );
  const pendingProjectDataRef = useRef<any>(null); // Holds the loaded project data awaiting audio selection

  // ⚡ Live ref: always holds the latest `transcriptions` prop.
  // processSaveRecording is called from handleStopRecording which captures a stale
  // closure over `transcriptions`. Using this ref ensures the forced-committed
  // segment (from forceCommit on stop) is included when writing output files.
  const transcriptionsRef = useRef<TranscriptionResult[]>(transcriptions);
  transcriptionsRef.current = transcriptions;

  // Notify parent about fileManager instance on mount
  useEffect(() => {
    if (onFileManagerReady) {
      onFileManagerReady(fileManager);
    }
  }, [fileManager, onFileManagerReady]);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false); // Track save operations
  const [selectedLanguage, setSelectedLanguage] = useState<string>("vi-VN"); // Language selector
  const [audioSource, setAudioSource] = useState<AudioSourceType>(
    "microphone" as AudioSourceType,
  ); // Audio source selector
  // Ref for periodic intermediate-audio autosave during active recording
  const intermediateAudioSaveRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);

  // Notify parent when audioStream changes
  useEffect(() => {
    if (onAudioStreamChange) {
      onAudioStreamChange(audioStream);
    }
  }, [audioStream, onAudioStreamChange]);

  // Notify parent when audioSource changes
  useEffect(() => {
    if (onAudioSourceChange) {
      onAudioSourceChange(audioSource);
    }
  }, [audioSource, onAudioSourceChange]);

  // Initialize language from config
  useEffect(() => {
    if (transcriptionConfig?.languageCode) {
      setSelectedLanguage(transcriptionConfig.languageCode);
    }
  }, [transcriptionConfig]);

  // Cleanup: clear intermediate audio save interval on unmount
  useEffect(() => {
    return () => {
      if (intermediateAudioSaveRef.current) {
        clearInterval(intermediateAudioSaveRef.current);
      }
    };
  }, []);

  // Setup callback for when user stops screen sharing
  useEffect(() => {
    recorder.setOnStreamEndedCallback(() => {
      if (
        isRecording &&
        (audioSource === ("system" as AudioSourceType) ||
          audioSource === ("both" as AudioSourceType))
      ) {
        Modal.warning({
          title: t('recording.streamEndedTitle'),
          content: (
            <div>
              <p style={{ marginBottom: "12px" }}>
                {t('recording.streamEnded')}
              </p>
            </div>
          ),
          okText: t('common.ok'),
        });
      }
    });
  }, [isRecording, audioSource]);

  useEffect(() => {
    if (!isRecording && !isPaused) return;

    const interval = setInterval(() => {
      setDuration(recorder.getCurrentDuration());
    }, 100);

    return () => clearInterval(interval);
  }, [isRecording, isPaused, recorder]);

  // Start/stop transcription when recording state or autoTranscribe changes
  useEffect(() => {
    const startTranscription = async () => {
      // Get actual audio source type from recorder (may differ from selected if mic not available)
      const actualSourceType = recorder.getAudioSourceType();

      // Skip transcription for system audio only (Web Speech API only works with microphone)
      if (actualSourceType === ("system" as AudioSourceType)) {
        // console.warn('⚠️ Web Speech API chỉ nghe microphone, không nghe system audio. Bỏ qua transcription.');
        // Always stop transcription if it's running to prevent microphone permission request
        speechToTextService.stopTranscription();
        onTranscribingChange?.(false);
        return;
      }

      if (
        isRecording &&
        !isPaused &&
        autoTranscribe &&
        transcriptionConfig &&
        navigator.onLine &&
        audioStream
      ) {
        try {
          // Use the shared audio stream from recorder
          await speechToTextService.startTranscription(
            audioStream,
            onNewTranscription,
          );
          onTranscribingChange?.(true);

          // Show appropriate message based on actual audio source
          if (actualSourceType === ("both" as AudioSourceType)) {
            message.success(
              t('recording.startTranscribeBoth'),
            );
          } else {
            message.success(t('recording.startTranscribe'));
          }
        } catch (error: any) {
          onTranscribingChange?.(false);
          console.error("Failed to start transcription:", error);
          // Don't show error message if we already warned user about no mic
          if (audioSource !== "both" || actualSourceType !== "system") {
            message.error(t('recording.startTranscribeError') + error.message);
          }
        }
      } else if (!isRecording || !autoTranscribe || isPaused) {
        // Stop transcription (but don't stop the stream - recorder owns it)
        speechToTextService.stopTranscription();
        onTranscribingChange?.(false);
      }
    };

    startTranscription();
  }, [
    isRecording,
    isPaused,
    autoTranscribe,
    transcriptionConfig,
    audioStream,
    audioSource,
  ]);

  const handleSelectFolder = async () => {
    try {
      const folder = await fileManager.selectFolder();
      if (folder) {
        onFolderSelect(folder);
        message.success(`Folder selected: ${folder}`);
      }
    } catch (error: any) {
      message.error(error.message);
    }
  };

  const handleStartRecording = async () => {
    // Show warning modal for System Audio to ensure user knows to tick "Also share system audio"
    if (
      audioSource === ("system" as AudioSourceType) ||
      audioSource === ("both" as AudioSourceType)
    ) {
      Modal.confirm({
        title: t('recording.systemAudioWarningTitle'),
        icon: <ExclamationCircleOutlined />,
        content: (
          <div>
            <p
              style={{
                marginBottom: "12px",
                fontWeight: 600,
                color: "#d4380d",
              }}
            >
              {t('recording.systemAudioWarning')}
            </p>
            <p style={{ marginBottom: "8px" }}>
              {t('recording.systemAudioChrome')}
              <br />{t('recording.systemAudioWindow')}
            </p>
            <p style={{ color: "#cf1322", marginTop: "12px" }}>
              {t('recording.systemAudioWarning2')}
            </p>
          </div>
        ),
        okText: t('recording.systemAudioOk'),
        cancelText: t('common.cancel'),
        onOk: async () => {
          await startRecordingWithSource();
        },
      });
    } else {
      // Microphone only - start directly
      await startRecordingWithSource();
    }
  };

  const startRecordingWithSource = async () => {
    try {
      await recorder.startRecording(audioSource);
      const startTime = Date.now();
      onRecordingStartTimeChange(startTime);

      // Get the audio stream from recorder to share with transcription
      const stream = recorder.getStream();
      if (stream) {
        setAudioStream(stream);
      }

      onRecordingChange(true);
      setDuration(0);
      setIsPaused(false);

      // Periodically persist only NEW (delta) audio chunks to IndexedDB.
      // Cost per interval ≈ 30 s × 16 KB/s = ~480 KB regardless of total duration,
      // so this is safe even for multi-hour recordings.
      intermediateAudioSaveRef.current = setInterval(async () => {
        const delta = recorder.getDeltaChunks();
        if (delta && delta.chunks.length > 0) {
          await appendAudioChunks(delta.chunks, delta.mimeType);
        }
      }, 30_000); // every 30 seconds

      // Check if we actually got the expected audio sources
      const actualSourceType = recorder.getAudioSourceType();

      // Show appropriate message based on audio source
      const sourceMessages: Record<string, string> = {
        microphone: t('recording.startMicMsg'),
        system: t('recording.startSystemMsg'),
        both: t('recording.startBothMsg'),
      };

      message.success(sourceMessages[audioSource] || t('recording.startRecording'));

      // Warn if user selected 'both' but only got system audio (no mic available)
      if (audioSource === "both" && actualSourceType === "system") {
        setTimeout(() => {
          message.warning({
            content: t('recording.noMicDetected'),
            duration: 6,
          });
        }, 500);
      }
    } catch (error: any) {
      // Show detailed error modal for system audio failures
      if (error.message.includes("audio") || error.message.includes("Share")) {
        Modal.error({
          title: t('recording.noAudioTitle'),
          content: (
            <div>
              <p style={{ marginBottom: "12px", fontWeight: 600 }}>
                {error.message}
              </p>
              <p style={{ marginTop: "12px" }}>
                <strong>{t('recording.noAudioFix')}</strong>
              </p>
              <ol style={{ paddingLeft: "20px", marginTop: "8px" }}>
                <li>{t('recording.noAudioFix1')}</li>
                <li>{t('recording.noAudioFix2')}</li>
                <li>
                  <strong style={{ color: "#d4380d" }}>
                    {t('recording.noAudioFix3')}
                  </strong>
                </li>
                <li>{t('recording.noAudioFix4')}</li>
              </ol>
            </div>
          ),
          okText: t('common.ok'),
        });
      } else {
        message.error(error.message);
      }
    }
  };

  const handlePauseRecording = async () => {
    try {
      // Just pause the MediaRecorder - no need to stop or save segments
      recorder.pauseRecording();
      setIsPaused(true);

      // Pause transcription service as well
      if (autoTranscribe && speechToTextService.isProcessing()) {
        speechToTextService.stopTranscription();
      }

      message.info(t('recording.pausedMsg'));
    } catch (error: any) {
      message.error(error.message);
    }
  };

  const handleResumeRecording = async () => {
    try {
      // Just resume the MediaRecorder - no new segment needed
      recorder.resumeRecording();
      setIsPaused(false);

      // Resume transcription if it was active
      if (
        autoTranscribe &&
        transcriptionConfig &&
        navigator.onLine &&
        audioStream
      ) {
        try {
          await speechToTextService.startTranscription(
            audioStream,
            onNewTranscription,
          );
        } catch (error: any) {
          console.error("Failed to resume transcription:", error);
        }
      }

      message.success(t('recording.resumedMsg'));
    } catch (error: any) {
      message.error(error.message);
    }
  };

  const handleLanguageChange = async (languageCode: string) => {
    setSelectedLanguage(languageCode);

    // Update config and save
    if (transcriptionConfig) {
      const updatedConfig = {
        ...transcriptionConfig,
        languageCode: languageCode,
      };

      // Save to localStorage
      SpeechToTextService.saveConfig(updatedConfig);

      // Notify parent so App.tsx state stays in sync with localStorage
      onTranscriptionConfigChange?.(updatedConfig);

      // Re-initialize service with new config
      speechToTextService.initialize(updatedConfig);

      // If paused, just update for next resume
      if (isPaused) {
        message.info(
          t('recording.langChangePending', { lang: getLanguageName(languageCode) }),
        );
      } else if (isRecording && autoTranscribe) {
        message.loading({
          content: t('recording.langChanging', { lang: getLanguageName(languageCode) }),
          key: "langChange",
        });

        speechToTextService.stopTranscription();

        setTimeout(async () => {
          if (autoTranscribe && navigator.onLine && audioStream) {
            try {
              await speechToTextService.startTranscription(
                audioStream,
                onNewTranscription,
              );
              message.success({
                content: t('recording.langChanged', { lang: getLanguageName(languageCode) }),
                key: "langChange",
                duration: 2,
              });
            } catch (error: any) {
              console.error("Failed to restart transcription:", error);
              message.error({
                content: t('recording.langChangeError', { message: error.message }),
                key: "langChange",
                duration: 3,
              });
            }
          }
        }, 500);
      } else {
        message.success(t('recording.langSelected', { lang: getLanguageName(languageCode) }));
      }
    }
  };

  const getLanguageName = (code: string): string => {
    const languages: Record<string, string> = {
      "vi-VN": "Tiếng Việt",
      "en-US": "English (US)",
      "en-GB": "English (UK)",
      "ja-JP": "日本語",
      "ko-KR": "한국어",
      "zh-CN": "中文 (简体)",
      "zh-TW": "中文 (繁體)",
      "fr-FR": "Français",
      "de-DE": "Deutsch",
      "es-ES": "Español",
    };
    return languages[code] || code;
  };

  const handleStopFromPause = async () => {
    try {
      // When paused, MediaRecorder is still recording silence
      // Just unmute and stop normally
      if (recorder.isPaused()) {
        recorder.resumeRecording(); // Unmute before stopping
      }
      setIsPaused(false);
      await handleStopRecording();
    } catch (error: any) {
      message.error(t('recording.stopFromPauseError', { message: error.message }));
      setIsPaused(false);
      onRecordingChange(false);
    }
  };

  const sanitizeMeetingTitle = (title: string): string => {
    // Remove invalid characters for file/folder names: < > : " / \ | ? *
    let sanitized = title.replace(/[<>:"/\\|?*]/g, "_");
    // Replace multiple spaces/underscores with single underscore
    sanitized = sanitized.replace(/[\s_]+/g, "_");
    // Trim leading/trailing underscores
    sanitized = sanitized.replace(/^_+|_+$/g, "");
    // Limit length to 50 characters
    if (sanitized.length > 50) {
      sanitized = sanitized.substring(0, 50);
    }
    // Fallback if empty after sanitization
    return sanitized || t('recording.defaultMeetingTitle');
  };

  const handleStopRecording = async () => {
    // Stop periodic intermediate-audio autosave
    if (intermediateAudioSaveRef.current) {
      clearInterval(intermediateAudioSaveRef.current);
      intermediateAudioSaveRef.current = null;
    }
    try {
      setIsProcessing(true);
      const audioBlob = await recorder.stopRecording();
      const recordingDuration = recorder.getCurrentDuration();
      onRecordingChange(false);
      setIsPaused(false); // Reset pause state

      // If auto-transcription is active, wait for it to complete
      if (autoTranscribe && speechToTextService.isProcessing()) {
        message.loading({
          content: t('recording.waitTranscribingMsg'),
          key: "waitTranscription",
        });
        await speechToTextService.waitForCompletion(10000);
        message.success({
          content: t('recording.transcribingCompleteMsg'),
          key: "waitTranscription",
          duration: 2,
        });
      }

      // ⏱ Chờ React flush state update từ force-commit (segment tạm được commit khi dừng).
      // Nếu bỏ qua bước này, processSaveRecording có thể đọc `transcriptions` chưa có segment mới,
      // sau đó React render lại với segment mới làm bật cờ hasUnsavedChanges.
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      // Note: audioStream is already stopped by recorder.stopRecording()
      setAudioStream(null);

      // No need to merge segments anymore - recording is continuous with silence during pauses
      const finalAudioBlob = audioBlob;
      const finalDuration = recordingDuration;

      // Set audio blob immediately so autosave backup captures it even if
      // folder selection is cancelled or save fails later (Bug fix)
      onAudioBlobChange(finalAudioBlob);

      // Process save recording (save files, metadata, transcription, Word doc)
      await processSaveRecording(
        finalAudioBlob,
        finalDuration,
        recordingStartTime,
      );

      // Reset processing state
      setIsProcessing(false);
    } catch (error: any) {
      message.error(`Failed to stop recording: ${error.message}`);
      setIsProcessing(false);
    }
  };

  // Helper function to process saving recording
  const processSaveRecording = async (
    finalAudioBlob: Blob,
    finalDuration: number,
    totalRecordingStartTime: number,
  ) => {
    // Generate folder and file names with timestamp prefix and meeting title
    const now = new Date(totalRecordingStartTime);
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const timePrefix = `${year}${month}${day}_${hours}${minutes}`;

    const sanitizedTitle = sanitizeMeetingTitle(meetingInfo.title);
    const projectName = `${timePrefix}_${sanitizedTitle}`;
    // Get actual audio extension from MediaRecorder (webm/mp3/wav/ogg/mp4)
    const audioExtension = recorder.getAudioFileExtension();
    const audioFileName = `${projectName}.${audioExtension}`;

    // Check if folder is selected
    let hasFolder: boolean = !!(folderPath || fileManager.getDirHandle());
    if (FileManagerService.isSupported() && !hasFolder) {
      // No folder selected, prompt user
      const folder = await fileManager.selectFolder();
      if (!folder) {
        message.info(t('recording.selectFolderToSave'));
        return; // User cancelled
      }
      onFolderSelect(folder);
      hasFolder = true; // Folder now selected
    }

    // Save files
    if (FileManagerService.isSupported() && hasFolder) {
      // Create project subdirectory and get its handle
      const originalHandle = fileManager.getDirHandle(); // Save original handle
      const projectDirHandle =
        await fileManager.createProjectDirectory(projectName);

      // Set dirHandle to project directory for main files
      fileManager.setDirHandle(projectDirHandle);

      // Save audio file (no need to backup segments - recording is continuous)
      await fileManager.saveAudioFile(
        finalAudioBlob,
        audioFileName,
        undefined,
        true,
      );

      // Build and save metadata
      const metadata = MetadataBuilder.buildMetadata(
        meetingInfo,
        notes,
        timestampMap,
        speakersMap,
        finalDuration,
        audioFileName,
        totalRecordingStartTime,
      );

      await fileManager.saveMetadataFile(
        metadata.meetingInfo,
        `${projectName}_meeting_info.json`,
        undefined,
        true,
      );

      await fileManager.saveMetadataFile(
        metadata.metadata,
        `${projectName}_metadata.json`,
        undefined,
        true,
      );

      // Save transcription data if available
      if (transcriptionsRef.current && transcriptionsRef.current.length > 0) {
        const transcriptionData = {
          transcriptions: transcriptionsRef.current.filter((t) => t.isFinal),
          totalCount: transcriptionsRef.current.filter((t) => t.isFinal).length,
          summary: geminiSummary || "", // Include summary
          savedAt: new Date().toISOString(),
        };
        await fileManager.saveMetadataFile(
          transcriptionData,
          `${projectName}_transcription.json`,
          undefined,
          true,
        );

        // Save raw transcripts for AI refinement
        const finalTranscriptions = transcriptionsRef.current.filter(
          (t) => t.isFinal,
        );
        const rawTranscriptsData = {
          rawTranscripts: finalTranscriptions.map((t) => ({
            text: t.text,
            timestamp: t.startTime,
            audioTimeMs: t.audioTimeMs,
            confidence: t.confidence,
            isFinal: t.isFinal,
          })),
          totalCount: finalTranscriptions.length,
          savedAt: new Date().toISOString(),
        };
        await fileManager.saveMetadataFile(
          rawTranscriptsData,
          `${projectName}_rawTranscripts.json`,
          undefined,
          true,
        );
      }

      // Export Word document to same folder
      const finalTranscriptions =
        transcriptionsRef.current?.filter((t) => t.isFinal) || [];
      const wordBlob = await WordExporter.createWordBlob(
        meetingInfo,
        notes,
        finalTranscriptions,
        speakersMap,
        geminiSummary,
      );
      await fileManager.saveWordFile(
        wordBlob,
        `${projectName}.docx`,
        undefined,
        true,
      );

      // Restore original handle
      if (originalHandle) {
        fileManager.setDirHandle(originalHandle);
      }

      message.success(`Recording saved to folder: ${projectName}`);
      setLastProjectName(projectName);
      setLastRecordingDuration(finalDuration);
    } else {
      // Fallback: download files
      const downloader = new FileDownloadService();
      await downloader.downloadAudioFile(finalAudioBlob, audioFileName);

      const metadata = MetadataBuilder.buildMetadata(
        meetingInfo,
        notes,
        timestampMap,
        speakersMap,
        finalDuration,
        audioFileName,
        totalRecordingStartTime,
      );

      await downloader.downloadMetadataFile(
        metadata.meetingInfo,
        `${projectName}_meeting_info.json`,
      );
      await downloader.downloadMetadataFile(
        metadata.metadata,
        `${projectName}_metadata.json`,
      );

      // Save transcription data if available
      if (transcriptionsRef.current && transcriptionsRef.current.length > 0) {
        const transcriptionData = {
          transcriptions: transcriptionsRef.current.filter((t) => t.isFinal),
          totalCount: transcriptionsRef.current.filter((t) => t.isFinal).length,
          summary: geminiSummary || "", // Include summary
          savedAt: new Date().toISOString(),
        };
        await downloader.downloadMetadataFile(
          transcriptionData,
          `${projectName}_transcription.json`,
        );

        // Save raw transcripts for AI refinement
        const rawTranscriptsData = {
          rawTranscripts: transcriptionsRef.current
            .filter((t) => t.isFinal)
            .map((t) => ({
              text: t.text,
              timestamp: t.startTime,
              audioTimeMs: t.audioTimeMs,
              confidence: t.confidence,
              isFinal: t.isFinal,
            })),
          totalCount: transcriptionsRef.current.filter((t) => t.isFinal).length,
          savedAt: new Date().toISOString(),
        };
        await downloader.downloadMetadataFile(
          rawTranscriptsData,
          `${projectName}_rawTranscripts.json`,
        );
      }

      // Export Word document
      const finalTranscriptions =
        transcriptionsRef.current?.filter((t) => t.isFinal) || [];
      await WordExporter.exportToWord(
        meetingInfo,
        notes,
        `${projectName}.docx`,
        finalTranscriptions,
        speakersMap,
        geminiSummary,
      );

      message.info(
        "Files downloaded. Please save them to your meeting notes folder.",
      );
      setLastProjectName(projectName);
      setLastRecordingDuration(finalDuration);
    }

    // audioBlob already set in handleStopRecording (before processSaveRecording was called)
    // Call onSaveComplete to reset hasUnsavedChanges and clear auto-backup after successful save
    onSaveComplete();
  };

  const handleSaveNotes = async () => {
    try {
      // Check if folder is selected, if not, prompt user to select
      if (!FileManagerService.isSupported()) {
        // Fallback: download files
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const hours = String(now.getHours()).padStart(2, "0");
        const minutes = String(now.getMinutes()).padStart(2, "0");
        const timePrefix = `${year}${month}${day}_${hours}${minutes}`;

        const sanitizedTitle = sanitizeMeetingTitle(meetingInfo.title);
        const projectName = `${timePrefix}_${sanitizedTitle}`;

        const downloader = new FileDownloadService();

        await downloader.downloadMetadataFile(
          meetingInfo,
          `${projectName}_meeting_info.json`,
        );

        // Export Word document
        const finalTranscriptions =
          transcriptions?.filter((t) => t.isFinal) || [];
        await WordExporter.exportToWord(
          meetingInfo,
          notes,
          `${projectName}.docx`,
          finalTranscriptions,
          speakersMap,
          geminiSummary,
        );

        message.info(
          t('recording.downloadedSaveHint'),
        );
        setLastProjectName(projectName);
        onSaveComplete();
        return;
      }

      // Check if folder is selected
      if (
        !folderPath &&
        !fileManager.getParentDirHandle() &&
        !fileManager.getProjectDirHandle()
      ) {
        // No folder selected, prompt user
        const folder = await fileManager.selectFolder();
        if (!folder) {
          message.info(t('recording.selectFolderToSaveNotes'));
          return; // User cancelled
        }
        onFolderSelect(folder);
      }

      // Generate folder and file names with timestamp prefix and meeting title
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const timePrefix = `${year}${month}${day}_${hours}${minutes}`;

      const sanitizedTitle = sanitizeMeetingTitle(meetingInfo.title);
      const projectName = `${timePrefix}_${sanitizedTitle}`;

      // Create project subdirectory and get its handle
      const originalHandle = fileManager.getDirHandle(); // Save original handle
      const projectDirHandle =
        await fileManager.createProjectDirectory(projectName);
      // console.log('✓ Created project directory:', projectName);

      // Temporarily set dirHandle to the project directory for saving files
      fileManager.setDirHandle(projectDirHandle);

      // Save metadata files (convert to PascalCase format)
      const meetingInfoJson = {
        MeetingTitle: meetingInfo.title,
        MeetingDate: meetingInfo.date,
        MeetingTime: meetingInfo.time,
        Location: meetingInfo.location,
        Host: meetingInfo.host,
        Attendees: meetingInfo.attendees,
      };

      await fileManager.saveMetadataFile(
        meetingInfoJson,
        `${projectName}_meeting_info.json`,
        undefined,
        true,
      );
      // console.log('✓ Saved meeting_info.json');

      // Create metadata using MetadataBuilder (same as recording mode)
      const metadata = MetadataBuilder.buildMetadata(
        meetingInfo,
        notes,
        timestampMap,
        speakersMap,
        0, // No audio duration for notes-only
        "", // No audio file
        recordingStartTime || Date.now(), // Use recording start time if available, otherwise current time
      );

      // Override fields for notes-only mode
      metadata.metadata.Model = "Notes Only";
      metadata.metadata.OriginalFileName = "";
      metadata.metadata.AudioFileName = "";
      metadata.metadata.Duration = "00:00:00.0000000";

      await fileManager.saveMetadataFile(
        metadata.metadata,
        `${projectName}_metadata.json`,
        undefined,
        true,
      );
      // console.log('✓ Saved metadata.json');

      // Export Word document
      const finalTranscriptions =
        transcriptions?.filter((t) => t.isFinal) || [];
      const wordBlob = await WordExporter.createWordBlob(
        meetingInfo,
        notes,
        finalTranscriptions,
        speakersMap,
        geminiSummary,
      );
      await fileManager.saveWordFile(
        wordBlob,
        `${projectName}.docx`,
        undefined,
        true,
      );
      // console.log('✓ Saved Word document');

      // Restore original handle
      if (originalHandle) {
        fileManager.setDirHandle(originalHandle);
      }

      message.success(`Notes saved to folder: ${projectName}`);
      setLastProjectName(projectName);
      onSaveComplete();
    } catch (error: any) {
      console.error("Save Notes Error:", error);
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
      message.error(`Failed to save notes: ${error.message}`);
    }
  };

  const handleSaveChanges = async () => {
    try {
      // Generate new folder and file names with new timestamp
      // If lastProjectName is empty (e.g., after page reload), create new project name from meeting info
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const timePrefix = `${year}${month}${day}_${hours}${minutes}`;

      const sanitizedTitle = sanitizeMeetingTitle(meetingInfo.title);
      const newProjectName = `${timePrefix}_${sanitizedTitle}`;

      // If no lastProjectName (e.g., after reload), notify user we're creating new version
      if (!lastProjectName) {
        message.info(t('recording.savingRestoredData'));
      }

      // Build updated metadata with current notes
      // Check if this is a notes-only project or recording project
      const isNotesOnly = !audioBlob;

      let metadata;
      if (isNotesOnly) {
        // Notes-only project - use MetadataBuilder to properly handle timestamps and speakers
        metadata = MetadataBuilder.buildMetadata(
          meetingInfo,
          notes,
          timestampMap,
          speakersMap,
          0, // No audio duration for notes-only
          "", // No audio file
          recordingStartTime || Date.now(),
        );

        // Override fields for notes-only mode
        metadata.metadata.Model = "Notes Only";
        metadata.metadata.OriginalFileName = "";
        metadata.metadata.AudioFileName = "";
        metadata.metadata.Duration = "00:00:00.0000000";
      } else {
        // Recording project with audio
        const audioExtension = getAudioExtensionFromBlob(audioBlob);
        const audioFileName = `${newProjectName}.${audioExtension}`;
        metadata = MetadataBuilder.buildMetadata(
          meetingInfo,
          notes,
          timestampMap,
          speakersMap,
          lastRecordingDuration,
          audioFileName,
          recordingStartTime,
        );
      }

      if (FileManagerService.isSupported()) {
        // Try multiple save locations in order of preference:
        // 1. User-selected folder via "Select Folder" button (highest priority if user chose new location)
        // 2. Parent directory of loaded project (same level as original)
        // 3. Inside loaded project folder itself (fallback - creates subfolder)
        const parentDirHandle = fileManager.getParentDirHandle();
        const projectDirHandle = fileManager.getProjectDirHandle();

        let saveHandle: FileSystemDirectoryHandle | null = null;
        let saveLocation = "";

        // Check if user has manually selected a folder (prioritize user's explicit choice)
        const hasManualSelection =
          folderPath &&
          !folderPath.includes("(parent of loaded project)") &&
          !folderPath.includes("(loaded project folder)");

        if (hasManualSelection) {
          // User explicitly chose a folder via "Select Folder" - use it
          saveLocation = "selected folder";
          // dirHandle is already set from selectFolder()
        } else if (parentDirHandle) {
          saveHandle = parentDirHandle;
          saveLocation = "parent directory (same level as loaded project)";
        } else if (projectDirHandle) {
          saveHandle = projectDirHandle;
          saveLocation = "inside loaded project folder";
        }

        if (saveHandle || folderPath) {
          // Set directory handle if we got one from loaded project
          const originalHandle = fileManager.getDirHandle(); // Save original handle
          if (saveHandle) {
            fileManager.setDirHandle(saveHandle);
          }

          // Create new project subdirectory and get its handle
          const projectDirHandle =
            await fileManager.createProjectDirectory(newProjectName);
          // console.log('✓ Created project directory:', newProjectName);

          // Temporarily set dirHandle to the project directory for saving files
          fileManager.setDirHandle(projectDirHandle);

          // Save audio file only if it exists (recording project)
          // Now save files directly to current directory (no subDir needed)
          if (audioBlob) {
            const audioExtension = getAudioExtensionFromBlob(audioBlob);
            const audioFileName = `${newProjectName}.${audioExtension}`;
            await fileManager.saveAudioFile(
              audioBlob,
              audioFileName,
              undefined,
              true,
            );
            // console.log('✓ Saved audio file:', audioFileName);
          }

          // Save metadata files directly to project directory
          await fileManager.saveMetadataFile(
            metadata.meetingInfo,
            `${newProjectName}_meeting_info.json`,
            undefined,
            true,
          );
          // console.log('✓ Saved meeting_info.json');

          await fileManager.saveMetadataFile(
            metadata.metadata,
            `${newProjectName}_metadata.json`,
            undefined,
            true,
          );
          // console.log('✓ Saved metadata.json');

          // Save transcription data if available
          if (transcriptions && transcriptions.length > 0) {
            const finalTranscriptions = transcriptions.filter((t) => t.isFinal);
            const transcriptionData = {
              transcriptions: finalTranscriptions, // Only save final results
              totalCount: finalTranscriptions.length,
              summary: geminiSummary || "", // Include summary
              savedAt: new Date().toISOString(),
            };
            await fileManager.saveMetadataFile(
              transcriptionData,
              `${newProjectName}_transcription.json`,
              undefined,
              true,
            );

            // Save raw transcripts for AI refinement
            const rawTranscriptsData = {
              rawTranscripts: finalTranscriptions.map((t) => ({
                text: t.text,
                timestamp: t.startTime,
                audioTimeMs: t.audioTimeMs,
                confidence: t.confidence,
                isFinal: t.isFinal,
              })),
              totalCount: finalTranscriptions.length,
              savedAt: new Date().toISOString(),
            };
            await fileManager.saveMetadataFile(
              rawTranscriptsData,
              `${newProjectName}_rawTranscripts.json`,
              undefined,
              true,
            );
            // console.log('💾 Transcription data saved in Save Changes:', transcriptionData.totalCount, 'items');
          }

          // Export Word document
          const finalTranscriptions =
            transcriptions?.filter((t) => t.isFinal) || [];
          const wordBlob = await WordExporter.createWordBlob(
            meetingInfo,
            notes,
            finalTranscriptions,
            speakersMap,
            geminiSummary,
          );
          await fileManager.saveWordFile(
            wordBlob,
            `${newProjectName}.docx`,
            undefined,
            true,
          );
          // console.log('✓ Saved Word document');

          // Restore original handle
          if (originalHandle) {
            fileManager.setDirHandle(originalHandle);
          }

          message.success(
            `Changes saved to ${saveLocation}: ${newProjectName}`,
          );
          setLastProjectName(newProjectName);
        } else {
          message.error(
            'No save location available. Please use "Select Folder" first or load a project.',
          );
          return; // Don't call onSaveComplete if save failed
        }
      } else {
        // Download updated files (fallback for unsupported browsers)
        const downloader = new FileDownloadService();

        // Download audio only if it exists
        if (audioBlob) {
          const audioExtension = getAudioExtensionFromBlob(audioBlob);
          const audioFileName = `${newProjectName}.${audioExtension}`;
          await downloader.downloadAudioFile(audioBlob, audioFileName);
        }

        await downloader.downloadMetadataFile(
          metadata.meetingInfo,
          `${newProjectName}_meeting_info.json`,
        );

        await downloader.downloadMetadataFile(
          metadata.metadata,
          `${newProjectName}_metadata.json`,
        );

        // Save transcription data if available
        if (transcriptions && transcriptions.length > 0) {
          const finalTranscriptions = transcriptions.filter((t) => t.isFinal);
          const transcriptionData = {
            transcriptions: finalTranscriptions,
            totalCount: finalTranscriptions.length,
            savedAt: new Date().toISOString(),
          };
          await downloader.downloadMetadataFile(
            transcriptionData,
            `${newProjectName}_transcription.json`,
          );

          // Save raw transcripts for AI refinement
          const rawTranscriptsData = {
            rawTranscripts: finalTranscriptions.map((t) => ({
              text: t.text,
              timestamp: t.startTime,
              audioTimeMs: t.audioTimeMs,
              confidence: t.confidence,
              isFinal: t.isFinal,
            })),
            totalCount: finalTranscriptions.length,
            savedAt: new Date().toISOString(),
          };
          await downloader.downloadMetadataFile(
            rawTranscriptsData,
            `${newProjectName}_rawTranscripts.json`,
          );
          // console.log('💾 Transcription data downloaded in Save Changes:', transcriptionData.totalCount, 'items');
        }

        const finalTranscriptions =
          transcriptions?.filter((t) => t.isFinal) || [];
        await WordExporter.exportToWord(
          meetingInfo,
          notes,
          `${newProjectName}.docx`,
          finalTranscriptions,
          speakersMap,
          geminiSummary,
        );

        message.info("Updated files downloaded as new version.");
        setLastProjectName(newProjectName);
      }

      onSaveComplete(); // Notify parent that save is complete
    } catch (error: any) {
      console.error("Save Changes Error:", error);
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
      message.error(
        `Lỗi khi lưu thay đổi (có thể do đường dẫn lưu file quá dài): ${error.message}`,
      );
    }
  };

  // ─── Helper: apply fully-resolved project data to parent state ────────────
  const applyLoadedProject = (
    projectData: NonNullable<
      Awaited<ReturnType<FileManagerService["loadProjectFromFolder"]>>
    >,
    resolvedAudioBlob: Blob | null,
  ) => {
    const {
      meetingInfo: meetingInfoData,
      metadata: metadataData,
      transcriptionData,
      rawTranscriptsData,
    } = projectData;

    // Map PascalCase from saved files to camelCase for MeetingInfo
    const loadedMeetingInfo = {
      title: meetingInfoData.MeetingTitle || "",
      date: meetingInfoData.MeetingDate || "",
      time: meetingInfoData.MeetingTime || "",
      location: meetingInfoData.Location || "",
      host: meetingInfoData.Host || "",
      attendees: meetingInfoData.Attendees || "",
    };

    // Parse metadata to reconstruct timestampMap, speakersMap and notes
    const timestampMapData = new Map<number, number>();
    const speakersMapData = new Map<number, string>();
    let notesText = "";

    // Get recording start time - prefer from metadata, fallback to calculation
    let recordingStart = Date.now();

    if (metadataData.RecordingStartTime) {
      recordingStart = new Date(metadataData.RecordingStartTime).getTime();
    } else if (metadataData.Timestamps && metadataData.Timestamps.length > 0) {
      const firstTimestamp = metadataData.Timestamps[0];
      const firstDatetime = new Date(firstTimestamp.DateTime).getTime();
      const startTimeMatch = firstTimestamp.StartTime.match(
        /(\d+):(\d+):(\d+)\.(\d+)/,
      );
      if (startTimeMatch) {
        const fractionalPart = startTimeMatch[4];
        const ms =
          fractionalPart.length === 7
            ? parseInt(fractionalPart) / 10000
            : parseInt(fractionalPart);
        const offsetMs =
          parseInt(startTimeMatch[1]) * 3600000 +
          parseInt(startTimeMatch[2]) * 60000 +
          parseInt(startTimeMatch[3]) * 1000 +
          ms;
        recordingStart = firstDatetime - offsetMs;
      }
    }

    if (metadataData.Timestamps && Array.isArray(metadataData.Timestamps)) {
      const BLOCK_SEPARATOR = "§§§";
      const sortedTimestamps = metadataData.Timestamps.sort(
        (a: any, b: any) => a.Index - b.Index,
      );

      sortedTimestamps.forEach((ts: any, index: number) => {
        if (index > 0) notesText += BLOCK_SEPARATOR;
        const position = notesText.length;

        let startTimeMs = 0;
        const startTimeMatch = ts.StartTime.match(/(\d+):(\d+):(\d+)\.(\d+)/);
        if (startTimeMatch) {
          const fractionalPart = startTimeMatch[4];
          const ms =
            fractionalPart.length === 7
              ? parseInt(fractionalPart) / 10000
              : parseInt(fractionalPart);
          startTimeMs =
            parseInt(startTimeMatch[1]) * 3600000 +
            parseInt(startTimeMatch[2]) * 60000 +
            parseInt(startTimeMatch[3]) * 1000 +
            ms;
        }

        timestampMapData.set(position, recordingStart + startTimeMs);
        if (ts.Speaker) speakersMapData.set(index, ts.Speaker);
        notesText += ts.Text || "";
      });
    }

    // Parse duration
    let durationMs = 0;
    if (metadataData.Duration) {
      const match = metadataData.Duration.match(/(\d+):(\d+):(\d+)\.(\d+)/);
      if (match) {
        const fractionalPart = match[4];
        const ms =
          fractionalPart.length === 7
            ? parseInt(fractionalPart) / 10000
            : parseInt(fractionalPart);
        durationMs =
          parseInt(match[1]) * 3600000 +
          parseInt(match[2]) * 60000 +
          parseInt(match[3]) * 1000 +
          ms;
      }
    }

    onLoadProject({
      meetingInfo: loadedMeetingInfo,
      notes: notesText,
      timestampMap: timestampMapData,
      speakersMap: speakersMapData,
      audioBlob: resolvedAudioBlob,
      recordingStartTime: recordingStart,
      transcriptions: transcriptionData?.transcriptions || [],
      rawTranscripts: rawTranscriptsData?.rawTranscripts || [],
      summary: transcriptionData?.summary || "",
    });

    if (transcriptionData?.transcriptions?.length > 0) {
      message.success(
        `Loaded ${transcriptionData.transcriptions.length} transcription results`,
      );
    }

    setLastProjectName(projectData.projectName);
    setLastRecordingDuration(durationMs);

    const parentHandle = fileManager.getParentDirHandle();
    const projectDirHandle = fileManager.getProjectDirHandle();
    if (parentHandle) {
      onFolderSelect(parentHandle.name + " (parent of loaded project)");
    } else if (projectDirHandle) {
      onFolderSelect(projectDirHandle.name + " (loaded project folder)");
    }

    message.success(`Project loaded: ${projectData.projectName}`);
  };

  const handleLoadProject = async () => {
    // console.log('handleLoadProject called');

    try {
      if (!FileManagerService.isSupported()) {
        message.error(t('recording.noProjectSupport'));
        return;
      }

      if (hasUnsavedChanges) {
        const confirmed = window.confirm(t('recording.unsavedConfirm'));
        if (!confirmed) return;
      }

      const projectData = await fileManager.loadProjectFromFolder();

      if (!projectData) return; // User cancelled

      const { audioFiles, audioBlob } = projectData;

      // If multiple audio files found, show merge dialog
      if (audioFiles.length > 1) {
        pendingProjectDataRef.current = projectData;
        setPendingAudioFiles(audioFiles);
        setShowMergeDialog(true);
        return; // Wait for user's choice in dialog
      }

      // Single or no audio file → apply directly
      applyLoadedProject(projectData, audioBlob);
    } catch (error: any) {
      console.error("Load project error:", error);
      message.error(`Failed to load project: ${error.message}`);
    }
  };

  // Called when user confirms audio selection/merge in dialog
  const handleMergeConfirm = (mergedBlob: Blob) => {
    setShowMergeDialog(false);
    const projectData = pendingProjectDataRef.current;
    pendingProjectDataRef.current = null;
    if (!projectData) return;
    try {
      applyLoadedProject(projectData, mergedBlob);
    } catch (error: any) {
      console.error("Apply project after merge error:", error);
      message.error(t('recording.loadProjectError', { message: error.message }));
    }
  };

  // Called when user cancels the merge dialog
  const handleMergeCancel = () => {
    setShowMergeDialog(false);
    setPendingAudioFiles([]);
    pendingProjectDataRef.current = null;
    message.info(t('recording.cancelLoadProject'));
  };

  // Called when user wants to use only first audio file
  const handleMergeUseSingle = (blob: Blob) => {
    setShowMergeDialog(false);
    const projectData = pendingProjectDataRef.current;
    pendingProjectDataRef.current = null;
    if (!projectData) return;
    try {
      applyLoadedProject(projectData, blob);
    } catch (error: any) {
      console.error("Apply project (single audio) error:", error);
      message.error(t('recording.loadProjectError', { message: error.message }));
    }
  };

  const formatDuration = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className="recording-controls">
      {/* Audio File Merge Dialog - shown when multiple audio files detected on project load */}
      <AudioFileMergeDialog
        open={showMergeDialog}
        audioFiles={pendingAudioFiles}
        onConfirm={handleMergeConfirm}
        onCancel={handleMergeCancel}
        onUseSingle={handleMergeUseSingle}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {/* Row 1: File Management & Configuration */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            marginBottom: "12px",
            flexWrap: "wrap",
          }}
        >
          <Space size="middle" wrap>
            <Button
              icon={<FolderOpenOutlined />}
              onClick={handleSelectFolder}
              disabled={isRecording}
              size="middle"
              style={{ marginLeft: "auto", width: 150 }}
            >
              {t('recording.selectFolder')}
            </Button>

            <Button
              icon={<FolderAddOutlined />}
              onClick={() => {
                handleLoadProject();
              }}
              disabled={isRecording || !FileManagerService.isSupported()}
              size="middle"
              type="default"
              style={{ marginLeft: "auto", width: 150 }}
            >
              {t('recording.loadProject')}
            </Button>

            {/* Show Save Notes button when has unsaved data but not saved yet */}
            {!isRecording && !isSaved && hasUnsavedChanges && (
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSaveNotes}
                size="middle"
                style={{ marginLeft: "auto", width: 150 }}
              >
                {t('recording.saveNotes')}
              </Button>
            )}

            {/* Show Save Changes button when has unsaved changes after first save */}
            {!isRecording && isSaved && hasUnsavedChanges && (
              <Button
                type="default"
                icon={<SaveOutlined />}
                onClick={handleSaveChanges}
                size="middle"
                className="btn-success"
                style={{ marginLeft: "auto", width: 150 }}
              >
                {t('recording.saveChanges')}
              </Button>
            )}

            {/* Folder path display */}
            {folderPath && (
              <span style={{ fontSize: "13px", color: "#666" }}>
                📁 <strong>{folderPath}</strong>
              </span>
            )}
          </Space>

          {/* Speech-to-Text Config Button */}
          {navigator.onLine && (
            <Button
              icon={<SettingOutlined />}
              onClick={onShowTranscriptionConfig}
              disabled={isRecording || isPaused}
              size="middle"
              className={!transcriptionConfig ? "blink-btn" : ""}
              style={{ marginLeft: "auto", width: 150 }}
            >
              {t('recording.configure')}
            </Button>
          )}
        </div>
        {/* Row 2: Recording Controls & Transcription */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          {/* Left: Recording Controls */}
          <Space size="middle" wrap>
            {/* Audio Source Selector - Always show, disabled when recording */}
            <Tooltip
              title={
                isRecording || isPaused
                  ? t('recording.cannotChangeSource')
                  : ""
              }
            >
              <Select
                value={audioSource}
                onChange={(value) => setAudioSource(value)}
                disabled={
                  isRecording || isPaused || isProcessing || audioBlob !== null
                }
                size="middle"
                style={{ width: 150 }}
              >
                <Select.Option value={"microphone" as AudioSourceType}>
                  {t('recording.mic')}
                </Select.Option>
                <Select.Option value={"system" as AudioSourceType}>
                  {t('recording.other')}
                </Select.Option>
                <Select.Option value={"both" as AudioSourceType}>
                  {t('recording.combined')}
                </Select.Option>
              </Select>
            </Tooltip>

            {!isRecording ? (
              <>
                <Button
                  type="primary"
                  danger
                  icon={<AudioOutlined />}
                  onClick={handleStartRecording}
                  size="middle"
                  disabled={isProcessing || audioBlob !== null}
                  style={{ marginLeft: "auto", width: 150 }}
                >
                  {t('recording.start')}
                </Button>

                {isProcessing && (
                  <span
                    style={{
                      marginLeft: "12px",
                      color: "#1890ff",
                      fontWeight: 600,
                       width: 150,
                    }}
                  >
                    {t('recording.processing')}
                  </span>
                )}

                {audioBlob !== null && !isProcessing && (
                  <span
                    style={{
                      fontSize: "13px",
                      color: "#999",
                      fontStyle: "italic",
                       width: 150 ,
                    }}
                  >
                    {t('recording.reloadHint')}
                  </span>
                )}
              </>
            ) : isPaused ? (
              <>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  onClick={handleResumeRecording}
                  size="middle"
                  className="btn-success"
                  style={{ marginLeft: "auto", width: 150 }}
                >
                  {t('recording.resume')}
                </Button>
                <Button
                  type="primary"
                  icon={<StopOutlined />}
                  onClick={handleStopFromPause}
                  size="middle"
                  danger
                  style={{ marginLeft: "auto", width: 150 }}
                >
                  {t('recording.stopAll')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="default"
                  icon={<PauseCircleOutlined />}
                  onClick={handlePauseRecording}
                  size="middle"
                  style={{ marginLeft: "auto", width: 150 }}
                >
                  {t('recording.pause')}
                </Button>
                <Button
                  type="primary"
                  icon={<StopOutlined />}
                  onClick={handleStopRecording} 
                  size="middle"
                  danger
                  style={{ marginLeft: "auto", width: 150 }}
                >
                  {t('recording.stop')}
                </Button>
              </>
            )}
            {isRecording && (
              <span className="duration-display" style={{ marginLeft: "auto", width: 140, fontSize: "16px", textAlign: "center" }}>
                ⏱ {formatDuration(duration)}
              </span>
            )}
            {isRecording && !isPaused && (
              <span className="recording-indicator">
                {recorder.getAudioSourceType() === ("microphone" as AudioSourceType)
                  ? t('recording.recordingMic')
                  : recorder.getAudioSourceType() === ("system" as AudioSourceType)
                    ? t('recording.recordingOther')
                    : t('recording.recordingBoth')}
              </span>
            )}

            {isPaused && (
              <span className="paused-indicator">{t('recording.paused')}</span>
            )}
          </Space>

          {/* Right: Speech-to-Text Controls - Only show when online */}
          {navigator.onLine && transcriptionConfig && (
            <Space size="middle" wrap style={{ marginLeft: "auto" }}>
              <Tooltip
                title={
                  isRecording && !isPaused
                    ? t('recording.toggleTranscribeTooltip')
                    : isPaused
                      ? t('recording.languageChangeEffect')
                      : t('recording.liveTranscribeHint')
                }
              >
                <Space>
                  {/* <SoundOutlined style={{ fontSize: '18px', color: autoTranscribe ? '#16a34a' : '#9ca3af' }} /> */}
                  <span style={{ fontSize: "14px" }}>
                    {t('recording.liveTranscribe')}
                  </span>
                  <Switch
                    checked={autoTranscribe}
                    onChange={(checked) => {
                      setAutoTranscribe(checked);
                    }}
                    disabled={isRecording && !isPaused}
                    checkedChildren={t('recording.on')}
                    unCheckedChildren={t('recording.off')}
                  />
                </Space>
              </Tooltip>

              {/* Language Quick Selector */}
              <Tooltip
                title={
                  isRecording && !isPaused
                    ? t('recording.switchLangNow')
                    : isPaused
                      ? t('recording.languageChangeEffect')
                      : t('recording.selectLanguage')
                }
              >
                <Select
                  value={selectedLanguage}
                  onChange={handleLanguageChange}
                  style={{ width: 150 }}
                  size="middle"
                  disabled={false}
                  labelRender={(opt) => {
                    const lang = SPEECH_LANGUAGES.find(l => l.value === opt.value);
                    return lang ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className={`fi fi-${lang.fiCode}`} style={{ fontSize: 14, borderRadius: 2 }} />
                        {lang.shortLabel}
                      </span>
                    ) : <span>{opt.label}</span>;
                  }}
                  options={SPEECH_LANGUAGES.map(l => ({
                    value: l.value,
                    label: (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className={`fi fi-${l.fiCode}`} style={{ fontSize: 16, borderRadius: 2, flexShrink: 0 }} />
                        {t(l.labelKey)}
                      </span>
                    ),
                  }))}
                />
              </Tooltip>
            </Space>
          )}

          {/* Show hint when transcription not configured */}
          {navigator.onLine && !transcriptionConfig && (
            <span
              style={{
                fontSize: "13px",
                color: "#999",
                fontStyle: "italic",
                marginLeft: "auto",
              }}
            >
              {t('recording.configureHint')}
            </span>
          )}
        </div>
        {!FileManagerService.isSupported() && (
          <div className="browser-warning">
            {t('recording.noFolderAccess')}
          </div>
        )}
      </div>
    </div>
  );
};
