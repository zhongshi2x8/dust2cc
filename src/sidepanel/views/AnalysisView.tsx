import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { parseStructuredAIAnalysis } from '@shared/ai-structured-analysis';
import { computeAllIndicators } from '@shared/indicators';
import { validateLLMConfig } from '@shared/llm-config';
import { buildAnalysisFingerprint } from '@shared/analysis-fingerprint';
import { buildLocalAnalysisMarkdown } from '@shared/local-analysis';
import { detectAllPatterns } from '@shared/patterns';
import { buildKlineAnalysisPrompt } from '@shared/prompts/kline-analysis';
import { generateQuickSignal } from '@shared/prompts/trade-signal';
import { pickBestPriceCandidate } from '@shared/price-selection';
import { getSettings, saveAnalysisHistoryEntry, saveSettings } from '@shared/storage';
import type {
  AnalysisPeriodMode,
  KlinePeriod,
  PageSnapshot,
  StructuredAIAnalysis,
  TimeframeAnalysisInput,
  TradeSignal,
} from '@shared/types';
import { requestActivePageState } from '../page-data';

export function AnalysisView() {
  const [pageData, setPageData] = useState<PageSnapshot | null>(null);
  const [signal, setSignal] = useState<TradeSignal | null>(null);
  const [localAnalysis, setLocalAnalysis] = useState('');
  const [aiText, setAiText] = useState('');
  const [structuredAI, setStructuredAI] = useState<StructuredAIAnalysis | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [compareAIText, setCompareAIText] = useState('');
  const [compareStructuredAI, setCompareStructuredAI] = useState<StructuredAIAnalysis | null>(null);
  const [compareStreaming, setCompareStreaming] = useState(false);
  const [compareError, setCompareError] = useState('');
  const [compareModelLabel, setCompareModelLabel] = useState('');
  const [error, setError] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState<KlinePeriod>('1d');
  const [periodMode, setPeriodMode] = useState<AnalysisPeriodMode>('single');
  const lastAutoRunKeyRef = useRef('');
  const periodOptions: KlinePeriod[] = ['1h', '4h', '1d', '1w'];

  useEffect(() => {
    requestActivePageState().then(setPageData);
    getSettings().then((settings) => {
      setSelectedPeriod(settings.analysis.defaultPeriod);
      setPeriodMode(settings.analysis.periodMode);
    });

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

    const nextKey = `${buildAnalysisFingerprint(pageData)}::${selectedPeriod}::${periodMode}`;
    if (nextKey === lastAutoRunKeyRef.current) return;

    lastAutoRunKeyRef.current = nextKey;
    runAnalysis();
  }, [pageData, streaming, selectedPeriod, periodMode]);

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

  async function handlePeriodChange(period: KlinePeriod) {
    setSelectedPeriod(period);
    await saveSettings({
      analysis: {
        defaultPeriod: period,
      },
    });
  }

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
    const timeframeInputs = buildTimeframeInputs(pageData, selectedPeriod, periodMode);
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
    setCompareAIText('');
    setCompareStructuredAI(null);
    setCompareError('');
    setCompareModelLabel('');
    setError('');

    if (validateLLMConfig(settings.llm)) {
      await persistHistory(localSignal, localSummary, currentPrice, selectedPeriod, null, '');
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
          void persistHistory(localSignal, localSummary, currentPrice, selectedPeriod, parsed, parsed ? '' : fullText);
          setStreaming(false);
        } else if (msg.type === 'error') {
          setError(msg.error);
          void persistHistory(localSignal, localSummary, currentPrice, selectedPeriod, null, '');
          setStreaming(false);
        }
      });

      port.postMessage({
        messages: buildKlineAnalysisPrompt({
          goodsInfo: pageData.goodsInfo || { id: '', name: '未知饰品', source: 'csqaq' },
          price: { current: currentPrice, currency: 'CNY' },
          kline: pageData.kline,
          period: selectedPeriod,
          primaryPeriod: selectedPeriod,
          periodMode,
          style: settings.analysis.aiStyle,
          timeframes: timeframeInputs,
          indicators,
          patterns,
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析失败');
      await persistHistory(localSignal, localSummary, currentPrice, selectedPeriod, null, '');
      setStreaming(false);
    }
  }

  async function runCompareAnalysis() {
    if (!pageData || pageData.kline.length < 5) {
      setCompareError('当前还没有足够的 K 线数据。');
      return;
    }

    const settings = await getSettings();
    if (!settings.comparison.enabled) {
      setCompareError('请先去设置页启用并配置对比模型。');
      return;
    }

    const compareValidationError = validateLLMConfig(settings.comparison.llm);
    if (compareValidationError) {
      setCompareError(`对比模型配置有误：${compareValidationError}`);
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
    const timeframeInputs = buildTimeframeInputs(pageData, selectedPeriod, periodMode);

    setCompareStreaming(true);
    setCompareAIText('');
    setCompareStructuredAI(null);
    setCompareError('');
    setCompareModelLabel(`${settings.comparison.llm.provider} / ${settings.comparison.llm.model}`);

    try {
      const port = chrome.runtime.connect({ name: 'llm-stream' });
      let fullText = '';

      port.onMessage.addListener((msg) => {
        if (msg.type === 'chunk') {
          fullText += msg.text;
          setCompareAIText(fullText);
        } else if (msg.type === 'done') {
          const parsed = parseStructuredAIAnalysis(fullText);
          setCompareStructuredAI(parsed);
          setCompareAIText(parsed ? '' : fullText);
          setCompareStreaming(false);
        } else if (msg.type === 'error') {
          setCompareError(msg.error);
          setCompareStreaming(false);
        }
      });

      port.postMessage({
        configOverride: settings.comparison.llm,
        messages: buildKlineAnalysisPrompt({
          goodsInfo: pageData.goodsInfo || { id: '', name: '未知饰品', source: 'csqaq' },
          price: { current: currentPrice, currency: 'CNY' },
          kline: pageData.kline,
          period: selectedPeriod,
          primaryPeriod: selectedPeriod,
          periodMode,
          style: settings.analysis.aiStyle,
          timeframes: timeframeInputs,
          indicators,
          patterns,
        }),
      });
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : '对比分析失败');
      setCompareStreaming(false);
    }
  }

  async function persistHistory(
    localSignal: TradeSignal,
    localSummary: string,
    currentPrice: number,
    period: KlinePeriod,
    analysis: StructuredAIAnalysis | null,
    fallbackText: string,
  ) {
    if (!pageData?.goodsInfo) return;

    await saveAnalysisHistoryEntry({
      id: `${pageData.goodsInfo.id}-${period}-${Date.now()}`,
      createdAt: Date.now(),
      goodsId: pageData.goodsInfo.id,
      goodsName: pageData.goodsInfo.zhName || pageData.goodsInfo.name,
      price: currentPrice,
      period,
      localSignal: {
        action: localSignal.action,
        confidence: localSignal.confidence,
        reason: localSignal.reason,
      },
      localAnalysis: localSummary,
      structuredAI: analysis || undefined,
      fallbackText: analysis ? undefined : summarizeFallbackText(fallbackText),
    });
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

      <div className="period-toolbar">
        <div className="period-tabs">
          {periodOptions.map((period) => (
            <button
              key={period}
              type="button"
              className={selectedPeriod === period ? 'active' : ''}
              onClick={() => handlePeriodChange(period)}
            >
              {period}
            </button>
          ))}
        </div>
        <span className="period-mode-note">
          {periodMode === 'multi' ? '多周期联动' : '单周期分析'}
        </span>
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

          {(structuredAI || aiText) && (
            <div className="copy-actions">
              <button
                type="button"
                onClick={() => handleCopy('short')}
                disabled={!structuredAI}
              >
                复制简版结论
              </button>
              <button
                type="button"
                onClick={() => handleCopy('full')}
              >
                复制完整分析
              </button>
            </div>
          )}

          <button
            type="button"
            className="secondary-btn"
            onClick={runCompareAnalysis}
            disabled={compareStreaming}
          >
            {compareStreaming ? '对比模型分析中...' : '用对比模型再分析一次'}
          </button>

          {copyNotice && <div className="info-note">{copyNotice}</div>}
          {compareError && <div className="error-msg">❌ {compareError}</div>}

          {structuredAI ? (
            <StructuredAISection analysis={structuredAI} />
          ) : (
            aiText && (
              <div className="analysis-content markdown-body">
                <ReactMarkdown>{aiText}</ReactMarkdown>
              </div>
            )
          )}

          {(compareStreaming || compareStructuredAI || compareAIText) && (
            <div className="analysis-view">
              <div className="selection-summary">
                <strong>对比模型结论</strong>
                <span>{compareModelLabel || '对比模型'}</span>
              </div>

              {structuredAI && compareStructuredAI && (
                <div className="structured-ai-block">
                  <span className="structured-ai-label">差异摘要</span>
                  <strong>{buildComparisonSummary(structuredAI, compareStructuredAI)}</strong>
                </div>
              )}

              {compareStructuredAI ? (
                <StructuredAISection analysis={compareStructuredAI} />
              ) : (
                compareAIText && (
                  <div className="analysis-content markdown-body">
                    <ReactMarkdown>{compareAIText}</ReactMarkdown>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  async function handleCopy(mode: 'short' | 'full') {
    const goodsName = pageData?.goodsInfo?.zhName || pageData?.goodsInfo?.name || '未知饰品';
    const content =
      mode === 'short'
        ? (structuredAI ? buildShortCopyText(goodsName, structuredAI) : '')
        : buildFullCopyText(goodsName, signal, structuredAI, aiText);

    if (!content) return;

    try {
      await navigator.clipboard.writeText(content);
      setCopyNotice(mode === 'short' ? '已复制简版结论' : '已复制完整分析');
      window.setTimeout(() => setCopyNotice(''), 1800);
    } catch {
      setCopyNotice('复制失败，请检查浏览器权限');
      window.setTimeout(() => setCopyNotice(''), 1800);
    }
  }
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
  const hasKeyLevels = analysis.supportLevels.length > 0 || analysis.resistanceLevels.length > 0;
  const timeframeBiasEntries = Object.entries(analysis.timeframeBias || {});

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

      {analysis.summary && (
        <div className="structured-ai-block">
          <span className="structured-ai-label">核心结论</span>
          <strong>{analysis.summary}</strong>
        </div>
      )}

      {timeframeBiasEntries.length > 0 && (
        <div className="structured-ai-block">
          <span className="structured-ai-label">多周期倾向</span>
          <ul className="structured-ai-risks">
            {timeframeBiasEntries.map(([period, bias]) => (
              <li key={period}>
                {period}{analysis.primaryTimeframe === period ? '（主周期）' : ''}：{bias}
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.reasoning.length > 0 && (
        <div className="structured-ai-block">
          <span className="structured-ai-label">推理依据</span>
          <ul className="structured-ai-risks">
            {analysis.reasoning.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {analysis.signals.length > 0 && (
        <div className="structured-ai-block">
          <span className="structured-ai-label">信号</span>
          <ul className="structured-ai-risks">
            {analysis.signals.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {hasKeyLevels && (
        <div className="structured-ai-grid">
          {analysis.supportLevels.length > 0 && (
            <div className="structured-ai-block">
              <span className="structured-ai-label">支撑位</span>
              <strong>{formatLevels(analysis.supportLevels)}</strong>
            </div>
          )}
          {analysis.resistanceLevels.length > 0 && (
            <div className="structured-ai-block">
              <span className="structured-ai-label">压力位</span>
              <strong>{formatLevels(analysis.resistanceLevels)}</strong>
            </div>
          )}
        </div>
      )}

      {analysis.suggestion && (
        <div className="structured-ai-block">
          <span className="structured-ai-label">建议</span>
          <strong>{analysis.suggestion}</strong>
        </div>
      )}

      {analysis.risks.length > 0 && (
        <div className="structured-ai-block">
          <span className="structured-ai-label">风险提示</span>
          <ul className="structured-ai-risks">
            {analysis.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatLevels(levels: number[]): string {
  if (levels.length === 0) return '未给出';
  return levels.map((level) => `¥${level.toFixed(2)}`).join(' / ');
}

function buildShortCopyText(goodsName: string, analysis: StructuredAIAnalysis): string {
  return [
    `${goodsName} AI 简版结论`,
    `趋势：${analysis.trend || '未给出'}`,
    `置信度：${analysis.confidence}%`,
    `支撑位：${formatLevels(analysis.supportLevels)}`,
    `压力位：${formatLevels(analysis.resistanceLevels)}`,
    `建议：${analysis.suggestion || '未给出'}`,
  ].join('\n');
}

function buildFullCopyText(
  goodsName: string,
  signal: TradeSignal | null,
  analysis: StructuredAIAnalysis | null,
  fallbackText: string,
): string {
  const localSignalText = signal
    ? `本地信号：${signal.action} | 置信度 ${signal.confidence}%\n原因：${signal.reason}`
    : '本地信号：暂无';

  if (!analysis) {
    return [
      `${goodsName} 完整分析`,
      localSignalText,
      '',
      'AI 原始输出：',
      fallbackText || '暂无 AI 原始输出',
    ].join('\n');
  }

  return [
    `${goodsName} 完整分析`,
    localSignalText,
    '',
    `核心结论：${analysis.summary || '未给出'}`,
    `趋势：${analysis.trend || '未给出'}`,
    `建议：${analysis.suggestion || '未给出'}`,
    `支撑位：${formatLevels(analysis.supportLevels)}`,
    `压力位：${formatLevels(analysis.resistanceLevels)}`,
    `推理依据：${analysis.reasoning.join('；') || '未给出'}`,
    `信号：${analysis.signals.join('；') || '未给出'}`,
    `风险提示：${analysis.risks.join('；') || '未给出'}`,
  ].join('\n');
}

function summarizeFallbackText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 220 ? `${trimmed.slice(0, 220)}...` : trimmed;
}

function buildComparisonSummary(
  primary: StructuredAIAnalysis,
  secondary: StructuredAIAnalysis,
): string {
  const trendDiff = primary.trend === secondary.trend ? '两者趋势判断基本一致' : `主模型看 ${primary.trend}，对比模型看 ${secondary.trend}`;
  const confidenceDiff = `主模型 ${primary.confidence}% / 对比模型 ${secondary.confidence}%`;
  const suggestionDiff =
    primary.suggestion === secondary.suggestion
      ? '建议强度接近'
      : `建议差异：主模型“${primary.suggestion || '未给出'}”，对比模型“${secondary.suggestion || '未给出'}”`;

  return `${trendDiff}；置信度对比：${confidenceDiff}；${suggestionDiff}`;
}

function buildTimeframeInputs(
  pageData: PageSnapshot,
  selectedPeriod: KlinePeriod,
  periodMode: AnalysisPeriodMode,
): TimeframeAnalysisInput[] {
  const entries = pageData.timeframeData
    ? Object.entries(pageData.timeframeData)
        .filter(([, kline]) => Array.isArray(kline) && kline.length >= 5)
        .map(([period, kline]) => ({
          period: period as KlinePeriod,
          kline: kline!,
        }))
    : [];

  if (entries.length === 0) {
    return [buildTimeframeInput(selectedPeriod, pageData.price?.current ?? pageData.kline[pageData.kline.length - 1].close, pageData.kline)];
  }

  if (periodMode === 'single') {
    const matched = entries.find((entry) => entry.period === selectedPeriod) || entries[0];
    return [buildTimeframeInput(matched.period, pageData.price?.current ?? matched.kline[matched.kline.length - 1].close, matched.kline)];
  }

  const order: KlinePeriod[] = ['1h', '4h', '1d', '1w', '1M'];
  return entries
    .sort((a, b) => order.indexOf(a.period) - order.indexOf(b.period))
    .map((entry) => buildTimeframeInput(entry.period, pageData.price?.current ?? entry.kline[entry.kline.length - 1].close, entry.kline));
}

function buildTimeframeInput(period: KlinePeriod, currentPrice: number, kline: PageSnapshot['kline']): TimeframeAnalysisInput {
  return {
    period,
    price: { current: currentPrice, currency: 'CNY' },
    kline,
    indicators: computeAllIndicators(kline),
    patterns: detectAllPatterns(kline),
  };
}
