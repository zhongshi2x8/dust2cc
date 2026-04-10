import React, { useEffect, useState } from 'react';
import { clearAnalysisHistory, getAnalysisHistory } from '@shared/storage';
import type { AnalysisHistoryEntry } from '@shared/types';

export function HistoryView() {
  const [history, setHistory] = useState<AnalysisHistoryEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<AnalysisHistoryEntry | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    const entries = await getAnalysisHistory();
    setHistory(entries);
    setSelectedEntry((current) => current ? entries.find((entry) => entry.id === current.id) || entries[0] || null : entries[0] || null);
  }

  async function handleClearHistory() {
    await clearAnalysisHistory();
    setHistory([]);
    setSelectedEntry(null);
  }

  return (
    <div className="history-view">
      <div className="selection-summary">
        <strong>最近分析记录</strong>
        <span>最多保留 50 条，支持点击查看详情。</span>
      </div>

      <div className="form-actions">
        <button type="button" onClick={handleClearHistory} disabled={history.length === 0}>
          清空历史记录
        </button>
      </div>

      {history.length === 0 ? (
        <div className="info-note">还没有历史记录。先去“分析”页跑一次分析即可。</div>
      ) : (
        <div className="history-layout">
          <div className="history-list">
            {history.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`history-card ${selectedEntry?.id === entry.id ? 'active' : ''}`}
                onClick={() => setSelectedEntry(entry)}
              >
                <strong>{entry.goodsName}</strong>
                <span>{formatHistoryMeta(entry)}</span>
                <span>{entry.structuredAI?.summary || entry.fallbackText || entry.localSignal.reason}</span>
              </button>
            ))}
          </div>

          {selectedEntry && (
            <div className="history-detail">
              <div className="structured-ai-block">
                <span className="structured-ai-label">饰品</span>
                <strong>{selectedEntry.goodsName}</strong>
              </div>
              <div className="structured-ai-grid">
                <div className="structured-ai-block">
                  <span className="structured-ai-label">价格 / 周期</span>
                  <strong>¥{selectedEntry.price.toFixed(2)} / {selectedEntry.period}</strong>
                </div>
                <div className="structured-ai-block">
                  <span className="structured-ai-label">本地信号</span>
                  <strong>{selectedEntry.localSignal.action} | {selectedEntry.localSignal.confidence}%</strong>
                </div>
              </div>

              {selectedEntry.structuredAI ? (
                <>
                  {selectedEntry.structuredAI.summary && (
                    <div className="structured-ai-block">
                      <span className="structured-ai-label">AI 核心结论</span>
                      <strong>{selectedEntry.structuredAI.summary}</strong>
                    </div>
                  )}
                  <div className="structured-ai-grid">
                    <div className="structured-ai-block">
                      <span className="structured-ai-label">趋势 / 置信度</span>
                      <strong>{selectedEntry.structuredAI.trend} / {selectedEntry.structuredAI.confidence}%</strong>
                    </div>
                    <div className="structured-ai-block">
                      <span className="structured-ai-label">建议</span>
                      <strong>{selectedEntry.structuredAI.suggestion || '未给出'}</strong>
                    </div>
                  </div>
                </>
              ) : selectedEntry.fallbackText ? (
                <div className="analysis-content markdown-body">
                  {selectedEntry.fallbackText}
                </div>
              ) : null}

              <div className="analysis-content markdown-body">
                {selectedEntry.localAnalysis}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatHistoryMeta(entry: AnalysisHistoryEntry): string {
  return `${new Date(entry.createdAt).toLocaleString()} | ¥${entry.price.toFixed(2)} | ${entry.period}`;
}
