import React from 'react';
import { Select } from 'antd';
// import { GlobalOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const LANGUAGES = [
  { value: 'vi', flag: '🇻🇳', label: "🌐"},
  { value: 'en', flag: '🇺🇸', label: "🌐"},
];

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();

  const current = LANGUAGES.find(l => l.value === i18n.language) ?? LANGUAGES[0];

  return (
    <Select
      value={i18n.language}
      onChange={(val) => i18n.changeLanguage(val)}
      size="small"
      // suffixIcon={<GlobalOutlined style={{ color: 'white', fontSize: 12, verticalAlign: 'middle' }} />}
      style={{ minWidth: 60, display: 'flex', alignItems: 'center' }}
      labelRender={() => (
        <span style={{ color: '#fff', fontWeight: 600, letterSpacing: '0.02em', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}>
          {current.label}&nbsp;{current.flag}
        </span>
      )}
      options={LANGUAGES.map(l => ({
        value: l.value,
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 , verticalAlign: 'middle'}}>
            <span style={{ fontSize: 18 }}>{l.flag}</span>
            {/* <span>{l.label}</span> */}
          </span>
        ),
      }))}
      popupMatchSelectWidth={false}
    />
  );
};
