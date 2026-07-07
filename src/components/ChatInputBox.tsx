import { useEffect, useRef, useState, memo } from 'react';
import { Message } from '../types';
import { PROVIDER_LABELS, type ProviderConfig } from '../hooks/useAppConfig';

interface ChatInputBoxProps {
  onSend: (userTask: string) => void | Promise<boolean>;
  onPlanSend: (userTask: string) => void;
  isRunning: boolean;
  handleStop: () => void;
  messages: Message[];
  providerConfigs: ProviderConfig[];
  plannerProviderConfigId: string;
  setPlannerProviderConfigId: (id: string) => void;
  plannerModel: string;
  setPlannerModel: (m: string) => void;
  workerProviderConfigId: string;
  setWorkerProviderConfigId: (id: string) => void;
  workerModel: string;
  setWorkerModel: (m: string) => void;
  modelsByConfigId: Record<string, string[]>;
  loadingModelsByConfigId: Record<string, boolean>;
}

interface ModelPickerProps {
  label: string;
  align: 'left' | 'right';
  providerConfigs: ProviderConfig[];
  selectedConfigId: string;
  setSelectedConfigId: (id: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  modelsByConfigId: Record<string, string[]>;
  loadingModelsByConfigId: Record<string, boolean>;
}

const ModelPicker = ({
  label,
  align,
  providerConfigs,
  selectedConfigId,
  setSelectedConfigId,
  selectedModel,
  setSelectedModel,
  modelsByConfigId,
  loadingModelsByConfigId,
}: ModelPickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeConfigId, setActiveConfigId] = useState(selectedConfigId || providerConfigs[0]?.id || '');
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedConfig = providerConfigs.find(config => config.id === selectedConfigId);
  const activeConfig = providerConfigs.find(config => config.id === activeConfigId) || selectedConfig || providerConfigs[0];
  const activeModels = activeConfig ? modelsByConfigId[activeConfig.id] || [] : [];
  const isActiveLoading = activeConfig ? !!loadingModelsByConfigId[activeConfig.id] : false;

  useEffect(() => {
    if (isOpen) setActiveConfigId(selectedConfigId || providerConfigs[0]?.id || '');
  }, [isOpen, providerConfigs, selectedConfigId]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const chooseModel = (configId: string, model: string) => {
    setSelectedConfigId(configId);
    setSelectedModel(model);
    setIsOpen(false);
  };

  const displayText = selectedModel || `${label} Auto`;
  const title = selectedConfig
    ? `${label}: ${selectedConfig.name}${selectedModel ? ` / ${selectedModel}` : ' / Auto'}`
    : `${label}: Auto`;

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setIsOpen(open => !open)}
        title={title}
        style={{
          width: '100%',
          minWidth: 0,
          padding: '2px 4px',
          background: 'transparent',
          color: 'var(--text-secondary)',
          border: 'none',
          fontSize: '11px',
          textAlign: 'left',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
        }}
      >
        {displayText}
      </button>
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            ...(align === 'left' ? { left: 0 } : { right: 0 }),
            width: '380px',
            maxWidth: 'calc(100vw - 32px)',
            height: '280px',
            display: 'grid',
            gridTemplateColumns: '150px minmax(0, 1fr)',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            overflow: 'hidden',
            zIndex: 50,
          }}
        >
          <div style={{ borderRight: '1px solid var(--border-color)', overflowY: 'auto' }}>
            {providerConfigs.map(config => {
              const isActive = config.id === activeConfig?.id;
              return (
                <button
                  key={config.id}
                  type="button"
                  onPointerEnter={() => {
                    if (activeConfigId !== config.id) setActiveConfigId(config.id);
                  }}
                  onClick={() => setActiveConfigId(config.id)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: isActive ? 'var(--bg-secondary)' : 'transparent',
                    color: 'var(--text-primary)',
                    border: 'none',
                    borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{config.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>{PROVIDER_LABELS[config.provider]}</div>
                </button>
              );
            })}
          </div>
          <div style={{ overflowY: 'auto', padding: '6px' }}>
            {activeConfig && (
              <button
                type="button"
                onClick={() => chooseModel(activeConfig.id, '')}
                style={{
                  width: '100%',
                  padding: '7px 8px',
                  background: selectedConfigId === activeConfig.id && !selectedModel ? 'var(--bg-secondary)' : 'transparent',
                  color: 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: '4px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                Auto
              </button>
            )}
            {activeModels.map(model => {
              const isSelected = selectedConfigId === activeConfig?.id && selectedModel === model;
              return (
                <button
                  key={model}
                  type="button"
                  onClick={() => activeConfig && chooseModel(activeConfig.id, model)}
                  style={{
                    width: '100%',
                    padding: '7px 8px',
                    background: isSelected ? 'var(--bg-secondary)' : 'transparent',
                    color: 'var(--text-primary)',
                    border: 'none',
                    borderRadius: '4px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '12px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={model}
                >
                  {model}
                </button>
              );
            })}
            {isActiveLoading && <div style={{ padding: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>Loading...</div>}
            {!isActiveLoading && activeModels.length === 0 && <div style={{ padding: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>No models</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export const ChatInputBox = memo(({
  onSend,
  onPlanSend,
  isRunning,
  handleStop,
  messages,
  providerConfigs,
  plannerProviderConfigId,
  setPlannerProviderConfigId,
  plannerModel,
  setPlannerModel,
  workerProviderConfigId,
  setWorkerProviderConfigId,
  workerModel,
  setWorkerModel,
  modelsByConfigId,
  loadingModelsByConfigId
}: ChatInputBoxProps) => {
  const [chatInput, setChatInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [inputMode, setInputMode] = useState<'chat' | 'plan'>('chat');

  const submit = () => {
    if (isRunning || !chatInput.trim()) return;
    if (inputMode === 'plan') {
      onPlanSend(chatInput);
    } else {
      onSend(chatInput);
    }
    setChatInput('');
    setHistoryIndex(-1);
  };

  return (
    <div className="chat-input" style={{ background: 'var(--bg-secondary)', padding: '10px' }}>
      <textarea 
        className="chat-input-textarea"
        placeholder={inputMode === 'plan' ? 'Discuss a plan before execution...' : 'Ask the Dual-Engine Agent to do something...'}
        value={chatInput}
        onChange={e => {
          setChatInput(e.target.value);
          setHistoryIndex(-1);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!isRunning && chatInput.trim()) {
              submit();
            }
          } else if (e.key === 'ArrowUp') {
            const rawUserHistory = messages.filter(m => m.role === 'user').map(m => m.content);
            const userHistory = rawUserHistory.filter((content, index, arr) => index === 0 || content !== arr[index - 1]);
            if (userHistory.length > 0) {
               e.preventDefault();
               const nextIndex = historyIndex < userHistory.length - 1 ? historyIndex + 1 : historyIndex;
               setHistoryIndex(nextIndex);
               setChatInput(userHistory[userHistory.length - 1 - nextIndex]);
            }
          } else if (e.key === 'ArrowDown') {
            const rawUserHistory = messages.filter(m => m.role === 'user').map(m => m.content);
            const userHistory = rawUserHistory.filter((content, index, arr) => index === 0 || content !== arr[index - 1]);
            if (historyIndex > 0) {
               e.preventDefault();
               const nextIndex = historyIndex - 1;
               setHistoryIndex(nextIndex);
               setChatInput(userHistory[userHistory.length - 1 - nextIndex]);
            } else if (historyIndex === 0) {
               e.preventDefault();
               setHistoryIndex(-1);
               setChatInput('');
            }
          }
        }}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      <div className="chat-input-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          <div style={{ display: 'inline-flex', border: '1px solid var(--border-color)', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
            {(['chat', 'plan'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setInputMode(mode)}
                style={{
                  padding: '4px 8px',
                  background: inputMode === mode ? 'var(--accent)' : 'transparent',
                  color: inputMode === mode ? '#fff' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: 0,
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                {mode === 'chat' ? 'Chat' : 'Plan'}
              </button>
            ))}
          </div>
          <div className="models" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <ModelPicker
            label="Main"
            align="left"
            providerConfigs={providerConfigs}
            selectedConfigId={plannerProviderConfigId}
            setSelectedConfigId={setPlannerProviderConfigId}
            selectedModel={plannerModel}
            setSelectedModel={setPlannerModel}
            modelsByConfigId={modelsByConfigId}
            loadingModelsByConfigId={loadingModelsByConfigId}
          />
          <ModelPicker
            label="Sub"
            align="right"
            providerConfigs={providerConfigs}
            selectedConfigId={workerProviderConfigId}
            setSelectedConfigId={setWorkerProviderConfigId}
            selectedModel={workerModel}
            setSelectedModel={setWorkerModel}
            modelsByConfigId={modelsByConfigId}
            loadingModelsByConfigId={loadingModelsByConfigId}
          />
          </div>
        </div>
        {isRunning ? (
          <button
            onClick={handleStop}
            style={{ background: '#dc3545', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer' }}
          >
            ⏹ Stop
          </button>
        ) : (
          <button onClick={() => {
            submit();
          }} disabled={!chatInput.trim()}>Send</button>
        )}
      </div>
    </div>
  );
});
