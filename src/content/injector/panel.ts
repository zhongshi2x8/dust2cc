// ============================================================
// AI Panel Injector — injects analysis UI into page
// ============================================================

import type { TradeSignal, KlinePoint } from '@shared/types';

const PANEL_ID = 'cs2-ai-analyst-panel';
const CHART_MARKERS_ID = 'cs2-ai-chart-markers';

/** Data point to mark on chart */
export interface ChartMarkerPoint {
  kind: string;
  label: string;
  note: string;
  value: number;
}

interface PanelOptions {
  placement?: 'inline-after' | 'overlay-top-right' | 'chart-left-strip';
  siteName?: string;
  compact?: boolean;
}

/** Inject the AI analysis panel into the page */
export function injectPanel(anchorElement: HTMLElement | null, options: PanelOptions = {}): HTMLElement {
  const existing = document.getElementById(PANEL_ID) as HTMLElement | null;
  if (existing?.shadowRoot) {
    placePanel(existing, anchorElement, options);
    return existing;
  }

  const panel = document.createElement('div');
  panel.id = PANEL_ID;

  const shadow = panel.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>${getPanelStyles()}</style>
    <div class="ai-panel ${options.compact ? 'compact-summary' : ''} site-${options.siteName || 'generic'}" id="ai-panel-root">
      <div class="ai-panel-header" id="panel-header">
        <div class="ai-panel-title">
          <span class="ai-logo">🧙</span>
          <span>dust2.cc</span>
          <span class="ai-site-tag" id="site-tag"></span>
        </div>
        <div class="ai-panel-actions">
          <button id="btn-debug" class="ai-btn ghost" title="调试">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 8v4M12 16h.01"/></svg>
          </button>
          <button id="btn-analyze" class="ai-btn primary" title="分析K线">
            📊 分析
          </button>
          <button id="btn-collapse" class="ai-btn ghost" title="折叠/展开">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
      </div>

      <div class="ai-panel-body" id="panel-body">
        <div id="debug-bar" class="debug-bar hidden">调试状态：初始化中</div>

        <!-- Signal Badge -->
        <div id="signal-area" class="signal-area hidden"></div>

        <!-- Key Levels — replaces old chart overlay -->
        <div id="key-levels-area" class="key-levels-area hidden"></div>

        <!-- Indicators Summary -->
        <div id="indicators-area" class="indicators-area hidden"></div>

        <!-- Analysis Output -->
        <div id="analysis-area" class="analysis-area">
          <div id="analysis-static">
            <p class="placeholder">点击「📊 分析」开始 AI 分析<br><span class="placeholder-sub">自动抓取 K 线数据后会自动分析</span></p>
          </div>
          <div id="analysis-stream" class="hidden"></div>
        </div>
      </div>
    </div>
  `;

  placePanel(panel, anchorElement, options);

  return panel;
}

function placePanel(panel: HTMLElement, anchorElement: HTMLElement | null, options: PanelOptions) {
  panel.style.position = '';
  panel.style.top = '';
  panel.style.right = '';
  panel.style.bottom = '';
  panel.style.left = '';
  panel.style.width = '';
  panel.style.maxWidth = '';
  panel.style.maxHeight = '';
  panel.style.zIndex = '';
  panel.style.boxShadow = '';
  panel.style.margin = '';

  if (options.placement === 'chart-left-strip' && anchorElement) {
    const container = anchorElement;
    const position = getComputedStyle(container).position;
    if (position === 'static') {
      container.style.position = 'relative';
    }

    if (panel.parentElement !== container) {
      container.appendChild(panel);
    }

    const metrics = getChartLeftStripMetrics(container);
    panel.style.position = 'absolute';
    panel.style.left = `${metrics.left}px`;
    panel.style.top = `${metrics.top}px`;
    panel.style.width = `${metrics.width}px`;
    panel.style.maxWidth = `${metrics.width}px`;
    panel.style.maxHeight = `${metrics.maxHeight}px`;
    panel.style.zIndex = '12';
    panel.style.margin = '0';
    return;
  }

  if (options.placement === 'overlay-top-right' && anchorElement) {
    const container = anchorElement;
    const position = getComputedStyle(container).position;
    if (position === 'static') {
      container.style.position = 'relative';
    }

    if (panel.parentElement !== container) {
      container.appendChild(panel);
    }

    panel.style.position = 'absolute';
    panel.style.top = '20px';
    panel.style.right = '20px';
    panel.style.width = '360px';
    panel.style.maxWidth = 'min(360px, calc(100% - 32px))';
    panel.style.maxHeight = 'calc(100% - 40px)';
    panel.style.zIndex = '12';
    panel.style.margin = '0';
    return;
  }

  const target = resolveInsertionTarget(anchorElement);
  if (target?.parentElement) {
    // Only move if necessary — repeated DOM insertion can reset shadow DOM scroll state
    if (target.nextElementSibling !== panel) {
      target.insertAdjacentElement('afterend', panel);
    }
    return;
  }

  if (panel.parentElement !== document.body) {
    document.body.appendChild(panel);
  }
  panel.style.position = 'fixed';
  panel.style.right = '16px';
  panel.style.bottom = '16px';
  panel.style.width = '380px';
  panel.style.maxWidth = 'calc(100vw - 24px)';
  panel.style.maxHeight = 'calc(100vh - 24px)';
  panel.style.zIndex = '2147483647';
  panel.style.boxShadow = '0 20px 60px rgba(0, 0, 0, 0.35)';
}

function resolveInsertionTarget(anchorElement: HTMLElement | null): HTMLElement | null {
  if (!anchorElement) return null;

  return (
    anchorElement.closest<HTMLElement>('[class*="card_kline"]') ||
    anchorElement.closest<HTMLElement>('[class*="card_daily"]') ||
    anchorElement.closest<HTMLElement>('[class*="kline"]') ||
    anchorElement.closest<HTMLElement>('[class*="daily"]') ||
    anchorElement.closest<HTMLElement>('[class*="trend"]') ||
    anchorElement.closest<HTMLElement>('[class*="history"]') ||
    anchorElement.closest<HTMLElement>('[class*="chart"]') ||
    anchorElement.closest<HTMLElement>('.el-tabs') ||
    anchorElement.closest<HTMLElement>('[class*="card"]') ||
    anchorElement
  );
}

function getChartLeftStripMetrics(container: HTMLElement): {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
} {
  const containerRect = container.getBoundingClientRect();
  const chartHost =
    container.querySelector<HTMLElement>('[_echarts_instance_]') ||
    container.querySelector<HTMLCanvasElement>('canvas')?.parentElement ||
    container.querySelector<HTMLElement>('[class*="kline"]') ||
    container.querySelector<HTMLElement>('[class*="chart"]');

  if (!chartHost) {
    return { left: 12, top: 196, width: 320, maxHeight: 210 };
  }

  const chartRect = chartHost.getBoundingClientRect();
  const top = Math.max(16, Math.round(chartRect.top - containerRect.top + 8));
  const width = Math.max(288, Math.min(360, Math.round(chartRect.left - containerRect.left - 20)));
  const maxHeight = Math.max(180, Math.min(220, Math.round(chartRect.height - 20)));

  return { left: 12, top, width, maxHeight };
}

/** Inject signal badge next to the price element */
export function injectSignalBadge(): HTMLElement | null {
  const existing = document.getElementById('cs2-ai-signal-badge');
  if (existing) return existing;

  const priceEl = document.querySelector('[class*="price"],[class*="Price"]');
  if (!priceEl) return null;

  const badge = document.createElement('span');
  badge.id = 'cs2-ai-signal-badge';
  badge.style.cssText = `
    display: inline-flex; align-items: center; gap: 4px;
    margin-left: 8px; padding: 2px 8px; border-radius: 4px;
    font-size: 12px; font-weight: 600;
    background: #333; color: #aaa;
  `;
  badge.textContent = '🤖 等待分析';
  priceEl.parentElement?.appendChild(badge);

  return badge;
}

/** Update the signal badge with analysis result */
export function updateSignalBadge(signal: TradeSignal) {
  const badge = document.getElementById('cs2-ai-signal-badge');
  if (!badge) return;

  const config = {
    buy: { emoji: '🟢', text: '买入', bg: '#1a3a1a', color: '#4CAF50' },
    sell: { emoji: '🔴', text: '卖出', bg: '#3a1a1a', color: '#EB4B4B' },
    hold: { emoji: '🟡', text: '观望', bg: '#3a3a1a', color: '#FFD700' },
  }[signal.action];

  badge.style.background = config.bg;
  badge.style.color = config.color;
  badge.textContent = `${config.emoji} AI:${config.text} ${signal.confidence}%`;
}

// ============================================================
// Chart Markers — compact price-level markers near the chart
// ============================================================

/**
 * Render key price level markers as a floating strip on the right edge
 * of the chart. No coordinate alignment needed — just a sorted list
 * of colored price tags anchored to the chart container.
 */
export function renderChartMarkers(
  anchorElement: HTMLElement | null,
  input: { points: ChartMarkerPoint[]; kline: KlinePoint[] },
) {
  const chartHost = resolveChartHost(anchorElement);
  if (!chartHost || input.kline.length === 0 || input.points.length === 0) return;

  // Sort by value descending (highest price first / top of chart)
  const sorted = input.points
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => b.value - a.value);

  // Remove old markers
  const existingMarkers = document.getElementById(CHART_MARKERS_ID);
  existingMarkers?.remove();

  // Create markers container
  const container = document.createElement('div');
  container.id = CHART_MARKERS_ID;
  container.style.cssText = `
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 999;
    display: flex;
    flex-direction: column;
    gap: 3px;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  `;

  for (const point of sorted) {
    const color = getMarkerColor(point.kind);
    const icon = getMarkerIcon(point.kind);

    const tag = document.createElement('div');
    tag.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 4px;
      background: rgba(10, 12, 24, 0.88);
      border: 1px solid ${hexToRgba(color, 0.4)};
      backdrop-filter: blur(6px);
      white-space: nowrap;
      pointer-events: auto;
      cursor: default;
      position: relative;
    `;

    tag.innerHTML = `
      <span style="
        font-size: 10px;
        line-height: 1;
      ">${icon}</span>
      <span style="
        font-size: 10px;
        font-weight: 700;
        color: ${color};
        letter-spacing: 0.01em;
      ">${escapeHtml(getMarkerShortLabel(point.kind))}</span>
      <span style="
        font-size: 10px;
        font-weight: 600;
        color: #e0e4ff;
        font-family: 'SF Mono', 'Fira Code', monospace;
      ">${escapeHtml(formatMarkerPrice(point.value))}</span>
    `;

    // Tooltip on hover
    tag.title = `${point.label}\n${point.note}`;

    container.appendChild(tag);
  }

  // Make the chart host relatively positioned so our markers can anchor
  const hostPosition = getComputedStyle(chartHost).position;
  if (hostPosition === 'static') {
    chartHost.style.position = 'relative';
  }

  chartHost.appendChild(container);
}

function resolveChartHost(anchorElement: HTMLElement | null): HTMLElement | null {
  if (!(anchorElement instanceof HTMLElement)) return null;

  // Prefer the echarts container or a chart-related wrapper
  const echartsDom = anchorElement.querySelector<HTMLElement>('[_echarts_instance_]');
  if (echartsDom) return echartsDom;

  const canvas = anchorElement.querySelector<HTMLCanvasElement>('canvas');
  if (canvas?.parentElement) return canvas.parentElement;

  const chartEl = anchorElement.querySelector<HTMLElement>('[class*="chart"]');
  if (chartEl) return chartEl;

  return anchorElement;
}

function getMarkerColor(kind: string): string {
  if (kind === 'buy_zone') return '#4ade80';
  if (kind === 'stop_loss') return '#f87171';
  if (kind === 'breakout') return '#38bdf8';
  if (kind === 'target') return '#a78bfa';
  if (kind === 'support') return '#22c55e';
  if (kind === 'resistance') return '#ef4444';
  if (kind === 'ma20') return '#eab308';
  if (kind === 'high') return '#60a5fa';
  if (kind === 'low') return '#c084fc';
  return '#818cf8';
}

function getMarkerIcon(kind: string): string {
  if (kind === 'buy_zone') return '🟢';
  if (kind === 'stop_loss') return '🔴';
  if (kind === 'breakout') return '🚀';
  if (kind === 'target') return '🎯';
  if (kind === 'support') return '▲';
  if (kind === 'resistance') return '▼';
  if (kind === 'ma20') return '━';
  if (kind === 'high') return '◆';
  if (kind === 'low') return '◆';
  return '●';
}

function getMarkerShortLabel(kind: string): string {
  if (kind === 'buy_zone') return '买入';
  if (kind === 'stop_loss') return '止损';
  if (kind === 'breakout') return '追高';
  if (kind === 'target') return '目标';
  if (kind === 'support') return '支撑';
  if (kind === 'resistance') return '阻力';
  if (kind === 'ma20') return 'MA20';
  if (kind === 'high') return '高点';
  if (kind === 'low') return '低点';
  return '现价';
}

function formatMarkerPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `¥${value.toFixed(2)}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// Panel Styles
// ============================================================

function getPanelStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .ai-panel {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: linear-gradient(180deg, #12122a 0%, #151530 100%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      margin: 12px 0;
      overflow: hidden;
      color: #d4d4e8;
      font-size: 13px;
      line-height: 1.55;
      display: flex;
      flex-direction: column;
      max-height: min(680px, calc(100vh - 32px));
      min-height: 200px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    }

    .ai-panel.compact-summary {
      border-radius: 18px;
      max-height: min(240px, calc(100vh - 48px));
      box-shadow: 0 18px 38px rgba(12, 15, 34, 0.22), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
    }

    .site-steamdt {
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.98)),
        linear-gradient(135deg, rgba(167, 194, 255, 0.16), rgba(255, 255, 255, 0));
      border: 1px solid rgba(105, 132, 189, 0.2);
      color: #27364f;
      max-height: min(520px, calc(100vh - 64px));
      min-height: 0;
      box-shadow: 0 8px 22px rgba(114, 140, 191, 0.12);
    }

    .site-steamdt.compact-summary {
      border-radius: 16px;
      box-shadow: 0 10px 24px rgba(114, 140, 191, 0.16);
    }

    /* Header */
    .ai-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      cursor: default;
      user-select: none;
      flex-shrink: 0;
    }

    .site-steamdt .ai-panel-header {
      padding: 12px 14px;
      background: linear-gradient(180deg, rgba(238, 244, 255, 0.96), rgba(248, 250, 255, 0.88));
      border-bottom-color: rgba(105, 132, 189, 0.16);
    }

    .ai-panel-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 14px;
      color: #eef0ff;
    }

    .site-steamdt .ai-panel-title {
      font-size: 15px;
      color: #21314c;
    }

    .ai-logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: -0.02em;
      flex-shrink: 0;
    }

    .ai-site-tag {
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(99, 102, 241, 0.15);
      color: #a5b4fc;
      font-size: 10px;
      font-weight: 600;
    }

    .site-steamdt .ai-logo {
      background: linear-gradient(135deg, #5b7cff, #6ca2ff);
      box-shadow: 0 6px 14px rgba(91, 124, 255, 0.18);
    }

    .site-steamdt .ai-site-tag {
      background: rgba(91, 124, 255, 0.1);
      color: #5877d8;
    }

    .ai-panel-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* Buttons */
    .ai-btn {
      padding: 5px 12px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: #a0a0c0;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      line-height: 1;
    }
    .ai-btn:hover { background: rgba(255, 255, 255, 0.06); color: #e0e0ff; }
    .ai-btn:active { transform: scale(0.97); }

    .ai-btn.primary {
      background: linear-gradient(135deg, #5b5fef, #7c3aed);
      border-color: rgba(99, 102, 241, 0.3);
      color: #fff;
      font-weight: 600;
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25);
    }
    .ai-btn.primary:hover {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
    }

    .ai-btn.ghost {
      padding: 5px 7px;
      color: #7878a0;
    }
    .ai-btn.ghost:hover { color: #c0c0e0; }
    .ai-btn.ghost.active {
      background: rgba(99, 102, 241, 0.15);
      color: #a5b4fc;
    }

    .site-steamdt .ai-btn {
      color: #667897;
    }

    .site-steamdt .ai-btn:hover {
      background: rgba(91, 124, 255, 0.08);
      color: #334b73;
    }

    .site-steamdt .ai-btn.primary {
      background: linear-gradient(135deg, #5f83ff, #4d6fe8);
      border-color: rgba(91, 124, 255, 0.2);
      box-shadow: 0 8px 16px rgba(91, 124, 255, 0.18);
    }

    .site-steamdt .ai-btn.primary:hover {
      background: linear-gradient(135deg, #6488ff, #5475ec);
      box-shadow: 0 10px 20px rgba(91, 124, 255, 0.22);
    }

    .site-steamdt.compact-summary #btn-debug {
      display: none;
    }

    .site-steamdt.compact-summary .ai-btn.primary {
      padding: 5px 10px;
    }

    /* Body */
    .ai-panel-body {
      padding: 12px 14px;
      flex: 1 1 auto;
      min-height: 0;
      max-height: 420px;
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: 6px;
      scrollbar-color: rgba(99, 102, 241, 0.55) transparent;
    }

    .site-steamdt .ai-panel-body {
      max-height: 340px;
      padding: 14px 14px 16px;
      background:
        radial-gradient(circle at top left, rgba(107, 160, 255, 0.08), transparent 34%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 255, 0.96));
      scrollbar-color: rgba(91, 124, 255, 0.35) transparent;
    }
    .ai-panel-body::-webkit-scrollbar { width: 6px; }
    .ai-panel-body::-webkit-scrollbar-track { background: transparent; }
    .ai-panel-body::-webkit-scrollbar-thumb { background: rgba(99, 102, 241, 0.55); border-radius: 4px; }

    .placeholder {
      color: #55557a;
      text-align: center;
      padding: 24px 16px;
      font-size: 13px;
    }
    .placeholder-sub { color: #44445a; font-size: 11px; margin-top: 4px; display: block; }

    /* Debug bar */
    .debug-bar {
      margin-bottom: 10px;
      padding: 8px 10px;
      border-radius: 6px;
      background: rgba(99, 102, 241, 0.08);
      border: 1px solid rgba(99, 102, 241, 0.15);
      color: #b0b8ff;
      font-size: 11px;
      line-height: 1.5;
      white-space: pre-wrap;
      font-family: "SF Mono", "Fira Code", monospace;
    }

    /* Signal area */
    .signal-area {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      margin-bottom: 10px;
      font-weight: 600;
      font-size: 13px;
      border: 1px solid transparent;
    }

    .site-steamdt .signal-area {
      border-radius: 14px;
      color: #24324a;
      border-width: 1px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
    }
    .signal-area.buy {
      background: rgba(34, 197, 94, 0.08);
      border-color: rgba(34, 197, 94, 0.2);
      color: #4ade80;
    }
    .signal-area.sell {
      background: rgba(239, 68, 68, 0.08);
      border-color: rgba(239, 68, 68, 0.2);
      color: #f87171;
    }
    .signal-area.hold {
      background: rgba(250, 204, 21, 0.08);
      border-color: rgba(250, 204, 21, 0.2);
      color: #facc15;
    }

    .site-steamdt .signal-area.buy {
      background: linear-gradient(180deg, rgba(232, 246, 237, 0.94), rgba(244, 251, 247, 0.96));
      border-color: rgba(49, 171, 92, 0.2);
      color: #24754a;
    }

    .site-steamdt .signal-area.sell {
      background: linear-gradient(180deg, rgba(255, 239, 239, 0.94), rgba(255, 247, 247, 0.96));
      border-color: rgba(228, 97, 97, 0.2);
      color: #b54747;
    }

    .site-steamdt .signal-area.hold {
      background: linear-gradient(180deg, rgba(255, 248, 229, 0.94), rgba(255, 252, 243, 0.96));
      border-color: rgba(221, 170, 67, 0.22);
      color: #926a13;
    }

    /* Key Levels area — inline markers in panel */
    .key-levels-area {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 10px;
    }
    .key-level-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid;
    }
    .key-level-tag .level-icon { font-size: 9px; line-height: 1; }
    .key-level-tag .level-name { font-weight: 700; }
    .key-level-tag .level-price {
      font-family: "SF Mono", "Fira Code", monospace;
      color: #e0e4ff;
    }

    .site-steamdt .key-level-tag {
      border-radius: 999px;
      background: rgba(245, 248, 255, 0.94) !important;
      color: #49628d !important;
    }

    .site-steamdt .key-level-tag .level-price {
      color: #21314c !important;
    }

    /* Indicators grid */
    .indicators-area {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 10px;
    }

    .site-steamdt .indicators-area {
      grid-template-columns: repeat(2, 1fr);
    }
    .indicator-item {
      padding: 7px 8px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      font-size: 11px;
    }
    .indicator-label {
      color: #6b6b8a;
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .indicator-value {
      font-weight: 600;
      margin-top: 2px;
      font-size: 12px;
      color: #d0d0ee;
      font-family: "SF Mono", "Fira Code", monospace;
    }
    .indicator-value.positive { color: #4ade80; }
    .indicator-value.negative { color: #f87171; }

    .site-steamdt .indicator-item {
      background: rgba(255, 255, 255, 0.74);
      border-color: rgba(105, 132, 189, 0.14);
      border-radius: 12px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
    }

    .site-steamdt .indicator-label {
      color: #7b8ca8;
    }

    .site-steamdt .indicator-value {
      color: #253651;
    }

    .site-steamdt .indicator-value.positive {
      color: #2b8a57;
    }

    .site-steamdt .indicator-value.negative {
      color: #ca5252;
    }

    /* Analysis area */
    .analysis-area {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 13px;
      line-height: 1.6;
    }
    .analysis-area h2 {
      font-size: 13px;
      margin: 14px 0 6px;
      color: #a5b4fc;
      font-weight: 600;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 4px;
    }
    .analysis-area ul { padding-left: 18px; }
    .analysis-area li { margin: 3px 0; }
    .analysis-area strong { color: #e0e0ff; }
    .analysis-area hr {
      border: none;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      margin: 12px 0;
    }

    .site-steamdt .analysis-area {
      color: #31415d;
      font-size: 12px;
      line-height: 1.65;
    }

    .site-steamdt .analysis-area h2 {
      color: #4363ac;
      border-bottom-color: rgba(105, 132, 189, 0.14);
    }

    .site-steamdt .analysis-area strong {
      color: #1f3049;
    }

    .site-steamdt .analysis-area hr {
      border-top-color: rgba(105, 132, 189, 0.14);
    }

    .compact-inline-summary {
      padding: 2px 2px 0;
    }

    .site-steamdt.compact-summary .signal-area {
      margin-bottom: 8px;
      padding: 8px 10px;
      font-size: 12px;
    }

    .site-steamdt.compact-summary .key-levels-area {
      gap: 6px;
      margin-bottom: 8px;
    }

    .site-steamdt.compact-summary .indicators-area {
      display: none;
    }

    .site-steamdt.compact-summary .analysis-area {
      font-size: 12px;
      line-height: 1.5;
    }

    .site-steamdt.compact-summary .analysis-area h2 {
      display: none;
    }

    .hidden { display: none !important; }

    /* Streaming cursor */
    .streaming::after {
      content: '▊';
      color: #8b5cf6;
      animation: blink 0.7s infinite;
    }
    @keyframes blink { 50% { opacity: 0; } }
  `;
}
