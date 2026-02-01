import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Input, Collapse, Modal } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import type { MeetingInfo } from '../types/types';

const { TextArea } = Input;

interface Props {
  meetingInfo: MeetingInfo;
  onChange: (info: MeetingInfo) => void;
  hasSegments?: boolean; // Whether there are transcription segments
  onConvertTimestamps?: (newMeetingStartTime: Date) => void; // Callback to convert timestamps
}

export const MetadataPanel: React.FC<Props> = ({ 
  meetingInfo, 
  onChange, 
  hasSegments = false,
  onConvertTimestamps
}) => {
  // Local state for immediate UI update
  const [localInfo, setLocalInfo] = useState<MeetingInfo>(meetingInfo);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const previousDateTimeRef = useRef<{ date: string; time: string }>({ 
    date: meetingInfo.date, 
    time: meetingInfo.time 
  });
  
  // Sync local state when prop changes (e.g., load project)
  useEffect(() => {
    setLocalInfo(meetingInfo);
    previousDateTimeRef.current = { date: meetingInfo.date, time: meetingInfo.time };
  }, [meetingInfo]);
  
  const handleChange = useCallback((field: keyof MeetingInfo, value: string) => {
    // Update local state immediately for responsive UI
    const newInfo = {
      ...localInfo,
      [field]: value
    };
    setLocalInfo(newInfo);
    
    // Check if date or time changed AND there are segments
    const isDateTimeChange = (field === 'date' || field === 'time');
    const hasValidPreviousDateTime = previousDateTimeRef.current.date && previousDateTimeRef.current.time;
    const hasValidNewDateTime = newInfo.date && newInfo.time;
    
    if (isDateTimeChange && hasSegments && hasValidPreviousDateTime && hasValidNewDateTime && onConvertTimestamps) {
      const previousDateTime = new Date(`${previousDateTimeRef.current.date}T${previousDateTimeRef.current.time}:00`);
      const newDateTime = new Date(`${newInfo.date}T${newInfo.time}:00`);
      
      // Only ask if both are valid dates and they are different
      if (!isNaN(previousDateTime.getTime()) && !isNaN(newDateTime.getTime()) && 
          previousDateTime.getTime() !== newDateTime.getTime()) {
        
        // Show confirmation modal
        Modal.confirm({
          title: '🕐 Convert nhãn thời gian?',
          icon: <ExclamationCircleOutlined />,
          content: (
            <div style={{ marginTop: 16 }}>
              <p>Bạn đã thay đổi thời gian bắt đầu cuộc họp:</p>
              <ul style={{ marginLeft: 20, marginTop: 8 }}>
                <li><b>Trước:</b> {previousDateTime.toLocaleString('vi-VN')}</li>
                <li><b>Sau:</b> {newDateTime.toLocaleString('vi-VN')}</li>
              </ul>
              <p style={{ marginTop: 12 }}>
                Bạn có muốn cập nhật lại nhãn thời gian (startTime) của các segments theo thời gian mới không?
              </p>
              <p style={{ fontSize: '12px', color: '#666', marginTop: 8 }}>
                ℹ️ Công thức: <code>startTime = thời gian bắt đầu họp + audioTimeMs</code>
              </p>
            </div>
          ),
          okText: 'Có, convert lại',
          cancelText: 'Không',
          width: 520,
          onOk: () => {
            // User confirmed - convert timestamps
            onConvertTimestamps(newDateTime);
            // Update previous reference
            previousDateTimeRef.current = { date: newInfo.date, time: newInfo.time };
          },
          onCancel: () => {
            // User declined - just update the reference
            previousDateTimeRef.current = { date: newInfo.date, time: newInfo.time };
          }
        });
      } else {
        // Update reference even if dates are same
        previousDateTimeRef.current = { date: newInfo.date, time: newInfo.time };
      }
    }
    
    // Debounce onChange callback to parent (300ms)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(() => {
      onChange(newInfo);
    }, 300); // 300ms debounce
  }, [localInfo, onChange, hasSegments, onConvertTimestamps]);

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
