import { streamText } from 'ai';
import type { DebugTraceSource } from './debugTrace';
import { traceEvent } from './debugTrace';

interface StreamTraceContext {
  runId?: string;
  source: DebugTraceSource;
  title: string;
  metadata?: Record<string, unknown>;
  onTextDelta?: (delta: string, metadata: Record<string, unknown>) => void;
}

interface StreamTraceState {
  textBuffer: string;
  reasoningBuffer: string;
  toolInputBuffer: string;
  textLength: number;
  reasoningLength: number;
  toolInputLength: number;
  lastFlushAt: number;
  sequence: number;
}

const FLUSH_INTERVAL_MS = 120;
const FLUSH_CHARS = 500;
const TAIL_CHARS = 4000;

function compactChunk(chunk: any) {
  if (!chunk || typeof chunk !== 'object') return chunk;

  const output: Record<string, unknown> = {
    type: chunk.type,
    id: chunk.id,
    toolName: chunk.toolName,
    finishReason: chunk.finishReason,
    rawFinishReason: chunk.rawFinishReason,
  };

  if (chunk.usage) output.usage = chunk.usage;
  if (chunk.error) output.error = chunk.error;
  return output;
}

function appendLimited(current: string, delta: string) {
  const next = `${current}${delta}`;
  return next.length > TAIL_CHARS ? next.slice(next.length - TAIL_CHARS) : next;
}

function flushStreamTrace(
  context: StreamTraceContext,
  state: StreamTraceState,
  reason: 'interval' | 'size' | 'final',
) {
  const textDelta = state.textBuffer;
  const reasoningDelta = state.reasoningBuffer;
  const toolInputDelta = state.toolInputBuffer;
  if (!textDelta && !reasoningDelta && !toolInputDelta) return;

  state.sequence += 1;
  traceEvent({
    runId: context.runId,
    source: context.source,
    phase: 'response-stream',
    title: `${context.title} stream #${state.sequence}`,
    data: {
      ...context.metadata,
      reason,
      sequence: state.sequence,
      textDelta,
      reasoningDelta,
      toolInputDelta,
      lengths: {
        text: state.textLength,
        reasoning: state.reasoningLength,
        toolInput: state.toolInputLength,
      },
    },
  });

  state.textBuffer = '';
  state.reasoningBuffer = '';
  state.toolInputBuffer = '';
  state.lastFlushAt = Date.now();
}

function addStreamChunk(context: StreamTraceContext, state: StreamTraceState, chunk: any) {
  if (!chunk || typeof chunk !== 'object') return;

  if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
    state.textBuffer = appendLimited(state.textBuffer, chunk.text);
    state.textLength += chunk.text.length;
    context.onTextDelta?.(chunk.text, {
      ...context.metadata,
      textLength: state.textLength,
    });
  } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
    state.reasoningBuffer = appendLimited(state.reasoningBuffer, chunk.text);
    state.reasoningLength += chunk.text.length;
  } else if (chunk.type === 'tool-input-delta' && typeof chunk.delta === 'string') {
    state.toolInputBuffer = appendLimited(state.toolInputBuffer, chunk.delta);
    state.toolInputLength += chunk.delta.length;
  } else if (
    chunk.type === 'tool-call'
    || chunk.type === 'tool-result'
    || chunk.type === 'tool-error'
    || chunk.type === 'finish-step'
    || chunk.type === 'finish'
    || chunk.type === 'error'
    || chunk.type === 'abort'
  ) {
    traceEvent({
      runId: context.runId,
      source: context.source,
      phase: 'response-stream',
      title: `${context.title} ${chunk.type}`,
      data: {
        ...context.metadata,
        chunk: compactChunk(chunk),
      },
    });
  }

  const bufferedLength = state.textBuffer.length + state.reasoningBuffer.length + state.toolInputBuffer.length;
  const now = Date.now();
  if (bufferedLength >= FLUSH_CHARS) {
    flushStreamTrace(context, state, 'size');
  } else if (bufferedLength > 0 && now - state.lastFlushAt >= FLUSH_INTERVAL_MS) {
    flushStreamTrace(context, state, 'interval');
  }
}

export async function streamTextWithTrace(args: any, context: StreamTraceContext) {
  const state: StreamTraceState = {
    textBuffer: '',
    reasoningBuffer: '',
    toolInputBuffer: '',
    textLength: 0,
    reasoningLength: 0,
    toolInputLength: 0,
    lastFlushAt: Date.now(),
    sequence: 0,
  };

  const originalOnChunk = args.onChunk;
  const result = streamText({
    ...args,
    onChunk: async (event: any) => {
      addStreamChunk(context, state, event?.chunk);
      if (originalOnChunk) await originalOnChunk(event);
    },
  });

  try {
    const text = await result.text;
    flushStreamTrace(context, state, 'final');
    const usage = await result.usage;
    return { text, usage, result };
  } catch (error) {
    flushStreamTrace(context, state, 'final');
    throw error;
  }
}
