import { describe, expect, it } from 'vitest';
import type { AnalysisHistoryEntry } from './types';
import { ANALYSIS_HISTORY_LIMIT, mergeSettings, normalizeSettings, trimAnalysisHistory } from './storage';

describe('normalizeSettings', () => {
  it('maps legacy custom provider to openai_compatible_custom', () => {
    const settings = normalizeSettings({
      llm: {
        provider: 'custom' as never,
        apiKey: '  test-key  ',
        baseUrl: ' https://example.com/v1/ ',
        model: ' custom-model ',
        maxTokens: 4096,
        temperature: 0.6,
      },
    });

    expect(settings.llm.provider).toBe('openai_compatible_custom');
    expect(settings.llm.apiKey).toBe('test-key');
    expect(settings.llm.baseUrl).toBe('https://example.com/v1/');
    expect(settings.llm.model).toBe('custom-model');
  });

  it('clamps invalid llm values back into safe ranges', () => {
    const settings = normalizeSettings({
      llm: {
        provider: 'openai_compatible_custom',
        apiKey: '',
        baseUrl: 'https://example.com/v1',
        model: '   ',
        maxTokens: -5,
        temperature: 9,
      },
    });

    expect(settings.llm.model).toBe('');
    expect(settings.llm.maxTokens).toBe(1);
    expect(settings.llm.temperature).toBe(2);
  });

  it('defaults allowNoApiKey to false and preserves explicit true', () => {
    const withoutFlag = normalizeSettings({
      llm: {
        provider: 'openai_compatible_custom',
        apiKey: '',
        baseUrl: 'https://example.com/v1',
        model: 'custom-model',
      },
    });
    const withFlag = normalizeSettings({
      llm: {
        provider: 'openai_compatible_custom',
        apiKey: '',
        baseUrl: 'https://example.com/v1',
        model: 'custom-model',
        allowNoApiKey: true,
      },
    });

    expect(withoutFlag.llm.allowNoApiKey).toBe(false);
    expect(withFlag.llm.allowNoApiKey).toBe(true);
  });
});

describe('mergeSettings', () => {
  it('deep merges llm config without losing sibling fields', () => {
    const merged = mergeSettings(
      normalizeSettings(undefined),
      {
        llm: {
          provider: 'openai_compatible_custom',
          baseUrl: 'https://proxy.example.com/v1',
        },
      },
    );

    expect(merged.llm.provider).toBe('openai_compatible_custom');
    expect(merged.llm.baseUrl).toBe('https://proxy.example.com/v1');
    expect(merged.llm.model).toBe('deepseek-chat');
    expect(merged.llm.maxTokens).toBe(2000);
    expect(merged.analysis.defaultPeriod).toBe('1d');
  });

  it('deep merges comparison llm config without losing defaults', () => {
    const merged = mergeSettings(
      normalizeSettings(undefined),
      {
        comparison: {
          enabled: true,
          llm: {
            provider: 'openai_compatible_custom',
            model: 'gpt-4o-mini',
            baseUrl: 'https://compare.example.com/v1',
          },
        },
      },
    );

    expect(merged.comparison.enabled).toBe(true);
    expect(merged.comparison.llm.provider).toBe('openai_compatible_custom');
    expect(merged.comparison.llm.baseUrl).toBe('https://compare.example.com/v1');
    expect(merged.comparison.llm.maxTokens).toBe(2000);
  });
});

describe('trimAnalysisHistory', () => {
  it('keeps only the newest 50 records', () => {
    const entries = Array.from({ length: ANALYSIS_HISTORY_LIMIT + 7 }, (_, index) => ({
      id: `entry-${index}`,
      createdAt: ANALYSIS_HISTORY_LIMIT + 7 - index,
      goodsId: `goods-${index}`,
      goodsName: `饰品 ${index}`,
      price: 100 + index,
      period: '1d' as const,
      periodMode: 'single' as const,
      analysisStyle: 'balanced' as const,
      primaryTimeframe: '1d' as const,
      usedTimeframes: ['1d'] as const,
      localSignal: {
        action: 'hold' as const,
        confidence: 50,
        reason: 'test',
      },
      localAnalysis: 'local',
    })) satisfies AnalysisHistoryEntry[];

    const trimmed = trimAnalysisHistory(entries);

    expect(trimmed).toHaveLength(ANALYSIS_HISTORY_LIMIT);
    expect(trimmed[0].id).toBe('entry-0');
    expect(trimmed.at(-1)?.id).toBe(`entry-${ANALYSIS_HISTORY_LIMIT - 1}`);
  });
});
