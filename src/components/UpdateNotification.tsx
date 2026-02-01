import React from 'react';
import { Button, Space, message } from 'antd';
import { ReloadOutlined, CloseOutlined } from '@ant-design/icons';
import { updateManager } from '../services/updateManager';

interface Props {
  onClose: () => void;
}

export const UpdateNotification: React.FC<Props> = ({ onClose }) => {
  const handleUpdate = async () => {
    try {
      message.loading({ content: '🔄 Đang cập nhật...', key: 'update', duration: 0 });
      await updateManager.applyUpdate();
      // Page will reload automatically after update
    } catch (error: any) {
      message.error({ content: `❌ Lỗi khi cập nhật: ${error.message}`, key: 'update' });
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: '70px',
      right: '20px',
      zIndex: 1000,
      backgroundColor: '#fff',
      padding: '16px 20px',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      border: '1px solid #1890ff',
      maxWidth: '400px',
      animation: 'slideIn 0.3s ease-out'
    }}>
      <style>
        {`
          @keyframes slideIn {
            from {
              transform: translateX(100%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
        `}
      </style>
      
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px', color: '#1890ff' }}>
            ✨ Phiên bản mới có sẵn!
          </div>
          <div style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
            Có bản cập nhật mới của ứng dụng. Cập nhật ngay để trải nghiệm tính năng mới nhất.
          </div>
          
          <Space>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={handleUpdate}
              size="small"
            >
              Cập nhật ngay
            </Button>
            <Button
              icon={<CloseOutlined />}
              onClick={onClose}
              size="small"
            >
              Để sau
            </Button>
          </Space>
        </div>
      </div>
    </div>
  );
};
