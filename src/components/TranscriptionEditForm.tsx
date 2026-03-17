import React, { memo } from 'react';
import { Input, Button, Space } from 'antd';
import { SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

interface Props {
  editText: string;
  editSpeaker: string;
  editStartTime: string;
  editAudioTimeMs: number | undefined;
  onTextChange: (value: string) => void;
  onSpeakerChange: (value: string) => void;
  onStartTimeChange: (value: string) => void;
  onAudioTimeChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  formatAudioTime: (ms: number) => string;
  parseAudioTime: (timeStr: string) => number;
}

// Memoized component to prevent re-renders when parent transcriptions change
export const TranscriptionEditForm: React.FC<Props> = memo(({
  editText,
  editSpeaker,
  editStartTime,
  editAudioTimeMs,
  onTextChange,
  onSpeakerChange,
  onStartTimeChange,
  onAudioTimeChange,
  onSave,
  onCancel,
  formatAudioTime
}) => {
  const { t } = useTranslation();
  return (
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
            {t('transcriptionItem.timeLabel')}
          </label>
          <Input
            size="small"
            value={editStartTime}
            onChange={(e) => onStartTimeChange(e.target.value)}
            placeholder={t('transcriptionItem.timePlaceholder')}
            style={{ width: '170px' }}
          />
        </div>
        
        {/* Edit Timestamp (Audio Time) */}
        {editAudioTimeMs !== undefined && (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <label style={{ fontSize: '12px', color: '#666', marginRight: '6px', whiteSpace: 'nowrap' }}>
              {t('transcriptionItem.audioTimeLabel')}
            </label>
            <Input
              size="small"
              value={formatAudioTime(editAudioTimeMs)}
              onChange={(e) => onAudioTimeChange(e.target.value)}
              placeholder={t('transcriptionItem.audioTimePlaceholder')}
              style={{ width: '80px' }}
            />
          </div>
        )}

        {/* Edit Speaker */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <label style={{ fontSize: '12px', color: '#666', marginRight: '6px', whiteSpace: 'nowrap' }}>
            {t('transcriptionItem.speakerLabel')}
          </label>
          <Input
            size="small"
            value={editSpeaker}
            onChange={(e) => onSpeakerChange(e.target.value)}
            placeholder={t('transcriptionItem.speakerPlaceholder')}
            style={{ width: '120px' }}
          />
        </div>
      </div>
      
      {/* Edit Text */}
      <Input.TextArea
        value={editText}
        onChange={(e) => onTextChange(e.target.value)}
        autoSize={{ minRows: 2, maxRows: 6 }}
        style={{ marginBottom: '8px' }}
      />
      
      {/* Edit actions */}
      <Space size="small">
        <Button
          type="primary"
          size="small"
          icon={<SaveOutlined />}
          onClick={onSave}
        >
          {t('transcriptionItem.save')}
        </Button>
        <Button
          size="small"
          icon={<CloseOutlined />}
          onClick={onCancel}
        >
          {t('transcriptionItem.cancel')}
        </Button>
      </Space>
    </div>
  );
});

TranscriptionEditForm.displayName = 'TranscriptionEditForm';
