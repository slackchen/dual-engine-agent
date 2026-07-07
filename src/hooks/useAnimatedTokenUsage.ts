import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeTokenUsage, type TokenUsageSummary } from '../shared/tokenUsage';

const TOKEN_FIELDS: Array<keyof TokenUsageSummary> = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
];

const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

const usageKey = (usage: TokenUsageSummary) => TOKEN_FIELDS
  .map(field => usage[field] ?? '')
  .join('|');

const interpolateUsage = (
  from: TokenUsageSummary,
  to: TokenUsageSummary,
  progress: number
): TokenUsageSummary => {
  const eased = easeOutCubic(progress);
  const next: TokenUsageSummary = {};

  for (const field of TOKEN_FIELDS) {
    const target = to[field];
    if (target == null) continue;
    const start = from[field] ?? 0;
    next[field] = Math.round(start + (target - start) * eased);
  }

  return next;
};

export function useAnimatedTokenUsage(targetUsage?: TokenUsageSummary, durationMs = 700) {
  const target = useMemo(() => normalizeTokenUsage(targetUsage), [
    targetUsage?.inputTokens,
    targetUsage?.outputTokens,
    targetUsage?.totalTokens,
    targetUsage?.reasoningTokens,
    targetUsage?.cacheReadTokens,
    targetUsage?.cacheWriteTokens,
  ]);
  const key = usageKey(target);
  const [displayUsage, setDisplayUsage] = useState<TokenUsageSummary>(target);
  const displayUsageRef = useRef<TokenUsageSummary>(target);

  useEffect(() => {
    const startUsage = displayUsageRef.current;
    const startedAt = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const nextUsage = progress >= 1
        ? target
        : interpolateUsage(startUsage, target, progress);

      displayUsageRef.current = nextUsage;
      setDisplayUsage(nextUsage);

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, key, target]);

  return displayUsage;
}
