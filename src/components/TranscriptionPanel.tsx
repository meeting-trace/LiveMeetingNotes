import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { Collapse, Empty, Space, Tag, Tooltip, Button } from 'antd';
import { AudioOutlined } from '@ant-design/icons';
import type { TranscriptionResult } from '../types/types';
import { TranscriptionItem } from './TranscriptionItem';

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
  const [contentHeight, setContentHeight] = useState<number>(100);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Auto-scroll to bottom when new transcription arrives
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptions]);

  // Auto-expand height based on content
  useEffect(() => {
    const updateHeight = () => {
      if (scrollRef.current && transcriptions.length > 0 && isExpanded) {
        const scrollHeight = scrollRef.current.scrollHeight;
        const newHeight = Math.min(scrollHeight + 80, 500);
        const calculatedHeight = Math.max(newHeight, 100);
        
        setContentHeight(prev => prev === calculatedHeight ? prev : calculatedHeight);
      } else if (transcriptions.length === 0) {
        setContentHeight(prev => prev === 100 ? prev : 100);
      }
    };

    updateHeight();
  }, [transcriptions, isExpanded]);

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

  const handleSeekToTime = useCallback((timeMs: number) => {
    if (onSeekAudio) {
      onSeekAudio(timeMs);
    }
  }, [onSeekAudio]);

  // Memoize these helper functions to pass to child components
  const getConfidenceColor = useCallback((confidence: number): string => {
    if (confidence >= 0.9) return '#52c41a';
    if (confidence >= 0.7) return '#faad14';
    return '#ff4d4f';
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
                      padding: '16px'
                    }}
                  >
                    {transcriptions.map((item, index) => (
                      <TranscriptionItem
                        key={item.id}
                        item={item}
                        index={index}
                        onEditTranscription={onEditTranscription!}
                        onSeekToTime={handleSeekToTime}
                        formatTime={formatTime}
                        formatDateTimeForEdit={formatDateTimeForEdit}
                        parseDateTimeFromEdit={parseDateTimeFromEdit}
                        formatAudioTime={formatAudioTime}
                        parseAudioTime={parseAudioTime}
                        getConfidenceColor={getConfidenceColor}
                        getConfidenceLabel={getConfidenceLabel}
                      />
                    ))}
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
  return (
    prevProps.transcriptions === nextProps.transcriptions &&
    prevProps.isTranscribing === nextProps.isTranscribing &&
    prevProps.canRefineWithAI === nextProps.canRefineWithAI
  );
});
