import { useState, useEffect, useRef } from 'react';
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



import { useResizer } from './hooks/useResizer';
import { useAppConfig } from './hooks/useAppConfig';
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

function App() {
  // ─── Config & Provider ───────────────────────────────────────────
  const config = useAppConfig();
  const {
    provider, setProvider,
    openaiKey, setOpenaiKey, openaiUrl, setOpenaiUrl,
    sensenovaKey, setSensenovaKey, sensenovaUrl, setSensenovaUrl,
    anthropicKey, setAnthropicKey, anthropicUrl, setAnthropicUrl,
    googleAuthMethod, setGoogleAuthMethod,
    googleKey, setGoogleKey, googleUrl, setGoogleUrl,
    googleOauthToken, setGoogleOauthToken,
    availableModels, setAvailableModels,
    plannerModel, setPlannerModel,
    workerModel, setWorkerModel,
    maxSteps, setMaxSteps,
    isLoadingModels, setIsLoadingModels,
    showHiddenFiles, setShowHiddenFiles,
    lastWorkspacePath,
    isGlobalLoaded,
    saveWorkspacePath,
  } = config;

  // ─── Workspace & File Tree ────────────────────────────────────────
  const workspace = useWorkspace(showHiddenFiles);
  const {
    workspacePath,
    setWorkspacePath,
    fileTree,
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
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // ─── Terminal auto-scroll ─────────────────────────────────────────
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLogs]);

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
          setDiffState({ original: data.oldContent, modified: data.newContent });
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
      if (data.type === 'fs-state') { workspace.fileTree; return; } // handled by workspace
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
        } else if (data.type === 'plan') {
          targetMsg.plan = data.data;
          const summaryText = data.data && typeof data.data.summary === 'string' ? data.data.summary : (typeof data.data === 'string' ? data.data : JSON.stringify(data.data));
          const planText = summaryText.split('\n').map((l: string) => `> ${l}`).join('\n');
          targetMsg.content += `### 📋 Orchestrator Plan\n${planText}\n\n`;
        } else if (data.type === 'subtask-result') {
          const resultStr = typeof data.data === 'string' ? data.data : JSON.stringify(data.data || '');
          const resultText = resultStr.split('\n').map((l: string) => `> ${l}`).join('\n');
          targetMsg.content += `### 🤖 Task Result\n${resultText}\n\n`;
        } else if (data.type === 'api-call') {
          targetMsg.apiCallCount = (targetMsg.apiCallCount || 0) + 1;
        } else if (data.type === 'agent-step') {
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
    const fetchModels = async () => {
      let tokenOrKey = '';
      let currentBaseUrl = '';
      let activeProtocol = 'openai';
      let authMethodForBackend = 'openai';
      if (provider === 'openai') { tokenOrKey = openaiKey; currentBaseUrl = openaiUrl; }
      else if (provider === 'sensenova') { tokenOrKey = sensenovaKey; currentBaseUrl = sensenovaUrl; }
      else if (provider === 'anthropic') { tokenOrKey = anthropicKey; currentBaseUrl = anthropicUrl; activeProtocol = 'anthropic'; authMethodForBackend = 'anthropic'; }
      else if (provider === 'google') {
        tokenOrKey = googleAuthMethod === 'oauth' ? googleOauthToken : googleKey;
        currentBaseUrl = googleUrl; activeProtocol = 'google';
        authMethodForBackend = googleAuthMethod === 'oauth' ? 'google-oauth' : 'google-key';
      }
      if (currentBaseUrl.endsWith('/chat/completions')) currentBaseUrl = currentBaseUrl.replace('/chat/completions', '');
      if (currentBaseUrl.endsWith('/')) currentBaseUrl = currentBaseUrl.slice(0, -1);
      if (!tokenOrKey) { setAvailableModels([]); return; }
      setIsLoadingModels(true);
      try {
        // @ts-ignore
        const models: string[] = await window.ipcRenderer.invoke('agent:get-models', { protocol: activeProtocol, authMethod: authMethodForBackend, tokenOrKey, baseUrl: currentBaseUrl });
        let filtered = models;
        if (provider === 'openai') filtered = models.filter(m => m.includes('gpt-') || m.includes('o1') || m.includes('o3'));
        else if (provider === 'anthropic') filtered = models.filter(m => m.includes('claude-'));
        else if (provider === 'google') filtered = models.filter(m => m.includes('gemini-'));
        setAvailableModels(filtered.length > 0 ? filtered : models);
        if (filtered.length > 0) {
          if (!plannerModel || !filtered.includes(plannerModel)) setPlannerModel(filtered[0]);
          if (!workerModel || !filtered.includes(workerModel)) setWorkerModel(filtered[filtered.length - 1] || filtered[0]);
        }
      } catch (err: any) {
        console.error(err);
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: `⚠️ **[System Error]** Failed to fetch models: ${err.message}`, statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);
      } finally { setIsLoadingModels(false); }
    };
    setTimeout(fetchModels, 1000);
  }, [provider, openaiKey, sensenovaKey, anthropicKey, googleKey, googleOauthToken, googleAuthMethod, openaiUrl, sensenovaUrl, anthropicUrl, googleUrl]);

  // ─── OAuth ────────────────────────────────────────────────────────
  const addSystemMsg = (content: string) =>
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content, statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);

  const handleOAuthLogin = async () => {
    try {
      addSystemMsg('[System] Opening browser for Google OAuth login...');
      // @ts-ignore
      const token = await window.ipcRenderer.invoke('agent:login-oauth');
      setGoogleOauthToken(token);
      addSystemMsg('[System] Google OAuth login successful!');
    } catch (err: any) { addSystemMsg(`[System Error] OAuth login failed: ${err.message}`); }
  };

  const handleLogout = () => {
    setGoogleOauthToken('');
    setAvailableModels([]);
    addSystemMsg('[System] Logged out successfully. Token cleared.');
  };

  // ─── Send message ─────────────────────────────────────────────────
  const handleSend = async (userTask: string) => {
    if (!userTask.trim()) return;
    let tokenOrKey = '';
    let currentBaseUrl = '';
    let activeProtocol = 'openai';
    let authMethodForBackend = 'openai';
    if (provider === 'openai') { tokenOrKey = openaiKey; currentBaseUrl = openaiUrl; }
    else if (provider === 'sensenova') { tokenOrKey = sensenovaKey; currentBaseUrl = sensenovaUrl; }
    else if (provider === 'anthropic') { tokenOrKey = anthropicKey; currentBaseUrl = anthropicUrl; activeProtocol = 'anthropic'; authMethodForBackend = 'anthropic'; }
    else if (provider === 'google') {
      tokenOrKey = googleAuthMethod === 'oauth' ? googleOauthToken : googleKey;
      currentBaseUrl = googleUrl; activeProtocol = 'google';
      authMethodForBackend = googleAuthMethod === 'oauth' ? 'google-oauth' : 'google-key';
    }
    if (currentBaseUrl.endsWith('/chat/completions')) currentBaseUrl = currentBaseUrl.replace('/chat/completions', '');
    if (currentBaseUrl.endsWith('/')) currentBaseUrl = currentBaseUrl.slice(0, -1);
    if (!tokenOrKey) { alert(`Please configure your ${provider} credentials first!`); return; }

    const newAiMsgId = crypto.randomUUID();
    resetScrollPosition();
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
      const result = await window.ipcRenderer.invoke('agent:run-task', { protocol: activeProtocol, authMethod: authMethodForBackend, tokenOrKey, plannerModel, workerModel, maxSteps, task: userTask, workspacePath, baseUrl: currentBaseUrl, chatHistory, runId: newAiMsgId });
      setMessages(prev => {
        const n = [...prev];
        if (!n.length) return prev;
        const last = { ...n[n.length - 1] };
        last.isComplete = true;
        if (typeof result === 'string' && result.startsWith('Error:')) last.content += `\n\n**[Error]**\n${result}`;
        n[n.length - 1] = last;
        return n;
      });
    } catch (e: any) {
      setMessages(prev => {
        const n = [...prev];
        if (!n.length) return prev;
        const last = { ...n[n.length - 1] };
        last.isComplete = true; last.content += `\n\n**[Error]**\n${e.message}`;
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
        <div className="terminal-container" style={{ height: 'var(--terminal-height)', backgroundColor: '#1e1e1e', color: '#cccccc', padding: '10px', overflowY: 'auto', borderTop: '1px solid var(--border-color)', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap', flexShrink: 0 }}>
          <div style={{color: '#888', marginBottom: '5px', textTransform: 'uppercase', fontSize: '10px'}}>Terminal Logs</div>
          {terminalLogs || 'Terminal ready...'}
          <div ref={terminalEndRef} />
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
              <div key={msg.id} className={`message ${msg.role}`}>
                {msg.role === 'ai' && (
                  <div className="message-header" style={{display: 'flex', justifyContent: 'space-between'}}>
                    <span>Dual-Engine Agent</span>
                    {msg.apiCallCount > 0 && (
                      <span style={{backgroundColor: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', color: 'var(--accent)'}}>🤖 API Calls: {msg.apiCallCount}</span>
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
                    {msg.statusLogs[msg.statusLogs.length - 1]}
                    <div className="typing-indicator"><span/><span/><span/></div>
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
          <ChatInputBox onSend={handleSend} isRunning={isRunning} handleStop={handleStop} messages={messages} plannerModel={plannerModel} setPlannerModel={setPlannerModel} workerModel={workerModel} setWorkerModel={setWorkerModel} availableModels={availableModels} />
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
        provider={provider} setProvider={setProvider}
        openaiKey={openaiKey} setOpenaiKey={setOpenaiKey}
        sensenovaKey={sensenovaKey} setSensenovaKey={setSensenovaKey}
        anthropicKey={anthropicKey} setAnthropicKey={setAnthropicKey}
        googleKey={googleKey} setGoogleKey={setGoogleKey}
        openaiUrl={openaiUrl} setOpenaiUrl={setOpenaiUrl}
        sensenovaUrl={sensenovaUrl} setSensenovaUrl={setSensenovaUrl}
        anthropicUrl={anthropicUrl} setAnthropicUrl={setAnthropicUrl}
        googleUrl={googleUrl} setGoogleUrl={setGoogleUrl}
        plannerModel={plannerModel} setPlannerModel={setPlannerModel}
        workerModel={workerModel} setWorkerModel={setWorkerModel}
        maxSteps={maxSteps} setMaxSteps={setMaxSteps}
        showHiddenFiles={showHiddenFiles} setShowHiddenFiles={setShowHiddenFiles}
        googleAuthMethod={googleAuthMethod} setGoogleAuthMethod={setGoogleAuthMethod}
        googleOauthToken={googleOauthToken}
        isLoadingModels={isLoadingModels} availableModels={availableModels}
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
