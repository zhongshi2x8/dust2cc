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
    const parsed = JSON.parse(sanitizeJsonCandidate(candidate)) as unknown;
    if (typeof parsed === 'string' && parsed.trim()) {
      return tryParseJson(parsed.trim());
    }
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

  // Strip common model thinking wrappers before attempting parse
  const stripped = stripThinkingWrappers(trimmed);

  const fenceMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const objectMatch = extractBalancedObject(stripped);
  // Also try extracting from original text in case stripping was too aggressive
  const objectMatchOriginal = objectMatch ? null : extractBalancedObject(trimmed);
  const candidates = [
    stripped,
    fenceMatch?.[1]?.trim(),
    objectMatch?.trim(),
    objectMatchOriginal?.trim(),
    stripped.replace(/\\"/g, '"').replace(/\\n/g, '\n').trim(),
    trimmed,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (!parsed) continue;

    const summary = pickValue(parsed, ['summary', '核心结论', '结论', '总结', 'conclusion', 'analysis_summary']);
    const trend = pickValue(parsed, ['trend', '趋势', 'direction', '趋势判断', 'trend_direction']);
    const confidence = pickValue(parsed, ['confidence', '置信度', '确信度', 'confidence_score']);
    const reasoning = pickValue(parsed, ['reasoning', '依据', 'reasons', '推理依据', '分析依据', '推理', 'analysis_reasoning']);
    const signals = pickValue(parsed, ['signals', '信号', 'technicalSignals', '技术信号', 'technical_signals']);
    const timeframeBias = pickValue(parsed, ['timeframeBias', '周期倾向', '多周期倾向', 'timeframe_bias']);
    const primaryTimeframe = pickValue(parsed, ['primaryTimeframe', '主周期', '主分析周期', 'primary_timeframe']);
    const supportLevels = pickValue(parsed, ['supportLevels', 'supports', 'support', '支撑位', 'support_levels']);
    const resistanceLevels = pickValue(parsed, ['resistanceLevels', 'resistances', 'resistance', '压力位', '阻力位', 'resistance_levels']);
    const suggestion = pickValue(parsed, ['suggestion', '建议', 'recommendation', '交易建议', 'advice']);
    const risks = pickValue(parsed, ['risks', 'riskWarnings', '风险提示', '风险', 'risk_warnings']);

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

  const textFallback = parseLabeledText(trimmed);
  if (textFallback) {
    return textFallback;
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

/** Strip thinking/reasoning wrappers that models prepend to their output. */
function stripThinkingWrappers(text: string): string {
  let result = text;

  // Strip XML-style thinking tags
  const thinkTagPattern = /<(?:think|thinking|reasoning|thought)>[\s\S]*?<\/(?:think|thinking|reasoning|thought)>/gi;
  result = result.replace(thinkTagPattern, '');

  // Strip short preamble text before the first {
  result = result.replace(/^[\s\S]*?(?=\{)/m, (match) => {
    if (match.length > 500) return match;
    return '';
  });

  // Try to extract just the balanced JSON object
  const balanced = extractBalancedObject(result);
  if (balanced) {
    return balanced;
  }

  return result.trim();
}

function sanitizeJsonCandidate(candidate: string): string {
  return candidate
    .trim()
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
    .replace(/'([^']*?)'/g, '"$1"');
}

function extractBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) {
      return text.slice(start, index + 1);
    }
  }

  return null;
}

function parseLabeledText(text: string): StructuredAIAnalysis | null {
  const summary = extractLabeledValue(text, ['summary', '核心结论', '结论', '总结']);
  const trend = extractLabeledValue(text, ['trend', '趋势', '趋势判断']);
  const confidenceText = extractLabeledValue(text, ['confidence', '置信度', '确信度']);
  const suggestion = extractLabeledValue(text, ['suggestion', '建议', '交易建议']);
  const primaryTimeframe = extractLabeledValue(text, ['primaryTimeframe', '主周期', '主分析周期']);
  const reasoning = extractBulletBlock(text, ['reasoning', '推理依据', '依据', '分析依据']);
  const signals = extractBulletBlock(text, ['signals', '信号', '技术信号']);
  const risks = extractBulletBlock(text, ['risks', '风险提示', '风险']);
  const supportLevels = extractNumberList(extractLabeledValue(text, ['supportLevels', '支撑位']));
  const resistanceLevels = extractNumberList(extractLabeledValue(text, ['resistanceLevels', '压力位', '阻力位']));
  const timeframeBias = extractTimeframeBias(text);
  const normalized: StructuredAIAnalysis = {
    summary,
    trend,
    confidence: clampConfidence(confidenceText ? Number(confidenceText.replace(/[^\d.]/g, '')) : 0),
    reasoning,
    signals,
    supportLevels,
    resistanceLevels,
    suggestion,
    risks,
    timeframeBias,
    primaryTimeframe: primaryTimeframe || undefined,
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

  return null;
}

function extractLabeledValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[:：]\\s*(.+)`, 'i'));
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return '';
}

function extractBulletBlock(text: string, labels: string[]): string[] {
  for (const label of labels) {
    const blockMatch = text.match(new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*[A-Za-z\\u4e00-\\u9fa5]+\\s*[:：]|$)`, 'i'));
    const block = blockMatch?.[1]?.trim();
    if (!block) continue;

    const bulletItems = block
      .split('\n')
      .map((line) => line.replace(/^[\-\d.\s、]+/, '').trim())
      .filter(Boolean);

    if (bulletItems.length > 0) {
      return bulletItems;
    }

    return normalizeStringArray(block.replace(/[；;]/g, '\n'));
  }

  return [];
}

function extractNumberList(value: string): number[] {
  if (!value) return [];
  return value
    .split(/[、,，/ ]+/)
    .map((entry) => Number(entry.replace(/[^\d.-]/g, '')))
    .filter((entry) => Number.isFinite(entry));
}

function extractTimeframeBias(text: string): Record<string, string> | undefined {
  const matches = Array.from(text.matchAll(/(?:^|\n)\s*(1h|4h|1d|1w|1M)\s*[:：]\s*(.+)/g));
  if (matches.length === 0) return undefined;

  const entries = matches
    .map((match) => [match[1], match[2].trim()] as const)
    .filter(([, value]) => Boolean(value));

  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
