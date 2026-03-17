import React from 'react';
import { Select } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();

  return (
    <Select
      value={i18n.language}
      onChange={(val) => i18n.changeLanguage(val)}
      size="small"
      style={{ minWidth: 120 }}
      prefix={<GlobalOutlined />}
      options={[
        { value: 'vi', label: '🇻🇳 Tiếng Việt' },
        { value: 'en', label: '🇺🇸 English' },
      ]}
    />
  );
};
