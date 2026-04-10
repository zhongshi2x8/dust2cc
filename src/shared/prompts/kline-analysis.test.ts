import { describe, expect, it } from 'vitest';
import { buildKlineAnalysisPrompt } from './kline-analysis';
import type { AnalysisInput, KlinePoint } from '../types';

function createKline(length: number): KlinePoint[] {
  return Array.from({ length }, (_, index) => ({
    date: `2026-04-${String(index + 1).padStart(2, '0')}`,
    open: 100 + index,
    high: 103 + index,
    low: 98 + index,
    close: 101 + index,
    volume: 1000 + index * 20,
  }));
}

function createInput(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  const kline = createKline(24);
  return {
    goodsInfo: {
      id: 'ak-47-redline',
      name: 'AK-47 | Redline',
      zhName: 'AK-47 | 红线',
      source: 'steamdt',
    },
    price: {
      current: 125,
      currency: 'CNY',
    },
    kline,
    period: '1d',
    primaryPeriod: '1d',
    periodMode: 'single',
    style: 'balanced',
    indicators: {
      ma: { ma5: 121, ma10: 118, ma20: 112, ma60: 105 },
      ema: { ema12: 120, ema26: 114 },
      macd: { dif: 1.2, dea: 0.8, histogram: 0.4, signal: 'golden_cross' },
      rsi: 63,
      boll: { upper: 130, mid: 118, lower: 106, width: 0.18 },
      kdj: { k: 65, d: 60, j: 75 },
      volume: { avg5: 1400, avg20: 1100, ratio: 1.27, trend: 'increasing' },
      overallSignal: 'bullish',
    },
    patterns: [],
    ...overrides,
  };
}

describe('buildKlineAnalysisPrompt', () => {
  it('includes single-mode analysis labels in the prompt', () => {
    const prompt = buildKlineAnalysisPrompt(createInput());
    const userMessage = prompt.find((message) => message.role === 'user')?.content ?? '';

    expect(userMessage).toContain('分析模式: 单周期分析');
    expect(userMessage).toContain('主分析周期: 1d');
    expect(userMessage).toContain('当前可用周期: 1d');
  });

  it('includes multi-mode periods in the prompt', () => {
    const baseInput = createInput();
    const prompt = buildKlineAnalysisPrompt(createInput({
      periodMode: 'multi',
      timeframes: [
        {
          period: '1h',
          price: baseInput.price,
          kline: createKline(24),
          indicators: baseInput.indicators,
          patterns: [],
        },
        {
          period: '4h',
          price: baseInput.price,
          kline: createKline(24),
          indicators: baseInput.indicators,
          patterns: [],
        },
        {
          period: '1d',
          price: baseInput.price,
          kline: createKline(24),
          indicators: baseInput.indicators,
          patterns: [],
        },
      ],
    }));
    const userMessage = prompt.find((message) => message.role === 'user')?.content ?? '';

    expect(userMessage).toContain('分析模式: 多周期联动分析');
    expect(userMessage).toContain('当前可用周期: 1h / 4h / 1d');
    expect(userMessage).toContain('### 周期 1d（主周期）');
  });

  it('includes style guidance in the prompt', () => {
    const prompt = buildKlineAnalysisPrompt(createInput({
      style: 'conservative',
    }));
    const userMessage = prompt.find((message) => message.role === 'user')?.content ?? '';

    expect(userMessage).toContain('分析风格: 保守：更强调风险控制、确认信号和防守位，不轻易给激进追涨建议');
  });
});
