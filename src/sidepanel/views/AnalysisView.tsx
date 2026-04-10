import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { parseStructuredAIAnalysis } from '@shared/ai-structured-analysis';
import { buildAnalysisFingerprint } from '@shared/analysis-fingerprint';
import { computeAllIndicators } from '@shared/indicators';
import { validateLLMConfig } from '@shared/llm-config';
import { buildLocalAnalysisMarkdown } from '@shared/local-analysis';
import { detectAllPatterns } from '@shared/patterns';
import { buildKlineAnalysisPrompt } from '@shared/prompts/kline-analysis';
import { generateQuickSignal } from '@shared/prompts/trade-signal';
import { pickBestPriceCandidate } from '@shared/price-selection';
import { getSettings, saveAnalysisHistoryEntry, saveSettings } from '@shared/storage';
import type {
  AnalysisPeriodMode,
  AnalysisStyle,
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
  const [mainModelLabel, setMainModelLabel] = useState('');
  const [hasConfiguredPrimaryModel, setHasConfiguredPrimaryModel] = useState(false);
  const [compareAIText, setCompareAIText] = useState('');
  const [compareStructuredAI, setCompareStructuredAI] = useState<StructuredAIAnalysis | null>(null);
  const [compareStreaming, setCompareStreaming] = useState(false);
  const [compareError, setCompareError] = useState('');
  const [compareModelLabel, setCompareModelLabel] = useState('');
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [error, setError] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState<KlinePeriod>('1d');
  const [periodMode, setPeriodMode] = useState<AnalysisPeriodMode>('single');
  const [analysisStyle, setAnalysisStyle] = useState<AnalysisStyle>('balanced');
  const [usedTimeframes, setUsedTimeframes] = useState<KlinePeriod[]>(['1d']);
  const [baseSectionCollapsed, setBaseSectionCollapsed] = useState(false);
  const [mainSectionCollapsed, setMainSectionCollapsed] = useState(false);
  const lastAutoRunKeyRef = useRef('');
  const periodOptions: KlinePeriod[] = ['1h', '4h', '1d', '1w'];

  useEffect(() => {
    requestActivePageState().then(setPageData);
    getSettings().then((settings) => {
      const primaryModelConfigured = validateLLMConfig(settings.llm) === null;
      setSelectedPeriod(settings.analysis.defaultPeriod);
      setPeriodMode(settings.analysis.periodMode);
      setAnalysisStyle(settings.analysis.aiStyle);
      setCompareEnabled(settings.comparison.enabled);
      setMainModelLabel(`${settings.llm.provider} / ${settings.llm.model}`);
      setHasConfiguredPrimaryModel(primaryModelConfigured);
      setBaseSectionCollapsed(primaryModelConfigured);
      setMainSectionCollapsed(false);
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
    void runAnalysis();
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

  const effectiveStructuredAI = useMemo(
    () => structuredAI || parseStructuredAIAnalysis(aiText),
    [aiText, structuredAI],
  );

  const effectivePeriodMode: AnalysisPeriodMode = periodMode === 'multi' && usedTimeframes.length > 1 ? 'multi' : 'single';
  const currentModeLabel = getPeriodModeLabel(effectivePeriodMode);
  const onlyOneTimeframeDetected = periodMode === 'multi' && usedTimeframes.length <= 1;
  const hasAISection = Boolean(localAnalysis || streaming || structuredAI || aiText);
  const compareConfiguredHint = compareEnabled
    ? '你可以随时用第二套模型复核当前结论。'
    : '还没配置对比模型，可去“设置”页启用后再试。';

  const mainSummaryText = useMemo(() => {
    if (streaming) return '模型正在生成结构化结论...';
    if (effectiveStructuredAI) return '已按结构化字段渲染，可直接复制和留档。';
    if (aiText) return '模型未返回有效 JSON，已自动回退到原始文本显示。';
    if (localAnalysis) return '当前先展示本地分析结果，AI 结果会在可用时自动补充。';
    return '';
  }, [aiText, effectiveStructuredAI, localAnalysis, streaming]);

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

    const settings = await getSettings();
    const timeframeInputs = buildTimeframeInputs(pageData, selectedPeriod, periodMode);
    const activePeriods = timeframeInputs.map((entry) => entry.period);
    const primaryPeriod = timeframeInputs.find((entry) => entry.period === selectedPeriod)?.period ?? timeframeInputs[0]?.period ?? selectedPeriod;
    const primaryInput = timeframeInputs.find((entry) => entry.period === primaryPeriod) ?? timeframeInputs[0];

    if (!primaryInput) {
      setError('暂时没有可用于分析的周期数据。');
      return;
    }

    const indicators = primaryInput.indicators;
    const patterns = primaryInput.patterns;
    const lastClose = primaryInput.kline[primaryInput.kline.length - 1].close;
    const currentPrice =
      pickBestPriceCandidate(
        [
          { value: pageData.price?.current, weight: 10 },
          { value: lastClose, weight: 0 },
        ],
        lastClose,
      )?.value ?? lastClose;
    const localSignal = generateQuickSignal(currentPrice, indicators, patterns);
    const localSummary = buildLocalAnalysisMarkdown({
      goodsInfo: pageData.goodsInfo,
      price: { current: currentPrice, currency: 'CNY' },
      kline: primaryInput.kline,
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
    setUsedTimeframes(activePeriods);
    setAnalysisStyle(settings.analysis.aiStyle);
    setCompareEnabled(settings.comparison.enabled);
    setMainModelLabel(`${settings.llm.provider} / ${settings.llm.model}`);
    const primaryModelConfigured = validateLLMConfig(settings.llm) === null;
    setHasConfiguredPrimaryModel(primaryModelConfigured);

    const validationError = validateLLMConfig(settings.llm);
    if (validationError) {
      setError(`当前模型配置不可用：${validationError}`);
      await persistHistory({
        localSignal,
        localSummary,
        currentPrice,
        period: selectedPeriod,
        primaryPeriod,
        activePeriods,
        style: settings.analysis.aiStyle,
        analysis: null,
        fallbackText: '',
      });
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
          void persistHistory({
            localSignal,
            localSummary,
            currentPrice,
            period: selectedPeriod,
            primaryPeriod,
            activePeriods,
            style: settings.analysis.aiStyle,
            analysis: parsed,
            fallbackText: parsed ? '' : fullText,
          });
          setStreaming(false);
        } else if (msg.type === 'error') {
          setError(msg.error);
          void persistHistory({
            localSignal,
            localSummary,
            currentPrice,
            period: selectedPeriod,
            primaryPeriod,
            activePeriods,
            style: settings.analysis.aiStyle,
            analysis: null,
            fallbackText: '',
          });
          setStreaming(false);
        }
      });

      port.postMessage({
        messages: buildKlineAnalysisPrompt({
          goodsInfo: pageData.goodsInfo || { id: '', name: '未知饰品', source: 'csqaq' },
          price: { current: currentPrice, currency: 'CNY' },
          kline: primaryInput.kline,
          period: selectedPeriod,
          primaryPeriod,
          periodMode,
          style: settings.analysis.aiStyle,
          timeframes: timeframeInputs,
          indicators,
          patterns,
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析失败');
      await persistHistory({
        localSignal,
        localSummary,
        currentPrice,
        period: selectedPeriod,
        primaryPeriod,
        activePeriods,
        style: settings.analysis.aiStyle,
        analysis: null,
        fallbackText: '',
      });
      setStreaming(false);
    }
  }

  async function runCompareAnalysis() {
    if (!pageData || pageData.kline.length < 5) {
      setCompareError('当前还没有足够的 K 线数据。');
      return;
    }

    const settings = await getSettings();
    setCompareEnabled(settings.comparison.enabled);
    if (!settings.comparison.enabled) {
      setCompareError('请先去设置页启用并配置对比模型。');
      return;
    }

    const compareValidationError = validateLLMConfig(settings.comparison.llm);
    if (compareValidationError) {
      setCompareError(`对比模型配置有误：${compareValidationError}`);
      return;
    }

    const timeframeInputs = buildTimeframeInputs(pageData, selectedPeriod, periodMode);
    const primaryPeriod = timeframeInputs.find((entry) => entry.period === selectedPeriod)?.period ?? timeframeInputs[0]?.period ?? selectedPeriod;
    const primaryInput = timeframeInputs.find((entry) => entry.period === primaryPeriod) ?? timeframeInputs[0];

    if (!primaryInput) {
      setCompareError('对比模型暂时没有可用的周期数据。');
      return;
    }

    const lastClose = primaryInput.kline[primaryInput.kline.length - 1].close;
    const currentPrice =
      pickBestPriceCandidate(
        [
          { value: pageData.price?.current, weight: 10 },
          { value: lastClose, weight: 0 },
        ],
        lastClose,
      )?.value ?? lastClose;

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
          kline: primaryInput.kline,
          period: selectedPeriod,
          primaryPeriod,
          periodMode,
          style: settings.analysis.aiStyle,
          timeframes: timeframeInputs,
          indicators: primaryInput.indicators,
          patterns: primaryInput.patterns,
        }),
      });
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : '对比分析失败');
      setCompareStreaming(false);
    }
  }

  async function persistHistory({
    localSignal,
    localSummary,
    currentPrice,
    period,
    primaryPeriod,
    activePeriods,
    style,
    analysis,
    fallbackText,
  }: {
    localSignal: TradeSignal;
    localSummary: string;
    currentPrice: number;
    period: KlinePeriod;
    primaryPeriod: KlinePeriod;
    activePeriods: KlinePeriod[];
    style: AnalysisStyle;
    analysis: StructuredAIAnalysis | null;
    fallbackText: string;
  }) {
    if (!pageData?.goodsInfo) return;

    await saveAnalysisHistoryEntry({
      id: `${pageData.goodsInfo.id}-${period}-${Date.now()}`,
      createdAt: Date.now(),
      goodsId: pageData.goodsInfo.id,
      goodsName: pageData.goodsInfo.zhName || pageData.goodsInfo.name,
      price: currentPrice,
      period,
      periodMode,
      analysisStyle: style,
      primaryTimeframe: primaryPeriod,
      usedTimeframes: activePeriods,
      localSignal: {
        action: localSignal.action,
        confidence: localSignal.confidence,
        reason: localSignal.reason,
      },
      localAnalysis: localSummary,
      structuredAI: analysis || undefined,
      fallbackText: analysis ? undefined : summarizeFallbackText(fallbackText),
      // TODO: 后续如果需要复盘多模型分歧，可以把 compare 结果也写进历史记录。
    });
  }

  async function handleCopy(mode: 'short' | 'full') {
    const goodsName = pageData?.goodsInfo?.zhName || pageData?.goodsInfo?.name || '未知饰品';
    const content =
      mode === 'short'
        ? (effectiveStructuredAI ? buildShortCopyText(goodsName, effectiveStructuredAI, {
            periodMode,
            effectivePeriodMode,
            primaryTimeframe: effectiveStructuredAI.primaryTimeframe || selectedPeriod,
            usedTimeframes,
          }) : '')
        : buildFullCopyText(goodsName, signal, effectiveStructuredAI, aiText, {
            style: analysisStyle,
            periodMode,
            effectivePeriodMode,
            primaryTimeframe: effectiveStructuredAI?.primaryTimeframe || selectedPeriod,
            usedTimeframes,
          });

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
        当前默认使用本地分析。只要抓到 K 线，就会先给出本地结论，再叠加 AI 深度分析。
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
          {periodMode === 'multi' ? '多周期联动分析' : '单周期分析'}
        </span>
      </div>

      {pageData?.goodsInfo && pageData.kline.length < 5 && (
        <div className="error-msg">
          当前只抓到 {pageData.kline.length} 根 K 线。请在商品页里等图表加载完成，或手动切一次日 K / 周 K 后再试。
        </div>
      )}

      <button
        className="analyze-btn"
        onClick={() => void runAnalysis()}
        disabled={streaming || !pageData}
      >
        {streaming ? '分析中...' : '开始分析'}
      </button>

      {error && <div className="error-msg">❌ {error}</div>}

      {localAnalysis && (
        <CollapsibleSection
          title="本地基础分析"
          subtitle={hasConfiguredPrimaryModel ? '已配置主模型，默认收起以便优先查看 AI 结果。' : '当前没有可用主模型，默认展开基础分析。'}
          collapsed={baseSectionCollapsed}
          onToggle={() => setBaseSectionCollapsed((current) => !current)}
        >
          <div className="analysis-content markdown-body">
            <ReactMarkdown>{localAnalysis}</ReactMarkdown>
          </div>
        </CollapsibleSection>
      )}

      {hasAISection && (
        <div className="analysis-view">
          <div className="selection-summary">
            <strong>AI 深度分析</strong>
            <span>{mainSummaryText}</span>
          </div>

          <div className="analysis-meta-panel">
            <div className="analysis-meta-row">
              <span className="meta-chip">分析模式：{currentModeLabel}</span>
              <span className="meta-chip">分析风格：{getAnalysisStyleLabel(analysisStyle)}</span>
              <span className="meta-chip">主模型：{mainModelLabel || '未配置'}</span>
            </div>
            <div className="analysis-meta-row">
              <span className="meta-chip">主周期：{structuredAI?.primaryTimeframe || selectedPeriod}</span>
              <span className="meta-chip">本次分析周期：{usedTimeframes.join(' / ')}</span>
            </div>
            {onlyOneTimeframeDetected && (
              <div className="info-note">
                当前页面仅检测到一个可用周期，已自动按单周期分析。
              </div>
            )}
          </div>

          {(effectiveStructuredAI || aiText) && (
            <div className="copy-actions">
              <button
                type="button"
                onClick={() => void handleCopy('short')}
                disabled={!effectiveStructuredAI}
                title={!effectiveStructuredAI ? '只有结构化 AI 结果才能生成简版结论。' : '复制适合发群和发消息的简版结论'}
              >
                复制简版结论
              </button>
              <button
                type="button"
                onClick={() => void handleCopy('full')}
                title="复制包含本地信号与 AI 详情的完整分析"
              >
                复制完整分析
              </button>
            </div>
          )}

          <div className="compare-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void runCompareAnalysis()}
              disabled={compareStreaming}
            >
              {compareStreaming ? '对比模型分析中...' : '用对比模型再分析一次'}
            </button>
            <span className="subtle-note">{compareConfiguredHint}</span>
          </div>

          {copyNotice && <div className="info-note">{copyNotice}</div>}
          {compareError && <div className="error-msg">❌ {compareError}</div>}

          <CollapsibleSection
            title="主模型分析"
            subtitle={mainModelLabel || '未配置模型'}
            collapsed={mainSectionCollapsed}
            onToggle={() => setMainSectionCollapsed((current) => !current)}
            badge={streaming ? '分析中' : effectiveStructuredAI ? '已完成' : aiText ? '原始文本' : undefined}
          >
            <div className="model-analysis-section">
              {effectiveStructuredAI ? (
                <StructuredAISection analysis={effectiveStructuredAI} />
              ) : (
                aiText && (
                  <div className="analysis-content markdown-body">
                    <ReactMarkdown>{aiText}</ReactMarkdown>
                  </div>
                )
              )}

              {!streaming && !effectiveStructuredAI && !aiText && (
                <div className="info-note">当前没有可显示的 AI 输出，已保留本地分析结果。</div>
              )}
            </div>
          </CollapsibleSection>

          {(compareStreaming || compareStructuredAI || compareAIText) && (
            <div className="model-analysis-section compare-section">
              <div className="selection-summary">
                <strong>对比模型分析</strong>
                <span>{compareModelLabel || '对比模型'}</span>
              </div>

              {compareStreaming && (
                <div className="info-note">
                  主模型结论已经可看，对比模型还在生成，请稍等片刻。
                </div>
              )}

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
                  <>
                    <div className="info-note">对比模型未返回结构化 JSON，以下为原始文本。</div>
                    <div className="analysis-content markdown-body">
                      <ReactMarkdown>{compareAIText}</ReactMarkdown>
                    </div>
                  </>
                )
              )}
            </div>
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

function CollapsibleSection({
  title,
  subtitle,
  badge,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="collapsible-section">
      <button type="button" className="collapsible-header" onClick={onToggle}>
        <div className="collapsible-copy">
          <strong>{title}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        <div className="collapsible-actions">
          {badge ? <span className="provider-badge subtle">{badge}</span> : null}
          <span className={`collapsible-caret ${collapsed ? 'collapsed' : ''}`}>⌄</span>
        </div>
      </button>
      {!collapsed ? children : null}
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
          <div className="timeframe-bias-list">
            {timeframeBiasEntries.map(([period, bias]) => (
              <div
                key={period}
                className={`timeframe-bias-item ${analysis.primaryTimeframe === period ? 'primary' : ''}`}
              >
                <span className="timeframe-bias-period">
                  {period}
                  {analysis.primaryTimeframe === period ? ' · 主周期' : ''}
                </span>
                <strong>{bias}</strong>
              </div>
            ))}
          </div>
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

function buildShortCopyText(
  goodsName: string,
  analysis: StructuredAIAnalysis,
  options: {
    periodMode: AnalysisPeriodMode;
    effectivePeriodMode: AnalysisPeriodMode;
    primaryTimeframe: string;
    usedTimeframes: KlinePeriod[];
  },
): string {
  return [
    `[${goodsName}]`,
    `分析模式：${getPeriodModeLabel(options.effectivePeriodMode)}`,
    options.periodMode === 'multi' ? `主周期：${options.primaryTimeframe}` : '',
    options.usedTimeframes.length > 1 ? `分析周期：${options.usedTimeframes.join(' / ')}` : '',
    `趋势：${analysis.trend || '未给出'}`,
    `置信度：${analysis.confidence}%`,
    `支撑位：${formatLevels(analysis.supportLevels)}`,
    `压力位：${formatLevels(analysis.resistanceLevels)}`,
    `建议：${analysis.suggestion || '未给出'}`,
  ].filter(Boolean).join('\n');
}

function buildFullCopyText(
  goodsName: string,
  signal: TradeSignal | null,
  analysis: StructuredAIAnalysis | null,
  fallbackText: string,
  options: {
    style: AnalysisStyle;
    periodMode: AnalysisPeriodMode;
    effectivePeriodMode: AnalysisPeriodMode;
    primaryTimeframe: string;
    usedTimeframes: KlinePeriod[];
  },
): string {
  const sections = [
    `[${goodsName}] 完整分析`,
    [
      `分析模式：${getPeriodModeLabel(options.effectivePeriodMode)}`,
      `分析风格：${getAnalysisStyleLabel(options.style)}`,
      `主周期：${options.primaryTimeframe}`,
      `本次分析周期：${options.usedTimeframes.join(' / ')}`,
    ].join('\n'),
    buildLocalSignalSummary(signal),
  ];

  if (!analysis) {
    sections.push([
      'AI 原始输出',
      fallbackText || '暂无 AI 原始输出',
    ].join('\n'));
    return sections.join('\n\n');
  }

  sections.push([
    'AI 结构化结论',
    `核心结论：${analysis.summary || '未给出'}`,
    `趋势：${analysis.trend || '未给出'}`,
    `置信度：${analysis.confidence}%`,
    `建议：${analysis.suggestion || '未给出'}`,
    `支撑位：${formatLevels(analysis.supportLevels)}`,
    `压力位：${formatLevels(analysis.resistanceLevels)}`,
  ].join('\n'));

  if (analysis.reasoning.length > 0) {
    sections.push(['推理依据', ...analysis.reasoning.map((item, index) => `${index + 1}. ${item}`)].join('\n'));
  }

  if (analysis.signals.length > 0) {
    sections.push(['信号', ...analysis.signals.map((item, index) => `${index + 1}. ${item}`)].join('\n'));
  }

  if (analysis.risks.length > 0) {
    sections.push(['风险提示', ...analysis.risks.map((item, index) => `${index + 1}. ${item}`)].join('\n'));
  }

  return sections.join('\n\n');
}

function buildLocalSignalSummary(signal: TradeSignal | null): string {
  if (!signal) {
    return '本地信号\n暂无';
  }

  return [
    '本地信号',
    `方向：${getSignalLabel(signal.action)}`,
    `置信度：${signal.confidence}%`,
    `原因：${signal.reason}`,
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
  const summaryDiff =
    primary.summary && secondary.summary
      ? (primary.summary === secondary.summary
          ? '两者核心结论接近'
          : `主模型结论“${primary.summary}”，对比模型结论“${secondary.summary}”`)
      : '至少一方没有给出核心结论';
  const trendDiff =
    primary.trend === secondary.trend
      ? '趋势判断基本一致'
      : `趋势分歧：主模型看 ${primary.trend}，对比模型看 ${secondary.trend}`;
  const confidenceDiff = `置信度：主模型 ${primary.confidence}% / 对比模型 ${secondary.confidence}%`;
  const suggestionDiff =
    primary.suggestion === secondary.suggestion
      ? '建议强度接近'
      : `建议差异：主模型“${primary.suggestion || '未给出'}”，对比模型“${secondary.suggestion || '未给出'}”`;

  return `${summaryDiff}；${trendDiff}；${confidenceDiff}；${suggestionDiff}`;
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
    return [buildTimeframeInput(
      selectedPeriod,
      pageData.price?.current ?? pageData.kline[pageData.kline.length - 1].close,
      pageData.kline,
    )];
  }

  if (periodMode === 'single') {
    const matched = entries.find((entry) => entry.period === selectedPeriod) || entries[0];
    return [buildTimeframeInput(
      matched.period,
      pageData.price?.current ?? matched.kline[matched.kline.length - 1].close,
      matched.kline,
    )];
  }

  const order: KlinePeriod[] = ['1h', '4h', '1d', '1w', '1M'];
  return entries
    .sort((a, b) => order.indexOf(a.period) - order.indexOf(b.period))
    .map((entry) => buildTimeframeInput(
      entry.period,
      pageData.price?.current ?? entry.kline[entry.kline.length - 1].close,
      entry.kline,
    ));
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

function getSignalLabel(action: TradeSignal['action']): string {
  switch (action) {
    case 'buy':
      return '买入';
    case 'sell':
      return '卖出';
    default:
      return '观望';
  }
}

function getPeriodModeLabel(mode: AnalysisPeriodMode): string {
  return mode === 'multi' ? '多周期联动分析' : '单周期分析';
}

function getAnalysisStyleLabel(style: AnalysisStyle): string {
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
