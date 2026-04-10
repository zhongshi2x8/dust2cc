import React, { useState } from 'react';
import { AnalysisView } from './views/AnalysisView';
import { SettingsView } from './views/SettingsView';
import { EXTENSION_NAME } from '@shared/constants';

export function App() {
  const [activeView, setActiveView] = useState<'analysis' | 'settings'>('analysis');

  return (
    <div className="app">
      <header className="app-header">
        <h1>🧙 {EXTENSION_NAME}</h1>
        <p className="app-subtitle">
          插件由 <a href="https://dust2.cc" target="_blank" rel="noreferrer">dust2.cc</a> 提供
        </p>
      </header>

      <nav className="app-nav">
        <button
          className={activeView === 'analysis' ? 'active' : ''}
          onClick={() => setActiveView('analysis')}
        >
          分析
        </button>
        <button
          className={activeView === 'settings' ? 'active' : ''}
          onClick={() => setActiveView('settings')}
        >
          设置
        </button>
      </nav>

      <main className="app-main">
        {activeView === 'analysis' ? <AnalysisView /> : <SettingsView />}
      </main>
    </div>
  );
}
