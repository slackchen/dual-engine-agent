import { useEffect, useMemo, useState } from 'react';
import {
  addTokenUsage,
  formatTokenCount,
  normalizeTokenUsage,
  type TokenUsageSummary,
  tokenUsageHasValues,
} from './shared/tokenUsage';
import { estimateModelRequestTokens } from './shared/modelContext';

type DebugTraceEvent = {
  id: string;
  timestamp: string;
  runId?: string;
  source: string;
  phase: string;
  title: string;
  data: unknown;
};

type DebugTraceState = {
  enabled: boolean;
  events: DebugTraceEvent[];
};

type RequestTokenEstimate = {
  inputTokens?: number;
  systemTokens?: number;
  messageTokens?: number;
  toolTokens?: number;
  totalChars?: number;
  messageCount?: number;
  toolCount?: number;
  estimated?: boolean;
};

const emptyState: DebugTraceState = {
  enabled: false,
  events: [],
};

function dedupeEvents(events: DebugTraceEvent[]) {
  const seen = new Set<string>();
  const deduped: DebugTraceEvent[] = [];

  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    deduped.push(event);
  }

  return deduped;
}

function normalizeState(state: DebugTraceState | null | undefined): DebugTraceState {
  if (!state) return emptyState;
  return {
    enabled: !!state.enabled,
    events: dedupeEvents(Array.isArray(state.events) ? state.events : []),
  };
}

const sourceColors: Record<string, string> = {
  controller: '#9cdcfe',
  planner: '#c586c0',
  'plan-session': '#dcdcaa',
  worker: '#4ec9b0',
  converter: '#ce9178',
  tool: '#569cd6',
  system: '#808080',
};

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString([], { hour12: false });
}

function shortRunId(runId?: string) {
  return runId ? runId.slice(0, 8) : 'global';
}

function getTraceEventUsage(event: DebugTraceEvent) {
  const data = event.data as any;
  const usage = normalizeTokenUsage(data?.usage);
  if (tokenUsageHasValues(usage)) return usage;

  const chunkUsage = normalizeTokenUsage(data?.chunk?.usage);
  if (tokenUsageHasValues(chunkUsage)) return chunkUsage;

  const stepUsage = normalizeTokenUsage(data?.stepData?.usage);
  if (tokenUsageHasValues(stepUsage)) return stepUsage;

  const chatCompletionUsage = normalizeTokenUsage(data?.chatCompletion?.usage);
  if (tokenUsageHasValues(chatCompletionUsage)) return chatCompletionUsage;

  const resultUsage = normalizeTokenUsage(data?.result?.usage || data?.rawResponse?.usage || data?.response?.usage);
  if (tokenUsageHasValues(resultUsage)) return resultUsage;

  return {};
}

function getTraceEventStreamContent(event: DebugTraceEvent) {
  if (event.phase !== 'response-stream') return null;
  const data = event.data as any;
  const parts = [
    data?.textDelta ? { label: 'text', value: String(data.textDelta) } : null,
    data?.reasoningDelta ? { label: 'reasoning', value: String(data.reasoningDelta) } : null,
    data?.toolInputDelta ? { label: 'tool input', value: String(data.toolInputDelta) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (parts.length === 0) return null;
  return {
    label: parts.map(part => part.label).join(' + '),
    text: parts.map(part => part.value).join(''),
  };
}

function compactPreview(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function getTraceEventRequestEstimate(event: DebugTraceEvent): RequestTokenEstimate | null {
  const data = event.data as any;
  const estimate = data?.requestTokenEstimate || data?.requestTokens;
  const inputTokens = positiveNumber(estimate?.inputTokens ?? estimate?.totalTokens);
  if (inputTokens) {
    return {
      ...estimate,
      inputTokens,
    };
  }

  if (event.phase !== 'request') return null;

  const fallbackEstimate = estimateModelRequestTokens({
    system: data?.system,
    messages: Array.isArray(data?.messages) ? data.messages : [],
    tools: data?.tools,
  });

  return fallbackEstimate.inputTokens > 0 ? fallbackEstimate : null;
}

function formatRequestEstimateBrief(estimate: RequestTokenEstimate) {
  return `send \u2191${formatTokenCount(estimate.inputTokens)}`;
}

function formatRequestEstimateDetail(estimate: RequestTokenEstimate) {
  const parts = [`Send est \u2191${formatTokenCount(estimate.inputTokens)}`];
  if (positiveNumber(estimate.systemTokens)) parts.push(`System ${formatTokenCount(estimate.systemTokens)}`);
  if (positiveNumber(estimate.messageTokens)) parts.push(`Messages ${formatTokenCount(estimate.messageTokens)}`);
  if (positiveNumber(estimate.toolTokens)) parts.push(`Tools ${formatTokenCount(estimate.toolTokens)}`);
  if (positiveNumber(estimate.totalChars)) parts.push(`${formatTokenCount(estimate.totalChars)} chars`);
  if (positiveNumber(estimate.messageCount)) parts.push(`${estimate.messageCount} msg`);
  if (positiveNumber(estimate.toolCount)) parts.push(`${estimate.toolCount} tools`);
  return parts.join(' / ');
}

function formatReceiveUsageBrief(usage?: TokenUsageSummary) {
  const normalized = normalizeTokenUsage(usage);
  if (positiveNumber(normalized.outputTokens)) return `recv \u2193${formatTokenCount(normalized.outputTokens)}`;
  if (positiveNumber(normalized.totalTokens)) return `reported ${formatTokenCount(normalized.totalTokens)} tok`;
  return '';
}

function formatReceiveUsageDetail(usage?: TokenUsageSummary) {
  const normalized = normalizeTokenUsage(usage);
  const parts: string[] = [];

  if (positiveNumber(normalized.outputTokens)) {
    parts.push(`Receive \u2193${formatTokenCount(normalized.outputTokens)}`);
  } else if (positiveNumber(normalized.totalTokens)) {
    parts.push(`Reported ${formatTokenCount(normalized.totalTokens)} total`);
  }

  if (positiveNumber(normalized.inputTokens)) parts.push(`Actual \u2191${formatTokenCount(normalized.inputTokens)}`);
  if (positiveNumber(normalized.totalTokens)) parts.push(`Total ${formatTokenCount(normalized.totalTokens)}`);
  if (positiveNumber(normalized.reasoningTokens)) parts.push(`Reasoning ${formatTokenCount(normalized.reasoningTokens)}`);
  if (positiveNumber(normalized.cacheReadTokens)) parts.push(`Cache read ${formatTokenCount(normalized.cacheReadTokens)}`);
  if (positiveNumber(normalized.cacheWriteTokens)) parts.push(`Cache write ${formatTokenCount(normalized.cacheWriteTokens)}`);
  return parts.join(' / ');
}

function addRequestEstimates(left: RequestTokenEstimate, right: RequestTokenEstimate): RequestTokenEstimate {
  return {
    inputTokens: (left.inputTokens ?? 0) + (right.inputTokens ?? 0),
    systemTokens: (left.systemTokens ?? 0) + (right.systemTokens ?? 0),
    messageTokens: (left.messageTokens ?? 0) + (right.messageTokens ?? 0),
    toolTokens: (left.toolTokens ?? 0) + (right.toolTokens ?? 0),
    totalChars: (left.totalChars ?? 0) + (right.totalChars ?? 0),
    messageCount: (left.messageCount ?? 0) + (right.messageCount ?? 0),
    toolCount: (left.toolCount ?? 0) + (right.toolCount ?? 0),
    estimated: true,
  };
}

export function DebugTraceApp() {
  const [state, setState] = useState<DebugTraceState>(emptyState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let mounted = true;
    window.ipcRenderer?.invoke('debug-trace:get-state').then((nextState: DebugTraceState) => {
      if (!mounted) return;
      const normalized = normalizeState(nextState);
      setState(normalized);
      setSelectedId(normalized.events.at(-1)?.id || null);
    });

    const onEvent = (_event: unknown, traceEvent: DebugTraceEvent) => {
      setState(current => {
        if (current.events.some(event => event.id === traceEvent.id)) return current;
        return {
          ...current,
          events: [...current.events, traceEvent],
        };
      });
      setSelectedId(current => current || traceEvent.id);
    };

    window.ipcRenderer?.on('debug-trace:event', onEvent);
    return () => {
      mounted = false;
      window.ipcRenderer?.removeListener('debug-trace:event', onEvent);
    };
  }, []);

  const sources = useMemo(
    () => ['all', ...Array.from(new Set(state.events.map(event => event.source))).sort()],
    [state.events]
  );

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return state.events.filter(event => {
      if (sourceFilter !== 'all' && event.source !== sourceFilter) return false;
      if (!normalizedQuery) return true;
      const streamContent = getTraceEventStreamContent(event);
      const haystack = `${event.title} ${event.source} ${event.phase} ${event.runId || ''} ${streamContent?.text || ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, sourceFilter, state.events]);

  const tokenStats = useMemo(() => {
    let requestCount = 0;
    let responseCount = 0;
    let sendEstimate: RequestTokenEstimate = {};
    let reportedUsage = {};

    for (const event of filteredEvents) {
      const requestEstimate = getTraceEventRequestEstimate(event);
      if (requestEstimate) {
        requestCount += 1;
        sendEstimate = addRequestEstimates(sendEstimate, requestEstimate);
      }

      const usage = getTraceEventUsage(event);
      if (tokenUsageHasValues(usage)) {
        responseCount += 1;
        reportedUsage = addTokenUsage(reportedUsage, usage);
      }
    }

    return {
      requestCount,
      responseCount,
      sendEstimate,
      reportedUsage,
    };
  }, [filteredEvents]);

  const selectedEvent = useMemo(
    () => state.events.find(event => event.id === selectedId) || filteredEvents.at(-1) || null,
    [filteredEvents, selectedId, state.events]
  );

  const selectedUsage = selectedEvent ? getTraceEventUsage(selectedEvent) : {};
  const selectedRequestEstimate = selectedEvent ? getTraceEventRequestEstimate(selectedEvent) : null;
  const selectedStreamContent = selectedEvent ? getTraceEventStreamContent(selectedEvent) : null;
  const selectedJson = selectedEvent ? JSON.stringify(selectedEvent, null, 2) : '';

  const setEnabled = async (enabled: boolean) => {
    const nextState = await window.ipcRenderer?.invoke('debug-trace:set-enabled', enabled);
    if (nextState) setState(normalizeState(nextState));
  };

  const clear = async () => {
    const nextState = await window.ipcRenderer?.invoke('debug-trace:clear');
    setState(normalizeState(nextState));
    setSelectedId(null);
  };

  const copySelected = () => {
    if (selectedJson) navigator.clipboard.writeText(selectedJson);
  };

  const exportAll = () => {
    navigator.clipboard.writeText(JSON.stringify(state.events, null, 2));
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1e1e1e', color: '#d4d4d4', fontFamily: 'Segoe UI, sans-serif' }}>
      <div style={{ height: '46px', display: 'flex', alignItems: 'center', gap: '10px', padding: '0 14px', borderBottom: '1px solid #333', flexShrink: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, marginRight: 'auto' }}>Agent Trace</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#cccccc' }}>
          <input type="checkbox" checked={state.enabled} onChange={event => setEnabled(event.target.checked)} />
          Capture
        </label>
        <select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} style={controlStyle}>
          {sources.map(source => <option key={source} value={source}>{source}</option>)}
        </select>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter" style={{ ...controlStyle, width: '180px' }} />
        <button onClick={copySelected} disabled={!selectedEvent} style={buttonStyle}>Copy Event</button>
        <button onClick={exportAll} disabled={state.events.length === 0} style={buttonStyle}>Copy All</button>
        <button onClick={clear} style={buttonStyle}>Clear</button>
      </div>

      <div style={{ minHeight: '34px', display: 'flex', alignItems: 'center', gap: '10px', padding: '0 14px', borderBottom: '1px solid #2f2f2f', background: '#202020', flexShrink: 0, fontSize: '12px' }}>
        <span style={{ color: '#8a8a8a' }}>Tokens</span>
        {positiveNumber(tokenStats.sendEstimate.inputTokens) ? (
          <span style={sendTokenBadgeStyle}>{formatRequestEstimateDetail(tokenStats.sendEstimate)}</span>
        ) : (
          <span style={{ color: '#6f6f6f' }}>No request token estimate in the current filter</span>
        )}
        {tokenUsageHasValues(tokenStats.reportedUsage) && (
          <span style={usageTokenBadgeStyle}>{formatReceiveUsageDetail(tokenStats.reportedUsage)}</span>
        )}
        <span style={{ color: '#6f6f6f', marginLeft: 'auto' }}>
          {tokenStats.requestCount} requests / {tokenStats.responseCount} usage events
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr)' }}>
        <div style={{ borderRight: '1px solid #333', overflowY: 'auto' }}>
          {filteredEvents.length === 0 && (
            <div style={{ padding: '18px', fontSize: '12px', color: '#8a8a8a' }}>
              No trace events. Capture starts when this window is opened or the Capture toggle is enabled.
            </div>
          )}
          {filteredEvents.map(event => {
            const selected = selectedEvent?.id === event.id;
            const usage = getTraceEventUsage(event);
            const requestEstimate = getTraceEventRequestEstimate(event);
            const streamContent = getTraceEventStreamContent(event);
            return (
              <button
                key={event.id}
                onClick={() => setSelectedId(event.id)}
                style={{
                  width: '100%',
                  border: 'none',
                  borderBottom: '1px solid #2a2a2a',
                  background: selected ? '#2d2d30' : 'transparent',
                  color: '#d4d4d4',
                  padding: '9px 12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#8a8a8a', marginBottom: '4px' }}>
                  <span>{formatTime(event.timestamp)}</span>
                  <span style={{ color: sourceColors[event.source] || '#d4d4d4' }}>{event.source}</span>
                  <span>{event.phase}</span>
                  {requestEstimate && <span style={sendTokenBadgeStyle}>{formatRequestEstimateBrief(requestEstimate)}</span>}
                  {tokenUsageHasValues(usage) && <span style={usageTokenBadgeStyle}>{formatReceiveUsageBrief(usage)}</span>}
                  <span style={{ marginLeft: 'auto' }}>{shortRunId(event.runId)}</span>
                </div>
                <div style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {event.title}
                </div>
                {streamContent && (
                  <div style={{ marginTop: '5px', fontFamily: 'Consolas, monospace', fontSize: '11px', color: '#c8c8c8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: '#8a8a8a' }}>{streamContent.label}: </span>{compactPreview(streamContent.text)}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ minWidth: 0, overflow: 'auto', padding: '14px' }}>
          {selectedEvent ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '12px' }}>
                <span style={{ color: sourceColors[selectedEvent.source] || '#d4d4d4', fontWeight: 600 }}>{selectedEvent.source}</span>
                <span>{selectedEvent.phase}</span>
                {selectedRequestEstimate && (
                  <span style={sendTokenBadgeStyle}>{formatRequestEstimateDetail(selectedRequestEstimate)}</span>
                )}
                {tokenUsageHasValues(selectedUsage) && (
                  <span style={usageTokenBadgeStyle}>{formatReceiveUsageDetail(selectedUsage)}</span>
                )}
                <span style={{ color: '#8a8a8a' }}>{selectedEvent.timestamp}</span>
                <span style={{ color: '#8a8a8a', marginLeft: 'auto' }}>{selectedEvent.runId || 'global'}</span>
              </div>
              {selectedStreamContent && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '11px', color: '#8a8a8a', marginBottom: '4px' }}>Stream Chunk: {selectedStreamContent.label}</div>
                  <pre style={{ margin: 0, padding: '10px', border: '1px solid #333', borderRadius: '4px', background: '#181818', color: '#d4d4d4', fontFamily: 'Consolas, monospace', fontSize: '12px', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {selectedStreamContent.text}
                  </pre>
                </div>
              )}
              <pre style={{ margin: 0, fontFamily: 'Consolas, monospace', fontSize: '12px', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {selectedJson}
              </pre>
            </>
          ) : (
            <div style={{ color: '#8a8a8a', fontSize: '12px' }}>Select a trace event.</div>
          )}
        </div>
      </div>
    </div>
  );
}

const controlStyle: React.CSSProperties = {
  background: '#252526',
  color: '#d4d4d4',
  border: '1px solid #3c3c3c',
  borderRadius: '4px',
  padding: '5px 8px',
  fontSize: '12px',
};

const buttonStyle: React.CSSProperties = {
  ...controlStyle,
  cursor: 'pointer',
};

const sendTokenBadgeStyle: React.CSSProperties = {
  color: '#9cdcfe',
  background: 'rgba(156, 220, 254, 0.1)',
  border: '1px solid rgba(156, 220, 254, 0.2)',
  borderRadius: '4px',
  padding: '1px 5px',
  whiteSpace: 'nowrap',
};

const usageTokenBadgeStyle: React.CSSProperties = {
  color: '#dcdcaa',
  background: 'rgba(220, 220, 170, 0.1)',
  border: '1px solid rgba(220, 220, 170, 0.2)',
  borderRadius: '4px',
  padding: '1px 5px',
  whiteSpace: 'nowrap',
};
