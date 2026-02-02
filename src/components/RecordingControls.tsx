import React, { useState, useEffect } from 'react';
import { Button, Space, Switch, Tooltip, App, Select } from 'antd';
import {
  FolderOpenOutlined,
  AudioOutlined,
  StopOutlined,
  SaveOutlined,
  FolderAddOutlined,
  SettingOutlined,
  SoundOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  GlobalOutlined
} from '@ant-design/icons';
import { AudioRecorderService } from '../services/audioRecorder';
import { FileManagerService, FileDownloadService } from '../services/fileManager';
import { MetadataBuilder } from '../services/metadataBuilder';
import { WordExporter } from '../services/wordExporter';
import { speechToTextService, SpeechToTextService } from '../services/speechToText';
import type { RawTranscriptData } from '../services/aiRefinement';
import type { MeetingInfo, SpeechToTextConfig, TranscriptionResult } from '../types/types';

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
  onFileManagerReady
}) => {
  const { message } = App.useApp();
  const [duration, setDuration] = useState<number>(0);
  const [recorder] = useState(() => new AudioRecorderService());
  const [fileManager] = useState(() => new FileManagerService());
  const [lastProjectName, setLastProjectName] = useState<string>('');
  const [lastRecordingDuration, setLastRecordingDuration] = useState<number>(0);
  const [autoTranscribe, setAutoTranscribe] = useState<boolean>(true);

  // Notify parent about fileManager instance on mount
  useEffect(() => {
    if (onFileManagerReady) {
      onFileManagerReady(fileManager);
    }
  }, [fileManager, onFileManagerReady]);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false); // Track save operations
  const [selectedLanguage, setSelectedLanguage] = useState<string>('vi-VN'); // Language selector

  // Initialize language from config
  useEffect(() => {
    if (transcriptionConfig?.languageCode) {
      setSelectedLanguage(transcriptionConfig.languageCode);
    }
  }, [transcriptionConfig]);

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
      if (isRecording && !isPaused && autoTranscribe && transcriptionConfig && navigator.onLine && audioStream) {
        try {
          // Use the shared audio stream from recorder
          await speechToTextService.startTranscription(audioStream, onNewTranscription);
          message.success('🎤 Bắt đầu chuyển đổi giọng nói sang văn bản');
        } catch (error: any) {
          console.error('Failed to start transcription:', error);
          message.error('Không thể bắt đầu chuyển đổi: ' + error.message);
        }
      } else if (!isRecording || !autoTranscribe || isPaused) {
        // Stop transcription (but don't stop the stream - recorder owns it)
        speechToTextService.stopTranscription();
      }
    };

    startTranscription();
  }, [isRecording, isPaused, autoTranscribe, transcriptionConfig, audioStream]);

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
    try {
      await recorder.startRecording();
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
      message.success('Bắt đầu ghi âm');
    } catch (error: any) {
      message.error(error.message);
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
      
      message.info('⏸️ Đã tạm dừng ghi âm');
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
      if (autoTranscribe && transcriptionConfig && navigator.onLine && audioStream) {
        try {
          await speechToTextService.startTranscription(audioStream, onNewTranscription);
        } catch (error: any) {
          console.error('Failed to resume transcription:', error);
        }
      }
      
      message.success('▶️ Tiếp tục ghi âm');
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
        languageCode: languageCode
      };
      
      // Save to localStorage
      SpeechToTextService.saveConfig(updatedConfig);
      
      // Re-initialize service with new config
      speechToTextService.initialize(updatedConfig);
      
      // If paused, just update for next resume
      if (isPaused) {
        message.info(`🌐 Ngôn ngữ sẽ đổi sang ${getLanguageName(languageCode)} khi tiếp tục`);
      } else if (isRecording && autoTranscribe) {
        // If recording and auto-transcribe is ON, restart transcription immediately
        message.loading({ content: `🌐 Đang chuyển sang ${getLanguageName(languageCode)}...`, key: 'langChange' });
        
        speechToTextService.stopTranscription();
        
        // Wait a bit for service to stop cleanly, then restart with new language
        setTimeout(async () => {
          if (autoTranscribe && navigator.onLine && audioStream) {
            try {
              await speechToTextService.startTranscription(audioStream, onNewTranscription);
              message.success({ 
                content: `✅ Đã chuyển sang ${getLanguageName(languageCode)}`, 
                key: 'langChange',
                duration: 2 
              });
            } catch (error: any) {
              console.error('Failed to restart transcription:', error);
              message.error({ 
                content: `⚠️ Không thể khởi động lại: ${error.message}`, 
                key: 'langChange',
                duration: 3 
              });
            }
          }
        }, 500);
      } else {
        message.success(`🌐 Đã chọn ${getLanguageName(languageCode)}`);
      }
    }
  };

  const getLanguageName = (code: string): string => {
    const languages: Record<string, string> = {
      'vi-VN': 'Tiếng Việt',
      'en-US': 'English (US)',
      'en-GB': 'English (UK)',
      'ja-JP': '日本語',
      'ko-KR': '한국어',
      'zh-CN': '中文 (简体)',
      'zh-TW': '中文 (繁體)',
      'fr-FR': 'Français',
      'de-DE': 'Deutsch',
      'es-ES': 'Español'
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
      message.error(`Lỗi khi dừng: ${error.message}`);
      setIsPaused(false);
      onRecordingChange(false);
    }
  };

  const sanitizeMeetingTitle = (title: string): string => {
    // Remove invalid characters for file/folder names: < > : " / \ | ? *
    let sanitized = title.replace(/[<>:"/\\|?*]/g, '_');
    // Replace multiple spaces/underscores with single underscore
    sanitized = sanitized.replace(/[\s_]+/g, '_');
    // Trim leading/trailing underscores
    sanitized = sanitized.replace(/^_+|_+$/g, '');
    // Limit length to 50 characters
    if (sanitized.length > 50) {
      sanitized = sanitized.substring(0, 50);
    }
    // Fallback if empty after sanitization
    return sanitized || 'Cuộc họp';
  };

  const handleStopRecording = async () => {
    try {
      setIsProcessing(true);
      const audioBlob = await recorder.stopRecording();
      const recordingDuration = recorder.getCurrentDuration();
      onRecordingChange(false);
      setIsPaused(false); // Reset pause state

      // If auto-transcription is active, wait for it to complete
      if (autoTranscribe && speechToTextService.isProcessing()) {
        message.loading({ content: '⏳ Đang chờ chuyển đổi giọng nói hoàn tất...', key: 'waitTranscription' });
        await speechToTextService.waitForCompletion(10000);
        message.success({ content: '✅ Chuyển đổi giọng nói hoàn tất', key: 'waitTranscription', duration: 2 });
      }

      // Note: audioStream is already stopped by recorder.stopRecording()
      setAudioStream(null);

      // No need to merge segments anymore - recording is continuous with silence during pauses
      const finalAudioBlob = audioBlob;
      const finalDuration = recordingDuration;

      // Process save recording (save files, metadata, transcription, Word doc)
      await processSaveRecording(finalAudioBlob, finalDuration, recordingStartTime);
      
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
    totalRecordingStartTime: number
  ) => {
    // Generate folder and file names with timestamp prefix and meeting title
    const now = new Date(totalRecordingStartTime);
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timePrefix = `${year}${month}${day}_${hours}${minutes}`;
    
    const sanitizedTitle = sanitizeMeetingTitle(meetingInfo.title || 'Meeting');
    const projectName = `${timePrefix}_${sanitizedTitle}`;
    const audioFileName = `${projectName}.webm`;

    // Save files
    if (FileManagerService.isSupported() && folderPath) {
      // Create project subdirectory and get its handle
      const originalHandle = fileManager.getDirHandle(); // Save original handle
      const projectDirHandle = await fileManager.createProjectDirectory(projectName);
      
      // Set dirHandle to project directory for main files
      fileManager.setDirHandle(projectDirHandle);
      
      // Save audio file (no need to backup segments - recording is continuous)
      await fileManager.saveAudioFile(finalAudioBlob, audioFileName, undefined, true);

      // Build and save metadata
      const metadata = MetadataBuilder.buildMetadata(
        meetingInfo,
        notes,
        timestampMap,
        speakersMap,
        finalDuration,
        audioFileName,
        totalRecordingStartTime
      );

      await fileManager.saveMetadataFile(
        metadata.meetingInfo,
        `${projectName}_meeting_info.json`,
        undefined,
        true
      );
      
      await fileManager.saveMetadataFile(
        metadata.metadata,
        `${projectName}_metadata.json`,
        undefined,
        true
      );

      // Save transcription data if available
      if (transcriptions && transcriptions.length > 0) {
        const transcriptionData = {
          transcriptions: transcriptions.filter(t => t.isFinal),
          totalCount: transcriptions.filter(t => t.isFinal).length,
          summary: geminiSummary || '', // Include summary
          savedAt: new Date().toISOString()
        };
        await fileManager.saveMetadataFile(
          transcriptionData,
          `${projectName}_transcription.json`,
          undefined,
          true
        );
        
        // Save raw transcripts for AI refinement
        const finalTranscriptions = transcriptions.filter(t => t.isFinal);
        const rawTranscriptsData = {
          rawTranscripts: finalTranscriptions.map(t => ({
            text: t.text,
            timestamp: t.startTime,
            audioTimeMs: t.audioTimeMs,
            confidence: t.confidence,
            isFinal: t.isFinal
          })),
          totalCount: finalTranscriptions.length,
          savedAt: new Date().toISOString()
        };
        await fileManager.saveMetadataFile(
          rawTranscriptsData,
          `${projectName}_rawTranscripts.json`,
          undefined,
          true
        );
      }

      // Export Word document to same folder
      const finalTranscriptions = transcriptions?.filter(t => t.isFinal) || [];
      const wordBlob = await WordExporter.createWordBlob(meetingInfo, notes, finalTranscriptions, speakersMap, geminiSummary);
      await fileManager.saveWordFile(wordBlob, `${projectName}.docx`, undefined, true);
      
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
        totalRecordingStartTime
      );

      await downloader.downloadMetadataFile(
        metadata.meetingInfo,
        `${projectName}_meeting_info.json`
      );
      await downloader.downloadMetadataFile(
        metadata.metadata,
        `${projectName}_metadata.json`
      );

      // Save transcription data if available
      if (transcriptions && transcriptions.length > 0) {
        const transcriptionData = {
          transcriptions: transcriptions.filter(t => t.isFinal),
          totalCount: transcriptions.filter(t => t.isFinal).length,
          summary: geminiSummary || '', // Include summary
          savedAt: new Date().toISOString()
        };
        await downloader.downloadMetadataFile(
          transcriptionData,
          `${projectName}_transcription.json`
        );

        // Save raw transcripts for AI refinement
        const rawTranscriptsData = {
          rawTranscripts: transcriptions.filter(t => t.isFinal).map(t => ({
            text: t.text,
            timestamp: t.startTime,
            audioTimeMs: t.audioTimeMs,
            confidence: t.confidence,
            isFinal: t.isFinal
          })),
          totalCount: transcriptions.filter(t => t.isFinal).length,
          savedAt: new Date().toISOString()
        };
        await downloader.downloadMetadataFile(
          rawTranscriptsData,
          `${projectName}_rawTranscripts.json`
        );
      }

      // Export Word document
      const finalTranscriptions = transcriptions?.filter(t => t.isFinal) || [];
      await WordExporter.exportToWord(
        meetingInfo,
        notes,
        `${projectName}.docx`,
        finalTranscriptions,
        speakersMap,
        geminiSummary
      );

      message.info('Files downloaded. Please save them to your meeting notes folder.');
      setLastProjectName(projectName);
      setLastRecordingDuration(finalDuration);
    }

    // Set audio for playback BEFORE calling onSaveComplete
    // to avoid triggering hasUnsavedChanges after save
    onAudioBlobChange(finalAudioBlob);
    
    // Call onSaveComplete LAST to properly reset hasUnsavedChanges flag
    onSaveComplete();
  };

  const handleSaveNotes = async () => {
    try {
      // Check if folder is selected, if not, prompt user to select
      if (!FileManagerService.isSupported()) {
        // Fallback: download files
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const timePrefix = `${year}${month}${day}_${hours}${minutes}`;
        
        const sanitizedTitle = sanitizeMeetingTitle(meetingInfo.title || 'Meeting');
        const projectName = `${timePrefix}_${sanitizedTitle}`;
        
        const downloader = new FileDownloadService();
        
        await downloader.downloadMetadataFile(
          meetingInfo,
          `${projectName}_meeting_info.json`
        );
        
        // Export Word document
        const finalTranscriptions = transcriptions?.filter(t => t.isFinal) || [];
        await WordExporter.exportToWord(
          meetingInfo,
          notes,
          `${projectName}.docx`,
          finalTranscriptions,
          speakersMap,
          geminiSummary
        );
        
        message.info('Tệp đã được tải xuống. Vui lòng lưu vào thư mục ghi chú cuộc họp của bạn.');
        setLastProjectName(projectName);
        onSaveComplete();
        return;
      }
      
      // Check if folder is selected
      if (!folderPath && !fileManager.getParentDirHandle() && !fileManager.getProjectDirHandle()) {
        // No folder selected, prompt user
        const folder = await fileManager.selectFolder();
        if (!folder) {
          message.info('Vui lòng chọn thư mục để lưu ghi chú.');
          return; // User cancelled
        }
        onFolderSelect(folder);
      }
      
      // Generate folder and file names with timestamp prefix and meeting title
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const timePrefix = `${year}${month}${day}_${hours}${minutes}`;
      
      const sanitizedTitle = sanitizeMeetingTitle(meetingInfo.title || 'Meeting');
      const projectName = `${timePrefix}_${sanitizedTitle}`;
      
      // Create project subdirectory and get its handle
      const originalHandle = fileManager.getDirHandle(); // Save original handle
      const projectDirHandle = await fileManager.createProjectDirectory(projectName);
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
        true
      );
      // console.log('✓ Saved meeting_info.json');
      
      // Create metadata using MetadataBuilder (same as recording mode)
      const metadata = MetadataBuilder.buildMetadata(
        meetingInfo,
        notes,
        timestampMap,
        speakersMap,
        0, // No audio duration for notes-only
        '', // No audio file
        recordingStartTime || Date.now() // Use recording start time if available, otherwise current time
      );
      
      // Override fields for notes-only mode
      metadata.metadata.Model = 'Notes Only';
      metadata.metadata.OriginalFileName = '';
      metadata.metadata.AudioFileName = '';
      metadata.metadata.Duration = '00:00:00.0000000';
      
      await fileManager.saveMetadataFile(
        metadata.metadata,
        `${projectName}_metadata.json`,
        undefined,
        true
      );
      // console.log('✓ Saved metadata.json');
      
      // Export Word document
      const finalTranscriptions = transcriptions?.filter(t => t.isFinal) || [];
      const wordBlob = await WordExporter.createWordBlob(meetingInfo, notes, finalTranscriptions, speakersMap, geminiSummary);
      await fileManager.saveWordFile(wordBlob, `${projectName}.docx`, undefined, true);
      // console.log('✓ Saved Word document');
      
      // Restore original handle
      if (originalHandle) {
        fileManager.setDirHandle(originalHandle);
      }
      
      message.success(`Notes saved to folder: ${projectName}`);
      setLastProjectName(projectName);
      onSaveComplete();
    } catch (error: any) {
      console.error('Save Notes Error:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
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
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const timePrefix = `${year}${month}${day}_${hours}${minutes}`;
      
      const sanitizedTitle = sanitizeMeetingTitle(meetingInfo.title || 'Meeting');
      const newProjectName = `${timePrefix}_${sanitizedTitle}`;
      
      // If no lastProjectName (e.g., after reload), notify user we're creating new version
      if (!lastProjectName) {
        message.info('Đang lưu dữ liệu đã khôi phục...');
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
          '', // No audio file
          recordingStartTime || Date.now()
        );
        
        // Override fields for notes-only mode
        metadata.metadata.Model = 'Notes Only';
        metadata.metadata.OriginalFileName = '';
        metadata.metadata.AudioFileName = '';
        metadata.metadata.Duration = '00:00:00.0000000';
      } else {
        // Recording project with audio
        const audioFileName = `${newProjectName}.webm`;
        metadata = MetadataBuilder.buildMetadata(
          meetingInfo,
          notes,
          timestampMap,
          speakersMap,
          lastRecordingDuration,
          audioFileName,
          recordingStartTime
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
        let saveLocation = '';
        
        // Check if user has manually selected a folder (prioritize user's explicit choice)
        const hasManualSelection = folderPath && !folderPath.includes('(parent of loaded project)') && !folderPath.includes('(loaded project folder)');
        
        if (hasManualSelection) {
          // User explicitly chose a folder via "Select Folder" - use it
          saveLocation = 'selected folder';
          // dirHandle is already set from selectFolder()
        } else if (parentDirHandle) {
          saveHandle = parentDirHandle;
          saveLocation = 'parent directory (same level as loaded project)';
        } else if (projectDirHandle) {
          saveHandle = projectDirHandle;
          saveLocation = 'inside loaded project folder';
        }
        
        if (saveHandle || folderPath) {
          // Set directory handle if we got one from loaded project
          const originalHandle = fileManager.getDirHandle(); // Save original handle
          if (saveHandle) {
            fileManager.setDirHandle(saveHandle);
          }
          
          // Create new project subdirectory and get its handle
          const projectDirHandle = await fileManager.createProjectDirectory(newProjectName);
          // console.log('✓ Created project directory:', newProjectName);
          
          // Temporarily set dirHandle to the project directory for saving files
          fileManager.setDirHandle(projectDirHandle);
          
          // Save audio file only if it exists (recording project)
          // Now save files directly to current directory (no subDir needed)
          if (audioBlob) {
            const audioFileName = `${newProjectName}.webm`;
            await fileManager.saveAudioFile(audioBlob, audioFileName, undefined, true);
            // console.log('✓ Saved audio file:', audioFileName);
          }

          // Save metadata files directly to project directory
          await fileManager.saveMetadataFile(
            metadata.meetingInfo,
            `${newProjectName}_meeting_info.json`,
            undefined,
            true
          );
          // console.log('✓ Saved meeting_info.json');
          
          await fileManager.saveMetadataFile(
            metadata.metadata,
            `${newProjectName}_metadata.json`,
            undefined,
            true
          );
          // console.log('✓ Saved metadata.json');

          // Save transcription data if available
          if (transcriptions && transcriptions.length > 0) {
            const finalTranscriptions = transcriptions.filter(t => t.isFinal);
            const transcriptionData = {
              transcriptions: finalTranscriptions, // Only save final results
              totalCount: finalTranscriptions.length,
              summary: geminiSummary || '', // Include summary
              savedAt: new Date().toISOString()
            };
            await fileManager.saveMetadataFile(
              transcriptionData,
              `${newProjectName}_transcription.json`,
              undefined,
              true
            );
            
            // Save raw transcripts for AI refinement
            const rawTranscriptsData = {
              rawTranscripts: finalTranscriptions.map(t => ({
                text: t.text,
                timestamp: t.startTime,
                audioTimeMs: t.audioTimeMs,
                confidence: t.confidence,
                isFinal: t.isFinal
              })),
              totalCount: finalTranscriptions.length,
              savedAt: new Date().toISOString()
            };
            await fileManager.saveMetadataFile(
              rawTranscriptsData,
              `${newProjectName}_rawTranscripts.json`,
              undefined,
              true
            );
            // console.log('💾 Transcription data saved in Save Changes:', transcriptionData.totalCount, 'items');
          }

          // Export Word document
          const finalTranscriptions = transcriptions?.filter(t => t.isFinal) || [];
          const wordBlob = await WordExporter.createWordBlob(meetingInfo, notes, finalTranscriptions, speakersMap, geminiSummary);
          await fileManager.saveWordFile(wordBlob, `${newProjectName}.docx`, undefined, true);
          // console.log('✓ Saved Word document');
          
          // Restore original handle
          if (originalHandle) {
            fileManager.setDirHandle(originalHandle);
          }

          message.success(`Changes saved to ${saveLocation}: ${newProjectName}`);
          setLastProjectName(newProjectName);
        } else {
          message.error('No save location available. Please use "Select Folder" first or load a project.');
          return; // Don't call onSaveComplete if save failed
        }
      } else {
        // Download updated files (fallback for unsupported browsers)
        const downloader = new FileDownloadService();
        
        // Download audio only if it exists
        if (audioBlob) {
          const audioFileName = `${newProjectName}.webm`;
          await downloader.downloadAudioFile(audioBlob, audioFileName);
        }
        
        await downloader.downloadMetadataFile(
          metadata.meetingInfo,
          `${newProjectName}_meeting_info.json`
        );
        
        await downloader.downloadMetadataFile(
          metadata.metadata,
          `${newProjectName}_metadata.json`
        );

        // Save transcription data if available
        if (transcriptions && transcriptions.length > 0) {
          const finalTranscriptions = transcriptions.filter(t => t.isFinal);
          const transcriptionData = {
            transcriptions: finalTranscriptions,
            totalCount: finalTranscriptions.length,
            savedAt: new Date().toISOString()
          };
          await downloader.downloadMetadataFile(
            transcriptionData,
            `${newProjectName}_transcription.json`
          );
          
          // Save raw transcripts for AI refinement
          const rawTranscriptsData = {
            rawTranscripts: finalTranscriptions.map(t => ({
              text: t.text,
              timestamp: t.startTime,
              audioTimeMs: t.audioTimeMs,
              confidence: t.confidence,
              isFinal: t.isFinal
            })),
            totalCount: finalTranscriptions.length,
            savedAt: new Date().toISOString()
          };
          await downloader.downloadMetadataFile(
            rawTranscriptsData,
            `${newProjectName}_rawTranscripts.json`
          );
          // console.log('💾 Transcription data downloaded in Save Changes:', transcriptionData.totalCount, 'items');
        }

        
        const finalTranscriptions = transcriptions?.filter(t => t.isFinal) || [];
        await WordExporter.exportToWord(
          meetingInfo,
          notes,
          `${newProjectName}.docx`,
          finalTranscriptions,
          speakersMap,
          geminiSummary
        );

        message.info('Updated files downloaded as new version.');
        setLastProjectName(newProjectName);
      }

      onSaveComplete(); // Notify parent that save is complete
    } catch (error: any) {
      console.error('Save Changes Error:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      message.error(`Lỗi khi lưu thay đổi (có thể do đường dẫn lưu file quá dài): ${error.message}`);
    }
  };

  const handleLoadProject = async () => {
    // console.log('handleLoadProject called');
    
    try {
      if (!FileManagerService.isSupported()) {
        // console.error('Browser not supported');
        message.error('Trình duyệt của bạn không hỗ trợ tải project. Vui lòng sử dụng Chrome hoặc Edge.');
        return;
      }

      // console.log('Checking unsaved changes...');
      if (hasUnsavedChanges) {
        const confirmed = window.confirm(
          'Bạn có dữ liệu chưa lưu. Tải project mới sẽ mất dữ liệu hiện tại. Tiếp tục?'
        );
        if (!confirmed) {
          // console.log('User cancelled due to unsaved changes');
          return;
        }
      }

      // console.log('Calling fileManager.loadProjectFromFolder...');
      const projectData = await fileManager.loadProjectFromFolder();
      
      // console.log('fileManager returned:', projectData);
      
      if (!projectData) {
        // console.log('User cancelled folder selection');
        return; // User cancelled
      }

      // Extract data (with rawTranscripts support)
      const { meetingInfo: meetingInfoData, metadata: metadataData, audioBlob, transcriptionData, rawTranscriptsData } = projectData;

      // Map PascalCase from saved files to camelCase for MeetingInfo
      const loadedMeetingInfo = {
        title: meetingInfoData.MeetingTitle || '',
        date: meetingInfoData.MeetingDate || '',
        time: meetingInfoData.MeetingTime || '',
        location: meetingInfoData.Location || '',
        host: meetingInfoData.Host || '',
        attendees: meetingInfoData.Attendees || ''
      };

      // console.log('📋 Mapping meetingInfo from file:', {
      //   rawData: meetingInfoData,
      //   mapped: loadedMeetingInfo
      // });
      
      // console.log('🔍 Individual field mapping:', {
      //   'MeetingTitle → title': `"${meetingInfoData.MeetingTitle}" → "${loadedMeetingInfo.title}"`,
      //   'MeetingDate → date': `"${meetingInfoData.MeetingDate}" → "${loadedMeetingInfo.date}"`,
      //   'MeetingTime → time': `"${meetingInfoData.MeetingTime}" → "${loadedMeetingInfo.time}"`,
      //   'Location → location': `"${meetingInfoData.Location}" → "${loadedMeetingInfo.location}"`,
      //   'Host → host': `"${meetingInfoData.Host}" → "${loadedMeetingInfo.host}"`,
      //   'Attendees → attendees': `"${meetingInfoData.Attendees}" → "${loadedMeetingInfo.attendees}"`
      // });

      // Parse metadata to reconstruct timestampMap, speakersMap and notes
      const timestampMapData = new Map<number, number>();
      const speakersMapData = new Map<number, string>();
      let notesText = '';
      
      // Get recording start time - prefer from metadata, fallback to calculation
      let recordingStart = Date.now();
      
      if (metadataData.RecordingStartTime) {
        // Use saved RecordingStartTime from metadata (chuẩn nhất)
        recordingStart = new Date(metadataData.RecordingStartTime).getTime();
        
        // console.log('🕐 Using RecordingStartTime from metadata:', {
        //   raw: metadataData.RecordingStartTime,
        //   parsed: new Date(recordingStart).toISOString(),
        //   timestamp: recordingStart
        // });
      } else if (metadataData.Timestamps && metadataData.Timestamps.length > 0) {
        // Fallback: Calculate from first timestamp (old projects without RecordingStartTime)
        const firstTimestamp = metadataData.Timestamps[0];
        const firstDatetime = new Date(firstTimestamp.DateTime).getTime();
        // Parse StartTime to get offset (format: HH:MM:SS.NNNNNNN with 7 decimal digits)
        const startTimeMatch = firstTimestamp.StartTime.match(/(\d+):(\d+):(\d+)\.(\d+)/);
        if (startTimeMatch) {
          const fractionalPart = startTimeMatch[4];
          // Convert to milliseconds: if 7 digits (e.g., 9900000), divide by 10000
          const ms = fractionalPart.length === 7 ? parseInt(fractionalPart) / 10000 : parseInt(fractionalPart);
          const offsetMs = parseInt(startTimeMatch[1]) * 3600000 + 
                          parseInt(startTimeMatch[2]) * 60000 + 
                          parseInt(startTimeMatch[3]) * 1000 + 
                          ms;
          recordingStart = firstDatetime - offsetMs;
          
          // console.log('🕐 Calculated RecordingStartTime from first block:', {
          //   raw: firstTimestamp.StartTime,
          //   fractionalPart,
          //   parsedMs: ms,
          //   totalOffsetMs: offsetMs,
          //   firstDatetime: new Date(firstDatetime).toISOString(),
          //   calculatedRecordingStart: new Date(recordingStart).toISOString()
          // });
        }
      }
      
      if (metadataData.Timestamps && Array.isArray(metadataData.Timestamps)) {
        // Reconstruct notes from Timestamps array
        const BLOCK_SEPARATOR = '§§§';
        const sortedTimestamps = metadataData.Timestamps.sort((a: any, b: any) => a.Index - b.Index);
        
        sortedTimestamps.forEach((ts: any, index: number) => {
          // Add BLOCK_SEPARATOR before text (except for first line)
          if (index > 0) {
            notesText += BLOCK_SEPARATOR;
          }
          
          // Calculate position at start of this block (after separator if not first)
          const position = notesText.length;
          
          // Parse StartTime (relative time) from metadata and convert to absolute datetime
          // StartTime format: HH:MM:SS.NNNNNNN (7 decimal digits)
          let startTimeMs = 0;
          const startTimeMatch = ts.StartTime.match(/(\d+):(\d+):(\d+)\.(\d+)/);
          if (startTimeMatch) {
            const hours = parseInt(startTimeMatch[1]);
            const minutes = parseInt(startTimeMatch[2]);
            const seconds = parseInt(startTimeMatch[3]);
            const fractionalPart = startTimeMatch[4];
            // Convert to milliseconds: if 7 digits, divide by 10000
            const ms = fractionalPart.length === 7 ? parseInt(fractionalPart) / 10000 : parseInt(fractionalPart);
            startTimeMs = hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
          }
          
          // Convert relative time to absolute datetime using RecordingStartTime
          const datetime = recordingStart + startTimeMs;
          timestampMapData.set(position, datetime);
          
          // Store speaker name using lineIndex (which equals index in sorted array)
          // Each timestamp entry corresponds to one line in the reconstructed notes
          if (ts.Speaker) {
            speakersMapData.set(index, ts.Speaker);
            // console.log(`📢 Loading speaker for line ${index}:`, ts.Speaker);
          }
          
          // Add text to notes
          notesText += ts.Text || '';
        });
        
        // console.log('🕐 Timestamp reconstruction:', {
        //   recordingStart,
        //   firstTimestamp: sortedTimestamps[0]?.DateTime,
        //   firstStartTime: sortedTimestamps[0]?.StartTime,
        //   timestampCount: timestampMapData.size,
        //   speakerCount: speakersMapData.size,
        //   speakers: Array.from(speakersMapData.entries()),
        //   sampleTimestamps: Array.from(timestampMapData.entries()).slice(0, 3).map(([pos, time]) => ({
        //     position: pos,
        //     datetime: new Date(time).toISOString(),
        //     relativeMs: time - recordingStart,
        //     relativeFormatted: `${String(Math.floor((time - recordingStart) / 3600000)).padStart(2, '0')}:${String(Math.floor(((time - recordingStart) % 3600000) / 60000)).padStart(2, '0')}:${String(Math.floor(((time - recordingStart) % 60000) / 1000)).padStart(2, '0')}`
        //   }))
        // });
      }

      // Parse duration string to milliseconds (format: HH:MM:SS.NNNNNNN with 7 decimal digits)
      let durationMs = 0;
      if (metadataData.Duration) {
        const durationStr = metadataData.Duration;
        const match = durationStr.match(/(\d+):(\d+):(\d+)\.(\d+)/);
        if (match) {
          const hours = parseInt(match[1]);
          const minutes = parseInt(match[2]);
          const seconds = parseInt(match[3]);
          const fractionalPart = match[4];
          // Convert to milliseconds: if 7 digits, divide by 10000
          const ms = fractionalPart.length === 7 ? parseInt(fractionalPart) / 10000 : parseInt(fractionalPart);
          durationMs = hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
        }
      }

      // Call parent handler to update all state (recordingStart already calculated above)
      onLoadProject({
        meetingInfo: loadedMeetingInfo,
        notes: notesText,
        timestampMap: timestampMapData,
        speakersMap: speakersMapData,
        audioBlob: audioBlob,
        recordingStartTime: recordingStart,
        transcriptions: transcriptionData?.transcriptions || [], // Pass transcriptions array
        rawTranscripts: rawTranscriptsData?.rawTranscripts || [], // Pass raw transcripts for AI refinement
        summary: transcriptionData?.summary || '' // Pass summary if available
      });

      // Show message if transcriptions loaded
      if (transcriptionData?.transcriptions && transcriptionData.transcriptions.length > 0) {
        message.success(`Loaded ${transcriptionData.transcriptions.length} transcription results`);
      }

      // console.log('Load complete:', {
      //   meetingInfo: loadedMeetingInfo,
      //   notesLength: notesText.length,
      //   timestampCount: timestampMapData.size,
      //   timestampMap: Array.from(timestampMapData.entries()),
      //   recordingStart
      // });

      // Update local state
      setLastProjectName(projectData.projectName);
      setLastRecordingDuration(durationMs);

      // Update folder path display to show where files will be saved
      // Priority: Parent folder > Project folder
      const parentHandle = fileManager.getParentDirHandle();
      const projectHandle = fileManager.getProjectDirHandle();
      
      if (parentHandle) {
        onFolderSelect(parentHandle.name + ' (parent of loaded project)');
      } else if (projectHandle) {
        onFolderSelect(projectHandle.name + ' (loaded project folder)');
      }

      message.success(`Project loaded: ${projectData.projectName}`);
    } catch (error: any) {
      console.error('Load project error:', error);
      message.error(`Failed to load project: ${error.message}`);
    }
  };

  const formatDuration = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="recording-controls">
      {/* Row 1: File Management & Configuration */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <Space size="middle" wrap>
          <Button
            icon={<FolderOpenOutlined />}
            onClick={handleSelectFolder}
            disabled={isRecording}
            size="large"
          >
            Chọn thư mục
          </Button>

          <Button
            icon={<FolderAddOutlined />}
            onClick={() => {
              handleLoadProject();
            }}
            disabled={isRecording || !FileManagerService.isSupported()}
            size="large"
            type="default"
          >
            Tải dự án đã lưu
          </Button>

          {/* Show Save Notes button when has unsaved data but not saved yet */}
          {!isRecording && !isSaved && hasUnsavedChanges && (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveNotes}
              size="large"
            >
              Lưu ghi chú
            </Button>
          )}

          {/* Show Save Changes button when has unsaved changes after first save */}
          {!isRecording && isSaved && hasUnsavedChanges && (
            <Button
              type="default"
              icon={<SaveOutlined />}
              onClick={handleSaveChanges}
              size="large"
              style={{ backgroundColor: '#52c41a', color: 'white', borderColor: '#52c41a' }}
            >
              Lưu thay đổi
            </Button>
          )}

          {/* Folder path display */}
          {folderPath && (
            <span style={{ fontSize: '13px', color: '#666' }}>
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
            size="large"
            className={!transcriptionConfig ? 'blink-btn' : ''}
            style={{ marginLeft: 'auto' }}
          >
            Cấu hình
          </Button>
        )}
      </div>

      {/* Row 2: Recording Controls & Transcription */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        {/* Left: Recording Controls */}
        <Space size="middle" wrap>
          {!isRecording ? (
            <>
              <Button
                type="primary"
                danger
                icon={<AudioOutlined />}
                onClick={handleStartRecording}
                size="large"
                disabled={isProcessing || audioBlob !== null}
              >
                Ghi âm
              </Button>
              
              {isProcessing && (
                <span style={{ marginLeft: '12px', color: '#1890ff', fontWeight: 600 }}>
                  ⏳ Đang xử lý...
                </span>
              )}
              
              {audioBlob !== null && !isProcessing && (
                <span style={{ fontSize: '13px', color: '#999', fontStyle: 'italic' }}>
                  💡 Tải lại trang web này để bắt đầu Dự án mới (nếu cần)
                </span>
              )}
            </>
          ) : isPaused ? (
            <>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleResumeRecording}
                size="large"
                style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
              >
                Tiếp tục
              </Button>
              <Button
                type="primary"
                icon={<StopOutlined />}
                onClick={handleStopFromPause}
                size="large"
                danger
              >
                Dừng hẳn
              </Button>
            </>
          ) : (
            <>
              <Button
                type="default"
                icon={<PauseCircleOutlined />}
                onClick={handlePauseRecording}
                size="large"
              >
                Tạm dừng
              </Button>
              <Button
                type="primary"
                icon={<StopOutlined />}
                onClick={handleStopRecording}
                size="large"
                danger
              >
                Dừng
              </Button>
            </>
          )}

          <span className="duration-display">⏱ {formatDuration(duration)}</span>
          
          {isRecording && !isPaused && (
            <span className="recording-indicator">🔴 Đang ghi âm...</span>
          )}
          
          {isPaused && (
            <span className="paused-indicator">⏸️ Đã tạm dừng</span>
          )}
        </Space>

        {/* Right: Speech-to-Text Controls - Only show when online */}
        {navigator.onLine && transcriptionConfig && (
          <Space size="middle" wrap style={{ marginLeft: 'auto' }}>
            <Tooltip title={
              (isRecording && !isPaused)
                ? 'Bật/tắt chuyển đổi giọng nói sang văn bản tự động' 
                : isPaused
                  ? 'Thay đổi sẽ có hiệu lực khi tiếp tục ghi âm'
                  : 'Chỉ khả dụng khi đang ghi âm'
            }>
              <Space>
                <SoundOutlined style={{ fontSize: '18px', color: autoTranscribe ? '#52c41a' : '#999' }} />
                <span style={{ fontSize: '14px' }}>Auto 🎤 → 🔠:</span>
                <Switch
                  checked={autoTranscribe}
                  onChange={(checked) => {
                    setAutoTranscribe(checked);
                  }}
                  disabled={isRecording && !isPaused}
                  checkedChildren="ON"
                  unCheckedChildren="OFF"
                />
              </Space>
            </Tooltip>

            {/* Language Quick Selector */}
            <Tooltip title={
              isRecording && !isPaused
                ? '🔄 Đổi ngôn ngữ ngay - Chuyển đổi giọng nói sẽ khởi động lại (ghi âm không bị gián đoạn)'
                : isPaused
                  ? 'Thay đổi sẽ có hiệu lực khi tiếp tục ghi âm'
                  : 'Chọn ngôn ngữ để chuyển đổi giọng nói'
            }>
              <Select
                value={selectedLanguage}
                onChange={handleLanguageChange}
                style={{ width: 180 }}
                size="large"
                suffixIcon={<GlobalOutlined />}
                disabled={false}
              >
                <Select.Option value="vi-VN">🇻🇳 Tiếng Việt</Select.Option>
                <Select.Option value="en-US">🇺🇸 English (US)</Select.Option>
                <Select.Option value="en-GB">🇬🇧 English (UK)</Select.Option>
                <Select.Option value="ja-JP">🇯🇵 日本語</Select.Option>
                <Select.Option value="ko-KR">🇰🇷 한국어</Select.Option>
                <Select.Option value="zh-CN">🇨🇳 中文 (简)</Select.Option>
                <Select.Option value="zh-TW">🇹🇼 中文 (繁)</Select.Option>
                <Select.Option value="fr-FR">🇫🇷 Français</Select.Option>
                <Select.Option value="de-DE">🇩🇪 Deutsch</Select.Option>
                <Select.Option value="es-ES">🇪🇸 Español</Select.Option>
              </Select>
            </Tooltip>
          </Space>
        )}
        
        {/* Show hint when transcription not configured */}
        {navigator.onLine && !transcriptionConfig && (
          <span style={{ fontSize: '13px', color: '#999', fontStyle: 'italic', marginLeft: 'auto' }}>
            ℹ️Cấu hình để sử dụng
          </span>
        )}
      </div>

      {!FileManagerService.isSupported() && (
        <div className="browser-warning">
          ⚠️ Trình duyệt của bạn không hỗ trợ truy cập thư mục trực tiếp. Các file sẽ được tải về.
        </div>
      )}
    </div>
  );
};
