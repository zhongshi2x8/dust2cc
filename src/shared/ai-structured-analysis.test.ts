import { describe, expect, it } from 'vitest';
import { parseStructuredAIAnalysis } from './ai-structured-analysis';

describe('parseStructuredAIAnalysis', () => {
  it('parses strict json output', () => {
    const result = parseStructuredAIAnalysis(`{
      "trend": "震荡偏强",
      "confidence": 78,
      "supportLevels": [182.5, 176.2],
      "resistanceLevels": [195.8, 201.4],
      "suggestion": "靠近支撑分批关注，跌破止损位就撤。",
      "risks": ["成交量不足", "游戏更新可能改变预期"]
    }`);

    expect(result).toEqual({
      trend: '震荡偏强',
      confidence: 78,
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
      trend: '偏空',
      confidence: 64,
      supportLevels: [170.5],
      resistanceLevels: [185.4],
      suggestion: '反弹不过压力位就别追。',
      risks: ['流动性偏低'],
    });
  });

  it('returns null for non-json output', () => {
    expect(parseStructuredAIAnalysis('这是普通文本，不是 JSON')).toBeNull();
  });
});
