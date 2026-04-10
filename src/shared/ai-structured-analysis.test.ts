import { describe, expect, it } from 'vitest';
import { parseStructuredAIAnalysis } from './ai-structured-analysis';

describe('parseStructuredAIAnalysis', () => {
  it('parses strict json output', () => {
    const result = parseStructuredAIAnalysis(`{
      "summary": "价格站上中期均线，整体偏强。",
      "trend": "震荡偏强",
      "confidence": 78,
      "reasoning": ["收盘价高于 MA20", "MACD 柱体继续放大"],
      "signals": ["MA 多头排列", "量能温和放大"],
      "timeframeBias": { "1h": "短线偏多", "1d": "中期偏强" },
      "primaryTimeframe": "1d",
      "supportLevels": [182.5, 176.2],
      "resistanceLevels": [195.8, 201.4],
      "suggestion": "靠近支撑分批关注，跌破止损位就撤。",
      "risks": ["成交量不足", "游戏更新可能改变预期"]
    }`);

    expect(result).toEqual({
      summary: '价格站上中期均线，整体偏强。',
      trend: '震荡偏强',
      confidence: 78,
      reasoning: ['收盘价高于 MA20', 'MACD 柱体继续放大'],
      signals: ['MA 多头排列', '量能温和放大'],
      timeframeBias: { '1h': '短线偏多', '1d': '中期偏强' },
      primaryTimeframe: '1d',
      supportLevels: [182.5, 176.2],
      resistanceLevels: [195.8, 201.4],
      suggestion: '靠近支撑分批关注，跌破止损位就撤。',
      risks: ['成交量不足', '游戏更新可能改变预期'],
    });
  });

  it('parses json wrapped in markdown fences and chinese field names', () => {
    const result = parseStructuredAIAnalysis([
      '```json',
      '{',
      '  "趋势": "偏空",',
      '  "置信度": 64,',
      '  "支撑位": ["170.5"],',
      '  "压力位": [185.4],',
      '  "建议": "反弹不过压力位就别追。",',
      '  "风险提示": "流动性偏低"',
      '}',
      '```',
    ].join('\n'));

    expect(result).toEqual({
      summary: '',
      trend: '偏空',
      confidence: 64,
      reasoning: [],
      signals: [],
      timeframeBias: undefined,
      primaryTimeframe: undefined,
      supportLevels: [170.5],
      resistanceLevels: [185.4],
      suggestion: '反弹不过压力位就别追。',
      risks: ['流动性偏低'],
    });
  });

  it('parses new fields from mixed half-structured json', () => {
    const result = parseStructuredAIAnalysis(`{
      "结论": "短线仍偏震荡，先看突破。",
      "趋势": "中性偏多",
      "置信度": 55,
      "推理依据": "价格靠近上轨，MACD 尚未死叉",
      "信号": ["接近阻力位", "量能稳定"],
      "建议": "不追高，等回踩或突破确认。",
      "风险提示": []
    }`);

    expect(result).toEqual({
      summary: '短线仍偏震荡，先看突破。',
      trend: '中性偏多',
      confidence: 55,
      reasoning: ['价格靠近上轨，MACD 尚未死叉'],
      signals: ['接近阻力位', '量能稳定'],
      timeframeBias: undefined,
      primaryTimeframe: undefined,
      supportLevels: [],
      resistanceLevels: [],
      suggestion: '不追高，等回踩或突破确认。',
      risks: [],
    });
  });

  it('returns null for non-json output', () => {
    expect(parseStructuredAIAnalysis('这是普通文本，不是 JSON')).toBeNull();
  });

  it('parses stringified json payloads', () => {
    const result = parseStructuredAIAnalysis(`"{\\"summary\\":\\"测试结论\\",\\"trend\\":\\"偏多\\",\\"confidence\\":66,\\"suggestion\\":\\"等回踩确认后再考虑。\\"}"`);

    expect(result).toEqual({
      summary: '测试结论',
      trend: '偏多',
      confidence: 66,
      reasoning: [],
      signals: [],
      timeframeBias: undefined,
      primaryTimeframe: undefined,
      supportLevels: [],
      resistanceLevels: [],
      suggestion: '等回踩确认后再考虑。',
      risks: [],
    });
  });

  it('parses labeled chinese text as structured fallback', () => {
    const result = parseStructuredAIAnalysis([
      '核心结论：大盘价格仍偏强，但短线震荡加剧。',
      '趋势：震荡偏强',
      '置信度：72',
      '推理依据：',
      '- 价格仍站在 MA20 上方',
      '- MACD 尚未形成明确死叉',
      '信号：',
      '- RSI 接近强弱分界',
      '- 量能略有收缩',
      '支撑位：182.5, 176.2',
      '压力位：195.8, 201.4',
      '建议：等待回踩确认后再考虑跟进。',
      '风险提示：',
      '- 成交量不足',
      '- 大盘波动放大',
      '主周期：1d',
      '1h：短线震荡',
      '1d：中期偏强',
    ].join('\n'));

    expect(result).toEqual({
      summary: '大盘价格仍偏强，但短线震荡加剧。',
      trend: '震荡偏强',
      confidence: 72,
      reasoning: ['价格仍站在 MA20 上方', 'MACD 尚未形成明确死叉'],
      signals: ['RSI 接近强弱分界', '量能略有收缩'],
      timeframeBias: { '1h': '短线震荡', '1d': '中期偏强' },
      primaryTimeframe: '1d',
      supportLevels: [182.5, 176.2],
      resistanceLevels: [195.8, 201.4],
      suggestion: '等待回踩确认后再考虑跟进。',
      risks: ['成交量不足', '大盘波动放大'],
    });
  });

  it('parses json with trailing commas and extra wrapper text', () => {
    const result = parseStructuredAIAnalysis([
      '以下是分析结果：',
      '{',
      '  "summary": "短线回踩但结构没坏",',
      '  "trend": "震荡偏强",',
      '  "confidence": 68,',
      '  "supportLevels": [180.5, 176.2,],',
      '  "resistanceLevels": [190.8, 195.4,],',
      '  "suggestion": "先等回踩确认。",',
      '}',
    ].join('\n'));

    expect(result).toEqual({
      summary: '短线回踩但结构没坏',
      trend: '震荡偏强',
      confidence: 68,
      reasoning: [],
      signals: [],
      timeframeBias: undefined,
      primaryTimeframe: undefined,
      supportLevels: [180.5, 176.2],
      resistanceLevels: [190.8, 195.4],
      suggestion: '先等回踩确认。',
      risks: [],
    });
  });
});
