import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as MainApp } from './App';
import { ConfigProvider, theme, App as AntdApp } from 'antd';
import './styles/global.css';

// Register service worker for caching and updates
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Add timestamp to bypass GitHub Pages cache
    const swUrl = `/sw.js?v=${Date.now()}`;
    
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        console.log('✅ Service Worker registered:', registration.scope);
        
        // Check for updates every minute
        setInterval(() => {
          registration.update();
        }, 60000);
      })
      .catch((error) => {
        console.error('❌ Service Worker registration failed:', error);
      });
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
