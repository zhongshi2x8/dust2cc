// ============================================================
// Content Script Entry — orchestrates data capture & UI injection
// ============================================================

import type {
  KlinePoint,
  GoodsInfo,
  PriceInfo,
  TradeSignal,
  PageSnapshot,
  IndicatorResult,
} from '@shared/types';
import { calcMA, computeAllIndicators } from '@shared/indicators';
import { buildLocalAnalysisMarkdown } from '@shared/local-analysis';
import { buildAnalysisFingerprint } from '@shared/analysis-fingerprint';
import { getVisibleChartMarkerPoints } from '@shared/chart-markers';
import { detectAllPatterns } from '@shared/patterns';
import { buildKlineAnalysisPrompt } from '@shared/prompts/kline-analysis';
import { generateQuickSignal } from '@shared/prompts/trade-signal';
import { detectTupleKlineFormat, normalizePriceLikeKlineRecords, normalizeTupleKlineList, sanitizeKlinePoints } from '@shared/kline-normalization';
import {
  getBestReferenceDeltaRatio,
  isPriceAlignedWithReference,
  isPriceAlignedWithReferences,
  pickBestPriceCandidate,
  pickPreferredObservedPrice,
} from '@shared/price-selection';
import { getSettings } from '@shared/storage';
import { getAdapterForUrl } from './extractors/base';
import { DOMWatcher } from './observers/dom-watcher';
import { injectPanel, injectSignalBadge, updateSignalBadge, renderChartMarkers } from './injector/panel';
import type { ChartMarkerPoint } from './injector/panel';

type PageState = PageSnapshot;

interface DebugState {
  pageScript: 'pending' | 'loaded' | 'failed';
  panel: 'pending' | 'mounted';
  anchor: 'chart-below' | 'hero-inline' | 'floating' | 'missing';
  lastCapture: string;
  captureCount: number;
  lastIssue: string;
  annotation: string;
}

interface KlinePayloadMeta {
  chartScore?: number;
  seriesLength?: number;
  periodHint?: string;
  isVisible?: boolean;
  isActive?: boolean;
  sourceText?: string;
}

interface KlineAcceptance {
  accept: boolean;
  score: number;
  reason: string;
}

const PANEL_ID = 'cs2-ai-analyst-panel';
const CHART_ANNOTATION_MESSAGE = 'cs2-ai-annotate-chart';

const state: PageState = {
  goodsInfo: null,
  price: null,
  kline: [],
};

const debugState: DebugState = {
  pageScript: 'pending',
  panel: 'pending',
  anchor: 'missing',
  lastCapture: '尚未抓到任何数据',
  captureCount: 0,
  lastIssue: '等待页面初始化',
  annotation: '未开始',
};

let currentAdapter = getAdapterForUrl(window.location.href);
let watcher: DOMWatcher | null = null;
let pageHooksInstalled = false;
let autoAnalysisKey = '';
let preferredKlineSource: 'network' | 'echarts' | null = null;
let acceptedKlineScore = Number.NEGATIVE_INFINITY;

function supportsInlinePanel() {
  return !!currentAdapter;
}

function init() {
  currentAdapter = getAdapterForUrl(window.location.href);
  if (!currentAdapter) return;

  if (!pageHooksInstalled) {
    pageHooksInstalled = true;
    injectPageScript();
    window.addEventListener('cs2-ai-data-captured', ((e: CustomEvent) => {
      handleCapturedData(e.detail);
    }) as EventListener);
    window.addEventListener('cs2-ai-page-debug', ((e: CustomEvent) => {
      handlePageDebug(e.detail);
    }) as EventListener);
  }

  if (!watcher) {
    watcher = new DOMWatcher(
      () => onContentReady(),
      () => onNavigation(),
    );
    watcher.start();
  }

  console.log(`[dust2cc] Initialized on ${currentAdapter.name}`);
  setDebugState({ lastIssue: '已识别到页面，等待图表区域出现' });
  setTimeout(() => onContentReady(), 800);

  // SteamDT loads data slower via Nuxt hydration — retry a few more times
  if (currentAdapter.name === 'steamdt') {
    for (const delay of [2000, 4000, 7000]) {
      setTimeout(() => {
        if (state.kline.length < 5) {
          syncStateFromDom();
          onContentReady();
        }
      }, delay);
    }
  }
}

function injectPageScript() {
  if (document.getElementById('cs2-ai-page-script')) return;

  const script = document.createElement('script');
  script.id = 'cs2-ai-page-script';
  script.src = chrome.runtime.getURL('page-script.js');
  script.type = 'module';
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => {
    setDebugState({ pageScript: 'loaded', lastIssue: '页面脚本已加载，等待抓取数据' });
    script.remove();
  };
  script.onerror = () => {
    setDebugState({ pageScript: 'failed', lastIssue: '页面脚本加载失败' });
  };
}

function handleCapturedData(payload: { type: string; data: unknown }) {
  switch (payload.type) {
    case 'kline':
    case 'echarts_kline':
      {
        const nextKline = normalizeKlineData(payload.data);
        const assessment = shouldAcceptKlinePayload(payload.type, payload.data, nextKline);
        if (!assessment.accept) {
          setDebugState({
            lastCapture: `${payload.type}（已忽略）`,
            captureCount: debugState.captureCount + 1,
            lastIssue: assessment.reason,
          });
          break;
        }

        state.kline = nextKline;
        preferredKlineSource = payload.type === 'echarts_kline' ? 'echarts' : 'network';
        acceptedKlineScore = assessment.score;
        setDebugState({
          lastCapture: payload.type,
          captureCount: debugState.captureCount + 1,
          lastIssue: assessment.reason,
        });
      }
      console.log(`[dust2cc] Captured ${state.kline.length} K-line points`);
      break;
    case 'goods_detail':
      state.goodsInfo = extractGoodsInfoFromPayload(payload.data) ?? state.goodsInfo;
      state.price = extractPriceInfoFromPayload(payload.data) ?? state.price;
      setDebugState({
        lastCapture: payload.type,
        captureCount: debugState.captureCount + 1,
        lastIssue: '已抓到商品详情数据',
      });
      break;
    case 'listings':
      state.price = extractPriceInfoFromPayload(payload.data) ?? state.price;
      setDebugState({
        lastCapture: payload.type,
        captureCount: debugState.captureCount + 1,
        lastIssue: '已抓到价格/挂单数据',
      });
      break;
  }

  syncStateFromDom();
  broadcastPageState();
  maybeAutoAnalyze();
}

function handlePageDebug(payload: { stage?: string; detail?: string; count?: number }) {
  const summary = [payload.stage, payload.detail, payload.count !== undefined ? `数量 ${payload.count}` : null]
    .filter(Boolean)
    .join(' / ');

  setDebugState({
    annotation: summary || '已收到页面脚本调试信息',
  });
}

function normalizeKlineData(raw: unknown): KlinePoint[] {
  const nested = unwrapPayload(raw);

  // ECharts OHLC format: { dates, ohlc: [[o,c,l,h]], volumes }
  if (nested && typeof nested === 'object' && 'ohlc' in nested) {
    const data = nested as {
      dates?: string[];
      ohlc: Array<[number, number, number, number]>;
      volumes?: number[];
    };
    return sanitizeKlinePoints(data.ohlc.map((point, i) => ({
      date: data.dates?.[i] ?? String(i),
      open: Number(point[0] ?? 0),
      close: Number(point[1] ?? 0),
      low: Number(point[2] ?? 0),
      high: Number(point[3] ?? 0),
      volume: Number(data.volumes?.[i] ?? 0),
    })));
  }

  if (Array.isArray(nested)) {
    if (Array.isArray(nested[0])) {
      return normalizeTupleKlineList(nested as unknown[][]);
    }

    return normalizePriceLikeKlineRecords(nested as Record<string, unknown>[]);
  }

  return [];
}

function unwrapPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;

  const candidate = raw as Record<string, unknown>;
  if (Array.isArray(candidate.data)) return candidate.data;

  if (candidate.data && typeof candidate.data === 'object') {
    const dataRecord = candidate.data as Record<string, unknown>;
    if (Array.isArray(dataRecord.list)) return dataRecord.list;
    if (Array.isArray(dataRecord.kline)) return dataRecord.kline;
    if (Array.isArray(dataRecord.trendList)) return dataRecord.trendList;
    if (Array.isArray(dataRecord.priceList)) return dataRecord.priceList;
  }

  if (Array.isArray(candidate.list)) return candidate.list;
  if (Array.isArray(candidate.trendList)) return candidate.trendList;
  return raw;
}

function onContentReady() {
  currentAdapter = getAdapterForUrl(window.location.href);
  if (!currentAdapter) return;

  syncStateFromDom();

  const chartAnchor = currentAdapter.getChartAnchor();
  const panelAnchor =
    currentAdapter.name === 'steamdt'
      ? currentAdapter.getPanelAnchor?.() ?? chartAnchor ?? null
      : currentAdapter.getPanelAnchor?.() ?? chartAnchor;
  const useInlinePanel = supportsInlinePanel();

  if (useInlinePanel) {
    const panel = injectPanel(panelAnchor, {
      siteName: currentAdapter.name,
      placement: 'inline-after',
      compact: false,
    });

    const siteTag = panel.shadowRoot?.getElementById('site-tag');
    if (siteTag) {
      const siteLabels: Record<string, string> = { csqaq: 'CSQAQ', steamdt: 'SteamDT', buff: 'BUFF', youpin: '悠悠有品' };
      siteTag.textContent = siteLabels[currentAdapter.name] || currentAdapter.name;
    }

    bindPanelEvents(panel);
  }

  const nextAnchor = useInlinePanel
    ? currentAdapter.name === 'steamdt'
      ? (panelAnchor ? 'hero-inline' : 'floating')
      : (panelAnchor ? 'chart-below' : 'floating')
    : 'missing';
  const defaultIssue =
    debugState.pageScript === 'failed'
      ? '页面脚本加载失败，当前无法抓取图表数据'
      : !useInlinePanel
        ? '当前页面不支持内嵌面板'
        : currentAdapter.name === 'steamdt'
          ? panelAnchor
            ? '面板已插入商品主信息区后方'
            : '没找到合适的主信息锚点，已切到浮动模式'
          : panelAnchor
            ? '面板已挂到 K 线区域下方'
            : '没找到图表锚点，已切到浮动模式';

  setDebugState({
    panel: useInlinePanel ? 'mounted' : 'pending',
    anchor: nextAnchor,
    lastIssue:
      state.kline.length > 0 ||
      debugState.lastCapture.includes('已忽略') ||
      /锁定|忽略|丢弃|不足|主图/.test(debugState.lastIssue)
        ? debugState.lastIssue
        : defaultIssue,
  });

  if (useInlinePanel && currentAdapter.name !== 'steamdt') {
    injectSignalBadge();
  }

  broadcastPageState();
  maybeAutoAnalyze();
}

function syncStateFromDom() {
  if (!currentAdapter) return;

  const domGoodsInfo = currentAdapter.extractGoodsInfo();
  if (domGoodsInfo) {
    state.goodsInfo = mergeGoodsInfo(state.goodsInfo, domGoodsInfo);
  }

  const previousPrice = state.price;
  const extractedPrice = currentAdapter.extractPrice();
  state.price = pickBetterPriceInfo(extractedPrice, state.price);

  if (
    currentAdapter.name === 'steamdt' &&
    state.price?.current &&
    state.kline.length >= 5 &&
    !isPriceAlignedWithReferences(
      state.kline[state.kline.length - 1]?.close,
      [extractedPrice?.current, previousPrice?.current, state.price.current],
      0.25,
    )
  ) {
    if (preferredKlineSource === 'echarts' && acceptedKlineScore >= 80) {
      setDebugState({
        lastIssue: '页面价格源短暂波动，已保留当前锁定的主图 K 线',
      });
    } else {
      state.kline = [];
      preferredKlineSource = null;
      acceptedKlineScore = Number.NEGATIVE_INFINITY;
      setDebugState({
        lastIssue: '已丢弃与主价格偏差过大的 K 线，等待主图重新抓取',
      });
    }
  }
}

function onNavigation() {
  currentAdapter = getAdapterForUrl(window.location.href);
  document.getElementById(PANEL_ID)?.remove();

  state.goodsInfo = null;
  state.price = null;
  state.kline = [];
  preferredKlineSource = null;
  acceptedKlineScore = Number.NEGATIVE_INFINITY;
  autoAnalysisKey = '';
  debugState.panel = 'pending';
  debugState.anchor = 'missing';
  debugState.lastCapture = '尚未抓到任何数据';
  debugState.captureCount = 0;
  debugState.lastIssue = '页面切换后重新等待抓取';
  updateDebugBar();

  if (currentAdapter) {
    setTimeout(() => onContentReady(), 800);
  }
}

function getPageSnapshot(): PageSnapshot {
  return {
    goodsInfo: state.goodsInfo,
    price: state.price,
    kline: state.kline,
  };
}

function broadcastPageState() {
  chrome.runtime.sendMessage({
    type: 'PAGE_STATE_UPDATED',
    data: getPageSnapshot(),
  }).catch(() => {
    // Ignore when no extension page is listening.
  });
}

function bindPanelEvents(panelHost: HTMLElement) {
  if (panelHost.dataset.bound === 'true') return;

  const shadow = panelHost.shadowRoot;
  if (!shadow) return;

  panelHost.dataset.bound = 'true';

  shadow.getElementById('btn-analyze')?.addEventListener('click', () => {
    runAnalysis(shadow);
  });

  shadow.getElementById('btn-debug')?.addEventListener('click', () => {
    const debugBar = shadow.getElementById('debug-bar');
    const button = shadow.getElementById('btn-debug');
    const isHidden = debugBar?.classList.toggle('hidden');
    button?.classList.toggle('active', !isHidden);
  });

  shadow.getElementById('btn-collapse')?.addEventListener('click', () => {
    const body = shadow.getElementById('panel-body');
    body?.classList.toggle('hidden');
  });
}

function setAnalysisHTML(shadow: ShadowRoot, html: string) {
  const analysisStatic = shadow.getElementById('analysis-static');
  const panelBody = shadow.getElementById('panel-body');
  if (!analysisStatic) return;
  const scrollTop = panelBody?.scrollTop ?? 0;
  analysisStatic.innerHTML = html;
  if (panelBody && scrollTop > 0) {
    requestAnimationFrame(() => {
      panelBody.scrollTop = Math.min(scrollTop, panelBody.scrollHeight - panelBody.clientHeight);
    });
  }
}

function renderCompactInlineSummary(currentPrice: number, signal: TradeSignal): string {
  const lines = [
    `<strong>现价：</strong>${formatPrice(currentPrice)}`,
    `<strong>结论：</strong>${translateSignalAction(signal.action)}，置信度 ${signal.confidence}%`,
    `<strong>摘要：</strong>${signal.reason || '等待更多 K 线确认。'}`,
  ];

  return `<div class="compact-inline-summary">${lines.join('<br>')}</div>`;
}

async function runAnalysis(shadow: ShadowRoot) {
  const analysisArea = shadow.getElementById('analysis-area');
  const analysisStatic = shadow.getElementById('analysis-static');
  const analysisStream = shadow.getElementById('analysis-stream');
  const signalArea = shadow.getElementById('signal-area');
  const indicatorsArea = shadow.getElementById('indicators-area');
  if (!analysisArea || !analysisStatic || !analysisStream || !signalArea || !indicatorsArea) return;

  if (state.kline.length < 5) {
    setDebugState({
      lastIssue: `当前只有 ${state.kline.length} 根 K 线，无法分析`,
    });
    analysisStatic.innerHTML =
      currentAdapter?.name === 'steamdt'
        ? '<p class="placeholder">⚠️ 还没锁定 steamdt 当前主图的完整日K。请先等待图表加载完成，必要时手动切一次「日K」后再试。</p>'
        : '<p class="placeholder">⚠️ K线数据不足。请先等待图表加载完成，或切换一次 K 线周期以触发数据抓取。</p>';
    analysisStream.classList.add('hidden');
    return;
  }

  const indicators = computeAllIndicators(state.kline);
  const patterns = detectAllPatterns(state.kline);
  const currentPrice = resolveAnalysisPrice(state.price);
  const signal = generateQuickSignal(currentPrice, indicators, patterns);
  const settings = await getSettings();
  const localSummary = buildLocalAnalysisMarkdown({
    goodsInfo: state.goodsInfo,
    price: { current: currentPrice, currency: 'CNY' },
    kline: state.kline,
    indicators,
    patterns,
    signal,
  });

  updateSignalBadge(signal);
  showSignal(signalArea, signal);
  showIndicators(indicatorsArea, indicators);
  setAnalysisHTML(
    shadow,
    currentAdapter?.name === 'steamdt'
      ? renderCompactInlineSummary(currentPrice, signal)
      : renderMarkdown(localSummary),
  );
  annotateChart(signal, indicators);
  setDebugState({
    lastIssue: `分析完成，使用了 ${state.kline.length} 根 K 线`,
  });

  if (!settings.llm.apiKey || currentAdapter?.name === 'steamdt') {
    analysisStream.classList.add('hidden');
    return;
  }

  analysisStream.classList.remove('hidden');
  analysisStream.innerHTML = '<p class="streaming">正在生成 AI 深度分析</p>';
  analysisStream.classList.add('streaming');

  const prompt = buildKlineAnalysisPrompt({
    goodsInfo: state.goodsInfo || { id: '', name: '未知饰品', source: 'csqaq' },
    price: { current: currentPrice, currency: 'CNY' },
    kline: state.kline,
    period: '1d',
    indicators,
    patterns,
  });

  try {
    const port = chrome.runtime.connect({ name: 'llm-stream' });
    let fullText = '';
    const aiSectionPrefix = `${localSummary}\n\n---\n\n## AI 深度分析\n`;

    port.onMessage.addListener((msg) => {
      if (msg.type === 'chunk') {
        fullText += msg.text;
        analysisStream.innerHTML = renderMarkdown(`${aiSectionPrefix}${fullText}`);
        analysisStream.classList.add('streaming');
      } else if (msg.type === 'done') {
        analysisStream.classList.remove('streaming');
      } else if (msg.type === 'error') {
        analysisStream.innerHTML = renderMarkdown(
          `${localSummary}\n\n---\n\n## AI 深度分析\n- 未能生成 AI 分析：${msg.error}`,
        );
        analysisStream.classList.remove('streaming');
      }
    });

    port.postMessage({ messages: prompt });
  } catch (e) {
    analysisStream.innerHTML = renderMarkdown(
      `${localSummary}\n\n---\n\n## AI 深度分析\n- 未能生成 AI 分析：${e instanceof Error ? e.message : '分析失败'}`,
    );
    analysisStream.classList.remove('streaming');
  }
}

function maybeAutoAnalyze() {
  if (state.kline.length < 5) return;

  const nextKey = buildAnalysisFingerprint(getPageSnapshot());
  if (nextKey === autoAnalysisKey) return;

  const panel = document.getElementById(PANEL_ID);
  const shadow = panel?.shadowRoot;
  if (!shadow) return;

  // 如果用户正在滚动面板阅读内容，不要自动打断
  const panelBody = shadow.getElementById('panel-body');
  if (panelBody && panelBody.scrollTop > 10) return;

  autoAnalysisKey = nextKey;
  setTimeout(() => {
    if (document.getElementById(PANEL_ID)?.shadowRoot === shadow) {
      runAnalysis(shadow);
    }
  }, 200);
}

function setDebugState(patch: Partial<DebugState>) {
  Object.assign(debugState, patch);
  updateDebugBar();
}

function updateDebugBar() {
  const panel = document.getElementById(PANEL_ID);
  const debugBar = panel?.shadowRoot?.getElementById('debug-bar');
  if (!debugBar) return;

  const lines = [
    `调试状态`,
    `页面脚本：${describePageScriptState(debugState.pageScript)}`,
    `面板位置：${describeAnchorState(debugState.anchor)}`,
    `最近抓取：${debugState.lastCapture}`,
    `抓取次数：${debugState.captureCount} 次`,
    `K线数量：${state.kline.length} 根`,
    `图上标注：${debugState.annotation}`,
    `最近问题：${debugState.lastIssue}`,
  ];

  debugBar.textContent = lines.join('\n');
}

function describePageScriptState(stateValue: DebugState['pageScript']): string {
  if (stateValue === 'loaded') return '已加载';
  if (stateValue === 'failed') return '加载失败';
  return '等待中';
}

function describeAnchorState(anchorValue: DebugState['anchor']): string {
  if (anchorValue === 'chart-below') return 'K线图下方';
  if (anchorValue === 'hero-inline') return '商品信息区后方';
  if (anchorValue === 'floating') return '浮动兜底';
  return '未找到';
}

function shouldAcceptKlinePayload(
  payloadType: 'kline' | 'echarts_kline',
  rawPayload: unknown,
  nextKline: KlinePoint[],
): KlineAcceptance {
  if (nextKline.length < 5) {
    return {
      accept: false,
      score: Number.NEGATIVE_INFINITY,
      reason: `忽略 ${payloadType}：只有 ${nextKline.length} 根有效 K 线`,
    };
  }

  if (currentAdapter?.name !== 'steamdt') {
    return {
      accept: true,
      score: nextKline.length + (payloadType === 'echarts_kline' ? 10 : 0),
      reason: `已采纳 ${payloadType}，共 ${nextKline.length} 根 K 线`,
    };
  }

  const meta = getKlinePayloadMeta(rawPayload);
  const lastClose = nextKline[nextKline.length - 1]?.close;
  if (!lastClose) {
    return {
      accept: false,
      score: Number.NEGATIVE_INFINITY,
      reason: `忽略 ${payloadType}：最新收盘价无效`,
    };
  }

  let score = scoreKlineQuality(nextKline);
  score += payloadType === 'echarts_kline' ? 18 : 8;
  score += meta.chartScore ?? 0;
  if (meta.isVisible === true) score += 8;
  if (meta.isVisible === false) score -= 28;
  if (meta.isActive === true) score += 6;
  if (meta.isActive === false) score -= 18;
  if (meta.periodHint === '1d') score += 18;
  if (meta.periodHint === '1w' || meta.periodHint === '1m') score -= 8;

  const payloadShape = classifyKlinePayloadShape(rawPayload);
  if (payloadShape === 'ohlc') score += 20;
  if (payloadShape === 'price-trend') score += 6;

  const trustedReferences = getTrustedSteamdtReferencePrices();
  const bestDelta = getBestReferenceDeltaRatio(lastClose, trustedReferences);
  if (bestDelta !== undefined) {
    if (bestDelta <= 0.08) score += 22;
    else if (bestDelta <= 0.18) score += 14;
    else if (bestDelta <= 0.28) score += 8;
    else if (bestDelta <= 0.45) score -= 8;
    else score -= 28;
  }

  if (payloadType === 'kline' && preferredKlineSource === 'echarts') {
    score -= 12;
  }

  if (state.kline.length >= 5) {
    const currentLastClose = state.kline[state.kline.length - 1]?.close;
    if (currentLastClose && trustedReferences.length) {
      const currentDelta = getBestReferenceDeltaRatio(currentLastClose, trustedReferences) ?? Number.POSITIVE_INFINITY;
      const nextDelta = getBestReferenceDeltaRatio(lastClose, trustedReferences) ?? Number.POSITIVE_INFINITY;
      if (nextDelta < currentDelta) score += 6;
      else if (nextDelta > currentDelta) score -= 6;
    }
  }

  const accept =
    score >= 24 &&
    (
      acceptedKlineScore === Number.NEGATIVE_INFINITY ||
      score >= acceptedKlineScore - 4 ||
      (payloadType === 'echarts_kline' && score >= acceptedKlineScore - 12)
    );

  const chartLabel = meta.sourceText ? ` / ${meta.sourceText.slice(0, 36)}` : '';
  if (!accept) {
    return {
      accept: false,
      score,
      reason: `忽略 ${payloadType}${chartLabel}：主图置信分 ${score.toFixed(0)}，当前已锁定 ${acceptedKlineScore.toFixed(0)}`,
    };
  }

  return {
    accept: true,
    score,
    reason: `已锁定 ${payloadType === 'echarts_kline' ? '主图 ECharts' : '网络'} K 线（${nextKline.length} 根，置信分 ${score.toFixed(0)}）`,
  };
}

function getReferenceClosePrice(): number | undefined {
  const close = state.kline[state.kline.length - 1]?.close;
  return typeof close === 'number' && Number.isFinite(close) && close > 0 ? close : undefined;
}

function resolveAnalysisPrice(priceInfo: PriceInfo | null): number {
  const referenceClose = getReferenceClosePrice();
  if (priceInfo?.current && !isPriceAlignedWithReference(referenceClose, priceInfo.current, 0.25)) {
    return priceInfo.current;
  }
  return (
    pickBestPriceCandidate(
      [
        { value: priceInfo?.current, weight: 10 },
        { value: referenceClose, weight: 0 },
      ],
      referenceClose,
    )?.value ??
    referenceClose ??
    0
  );
}

function pickBetterPriceInfo(primary: PriceInfo | null, fallback: PriceInfo | null): PriceInfo | null {
  if (currentAdapter?.name === 'steamdt') {
    const referenceClose = getReferenceClosePrice();
    if (
      referenceClose &&
      primary?.current &&
      fallback?.current &&
      !isPriceAlignedWithReference(primary.current, fallback.current, 0.25)
    ) {
      const primaryAligned = isPriceAlignedWithReference(primary.current, referenceClose, 0.25);
      const fallbackAligned = isPriceAlignedWithReference(fallback.current, referenceClose, 0.25);

      if (primaryAligned && !fallbackAligned) return primary;
      if (fallbackAligned && !primaryAligned) return fallback;
    }
  }

  const referenceClose = getReferenceClosePrice();
  const best = pickPreferredObservedPrice(
    primary ? { value: primary.current, weight: 0, meta: primary } : undefined,
    fallback ? { value: fallback.current, weight: 0, meta: fallback } : undefined,
    referenceClose,
  );

  return best?.meta ?? primary ?? fallback;
}

function getKlinePayloadMeta(raw: unknown): KlinePayloadMeta {
  const nested = unwrapPayload(raw);
  if (!nested || typeof nested !== 'object') return {};

  const candidate = nested as Record<string, unknown>;
  if (candidate.chartMeta && typeof candidate.chartMeta === 'object') {
    return candidate.chartMeta as KlinePayloadMeta;
  }

  return {};
}

function classifyKlinePayloadShape(raw: unknown): 'ohlc' | 'price-trend' | 'unknown' {
  const nested = unwrapPayload(raw);
  if (Array.isArray(nested) && Array.isArray(nested[0])) {
    return detectTupleKlineFormat(nested as unknown[][]) === 'ohlc' ? 'ohlc' : 'price-trend';
  }

  if (Array.isArray(nested) && nested[0] && typeof nested[0] === 'object') {
    const first = nested[0] as Record<string, unknown>;
    if (
      ['open', 'openPrice', 'o'].some((key) => typeof first[key] !== 'undefined') &&
      ['high', 'highPrice', 'h', 'maxPrice'].some((key) => typeof first[key] !== 'undefined') &&
      ['low', 'lowPrice', 'l', 'minPrice'].some((key) => typeof first[key] !== 'undefined')
    ) {
      return 'ohlc';
    }

    if (
      ['sellPrice', 'biddingPrice', 'price', 'avgPrice', 'closePrice'].some(
        (key) => typeof first[key] !== 'undefined',
      )
    ) {
      return 'price-trend';
    }
  }

  return 'unknown';
}

function scoreKlineQuality(points: KlinePoint[]): number {
  const uniqueDates = new Set(points.map((point) => point.date)).size;
  const last = points[points.length - 1];
  let score = Math.min(points.length, 120) / 2;

  if (uniqueDates >= Math.max(5, points.length * 0.7)) score += 10;
  if (points.length >= 20) score += 8;
  if (last && Number.isFinite(last.close) && last.close > 0) score += 8;

  return score;
}

function getTrustedSteamdtReferencePrices(): number[] {
  const values = [
    currentAdapter?.extractPrice()?.current,
    state.price?.current,
    acceptedKlineScore >= 75 ? state.kline[state.kline.length - 1]?.close : undefined,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

  return Array.from(new Set(values.map((value) => Number(value.toFixed(2)))));
}

function getAdviceForPoint(kind: string, value: number, signal: TradeSignal): string {
  if (kind === 'buy_zone') {
    return `在 ${formatPrice(value)} 附近逢低分批买入，回踩支撑区域企稳后建仓。`;
  }
  if (kind === 'stop_loss') {
    return `跌破 ${formatPrice(value)} 果断止损离场，严格控制回撤不超过 3%。`;
  }
  if (kind === 'breakout') {
    return `放量突破 ${formatPrice(value)} 可追涨跟进，注意回踩确认有效性。`;
  }
  if (kind === 'target') {
    return `预期目标 ${formatPrice(value)}，到达后可分批止盈，锁定利润。`;
  }
  if (kind === 'support') {
    return `跌破 ${formatPrice(value)} 建议减仓；企稳反弹可加仓。`;
  }
  if (kind === 'resistance') {
    return `突破 ${formatPrice(value)} 可视为多头信号；遇阻回落则观望。`;
  }
  if (kind === 'ma20') {
    return `站稳 MA20 上方中期偏强；跌破则趋势转弱。`;
  }
  if (kind === 'high') {
    return `突破前高打开上行空间；双顶滞涨需警惕。`;
  }
  if (kind === 'low') {
    return `回踩前低不破可低吸；放量跌破需防范。`;
  }
  return `当前价 ${formatPrice(value)}，信号偏${translateSignalAction(signal.action)}。`;
}

function showKeyLevels(points: Array<{ kind: string; label: string; note: string; value: number; advice?: string }>) {
  const panel = document.getElementById(PANEL_ID);
  const el = panel?.shadowRoot?.getElementById('key-levels-area');
  if (!el) return;

  // Only show the actionable trading levels
  const actionableKinds = ['buy_zone', 'stop_loss', 'breakout', 'target', 'support', 'resistance'];
  const actionablePoints = points
    .filter((p) => actionableKinds.includes(p.kind) && Number.isFinite(p.value) && p.value > 0)
    .slice(0, currentAdapter?.name === 'steamdt' ? 4 : 6);
  if (actionablePoints.length === 0) {
    el.classList.add('hidden');
    return;
  }

  el.classList.remove('hidden');

  const kindConfig: Record<string, { icon: string; name: string; color: string; bgColor: string }> = {
    buy_zone: { icon: '🟢', name: '买入区', color: '#4ade80', bgColor: 'rgba(34,197,94,0.1)' },
    stop_loss: { icon: '🔴', name: '止损位', color: '#f87171', bgColor: 'rgba(239,68,68,0.1)' },
    breakout: { icon: '🚀', name: '追高点', color: '#38bdf8', bgColor: 'rgba(56,189,248,0.1)' },
    target: { icon: '🎯', name: '目标价', color: '#a78bfa', bgColor: 'rgba(167,139,250,0.1)' },
    support: { icon: '▲', name: '支撑', color: '#22c55e', bgColor: 'rgba(34,197,94,0.08)' },
    resistance: { icon: '▼', name: '阻力', color: '#ef4444', bgColor: 'rgba(239,68,68,0.08)' },
  };

  el.innerHTML = actionablePoints
    .map((p) => {
      const cfg = kindConfig[p.kind] || { icon: '●', name: p.kind, color: '#818cf8', bgColor: 'rgba(129,140,248,0.1)' };
      return `
        <div class="key-level-tag" style="background:${cfg.bgColor};border-color:${cfg.color}33;color:${cfg.color}" title="${p.advice || p.note}">
          <span class="level-icon">${cfg.icon}</span>
          <span class="level-name">${cfg.name}</span>
          <span class="level-price" style="color:#e0e4ff">¥${p.value.toFixed(2)}</span>
        </div>`;
    })
    .join('');
}

function annotateChart(signal: TradeSignal, indicators: IndicatorResult) {
  if (!state.kline.length) return;

  const lastPoint = state.kline[state.kline.length - 1];
  const highestPoint = state.kline.reduce((best, point) => (point.high > best.high ? point : best), state.kline[0]);
  const lowestPoint = state.kline.reduce((best, point) => (point.low < best.low ? point : best), state.kline[0]);

  const closes = state.kline.map((k) => k.close);
  const ma5Data = calcMA(closes, 5);
  const ma10Data = calcMA(closes, 10);
  const ma20Data = calcMA(closes, 20);

  const rawPoints = [
    {
      kind: 'latest',
      label: `当前价 ${formatPrice(lastPoint.close)}`,
      note: `最新收盘价，信号偏${translateSignalAction(signal.action)}，置信度 ${signal.confidence}%`,
      date: lastPoint.date,
      value: lastPoint.close,
    },
    signal.buyZone
      ? {
          kind: 'buy_zone',
          label: `推荐买入 ${formatPrice(signal.buyZone)}`,
          note: `支撑位上方建议买入区域，在此位置附近逢低吸纳`,
          value: signal.buyZone,
        }
      : null,
    signal.stopLoss
      ? {
          kind: 'stop_loss',
          label: `止损位 ${formatPrice(signal.stopLoss)}`,
          note: `跌破此价位建议止损离场，控制回撤风险`,
          value: signal.stopLoss,
        }
      : null,
    signal.breakout
      ? {
          kind: 'breakout',
          label: `突破追高 ${formatPrice(signal.breakout)}`,
          note: `突破阻力位后的追高点，放量突破可跟进`,
          value: signal.breakout,
        }
      : null,
    signal.target
      ? {
          kind: 'target',
          label: `目标价 ${formatPrice(signal.target)}`,
          note: `预期目标价位，可在此位置附近分批止盈`,
          value: signal.target,
        }
      : null,
    signal.support
      ? {
          kind: 'support',
          label: `支撑位 ${formatPrice(signal.support)}`,
          note: `下方关键支撑，结合布林下轨与近期回踩区间`,
          value: signal.support,
        }
      : null,
    signal.resistance
      ? {
          kind: 'resistance',
          label: `阻力位 ${formatPrice(signal.resistance)}`,
          note: `上方关键阻力，结合布林上轨与短线压力位`,
          value: signal.resistance,
        }
      : null,
    {
      kind: 'high',
      label: `阶段高点 ${formatPrice(highestPoint.high)}`,
      note: `最近一段 K 线的高点区域`,
      date: highestPoint.date,
      value: highestPoint.high,
    },
    {
      kind: 'low',
      label: `阶段低点 ${formatPrice(lowestPoint.low)}`,
      note: `最近一段 K 线的低点区域`,
      date: lowestPoint.date,
      value: lowestPoint.low,
    },
    {
      kind: 'ma20',
      label: `MA20 ${formatPrice(indicators.ma.ma20)}`,
      note: `中期均线位置，可用来观察趋势强弱`,
      value: indicators.ma.ma20,
    },
  ].filter((p): p is NonNullable<typeof p> => !!p);

  const points = rawPoints.map((p) => ({
    ...p,
    advice: getAdviceForPoint(p.kind, p.value, signal),
  }));

  if (currentAdapter?.name !== 'steamdt') {
    window.postMessage({
      source: 'cs2-ai-content',
      type: CHART_ANNOTATION_MESSAGE,
      payload: {
        goodsName: state.goodsInfo?.zhName || state.goodsInfo?.name || '当前饰品',
        lastPrice: lastPoint.close,
        points,
        indicators: {
          ma5: ma5Data,
          ma10: ma10Data,
          ma20: ma20Data,
        },
      },
    }, '*');
  }

  const visibleMarkerPoints = getVisibleChartMarkerPoints(currentAdapter?.name, points);
  const markerPoints: ChartMarkerPoint[] = visibleMarkerPoints
    .map((p) => ({
      kind: p.kind,
      label: p.label,
      note: p.advice || p.note,
      value: p.value,
    }));
  renderChartMarkers(currentAdapter?.getChartAnchor() ?? null, {
    points: markerPoints,
    kline: state.kline,
  });

  // Populate key-levels panel section
  showKeyLevels(points);
}

function extractGoodsInfoFromPayload(raw: unknown): GoodsInfo | null {
  const payload = pickBestGoodsRecord(raw, getCurrentGoodsIdFromLocation());
  if (!payload) return null;

  const name = chooseGoodsName(
    getString(payload, ['name', 'goodsName', 'market_hash_name', 'title']),
    getString(payload, ['goods_name', 'goodsNameZh', 'zhName', 'cnName']),
  );
  if (!name) return null;

  return {
    id:
      getString(payload, ['id', 'good_id', 'goods_id', 'goodsId']) ||
      state.goodsInfo?.id ||
      getCurrentGoodsIdFromLocation() ||
      '',
    name,
    zhName:
      chooseGoodsName(
        getString(payload, ['goods_name', 'goodsNameZh', 'zhName', 'cnName']),
        getString(payload, ['name', 'goodsName', 'market_hash_name', 'title']),
      ) || undefined,
    weapon: getString(payload, ['weapon']) || undefined,
    rarity: getString(payload, ['rarity_name', 'rarity']) || undefined,
    wear: getString(payload, ['exterior_localized_name', 'wear', 'exterior']) || undefined,
    iconUrl: getString(payload, ['icon_url', 'icon', 'iconUrl', 'image', 'cover']) || undefined,
    source: 'csqaq',
  };
}

function extractPriceInfoFromPayload(raw: unknown): PriceInfo | null {
  const referenceClose = getReferenceClosePrice();
  const candidates = getCandidateRecords(raw).flatMap((payload) => [
    { value: getNumber(payload, ['currentPrice']), weight: 20, payload },
    { value: getNumber(payload, ['sellMinPrice']), weight: 18, payload },
    { value: getNumber(payload, ['lowestPrice']), weight: 16, payload },
    { value: getNumber(payload, ['last_price']), weight: 14, payload },
    { value: getNumber(payload, ['steam_price']), weight: 12, payload },
    { value: getNumber(payload, ['buff_price']), weight: 10, payload },
    { value: getNumber(payload, ['min_price']), weight: 8, payload },
    { value: getNumber(payload, ['price']), weight: 6, payload },
  ]);

  const best = pickBestPriceCandidate(candidates, referenceClose);
  if (!best?.payload || best.value === undefined) return null;

  return {
    current: best.value,
    currency: 'CNY',
    change24h: getNumber(best.payload, ['change24h', 'priceChange', 'price_change']),
    changePercent24h: getNumber(best.payload, [
      'changePercent24h',
      'priceChangePercent',
      'ratio24h',
      'price_change_percent',
    ]),
  };
}

function getCandidateRecords(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') return [];

  const candidate = raw as Record<string, unknown>;
  const records: Record<string, unknown>[] = [];

  const pushRecord = (value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      records.push(value as Record<string, unknown>);
    }
  };

  pushRecord(candidate);

  if (candidate.data && typeof candidate.data === 'object' && !Array.isArray(candidate.data)) {
    const dataRecord = candidate.data as Record<string, unknown>;
    pushRecord(dataRecord);
    pushRecord(dataRecord.goods_info);
    pushRecord(dataRecord.info);
    pushRecord(dataRecord.current_data);
    pushRecord(dataRecord.buff_data);
    pushRecord(dataRecord.steam_data);

    if (Array.isArray(dataRecord.list) && dataRecord.list[0] && typeof dataRecord.list[0] === 'object') {
      pushRecord(dataRecord.list[0]);
    }
  }

  if (Array.isArray(candidate.list) && candidate.list[0] && typeof candidate.list[0] === 'object') {
    pushRecord(candidate.list[0]);
  }

  return records;
}

function pickBestGoodsRecord(raw: unknown, expectedId: string | null): Record<string, unknown> | null {
  const records = getCandidateRecords(raw);
  const normalizedExpectedId = normalizeGoodsId(expectedId);

  if (normalizedExpectedId) {
    const matchedRecord = records.find((record) => {
      const recordId = normalizeGoodsId(getString(record, ['id', 'good_id', 'goods_id', 'goodsId']));
      return !!recordId && recordId === normalizedExpectedId;
    });

    if (matchedRecord) return matchedRecord;
  }

  let bestRecord: Record<string, unknown> | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const record of records) {
    const score = scoreGoodsRecord(record);
    if (score > bestScore) {
      bestScore = score;
      bestRecord = record;
    }
  }

  return bestRecord ?? records[0] ?? null;
}

function getString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getNumber(payload: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^\d.-]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function formatPrice(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return '暂无';
  return `¥${value.toFixed(2)}`;
}

function formatIndicatorPrice(value: number): string {
  return Number.isFinite(value) && value > 0 ? `¥${value.toFixed(2)}` : '暂无';
}

function formatIndicatorNumber(value: number, digits: number, suffix = ''): string {
  return Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : '暂无';
}

function translateSignalAction(action: TradeSignal['action']): string {
  if (action === 'buy') return '买入';
  if (action === 'sell') return '卖出';
  return '观望';
}

function mergeGoodsInfo(existing: GoodsInfo | null, fallback: GoodsInfo): GoodsInfo {
  if (!existing) return fallback;

  const existingId = normalizeGoodsId(existing.id);
  const fallbackId = normalizeGoodsId(fallback.id);
  if (existingId && fallbackId && existingId !== fallbackId) {
    return existing;
  }

  return {
    ...fallback,
    ...existing,
    id: existing.id || fallback.id || getCurrentGoodsIdFromLocation() || '',
    name: chooseGoodsName(existing.name, fallback.name) || existing.name || fallback.name,
    zhName: chooseGoodsName(existing.zhName, fallback.zhName) || undefined,
    weapon: existing.weapon || fallback.weapon,
    rarity: existing.rarity || fallback.rarity,
    wear: existing.wear || fallback.wear,
    iconUrl: existing.iconUrl || fallback.iconUrl,
    source: existing.source || fallback.source,
  };
}

function chooseGoodsName(primary?: string | null, fallback?: string | null): string | null {
  if (isLikelyGoodsName(primary)) return primary!.trim();
  if (isLikelyGoodsName(fallback)) return fallback!.trim();
  return primary?.trim() || fallback?.trim() || null;
}

function isLikelyGoodsName(value?: string | null): boolean {
  if (!value) return false;

  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < 3 || text.length > 120) return false;
  if (!/[A-Za-z\u4e00-\u9fa5]/.test(text)) return false;
  if (/^(csqaq|steam|buff)$/i.test(text)) return false;
  if (/安全信息|security information|remote control/i.test(text)) return false;
  if (/^(在售|求购|成交|详情|走势图|价格走势|K线|库存|立即购买)$/i.test(text)) return false;

  return true;
}

function scoreGoodsRecord(record: Record<string, unknown>): number {
  let score = 0;
  const name = chooseGoodsName(
    getString(record, ['name', 'goodsName', 'market_hash_name', 'title']),
    getString(record, ['goods_name', 'goodsNameZh', 'zhName', 'cnName']),
  );

  if (name) score += 8;
  if (getString(record, ['goods_name', 'goodsNameZh', 'zhName', 'cnName'])) score += 3;
  if (getString(record, ['market_hash_name'])) score += 4;
  if (getString(record, ['id', 'good_id', 'goods_id', 'goodsId'])) score += 2;
  if (getNumber(record, ['price', 'currentPrice', 'sellMinPrice', 'min_price']) !== undefined) score += 1;

  return score;
}

function getCurrentGoodsIdFromLocation(): string | null {
  const pathnameMatch = window.location.pathname.match(/\/(?:goods|detail|item)\/(\d+)/);
  if (pathnameMatch) return pathnameMatch[1];

  const genericIdMatch = window.location.pathname.match(/\/(\d+)(?:\/)?$/);
  if (genericIdMatch) return genericIdMatch[1];

  const searchParams = new URLSearchParams(window.location.search);
  return (
    searchParams.get('id') ||
    searchParams.get('goodsId') ||
    searchParams.get('good_id') ||
    searchParams.get('itemId')
  );
}

function normalizeGoodsId(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized || null;
}

function showSignal(el: HTMLElement, signal: TradeSignal) {
  el.className = `signal-area ${signal.action}`;
  el.classList.remove('hidden');

  const emoji = { buy: '📈', sell: '📉', hold: '⏸️' }[signal.action];
  const label = { buy: '建议买入', sell: '建议卖出', hold: '建议观望' }[signal.action];
  const reason = currentAdapter?.name === 'steamdt'
    ? (signal.reason || '等待更多 K 线确认').split('，').slice(0, 2).join('，')
    : signal.reason;

  el.innerHTML = `
    <span style="font-size:20px">${emoji}</span>
    <span>${label} (置信度 ${signal.confidence}%)</span>
    <span style="font-size:12px;color:#888">— ${reason}</span>
  `;
}

function showIndicators(el: HTMLElement, indicators: IndicatorResult) {
  el.classList.remove('hidden');

  const macdClass = Number.isFinite(indicators.macd.histogram)
    ? indicators.macd.histogram > 0 ? 'positive' : 'negative'
    : '';
  const rsiClass = Number.isFinite(indicators.rsi)
    ? indicators.rsi > 70 ? 'negative' : indicators.rsi < 30 ? 'positive' : ''
    : '';
  const volumeClass = Number.isFinite(indicators.volume.ratio)
    ? indicators.volume.ratio > 1.3 ? 'positive' : indicators.volume.ratio < 0.7 ? 'negative' : ''
    : '';
  const macdSignalText = indicators.macd.signal === 'golden_cross' ? ' 金叉' :
    indicators.macd.signal === 'death_cross' ? ' 死叉' : '';

  el.innerHTML = `
    <div class="indicator-item">
      <div class="indicator-label">MA5 / MA20</div>
      <div class="indicator-value">${formatIndicatorPrice(indicators.ma.ma5)} / ${formatIndicatorPrice(indicators.ma.ma20)}</div>
    </div>
    <div class="indicator-item">
      <div class="indicator-label">MACD${macdSignalText}</div>
      <div class="indicator-value ${macdClass}">${Number.isFinite(indicators.macd.histogram) ? `${indicators.macd.histogram > 0 ? '+' : ''}${indicators.macd.histogram.toFixed(4)}` : '暂无'}</div>
    </div>
    <div class="indicator-item">
      <div class="indicator-label">RSI(14)</div>
      <div class="indicator-value ${rsiClass}">${formatIndicatorNumber(indicators.rsi, 1)}</div>
    </div>
    <div class="indicator-item">
      <div class="indicator-label">BOLL</div>
      <div class="indicator-value">${formatIndicatorPrice(indicators.boll.mid)}</div>
    </div>
    <div class="indicator-item">
      <div class="indicator-label">KDJ</div>
      <div class="indicator-value">K${formatIndicatorNumber(indicators.kdj.k, 0)} D${formatIndicatorNumber(indicators.kdj.d, 0)} J${formatIndicatorNumber(indicators.kdj.j, 0)}</div>
    </div>
    <div class="indicator-item">
      <div class="indicator-label">量比</div>
      <div class="indicator-value ${volumeClass}">${formatIndicatorNumber(indicators.volume.ratio, 2, 'x')}</div>
    </div>
  `;
}

function renderMarkdown(text: string): string {
  return text
    .replace(/## (.+)/g, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/- (.+)/g, '<li>$1</li>')
    .replace(/\n/g, '<br>');
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'REQUEST_ANALYSIS') {
    syncStateFromDom();

    const panel = document.getElementById(PANEL_ID);
    if (panel?.shadowRoot) {
      runAnalysis(panel.shadowRoot);
    } else {
      onContentReady();
      setTimeout(() => {
        const mountedPanel = document.getElementById(PANEL_ID);
        if (mountedPanel?.shadowRoot) {
          runAnalysis(mountedPanel.shadowRoot);
        }
      }, 300);
    }
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg.type === 'REQUEST_PAGE_STATE') {
    syncStateFromDom();
    sendResponse?.({ ok: true, data: getPageSnapshot() });
    return true;
  }

  return false;
});

init();
