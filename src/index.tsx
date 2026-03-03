import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as MainApp } from './App';
import { ConfigProvider, theme, App as AntdApp } from 'antd';
import './styles/global.css';
import { registerSW } from 'virtual:pwa-register';

// Register service worker with update prompt
if ((import.meta as any).env?.PROD) {
  registerSW({
    immediate: true,
    onNeedRefresh() {
      console.log('🔄 New version available! App will notify user.');
      // Dispatch custom event that updateManager can listen to
      window.dispatchEvent(new CustomEvent('sw-update-available'));
    },
    onOfflineReady() {
      console.log('✅ App ready to work offline');
    },
    onRegistered(registration: any) {
      if (registration) {
        console.log('✅ Service Worker registered');
        // Check for updates when app loads
        registration.update();
      }
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#5046e4',
          colorPrimaryHover: '#4338ca',
          colorBgContainer: '#ffffff',
          colorBgElevated: '#ffffff',
          colorBgLayout: '#f7f7f8',
          colorBgSpotlight: '#f3f4f6',
          colorBorder: '#e5e7eb',
          colorBorderSecondary: '#f3f4f6',
          colorText: '#111827',
          colorTextSecondary: '#6b7280',
          colorTextTertiary: '#9ca3af',
          colorTextPlaceholder: '#9ca3af',
          colorSuccess: '#059669',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          colorInfo: '#0284c7',
          borderRadius: 6,
          borderRadiusLG: 10,
          borderRadiusSM: 4,
          fontSize: 14,
          fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
          boxShadow: '0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)',
          boxShadowSecondary: '0 4px 6px -1px rgba(0,0,0,.07), 0 2px 4px -1px rgba(0,0,0,.04)',
        }
      }}
    >
      <AntdApp>
        <MainApp />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
);
