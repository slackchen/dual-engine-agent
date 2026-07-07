export interface TokenUsageSummary {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

const numberOrUndefined = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
);

const tokenNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    const direct = numberOrUndefined(value);
    if (direct !== undefined) return direct;

    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      const nested = numberOrUndefined(item.total)
        ?? numberOrUndefined(item.count)
        ?? numberOrUndefined(item.tokens);
      if (nested !== undefined) return nested;
    }
  }

  return undefined;
};

const addTokenCounts = (left?: number, right?: number): number | undefined => (
  left == null && right == null ? undefined : (left ?? 0) + (right ?? 0)
);

const positiveOrUndefined = (value?: number): number | undefined => (
  typeof value === 'number' && value > 0 ? value : undefined
);

export function normalizeTokenUsage(value: any): TokenUsageSummary {
  if (!value || typeof value !== 'object') return {};

  const raw = value.raw || {};
  const usageMetadata = value.usageMetadata || raw.usageMetadata || {};
  const promptDetails = value.prompt_tokens_details || raw.prompt_tokens_details || value.input_tokens_details || raw.input_tokens_details || {};
  const completionDetails = value.completion_tokens_details || raw.completion_tokens_details || value.output_tokens_details || raw.output_tokens_details || {};

  const inputTokens = tokenNumber(
    value.inputTokens,
    value.prompt_tokens,
    value.promptTokens,
    value.input_tokens,
    value.inputTokenCount,
    value.promptTokenCount,
    usageMetadata.promptTokenCount,
    raw.inputTokens,
    raw.prompt_tokens,
    raw.input_tokens,
    raw.inputTokenCount,
    raw.promptTokenCount
  );
  const outputTokens = tokenNumber(
    value.outputTokens,
    value.completion_tokens,
    value.completionTokens,
    value.output_tokens,
    value.outputTokenCount,
    value.candidatesTokenCount,
    usageMetadata.candidatesTokenCount,
    raw.outputTokens,
    raw.completion_tokens,
    raw.output_tokens,
    raw.outputTokenCount,
    raw.candidatesTokenCount
  );
  const totalTokens = tokenNumber(
    value.totalTokens,
    value.total_tokens,
    value.total,
    value.totalTokenCount,
    usageMetadata.totalTokenCount,
    raw.totalTokens,
    raw.total_tokens,
    raw.total,
    raw.totalTokenCount
  );

  const reasoningTokens = tokenNumber(
    value.outputTokenDetails?.reasoningTokens,
    value.reasoningTokens,
    value.reasoning_tokens,
    completionDetails.reasoning_tokens,
    raw.outputTokenDetails?.reasoningTokens,
    raw.reasoningTokens,
    raw.reasoning_tokens
  );
  const cacheReadTokens = tokenNumber(
    value.inputTokenDetails?.cacheReadTokens,
    value.cacheReadTokens,
    value.cached_tokens,
    value.cache_read_input_tokens,
    promptDetails.cached_tokens,
    raw.inputTokenDetails?.cacheReadTokens,
    raw.cacheReadTokens,
    raw.cached_tokens,
    raw.cache_read_input_tokens
  );
  const cacheWriteTokens = tokenNumber(
    value.inputTokenDetails?.cacheWriteTokens,
    value.cacheWriteTokens,
    value.cache_creation_input_tokens,
    raw.inputTokenDetails?.cacheWriteTokens,
    raw.cacheWriteTokens,
    raw.cache_creation_input_tokens
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens ?? addTokenCounts(inputTokens, outputTokens),
    reasoningTokens: positiveOrUndefined(reasoningTokens),
    cacheReadTokens: positiveOrUndefined(cacheReadTokens),
    cacheWriteTokens: positiveOrUndefined(cacheWriteTokens),
  };
}

export function addTokenUsage(left?: TokenUsageSummary, right?: TokenUsageSummary): TokenUsageSummary {
  const normalizedLeft = normalizeTokenUsage(left);
  const normalizedRight = normalizeTokenUsage(right);

  return {
    inputTokens: addTokenCounts(normalizedLeft.inputTokens, normalizedRight.inputTokens),
    outputTokens: addTokenCounts(normalizedLeft.outputTokens, normalizedRight.outputTokens),
    totalTokens: addTokenCounts(normalizedLeft.totalTokens, normalizedRight.totalTokens),
    reasoningTokens: addTokenCounts(normalizedLeft.reasoningTokens, normalizedRight.reasoningTokens),
    cacheReadTokens: addTokenCounts(normalizedLeft.cacheReadTokens, normalizedRight.cacheReadTokens),
    cacheWriteTokens: addTokenCounts(normalizedLeft.cacheWriteTokens, normalizedRight.cacheWriteTokens),
  };
}

export function tokenUsageHasValues(usage?: TokenUsageSummary) {
  const normalized = normalizeTokenUsage(usage);
  return [
    normalized.inputTokens,
    normalized.outputTokens,
    normalized.totalTokens,
    normalized.reasoningTokens,
    normalized.cacheReadTokens,
    normalized.cacheWriteTokens,
  ].some(value => typeof value === 'number' && value > 0);
}

export function formatTokenCount(value?: number) {
  if (value == null) return '-';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function formatTokenUsageBrief(usage?: TokenUsageSummary) {
  const normalized = normalizeTokenUsage(usage);
  if (!tokenUsageHasValues(normalized)) return '';
  return `${formatTokenCount(normalized.totalTokens)} tok`;
}

export function formatTokenUsageDirectional(usage?: TokenUsageSummary) {
  const normalized = normalizeTokenUsage(usage);
  if (!tokenUsageHasValues(normalized)) return '';

  const parts = [`${formatTokenCount(normalized.totalTokens)} tok`];
  if (normalized.inputTokens != null) parts.push(`\u2191${formatTokenCount(normalized.inputTokens)}`);
  if (normalized.outputTokens != null) parts.push(`\u2193${formatTokenCount(normalized.outputTokens)}`);
  return parts.join(' ');
}

export function formatTokenUsageDetail(usage?: TokenUsageSummary) {
  const normalized = normalizeTokenUsage(usage);
  if (!tokenUsageHasValues(normalized)) return 'No token usage reported';

  const parts = [
    `Total ${formatTokenCount(normalized.totalTokens)}`,
    `Input ${formatTokenCount(normalized.inputTokens)}`,
    `Output ${formatTokenCount(normalized.outputTokens)}`,
  ];
  if (normalized.reasoningTokens != null) parts.push(`Reasoning ${formatTokenCount(normalized.reasoningTokens)}`);
  if (normalized.cacheReadTokens != null) parts.push(`Cache read ${formatTokenCount(normalized.cacheReadTokens)}`);
  if (normalized.cacheWriteTokens != null) parts.push(`Cache write ${formatTokenCount(normalized.cacheWriteTokens)}`);
  return parts.join(' / ');
}
