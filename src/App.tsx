import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { SettingsModal } from './components/SettingsModal';
import { AgentStepView } from './components/AgentStepView';
import { ChatInputBox } from './components/ChatInputBox';
import { applyConverterPlugin, NO_CONVERTER_PLUGIN_ID } from './converterPlugins';



import { useResizer } from './hooks/useResizer';
import { useAppConfig, type ProviderConfig } from './hooks/useAppConfig';
import { useWorkspace } from './hooks/useWorkspace';
import { useConversations } from './hooks/useConversations';
import { useFileEditor } from './hooks/useFileEditor';
import { useChatScroll } from './hooks/useChatScroll';

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

const ApiCallsBadge = ({ count }: { count: number }) => (
  <span style={{ backgroundColor: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
    <span aria-hidden="true">🤖</span>
    API Calls: {count}
  </span>
);

const MODEL_WAIT_STATUS = 'Tool finished. Waiting for model to analyze results';

const formatElapsed = (startedAt: number, now: number) => {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const filterModelsForProvider = (providerConfig: ProviderConfig, models: string[]) => {
  if (providerConfig.provider === 'openai') return models;
  if (providerConfig.provider === 'anthropic') return models.filter(m => m.includes('claude-'));
  if (providerConfig.provider === 'google') return models.filter(m => m.includes('gemini-'));
  return models;
};

function App() {
  // ─── Config & Provider ───────────────────────────────────────────
  const config = useAppConfig();
  const {
    providerConfigs,
    activeProviderConfigId,
    activeProviderConfig,
    setActiveProviderConfigId,
    plannerProviderConfigId,
    setPlannerProviderConfigId,
    workerProviderConfigId,
    setWorkerProviderConfigId,
    updateProviderConfig,
    addProviderConfig,
    deleteProviderConfig,
    plannerModel, setPlannerModel,
    workerModel, setWorkerModel,
    maxSteps, setMaxSteps,
    showHiddenFiles, setShowHiddenFiles,
    lastWorkspacePath,
    isGlobalLoaded,
    saveWorkspacePath,
  } = config;

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
  const isLoadingPlannerModels = !!loadingModelsByConfigId[plannerProviderConfig.id];
  const isLoadingWorkerModels = !!loadingModelsByConfigId[workerProviderConfig.id];

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
    const resizeObserver = new ResizeObserver(measureMessageHeights);

    if (chatContainerRef.current) {
      resizeObserver.observe(chatContainerRef.current);
    }
    messageItemRefs.current.forEach(element => resizeObserver.observe(element));
    window.addEventListener('resize', measureMessageHeights);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', measureMessageHeights);
    };
  }, [messages, measureMessageHeights, chatContainerRef]);

  // ─── Resizers ─────────────────────────────────────────────────────
  const { startResizing: startResizingSidebar } = useResizer(250, 'right', '--sidebar-width');
  const { startResizing: startResizingChat } = useResizer(400, 'left', '--chat-width');
  const { startResizing: startResizingTerminal } = useResizer(200, 'top', '--terminal-height');

  // ─── Local UI State ───────────────────────────────────────────────
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'general' | 'auth' | 'models'>('auth');
  const [terminalLogs, setTerminalLogs] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalUserScrolledUp = useRef(false);

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
          if (idx !== -1) targetIdx = idx;
        }
        const targetMsg = { ...newMessages[targetIdx] };
        if (targetMsg.role !== 'ai') return prev;
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
          const resultStr = typeof data.data === 'string' ? data.data : JSON.stringify(data.data || '');
          const resultText = resultStr.split('\n').map((l: string) => `> ${l}`).join('\n');
          targetMsg.content += `### 🤖 Task Result\n${resultText}\n\n`;
        } else if (data.type === 'api-call') {
          targetMsg.apiCallCount = (targetMsg.apiCallCount || 0) + 1;
        } else if (data.type === 'agent-step') {
          targetMsg.modelWaitStartedAt = null;
          targetMsg.agentSteps = [...(targetMsg.agentSteps || []), data.data];
        }
        newMessages[targetIdx] = targetMsg;
        return newMessages;
      });
    };
    const logListener = (_event: any, data: string) => setTerminalLogs(prev => prev + data);
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
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: `⚠️ **[System Error]** Failed to fetch models: ${err.message}`, statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);
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
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content, statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);

  const handleOAuthLogin = async () => {
    try {
      addSystemMsg('[System] Opening browser for Google OAuth login...');
      // @ts-ignore
      const token = await window.ipcRenderer.invoke('agent:login-oauth');
      updateProviderConfig(activeProviderConfig.id, { googleOauthToken: token });
      addSystemMsg('[System] Google OAuth login successful!');
    } catch (err: any) { addSystemMsg(`[System Error] OAuth login failed: ${err.message}`); }
  };

  const handleLogout = () => {
    updateProviderConfig(activeProviderConfig.id, { googleOauthToken: '' });
    setModelsByConfigId(prev => ({ ...prev, [activeProviderConfig.id]: [] }));
    addSystemMsg('[System] Logged out successfully. Token cleared.');
  };

  // ─── Send message ─────────────────────────────────────────────────
  const handleSend = async (userTask: string) => {
    if (!userTask.trim()) return;
    const plannerRuntime = getProviderRuntime(plannerProviderConfig, plannerModel);
    const workerRuntime = getProviderRuntime(workerProviderConfig, workerModel);
    if (!plannerRuntime.tokenOrKey) { alert(`Please configure credentials for ${plannerProviderConfig.name} first!`); return; }
    if (!workerRuntime.tokenOrKey) { alert(`Please configure credentials for ${workerProviderConfig.name} first!`); return; }

    const newAiMsgId = crypto.randomUUID();
    resetScrollPosition();
    terminalUserScrolledUp.current = false;
    scrollTerminalToBottom();
    setMessages(prev => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: userTask, statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true },
      { id: newAiMsgId, role: 'ai', content: '', statusLogs: ['Initializing Agent...'], agentSteps: [], apiCallCount: 0, isComplete: false }
    ]);

    const chatHistory = messages
      .filter(m => m.id !== 'init')
      .map(m => {
        let textContent = m.content || '';
        if (m.role === 'ai' && !textContent && m.agentSteps?.length > 0) {
          const toolsUsed = m.agentSteps.flatMap(s => (s.actions || []).map((a: any) => a.toolName)).filter(Boolean);
          if (toolsUsed.length > 0) textContent = `[Executed tools: ${toolsUsed.join(', ')}]`;
        }
        return { role: m.role === 'user' ? 'user' : 'assistant', content: textContent };
      })
      .filter(m => !!m.content);

    // @ts-ignore
    if (typeof window.ipcRenderer === 'undefined') {
      setMessages(prev => { const n = [...prev]; n[n.length-1].content = '[Error] ipcRenderer is not available.'; n[n.length-1].isComplete = true; return n; });
      return;
    }
    setIsRunning(true);
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
      });
      setMessages(prev => {
        const n = [...prev];
        if (!n.length) return prev;
        const last = { ...n[n.length - 1] };
        last.isComplete = true;
        last.modelWaitStartedAt = null;
        if (typeof result === 'string' && result.startsWith('Error:')) last.content += `\n\n**[Error]**\n${result}`;
        n[n.length - 1] = last;
        return n;
      });
    } catch (e: any) {
      setMessages(prev => {
        const n = [...prev];
        if (!n.length) return prev;
        const last = { ...n[n.length - 1] };
        last.isComplete = true;
        last.modelWaitStartedAt = null;
        last.content += `\n\n**[Error]**\n${e.message}`;
        n[n.length - 1] = last;
        return n;
      });
    } finally { setIsRunning(false); }
  };

  const handleStop = () => {
    setIsRunning(false);
    setMessages(prev => {
      const n = [...prev];
      if (!n.length) return prev;
      const last = { ...n[n.length - 1] };
      if (!last.isComplete) {
        (window as any).ipcRenderer?.invoke('agent:stop-task', { runId: last.id }).catch(console.error);
        last.isComplete = true;
        last.modelWaitStartedAt = null;
        last.content = (last.content || '') + '\n\n*[Stopped by user]*';
        n[n.length - 1] = last;
      }
      return n;
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
           <button onClick={() => setIsSettingsOpen(true)} style={{background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px'}}>
             ⚙️ Settings
           </button>
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
          <div className="chat-messages" ref={chatContainerRef} onScroll={handleChatScroll} style={{ position: 'relative' }}>
            {messages.map((msg) => (
              <div key={msg.id} ref={(element) => setMessageItemRef(msg.id, element)} className={`message ${msg.role}`}>
                {msg.role === 'ai' && (
                  <div className="message-header" style={{display: 'flex', justifyContent: 'space-between'}}>
                    <span>Dual-Engine Agent</span>
                    {msg.apiCallCount > 0 && (
                      <ApiCallsBadge count={msg.apiCallCount} />
                    )}
                  </div>
                )}

                {msg.content && (() => {
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
                            <span className="subtask-num">{i + 1}.</span>{' '}
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

                {msg.role === 'ai' && msg.apiCallCount > 0 && messageExceedsViewport[msg.id] && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                    <ApiCallsBadge count={msg.apiCallCount} />
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
        <button onClick={() => setIsSettingsOpen(true)} style={{marginTop: '40px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', textDecoration: 'underline'}}>Configure Settings</button>
      </div>
    )}

      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} isDir={contextMenu.isDir} onAction={handleContextMenuAction} onClose={() => setContextMenu(null)} />
      )}

      <SettingsModal
        isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)}
        activeTab={activeSettingsTab} setActiveTab={setActiveSettingsTab}
        providerConfigs={providerConfigs}
        modelsByConfigId={modelsByConfigId}
        activeProviderConfigId={activeProviderConfigId}
        activeProviderConfig={activeProviderConfig}
        setActiveProviderConfigId={setActiveProviderConfigId}
        updateProviderConfig={updateProviderConfig}
        addProviderConfig={addProviderConfig}
        deleteProviderConfig={deleteProviderConfig}
        plannerProviderConfigId={plannerProviderConfig.id}
        setPlannerProviderConfigId={setPlannerProviderConfigId}
        plannerModel={plannerModel} setPlannerModel={setPlannerModel}
        plannerAvailableModels={plannerAvailableModels}
        isLoadingPlannerModels={isLoadingPlannerModels}
        workerProviderConfigId={workerProviderConfig.id}
        setWorkerProviderConfigId={setWorkerProviderConfigId}
        workerModel={workerModel} setWorkerModel={setWorkerModel}
        workerAvailableModels={workerAvailableModels}
        isLoadingWorkerModels={isLoadingWorkerModels}
        maxSteps={maxSteps} setMaxSteps={setMaxSteps}
        showHiddenFiles={showHiddenFiles} setShowHiddenFiles={setShowHiddenFiles}
        handleOAuthLogin={handleOAuthLogin} handleLogout={handleLogout}
      />
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
