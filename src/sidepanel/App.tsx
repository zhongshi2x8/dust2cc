import React from 'react';
import { AnalysisView } from './views/AnalysisView';
import { EXTENSION_NAME } from '@shared/constants';

export function App() {
  const popupMode = window.innerWidth <= 420;

  return (
    <div className={`app ${popupMode ? 'popup-mode' : ''}`}>
      <header className="app-header">
        <h1>🧙 {EXTENSION_NAME}</h1>
        <p className="app-subtitle">
          插件由 <a href="https://dust2.cc" target="_blank" rel="noreferrer">dust2.cc</a> 提供
        </p>
      </header>

      <main className="app-main">
        <AnalysisView />
      </main>
    </div>
  );
}
