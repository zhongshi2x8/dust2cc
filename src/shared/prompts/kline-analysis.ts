// ============================================================
// Prompt: K-Line Analysis (core analysis feature)
// ============================================================

import type { AnalysisInput, LLMMessage } from '../types';

const SYSTEM_PROMPT = `你是一位专业的CS2饰品市场技术分析师。

核心规则:
1. 基于提供的技术指标和K线数据进行分析，不要编造数据
2. 饰品市场不同于股票——流动性较低，受游戏更新、赛事、开箱概率调整等因素影响大
3. 给出明确的方向判断和可操作的价位建议
4. 始终提醒投资风险
5. 用中文回答，简洁专业，避免啰嗦

输出格式 (严格按此结构):
## 趋势判断
(一句话结论 + 依据)

## 关键价位
- 支撑位: ¥xxx, ¥xxx
- 阻力位: ¥xxx, ¥xxx

## 交易建议
(买入/卖出/观望) | 置信度: xx/100
(一句话理由)

## 风险提示
(最关键的1-2条)`;

export function buildKlineAnalysisPrompt(input: AnalysisInput): LLMMessage[] {
  const { goodsInfo, price, kline, indicators, patterns } = input;

  const recentKline = kline.slice(-10);
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

  const userContent = `## 饰品信息
名称: ${goodsInfo.zhName || goodsInfo.name}
当前价格: ¥${price.current.toFixed(2)}
24h变化: ${price.change24h !== undefined ? `${price.change24h > 0 ? '+' : ''}¥${price.change24h.toFixed(2)} (${price.changePercent24h?.toFixed(2)}%)` : '无数据'}

## 技术指标
- MA5: ¥${indicators.ma.ma5.toFixed(2)} | MA10: ¥${indicators.ma.ma10.toFixed(2)} | MA20: ¥${indicators.ma.ma20.toFixed(2)}
- MACD: DIF=${indicators.macd.dif.toFixed(4)}, DEA=${indicators.macd.dea.toFixed(4)}, 柱状=${indicators.macd.histogram.toFixed(4)} [${indicators.macd.signal === 'golden_cross' ? '金叉' : indicators.macd.signal === 'death_cross' ? '死叉' : '无交叉'}]
- RSI(14): ${indicators.rsi.toFixed(1)}
- BOLL: 上轨¥${indicators.boll.upper.toFixed(2)}, 中轨¥${indicators.boll.mid.toFixed(2)}, 下轨¥${indicators.boll.lower.toFixed(2)}
- KDJ: K=${indicators.kdj.k.toFixed(1)}, D=${indicators.kdj.d.toFixed(1)}, J=${indicators.kdj.j.toFixed(1)}
- 量比: ${indicators.volume.ratio.toFixed(2)} (5日均量${indicators.volume.avg5.toFixed(0)} / 20日均量${indicators.volume.avg20.toFixed(0)})
- 综合信号: ${indicators.overallSignal === 'bullish' ? '偏多' : indicators.overallSignal === 'bearish' ? '偏空' : '中性'}

## 识别到的K线形态
${patternsText}

## 近10期K线数据
${klineTable}

请分析并给出交易建议。`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
