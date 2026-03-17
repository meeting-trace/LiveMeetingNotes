import React from 'react';
import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import 'flag-icons/css/flag-icons.min.css';

// fi-XX uses ISO 3166-1 alpha-2 country codes (lowercase)
const LANGUAGES = [
  { value: 'vi', fiCode: 'vn', labelText: 'VI' },
  { value: 'en', fiCode: 'us', labelText: 'EN' },
];

const FlagIcon: React.FC<{ fiCode: string; size?: number }> = ({ fiCode, size = 18 }) => (
  <span
    className={`fi fi-${fiCode}`}
    style={{ fontSize: size, lineHeight: 1, borderRadius: 2, flexShrink: 0 }}
  />
);

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();

  const current = LANGUAGES.find(l => l.value === i18n.language) ?? LANGUAGES[0];

  return (
    <Select
      value={i18n.language}
      onChange={(val) => i18n.changeLanguage(val)}
      size="small"
      style={{ minWidth: 64, display: 'flex', alignItems: 'center' }}
      labelRender={() => (
        <span style={{ color: '#fff', fontWeight: 600, letterSpacing: '0.02em', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <FlagIcon fiCode={current.fiCode} size={13} />
          {current.labelText}
        </span>
      )}
      options={LANGUAGES.map(l => ({
        value: l.value,
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <FlagIcon fiCode={l.fiCode} size={13} />
            {l.labelText}
          </span>
        ),
      }))}
      popupMatchSelectWidth={false}
    />
  );
};
