import type {
  GoodsInfo,
  IndicatorResult,
  KlinePoint,
  PatternMatch,
  PriceInfo,
  TradeSignal,
} from './types';

function formatPrice(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '暂无';
  return `¥${value.toFixed(2)}`;
}

function formatNumber(value: number, digits: number, suffix = ''): string {
  if (!Number.isFinite(value)) return '暂无';
  return `${value.toFixed(digits)}${suffix}`;
}

function describeTrend(signal: IndicatorResult['overallSignal']): string {
  if (signal === 'bullish') return '偏多，短线动能相对更强。';
  if (signal === 'bearish') return '偏空，短线下行压力更明显。';
  return '震荡，中短线方向还不够明确。';
}

function describeRsi(rsi: number): string {
  if (!Number.isFinite(rsi)) return 'RSI 数据暂未稳定，先参考价格区间和均线。';
  if (rsi >= 70) return `RSI ${rsi.toFixed(1)}，处于偏高区，追涨要谨慎。`;
  if (rsi <= 30) return `RSI ${rsi.toFixed(1)}，处于偏低区，留意超跌反弹。`;
  return `RSI ${rsi.toFixed(1)}，处于中性区间。`;
}

function describeMacd(indicators: IndicatorResult): string {
  if (!Number.isFinite(indicators.macd.histogram)) {
    return 'MACD 数据暂未稳定，等待更多 K 线后再判断。';
  }
  if (indicators.macd.signal === 'golden_cross') {
    return `MACD 金叉，柱体 ${indicators.macd.histogram.toFixed(2)}，短线有转强信号。`;
  }
  if (indicators.macd.signal === 'death_cross') {
    return `MACD 死叉，柱体 ${indicators.macd.histogram.toFixed(2)}，短线有转弱信号。`;
  }
  return `MACD 暂无新交叉，柱体 ${indicators.macd.histogram.toFixed(2)}。`;
}

function describeVolume(indicators: IndicatorResult): string {
  if (!Number.isFinite(indicators.volume.ratio)) {
    return '量比数据暂未稳定，先以价格和均线判断节奏。';
  }
  if (indicators.volume.trend === 'increasing') {
    return `成交量放大，量比 ${indicators.volume.ratio.toFixed(2)}，价格波动容易被放大。`;
  }
  if (indicators.volume.trend === 'decreasing') {
    return `成交量缩小，量比 ${indicators.volume.ratio.toFixed(2)}，当前走势延续性可能一般。`;
  }
  return `成交量平稳，量比 ${indicators.volume.ratio.toFixed(2)}。`;
}

function describePatterns(patterns: PatternMatch[]): string[] {
  if (patterns.length === 0) {
    return ['最近没有识别到强置信度形态，建议以均线、MACD 和成交量为主。'];
  }

  return patterns.slice(0, 3).map((pattern) => {
    const direction =
      pattern.type === 'bullish' ? '偏多' : pattern.type === 'bearish' ? '偏空' : '中性';
    return `${pattern.nameZh}：${direction}，置信度 ${(pattern.confidence * 100).toFixed(0)}%，${pattern.description}`;
  });
}

function describeRisk(signal: TradeSignal, indicators: IndicatorResult): string[] {
  const risks: string[] = [
    `支撑位参考 ${formatPrice(signal.support)}，阻力位参考 ${formatPrice(signal.resistance)}。`,
  ];

  if (indicators.rsi >= 70) {
    risks.push('短线已经偏热，适合等待回踩确认，不宜连续追高。');
  } else if (indicators.rsi <= 30) {
    risks.push('虽然有超跌迹象，但下跌趋势未必已经结束，抄底要控制仓位。');
  } else {
    risks.push('当前更像区间博弈，单一指标不够时尽量等待量价共振再操作。');
  }

  return risks;
}

export function buildLocalAnalysisMarkdown(input: {
  goodsInfo: GoodsInfo | null;
  price: PriceInfo | null;
  kline: KlinePoint[];
  indicators: IndicatorResult;
  patterns: PatternMatch[];
  signal: TradeSignal;
}): string {
  const { goodsInfo, price, kline, indicators, patterns, signal } = input;
  const currentPrice = price?.current ?? kline[kline.length - 1]?.close ?? 0;
  const itemName = goodsInfo?.zhName || goodsInfo?.name || '当前饰品';
  const actionLabel =
    signal.action === 'buy' ? '偏买入' : signal.action === 'sell' ? '偏卖出' : '偏观望';

  return [
    '## 本地基础分析',
    '',
    `**${itemName}** 当前判断：**${actionLabel}**，置信度 **${signal.confidence}%**。`,
    '',
    '### 快速结论',
    `- 当前价格：${formatPrice(currentPrice)}`,
    `- 趋势判断：${describeTrend(indicators.overallSignal)}`,
    `- 核心理由：${signal.reason || '指标信号暂不集中，建议观望。'}。`,
    '',
    '### 指标观察',
    `- 均线：MA5 ${formatPrice(indicators.ma.ma5)}，MA20 ${formatPrice(indicators.ma.ma20)}。${currentPrice > indicators.ma.ma20 ? '价格仍在中期均线上方。' : '价格跌到中期均线下方。'} `,
    `- ${describeMacd(indicators)}`,
    `- ${describeRsi(indicators.rsi)}`,
    `- 布林带：上轨 ${formatPrice(indicators.boll.upper)}，中轨 ${formatPrice(indicators.boll.mid)}，下轨 ${formatPrice(indicators.boll.lower)}。`,
    `- KDJ：K ${formatNumber(indicators.kdj.k, 1)} / D ${formatNumber(indicators.kdj.d, 1)} / J ${formatNumber(indicators.kdj.j, 1)}。`,
    `- ${describeVolume(indicators)}`,
    '',
    '### 形态观察',
    ...describePatterns(patterns).map((line) => `- ${line}`),
    '',
    '### 风险提醒',
    ...describeRisk(signal, indicators).map((line) => `- ${line}`),
    '',
    '### 使用建议',
    '- 这部分是本地指标分析，不需要配置 API Key。',
    '- 如果你后续自己补了 API Key，本地分析后还可以继续叠加 AI 深度解读。',
  ].join('\n');
}
