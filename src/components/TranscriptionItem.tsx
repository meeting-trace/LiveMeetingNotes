import React, { memo, useState, useCallback } from 'react';
import { Tag, Space, Tooltip, Button, Input } from 'antd';
import { ClockCircleOutlined, UserOutlined, CheckCircleOutlined, EditOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import type { TranscriptionResult } from '../types/types';

interface Props {
  item: TranscriptionResult;
  index: number;
  onEditTranscription: (id: string, newText: string, newSpeaker: string, newStartTime?: string, newAudioTimeMs?: number) => void;
  onSeekToTime: (timeMs: number, shouldPlay?: boolean) => void;
  formatTime: (isoTime: string) => string;
  formatDateTimeForEdit: (isoTime: string) => string;
  parseDateTimeFromEdit: (dateTimeStr: string) => string;
  formatAudioTime: (ms: number) => string;
  parseAudioTime: (timeStr: string) => number;
  getConfidenceColor: (confidence: number) => string;
  getConfidenceLabel: (confidence: number) => string;
}

const TranscriptionItemComponent: React.FC<Props> = ({
  item,
  index,
  onEditTranscription,
  onSeekToTime,
  formatTime,
  formatDateTimeForEdit,
  parseDateTimeFromEdit,
  formatAudioTime,
  parseAudioTime,
  getConfidenceColor,
  getConfidenceLabel
}) => {
  // Each item manages its own edit state - NO parent re-renders!
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [editSpeaker, setEditSpeaker] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editAudioTimeMs, setEditAudioTimeMs] = useState<number | undefined>(undefined);

  const handleStartEdit = useCallback(() => {
    setIsEditing(true);
    setEditText(item.text);
    setEditSpeaker(item.speaker);
    setEditStartTime(formatDateTimeForEdit(item.startTime));
    setEditAudioTimeMs(item.audioTimeMs);
  }, [item.text, item.speaker, item.startTime, item.audioTimeMs, formatDateTimeForEdit]);

  const handleSaveEdit = useCallback(() => {
    const isoStartTime = parseDateTimeFromEdit(editStartTime);
    onEditTranscription(
      item.id,
      editText.trim(),
      editSpeaker.trim() || 'Person1',
      isoStartTime,
      editAudioTimeMs
    );
    setIsEditing(false);
  }, [item.id, editText, editSpeaker, editStartTime, editAudioTimeMs, parseDateTimeFromEdit, onEditTranscription]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditText('');
    setEditSpeaker('');
    setEditStartTime('');
    setEditAudioTimeMs(undefined);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (item.isFinal && !isEditing) {
      handleStartEdit();
    }
  }, [item.isFinal, isEditing, handleStartEdit]);

  return (
    <div
      style={{
        padding: '12px',
        backgroundColor: item.isFinal ? (item.isManuallyEdited ? '#fff7e6' : '#f6ffed') : '#e6f7ff',
        border: `1px solid ${item.isFinal ? (item.isManuallyEdited ? '#ffa940' : '#b7eb8f') : '#91d5ff'}`,
        borderRadius: '8px',
        position: 'relative',
        cursor: item.isFinal ? 'pointer' : 'default'
      }}
      onDoubleClick={handleDoubleClick}
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
          {/* Time - Now showing for all transcriptions including Gemini AI */}
          <Tooltip title="Thời gian">
            <Tag icon={<ClockCircleOutlined />} color="blue" style={{ fontSize: '11px' }}>
              {formatTime(item.startTime)}
            </Tag>
          </Tooltip>

          {/* Audio Time - Clickable (single click to seek, double click to seek+play) */}
          {item.audioTimeMs !== undefined && (
            <Tooltip title="Click để nhảy đến vị trí này trong audio">
              <Tag 
                color="cyan" 
                style={{ 
                  cursor: 'pointer',
                  userSelect: 'none',
                  fontSize: '11px'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeekToTime(item.audioTimeMs!, false);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onSeekToTime(item.audioTimeMs!, true);
                }}
              >
                🎵 {formatAudioTime(item.audioTimeMs)}
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
                onClick={handleStartEdit}
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
          
          {/* AI refined indicator */}
          {item.isAIRefined && (
            <Tooltip title="Đã chuẩn hóa bằng AI ✨">
              <Tag color="green" style={{ fontSize: '10px', margin: 0 }}>
                ✨ AI
              </Tag>
            </Tooltip>
          )}
        </Space>
      </div>

      {/* Content */}
      {isEditing ? (
        <>
          {/* Edit Form */}
          <div style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
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

              {/* Edit Audio Time */}
              {editAudioTimeMs !== undefined && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <label style={{ fontSize: '12px', color: '#666', marginRight: '6px', whiteSpace: 'nowrap' }}>
                    Vị trí audio:
                  </label>
                  <Input
                    size="small"
                    value={formatAudioTime(editAudioTimeMs)}
                    onChange={(e) => setEditAudioTimeMs(parseAudioTime(e.target.value))}
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
              autoFocus
            />

            {/* Edit actions */}
            <Space size="small">
              <Button
                type="primary"
                size="small"
                icon={<SaveOutlined />}
                onClick={handleSaveEdit}
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
        </>
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
              ⏳ Đang nhận dạng (chỉ hỗ trợ âm thanh từ Microphone)...
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Memoize to prevent re-renders when other items change
export const TranscriptionItem = memo(TranscriptionItemComponent, (prevProps, nextProps) => {
  // Only re-render if this specific item changed
  return prevProps.item.id === nextProps.item.id &&
         prevProps.item.text === nextProps.item.text &&
         prevProps.item.speaker === nextProps.item.speaker &&
         prevProps.item.startTime === nextProps.item.startTime &&
         prevProps.item.audioTimeMs === nextProps.item.audioTimeMs &&
         prevProps.item.isManuallyEdited === nextProps.item.isManuallyEdited &&
         prevProps.item.isAIRefined === nextProps.item.isAIRefined;
});
