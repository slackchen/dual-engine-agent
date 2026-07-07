import { useEffect, useMemo, useState } from 'react';

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
      const haystack = `${event.title} ${event.source} ${event.phase} ${event.runId || ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, sourceFilter, state.events]);

  const selectedEvent = useMemo(
    () => state.events.find(event => event.id === selectedId) || filteredEvents.at(-1) || null,
    [filteredEvents, selectedId, state.events]
  );

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

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr)' }}>
        <div style={{ borderRight: '1px solid #333', overflowY: 'auto' }}>
          {filteredEvents.length === 0 && (
            <div style={{ padding: '18px', fontSize: '12px', color: '#8a8a8a' }}>
              No trace events. Capture starts when this window is opened or the Capture toggle is enabled.
            </div>
          )}
          {filteredEvents.map(event => {
            const selected = selectedEvent?.id === event.id;
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
                  <span style={{ marginLeft: 'auto' }}>{shortRunId(event.runId)}</span>
                </div>
                <div style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {event.title}
                </div>
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
                <span style={{ color: '#8a8a8a' }}>{selectedEvent.timestamp}</span>
                <span style={{ color: '#8a8a8a', marginLeft: 'auto' }}>{selectedEvent.runId || 'global'}</span>
              </div>
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
