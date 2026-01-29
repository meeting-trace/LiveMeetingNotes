import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { Collapse, Empty, Tag, Space, Tooltip, Input, Button } from 'antd';
import { AudioOutlined, ClockCircleOutlined, UserOutlined, CheckCircleOutlined, EditOutlined, SaveOutlined, CloseOutlined} from '@ant-design/icons';
import type { TranscriptionResult } from '../types/types';

interface Props {
  transcriptions: TranscriptionResult[];
  isTranscribing: boolean;
  isOnline: boolean;
  onSeekAudio?: (timeMs: number) => void;
  onEditTranscription?: (id: string, newText: string, newSpeaker: string, newStartTime?: string, newAudioTimeMs?: number) => void;
  onAIRefine?: () => void;
  canRefineWithAI?: boolean;
}

const TranscriptionPanelComponent: React.FC<Props> = ({
  transcriptions,
  isTranscribing,
  isOnline,
  onSeekAudio,
  onEditTranscription,
  onAIRefine,
  canRefineWithAI
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number>(100); // Initial height (1/5 of 500px)
  const [isExpanded, setIsExpanded] = useState<boolean>(false); // Track collapse/expand state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>('');
  const [editSpeaker, setEditSpeaker] = useState<string>('');
  const [editStartTime, setEditStartTime] = useState<string>('');
  const [editAudioTimeMs, setEditAudioTimeMs] = useState<number | undefined>(undefined);

  // Auto-scroll to bottom when new transcription arrives (but not when editing)
  useEffect(() => {
    if (scrollRef.current && !editingId) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptions, editingId]);

  // Auto-clear edit mode if the editing segment is removed
  useEffect(() => {
    if (editingId) {
      const segmentExists = transcriptions.some(t => t.id === editingId);
      if (!segmentExists) {
        // Segment was deleted, clear edit state
        setEditingId(null);
        setEditText('');
        setEditSpeaker('');
        setEditStartTime('');
        setEditAudioTimeMs(undefined);
      }
    }
  }, [transcriptions, editingId]);

  // Auto-expand height based on content: min 100px (1/5 of 500), max 500px
  useEffect(() => {
    // Skip update when editing to prevent interference with input
    if (editingId) {
      return;
    }

    const updateHeight = () => {
      if (scrollRef.current && transcriptions.length > 0 && isExpanded) {
        const scrollHeight = scrollRef.current.scrollHeight;
        const newHeight = Math.min(scrollHeight + 80, 500); // +80 for header/footer, max 500px
        const calculatedHeight = Math.max(newHeight, 100); // Minimum 100px (1/5 of 500px)
        
        // CRITICAL: Only update if value actually changed to prevent infinite loop
        setContentHeight(prev => {
          if (prev === calculatedHeight) {
            return prev; // Don't trigger re-render if same value
          }
          return calculatedHeight;
        });
      } else if (transcriptions.length === 0) {
        setContentHeight(prev => prev === 100 ? prev : 100); // Only update if different
      }
    };

    // Update immediately
    updateHeight();

    // REMOVED setTimeout to prevent potential infinite loop
    // Height will be recalculated on next transcriptions change
    // const timeoutId = setTimeout(updateHeight, 100);
    // return () => clearTimeout(timeoutId);
  }, [transcriptions, isExpanded, editingId]);

  const formatTime = (isoTime: string): string => {
    const date = new Date(isoTime);
    return date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatDateTimeForEdit = (isoTime: string): string => {
    const date = new Date(isoTime);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const parseDateTimeFromEdit = (dateTimeStr: string): string => {
    // Parse yyyy-MM-dd HH:mm:ss format and convert back to ISO
    const parts = dateTimeStr.trim().split(' ');
    if (parts.length === 2) {
      const datePart = parts[0];
      const timePart = parts[1];
      const date = new Date(`${datePart}T${timePart}`);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    // If parsing fails, return original or current time
    return new Date().toISOString();
  };

  const formatAudioTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const parseAudioTime = (timeStr: string): number => {
    const parts = timeStr.split(':').map(p => parseInt(p, 10));
    if (parts.length === 2) {
      // mm:ss
      return (parts[0] * 60 + parts[1]) * 1000;
    } else if (parts.length === 3) {
      // hh:mm:ss
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    }
    return 0;
  };

  const handleSeekToTime = (timeMs: number) => {
    if (onSeekAudio) {
      onSeekAudio(timeMs);
    }
  };

  const handleStartEdit = (item: TranscriptionResult) => {
    setEditingId(item.id);
    setEditText(item.text);
    setEditSpeaker(item.speaker);
    setEditStartTime(formatDateTimeForEdit(item.startTime));
    setEditAudioTimeMs(item.audioTimeMs);
  };

  const handleSaveEdit = (id: string) => {
    if (onEditTranscription) {
      // Convert formatted datetime back to ISO before saving
      const isoStartTime = parseDateTimeFromEdit(editStartTime);
      
      // NOTE: onMarkUnsaved() is NOT needed here because:
      // - handleEditTranscription (in App.tsx) already calls setHasUnsavedChanges(true)
      // - Calling onMarkUnsaved() here causes conflict with auto-calculation logic
      
      // Always call onEditTranscription (even with empty text)
      // Parent will handle empty text case (ask to delete segment)
      onEditTranscription(
        id, 
        editText.trim(), 
        editSpeaker.trim() || 'Person1', 
        isoStartTime, 
        editAudioTimeMs
      );
      
      // Clear edit state
      setEditingId(null);
      setEditText('');
      setEditSpeaker('');
      setEditStartTime('');
      setEditAudioTimeMs(undefined);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText('');
    setEditSpeaker('');
    setEditStartTime('');
    setEditAudioTimeMs(undefined);
  };

  const handleDoubleClickSegment = (item: TranscriptionResult) => {
    if (item.isFinal) {
      handleStartEdit(item);
    }
  };

  // Memoize these helper functions to prevent unnecessary re-renders
  const getConfidenceColor = useCallback((confidence: number): string => {
    if (confidence >= 0.9) return '#52c41a'; // green
    if (confidence >= 0.7) return '#faad14'; // orange
    return '#ff4d4f'; // red
  }, []);

  const getConfidenceLabel = useCallback((confidence: number): string => {
    if (confidence >= 0.9) return 'Cao';
    if (confidence >= 0.7) return 'Trung bình';
    return 'Thấp';
  }, []);

  const handleCollapseChange = (keys: string | string[]) => {
    const activeKeys = Array.isArray(keys) ? keys : [keys];
    setIsExpanded(activeKeys.includes('1'));
  };

  return (
    <Collapse
      defaultActiveKey={[]}
      onChange={handleCollapseChange}
      items={[
        {
          key: '1',
          label: (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              width: '100%',
              paddingRight: '16px'
            }}>
              <Space>
                <AudioOutlined />
                <span>Kết quả chuyển đổi giọng nói sang văn bản</span>
                {isTranscribing && (
                  <Tag color="processing" icon={<AudioOutlined />}>
                    Đang nhận dạng...
                  </Tag>
                )}
                {!isOnline && (
                  <Tag color="default">Offline</Tag>
                )}
                {transcriptions.length > 0 && (
                  <Tag color="blue">{transcriptions.length} đoạn</Tag>
                )}
              </Space>
              
              {/* AI Refine Button in header */}
              {canRefineWithAI && !isTranscribing && transcriptions.length > 0 && onAIRefine && (
                <Tooltip title="Sử dụng AI để chuẩn hóa và làm sạch văn bản chuyển đổi">
                  <Button
                    type="primary"
                    size="small"
                    // icon={<RobotOutlined />}
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent collapse toggle
                      onAIRefine();
                    }}
                    style={{ 
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      border: 'none'
                    }}
                  >
                    ✨Chuẩn hóa bằng AI
                  </Button>
                </Tooltip>
              )}
            </div>
          ),
          children: (
            <div style={{ 
              height: `${contentHeight}px`,
              display: 'flex',
              flexDirection: 'column',
              transition: 'height 0.3s ease'
            }}>
              {transcriptions.length === 0 ? (
                <div style={{ 
                  height: '100%', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  padding: '24px'
                }}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      isTranscribing
                        ? 'Đang chờ kết quả chuyển đổi...'
                        : 'Chưa có dữ liệu chuyển đổi. Bật chế độ ghi âm và Tự động chuyển giọng nói thành văn bản để bắt đầu.'
                    }
                  />
                </div>
              ) : (
                <>
                  <div
                    ref={scrollRef}
                    style={{
                      flex: 1,
                      overflowY: 'auto',
                      padding: '16px'
                    }}
                  >
                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                      {transcriptions.map((item, index) => {
                        const isEditing = editingId === item.id;
                        
                        return (
                        <div
                          key={item.id}
                          style={{
                            padding: '12px',
                            backgroundColor: item.isFinal ? (item.isManuallyEdited ? '#fff7e6' : '#f6ffed') : '#e6f7ff',
                            border: `1px solid ${item.isFinal ? (item.isManuallyEdited ? '#ffa940' : '#b7eb8f') : '#91d5ff'}`,
                            borderRadius: '8px',
                            position: 'relative',
                            cursor: item.isFinal && !isEditing ? 'pointer' : 'default'
                          }}
                          onDoubleClick={() => handleDoubleClickSegment(item)}
                          title={item.isFinal ? "Double-click để chỉnh sửa" : ""}
                        >
                          {/* Header with metadata */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: '8px',
                              fontSize: '12px',
                              color: '#666'
                            }}
                          >
                            <Space size="small">
                              {/* Time - Only show if it's real recording time (not Gemini transcription) */}
                              {/* Gemini transcription uses current time as placeholder, so we hide it */}
                              {!item.isAIRefined && (
                                <Tooltip title="Thời gian">
                                  <Tag icon={<ClockCircleOutlined />} color="blue" style={{ fontSize: '11px' }}>
                                    {formatTime(item.startTime)}
                                  </Tag>
                                </Tooltip>
                              )}

                              {/* Audio Time - Clickable */}
                              {item.audioTimeMs !== undefined && (
                                <Tooltip title="Double click để tua đến vị trí này trên audio">
                                  <Tag 
                                    color="cyan" 
                                    style={{ 
                                      cursor: 'pointer',
                                      userSelect: 'none',
                                      fontSize: '11px'
                                    }}
                                    onDoubleClick={(e) => {
                                      e.stopPropagation(); // Prevent triggering edit mode
                                      handleSeekToTime(item.audioTimeMs!);
                                    }}
                                  >
                                    📍 {formatAudioTime(item.audioTimeMs)}
                                  </Tag>
                                </Tooltip>
                              )}

                              {/* Speaker */}
                              {item.speaker && (
                                <Tooltip title="Người nói">
                                  <Tag icon={<UserOutlined />} color="purple" style={{ fontSize: '11px' }}>
                                    {item.speaker}
                                  </Tag>
                                </Tooltip>
                              )}

                              {/* AI Refined Label */}
                              {item.isAIRefined && (
                                <Tooltip title="Đoạn văn bản được xử lý bởi Gemini AI">
                                  <Tag 
                                    style={{ 
                                      fontSize: '11px',
                                      background: 'linear-gradient(135deg, #667eea22 0%, #764ba222 100%)',
                                      borderColor: '#667eea',
                                      color: '#667eea'
                                    }}
                                  >
                                    ✨ AI
                                  </Tag>
                                </Tooltip>
                              )}

                              {/* Confidence */}
                              {item.confidence > 0 && (
                                <Tooltip title={`Độ tin cậy: ${(item.confidence * 100).toFixed(0)}%`}>
                                  <Tag 
                                    color={getConfidenceColor(item.confidence)}
                                    style={{ fontSize: '11px' }}
                                  >
                                    {getConfidenceLabel(item.confidence)}
                                  </Tag>
                                </Tooltip>
                              )}

                              {/* Final status */}
                              {item.isFinal && (
                                <Tooltip title="Kết quả cuối cùng">
                                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                                </Tooltip>
                              )}
                            </Space>

                            {/* Index and Edit button */}
                            <Space size="small">
                              <span style={{ 
                                fontSize: '11px', 
                                color: '#999',
                                fontWeight: 'bold'
                              }}>
                                #{index + 1}
                              </span>
                              
                              {/* Edit button - only for final results */}
                              {item.isFinal && !isEditing && (
                                <Tooltip title="Sửa nội dung">
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<EditOutlined />}
                                    onClick={() => handleStartEdit(item)}
                                    style={{ padding: '0 4px', height: 'auto' }}
                                  />
                                </Tooltip>
                              )}
                              
                              {/* Manual edit indicator */}
                              {item.isManuallyEdited && (
                                <Tooltip title="Đã chỉnh sửa thủ công">
                                  <Tag color="orange" style={{ fontSize: '10px', margin: 0 }}>
                                    ✏️ Edited
                                  </Tag>
                                </Tooltip>
                              )}
                            </Space>
                          </div>

                          {/* Editable content */}
                          {isEditing ? (
                            <div style={{ marginTop: '8px' }}>
                              {/* All metadata fields in one row */}
                              <div style={{ 
                                display: 'flex', 
                                gap: '12px', 
                                marginBottom: '8px',
                                flexWrap: 'wrap',
                                alignItems: 'center'
                              }}>
                                {/* Edit Start Time */}
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                  <label style={{ fontSize: '12px', color: '#666', marginRight: '6px', whiteSpace: 'nowrap' }}>
                                    Thời điểm:
                                  </label>
                                  <Input
                                    size="small"
                                    value={editStartTime}
                                    onChange={(e) => setEditStartTime(e.target.value)}
                                    placeholder="yyyy-MM-dd HH:mm:ss"
                                    style={{ width: '170px' }}
                                  />
                                </div>
                                
                                {/* Edit Timestamp (Audio Time) */}
                                {editAudioTimeMs !== undefined && (
                                  <div style={{ display: 'flex', alignItems: 'center' }}>
                                    <label style={{ fontSize: '12px', color: '#666', marginRight: '6px', whiteSpace: 'nowrap' }}>
                                      Vị trí audio:
                                    </label>
                                    <Input
                                      size="small"
                                      value={formatAudioTime(editAudioTimeMs)}
                                      onChange={(e) => {
                                        const timeMs = parseAudioTime(e.target.value);
                                        setEditAudioTimeMs(timeMs);
                                      }}
                                      placeholder="0:00"
                                      style={{ width: '80px' }}
                                    />
                                  </div>
                                )}

                                
                                {/* Edit Speaker */}
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                  <label style={{ fontSize: '12px', color: '#666', marginRight: '6px', whiteSpace: 'nowrap' }}>
                                    Người nói:
                                  </label>
                                  <Input
                                    size="small"
                                    value={editSpeaker}
                                    onChange={(e) => setEditSpeaker(e.target.value)}
                                    placeholder="Người nói 1"
                                    style={{ width: '120px' }}
                                  />
                                </div>
                              </div>
                              
                              {/* Edit Text */}
                              <Input.TextArea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                autoSize={{ minRows: 2, maxRows: 6 }}
                                style={{ marginBottom: '8px' }}
                              />
                              
                              {/* Edit actions */}
                              <Space size="small">
                                <Button
                                  type="primary"
                                  size="small"
                                  icon={<SaveOutlined />}
                                  onClick={() => handleSaveEdit(item.id)}
                                >
                                  Lưu
                                </Button>
                                <Button
                                  size="small"
                                  icon={<CloseOutlined />}
                                  onClick={handleCancelEdit}
                                >
                                  Hủy
                                </Button>
                              </Space>
                            </div>
                          ) : (
                            <>
                              {/* Transcription text */}
                              <div
                                style={{
                                  marginTop: '8px',
                                  fontSize: '14px',
                                  lineHeight: '1.6',
                                  color: '#262626',
                                  wordWrap: 'break-word',
                                  fontStyle: item.isFinal ? 'normal' : 'italic',
                                  fontWeight: item.isFinal ? 'normal' : '300'
                                }}
                              >
                                {item.text}
                              </div>

                              {/* Draft indicator - only for interim results */}
                              {!item.isFinal && (
                                <div
                                  style={{
                                    marginTop: '8px',
                                    fontSize: '11px',
                                    color: '#1890ff',
                                    fontStyle: 'italic'
                                  }}
                                >
                                  ⏳ Đang nhận dạng...
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                      })}
                    </Space>
                  </div>
                </>
              )}
            </div>
          )
        }
      ]}
    />
  );
};

// Memoize to prevent unnecessary re-renders when parent updates
export const TranscriptionPanel = memo(TranscriptionPanelComponent, (prevProps, nextProps) => {
  // Only re-render if these specific props changed
  return (
    prevProps.transcriptions === nextProps.transcriptions &&
    prevProps.isTranscribing === nextProps.isTranscribing &&
    prevProps.isOnline === nextProps.isOnline &&
    prevProps.canRefineWithAI === nextProps.canRefineWithAI &&
    prevProps.onSeekAudio === nextProps.onSeekAudio &&
    prevProps.onEditTranscription === nextProps.onEditTranscription &&
    prevProps.onAIRefine === nextProps.onAIRefine
  );
});
