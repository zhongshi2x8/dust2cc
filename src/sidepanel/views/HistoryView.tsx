import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { clearAnalysisHistory, getAnalysisHistory } from '@shared/storage';
import type { AnalysisHistoryEntry, AnalysisPeriodMode, AnalysisStyle } from '@shared/types';

export function HistoryView() {
  const [history, setHistory] = useState<AnalysisHistoryEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<AnalysisHistoryEntry | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void loadHistory();
  }, []);

  async function loadHistory() {
    const entries = await getAnalysisHistory();
    setHistory(entries);
    setSelectedEntry((current) =>
      current ? entries.find((entry) => entry.id === current.id) || entries[0] || null : entries[0] || null,
    );
    if (entries.length === 0) {
      setConfirmClear(false);
    }
  }

  async function handleClearHistory() {
    await clearAnalysisHistory();
    setHistory([]);
    setSelectedEntry(null);
    setConfirmClear(false);
  }

  return (
    <div className="history-view">
      <div className="selection-summary">
        <strong>最近分析记录</strong>
        <span>最多保留 50 条，方便回看最近做过的判断和 AI 结论。</span>
      </div>

      {history.length > 0 && (
        confirmClear ? (
          <div className="confirm-inline">
            <span>确认清空最近 50 条历史记录吗？这个操作不能恢复。</span>
            <div className="confirm-inline-actions">
              <button type="button" onClick={handleClearHistory}>
                确认清空
              </button>
              <button type="button" className="ghost-btn" onClick={() => setConfirmClear(false)}>
                先不清空
              </button>
            </div>
          </div>
        ) : (
          <div className="form-actions">
            <button type="button" onClick={() => setConfirmClear(true)}>
              清空历史记录
            </button>
          </div>
        )
      )}

      {history.length === 0 ? (
        <div className="info-note">这里还没有分析记录。先去“分析”页跑一次，就会自动保存在这里。</div>
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
                  <span className="structured-ai-label">分析模式 / 主周期</span>
                  <strong>
                    {getPeriodModeLabel(selectedEntry.periodMode)}
                    {selectedEntry.primaryTimeframe ? ` / ${selectedEntry.primaryTimeframe}` : ''}
                  </strong>
                </div>
              </div>

              <div className="structured-ai-grid">
                <div className="structured-ai-block">
                  <span className="structured-ai-label">分析风格</span>
                  <strong>{getStyleLabel(selectedEntry.analysisStyle)}</strong>
                </div>
                <div className="structured-ai-block">
                  <span className="structured-ai-label">本地信号</span>
                  <strong>{getSignalLabel(selectedEntry.localSignal.action)} / {selectedEntry.localSignal.confidence}%</strong>
                </div>
              </div>

              {selectedEntry.usedTimeframes?.length ? (
                <div className="structured-ai-block">
                  <span className="structured-ai-label">本次分析周期</span>
                  <strong>{selectedEntry.usedTimeframes.join(' / ')}</strong>
                </div>
              ) : null}

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
                      <span className="structured-ai-label">AI 建议</span>
                      <strong>{selectedEntry.structuredAI.suggestion || '未给出'}</strong>
                    </div>
                  </div>
                  {selectedEntry.structuredAI.risks.length > 0 && (
                    <div className="structured-ai-block">
                      <span className="structured-ai-label">风险提示</span>
                      <ul className="structured-ai-risks">
                        {selectedEntry.structuredAI.risks.map((risk) => (
                          <li key={risk}>{risk}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : selectedEntry.fallbackText ? (
                <div className="analysis-content markdown-body">
                  <ReactMarkdown>{selectedEntry.fallbackText}</ReactMarkdown>
                </div>
              ) : null}

              <div className="analysis-content markdown-body">
                <ReactMarkdown>{selectedEntry.localAnalysis}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatHistoryMeta(entry: AnalysisHistoryEntry): string {
  return [
    new Date(entry.createdAt).toLocaleString(),
    `¥${entry.price.toFixed(2)}`,
    `${entry.period} / ${getPeriodModeShortLabel(entry.periodMode)}`,
  ].join(' | ');
}

function getPeriodModeLabel(mode: AnalysisPeriodMode): string {
  return mode === 'multi' ? '多周期联动分析' : '单周期分析';
}

function getPeriodModeShortLabel(mode: AnalysisPeriodMode): string {
  return mode === 'multi' ? '多周期' : '单周期';
}

function getStyleLabel(style: AnalysisStyle): string {
  switch (style) {
    case 'conservative':
      return '保守风格';
    case 'aggressive':
      return '激进风格';
    case 'objective':
      return '客观风格';
    default:
      return '平衡风格';
  }
}

function getSignalLabel(action: AnalysisHistoryEntry['localSignal']['action']): string {
  switch (action) {
    case 'buy':
      return '买入';
    case 'sell':
      return '卖出';
    default:
      return '观望';
  }
}
