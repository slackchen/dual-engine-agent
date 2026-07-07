import { randomUUID } from 'node:crypto';

export type DebugTraceSource =
  | 'controller'
  | 'planner'
  | 'plan-session'
  | 'worker'
  | 'converter'
  | 'tool'
  | 'system';

export type DebugTracePhase =
  | 'request'
  | 'response'
  | 'step'
  | 'usage'
  | 'status'
  | 'error'
  | 'lifecycle';

export interface DebugTraceEvent {
  id: string;
  timestamp: string;
  runId?: string;
  source: DebugTraceSource;
  phase: DebugTracePhase;
  title: string;
  data: unknown;
}

export interface DebugTraceInput {
  runId?: string;
  source: DebugTraceSource;
  phase: DebugTracePhase;
  title: string;
  data?: unknown;
}

const MAX_EVENTS = 800;
const MAX_STRING_LENGTH = 80000;
const MAX_DEPTH = 12;
const SENSITIVE_KEY_PATTERN = /(?:api[-_]?key|authorization|bearer|cookie|password|secret|token|tokenOrKey|googleOauthToken|x-api-key)/i;
const SECRET_LIKE_PATTERN = /(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|ya29\.[A-Za-z0-9._-]{12,})/g;

let enabled = false;
let events: DebugTraceEvent[] = [];
const subscribers = new Set<(event: DebugTraceEvent) => void>();

function sanitizeString(value: string) {
  const redacted = value.replace(SECRET_LIKE_PATTERN, '[redacted]');
  if (redacted.length <= MAX_STRING_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_STRING_LENGTH)}... (${redacted.length} chars)`;
}

function sanitizeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value !== 'object') return String(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Max depth reached]';

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = entry ? '[redacted]' : entry;
    } else {
      output[key] = sanitizeValue(entry, depth + 1, seen);
    }
  }
  return output;
}

export function sanitizeDebugTraceData(value: unknown) {
  return sanitizeValue(value);
}

export function isDebugTraceEnabled() {
  return enabled;
}

export function setDebugTraceEnabled(nextEnabled: boolean) {
  enabled = nextEnabled;
  return enabled;
}

export function clearDebugTraceEvents() {
  events = [];
}

export function getDebugTraceState() {
  return {
    enabled,
    events,
  };
}

export function subscribeDebugTrace(listener: (event: DebugTraceEvent) => void) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function traceEvent(input: DebugTraceInput) {
  if (!enabled) return null;

  const event: DebugTraceEvent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    runId: input.runId,
    source: input.source,
    phase: input.phase,
    title: input.title,
    data: sanitizeDebugTraceData(input.data ?? {}),
  };

  events = [...events.slice(Math.max(events.length - MAX_EVENTS + 1, 0)), event];
  subscribers.forEach(listener => listener(event));
  return event;
}
