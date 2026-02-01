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
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#4096ff',
          colorBgContainer: '#2d2d30',
          colorBgElevated: '#3c3c3f',
          colorBorder: '#3f3f46',
          colorText: '#ffffff',
          colorTextSecondary: '#cccccc',
          borderRadius: 6
        }
      }}
    >
      <AntdApp>
        <MainApp />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
);
