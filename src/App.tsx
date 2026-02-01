import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MetadataPanel } from './components/MetadataPanel';
import { RecordingControls } from './components/RecordingControls';
import { NotesEditor } from './components/NotesEditor';
import { AudioPlayer, AudioPlayerRef } from './components/AudioPlayer';
import { HelpButton } from './components/HelpButton';
import { TranscriptionConfig } from './components/TranscriptionConfig';
import { TranscriptionPanel } from './components/TranscriptionPanel';
import { MeetingSummaryPanel } from './components/MeetingSummaryPanel';
import { FileManagerService } from './services/fileManager';
import { saveBackup, loadBackup, clearBackup, hasBackup, getBackupAge } from './services/autoBackup';
import { speechToTextService, SpeechToTextService } from './services/speechToText';
import { AIRefinementService, type RawTranscriptData } from './services/aiRefinement';
import type { MeetingInfo, SpeechToTextConfig, TranscriptionResult } from './types/types';
import { message, Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import './styles/global.css';

export const App: React.FC = () => {
  const [folderPath, setFolderPath] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [meetingInfo, setMeetingInfo] = useState<MeetingInfo>({
    title: '',
    date: new Date().toISOString().split('T')[0],
    time: new Date().toTimeString().slice(0, 5),
    location: '',
    host: '',
    attendees: ''
  });
  const [notes, setNotes] = useState<string>('');
  const [timestampMap, setTimestampMap] = useState<Map<number, number>>(new Map());
  const [speakersMap, setSpeakersMap] = useState<Map<number, string>>(new Map());
  const [recordingStartTime, setRecordingStartTime] = useState<number>(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [savedNotesSnapshot, setSavedNotesSnapshot] = useState<string>('');
  const [savedSpeakersSnapshot, setSavedSpeakersSnapshot] = useState<Map<number, string>>(new Map());
  const [savedTranscriptionsSnapshot, setSavedTranscriptionsSnapshot] = useState<TranscriptionResult[]>([]);
  const [isLiveMode, setIsLiveMode] = useState(true); // true = live recording, false = loaded project
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [backupAge, setBackupAge] = useState<number | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioPlayerRef = useRef<AudioPlayerRef>(null);
  
  // Speech-to-Text states
  const [showTranscriptionConfig, setShowTranscriptionConfig] = useState(false);
  const [transcriptionConfig, setTranscriptionConfig] = useState<SpeechToTextConfig | null>(null);
  const [transcriptions, setTranscriptions] = useState<TranscriptionResult[]>([]);
  const [rawTranscripts, setRawTranscripts] = useState<RawTranscriptData[]>([]); // Raw data from Web Speech API
  const [geminiSummary, setGeminiSummary] = useState<string | undefined>(undefined); // Summary from Gemini AI
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Check browser compatibility
  useEffect(() => {
    if (!FileManagerService.isSupported()) {
      console.warn(
        'File System Access API not supported. Files will be downloaded instead.'
      );
    }
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
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
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
    const maxDurationMinutes = config?.maxAudioDurationMinutes || 60;

    // Show options modal: Auto-split vs Manual selection
    Modal.confirm({
      title: (
        <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#fa8c16' }}>
          ⚠️ File audio quá lớn
        </span>
      ),
      width: 700,
      icon: <ExclamationCircleOutlined style={{ color: '#fa8c16' }} />,
      content: (
        <div style={{ marginTop: 16 }}>
          <div style={{ 
            padding: '16px', 
            background: '#fff7e6',
            border: '2px solid #ffd591',
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '15px', marginBottom: '12px' }}>
              <strong>📊 Thông tin file:</strong><br />
              • Thời lượng: <span style={{ fontWeight: 'bold' }}>{durationMinutes}:{String(durationSeconds).padStart(2, '0')}</span> (≈ {Math.ceil(audioDurationSec / 60)} phút)<br />
              • Kích thước hiện tại: <span style={{ color: '#fa8c16', fontWeight: 'bold' }}>{fileSizeMB.toFixed(2)} MB</span><br />
              • Giới hạn Gemini: <span style={{ color: '#52c41a', fontWeight: 'bold' }}>≤ {maxSizeMB} MB</span> và <span style={{ color: '#52c41a', fontWeight: 'bold' }}>≤ {maxDurationMinutes} phút</span>
            </div>
            <div style={{ fontSize: '13px', color: '#666' }}>
              💡 File vượt quá giới hạn của Gemini API
            </div>
          </div>

          <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px', color: '#1890ff' }}>
            🎯 Chọn phương án xử lý:
          </div>

          {/* Option 1: Auto-split entire file */}
          <div style={{ 
            padding: '16px', 
            background: 'linear-gradient(135deg, #667eea22 0%, #764ba222 100%)',
            border: '2px solid #667eea',
            borderRadius: '8px',
            marginBottom: '16px',
            cursor: 'pointer'
          }}
          onClick={() => {
            Modal.destroyAll();
            handleAutoSplitTranscription();
          }}
          >
            <div style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '8px', color: '#667eea' }}>
              <span style={{ fontSize: '20px' }}>🤖</span> Phương án 1: Chuyển đổi toàn bộ file (Tự động)
            </div>
            <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
              • Hệ thống tự động chia file thành các phần nhỏ (≤ {maxSizeMB}MB)<br />
              • Gửi lần lượt đến Gemini AI (tuân thủ 15 req/min, 1500 req/day)<br />
              • Tự động gộp và sắp xếp kết quả theo timeline<br />
              • <strong style={{ color: '#52c41a' }}>✅ Khuyên dùng:</strong> Tiết kiệm thời gian, xử lý toàn bộ nội dung
            </div>
          </div>

          {/* Option 2: Manual segment selection */}
          <div style={{ 
            padding: '16px', 
            background: '#f0f5ff',
            border: '2px solid #91d5ff',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
          onClick={() => {
            Modal.destroyAll();
            showManualSegmentSelectionModal(fileSizeMB, maxSizeMB);
          }}
          >
            <div style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '8px', color: '#1890ff' }}>
              <span style={{ fontSize: '20px' }}>✂️</span> Phương án 2: Chọn đoạn thủ công
            </div>
            <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
              • Bạn tự chọn khoảng thời gian cụ thể cần chuyển đổi<br />
              • Phù hợp khi chỉ cần transcribe một phần quan trọng<br />
              • Tiết kiệm quota API nếu chỉ cần xử lý đoạn ngắn<br />
              • Có thể chọn nhiều đoạn khác nhau trong cùng file
            </div>
          </div>

          <div style={{ 
            padding: '12px', 
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            borderRadius: '6px',
            fontSize: '13px',
            color: '#666',
            marginTop: '16px'
          }}>
            <strong>💡 Gợi ý:</strong> Nếu cần toàn bộ nội dung cuộc họp, chọn Phương án 1. Nếu chỉ cần một phần, chọn Phương án 2.
          </div>
        </div>
      ),
      okText: 'Đóng',
      cancelButtonProps: { style: { display: 'none' } },
      okButtonProps: { size: 'large', style: { height: '40px' } }
    });
  };

  // Function to show manual segment selection modal
  const showManualSegmentSelectionModal = (fileSizeMB: number, maxSizeMB: number) => {
    if (!audioBlob) return;

    const audioDurationMs = audioPlayerRef.current?.getDuration() || 0;
    const audioDurationSec = Math.floor(audioDurationMs / 1000);
    const durationMinutes = Math.floor(audioDurationSec / 60);
    const durationSeconds = audioDurationSec % 60;

    let startTimeInput: HTMLInputElement | null = null;
    let endTimeInput: HTMLInputElement | null = null;

    Modal.confirm({
      title: (
        <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#1890ff' }}>
          ✂️ Chọn đoạn cần chuyển đổi
        </span>
      ),
      width: 600,
      icon: null,
      content: (
        <div style={{ marginTop: 16 }}>
          <div style={{ 
            padding: '16px', 
            background: '#e6f7ff',
            border: '1px solid #91d5ff',
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '15px', marginBottom: '12px' }}>
              <strong>📊 Thông tin file:</strong><br />
              • Kích thước: <span style={{ fontWeight: 'bold' }}>{fileSizeMB.toFixed(2)} MB</span> / {maxSizeMB} MB<br />
              • Thời lượng: <span style={{ fontWeight: 'bold' }}>{durationMinutes}:{String(durationSeconds).padStart(2, '0')}</span>
            </div>
          </div>

          <div style={{
            padding: '12px',
            background: '#f0f5ff',
            border: '1px dashed #adc6ff',
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '13px',
            color: '#1890ff'
          }}>
            🎵 <strong>Mẹo:</strong> Phát audio và pause ở vị trí muốn chọn, rồi xem thời gian trên audio player để nhập chính xác!
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 'bold' }}>
              ⏱️ Thời gian bắt đầu (phút:giây)
            </label>
            <input
              ref={(el) => (startTimeInput = el)}
              type="text"
              placeholder="VD: 5:30 hoặc 0:00"
              defaultValue="0:00"
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #d9d9d9',
                borderRadius: '4px',
                outline: 'none'
              }}
              onFocus={(e) => e.target.style.borderColor = '#1890ff'}
              onBlur={(e) => e.target.style.borderColor = '#d9d9d9'}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 'bold' }}>
              ⏱️ Thời gian kết thúc (phút:giây)
            </label>
            <input
              ref={(el) => (endTimeInput = el)}
              type="text"
              placeholder={`VD: ${durationMinutes}:${String(durationSeconds).padStart(2, '0')}`}
              defaultValue={`${durationMinutes}:${String(durationSeconds).padStart(2, '0')}`}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #d9d9d9',
                borderRadius: '4px',
                outline: 'none'
              }}
              onFocus={(e) => e.target.style.borderColor = '#1890ff'}
              onBlur={(e) => e.target.style.borderColor = '#d9d9d9'}
            />
          </div>

          <div style={{ 
            padding: '12px', 
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            borderRadius: '6px',
            fontSize: '13px',
            color: '#666'
          }}>
            <strong>📝 Lưu ý:</strong> Kết quả sẽ được gắn timestamp chính xác theo thời gian bạn chọn
          </div>
        </div>
      ),
      okText: '✂️ Chuyển đổi đoạn đã chọn',
      cancelText: 'Quay lại',
      okButtonProps: { size: 'large', style: { height: '40px' } },
      cancelButtonProps: { size: 'large', style: { height: '40px' } },
      onOk: async () => {
        await handleManualSegmentTranscription(startTimeInput, endTimeInput, maxSizeMB);
      },
      onCancel: () => {
        // Go back to options modal
        showSegmentSelectionModal(fileSizeMB, maxSizeMB);
      }
    });
  };

  // Handler for auto-split transcription
  const handleAutoSplitTranscription = async () => {
    if (!audioBlob) return;

    const config = speechToTextService.getConfig();
    if (!config || !config.geminiApiKey || !config.geminiModel) {
      message.error('Vui lòng cấu hình Gemini API Key và Model trong Settings');
      return;
    }

    // Get config values with defaults
    const maxFileSizeMB = config.maxFileSizeMB || 20;
    const requestDelaySeconds = config.requestDelaySeconds || 5;
    const maxDurationMinutes = config.maxAudioDurationMinutes || 60;

    let progressModal: any = null;
    let currentProgress = 0;
    let currentMessage = '';

    try {
      // Show progress modal
      progressModal = Modal.info({
        title: '🤖 Đang xử lý toàn bộ file...',
        width: 600,
        closable: false,
        maskClosable: false,
        okButtonProps: { style: { display: 'none' } },
        content: (
          <div style={{ marginTop: 16 }}>
            <div style={{ 
              padding: '16px', 
              background: 'linear-gradient(135deg, #667eea22 0%, #764ba222 100%)',
              borderRadius: '8px',
              marginBottom: '16px'
            }}>
              <div style={{ marginBottom: '12px', fontSize: '14px', fontWeight: 'bold' }}>
                <span id="progress-message">{currentMessage}</span>
              </div>
              <div style={{ 
                width: '100%', 
                height: '24px', 
                background: '#f0f0f0', 
                borderRadius: '12px',
                overflow: 'hidden'
              }}>
                <div 
                  id="progress-bar"
                  style={{ 
                    width: `${currentProgress}%`, 
                    height: '100%', 
                    background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
                    transition: 'width 0.3s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}
                >
                  {currentProgress > 5 ? `${currentProgress.toFixed(0)}%` : ''}
                </div>
              </div>
            </div>
            <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
              💡 <strong>Lưu ý:</strong><br />
              • Hệ thống đang tự động chia file và xử lý từng phần<br />
              • Có delay {requestDelaySeconds}s giữa các phần để tuân thủ rate limit<br />
              • Vui lòng không đóng trình duyệt
            </div>
          </div>
        )
      });

      // Start transcription with progress callback and config values
      // Calculate meeting start time from meetingInfo
      const meetingStartTime = new Date(`${meetingInfo.date}T${meetingInfo.time}:00`);
      console.log('📅 Meeting info:', meetingInfo);
      console.log('📅 Meeting date:', meetingInfo.date);
      console.log('📅 Meeting time:', meetingInfo.time);
      console.log('📅 Meeting start time:', meetingStartTime);
      console.log('📅 Is valid date?', !isNaN(meetingStartTime.getTime()));
      
      const parsed = await AIRefinementService.transcribeEntireAudioWithGemini(
        config.geminiApiKey,
        audioBlob,
        config.geminiModel,
        (progress, msg) => {
          currentProgress = progress;
          currentMessage = msg;
          
          // Update UI
          const progressBar = document.getElementById('progress-bar');
          const progressMessage = document.getElementById('progress-message');
          if (progressBar) {
            progressBar.style.width = `${progress}%`;
            progressBar.textContent = progress > 5 ? `${progress.toFixed(0)}%` : '';
          }
          if (progressMessage) {
            progressMessage.textContent = msg;
          }
        },
        maxFileSizeMB,
        requestDelaySeconds,
        maxDurationMinutes,
        meetingStartTime,
        config.summaryPrompt
      );

      progressModal.destroy();
      
      // Save summary
      if (parsed.summary) {
        console.log('📋 Received summary from Gemini:', parsed.summary);
        setGeminiSummary(parsed.summary);
      }

      // Show merge/replace options modal
      showMergeOrReplaceModal(parsed.results);

    } catch (error: any) {
      if (progressModal) progressModal.destroy();
      Modal.error({
        title: '❌ Lỗi chuyển đổi',
        width: 480,
        content: (
          <div style={{ marginTop: 16 }}>
            <div style={{ 
              padding: '12px 16px',
              background: '#fff2f0',
              border: '1px solid #ffccc7',
              borderRadius: '6px',
              marginBottom: '12px'
            }}>
              <div style={{ color: '#cf1322', fontSize: '14px', wordBreak: 'break-word' }}>
                {error.message}
              </div>
            </div>
          </div>
        ),
        okText: 'Đóng'
      });
      console.error('Auto-split transcription error:', error);
    }
  };

  // Handler for manual segment transcription  
  const handleManualSegmentTranscription = async (
    startTimeInput: HTMLInputElement | null,
    endTimeInput: HTMLInputElement | null,
    maxSizeMB: number
  ) => {
    if (!audioBlob || !startTimeInput || !endTimeInput) {
      message.error('Thiếu thông tin cần thiết');
      return;
    }

    const audioDurationMs = audioPlayerRef.current?.getDuration() || 0;
    const audioDurationSec = Math.floor(audioDurationMs / 1000);
    const durationMinutes = Math.floor(audioDurationSec / 60);
    const durationSeconds = audioDurationSec % 60;

    // Parse time input (format: "mm:ss" or "m:ss")
    const parseTime = (timeStr: string): number => {
      const parts = timeStr.trim().split(':');
      if (parts.length !== 2) {
        throw new Error('Định dạng thời gian không hợp lệ');
      }
      const minutes = parseInt(parts[0]);
      const seconds = parseInt(parts[1]);
      if (isNaN(minutes) || isNaN(seconds)) {
        throw new Error('Thời gian phải là số');
      }
      return (minutes * 60 + seconds) * 1000; // Convert to milliseconds
    };

    try {
      const startMs = parseTime(startTimeInput.value);
      const endMs = parseTime(endTimeInput.value);

      if (startMs >= endMs) {
        message.error('Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc');
        return;
      }

      if (endMs > audioDurationMs) {
        message.error(`Thời gian kết thúc không được vượt quá ${durationMinutes}:${String(durationSeconds).padStart(2, '0')}`);
        return;
      }

      // Show processing modal
      const hideLoading = message.loading('✂️ Đang cắt đoạn audio...', 0);

      try {
        // Extract audio segment
        const segmentBlob = await AIRefinementService.extractAudioSegment(
          audioBlob,
          startMs,
          endMs
        );

        hideLoading();

        const segmentSizeMB = segmentBlob.size / (1024 * 1024);
        console.log(`✂️ Segment extracted: ${segmentSizeMB.toFixed(2)} MB`);

        if (segmentBlob.size > maxSizeMB * 1024 * 1024) {
          message.error(
            `Đoạn đã chọn vẫn quá lớn (${segmentSizeMB.toFixed(2)} MB). ` +
            `Vui lòng chọn khoảng thời gian ngắn hơn.`
          );
          return;
        }

        // Transcribe the segment
        const config = speechToTextService.getConfig();
        if (!config) return;

        const hideProcessing = message.loading('🤖 Đang chuyển đổi đoạn audio...', 0);

        try {
          const maxFileSizeMB = config.maxFileSizeMB || 20;
          const meetingStartTime = new Date(`${meetingInfo.date}T${meetingInfo.time}:00`);
          
          const parsed = await AIRefinementService.transcribeAudioWithGemini(
            config.geminiApiKey!,
            segmentBlob,
            config.geminiModel!,
            undefined,
            false,
            maxFileSizeMB,
            meetingStartTime,
            config.summaryPrompt
          );

          // Adjust timestamps to match original audio
          const adjustedResults = AIRefinementService.adjustTimestamps(
            parsed.results,
            startMs
          );

          hideProcessing();
          
          // Save summary if available
          if (parsed.summary) {
            console.log('📋 Received summary from segment:', parsed.summary);
            setGeminiSummary(parsed.summary);
          }

          // Show merge/replace options modal
          showMergeOrReplaceModal(adjustedResults);

        } catch (error: any) {
          hideProcessing();
          message.error(`Lỗi chuyển đổi: ${error.message}`);
          console.error('Transcription error:', error);
        }

      } catch (error: any) {
        hideLoading();
        message.error(`Lỗi cắt audio: ${error.message}`);
        console.error('Audio extraction error:', error);
      }

    } catch (error: any) {
      message.error(error.message);
    }
  };

  // Show modal to ask user: merge or replace?
  const showMergeOrReplaceModal = (newResults: TranscriptionResult[]) => {
    Modal.confirm({
      title: (
        <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#52c41a' }}>
          ✅ Chuyển đổi thành công!
        </span>
      ),
      width: 600,
      icon: null,
      content: (
        <div style={{ marginTop: 16 }}>
          <div style={{ 
            padding: '16px', 
            background: 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)',
            borderRadius: '8px',
            color: 'white',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '8px' }}>
              📊 Kết quả chuyển đổi:
            </div>
            <div style={{ fontSize: '14px' }}>
              🤖 {newResults.length} đoạn văn bản từ Gemini AI
            </div>
          </div>

          <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px', color: '#1890ff' }}>
            💾 Chọn cách xử lý dữ liệu:
          </div>

          {/* Option 1: Merge */}
          <div style={{ 
            padding: '16px', 
            background: '#f0f5ff',
            border: '2px solid #1890ff',
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '8px', color: '#1890ff' }}>
              <span style={{ fontSize: '20px' }}>🔄</span> Gộp vào dữ liệu hiện tại
            </div>
            <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
              • Giữ nguyên {transcriptions.length} đoạn cũ<br />
              • Thêm {newResults.length} đoạn mới từ AI<br />
              • Tự động sắp xếp theo thời gian (timeline)<br />
              • <strong style={{ color: '#52c41a' }}>✅ Khuyên dùng:</strong> Khi bạn đã có transcription và muốn bổ sung
            </div>
          </div>

          {/* Option 2: Replace */}
          <div style={{ 
            padding: '16px', 
            background: '#fff7e6',
            border: '2px solid #fa8c16',
            borderRadius: '8px'
          }}>
            <div style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '8px', color: '#fa8c16' }}>
              <span style={{ fontSize: '20px' }}>🔁</span> Thay thế toàn bộ dữ liệu cũ
            </div>
            <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
              • <strong style={{ color: '#fa8c16' }}>⚠️ Xóa {transcriptions.length} đoạn cũ</strong><br />
              • Chỉ giữ lại {newResults.length} đoạn mới từ AI<br />
              • Dùng khi transcription cũ kém chất lượng<br />
              • <strong style={{ color: '#ff4d4f' }}>Cảnh báo:</strong> Không thể hoàn tác!
            </div>
          </div>

          <div style={{ 
            padding: '12px', 
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            borderRadius: '6px',
            fontSize: '13px',
            color: '#666',
            marginTop: '16px'
          }}>
            💡 <strong>Gợi ý:</strong> Nếu bạn chưa chắc, hãy chọn "Gộp" để không mất dữ liệu cũ.
          </div>
        </div>
      ),
      okText: '🔄 Gộp vào dữ liệu cũ',
      cancelText: '🔁 Thay thế toàn bộ',
      okButtonProps: { size: 'large', style: { height: '40px' } },
      cancelButtonProps: { size: 'large', style: { height: '40px', background: '#fa8c16', borderColor: '#fa8c16', color: 'white' } },
      onOk: () => {
        // Merge: Sort and add to existing
        setTranscriptions(prev => {
          const merged = [...prev, ...newResults];
          return merged.sort((a, b) => (a.audioTimeMs || 0) - (b.audioTimeMs || 0));
        });
        setHasUnsavedChanges(true);
        
        message.success(`✅ Đã gộp ${newResults.length} đoạn mới vào dữ liệu (tổng: ${transcriptions.length + newResults.length})`);
        console.log(`✅ Merged ${newResults.length} segments, total: ${transcriptions.length + newResults.length}`);
      },
      onCancel: () => {
        // Replace: Clear old and use only new
        setTranscriptions(newResults);
        setHasUnsavedChanges(true);
        
        message.success(`✅ Đã thay thế toàn bộ dữ liệu cũ bằng ${newResults.length} đoạn mới từ AI`);
        console.log(`✅ Replaced all transcriptions with ${newResults.length} new segments`);
      }
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
        message.error('Chưa có audio để chuyển đổi');
        return;
      }

      // Get config from event detail or settings
      let apiKey: string | undefined;
      let modelName: string | undefined;
      
      if (customEvent.detail) {
        apiKey = customEvent.detail.apiKey;
        modelName = customEvent.detail.modelName;
      } else {
        // Fallback to getting from settings
        const config = speechToTextService.getConfig();
        apiKey = config?.geminiApiKey;
        modelName = config?.geminiModel;
      }

      // Check if API key is provided
      if (!apiKey || apiKey.trim().length === 0) {
        Modal.error({
          title: '⚠️ Thiếu Gemini API Key',
          content: (
            <div style={{ marginTop: 16 }}>
              <p>Vui lòng thêm <strong>Gemini API Key</strong> trong Settings trước khi sử dụng tính năng này.</p>
              <div style={{ marginTop: '12px', padding: '12px', background: '#f0f5ff', borderRadius: '6px' }}>
                <strong>Hướng dẫn lấy API Key:</strong><br />
                1️⃣ Truy cập: <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">https://aistudio.google.com/app/apikey</a><br />
                2️⃣ Đăng nhập với Google Account<br />
                3️⃣ Click "Create API Key"<br />
                4️⃣ Copy và paste vào Settings
              </div>
            </div>
          ),
          okText: 'Đã hiểu'
        });
        return;
      }

      // Validate model is selected
      if (!modelName || !modelName.startsWith('models/')) {
        Modal.error({
          title: '⚠️ Chưa chọn Gemini Model',
          content: (
            <div style={{ marginTop: 16 }}>
              <p>Vui lòng chọn <strong>Gemini Model</strong> trong Settings.</p>
              <div style={{ marginTop: '12px', padding: '12px', background: '#f0f5ff', borderRadius: '6px' }}>
                <strong>Các bước:</strong><br />
                1️⃣ Mở Settings → Nhập API Key<br />
                2️⃣ Chờ hệ thống tải danh sách models<br />
                3️⃣ Chọn model từ dropdown (khuyên dùng: Gemini 2.5 Flash)<br />
                4️⃣ Lưu và thử lại
              </div>
            </div>
          ),
          okText: 'Đã hiểu'
        });
        return;
      }

      // Check audio duration (if available)
      const audioDurationMs = audioPlayerRef.current?.getDuration() || 0;
      if (audioDurationMs === 0) {
        message.warning('Không thể xác định thời lượng audio. Đang thử chuyển đổi...');
      }

      // Show confirmation modal with enhanced UI
      Modal.confirm({
        title: (
          <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#667eea' }}>
            <span style={{ fontSize: '24px' }}>🤖</span> Chuyển đổi giọng nói với Gemini AI
          </span>
        ),
        width: 600,
        icon: null,
        content: (
          <div style={{ marginTop: 16 }}>
            <div style={{ 
              padding: '16px', 
              background: 'linear-gradient(135deg, #667eea22 0%, #764ba222 100%)',
              borderRadius: '8px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '15px', marginBottom: '12px' }}>
                <strong>🎯 Thông tin chuyển đổi:</strong><br />
                • Model: <span style={{ fontWeight: 'bold', color: '#667eea' }}>{modelName.replace('models/', '')}</span><br />
                • Kích thước file: <span style={{ fontWeight: 'bold' }}>{(audioBlob.size / (1024 * 1024)).toFixed(2)} MB</span><br />
                {audioDurationMs > 0 && (
                  <>• Thời lượng: <span style={{ fontWeight: 'bold' }}>{Math.floor(audioDurationMs / 60000)}:{String(Math.floor((audioDurationMs % 60000) / 1000)).padStart(2, '0')}</span></>
                )}
              </div>
            </div>

            <div style={{ 
              padding: '16px', 
              background: '#f0f5ff',
              border: '1px solid #adc6ff',
              borderRadius: '8px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.8' }}>
                <strong style={{ color: '#1890ff' }}>✨ Lợi ích của Gemini AI:</strong><br />
                • Độ chính xác cao hơn Web Speech API<br />
                • Tự động phân biệt người nói<br />
                • Làm sạch văn bản (loại bỏ từ đệm, sửa lỗi)<br />
                • Hỗ trợ tiếng Việt tốt hơn
              </div>
            </div>

            <div style={{ 
              padding: '12px', 
              background: '#fffbe6',
              border: '1px solid #ffe58f',
              borderRadius: '6px',
              fontSize: '13px',
              color: '#666'
            }}>
              <strong>⏳ Thời gian xử lý:</strong> Tùy thuộc vào độ dài audio (khoảng 1-3 phút cho file 10-20 phút)<br />
              <strong>💰 Chi phí:</strong> Gemini API miễn phí cho mục đích cá nhân (250K tokens/ngày)
            </div>
          </div>
        ),
        okText: '🚀 Bắt đầu chuyển đổi',
        cancelText: 'Hủy',
        okButtonProps: { 
          size: 'large',
          style: { 
            height: '40px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: 'none'
          }
        },
        cancelButtonProps: { size: 'large', style: { height: '40px' } },
        onOk: async () => {
          try {
            const config = speechToTextService.getConfig();
            const maxFileSizeMB = config?.maxFileSizeMB || 20;
            const meetingStartTime = new Date(`${meetingInfo.date}T${meetingInfo.time}:00`);
            
            const parsed = await AIRefinementService.transcribeAudioWithGemini(
              apiKey,
              audioBlob,
              modelName,
              (progress) => {
                // Update progress (could enhance with progress modal later)
                console.log(`Transcription progress: ${progress.toFixed(0)}%`);
              },
              false,
              maxFileSizeMB,
              meetingStartTime,
              config?.summaryPrompt
            );

            // Save summary if available
            if (parsed.summary) {
              console.log('📋 Received summary:', parsed.summary);
              setGeminiSummary(parsed.summary);
            }

            // Show merge/replace options modal
            showMergeOrReplaceModal(parsed.results);

          } catch (error: any) {
            // Check if error is FILE_TOO_LARGE
            if (error.message === 'FILE_TOO_LARGE') {
              // Show segment selection modal
              showSegmentSelectionModal(error.fileSizeMB, error.maxSizeMB);
              return;
            }
            
            // Show error modal
            Modal.error({
              title: '❌ Lỗi chuyển đổi',
              width: 480,
              content: (
                <div style={{ marginTop: 16 }}>
                  <div style={{ 
                    padding: '12px 16px',
                    background: '#fff2f0',
                    border: '1px solid #ffccc7',
                    borderRadius: '6px',
                    marginBottom: '12px'
                  }}>
                    <div style={{ color: '#cf1322', fontSize: '14px', wordBreak: 'break-word' }}>
                      <strong>Chi tiết lỗi:</strong><br />
                      {error.message}
                    </div>
                  </div>

                  <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
                    <strong>💡 Gợi ý khắc phục:</strong>
                    <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
                      <li>Kiểm tra kết nối internet</li>
                      <li>Xác nhận Gemini API Key còn hợp lệ</li>
                      <li>Thử lại với file audio nhỏ hơn</li>
                      <li>Kiểm tra Console để xem chi tiết lỗi</li>
                    </ul>
                  </div>
                </div>
              ),
              okText: 'Đã hiểu',
              okButtonProps: { size: 'large' }
            });
            console.error('Gemini transcription error:', error);
          }
        }
      });
    };

    window.addEventListener('transcribe-audio', handleTranscribeAudio);
    return () => {
      window.removeEventListener('transcribe-audio', handleTranscribeAudio);
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
    const speakersModified = isSaved && !mapsAreEqual(savedSpeakersSnapshot, speakersMap);
    
    // Check if transcriptions have been modified
    const transcriptionsModified = isSaved && !transcriptionsAreEqual(savedTranscriptionsSnapshot, transcriptions);
    
    // Có dữ liệu chưa lưu nếu:
    // 1. Đang recording
    // 2. Có audio/notes/speakers/transcriptions nhưng chưa save lần đầu
    // 3. Đã save nhưng notes, speakers hoặc transcriptions bị sửa đổi
    const notesModified = isSaved && savedNotesSnapshot !== notes;
    const hasData = isRecording || 
                    (!isSaved && (audioBlob !== null || notes.trim().length > 0 || speakersMap.size > 0 || transcriptions.length > 0)) || 
                    notesModified || 
                    speakersModified || 
                    transcriptionsModified;
    
    // console.log('🔍 hasUnsavedChanges check:', { 
    //   isSaved, 
    //   speakersModified, 
    //   notesModified, 
    //   speakersMapSize: speakersMap.size, 
    //   savedSpeakersSnapshotSize: savedSpeakersSnapshot.size,
    //   hasData 
    // });
    
    setHasUnsavedChanges(hasData);
  }, [isRecording, audioBlob, notes, speakersMap, transcriptions, isSaved, savedNotesSnapshot, savedSpeakersSnapshot, savedTranscriptionsSnapshot]);
  
  // Helper function to compare two Maps
  function mapsAreEqual(map1: Map<number, string>, map2: Map<number, string>): boolean {
    if (map1.size !== map2.size) return false;
    for (const [key, value] of map1) {
      if (map2.get(key) !== value) return false;
    }
    return true;
  }
  
  // Helper function to compare two transcription arrays
  function transcriptionsAreEqual(arr1: TranscriptionResult[], arr2: TranscriptionResult[]): boolean {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
      const t1 = arr1[i];
      const t2 = arr2[i];
      if (t1.id !== t2.id || t1.text !== t2.text || t1.speaker !== t2.speaker || 
          t1.startTime !== t2.startTime || t1.audioTimeMs !== t2.audioTimeMs || 
          t1.isManuallyEdited !== t2.isManuallyEdited) {
        return false;
      }
    }
    return true;
  }
  
  // Auto-save to localStorage with debounce (every 3 seconds after changes)
  // Optimized: Only trigger on hasUnsavedChanges, reducing unnecessary dependencies
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
          participants: meetingInfo.attendees
        };
        
        // console.log('💾 Auto-backup saving with speakersMap:', { 
        //   size: speakersMap.size, 
        //   entries: Array.from(speakersMap.entries()) 
        // });
        
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
          geminiSummary
        );
      }, 3000); // Auto-save 3 seconds after last change
    }
    
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [hasUnsavedChanges]); // Optimized: Only depend on hasUnsavedChanges flag

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
        e.returnValue = 'Bạn có dữ liệu chưa lưu. Bạn có chắc muốn rời khỏi trang?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
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
    // Clear auto-backup after successful save
    clearBackup();
  };
  
  const handleRestoreBackup = async () => {
    const backup = await loadBackup();
    if (backup) {
      setMeetingInfo({
        title: backup.meetingInfo.projectName,
        date: new Date().toISOString().split('T')[0],
        time: new Date().toTimeString().slice(0, 5),
        location: backup.meetingInfo.location,
        host: '',
        attendees: backup.meetingInfo.participants
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
      }
      if (backup.rawTranscripts && backup.rawTranscripts.length > 0) {
        setRawTranscripts(backup.rawTranscripts);
      }
      
      // Restore geminiSummary if available
      if (backup.geminiSummary) {
        setGeminiSummary(backup.geminiSummary);
      }
      
      // Update snapshots and unsaved changes flag
      setHasUnsavedChanges(!backup.isSaved);
      setSavedNotesSnapshot(backup.notes);
      setSavedSpeakersSnapshot(new Map(backup.speakersMap));
      setSavedTranscriptionsSnapshot(backup.transcriptions ? [...backup.transcriptions] : []);
      
      setShowBackupDialog(false);
      console.log('✅ Backup restored successfully, speakersMap size:', backup.speakersMap.size);
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
    setSavedTranscriptionsSnapshot(loadedData.transcriptions ? [...loadedData.transcriptions] : []); // Save transcriptions snapshot
    setIsLiveMode(false); // Switch to timestamp mode when loading project
  };

  // Handle transcription config save
  const handleSaveTranscriptionConfig = (config: SpeechToTextConfig) => {
    setTranscriptionConfig(config);
    speechToTextService.initialize(config);
    // console.log('✅ Transcription config updated');
  };

  // Handle edit transcription
  const handleEditTranscription = useCallback((id: string, newText: string, newSpeaker: string, newStartTime?: string, newAudioTimeMs?: number) => {
    // Check if user deleted all text (wants to remove segment)
    if (!newText || newText.trim() === '') {
      Modal.confirm({
        title: '🗑️ Xóa segment này?',
        icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
        content: (
          <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
            <p>Bạn đã xóa toàn bộ nội dung của segment này.</p>
            <p style={{ marginBottom: '8px' }}>Bạn muốn:</p>
            <ul style={{ paddingLeft: '20px', margin: '0' }}>
              <li><strong>Xóa segment:</strong> Segment này sẽ bị xóa hoàn toàn khỏi danh sách</li>
              <li><strong>Hủy bỏ:</strong> Giữ nguyên segment gốc (không lưu thay đổi)</li>
            </ul>
          </div>
        ),
        okText: 'Xóa segment',
        cancelText: 'Hủy bỏ',
        okButtonProps: {
          danger: true
        },
        onOk: () => {
          // Remove the segment
          setTranscriptions(prev => prev.filter(item => item.id !== id));
          setHasUnsavedChanges(true);
          message.success('✅ Đã xóa segment');
          // console.log('🗑️ Transcription segment deleted:', id);
        }
        // onCancel: do nothing (keep original segment)
      });
      return;
    }

    // Normal edit: update text and other fields
    setTranscriptions(prev => 
      prev.map(item => 
        item.id === id 
          ? { 
              ...item, 
              text: newText, 
              speaker: newSpeaker, 
              startTime: newStartTime !== undefined ? newStartTime : item.startTime,
              audioTimeMs: newAudioTimeMs !== undefined ? newAudioTimeMs : item.audioTimeMs,
              isManuallyEdited: true 
            }
          : item
      )
    );
    setHasUnsavedChanges(true);
    // console.log('✏️ Transcription edited:', { id, newText, newSpeaker, newStartTime, newAudioTimeMs });
  }, [setTranscriptions, setHasUnsavedChanges]); // Memoized

  // Handle new transcription result
  const handleNewTranscription = (result: TranscriptionResult) => {
    try {
      // Validate result has text
      if (!result || !result.text) {
        console.warn('⚠️ Received invalid transcription result:', result);
        return;
      }

      // Collect raw transcript data for AI refinement
      const rawData: RawTranscriptData = {
        text: result.text,
        timestamp: result.startTime,
        audioTimeMs: result.audioTimeMs,
        confidence: result.confidence,
        isFinal: result.isFinal
      };
      setRawTranscripts(prev => [...prev, rawData]);

      setTranscriptions(prev => {
        // Nếu là kết quả final
        if (result.isFinal) {
          // Tách final results và draft segment (nếu có)
          const finalResults = prev.filter(item => item.isFinal);
          const existingDraft = prev.find(item => !item.isFinal);
          
          // Kiểm tra xem có nên ghép text vào segment cuối không (cùng timestamp)
          if (finalResults.length > 0) {
            const lastResult = finalResults[finalResults.length - 1];
            
            // Validate both texts exist
            if (!lastResult.text) {
              // If last result has no text, replace it with new result
              finalResults[finalResults.length - 1] = result;
              return existingDraft ? [...finalResults, existingDraft] : finalResults;
            }
            
            // ** LOGIC MỚI: ghép text vào segment cuối **
              const lastText = lastResult.text || '';
              const lastWordCount = lastText.trim().length === 0
                ? 0
                : lastText.trim().split(/\s+/).filter(Boolean).length;
              
              // Nếu last segment chưa >= 150 từ → merge, ngược lại tạo segment mới (fall through)
              if (lastWordCount < 150){
              // Ghép text: lastText + " " + newText
              const updatedText = lastResult.text.trim() + '. ' + result.text.trim();
              
              finalResults[finalResults.length - 1] = {
                ...lastResult,
                text: updatedText,
                confidence: Math.min(lastResult.confidence, result.confidence), // Take lower confidence
                // Keep original timestamps (segment start)
                startTime: lastResult.startTime,
                endTime: lastResult.endTime,
                audioTimeMs: lastResult.audioTimeMs
              };
              
              return existingDraft ? [...finalResults, existingDraft] : finalResults;
            }
            
            // ** Nếu nhiều hơn 150 từ → tạo segment mới (logic cũ không cần thiết nữa) **
          }
          
          // Thêm kết quả final mới và giữ draft segment nếu có
          return existingDraft ? [...finalResults, result, existingDraft] : [...finalResults, result];
        } else {
          // Nếu là kết quả tạm thời, giữ tất cả final + update/thêm 1 draft segment cố định
          const finalResults = prev.filter(item => item.isFinal);
          const existingDraft = prev.find(item => !item.isFinal);
          
          // ⚠️ trường hợp đặc biệt: Empty text means remove draft segment (clear signal from SmartTranscriptManager)
          if (!result.text || result.text.trim() === '') {
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
              audioTimeMs: result.audioTimeMs
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
      console.error('❌ Error handling transcription:', error);
    }
  };

  // Handle seek to audio time
  const handleSeekToAudio = useCallback((timeMs: number, shouldPlay: boolean = false) => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.seekTo(timeMs);
      if (shouldPlay) {
        audioPlayerRef.current.play();
      }
      // console.log(`⏭️ Seeking to ${(timeMs / 1000).toFixed(2)}s${shouldPlay ? ' + playing' : ''}`);
    }
  }, []); // No dependencies - audioPlayerRef is stable

  // Handle AI refinement
  const handleAIRefine = async () => {
    if (!transcriptionConfig) {
      message.warning('Vui lòng cấu hình Speech-to-Text Settings trước');
      setShowTranscriptionConfig(true);
      return;
    }

    // Check for Gemini API key
    const apiKeyToUse = transcriptionConfig.geminiApiKey || transcriptionConfig.apiKey;
    if (!apiKeyToUse) {
      message.error({
        content: (
          <div>
            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
              Cần Gemini API Key để sử dụng tính năng AI
            </div>
            <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
              <strong>Cách lấy API Key miễn phí:</strong>
              <ol style={{ paddingLeft: '20px', margin: '8px 0' }}>
                <li>Truy cập: <a href="https://aistudio.google.com/app/apikey" target="_blank">Google AI Studio</a></li>
                <li>Click "Create API Key"</li>
                <li>Copy API key và paste vào Settings → Gemini API Key</li>
                <li>Hệ thống sẽ tự động tải danh sách models</li>
                <li>Chọn model (khuyên dùng: Gemini 2.5 Flash)</li>
              </ol>
            </div>
          </div>
        ),
        duration: 10
      });
      setShowTranscriptionConfig(true);
      return;
    }

    // Check for model selection
    const selectedModel = transcriptionConfig.geminiModel;
    if (!selectedModel || !selectedModel.startsWith('models/')) {
      message.error({
        content: (
          <div>
            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
              Vui lòng chọn Gemini Model trong Settings
            </div>
            <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
              <strong>Các bước:</strong>
              <ol style={{ paddingLeft: '20px', margin: '8px 0' }}>
                <li>Mở Settings</li>
                <li>Nhập Gemini API Key (nếu chưa có)</li>
                <li>Đợi hệ thống tải danh sách models</li>
                <li>Chọn model từ dropdown (khuyên dùng: Gemini 2.5 Flash)</li>
                <li>Lưu và thử lại</li>
              </ol>
            </div>
          </div>
        ),
        duration: 10
      });
      setShowTranscriptionConfig(true);
      return;
    }

    if (transcriptions.length === 0) {
      message.warning('Không có dữ liệu chuyển đổi để chuẩn hóa');
      return;
    }

    // Show warning modal with better design
    Modal.confirm({
      title: (
        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1890ff' }}>
          🤖 Chuẩn hóa văn bản bằng Gemini AI
        </div>
      ),
      icon: <ExclamationCircleOutlined style={{ color: '#1890ff' }} />,
      width: 680,
      content: (
        <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#52c41a' }}>
              ✨ AI sẽ thực hiện:
            </div>
            <ul style={{ paddingLeft: '20px', margin: '0' }}>
              <li>Sửa lỗi nhận diện từ Web Speech API</li>
              <li>Loại bỏ từ thừa, từ đệm (à, ừm, thì...)</li>
              <li>Thêm dấu câu và viết hoa đúng quy tắc</li>
              <li>Gộp các đoạn liên quan thành câu hoàn chỉnh</li>
            </ul>
          </div>

          <div style={{ 
            background: '#f0f5ff',
            border: '1px solid #adc6ff',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px'
          }}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'flex-start', 
              cursor: 'pointer',
              gap: '8px'
            }}>
              <input 
                type="checkbox" 
                id="useRawTranscripts"
                style={{ marginTop: '4px' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#1890ff' }}>
                  📦 Sử dụng dữ liệu bổ trợ (rawTranscripts.json)
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  Nếu tick, AI sẽ tham khảo thêm dữ liệu gốc từ Web Speech API. 
                  <strong> Khuyến nghị: Bỏ tick để tiết kiệm token và xử lý nhanh hơn.</strong>
                  <br />
                  <span style={{ color: '#fa8c16' }}>⚠️ Nếu tick sẽ tốn nhiều token hơn (~x2) và có thể vượt quota.</span>
                </div>
              </div>
            </label>
          </div>

          <div style={{ 
            background: '#fff7e6', 
            border: '2px solid #ffa940',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px'
          }}>
            <div style={{ 
              fontWeight: 'bold', 
              marginBottom: '12px', 
              color: '#fa8c16',
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{ fontSize: '20px' }}>⚠️</span>
              CẢNH BÁO QUAN TRỌNG VỀ BẢO MẬT
            </div>
            
            <div style={{ marginBottom: '12px', color: '#595959' }}>
              Dữ liệu của bạn sẽ được <strong>gửi đến Google Gemini API</strong> để xử lý.
            </div>

            <div style={{ 
              background: '#fff1f0',
              border: '1px solid #ffccc7',
              borderRadius: '6px',
              padding: '12px',
              marginBottom: '12px'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#cf1322' }}>
                🚫 KHÔNG sử dụng với thông tin nhạy cảm
              </div>
              <ul style={{ paddingLeft: '20px', margin: '0', color: '#595959' }}>
                <li><strong>Tài chính:</strong> Mật khẩu, số tài khoản, số thẻ, giao dịch ngân hàng</li>
                <li><strong>Y tế:</strong> Bệnh án, đơn thuốc, kết quả xét nghiệm</li>
                <li><strong>Cá nhân:</strong> CCCD/CMND, địa chỉ, số điện thoại nhạy cảm</li>
                <li><strong>Doanh nghiệp:</strong> Bí mật thương mại, kế hoạch kinh doanh, các nội dung mật khác</li>
                <li><strong>Bảo mật:</strong> API keys, tokens, credentials</li>
              </ul>
            </div>

            <div style={{ 
              fontStyle: 'italic', 
              color: '#8c8c8c',
              fontSize: '13px'
            }}>
              💡 Khuyến nghị: Hãy xem lại nội dung transcript trước khi sử dụng chức năng này
            </div>
          </div>

          <div style={{ 
            background: '#e6f7ff',
            border: '1px solid #91d5ff',
            borderRadius: '6px',
            padding: '12px',
            fontSize: '13px',
            color: '#595959'
          }}>
            <strong>ℹ️ Lưu ý:</strong> Quá trình này sẽ thay thế toàn bộ kết quả hiện tại. 
            Bạn có thể chỉnh sửa lại sau nếu cần.
          </div>
        </div>
      ),
      okText: 'Đồng ý, tiếp tục',
      cancelText: 'Hủy bỏ',
      okButtonProps: {
        danger: false,
        type: 'primary'
      },
      onOk: async () => {
        // Get checkbox state before modal closes
        const checkboxElement = document.getElementById('useRawTranscripts') as HTMLInputElement;
        const shouldUseRawData = checkboxElement ? checkboxElement.checked : false;
        await performAIRefinement(shouldUseRawData);
      }
    });
  };

  // Separate function to perform AI refinement
  const performAIRefinement = async (useRawData: boolean = false) => {
    const apiKeyToUse = transcriptionConfig!.geminiApiKey || transcriptionConfig!.apiKey;
    const selectedModel = transcriptionConfig!.geminiModel;

    if (!selectedModel) {
      message.error('Model không được chọn. Vui lòng cấu hình lại.');
      return;
    }

    // Step 1: Check quota status first (real-time check)
    const hideCheckingMsg = message.loading('🔍 Đang kiểm tra hạn mức API Key...', 0);
    
    try {
      const quotaStatus = await AIRefinementService.checkQuotaStatus(apiKeyToUse, selectedModel);
      hideCheckingMsg();
      
      // Show quota status in a modal
      await new Promise<void>((resolve, reject) => {
        let statusIcon = '✅';
        let statusColor = '#52c41a';
        let statusBg = '#f6ffed';
        let statusBorder = '#b7eb8f';
        
        if (quotaStatus.status === 'exceeded') {
          statusIcon = '🚫';
          statusColor = '#cf1322';
          statusBg = '#fff2f0';
          statusBorder = '#ffccc7';
        } else if (quotaStatus.status === 'limited') {
          statusIcon = '⚠️';
          statusColor = '#fa8c16';
          statusBg = '#fff7e6';
          statusBorder = '#ffd591';
        } else if (quotaStatus.status === 'error') {
          statusIcon = '⚠️';
          statusColor = '#faad14';
          statusBg = '#fffbe6';
          statusBorder = '#ffe58f';
        }
        
        // Calculate estimated usage
        const totalChars = transcriptions.reduce((sum, t) => sum + t.text.length, 0);
        const estimatedTokens = Math.ceil(totalChars / 3) + 1000;
        const quotaPercent = Math.round((estimatedTokens / 250000) * 100);
        
        Modal.confirm({
          title: (
            <div style={{ fontSize: '18px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{statusIcon}</span>
              Trạng thái Gemini API
            </div>
          ),
          width: 680,
          content: (
            <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
              <div style={{
                background: statusBg,
                border: `2px solid ${statusBorder}`,
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '16px'
              }}>
                <div style={{ fontWeight: 'bold', color: statusColor, marginBottom: '12px', fontSize: '15px' }}>
                  {quotaStatus.message}
                </div>
                {quotaStatus.recommendations.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#595959' }}>
                      💡 Khuyến nghị:
                    </div>
                    <ul style={{ paddingLeft: '20px', margin: '0', color: '#595959' }}>
                      {quotaStatus.recommendations.map((rec, idx) => (
                        <li key={idx} dangerouslySetInnerHTML={{ __html: rec }} />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              
              {quotaStatus.status === 'available' && (
                <div style={{
                  background: '#e6f7ff',
                  border: '1px solid #91d5ff',
                  borderRadius: '6px',
                  padding: '16px'
                }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '12px', color: '#1890ff' }}>
                    📊 Ước tính cho lần xử lý này
                  </div>
                  <div style={{ fontSize: '13px', color: '#595959' }}>
                    • Segments: {transcriptions.length}<br />
                    • Ước tính: ~{estimatedTokens.toLocaleString()} tokens<br />
                    • Hạn mức free: 250,000 tokens/ngày<br />
                    • Sử dụng: ~{quotaPercent}%<br />
                    {quotaPercent > 80 && (
                      <span style={{ color: '#fa8c16', fontWeight: 'bold' }}>
                        <br />⚠️ Gần vượt hạn mức! Hệ thống sẽ tự động chia nhỏ xử lý.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ),
          okText: quotaStatus.status === 'exceeded' ? 'Đã hiểu' : 'Tiếp tục xử lý',
          cancelText: 'Hủy bỏ',
          okButtonProps: {
            danger: quotaStatus.status === 'exceeded',
            disabled: quotaStatus.status === 'exceeded'
          },
          onOk: () => resolve(),
          onCancel: () => reject(new Error('User cancelled'))
        });
      });
      
    } catch (error: any) {
      hideCheckingMsg();
      if (error.message === 'User cancelled') {
        return;
      }
      // Continue even if quota check fails
      message.warning('Không thể kiểm tra quota, sẽ tiếp tục xử lý...');
    }

    try {
      // Show progress dialog
      const progressDiv = document.createElement('div');
      progressDiv.id = 'ai-refine-progress';
      progressDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        min-width: 350px;
        text-align: center;
      `;
      progressDiv.innerHTML = `
        <div style="font-size: 18px; font-weight: bold; margin-bottom: 12px;">🤖 AI đang chuẩn hóa văn bản...</div>
        <div id="ai-progress-text" style="font-size: 14px; color: #666;">Đang xử lý...</div>
        <div style="width: 100%; height: 8px; background: #f0f0f0; border-radius: 4px; margin-top: 12px; overflow: hidden;">
          <div id="ai-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); transition: width 0.3s;"></div>
        </div>
      `;
      document.body.appendChild(progressDiv);

      const updateProgress = (progress: number) => {
        const progressBar = document.getElementById('ai-progress-bar');
        const progressText = document.getElementById('ai-progress-text');
        if (progressBar) progressBar.style.width = `${progress}%`;
        if (progressText) {
          if (progress < 10) {
            progressText.textContent = 'Đang chuẩn bị dữ liệu...';
          } else if (progress < 30) {
            progressText.textContent = 'Đang chia batches để tối ưu quota...';
          } else if (progress < 90) {
            const currentBatch = Math.floor((progress / 100) * Math.ceil(transcriptions.length / 50));
            const totalBatches = Math.ceil(transcriptions.length / 50);
            if (totalBatches > 1) {
              progressText.textContent = `Đang xử lý batch ${currentBatch}/${totalBatches}... (${Math.floor(progress)}%)`;
            } else {
              progressText.textContent = `Đang gửi đến AI... ${Math.floor(progress)}%`;
            }
          } else {
            progressText.textContent = 'Hoàn thành!';
          }
        }
      };

      // Prepare raw data for supplementary reference
      let rawData: RawTranscriptData[] = [];
      if (useRawData && rawTranscripts && rawTranscripts.length > 0) {
        // Use saved raw data (preserves original Web Speech API output)
        rawData = rawTranscripts;
        console.log('📦 Using saved raw transcripts as supplementary data:', rawData.length, 'items');
      } else {
        // No raw data available or user chose not to use it
        console.log('ℹ️ Not using raw data - processing transcriptions only (faster, uses less tokens)');
      }

      // Call AI refinement service with model selection
      // Primary data: transcriptions (user-edited, highest reliability)
      // Supplementary data: rawTranscripts (original Web Speech API output for reference)
      const refinedSegments = await AIRefinementService.refineTranscripts(
        apiKeyToUse,
        transcriptions, // Primary data
        rawData, // Supplementary data
        selectedModel, // Pass required model name
        updateProgress
      );

      // Convert to TranscriptionResult format
      const refinedResults = AIRefinementService.convertToTranscriptionResults(
        refinedSegments,
        'Person1'
      );

      // Update transcriptions
      setTranscriptions(refinedResults);
      setHasUnsavedChanges(true);

      // Remove progress dialog
      progressDiv.remove();

      message.success(`✅ Đã chuẩn hóa thành công ${refinedResults.length} đoạn văn bản!`);

    } catch (error: any) {
      const progressDiv = document.getElementById('ai-refine-progress');
      if (progressDiv) progressDiv.remove();

      console.error('AI Refinement Error:', error);
      
      // Show detailed error modal for quota issues
      if (error.message.includes('quota') || error.message.includes('429') || error.message.includes('Vượt hạn mức')) {
        Modal.error({
          title: '🚫 Vượt hạn mức Gemini API',
          width: 600,
          content: (
            <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
              <div style={{ 
                padding: '16px', 
                background: '#fff2f0',
                border: '1px solid #ffccc7',
                borderRadius: '8px',
                marginBottom: '16px',
                whiteSpace: 'pre-wrap'
              }}>
                {error.message}
              </div>

              <div style={{ 
                padding: '12px 16px',
                background: '#e6f7ff',
                border: '1px solid #91d5ff',
                borderRadius: '6px'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#0050b3' }}>
                  📌 Thông tin hạn mức Gemini Free Tier:
                </div>
                <ul style={{ margin: 0, paddingLeft: '20px', color: '#666' }}>
                  <li>15 requests/phút</li>
                  <li>1,500 requests/ngày</li>
                  <li><strong>250,000 tokens/ngày</strong> ← Giới hạn chính</li>
                  <li>Reset: Mỗi 24 giờ</li>
                </ul>
              </div>
            </div>
          ),
          okText: 'Đã hiểu'
        });
      } else {
        // Regular error message
        message.error({
          content: `Lỗi khi chuẩn hóa bằng AI: ${error.message}`,
          duration: 8
        });
      }
    }
  };

  return (
    <div className="app-container">
      {/* Backup Restoration Dialog */}
      {showBackupDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            backgroundColor: '#1e1e1e',
            border: '2px solid #ffa500',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '500px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)'
          }}>
            <h2 style={{ marginTop: 0, color: '#ffa500' }}>🔄 Khôi phục dữ liệu</h2>
            <p style={{ fontSize: '16px', lineHeight: '1.6' }}>
              Phát hiện dữ liệu tự động sao lưu từ <strong>{backupAge !== null ? `${backupAge} phút` : 'một lúc'}</strong> trước.
              <br/>
              Có thể trình duyệt đã bị đóng đột ngột hoặc bạn chưa lưu dữ liệu.
            </p>
            <p style={{ fontSize: '14px', color: '#888' }}>
              Bạn có muốn khôi phục dữ liệu này không?
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button
                onClick={handleRestoreBackup}
                style={{
                  flex: 1,
                  padding: '12px 20px',
                  backgroundColor: '#1890ff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                ✅ Khôi phục
              </button>
              <button
                onClick={handleDiscardBackup}
                style={{
                  flex: 1,
                  padding: '12px 20px',
                  backgroundColor: '#434343',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '16px',
                  cursor: 'pointer'
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
          {navigator.onLine ? '🌐 Online' : '📴 Offline'}
          {hasUnsavedChanges && <span className="unsaved-indicator" title="Bạn có dữ liệu chưa lưu">⚠️ Chưa lưu</span>}
          <HelpButton />
        </div>
      </header>

      <MetadataPanel meetingInfo={meetingInfo} onChange={setMeetingInfo} />


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
        onClearTranscriptions={() => {
          setTranscriptions([]);
          setRawTranscripts([]); // Also clear raw transcripts
        }}
        transcriptions={transcriptions}
        geminiSummary={geminiSummary}
      />
      {/* Meeting Summary Panel - Show when summary is available */}
      {geminiSummary && (
        <MeetingSummaryPanel
          summary={geminiSummary}
          onSummaryChange={setGeminiSummary}
          onMarkUnsaved={() => setHasUnsavedChanges(true)}
        />
      )}
      {/* Transcription Panel - Only show when online and configured */}
      {isOnline && transcriptionConfig && (
        <TranscriptionPanel
          transcriptions={transcriptions}
          isTranscribing={isRecording}
          isOnline={isOnline}
          onSeekAudio={handleSeekToAudio}
          onEditTranscription={handleEditTranscription}
          onAIRefine={handleAIRefine}
          canRefineWithAI={
            !isRecording && 
            transcriptions.length > 0 && 
            (!!transcriptionConfig.geminiApiKey || !!transcriptionConfig.apiKey) &&
            !!transcriptionConfig.geminiModel
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

      <AudioPlayer ref={audioPlayerRef} audioBlob={audioBlob} transcriptionConfig={transcriptionConfig} />

      {/* Transcription Configuration Modal */}
      <TranscriptionConfig
        visible={showTranscriptionConfig}
        onClose={() => setShowTranscriptionConfig(false)}
        onSave={handleSaveTranscriptionConfig}
        currentConfig={transcriptionConfig}
      />
    </div>
  );
};
