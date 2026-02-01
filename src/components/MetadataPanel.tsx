import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Input, Collapse } from 'antd';
import type { MeetingInfo } from '../types/types';

const { TextArea } = Input;

interface Props {
  meetingInfo: MeetingInfo;
  onChange: (info: MeetingInfo) => void;
}

export const MetadataPanel: React.FC<Props> = ({ meetingInfo, onChange }) => {
  // Local state for immediate UI update
  const [localInfo, setLocalInfo] = useState<MeetingInfo>(meetingInfo);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  
  // Sync local state when prop changes (e.g., load project)
  useEffect(() => {
    setLocalInfo(meetingInfo);
  }, [meetingInfo]);
  
  const handleChange = useCallback((field: keyof MeetingInfo, value: string) => {
    // Update local state immediately for responsive UI
    const newInfo = {
      ...localInfo,
      [field]: value
    };
    setLocalInfo(newInfo);
    
    // Debounce onChange callback to parent (300ms)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(() => {
      onChange(newInfo);
    }, 300); // 300ms debounce
  }, [localInfo, onChange]);

  return (
    <Collapse
      defaultActiveKey={['1']}
      className="metadata-panel"
      items={[
        {
          key: '1',
          label: '📋 Thông tin chung',
          children: (
            <div className="metadata-form">
              <div className="form-row">
                <label>Tên cuộc họp:</label>
                <Input
                  value={localInfo.title}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('title', e.target.value)}
                  placeholder="VD: Họp giao ban, thảo luận dự án..."
                />
              </div>

              <div className="form-row form-row-split">
                <div className="form-field">
                  <label>Ngày:</label>
                  <Input
                    type="date"
                    value={localInfo.date}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('date', e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label>Giờ:</label>
                  <Input
                    type="time"
                    value={localInfo.time}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('time', e.target.value)}
                  />
                </div>

                <div className="form-field">
                <label>Địa điểm:</label>
                <Input
                  value={localInfo.location}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('location', e.target.value)}
                  placeholder="VD: Phòng họp A / Zoom"
                />
              </div>
              </div>

              <div className="form-row form-row-split2" >
                <div className="form-field">
                  <label>Chủ trì:</label>
                  <TextArea
                  value={localInfo.host}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange('host', e.target.value)}
                  placeholder="Tên người chủ trì"
                  rows={1}
                  />
                </div>

                <div className="form-field">
                <label>Thành viên tham dự:</label>
                <TextArea
                  value={localInfo.attendees}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange('attendees', e.target.value)}
                  placeholder="Tên cách nhau bởi dấu phẩy (VD: Khanh Linh, Dac Minh, Dac Quang, ...) - LiveMeetingNotes được đầu tư & phát triển bởi Nguyen Dac Hung"
                  rows={1}
                />
              </div>
              </div>
            </div>
          )
        }
      ]}
    />
  );
};
