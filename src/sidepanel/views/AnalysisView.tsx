import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { parseStructuredAIAnalysis } from '@shared/ai-structured-analysis';
import { computeAllIndicators } from '@shared/indicators';
import { buildAnalysisFingerprint } from '@shared/analysis-fingerprint';
import { buildLocalAnalysisMarkdown } from '@shared/local-analysis';
import { detectAllPatterns } from '@shared/patterns';
import { buildKlineAnalysisPrompt } from '@shared/prompts/kline-analysis';
import { generateQuickSignal } from '@shared/prompts/trade-signal';
import { pickBestPriceCandidate } from '@shared/price-selection';
import { getSettings } from '@shared/storage';
import type { PageSnapshot, StructuredAIAnalysis, TradeSignal } from '@shared/types';
import { requestActivePageState } from '../page-data';

export function AnalysisView() {
  const [pageData, setPageData] = useState<PageSnapshot | null>(null);
  const [signal, setSignal] = useState<TradeSignal | null>(null);
  const [localAnalysis, setLocalAnalysis] = useState('');
  const [aiText, setAiText] = useState('');
  const [structuredAI, setStructuredAI] = useState<StructuredAIAnalysis | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const lastAutoRunKeyRef = useRef('');

  useEffect(() => {
    requestActivePageState().then(setPageData);

    const listener = (msg: { type: string; data?: unknown }) => {
      if (msg.type === 'PAGE_STATE_UPDATED') {
        setPageData(msg.data as PageSnapshot);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!pageData?.goodsInfo || pageData.kline.length < 5 || streaming) return;

    const nextKey = buildAnalysisFingerprint(pageData);
    if (nextKey === lastAutoRunKeyRef.current) return;

    lastAutoRunKeyRef.current = nextKey;
    runAnalysis();
  }, [pageData, streaming]);

  const displayPrice =
    pageData?.price
      ? (
          pickBestPriceCandidate(
            [
              { value: pageData.price.current, weight: 10 },
              { value: pageData.kline[pageData.kline.length - 1]?.close, weight: 0 },
            ],
            pageData.kline[pageData.kline.length - 1]?.close,
          )?.value ?? pageData.price.current
        )
      : null;

  async function runAnalysis() {
    if (!pageData || pageData.kline.length < 5) {
      setError('K线数据不足，请先等待图表加载完成，或手动切换一次 K 线周期。');
      return;
    }

    const indicators = computeAllIndicators(pageData.kline);
    const patterns = detectAllPatterns(pageData.kline);
    const lastClose = pageData.kline[pageData.kline.length - 1].close;
    const currentPrice =
      pickBestPriceCandidate(
        [
          { value: pageData.price?.current, weight: 10 },
          { value: lastClose, weight: 0 },
        ],
        lastClose,
      )?.value ?? lastClose;
    const settings = await getSettings();
    const localSignal = generateQuickSignal(currentPrice, indicators, patterns);
    const localSummary = buildLocalAnalysisMarkdown({
      goodsInfo: pageData.goodsInfo,
      price: { current: currentPrice, currency: 'CNY' },
      kline: pageData.kline,
      indicators,
      patterns,
      signal: localSignal,
    });

    setSignal(localSignal);
    setLocalAnalysis(localSummary);
    setAiText('');
    setStructuredAI(null);
    setError('');

    const canUseLLM =
      Boolean(settings.llm.apiKey)
      || settings.llm.provider === 'ollama'
      || settings.llm.provider === 'openai_compatible_custom';

    if (!canUseLLM) {
      setStreaming(false);
      return;
    }

    setStreaming(true);

    try {
      const port = chrome.runtime.connect({ name: 'llm-stream' });
      let fullText = '';

      port.onMessage.addListener((msg) => {
        if (msg.type === 'chunk') {
          fullText += msg.text;
          setAiText(fullText);
        } else if (msg.type === 'done') {
          const parsed = parseStructuredAIAnalysis(fullText);
          setStructuredAI(parsed);
          setAiText(parsed ? '' : fullText);
          setStreaming(false);
        } else if (msg.type === 'error') {
          setError(msg.error);
          setStreaming(false);
        }
      });

      port.postMessage({
        messages: buildKlineAnalysisPrompt({
          goodsInfo: pageData.goodsInfo || { id: '', name: '未知饰品', source: 'csqaq' },
          price: { current: currentPrice, currency: 'CNY' },
          kline: pageData.kline,
          period: '1d',
          indicators,
          patterns,
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析失败');
      setStreaming(false);
    }
  }

  return (
    <div className="analysis-view">
      <div className="status-bar">
        {pageData?.goodsInfo ? (
          <span className="goods-name">
            🔫 {pageData.goodsInfo.zhName || pageData.goodsInfo.name}
          </span>
        ) : (
          <span className="no-data">请打开受支持站点的饰品详情页</span>
        )}
        {displayPrice !== null && (
          <span className="price">¥{displayPrice.toFixed(2)}</span>
        )}
      </div>

      {signal && <SignalCard signal={signal} />}

      <div className="info-note">
        当前默认使用本地分析。只要抓到 K 线，就会直接给出结论。
      </div>

      {pageData?.goodsInfo && pageData.kline.length < 5 && (
        <div className="error-msg">
          当前只抓到 {pageData.kline.length} 根 K 线。请在商品页里等图表加载完成，或手动切一次日 K / 周 K 后再试。
        </div>
      )}

      <button
        className="analyze-btn"
        onClick={runAnalysis}
        disabled={streaming || !pageData}
      >
        {streaming ? '分析中...' : '开始分析'}
      </button>

      {error && <div className="error-msg">❌ {error}</div>}

      {localAnalysis && (
        <div className="analysis-content markdown-body">
          <ReactMarkdown>{localAnalysis}</ReactMarkdown>
        </div>
      )}

      {(streaming || structuredAI || aiText) && (
        <div className="analysis-view">
          <div className="selection-summary">
            <strong>AI 深度分析</strong>
            <span>
              {streaming
                ? '模型正在生成结构化结论...'
                : structuredAI
                  ? '已按结构化字段渲染。'
                  : '模型未返回有效 JSON，已自动回退到原始文本显示。'}
            </span>
          </div>

          {structuredAI ? (
            <StructuredAISection analysis={structuredAI} />
          ) : (
            aiText && (
              <div className="analysis-content markdown-body">
                <ReactMarkdown>{aiText}</ReactMarkdown>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function SignalCard({ signal }: { signal: TradeSignal }) {
  const config = {
    buy: { emoji: '📈', label: '买入', className: 'signal-buy' },
    sell: { emoji: '📉', label: '卖出', className: 'signal-sell' },
    hold: { emoji: '⏸️', label: '观望', className: 'signal-hold' },
  }[signal.action];

  return (
    <div className={`signal-card ${config.className}`}>
      <span className="signal-emoji">{config.emoji}</span>
      <div>
        <div className="signal-action">
          {config.label} | 置信度 {signal.confidence}%
        </div>
        <div className="signal-reason">{signal.reason}</div>
      </div>
    </div>
  );
}

function StructuredAISection({ analysis }: { analysis: StructuredAIAnalysis }) {
  return (
    <div className="structured-ai-card">
      <div className="structured-ai-grid">
        <div className="structured-ai-block">
          <span className="structured-ai-label">趋势</span>
          <strong>{analysis.trend || '未给出'}</strong>
        </div>
        <div className="structured-ai-block">
          <span className="structured-ai-label">置信度</span>
          <strong>{analysis.confidence}%</strong>
        </div>
      </div>

      <div className="structured-ai-grid">
        <div className="structured-ai-block">
          <span className="structured-ai-label">支撑位</span>
          <strong>{formatLevels(analysis.supportLevels)}</strong>
        </div>
        <div className="structured-ai-block">
          <span className="structured-ai-label">压力位</span>
          <strong>{formatLevels(analysis.resistanceLevels)}</strong>
        </div>
      </div>

      <div className="structured-ai-block">
        <span className="structured-ai-label">建议</span>
        <strong>{analysis.suggestion || '未给出'}</strong>
      </div>

      <div className="structured-ai-block">
        <span className="structured-ai-label">风险提示</span>
        <ul className="structured-ai-risks">
          {(analysis.risks.length ? analysis.risks : ['暂无额外风险提示']).map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function formatLevels(levels: number[]): string {
  if (levels.length === 0) return '未给出';
  return levels.map((level) => `¥${level.toFixed(2)}`).join(' / ');
}
