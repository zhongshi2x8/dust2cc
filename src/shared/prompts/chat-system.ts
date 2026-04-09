// ============================================================
// Prompt: Chat System — contextual Q&A about a specific item
// ============================================================

import type { GoodsInfo, PriceInfo, IndicatorResult, LLMMessage } from '../types';

export function buildChatSystemPrompt(
  goodsInfo: GoodsInfo,
  price: PriceInfo,
  indicators: IndicatorResult,
): string {
  return `你是CS2饰品AI助手。用户正在查看「${goodsInfo.zhName || goodsInfo.name}」的行情页面。

当前数据:
- 价格: ¥${price.current.toFixed(2)}
- 24h涨跌: ${price.changePercent24h !== undefined ? `${price.changePercent24h.toFixed(2)}%` : '未知'}
- RSI(14): ${indicators.rsi.toFixed(1)}
- MACD: ${indicators.macd.signal === 'golden_cross' ? '金叉' : indicators.macd.signal === 'death_cross' ? '死叉' : '中性'}
- 综合信号: ${indicators.overallSignal === 'bullish' ? '偏多' : indicators.overallSignal === 'bearish' ? '偏空' : '中性'}

规则:
1. 只回答CS2饰品行情相关问题，其他问题礼貌拒绝
2. 回答简洁专业，不超过200字（除非用户要求详细分析）
3. 始终提醒虚拟物品投资有风险
4. 用中文回答`;
}

export function buildChatMessages(
  systemPrompt: string,
  history: LLMMessage[],
  userMessage: string,
): LLMMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10), // Keep last 10 messages for context
    { role: 'user', content: userMessage },
  ];
}
