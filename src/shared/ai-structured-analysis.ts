import type { StructuredAIAnalysis } from './types';

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeLevelArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
    .filter((entry) => Number.isFinite(entry));
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function pickValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in source) return source[key];
  }
  return undefined;
}

function tryParseJson(candidate: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed candidate
  }

  return null;
}

export function parseStructuredAIAnalysis(rawText: string): StructuredAIAnalysis | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  const candidates = [
    trimmed,
    fenceMatch?.[1]?.trim(),
    objectMatch?.[0]?.trim(),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (!parsed) continue;

    const summary = pickValue(parsed, ['summary', '核心结论', '结论']);
    const trend = pickValue(parsed, ['trend', '趋势', 'direction']);
    const confidence = pickValue(parsed, ['confidence', '置信度']);
    const reasoning = pickValue(parsed, ['reasoning', '依据', 'reasons', '推理依据']);
    const signals = pickValue(parsed, ['signals', '信号', 'technicalSignals']);
    const timeframeBias = pickValue(parsed, ['timeframeBias', '周期倾向', '多周期倾向']);
    const primaryTimeframe = pickValue(parsed, ['primaryTimeframe', '主周期', '主分析周期']);
    const supportLevels = pickValue(parsed, ['supportLevels', 'supports', 'support', '支撑位']);
    const resistanceLevels = pickValue(parsed, ['resistanceLevels', 'resistances', 'resistance', '压力位']);
    const suggestion = pickValue(parsed, ['suggestion', '建议', 'recommendation']);
    const risks = pickValue(parsed, ['risks', 'riskWarnings', '风险提示']);

    const normalized: StructuredAIAnalysis = {
      summary: typeof summary === 'string' ? summary.trim() : '',
      trend: typeof trend === 'string' ? trend.trim() : '',
      confidence: clampConfidence(confidence),
      reasoning: normalizeStringArray(reasoning),
      signals: normalizeStringArray(signals),
      supportLevels: normalizeLevelArray(supportLevels),
      resistanceLevels: normalizeLevelArray(resistanceLevels),
      suggestion: typeof suggestion === 'string' ? suggestion.trim() : '',
      risks: normalizeStringArray(risks),
      timeframeBias: normalizeTimeframeBias(timeframeBias),
      primaryTimeframe: typeof primaryTimeframe === 'string' ? primaryTimeframe.trim() : undefined,
    };

    if (
      normalized.summary
      || normalized.trend
      || normalized.reasoning.length > 0
      || normalized.signals.length > 0
      || normalized.suggestion
      || normalized.supportLevels.length > 0
      || normalized.resistanceLevels.length > 0
      || normalized.risks.length > 0
    ) {
      return normalized;
    }
  }

  return null;
}

function normalizeTimeframeBias(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, typeof entry === 'string' ? entry.trim() : ''] as const)
    .filter(([, entry]) => Boolean(entry));

  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}
