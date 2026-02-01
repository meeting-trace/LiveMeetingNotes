import React, { useState, useEffect } from 'react';
import { Card, Button, Input, Space, Typography, Empty } from 'antd';
import { EditOutlined, SaveOutlined, CloseOutlined, FileTextOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';

const { TextArea } = Input;
const { Text } = Typography;

interface Props {
  summary: string;
  onSummaryChange: (newSummary: string) => void;
  onExportToWord?: () => void;
}

export const MeetingSummaryPanel: React.FC<Props> = ({
  summary,
  onSummaryChange,
  onExportToWord
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedSummary, setEditedSummary] = useState(summary);
  const [collapsed, setCollapsed] = useState(false);

  // Update local state when prop changes
  useEffect(() => {
    setEditedSummary(summary);
  }, [summary]);

  const handleSave = () => {
    onSummaryChange(editedSummary);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedSummary(summary);
    setIsEditing(false);
  };

  return (
    <Card
      title={
        <Space>
          <FileTextOutlined style={{ color: '#1890ff' }} />
          <span>Tóm tắt cuộc họp</span>
        </Space>
      }
      extra={
        <Space>
          {!isEditing ? (
            <>
              <Button
                icon={<EditOutlined />}
                onClick={() => setIsEditing(true)}
                disabled={!summary}
              >
                Chỉnh sửa
              </Button>
              {onExportToWord && (
                <Button
                  type="primary"
                  icon={<FileTextOutlined />}
                  onClick={onExportToWord}
                  disabled={!summary}
                >
                  Xuất Word
                </Button>
              <Button
                icon={collapsed ? <DownOutlined /> : <UpOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                type="text"
              />
              )}
            </>
          ) : (
            <>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
              >
                Lưu
              </Button>
              <Button
                icon={<CloseOutlined />}
                onClick={handleCancel}
              >
                Hủy
              </Button>
            </>
        collapsed && (
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
              style={{
                padding: '16px',
                background: '#fff9e6',
                borderRadius: '6px',
                fontSize: '14px',
                lineHeight: '1.8',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#333',
                border: '1px solid #ffe58f'
              }}
            >
              {summary}
            </div>
          )}
        </hiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {summary}
        </div>
      )}
    </Card>
  );
};
