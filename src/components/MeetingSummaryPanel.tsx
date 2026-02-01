import React, { useState, useEffect } from 'react';
import { Collapse, Button, Input, Space, Typography, Empty } from 'antd';
import { SaveOutlined, CloseOutlined, FileTextOutlined } from '@ant-design/icons';

const { TextArea } = Input;
const { Text } = Typography;

interface Props {
  summary: string;
  onSummaryChange: (newSummary: string) => void;
  onExportToWord?: () => void;
  onMarkUnsaved?: () => void;
}

export const MeetingSummaryPanel: React.FC<Props> = ({
  summary,
  onSummaryChange,
  onExportToWord,
  onMarkUnsaved
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedSummary, setEditedSummary] = useState(summary);

  // Update local state when prop changes
  useEffect(() => {
    setEditedSummary(summary);
  }, [summary]);

  const handleSave = () => {
    onSummaryChange(editedSummary);
    setIsEditing(false);
    onMarkUnsaved?.();
  };

  const handleCancel = () => {
    setEditedSummary(summary);
    setIsEditing(false);
  };

  return (
    <Collapse
      defaultActiveKey={['1']}
      className="metadata-panel"
      items={[
        {
          key: '1',
          label: (
            <Space>
              <span>✨Tóm tắt nội dung</span>
            </Space>
          ),
          extra: isEditing ? (
            <Space onClick={(e) => e.stopPropagation()}>
              <Button
                size="small"
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
              >
                Lưu
              </Button>
              <Button
                size="small"
                icon={<CloseOutlined />}
                onClick={handleCancel}
              >
                Hủy
              </Button>
            </Space>
          ) : onExportToWord && summary ? (
            <Button
              size="small"
              type="primary"
              icon={<FileTextOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onExportToWord();
              }}
            >
              Xuất Word
            </Button>
          ) : undefined,
          children: (
            <>
              {!summary && !isEditing ? (
                <Empty
                  description="Chưa có tóm tắt"
                  style={{ padding: '32px 0' }}
                >
                  <Text type="secondary">
                    Sử dụng tính năng "Chuyển đổi giọng nói bằng Gemini AI" để tự động tạo tóm tắt cuộc họp
                  </Text>
                </Empty>
              ) : isEditing ? (
                <TextArea
                  value={editedSummary}
                  onChange={(e) => setEditedSummary(e.target.value)}
                  placeholder="Nhập nội dung tóm tắt cuộc họp..."
                  autoSize={{ minRows: 8, maxRows: 20 }}
                  style={{ fontSize: '14px', lineHeight: '1.8' }}
                />
              ) : (
                <div
                  onDoubleClick={() => setIsEditing(true)}
                  style={{
                    padding: '16px',
                    background: '#fff9e6',
                    borderRadius: '6px',
                    fontSize: '14px',
                    lineHeight: '1.8',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: '#333',
                    border: '1px solid #ffe58f',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.2s'
                  }}
                  title="Double-click để chỉnh sửa"
                >
                  {summary}
                </div>
              )}
            </>
          )
        }
      ]}
    />
  );
};
