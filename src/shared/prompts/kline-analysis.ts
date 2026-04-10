// ============================================================
// Prompt: K-Line Analysis (core analysis feature)
// ============================================================

import type { AnalysisInput, LLMMessage, TimeframeAnalysisInput, KlinePeriod } from '../types';

const SYSTEM_PROMPT = `你是一位专业的CS2饰品市场技术分析师。

核心规则:
1. 基于提供的技术指标和K线数据进行分析，不要编造数据
2. 饰品市场不同于股票——流动性较低，受游戏更新、赛事、开箱概率调整等因素影响大
3. 给出明确的方向判断和可操作的价位建议
4. 始终提醒投资风险
5. 用中文回答，简洁专业，避免啰嗦

输出要求:
1. 只输出 JSON，不要输出 Markdown、解释、前后缀或代码块
2. 字段必须严格使用下面这些 key
3. 如果某个字段没有把握，也要返回合理的空值，而不是省略字段

JSON Schema:
{
  "summary": "核心结论",
  "trend": "一句话趋势判断",
  "confidence": 0-100 的整数,
  "reasoning": ["推理依据1", "推理依据2"],
  "signals": ["技术信号1", "技术信号2"],
  "timeframeBias": { "1h": "短周期倾向", "4h": "中周期倾向", "1d": "主周期倾向" },
  "primaryTimeframe": "本次主分析周期",
  "supportLevels": [数字, 数字],
  "resistanceLevels": [数字, 数字],
  "suggestion": "一句话交易建议",
  "risks": ["风险1", "风险2"]
}`;

export function buildKlineAnalysisPrompt(input: AnalysisInput): LLMMessage[] {
  const { goodsInfo, price, kline, indicators, patterns } = input;
  const timeframeInputs = input.timeframes?.length
    ? input.timeframes
    : [{
        period: input.period,
        price,
        kline,
        indicators,
        patterns,
      }];
  const primaryPeriod = input.primaryPeriod || input.period;
  const timeframeSections = timeframeInputs
    .map((timeframeInput) => buildTimeframeSection(timeframeInput, primaryPeriod))
    .join('\n\n');

  const userContent = `## 饰品信息
名称: ${goodsInfo.zhName || goodsInfo.name}
当前价格: ¥${price.current.toFixed(2)}
24h变化: ${price.change24h !== undefined ? `${price.change24h > 0 ? '+' : ''}¥${price.change24h.toFixed(2)} (${price.changePercent24h?.toFixed(2)}%)` : '无数据'}
分析模式: ${input.periodMode === 'multi' ? '多周期联动分析' : '单周期分析'}
主分析周期: ${primaryPeriod}
当前可用周期: ${timeframeInputs.map((entry) => entry.period).join(' / ')}
分析风格: ${describeAnalysisStyle(input.style || 'balanced')}

## 多周期数据
${timeframeSections}

请基于以上数据输出严格 JSON。`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}

function buildTimeframeSection(input: TimeframeAnalysisInput, primaryPeriod: KlinePeriod): string {
  const { period, price, kline, indicators, patterns } = input;
  const recentKline = kline.slice(-10);
  const recentTwenty = kline.slice(-20);
  const latest = kline[kline.length - 1];
  const recentHigh = recentTwenty.reduce((max, point) => Math.max(max, point.high), Number.NEGATIVE_INFINITY);
  const recentLow = recentTwenty.reduce((min, point) => Math.min(min, point.low), Number.POSITIVE_INFINITY);
  const recentStartClose = recentTwenty[0]?.close ?? latest.close;
  const recentRangeSpan = Math.max(recentHigh - recentLow, 0.0001);
  const pricePositionTexts = [
    describeMAPosition(price.current, indicators.ma.ma5, 'MA5'),
    describeMAPosition(price.current, indicators.ma.ma10, 'MA10'),
    describeMAPosition(price.current, indicators.ma.ma20, 'MA20'),
  ];
  const nearExtremeText =
    Math.abs(price.current - recentHigh) <= Math.abs(price.current - recentLow)
      ? '当前价格更接近近期高点'
      : '当前价格更接近近期低点';
  const recentRangeChange =
    recentStartClose > 0 ? ((latest.close - recentStartClose) / recentStartClose) * 100 : 0;
  const normalizedRangePosition = ((price.current - recentLow) / recentRangeSpan) * 100;
  const klineTable = recentKline
    .map(
      (k) =>
        `${k.date} | O:¥${k.open.toFixed(2)} H:¥${k.high.toFixed(2)} L:¥${k.low.toFixed(2)} C:¥${k.close.toFixed(2)} V:${k.volume}`,
    )
    .join('\n');
  const patternsText =
    patterns.length > 0
      ? patterns
          .map(
            (p) =>
              `- ${p.nameZh} (${p.type === 'bullish' ? '看涨' : p.type === 'bearish' ? '看跌' : '中性'}, 置信度${(p.confidence * 100).toFixed(0)}%): ${p.description}`,
          )
          .join('\n')
      : '- 未检测到明显形态';

  return `### 周期 ${period}${period === primaryPeriod ? '（主周期）' : ''}
- MA5: ¥${indicators.ma.ma5.toFixed(2)} | MA10: ¥${indicators.ma.ma10.toFixed(2)} | MA20: ¥${indicators.ma.ma20.toFixed(2)}
- MACD: DIF=${indicators.macd.dif.toFixed(4)}, DEA=${indicators.macd.dea.toFixed(4)}, 柱状=${indicators.macd.histogram.toFixed(4)} [${indicators.macd.signal === 'golden_cross' ? '金叉' : indicators.macd.signal === 'death_cross' ? '死叉' : '无交叉'}]
- RSI(14): ${indicators.rsi.toFixed(1)}
- BOLL: 上轨¥${indicators.boll.upper.toFixed(2)}, 中轨¥${indicators.boll.mid.toFixed(2)}, 下轨¥${indicators.boll.lower.toFixed(2)}
- KDJ: K=${indicators.kdj.k.toFixed(1)}, D=${indicators.kdj.d.toFixed(1)}, J=${indicators.kdj.j.toFixed(1)}
- 量比: ${indicators.volume.ratio.toFixed(2)} (5日均量${indicators.volume.avg5.toFixed(0)} / 20日均量${indicators.volume.avg20.toFixed(0)})
- 综合信号: ${indicators.overallSignal === 'bullish' ? '偏多' : indicators.overallSignal === 'bearish' ? '偏空' : '中性'}
- 价格位置: ${pricePositionTexts.join('；')}
- 高低点关系: ${nearExtremeText}（20根区间位置约 ${normalizedRangePosition.toFixed(1)}%）
- 最近20根K线收盘涨跌幅: ${recentRangeChange >= 0 ? '+' : ''}${recentRangeChange.toFixed(2)}%
- 成交量状态: ${describeVolumeTrend(indicators.volume.trend)}
- 近期20根价格区间: ¥${recentLow.toFixed(2)} ~ ¥${recentHigh.toFixed(2)}
- K线形态:
${patternsText}
- 近10期K线数据:
${klineTable}`;
}

function describeMAPosition(currentPrice: number, maValue: number, label: string): string {
  if (!Number.isFinite(maValue) || maValue <= 0) {
    return `价格与 ${label} 关系不明`;
  }

  const diffPercent = ((currentPrice - maValue) / maValue) * 100;
  if (Math.abs(diffPercent) < 0.3) {
    return `当前价格基本贴近 ${label}`;
  }

  return `当前价格${diffPercent > 0 ? '高于' : '低于'} ${label} ${Math.abs(diffPercent).toFixed(2)}%`;
}

function describeVolumeTrend(trend: AnalysisInput['indicators']['volume']['trend']): string {
  if (trend === 'increasing') return '成交量放大';
  if (trend === 'decreasing') return '成交量缩小';
  return '成交量稳定';
}

function describeAnalysisStyle(style: AnalysisInput['style']): string {
  switch (style) {
    case 'conservative':
      return '保守：更强调风险控制、确认信号和防守位，不轻易给激进追涨建议';
    case 'aggressive':
      return '激进：更关注突破、趋势延续和短线博弈机会，但仍需给出风险提示';
    case 'objective':
      return '客观：优先描述数据和结构，不给强烈主观交易动作，用更中性的建议表达';
    default:
      return '平衡：在机会和风险之间保持均衡，给出正常强度的交易建议';
  }
}
