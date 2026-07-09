import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties, type ReactNode } from 'react';
import './index.css';
// @ts-ignore
import Editor, { DiffEditor } from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { FileTreeNode } from './components/FileTreeNode';
import { ContextMenu } from './components/ContextMenu';
import { HistoryModal } from './components/HistoryModal';
import { SettingsModal, type SettingsTab } from './components/SettingsModal';
import { AgentStepView } from './components/AgentStepView';
import { ChatInputBox } from './components/ChatInputBox';
import { PlanModeView } from './components/PlanModeView';
import { applyConverterPlugin, NO_CONVERTER_PLUGIN_ID } from './converterPlugins';
import { buildChatHistory, formatPlanSessionForHistory } from './chatHistory';
import type { Message, PlanDraft, PlanSessionState, PlanSessionTurn } from './types';
import {
  addTokenUsage,
  formatTokenCount,
  formatTokenUsageDirectional,
  formatTokenUsageDetail,
  tokenUsageHasValues,
  type TokenUsageSummary,
} from './shared/tokenUsage';



import { useResizer } from './hooks/useResizer';
import { useAppConfig, type AppSettingsValues, type ProviderConfig } from './hooks/useAppConfig';
import { useWorkspace } from './hooks/useWorkspace';
import { useConversations } from './hooks/useConversations';
import { useFileEditor } from './hooks/useFileEditor';
import { useChatScroll } from './hooks/useChatScroll';
import { useAnimatedTokenUsage } from './hooks/useAnimatedTokenUsage';

const parseReasoning = (content: string) => {
  if (!content) return { reasoning: '', finalContent: '' };
  const thinkRegex = /<(think|thinking)>([\s\S]*?)(?:<\/\1>|$)/i;
  const match = content.match(thinkRegex);
  if (match) {
    const reasoning = match[2].trim();
    const finalContent = content.replace(match[0], '').trim();
    return { reasoning, finalContent };
  }
  return { reasoning: '', finalContent: content };
};

const ApiCallsBadge = ({ count, plannerCount = 0, workerCount = 0, showBreakdown = false }: { count: number; plannerCount?: number; workerCount?: number; showBreakdown?: boolean }) => (
  <span style={{ backgroundColor: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
    <span aria-hidden="true">🤖</span>
    API Calls: {count}{showBreakdown ? ` (Planner ${plannerCount} / Worker ${workerCount})` : ''}
  </span>
);

const TokenUsageBadge = ({ usage, plannerUsage, workerUsage }: { usage?: TokenUsageSummary; plannerUsage?: TokenUsageSummary; workerUsage?: TokenUsageSummary }) => {
  const animatedUsage = useAnimatedTokenUsage(usage);
  const brief = formatTokenUsageDirectional(animatedUsage);
  const targetBrief = formatTokenUsageDirectional(usage);
  const previousBriefRef = useRef(brief);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (!targetBrief || previousBriefRef.current === targetBrief) return;
    previousBriefRef.current = targetBrief;
    setIsAnimating(false);
    const frame = requestAnimationFrame(() => setIsAnimating(true));
    const timer = window.setTimeout(() => setIsAnimating(false), 520);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [targetBrief]);

  if (!tokenUsageHasValues(usage)) return null;

  const title = [
    formatTokenUsageDetail(usage),
    tokenUsageHasValues(plannerUsage) ? `Planner: ${formatTokenUsageDetail(plannerUsage)}` : '',
    tokenUsageHasValues(workerUsage) ? `Worker: ${formatTokenUsageDetail(workerUsage)}` : '',
  ].filter(Boolean).join('\n');

  return (
    <span title={title} className={`token-usage-badge${isAnimating ? ' token-usage-badge-pulse' : ''}`}>
      {animatedUsage.inputTokens == null && animatedUsage.outputTokens == null && animatedUsage.totalTokens != null && (
        <span className="token-usage-value token-usage-total">{formatTokenCount(animatedUsage.totalTokens)} tok</span>
      )}
      {animatedUsage.inputTokens != null && (
        <span className="token-usage-value token-usage-input">↑{formatTokenCount(animatedUsage.inputTokens)}</span>
      )}
      {animatedUsage.outputTokens != null && (
        <span className="token-usage-value token-usage-output">↓{formatTokenCount(animatedUsage.outputTokens)}</span>
      )}
    </span>
  );
};

const MODEL_WAIT_STATUS = 'Tool finished. Waiting for model to analyze results';

const formatElapsed = (startedAt: number, now: number) => {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const useRevealedText = (text: string, animate: boolean, charsPerStep = 2, stepMs = 24, onComplete?: () => void) => {
  const [displayText, setDisplayText] = useState(animate ? '' : text);
  const displayRef = useRef(animate ? '' : text);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!animate) {
      displayRef.current = text;
      setDisplayText(text);
      return;
    }

    if (!text.startsWith(displayRef.current)) {
      displayRef.current = '';
      setDisplayText('');
    }

    let timer = 0;
    const tick = () => {
      const currentLength = displayRef.current.length;
      if (currentLength >= text.length) {
        onCompleteRef.current?.();
        return;
      }

      const next = text.slice(0, Math.min(text.length, currentLength + charsPerStep));
      displayRef.current = next;
      setDisplayText(next);
      timer = window.setTimeout(tick, stepMs);
    };

    timer = window.setTimeout(tick, stepMs);
    return () => window.clearTimeout(timer);
  }, [animate, charsPerStep, stepMs, text]);

  return displayText;
};

const MarkdownContent = ({
  content,
  workspacePath,
  animate,
  showCaret = false,
  charsPerStep = 2,
  stepMs = 24,
  onRevealComplete,
  style,
}: {
  content: string;
  workspacePath: string;
  animate: boolean;
  showCaret?: boolean;
  charsPerStep?: number;
  stepMs?: number;
  onRevealComplete?: () => void;
  style?: CSSProperties;
}) => {
  const displayContent = useRevealedText(content, animate, charsPerStep, stepMs, onRevealComplete);
  const { reasoning, finalContent } = parseReasoning(displayContent);

  return (
    <div className="markdown-body" style={style}>
      {reasoning && (
        <details open style={{ marginBottom: '15px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
          <summary style={{ padding: '8px 12px', cursor: 'pointer', outline: 'none', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 'bold' }}>
            <span>馃</span> Thinking Process...
          </summary>
          <div style={{ padding: '12px', borderTop: '1px solid var(--border-color)', color: '#aaa', fontSize: '12px', whiteSpace: 'pre-wrap', fontStyle: 'italic', background: '#1e1e1e', borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px' }}>
            {reasoning}
          </div>
        </details>
      )}
      {finalContent && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a({ href, children, ...props }: any) {
              return (
                <a href={href} {...props} onClick={(e) => {
                  e.preventDefault();
                  if (href) {
                    let targetUrl = href;
                    if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('file://')) {
                      targetUrl = `file://${workspacePath}/${href.startsWith('/') ? href.slice(1) : href}`;
                    }
                    window.ipcRenderer.invoke('agent:open-browser-window', { url: targetUrl }).catch(console.error);
                  }
                }} style={{ cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}>
                  {children}
                </a>
              );
            },
            code({ inline, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || '');
              return !inline && match ? (
                <SyntaxHighlighter {...props} children={String(children).replace(/\n$/, '')} style={vscDarkPlus} language={match[1]} PreTag="div" />
              ) : (
                <code {...props} className={className}>{children}</code>
              );
            }
          }}
        >
          {finalContent}
        </ReactMarkdown>
      )}
      {showCaret && animate && displayContent.length < content.length && <span className="stream-caret" aria-hidden="true" />}
    </div>
  );
};

const getApiCallBreakdown = (msg: { apiCallCount?: number; plannerApiCallCount?: number; workerApiCallCount?: number }) => {
  const total = msg.apiCallCount || 0;
  const hasBreakdown = typeof msg.plannerApiCallCount === 'number' || typeof msg.workerApiCallCount === 'number';
  return {
    total,
    planner: msg.plannerApiCallCount || 0,
    worker: msg.workerApiCallCount || 0,
    hasBreakdown,
  };
};

const getTokenUsageBreakdown = (msg: { tokenUsage?: TokenUsageSummary; plannerTokenUsage?: TokenUsageSummary; workerTokenUsage?: TokenUsageSummary }) => ({
  total: msg.tokenUsage,
  planner: msg.plannerTokenUsage,
  worker: msg.workerTokenUsage,
});

const filterModelsForProvider = (providerConfig: ProviderConfig, models: string[]) => {
  if (providerConfig.provider === 'openai') return models;
  if (providerConfig.provider === 'anthropic') return models.filter(m => m.includes('claude-'));
  if (providerConfig.provider === 'google') return models.filter(m => m.includes('gemini-'));
  return models;
};

interface SettingsHostProps {
  children: ReactNode;
  buttonStyle: CSSProperties;
  providerConfigs: ProviderConfig[];
  modelsByConfigId: Record<string, string[]>;
  loadingModelsByConfigId: Record<string, boolean>;
  activeProviderConfigId: string;
  onApplySettings: (settings: AppSettingsValues) => void;
  plannerProviderConfigId: string;
  plannerModel: string;
  workerProviderConfigId: string;
  workerModel: string;
  maxSteps: number;
  showHiddenFiles: boolean;
  handleOAuthLogin: () => Promise<string | null>;
  onOpenDebugTrace?: () => void;
}

const SettingsHost = ({
  children,
  buttonStyle,
  providerConfigs,
  modelsByConfigId,
  loadingModelsByConfigId,
  activeProviderConfigId,
  onApplySettings,
  plannerProviderConfigId,
  plannerModel,
  workerProviderConfigId,
  workerModel,
  maxSteps,
  showHiddenFiles,
  handleOAuthLogin,
  onOpenDebugTrace,
}: SettingsHostProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('auth');

  return (
    <>
      <button onClick={() => setIsOpen(true)} style={buttonStyle}>
        {children}
      </button>
      {isOpen && (
        <SettingsModal
          onClose={() => setIsOpen(false)}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          providerConfigs={providerConfigs}
          modelsByConfigId={modelsByConfigId}
          loadingModelsByConfigId={loadingModelsByConfigId}
          activeProviderConfigId={activeProviderConfigId}
          onApplySettings={onApplySettings}
          plannerProviderConfigId={plannerProviderConfigId}
          plannerModel={plannerModel}
          workerProviderConfigId={workerProviderConfigId}
          workerModel={workerModel}
          maxSteps={maxSteps}
          showHiddenFiles={showHiddenFiles}
          handleOAuthLogin={handleOAuthLogin}
          onOpenDebugTrace={onOpenDebugTrace}
        />
      )}
    </>
  );
};

function App() {
  // ─── Config & Provider ───────────────────────────────────────────
  const config = useAppConfig();
  const {
    providerConfigs,
    activeProviderConfigId,
    activeProviderConfig,
    plannerProviderConfigId,
    setPlannerProviderConfigId,
    workerProviderConfigId,
    setWorkerProviderConfigId,
    applySettings,
    plannerModel, setPlannerModel,
    workerModel, setWorkerModel,
    maxSteps,
    showHiddenFiles,
    lastWorkspacePath,
    isGlobalLoaded,
    saveWorkspacePath,
  } = config;
  const handleOpenDebugTrace = useCallback(() => {
    window.ipcRenderer?.invoke('debug-trace:open-window').catch(console.error);
  }, []);

  const getProviderRuntime = useCallback((providerConfig: ProviderConfig, modelName = '') => {
    let tokenOrKey = providerConfig.apiKey;
    let currentBaseUrl = providerConfig.baseUrl || '';
    let activeProtocol = 'openai';
    let authMethodForBackend = 'openai';

    if (providerConfig.provider === 'anthropic') {
      activeProtocol = 'anthropic';
      authMethodForBackend = 'anthropic';
    } else if (providerConfig.provider === 'google') {
      const googleAuthMethod = providerConfig.googleAuthMethod || 'oauth';
      tokenOrKey = googleAuthMethod === 'oauth'
        ? providerConfig.googleOauthToken || ''
        : providerConfig.apiKey;
      activeProtocol = 'google';
      authMethodForBackend = googleAuthMethod === 'oauth' ? 'google-oauth' : 'google-key';
    }

    if (currentBaseUrl.endsWith('/chat/completions')) currentBaseUrl = currentBaseUrl.replace('/chat/completions', '');
    if (currentBaseUrl.endsWith('/')) currentBaseUrl = currentBaseUrl.slice(0, -1);

    const runtime = {
      config: providerConfig,
      tokenOrKey,
      currentBaseUrl,
      activeProtocol,
      authMethodForBackend,
    };

    const converterPluginId = modelName && providerConfig.modelConverterOverrides?.[modelName]
      ? providerConfig.modelConverterOverrides[modelName]
      : providerConfig.converterPluginId || NO_CONVERTER_PLUGIN_ID;

    return applyConverterPlugin(converterPluginId, runtime);
  }, []);

  const plannerProviderConfig = useMemo(() => (
    providerConfigs.find(providerConfig => providerConfig.id === plannerProviderConfigId) || activeProviderConfig
  ), [activeProviderConfig, plannerProviderConfigId, providerConfigs]);

  const workerProviderConfig = useMemo(() => (
    providerConfigs.find(providerConfig => providerConfig.id === workerProviderConfigId) || activeProviderConfig
  ), [activeProviderConfig, providerConfigs, workerProviderConfigId]);

  const [modelsByConfigId, setModelsByConfigId] = useState<Record<string, string[]>>({});
  const [loadingModelsByConfigId, setLoadingModelsByConfigId] = useState<Record<string, boolean>>({});

  const plannerAvailableModels = modelsByConfigId[plannerProviderConfig.id] || [];
  const workerAvailableModels = modelsByConfigId[workerProviderConfig.id] || [];

  // ─── Workspace & File Tree ────────────────────────────────────────
  const workspace = useWorkspace(showHiddenFiles);
  const {
    workspacePath,
    setWorkspacePath,
    fileTree, setFileTree,
    openTabs, setOpenTabs,
    activeTab, setActiveTab,
    contextMenu, setContextMenu,
    editingNode,
    refreshFileTree,
    handleOpenWorkspace,
    handleContextMenuAction,
    handleEditComplete,
  } = workspace;

  // ─── Bridge: restore last workspace on startup ────────────────────
  useEffect(() => {
    if (isGlobalLoaded && lastWorkspacePath && !workspacePath) {
      setWorkspacePath(lastWorkspacePath);
    }
  }, [isGlobalLoaded, lastWorkspacePath]);

  // ─── Bridge: persist workspace path to global config ─────────────
  useEffect(() => {
    if (workspacePath) saveWorkspacePath(workspacePath);
  }, [workspacePath]);

  // ─── Conversations ────────────────────────────────────────────────
  const conv = useConversations(workspacePath);
  const {
    conversations, setConversations,
    currentConversationId, setCurrentConversationId,
    messages, setMessages,
    isHistoryOpen, setIsHistoryOpen,
    handleNewChat,
  } = conv;

  // ─── File Editor ──────────────────────────────────────────────────
  const [statusNow, setStatusNow] = useState(Date.now());
  const hasActiveModelWait = useMemo(
    () => messages.some(m => !m.isComplete && !!m.modelWaitStartedAt),
    [messages]
  );

  useEffect(() => {
    if (!hasActiveModelWait) return;
    setStatusNow(Date.now());
    const timer = window.setInterval(() => setStatusNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveModelWait]);

  const editor = useFileEditor(setOpenTabs, setActiveTab);
  const {
    activeFileContent, setActiveFileContent,
    editorRef,
    diffState, setDiffState,
  } = editor;

  // ─── Chat Scroll ──────────────────────────────────────────────────
  const scroll = useChatScroll(messages);
  const {
    chatContainerRef,
    showScrollBtn,
    handleChatScroll,
    scrollToBottom,
    resetScrollPosition,
    markUserScrollIntent,
    userScrolledUp,
  } = scroll;

  const messageItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [messageExceedsViewport, setMessageExceedsViewport] = useState<Record<string, boolean>>({});

  const setMessageItemRef = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) {
      messageItemRefs.current.set(id, element);
    } else {
      messageItemRefs.current.delete(id);
    }
  }, []);

  const measureMessageHeights = useCallback(() => {
    const chatHeight = chatContainerRef.current?.clientHeight ?? 0;
    if (!chatHeight) return;

    const next: Record<string, boolean> = {};
    messageItemRefs.current.forEach((element, id) => {
      next[id] = element.scrollHeight > chatHeight;
    });

    setMessageExceedsViewport(prev => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && nextKeys.every(key => prev[key] === next[key])) {
        return prev;
      }
      return next;
    });
  }, [chatContainerRef]);

  useEffect(() => {
    const frame = requestAnimationFrame(measureMessageHeights);
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(measureMessageHeights)
      : null;

    if (chatContainerRef.current && resizeObserver) {
      resizeObserver.observe(chatContainerRef.current);
    }
    if (resizeObserver) {
      messageItemRefs.current.forEach(element => resizeObserver.observe(element));
    }
    window.addEventListener('resize', measureMessageHeights);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureMessageHeights);
    };
  }, [messages, measureMessageHeights, chatContainerRef]);

  // ─── Resizers ─────────────────────────────────────────────────────
  const { startResizing: startResizingSidebar } = useResizer(250, 'right', '--sidebar-width');
  const { startResizing: startResizingChat } = useResizer(400, 'left', '--chat-width');
  const { startResizing: startResizingTerminal } = useResizer(200, 'top', '--terminal-height');

  // ─── Local UI State ───────────────────────────────────────────────
  const [terminalLogs, setTerminalLogs] = useState('');
  const [runningRunIds, setRunningRunIds] = useState<string[]>([]);
  const runningRunIdsRef = useRef<Set<string>>(new Set());
  const activeRunIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalUserScrolledUp = useRef(false);
  const hasIncompleteAiMessage = useMemo(
    () => messages.some(m => m.role === 'ai' && !m.isComplete),
    [messages]
  );
  const isRunning = runningRunIds.length > 0 || hasIncompleteAiMessage;

  const markRunActive = useCallback((runId: string) => {
    runningRunIdsRef.current.add(runId);
    setRunningRunIds(Array.from(runningRunIdsRef.current));
  }, []);

  const markRunInactive = useCallback((runId: string) => {
    runningRunIdsRef.current.delete(runId);
    setRunningRunIds(Array.from(runningRunIdsRef.current));
  }, []);

  const markFinalSummaryRevealed = useCallback((messageId: string) => {
    setMessages(prev => prev.map(message => (
      message.id === messageId && message.finalSummaryRevealing
        ? { ...message, finalSummaryRevealing: false }
        : message
    )));
  }, [setMessages]);

  // ─── Terminal auto-scroll ─────────────────────────────────────────
  const handleTerminalScroll = useCallback(() => {
    const container = terminalContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    terminalUserScrolledUp.current = distFromBottom > 120;
  }, []);

  const scrollTerminalToBottom = useCallback(() => {
    const container = terminalContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, []);

  useEffect(() => {
    if (terminalUserScrolledUp.current) return;

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      scrollTerminalToBottom();
      secondFrame = requestAnimationFrame(scrollTerminalToBottom);
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [scrollTerminalToBottom, terminalLogs]);

  // ─── Auto-scroll active tab into view ────────────────────────────
  useEffect(() => {
    if (activeTab) {
      setTimeout(() => {
        const el = document.querySelector('.tab-bar .tab.active');
        if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      }, 50);
    }
  }, [activeTab]);

  // ─── Active file reload when tab changes ─────────────────────────
  useEffect(() => {
    if (!activeTab) { setActiveFileContent('// Select a file to view code'); return; }
    const loadContent = async () => {
      try {
        // @ts-ignore
        const content = await window.ipcRenderer.invoke('agent:read-file', { filePath: activeTab });
        setActiveFileContent(content);
      } catch (e) { setActiveFileContent('// Error reading file'); }
    };
    loadContent();
    const handleActiveFileUpdate = (_event: any, data: any) => {
      if (data.filePath === activeTab || data.filePath.endsWith(activeTab)) {
        if (data.isEdit && data.oldContent && data.newContent) {
          setDiffState({ original: data.oldContent, modified: data.newContent, startLine: data.startLine });
          setTimeout(() => setDiffState(null), 5000);
        }
        loadContent();
      }
    };
    // @ts-ignore
    window.ipcRenderer.on('agent:file-updated', handleActiveFileUpdate);
    return () => {
      // @ts-ignore
      window.ipcRenderer.removeListener('agent:file-updated', handleActiveFileUpdate);
    };
  }, [activeTab]);

  // ─── IPC: Agent update stream → messages ─────────────────────────
  useEffect(() => {
    // @ts-ignore
    if (typeof window.ipcRenderer === 'undefined') { console.error('ipcRenderer unavailable'); return; }
    const listener = (_event: any, data: any) => {
      if (data.runId && !runningRunIdsRef.current.has(data.runId)) {
        return;
      }
      if (data.type === 'fs-state') {
        setFileTree(Array.isArray(data.data) ? data.data : []);
        return;
      }
      setMessages(prev => {
        const newMessages = [...prev];
        if (newMessages.length === 0) return prev;
        let targetIdx = newMessages.length - 1;
        if (data.runId) {
          const idx = newMessages.findIndex(m => m.id === data.runId);
          if (idx === -1) return prev;
          targetIdx = idx;
        }
        const targetMsg = { ...newMessages[targetIdx] };
        if (targetMsg.role !== 'ai') return prev;
        if (targetMsg.isComplete && data.type !== 'token-usage') return prev;
        if (data.type === 'status') {
          targetMsg.statusLogs = [...targetMsg.statusLogs, data.data];
          targetMsg.modelWaitStartedAt = null;
        } else if (data.type === 'model-wait-start') {
          targetMsg.statusLogs = [...targetMsg.statusLogs, MODEL_WAIT_STATUS];
          targetMsg.modelWaitStartedAt = Date.now();
        } else if (data.type === 'plan') {
          targetMsg.modelWaitStartedAt = null;
          targetMsg.plan = data.data;
          const summaryText = data.data && typeof data.data.summary === 'string' ? data.data.summary : (typeof data.data === 'string' ? data.data : JSON.stringify(data.data));
          const planText = summaryText.split('\n').map((l: string) => `> ${l}`).join('\n');
          targetMsg.content += `### 📋 Orchestrator Plan\n${planText}\n\n`;
        } else if (data.type === 'subtask-result') {
          targetMsg.modelWaitStartedAt = null;
          targetMsg.streamContent = '';
          const resultStr = typeof data.data === 'string' ? data.data : JSON.stringify(data.data || '');
          const resultText = resultStr.split('\n').map((l: string) => `> ${l}`).join('\n');
          targetMsg.content += `### 🤖 Task Result\n${resultText}\n\n`;
        } else if (data.type === 'final-stream') {
          const delta = typeof data.data?.delta === 'string' ? data.data.delta : '';
          if (delta) {
            targetMsg.streamContent = `${targetMsg.streamContent || ''}${delta}`;
            targetMsg.modelWaitStartedAt = null;
          }
        } else if (data.type === 'final-stream-reset') {
          targetMsg.streamContent = '';
        } else if (data.type === 'plan-session-stream') {
          const delta = typeof data.data?.delta === 'string' ? data.data.delta : '';
          if (delta) {
            const currentSession = targetMsg.planSession || {
              status: 'needs_input' as const,
              assistantMessage: '',
              questions: [],
              draftPlan: null,
              finalPlan: null,
            };
            targetMsg.planSession = {
              ...currentSession,
              assistantMessage: `${currentSession.assistantMessage || ''}${delta}`,
            };
            targetMsg.modelWaitStartedAt = null;
          }
        } else if (data.type === 'plan-session-stream-reset') {
          if (targetMsg.planSession) {
            targetMsg.planSession = {
              ...targetMsg.planSession,
              assistantMessage: '',
            };
          }
        } else if (data.type === 'final-result') {
          targetMsg.modelWaitStartedAt = null;
          const resultPayload = data.data;
          const resultStr = resultPayload && typeof resultPayload === 'object' && typeof resultPayload.text === 'string'
            ? resultPayload.text
            : typeof resultPayload === 'string'
              ? resultPayload
              : JSON.stringify(resultPayload || '');
          const streamedText = targetMsg.streamContent || '';
          targetMsg.streamContent = '';
          targetMsg.finalSummary = resultStr;
          targetMsg.finalSummaryMode = resultPayload && typeof resultPayload === 'object' && resultPayload.mode === 'conversation'
            ? 'conversation'
            : 'summary';
          targetMsg.finalSummaryRevealing = streamedText.trim() !== resultStr.trim();
        } else if (data.type === 'api-call') {
          targetMsg.apiCallCount = (targetMsg.apiCallCount || 0) + 1;
          if (data.data === 'planner') {
            targetMsg.plannerApiCallCount = (targetMsg.plannerApiCallCount || 0) + 1;
          } else if (data.data === 'worker') {
            targetMsg.workerApiCallCount = (targetMsg.workerApiCallCount || 0) + 1;
          }
        } else if (data.type === 'token-usage') {
          const usage = data.data?.usage;
          const source = data.data?.source;
          if (tokenUsageHasValues(usage)) {
            targetMsg.tokenUsage = addTokenUsage(targetMsg.tokenUsage, usage);
            if (source === 'worker') {
              targetMsg.workerTokenUsage = addTokenUsage(targetMsg.workerTokenUsage, usage);
            } else {
              targetMsg.plannerTokenUsage = addTokenUsage(targetMsg.plannerTokenUsage, usage);
            }
          }
        } else if (data.type === 'agent-step') {
          targetMsg.modelWaitStartedAt = null;
          targetMsg.agentSteps = [...(targetMsg.agentSteps || []), data.data];
        } else if (data.type === 'model-stream') {
          const delta = typeof data.data?.delta === 'string' ? data.data.delta : '';
          if (delta) {
            targetMsg.streamContent = `${targetMsg.streamContent || ''}${delta}`;
            targetMsg.modelWaitStartedAt = null;
          }
        }
        newMessages[targetIdx] = targetMsg;
        return newMessages;
      });
    };
    const logListener = (_event: any, data: string | { runId?: string; log?: string }) => {
      if (typeof data === 'object' && data?.runId && !runningRunIdsRef.current.has(data.runId)) {
        return;
      }
      const log = typeof data === 'string' ? data : data?.log;
      if (log) setTerminalLogs(prev => prev + log);
    };
    // @ts-ignore
    window.ipcRenderer.removeAllListeners('agent:update');
    // @ts-ignore
    window.ipcRenderer.removeAllListeners('agent:terminal-log');
    // @ts-ignore
    window.ipcRenderer.on('agent:update', listener);
    // @ts-ignore
    window.ipcRenderer.on('agent:terminal-log', logListener);
    return () => {
      // @ts-ignore
      window.ipcRenderer.removeAllListeners('agent:update');
      // @ts-ignore
      window.ipcRenderer.removeAllListeners('agent:terminal-log');
    };
  }, []);

  // ─── Fetch available models ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const configsToLoad = providerConfigs.filter((providerConfig, index, arr) => (
      arr.findIndex(item => item.id === providerConfig.id) === index
    ));

    const fetchModels = async (providerConfig: ProviderConfig) => {
      const { tokenOrKey, currentBaseUrl, activeProtocol, authMethodForBackend } = getProviderRuntime(providerConfig);
      if (!tokenOrKey) {
        setModelsByConfigId(prev => ({ ...prev, [providerConfig.id]: [] }));
        setLoadingModelsByConfigId(prev => ({ ...prev, [providerConfig.id]: false }));
        return;
      }

      setLoadingModelsByConfigId(prev => ({ ...prev, [providerConfig.id]: true }));
      try {
        // @ts-ignore
        const models: string[] = await window.ipcRenderer.invoke('agent:get-models', { protocol: activeProtocol, authMethod: authMethodForBackend, tokenOrKey, baseUrl: currentBaseUrl });
        if (cancelled) return;
        const filtered = filterModelsForProvider(providerConfig, models);
        setModelsByConfigId(prev => ({ ...prev, [providerConfig.id]: filtered.length > 0 ? filtered : models }));
      } catch (err: any) {
        if (cancelled) return;
        console.error(err);
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: `⚠️ **[System Error]** Failed to fetch models: ${err.message}`, statusLogs: [], agentSteps: [], apiCallCount: 0, plannerApiCallCount: 0, workerApiCallCount: 0, isComplete: true }]);
      } finally {
        if (!cancelled) {
          setLoadingModelsByConfigId(prev => ({ ...prev, [providerConfig.id]: false }));
        }
      }
    };
    const timer = window.setTimeout(() => {
      configsToLoad.forEach(providerConfig => {
        fetchModels(providerConfig);
      });
    }, 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [getProviderRuntime, providerConfigs, setMessages]);

  useEffect(() => {
    if (plannerAvailableModels.length > 0 && (!plannerModel || !plannerAvailableModels.includes(plannerModel))) {
      setPlannerModel(plannerAvailableModels[0]);
    }
  }, [plannerAvailableModels, plannerModel, setPlannerModel]);

  useEffect(() => {
    if (workerAvailableModels.length > 0 && (!workerModel || !workerAvailableModels.includes(workerModel))) {
      setWorkerModel(workerAvailableModels[workerAvailableModels.length - 1] || workerAvailableModels[0]);
    }
  }, [setWorkerModel, workerAvailableModels, workerModel]);

  // ─── OAuth ────────────────────────────────────────────────────────
  const addSystemMsg = (content: string) =>
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content, statusLogs: [], agentSteps: [], apiCallCount: 0, plannerApiCallCount: 0, workerApiCallCount: 0, isComplete: true }]);

  const handleOAuthLogin = async () => {
    try {
      addSystemMsg('[System] Opening browser for Google OAuth login...');
      // @ts-ignore
      const token = await window.ipcRenderer.invoke('agent:login-oauth');
      addSystemMsg('[System] Google OAuth login successful!');
      return typeof token === 'string' ? token : null;
    } catch (err: any) { addSystemMsg(`[System Error] OAuth login failed: ${err.message}`); }
    return null;
  };

  // ─── Send message ─────────────────────────────────────────────────
  const handleSend = async (
    userTask: string,
    options: {
      approvedPlan?: PlanDraft;
      appendUserMessage?: boolean;
      initialStatus?: string;
      onStarted?: () => void;
    } = {}
  ) => {
    if (!userTask.trim()) return false;
    if (runningRunIdsRef.current.size > 0 || hasIncompleteAiMessage) return false;
    const plannerRuntime = getProviderRuntime(plannerProviderConfig, plannerModel);
    const workerRuntime = getProviderRuntime(workerProviderConfig, workerModel);
    if (!plannerRuntime.tokenOrKey) { alert(`Please configure credentials for ${plannerProviderConfig.name} first!`); return false; }
    if (!workerRuntime.tokenOrKey) { alert(`Please configure credentials for ${workerProviderConfig.name} first!`); return false; }

    const newAiMsgId = crypto.randomUUID();
    activeRunIdRef.current = newAiMsgId;
    markRunActive(newAiMsgId);
    resetScrollPosition();
    terminalUserScrolledUp.current = false;
    scrollTerminalToBottom();
    options.onStarted?.();
    const appendUserMessage = options.appendUserMessage !== false;
    setMessages(prev => [
      ...prev,
      ...(appendUserMessage ? [{ id: crypto.randomUUID(), role: 'user' as const, content: userTask, statusLogs: [], agentSteps: [], apiCallCount: 0, plannerApiCallCount: 0, workerApiCallCount: 0, isComplete: true }] : []),
      { id: newAiMsgId, role: 'ai', content: '', statusLogs: [options.initialStatus || 'Initializing Agent...'], agentSteps: [], apiCallCount: 0, plannerApiCallCount: 0, workerApiCallCount: 0, isComplete: false }
    ]);

    const chatHistory = buildChatHistory(messages);

    // @ts-ignore
    if (typeof window.ipcRenderer === 'undefined') {
      setMessages(prev => {
        const n = [...prev];
        const idx = n.findIndex(m => m.id === newAiMsgId);
        if (idx === -1) return prev;
        n[idx] = { ...n[idx], content: '[Error] ipcRenderer is not available.', isComplete: true, modelWaitStartedAt: null };
        return n;
      });
      if (activeRunIdRef.current === newAiMsgId) activeRunIdRef.current = null;
      markRunInactive(newAiMsgId);
      return false;
    }
    try {
      // @ts-ignore
      const result = await window.ipcRenderer.invoke('agent:run-task', {
        protocol: plannerRuntime.activeProtocol,
        authMethod: plannerRuntime.authMethodForBackend,
        tokenOrKey: plannerRuntime.tokenOrKey,
        baseUrl: plannerRuntime.currentBaseUrl,
        plannerConfig: {
          protocol: plannerRuntime.activeProtocol,
          authMethod: plannerRuntime.authMethodForBackend,
          tokenOrKey: plannerRuntime.tokenOrKey,
          baseUrl: plannerRuntime.currentBaseUrl,
        },
        workerConfig: {
          protocol: workerRuntime.activeProtocol,
          authMethod: workerRuntime.authMethodForBackend,
          tokenOrKey: workerRuntime.tokenOrKey,
          baseUrl: workerRuntime.currentBaseUrl,
        },
        plannerModel,
        workerModel,
        maxSteps,
        task: userTask,
        workspacePath,
        chatHistory,
        runId: newAiMsgId,
        approvedPlan: options.approvedPlan,
      });
      setMessages(prev => {
        const n = [...prev];
        const idx = n.findIndex(m => m.id === newAiMsgId);
        if (idx === -1) return prev;
        const target = { ...n[idx] };
        if (target.isComplete) return prev;
        target.isComplete = true;
        target.modelWaitStartedAt = null;
        target.streamContent = '';
        const returnedFinalResult = result && typeof result === 'object' && typeof result.finalResult === 'string'
          ? result.finalResult
          : '';
        if (typeof result === 'string' && result.startsWith('Error:')) {
          target.content += `\n\n**[Error]**\n${result}`;
        } else if (returnedFinalResult && !target.finalSummary) {
          target.finalSummary = returnedFinalResult;
          target.finalSummaryMode = 'summary';
          target.finalSummaryRevealing = true;
        }
        n[idx] = target;
        return n;
      });
    } catch (e: any) {
      setMessages(prev => {
        const n = [...prev];
        const idx = n.findIndex(m => m.id === newAiMsgId);
        if (idx === -1) return prev;
        const target = { ...n[idx] };
        if (target.isComplete) return prev;
        target.isComplete = true;
        target.modelWaitStartedAt = null;
        target.streamContent = '';
        target.content += `\n\n**[Error]**\n${e.message}`;
        n[idx] = target;
        return n;
      });
    } finally {
      if (activeRunIdRef.current === newAiMsgId) {
        activeRunIdRef.current = null;
      }
      markRunInactive(newAiMsgId);
    }
    return true;
  };

  const updateAiMessage = (messageId: string, updater: (message: Message) => Message) => {
    setMessages(prev => {
      const next = [...prev];
      const idx = next.findIndex(message => message.id === messageId);
      if (idx === -1) return prev;
      const target = next[idx];
      if (target.role !== 'ai') return prev;
      next[idx] = updater(target);
      return next;
    });
  };

  const startPlanRun = (runId: string) => {
    activeRunIdRef.current = runId;
    markRunActive(runId);
    resetScrollPosition();
    terminalUserScrolledUp.current = false;
    scrollTerminalToBottom();
  };

  const finishPlanRun = (runId: string) => {
    if (activeRunIdRef.current === runId) {
      activeRunIdRef.current = null;
    }
    markRunInactive(runId);
  };

  const createPlanAiMessage = (
    id: string,
    userRequest: string,
    planHistory: PlanSessionTurn[],
    status: string
  ): Message => ({
    id,
    role: 'ai',
    content: '',
    statusLogs: [status],
    agentSteps: [],
    apiCallCount: 0,
    plannerApiCallCount: 0,
    workerApiCallCount: 0,
    isComplete: false,
    planModeRequest: userRequest,
    planSessionHistory: planHistory,
  });

  const runPlanSessionStep = async (params: {
    runId: string;
    userRequest: string;
    planHistory: PlanSessionTurn[];
    userReply?: string;
    chatHistory: ReturnType<typeof buildChatHistory>;
  }) => {
    const plannerRuntime = getProviderRuntime(plannerProviderConfig, plannerModel);
    if (!plannerRuntime.tokenOrKey) {
      alert(`Please configure credentials for ${plannerProviderConfig.name} first!`);
      finishPlanRun(params.runId);
      return;
    }

    if (typeof window.ipcRenderer === 'undefined') {
      updateAiMessage(params.runId, message => {
        if (message.isComplete) return message;
        return {
          ...message,
          content: '[Error] ipcRenderer is not available.',
          isComplete: true,
          modelWaitStartedAt: null,
        };
      });
      finishPlanRun(params.runId);
      return;
    }

    try {
      const result = await window.ipcRenderer.invoke('agent:plan-session-step', {
        protocol: plannerRuntime.activeProtocol,
        authMethod: plannerRuntime.authMethodForBackend,
        tokenOrKey: plannerRuntime.tokenOrKey,
        baseUrl: plannerRuntime.currentBaseUrl,
        plannerConfig: {
          protocol: plannerRuntime.activeProtocol,
          authMethod: plannerRuntime.authMethodForBackend,
          tokenOrKey: plannerRuntime.tokenOrKey,
          baseUrl: plannerRuntime.currentBaseUrl,
        },
        plannerModel,
        userRequest: params.userRequest,
        workspacePath,
        chatHistory: params.chatHistory,
        planHistory: params.planHistory,
        userReply: params.userReply,
        runId: params.runId,
      });

      if (!result || typeof result !== 'object' || !('status' in result)) {
        throw new Error(typeof result === 'string' ? result : 'Plan mode returned an invalid response.');
      }

      updateAiMessage(params.runId, message => {
        if (message.isComplete) return message;
        return {
          ...message,
          planSession: result as PlanSessionState,
          planSessionHistory: params.planHistory,
          isComplete: true,
          statusLogs: [],
          modelWaitStartedAt: null,
        };
      });
    } catch (e: any) {
      updateAiMessage(params.runId, message => {
        if (message.isComplete) return message;
        return {
          ...message,
          isComplete: true,
          modelWaitStartedAt: null,
          content: `${message.content}\n\n**[Plan Mode Error]**\n${e.message}`,
        };
      });
    } finally {
      finishPlanRun(params.runId);
    }
  };

  const handlePlanSend = async (userTask: string) => {
    const normalizedTask = userTask.trim();
    if (!normalizedTask) return;
    if (runningRunIdsRef.current.size > 0 || hasIncompleteAiMessage) return;

    const plannerRuntime = getProviderRuntime(plannerProviderConfig, plannerModel);
    if (!plannerRuntime.tokenOrKey) { alert(`Please configure credentials for ${plannerProviderConfig.name} first!`); return; }

    const runId = crypto.randomUUID();
    const planHistory: PlanSessionTurn[] = [{ role: 'user', content: normalizedTask }];
    const chatHistory = buildChatHistory(messages);

    startPlanRun(runId);
    setMessages(prev => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: normalizedTask, statusLogs: [], agentSteps: [], apiCallCount: 0, plannerApiCallCount: 0, workerApiCallCount: 0, isComplete: true },
      createPlanAiMessage(runId, normalizedTask, planHistory, 'Plan Mode: preparing plan...'),
    ]);

    await runPlanSessionStep({
      runId,
      userRequest: normalizedTask,
      planHistory,
      chatHistory,
    });
  };

  const handlePlanAnswer = async (messageId: string, answer: string) => {
    const sourceMessage = messages.find(message => message.id === messageId);
    const sourceSession = sourceMessage?.planSession;
    const userRequest = sourceMessage?.planModeRequest;
    const normalizedAnswer = answer.trim();
    if (!sourceMessage || !sourceSession || !userRequest || !normalizedAnswer) return;
    if (runningRunIdsRef.current.size > 0 || hasIncompleteAiMessage) return;

    const plannerRuntime = getProviderRuntime(plannerProviderConfig, plannerModel);
    if (!plannerRuntime.tokenOrKey) { alert(`Please configure credentials for ${plannerProviderConfig.name} first!`); return; }

    const runId = crypto.randomUUID();
    const planHistory: PlanSessionTurn[] = [
      ...(sourceMessage.planSessionHistory || []),
      { role: 'assistant', content: formatPlanSessionForHistory(sourceSession) },
      { role: 'user', content: normalizedAnswer },
    ];
    const chatHistory = buildChatHistory(messages);

    startPlanRun(runId);
    setMessages(prev => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: normalizedAnswer, statusLogs: [], agentSteps: [], apiCallCount: 0, plannerApiCallCount: 0, workerApiCallCount: 0, isComplete: true },
      createPlanAiMessage(runId, userRequest, planHistory, 'Plan Mode: updating plan...'),
    ]);

    await runPlanSessionStep({
      runId,
      userRequest,
      planHistory,
      userReply: normalizedAnswer,
      chatHistory,
    });
  };

  const handleExecutePlan = async (messageId: string) => {
    const sourceMessage = messages.find(message => message.id === messageId);
    const approvedPlan = sourceMessage?.planSession?.finalPlan;
    const userRequest = sourceMessage?.planModeRequest || approvedPlan?.title || '';
    if (!sourceMessage || !approvedPlan || !userRequest) return false;

    return await handleSend(userRequest, {
      approvedPlan,
      appendUserMessage: false,
      initialStatus: 'Executing approved plan...',
      onStarted: () => {
        updateAiMessage(messageId, message => ({
          ...message,
          planExecutionStarted: true,
        }));
      },
    });
  };

  const handleStop = () => {
    const targetIds = new Set<string>(runningRunIdsRef.current);
    if (activeRunIdRef.current) targetIds.add(activeRunIdRef.current);
    messages.forEach(message => {
      if (message.role === 'ai' && !message.isComplete) {
        targetIds.add(message.id);
      }
    });

    if (targetIds.size === 0) return;

    targetIds.forEach(runId => {
      (window as any).ipcRenderer?.invoke('agent:stop-task', { runId }).catch(console.error);
      markRunInactive(runId);
    });
    if (activeRunIdRef.current && targetIds.has(activeRunIdRef.current)) {
      activeRunIdRef.current = null;
    }

    setMessages(prev => {
      let changed = false;
      const next = prev.map(message => {
        if (message.role !== 'ai' || message.isComplete || !targetIds.has(message.id)) {
          return message;
        }
        changed = true;
        return {
          ...message,
          isComplete: true,
          modelWaitStartedAt: null,
          content: (message.content || '') + '\n\n*[Stopped by user]*',
        };
      });
      return changed ? next : prev;
    });
  };

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <>
    {workspacePath ? (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar" style={{ width: 'var(--sidebar-width)', flexShrink: 0 }}>
        <div className="sidebar-header" style={{display:'flex', justifyContent: 'space-between', alignItems: 'center'}}>
           <div style={{fontWeight: 'bold'}}>Dual-Engine Agent</div>
           <SettingsHost
             buttonStyle={{background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px'}}
             providerConfigs={providerConfigs}
             modelsByConfigId={modelsByConfigId}
             loadingModelsByConfigId={loadingModelsByConfigId}
             activeProviderConfigId={activeProviderConfigId}
             onApplySettings={applySettings}
             plannerProviderConfigId={plannerProviderConfig.id}
             plannerModel={plannerModel}
             workerProviderConfigId={workerProviderConfig.id}
             workerModel={workerModel}
             maxSteps={maxSteps}
             showHiddenFiles={showHiddenFiles}
             handleOAuthLogin={handleOAuthLogin}
             onOpenDebugTrace={handleOpenDebugTrace}
           >
             ⚙️ Settings
           </SettingsHost>
        </div>
        <div className="file-tree">
          <div style={{color:'var(--text-secondary)', fontSize:'11px', marginBottom:'5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <span style={{textTransform:'uppercase'}}>Workspace</span>
            <div style={{display: 'flex', gap: '5px'}}>
              {workspacePath && (
                <button onClick={refreshFileTree} style={{padding: '2px 6px', fontSize: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'white', borderRadius: '4px', cursor: 'pointer'}} title="Refresh File Tree">🔄</button>
              )}
              <button onClick={handleOpenWorkspace} style={{padding: '2px 6px', fontSize: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'white', borderRadius: '4px', cursor: 'pointer'}}>Open Folder</button>
            </div>
          </div>
          {workspacePath && <div style={{fontSize: '10px', color: 'var(--accent)', marginBottom: '5px', wordBreak: 'break-all'}}>{workspacePath}</div>}
          {fileTree.map(node => (
            <FileTreeNode
              key={node.path}
              node={node}
              activeTab={activeTab}
              onSelect={(path) => {
                setOpenTabs(prev => (prev.includes(path) ? prev : [...prev, path]));
                setActiveTab(path);
              }}
              onContextMenu={(e, path, isDir) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, path, isDir }); }}
              editingNode={editingNode}
              onEditComplete={handleEditComplete}
              onEditCancel={() => {/* handled by workspace hook */}}
            />
          ))}
          {fileTree.length === 0 && <div className="file-item" style={{color:'var(--text-secondary)', padding: '10px'}}>No files yet. Please open a folder.</div>}
        </div>
      </div>
      <div className="resizer-horizontal" onMouseDown={startResizingSidebar} />

      {/* Editor + Terminal */}
      <div className="editor-container" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div className="editor-header" style={{ display: 'flex', backgroundColor: '#252526', borderBottom: '1px solid var(--border-color)', alignItems: 'center', width: '100%', overflow: 'hidden' }}>
          <div className="tab-bar" style={{ display: 'flex', overflowX: 'auto', flex: 1, borderBottom: 'none', minWidth: 0, paddingRight: '8px' }}>
            {openTabs.map(tab => {
              const isTabActive = tab === activeTab;
              return (
                <div key={tab} className={`tab ${isTabActive ? 'active' : ''}`} onClick={() => { setActiveTab(tab); setDiffState(null); }}>
                  <span>{tab.split(/[/\\]/).pop()}</span>
                  <span className="tab-close" onClick={(e) => {
                    e.stopPropagation();
                    const newTabs = openTabs.filter(t => t !== tab);
                    setOpenTabs(newTabs);
                    if (isTabActive) setActiveTab(newTabs.length > 0 ? newTabs[newTabs.length - 1] : '');
                  }}>×</span>
                </div>
              );
            })}
          </div>
          {activeTab && activeTab.endsWith('.html') && (
            <button
              onClick={() => { (window as any).ipcRenderer.invoke('agent:open-browser-window', { url: `file://${activeTab}` }); }}
              title="Preview this HTML file in a new window"
              style={{ background: 'var(--accent)', color: 'white', border: 'none', padding: '4px 12px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', marginRight: '8px', flexShrink: 0 }}
            >🌐 Preview</button>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {diffState ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px', background: '#252526', borderBottom: '1px solid #3c3c3c', fontSize: '11px', color: '#aaa', flexShrink: 0 }}>
                <span style={{ color: '#4CAF50' }}>＋</span>
                <span style={{ color: '#F44336' }}>－</span>
                <span>Diff View (Side-by-Side)</span>
                <button onClick={() => setDiffState(null)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #3c3c3c', color: '#aaa', borderRadius: '4px', cursor: 'pointer', padding: '2px 8px', fontSize: '11px' }}>✕ Close Diff</button>
              </div>
              <DiffEditor
                key={`${activeTab}:${diffState.startLine || 1}:${diffState.modified.length}`}
                height="100%"
                language="javascript"
                theme="vs-dark"
                original={diffState.original}
                modified={diffState.modified}
                options={{ readOnly: true, renderSideBySide: true, enableSplitViewResizing: true }}
                onMount={(editor) => {
                  if (diffState.startLine) {
                    setTimeout(() => {
                      editor.getModifiedEditor().revealLineInCenter(diffState.startLine as number);
                      editor.getOriginalEditor().revealLineInCenter(diffState.startLine as number);
                    }, 100);
                  }
                }}
              />
            </>
          ) : (
            <Editor
              height="100%"
              defaultLanguage="javascript"
              theme="vs-dark"
              value={activeFileContent}
              onMount={(editor) => { editorRef.current = editor; }}
              onChange={(val) => { if (activeTab) setActiveFileContent(val || ''); }}
              options={{ minimap: { enabled: false }, fontSize: 14, wordWrap: 'on' }}
            />
          )}
        </div>
        <div className="resizer-vertical" onMouseDown={startResizingTerminal} />
        <div ref={terminalContainerRef} onScroll={handleTerminalScroll} className="terminal-container" style={{ height: 'var(--terminal-height)', backgroundColor: '#1e1e1e', color: '#cccccc', padding: '10px', overflowY: 'auto', borderTop: '1px solid var(--border-color)', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap', flexShrink: 0 }}>
          <div style={{color: '#888', marginBottom: '5px', textTransform: 'uppercase', fontSize: '10px'}}>Terminal Logs</div>
          {terminalLogs || 'Terminal ready...'}
        </div>
      </div>
      <div className="resizer-horizontal" onMouseDown={startResizingChat} />

      {/* Chat Panel */}
      <div className="chat-container" style={{ width: 'var(--chat-width)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 15px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
            <button onClick={handleNewChat} style={{ background: 'var(--accent)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>➕ New Chat</button>
            <button onClick={() => setIsHistoryOpen(true)} style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>💬 History</button>
          </div>
          <div
            className="chat-messages"
            ref={chatContainerRef}
            onScroll={handleChatScroll}
            onWheel={markUserScrollIntent}
            onPointerDown={markUserScrollIntent}
            onTouchStart={markUserScrollIntent}
            style={{ position: 'relative' }}
          >
            {messages.map((msg) => (
              <div key={msg.id} ref={(element) => setMessageItemRef(msg.id, element)} className={`message ${msg.role}`}>
                {msg.role === 'ai' && (
                  <div className="message-header" style={{display: 'flex', justifyContent: 'space-between'}}>
                    <span>Dual-Engine Agent</span>
                    <span style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {msg.apiCallCount > 0 && (() => {
                        const calls = getApiCallBreakdown(msg);
                        return <ApiCallsBadge count={calls.total} plannerCount={calls.planner} workerCount={calls.worker} showBreakdown={calls.hasBreakdown} />;
                      })()}
                      {(() => {
                        const tokens = getTokenUsageBreakdown(msg);
                        return <TokenUsageBadge usage={tokens.total} plannerUsage={tokens.planner} workerUsage={tokens.worker} />;
                      })()}
                    </span>
                  </div>
                )}

                {msg.content && !msg.isComplete && (
                  <MarkdownContent
                    content={msg.content}
                    workspacePath={workspacePath}
                    animate
                    showCaret
                  />
                )}

                {msg.content && msg.isComplete && (() => {
                  const { reasoning, finalContent } = parseReasoning(msg.content);
                  return (
                    <div className="markdown-body">
                      {reasoning && (
                        <details open style={{ marginBottom: '15px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                          <summary style={{ padding: '8px 12px', cursor: 'pointer', outline: 'none', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 'bold' }}>
                            <span>🧠</span> Thinking Process...
                          </summary>
                          <div style={{ padding: '12px', borderTop: '1px solid var(--border-color)', color: '#aaa', fontSize: '12px', whiteSpace: 'pre-wrap', fontStyle: 'italic', background: '#1e1e1e', borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px' }}>
                            {reasoning}
                          </div>
                        </details>
                      )}
                      {finalContent && (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a({node, href, children, ...props}: any) {
                              return (
                                <a href={href} {...props} onClick={(e) => {
                                  e.preventDefault();
                                  if (href) {
                                    let targetUrl = href;
                                    if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('file://')) {
                                      targetUrl = `file://${workspacePath}/${href.startsWith('/') ? href.slice(1) : href}`;
                                    }
                                    // @ts-ignore
                                    window.ipcRenderer.invoke('agent:open-browser-window', { url: targetUrl }).catch(console.error);
                                  }
                                }} style={{ cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}>
                                  {children}
                                </a>
                              );
                            },
                            code({node, inline, className, children, ...props}: any) {
                              const match = /language-(\w+)/.exec(className || '');
                              return !inline && match ? (
                                <SyntaxHighlighter {...props} children={String(children).replace(/\n$/, '')} style={vscDarkPlus} language={match[1]} PreTag="div" />
                              ) : (
                                <code {...props} className={className}>{children}</code>
                              );
                            }
                          }}
                        >
                          {finalContent}
                        </ReactMarkdown>
                      )}
                    </div>
                  );
                })()}

                {msg.plan?.subtasks?.length > 0 && (
                  <div className="plan-container">
                    <div className="plan-title">Subtasks to Execute:</div>
                    <div className="plan-subtasks">
                      {msg.plan.subtasks.map((st: any, i: number) => (
                        <div key={st.id || i} className="plan-subtask-item">
                          <div className="subtask-desc">
                            {msg.plan.subtasks.length > 1 && (
                              <>
                                <span className="subtask-num">{i + 1}.</span>{' '}
                              </>
                            )}
                            <span className="markdown-body" style={{ display: 'inline' }}>
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: 'span' }}>{st.description}</ReactMarkdown>
                            </span>
                          </div>
                          {st.expected_output && (
                            <div className="subtask-expected">
                              Expected: <span className="markdown-body" style={{ display: 'inline' }}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: 'span' }}>{st.expected_output}</ReactMarkdown></span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {msg.planModeRequest && (
                  <PlanModeView
                    session={msg.planSession}
                    isPending={!msg.isComplete}
                    executionStarted={msg.planExecutionStarted}
                    onAnswer={(answer) => handlePlanAnswer(msg.id, answer)}
                    onExecute={() => handleExecutePlan(msg.id)}
                  />
                )}

                {msg.streamContent && (
                  <MarkdownContent
                    content={msg.streamContent}
                    workspacePath={workspacePath}
                    animate
                    showCaret={!msg.isComplete}
                    charsPerStep={2}
                    stepMs={22}
                    style={{ marginTop: '10px' }}
                  />
                )}

                {msg.agentSteps?.length > 0 && (() => {
                  const mergedSteps: any[] = [];
                  for (let i = 0; i < msg.agentSteps.length; i++) {
                    const step = msg.agentSteps[i];
                    const prev = mergedSteps[mergedSteps.length - 1];
                    const stepHasActions = step.actions?.length > 0;
                    const prevHasFailure = prev?.results?.some((r: any) => r.success === false);
                    if (stepHasActions && prevHasFailure) {
                      mergedSteps[mergedSteps.length - 1] = { ...step, retryCount: (prev.retryCount || 0) + 1, retryHistory: [...(prev.retryHistory || [prev]), prev], thought: step.thought || prev.thought };
                      continue;
                    }
                    mergedSteps.push({ ...step, retryCount: 0 });
                  }
                  return (
                    <div className="agent-steps-container" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                      {mergedSteps.map((step, idx) => (
                        <AgentStepView key={idx} step={step} idx={idx} mergedSteps={mergedSteps} msg={msg} openTabs={openTabs} setOpenTabs={setOpenTabs} setActiveTab={setActiveTab} setDiffState={setDiffState} />
                      ))}
                    </div>
                  );
                })()}

                {msg.finalSummary && msg.finalSummaryMode === 'conversation' && (
                  <MarkdownContent
                    content={msg.finalSummary}
                    workspacePath={workspacePath}
                    animate={!!msg.finalSummaryRevealing}
                    showCaret={!!msg.finalSummaryRevealing}
                    charsPerStep={2}
                    stepMs={28}
                    onRevealComplete={() => markFinalSummaryRevealed(msg.id)}
                    style={{ marginTop: '10px' }}
                  />
                )}

                {msg.finalSummary && msg.finalSummaryMode !== 'conversation' && (
                  <div className="markdown-body" style={{ marginTop: '10px' }}>
                    <h3>✅ Final Summary</h3>
                    <MarkdownContent
                      content={msg.finalSummary}
                      workspacePath={workspacePath}
                      animate={!!msg.finalSummaryRevealing}
                      showCaret={!!msg.finalSummaryRevealing}
                      charsPerStep={2}
                      stepMs={28}
                      onRevealComplete={() => markFinalSummaryRevealed(msg.id)}
                    />
                  </div>
                )}

                {!msg.content && !msg.isComplete && msg.statusLogs.length === 0 && (
                  <div className="typing-indicator" style={{marginTop: '10px'}}><span/><span/><span/></div>
                )}
                {msg.statusLogs.length > 0 && !msg.isComplete && (
                  <div className="status-log" style={{ marginTop: '10px' }}>
                    {msg.modelWaitStartedAt
                      ? `${MODEL_WAIT_STATUS} (${formatElapsed(msg.modelWaitStartedAt, statusNow)})`
                      : msg.statusLogs[msg.statusLogs.length - 1]}
                    <div className="typing-indicator"><span/><span/><span/></div>
                  </div>
                )}

                {msg.role === 'ai' && messageExceedsViewport[msg.id] && (msg.apiCallCount > 0 || tokenUsageHasValues(msg.tokenUsage)) && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px', gap: '6px', flexWrap: 'wrap' }}>
                    {(() => {
                      const calls = getApiCallBreakdown(msg);
                      return msg.apiCallCount > 0 ? <ApiCallsBadge count={calls.total} plannerCount={calls.planner} workerCount={calls.worker} showBreakdown={calls.hasBreakdown} /> : null;
                    })()}
                    {(() => {
                      const tokens = getTokenUsageBreakdown(msg);
                      return <TokenUsageBadge usage={tokens.total} plannerUsage={tokens.planner} workerUsage={tokens.worker} />;
                    })()}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          {showScrollBtn && (
            <button
              onClick={() => { userScrolledUp.current = false; scrollToBottom(true); }}
              style={{ position: 'absolute', bottom: '8px', right: '16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '16px', padding: '6px 14px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, boxShadow: '0 2px 8px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', gap: '4px', zIndex: 10 }}
            >↓ 新消息</button>
          )}
          <ChatInputBox
            onSend={handleSend}
            onPlanSend={handlePlanSend}
            isRunning={isRunning}
            handleStop={handleStop}
            messages={messages}
            providerConfigs={providerConfigs}
            plannerProviderConfigId={plannerProviderConfig.id}
            setPlannerProviderConfigId={setPlannerProviderConfigId}
            plannerModel={plannerModel}
            setPlannerModel={setPlannerModel}
            workerProviderConfigId={workerProviderConfig.id}
            setWorkerProviderConfigId={setWorkerProviderConfigId}
            workerModel={workerModel}
            setWorkerModel={setWorkerModel}
            modelsByConfigId={modelsByConfigId}
            loadingModelsByConfigId={loadingModelsByConfigId}
          />
        </div>
      </div>
    ) : (
      <div className="welcome-container">
        <h1 className="welcome-title">Dual-Engine Agent</h1>
        <p className="welcome-subtitle">Your intelligent, context-aware coding assistant.<br/>Open a folder to start building, refactoring, and debugging with ease.</p>
        <button className="welcome-button" onClick={handleOpenWorkspace}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Open Folder
        </button>
        <SettingsHost
          buttonStyle={{marginTop: '40px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', textDecoration: 'underline'}}
          providerConfigs={providerConfigs}
          modelsByConfigId={modelsByConfigId}
          loadingModelsByConfigId={loadingModelsByConfigId}
          activeProviderConfigId={activeProviderConfigId}
          onApplySettings={applySettings}
          plannerProviderConfigId={plannerProviderConfig.id}
          plannerModel={plannerModel}
          workerProviderConfigId={workerProviderConfig.id}
          workerModel={workerModel}
          maxSteps={maxSteps}
          showHiddenFiles={showHiddenFiles}
          handleOAuthLogin={handleOAuthLogin}
          onOpenDebugTrace={handleOpenDebugTrace}
        >
          Configure Settings
        </SettingsHost>
      </div>
    )}

      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} isDir={contextMenu.isDir} onAction={handleContextMenuAction} onClose={() => setContextMenu(null)} />
      )}

      <HistoryModal
        isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)}
        conversations={conversations} currentConversationId={currentConversationId}
        onSelectConversation={(conv) => {
          setCurrentConversationId(conv.id);
          setMessages(conv.messages.map((m: any) => ({ ...m, isComplete: true })));
          setIsHistoryOpen(false);
        }}
        onDeleteConversation={(convId) => {
          setConversations(prev => {
            const updated = prev.filter(c => c.id !== convId);
            // @ts-ignore
            if (typeof window.ipcRenderer !== 'undefined' && workspacePath) {
              // @ts-ignore
              window.ipcRenderer.invoke('agent:save-chat-history', { workspacePath, conversations: updated }).catch(console.error);
            }
            return updated;
          });
          if (currentConversationId === convId) handleNewChat();
        }}
      />
    </>
  );
}

export default App;
