import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { Collapse, Empty, Space, Tag, Tooltip, Button } from 'antd';
import { AudioOutlined, CloudServerOutlined } from '@ant-design/icons';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number>(100);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [isManuallyResized, setIsManuallyResized] = useState<boolean>(false);
  const [isUserScrolling, setIsUserScrolling] = useState<boolean>(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState<boolean>(false);
  
  // Check if there's cached Gemini file
  const [cacheInfo, setCacheInfo] = useState<{hasCachedFile: boolean; expiresIn: string} | null>(null);
  
  useEffect(() => {
    // Check localStorage for cached Gemini file
    const checkCache = () => {
      try {
        const keys = Object.keys(localStorage);
        const cacheKey = keys.find(k => k.startsWith('gemini_audio_cache_'));
        if (cacheKey) {
          const cached = JSON.parse(localStorage.getItem(cacheKey) || '{}');
          if (cached.expires) {
            const expiresDate = new Date(cached.expires);
            const now = new Date();
            const hoursLeft = Math.floor((expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60));
            
            if (hoursLeft > 0) {
              setCacheInfo({
                hasCachedFile: true,
                expiresIn: `${hoursLeft}h`
              });
            }
          }
        }
      } catch (e) {
        // Ignore cache check errors
      }
    };
    
    checkCache();
    const interval = setInterval(checkCache, 60000); // Check every minute
    
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom when new transcription arrives (only if user is at bottom)
  useEffect(() => {
    if (scrollRef.current && !isUserScrolling) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcriptions, isUserScrolling]);

  // Handle user scroll detection
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px threshold
    
    if (isNearBottom) {
      setIsUserScrolling(false);
      setShowScrollToBottom(false);
    } else {
      setIsUserScrolling(true);
      setShowScrollToBottom(true);
    }
  }, []);

  // Scroll to bottom manually
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsUserScrolling(false);
      setShowScrollToBottom(false);
    }
  }, []);

  // Auto-expand height based on content (only if not manually resized)
  useEffect(() => {
    if (isManuallyResized) return; // Skip auto-resize if user manually resized
    
    const calculateHeight = () => {
      if (scrollRef.current && transcriptions.length > 0) {
        const scrollHeight = scrollRef.current.scrollHeight;
        const newHeight = Math.min(scrollHeight + 80, 500);
        const calculatedHeight = Math.max(newHeight, 100);
        
        // Only update if different to avoid unnecessary re-renders
        setContentHeight(prev => prev === calculatedHeight ? prev : calculatedHeight);
      } else if (transcriptions.length === 0) {
        setContentHeight(prev => prev === 100 ? prev : 100);
      }
    };
    
    // Initial calculation (debounced for real-time updates)
    const timer1 = setTimeout(calculateHeight, 100);
    
    // Recalculate after DOM fully renders (for batch loads like load project)
    const timer2 = setTimeout(calculateHeight, 250);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [transcriptions, isManuallyResized]);

  // Handle resize dragging
  useEffect(() => {
    let rafId: number | null = null;
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      
      // Use requestAnimationFrame to throttle updates
      if (rafId !== null) return;
      
      rafId = requestAnimationFrame(() => {
        if (!containerRef.current) return;
        
        const containerRect = containerRef.current.getBoundingClientRect();
        const newHeight = e.clientY - containerRect.top;
        const clampedHeight = Math.max(100, Math.min(newHeight, window.innerHeight - 100));
        setContentHeight(clampedHeight);
        
        rafId = null;
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'nwse-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isResizing]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    setIsManuallyResized(true); // Mark as manually resized
  }, []);

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
    // When panel expands, recalculate height after DOM renders
    const isExpanded = Array.isArray(keys) ? keys.includes('1') : keys === '1';
    
    if (isExpanded && !isManuallyResized) {
      // Wait for collapse animation to complete, then recalculate
      setTimeout(() => {
        if (scrollRef.current && transcriptions.length > 0) {
          const scrollHeight = scrollRef.current.scrollHeight;
          const newHeight = Math.min(scrollHeight + 80, 500);
          const calculatedHeight = Math.max(newHeight, 100);
          setContentHeight(calculatedHeight);
        }
      }, 300); // Wait for animation
    }
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
                    Đang nhận dạng (chỉ hỗ trợ âm thanh từ Microphone)...
                  </Tag>
                )}
                {!isOnline && (
                  <Tag color="default">Offline</Tag>
                )}
                {transcriptions.length > 0 && (
                  <Tag color="blue">{transcriptions.length} đoạn</Tag>
                )}
                {cacheInfo?.hasCachedFile && (
                  <Tooltip title="File audio đã được cache trên Gemini. Query lần sau sẽ nhanh hơn (chỉ mất ~10-20s)">
                    <Tag color="cyan" icon={<CloudServerOutlined />}>
                      ⚡ Cached ({cacheInfo.expiresIn})
                    </Tag>
                  </Tooltip>
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
            <div 
              ref={containerRef}
              style={{ 
                height: `${contentHeight}px`,
                display: 'flex',
                flexDirection: 'column',
                transition: isResizing ? 'none' : 'height 0.3s ease',
                position: 'relative'
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
                    onScroll={handleScroll}
                    style={{
                      flex: 1,
                      overflowY: 'auto',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
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
                  
                  {/* Scroll to bottom button */}
                  {showScrollToBottom && (
                    <div style={{
                      position: 'absolute',
                      bottom: '30px',
                      right: '20px',
                      zIndex: 100
                    }}>
                      <Tooltip title="Cuộn xuống cuối cùng">
                        <Button
                          type="primary"
                          shape="circle"
                          icon={<span style={{ fontSize: '16px' }}>↓</span>}
                          onClick={scrollToBottom}
                          style={{
                            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                          }}
                        />
                      </Tooltip>
                    </div>
                  )}
                </>
              )}
              
              {/* Resize handle - góc dưới bên phải */}
              <div
                onMouseDown={handleResizeStart}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: '20px',
                  height: '20px',
                  cursor: 'nwse-resize',
                  background: 'linear-gradient(135deg, transparent 0%, transparent 50%, #d9d9d9 50%, #d9d9d9 100%)',
                  opacity: 0.6,
                  transition: 'opacity 0.2s',
                  zIndex: 10
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  if (!isResizing) {
                    e.currentTarget.style.opacity = '0.6';
                  }
                }}
              />
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
