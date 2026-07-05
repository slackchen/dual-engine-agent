import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { FileNode, Message, Conversation } from './types';

const parseReasoning = (content: string) => {
  if (!content) return { reasoning: '', finalContent: '' };
  
  // Try to match <think>...</think> or <thinking>...</thinking>
  // including cases where it hasn't closed yet (streaming)
  const thinkRegex = /<(think|thinking)>([\s\S]*?)(?:<\/\1>|$)/i;
  const match = content.match(thinkRegex);
  
  if (match) {
    const reasoning = match[2].trim();
    const finalContent = content.replace(match[0], '').trim();
    return { reasoning, finalContent };
  }
  
  return { reasoning: '', finalContent: content };
};

function useResizer(
  initialSize: number, 
  direction: 'right' | 'left' | 'top',
  cssVar: string
) {
  React.useEffect(() => {
    document.documentElement.style.setProperty(cssVar, `${initialSize}px`);
  }, []);

  const isResizing = useRef(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = direction === 'top' ? 'ns-resize' : 'ew-resize';
  }, [direction]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      let newSize;
      if (direction === 'right') {
        newSize = Math.max(150, Math.min(e.clientX, window.innerWidth - 400));
      } else if (direction === 'left') {
        newSize = Math.max(250, Math.min(window.innerWidth - e.clientX, window.innerWidth - 300));
      } else if (direction === 'top') {
        newSize = Math.max(100, Math.min(window.innerHeight - e.clientY, window.innerHeight - 200));
      }
      if (newSize) {
        document.documentElement.style.setProperty(cssVar, `${newSize}px`);
      }
    };
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = 'default';
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [direction, cssVar]);

  return { startResizing };
}

function App() {
  const [provider, setProvider] = useState<'openai' | 'sensenova' | 'anthropic' | 'google'>('openai');

  // OpenAI
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiUrl, setOpenaiUrl] = useState('https://api.openai.com/v1');

  // SenseNova
  const [sensenovaKey, setSensenovaKey] = useState('');
  const [sensenovaUrl, setSensenovaUrl] = useState('https://token.sensenova.cn/v1');

  // Anthropic
  const [anthropicKey, setAnthropicKey] = useState('');
  const [anthropicUrl, setAnthropicUrl] = useState('https://api.anthropic.com/v1');

  // Google
  const [googleAuthMethod, setGoogleAuthMethod] = useState<'oauth' | 'key'>('oauth');
  const [googleKey, setGoogleKey] = useState('');
  const [googleUrl, setGoogleUrl] = useState('https://generativelanguage.googleapis.com/v1beta');
  const [googleOauthToken, setGoogleOauthToken] = useState('');
  
  
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [plannerModel, setPlannerModel] = useState<string>('');
  const [workerModel, setWorkerModel] = useState<string>('');
  const [maxSteps, setMaxSteps] = useState<number>(20);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const [workspacePath, setWorkspacePath] = useState<string>('');
  const [isStateLoaded, setIsStateLoaded] = useState(false);
  const [isGlobalLoaded, setIsGlobalLoaded] = useState(false);
  const { startResizing: startResizingSidebar } = useResizer(250, 'right', '--sidebar-width');
  const { startResizing: startResizingChat } = useResizer(400, 'left', '--chat-width');
  const { startResizing: startResizingTerminal } = useResizer(200, 'top', '--terminal-height');
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [terminalLogs, setTerminalLogs] = useState<string>('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'general' | 'auth' | 'models'>('auth');
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const [contextMenu, setContextMenu] = useState<{x: number, y: number, path: string, isDir: boolean} | null>(null);
  const [editingNode, setEditingNode] = useState<{path: string, type: 'rename' | 'newFile' | 'newDir', initialValue: string} | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Close context menu on external clicks
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // Load global config on mount
  useEffect(() => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      // @ts-ignore
      window.ipcRenderer.invoke('agent:load-global-config').then((config: any) => {
        if (config) {
          if (config.provider) setProvider(config.provider);
          if (config.openaiKey) setOpenaiKey(config.openaiKey);
          if (config.sensenovaKey) setSensenovaKey(config.sensenovaKey);
          if (config.anthropicKey) setAnthropicKey(config.anthropicKey);
          if (config.googleKey) setGoogleKey(config.googleKey);
          if (config.plannerModel) setPlannerModel(config.plannerModel);
          if (config.workerModel) setWorkerModel(config.workerModel);
          if (config.maxSteps !== undefined) setMaxSteps(config.maxSteps);
          else setMaxSteps(20);
          if (config.openaiUrl) setOpenaiUrl(config.openaiUrl);
          if (config.sensenovaUrl) setSensenovaUrl(config.sensenovaUrl);
          if (config.anthropicUrl) setAnthropicUrl(config.anthropicUrl);
          if (config.googleUrl) setGoogleUrl(config.googleUrl);
          if (config.googleAuthMethod) setGoogleAuthMethod(config.googleAuthMethod);
          if (config.googleOauthToken) setGoogleOauthToken(config.googleOauthToken);
          if (config.lastWorkspacePath && !workspacePath) setWorkspacePath(config.lastWorkspacePath);
          if (config.lastWorkspacePath && !workspacePath) setWorkspacePath(config.lastWorkspacePath);
        }
        setIsGlobalLoaded(true);
      });
    }
  }, []);

  // Save global config whenever settings change
  useEffect(() => {
    if (!isGlobalLoaded) return;
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      // @ts-ignore
      window.ipcRenderer.invoke('agent:save-global-config', {
        provider, openaiKey, sensenovaKey, anthropicKey, googleKey,
        plannerModel, workerModel, maxSteps,
        openaiUrl, sensenovaUrl, anthropicUrl, googleUrl,
        googleAuthMethod, googleOauthToken,
        showHiddenFiles, lastWorkspacePath: workspacePath
      });
    }
  }, [provider, openaiKey, sensenovaKey, anthropicKey, googleKey, plannerModel, workerModel, maxSteps, openaiUrl, sensenovaUrl, anthropicUrl, googleUrl, googleAuthMethod, googleOauthToken, showHiddenFiles, workspacePath, isGlobalLoaded]);
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLogs]);
  
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string>(Date.now().toString());
  const [messages, setMessages] = useState<Message[]>([
    { 
      id: 'init', 
      role: 'ai', 
      content: 'Hello! I am your Dual-Engine Agent. Please configure your auth below, then tell me what to build.',
      statusLogs: [],
      agentSteps: [],
      apiCallCount: 0,
      isComplete: true
    }
  ]);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);

  // Load chat history from backend when workspace changes
  useEffect(() => {
    const loadHistory = async () => {
      setIsHistoryLoaded(false);
      // @ts-ignore
      if (typeof window.ipcRenderer !== 'undefined' && workspacePath) {
        try {
          // @ts-ignore
          const loaded = await window.ipcRenderer.invoke('agent:load-chat-history', { workspacePath });
          if (loaded && loaded.length > 0) {
            setConversations(loaded);
            setCurrentConversationId(loaded[0].id);
            setMessages(loaded[0].messages.map((m: any) => ({ ...m, isComplete: true })));
          } else {
            setConversations([]);
            setCurrentConversationId(Date.now().toString());
            setMessages([{ id: 'init', role: 'ai', content: 'Hello! I am your Dual-Engine Agent. Please configure your auth below, then tell me what to build.', statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);
          }
        } catch (e) {
          console.error("Failed to load history", e);
        }
      } else {
        setConversations([]);
        setCurrentConversationId(Date.now().toString());
        setMessages([{ id: 'init', role: 'ai', content: 'Hello! I am your Dual-Engine Agent. Please configure your auth below, then tell me what to build.', statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);
      }
      setIsHistoryLoaded(true);
    };
    loadHistory();
  }, [workspacePath]);
  
  // Sync to backend file storage
  useEffect(() => {
    if (!isHistoryLoaded || !workspacePath) return; // Wait until loaded

    setConversations(prev => {
      // Don't clutter history with completely empty new conversations
      if (messages.length <= 1) {
        return prev;
      }
      
      let title = 'New Conversation';
      // Find the first user message for a title
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg && firstUserMsg.content) {
         title = firstUserMsg.content.substring(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
      }
      
      const idx = prev.findIndex(c => c.id === currentConversationId);
      let updated = [...prev];
      if (idx !== -1) {
         updated[idx] = { ...updated[idx], title, messages, updatedAt: Date.now() };
      } else {
         updated.unshift({ id: currentConversationId, title, messages, updatedAt: Date.now() });
      }
      // Sort by newest
      updated.sort((a, b) => b.updatedAt - a.updatedAt);
      
      // Save via IPC
      // @ts-ignore
      if (typeof window.ipcRenderer !== 'undefined') {
        // @ts-ignore
        window.ipcRenderer.invoke('agent:save-chat-history', { workspacePath, conversations: updated }).catch(console.error);
      }
      return updated;
    });
  }, [messages, currentConversationId, isHistoryLoaded, workspacePath]);
  
  const handleNewChat = () => {
    setCurrentConversationId(Date.now().toString());
    setMessages([
      { 
        id: 'init', 
        role: 'ai', 
        content: 'Hello! I am your Dual-Engine Agent. Please configure your auth below, then tell me what to build.',
        statusLogs: [],
        agentSteps: [],
        apiCallCount: 0,
        isComplete: true
      }
    ]);
  };
  
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [activeFileContent, setActiveFileContent] = useState<string>('// Select a file to view code');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const decorationsRef = useRef<any>(null);
  const [highlightRange, setHighlightRange] = useState<{startLine: number, endLine: number} | null>(null);
  const [diffState, setDiffState] = useState<{original: string, modified: string} | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const hasLoadedHistory = useRef(false);

  useEffect(() => {
    const container = document.querySelector('.chat-messages');
    if (!container) return;
    
    // Robust native scrolling on the container itself
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    
    if (!hasLoadedHistory.current && messages.length > 0) {
      hasLoadedHistory.current = true;
      setTimeout(() => {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }, 300);
    }
  }, [messages]);
  
  useEffect(() => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      const listener = (_event: any, data: any) => {
        if (data.type === 'fs-state') {
          setFileTree(data.data || []);
          return;
        }
        
        setMessages(prev => {
          const newMessages = [...prev];
          if (newMessages.length === 0) return prev;
          
          // Match by runId if available, otherwise fallback to the last AI message
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
      
      const logListener = (_event: any, data: string) => {
        setTerminalLogs(prev => prev + data);
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
    } else {
      console.error('window.ipcRenderer is undefined');
    }
  }, []);

  useEffect(() => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      const handleGlobalFileUpdate = (_event: any, data: any) => {
        setOpenTabs(prev => {
          if (!prev.includes(data.filePath)) {
            return [...prev, data.filePath];
          }
          return prev;
        });
        setActiveTab(data.filePath);
        if (data.isEdit && data.oldContent && data.newContent) {
          setDiffState({ original: data.oldContent, modified: data.newContent });
          setTimeout(() => setDiffState(null), 5000);
        } else if (data.range) {
          setHighlightRange(data.range);
        }
      };
      // @ts-ignore
      window.ipcRenderer.on('agent:file-updated', handleGlobalFileUpdate);
      return () => {
        // @ts-ignore
        window.ipcRenderer.removeListener('agent:file-updated', handleGlobalFileUpdate);
      };
    }
  }, []);


  useEffect(() => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      const openFolderListener = (_event: any, path: string) => {
        setWorkspacePath(path);
      };
      const closeFolderListener = () => {
        setWorkspacePath('');
        setFileTree([]);
        setOpenTabs([]);
        setActiveTab('');
      };
      // @ts-ignore
      window.ipcRenderer.on('menu:open-folder', openFolderListener);
      // @ts-ignore
      window.ipcRenderer.on('menu:close-folder', closeFolderListener);
      return () => {
        // @ts-ignore
        window.ipcRenderer.removeListener('menu:open-folder', openFolderListener);
        // @ts-ignore
        window.ipcRenderer.removeListener('menu:close-folder', closeFolderListener);
      };
    }
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    const fetchModels = async () => {
      let tokenOrKey = '';
      let currentBaseUrl = '';
      let activeProtocol: string = 'openai';
      let authMethodForBackend: string = 'openai'; 
      
      if (provider === 'openai') {
        tokenOrKey = openaiKey;
        currentBaseUrl = openaiUrl;
        activeProtocol = 'openai';
        authMethodForBackend = 'openai';
      } else if (provider === 'sensenova') {
        tokenOrKey = sensenovaKey;
        currentBaseUrl = sensenovaUrl;
        activeProtocol = 'openai'; // SenseNova uses OpenAI Compatible Protocol
        authMethodForBackend = 'openai';
      } else if (provider === 'anthropic') {
        tokenOrKey = anthropicKey;
        currentBaseUrl = anthropicUrl;
        activeProtocol = 'anthropic';
        authMethodForBackend = 'anthropic';
      } else if (provider === 'google') {
        tokenOrKey = googleAuthMethod === 'oauth' ? googleOauthToken : googleKey;
        currentBaseUrl = googleUrl;
        activeProtocol = 'google';
        authMethodForBackend = googleAuthMethod === 'oauth' ? 'google-oauth' : 'google-key';
      }

      // Auto-fix user pasting full chat endpoint instead of base URL
      if (currentBaseUrl.endsWith('/chat/completions')) {
        currentBaseUrl = currentBaseUrl.replace('/chat/completions', '');
      }
      if (currentBaseUrl.endsWith('/')) {
        currentBaseUrl = currentBaseUrl.slice(0, -1);
      }

      if (!tokenOrKey) {
        setAvailableModels([]);
        return;
      }
      setIsLoadingModels(true);
      try {
        // @ts-ignore
        const models: string[] = await window.ipcRenderer.invoke('agent:get-models', { protocol: activeProtocol, authMethod: authMethodForBackend, tokenOrKey, baseUrl: currentBaseUrl });
        
        // Filter logic: Only keep text/chat models to avoid clutter (OpenAI returns hundreds of models like TTS, DALL-E, etc.)
        let filtered = models;
        if (provider === 'openai') {
          filtered = models.filter(m => m.includes('gpt-') || m.includes('o1') || m.includes('o3'));
        } else if (provider === 'anthropic') {
          filtered = models.filter(m => m.includes('claude-'));
        } else if (provider === 'google') {
          filtered = models.filter(m => m.includes('gemini-'));
        }
        setAvailableModels(filtered.length > 0 ? filtered : models);
        
        if (filtered.length > 0) {
          if (!plannerModel || !filtered.includes(plannerModel)) setPlannerModel(filtered[0]);
          if (!workerModel || !filtered.includes(workerModel)) setWorkerModel(filtered[filtered.length - 1] || filtered[0]);
        }
      } catch (err: any) {
        console.error(err);
        setMessages(prev => [...prev, { 
          id: Date.now().toString(), 
          role: 'ai', 
          content: `⚠️ **[System Error]** Failed to fetch models: ${err.message}`, 
          statusLogs: [], 
          agentSteps: [],
          apiCallCount: 0,
          isComplete: true 
        }]);
      } finally {
        setIsLoadingModels(false);
      }
    };
    
    // Add a simple debounce so we don't spam the API on every keystroke
    setTimeout(() => {
      fetchModels();
    }, 1000);
    
  }, [provider, openaiKey, sensenovaKey, anthropicKey, googleKey, googleOauthToken, googleAuthMethod, openaiUrl, sensenovaUrl, anthropicUrl, googleUrl]);

  const handleOAuthLogin = async () => {
    try {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: '[System] Opening browser for Google OAuth login...', statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);
      // @ts-ignore
      const token = await window.ipcRenderer.invoke('agent:login-oauth');
      setGoogleOauthToken(token);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: '[System] Google OAuth login successful!', statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: `[System Error] OAuth login failed: ${err.message}`, statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);
    }
  };

  const handleLogout = () => {
    setGoogleOauthToken('');
    setAvailableModels([]);
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: '[System] Logged out successfully. Token cleared.', statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);
  };

  
  useEffect(() => {
    if (!activeTab) {
      setActiveFileContent('// Select a file to view code');
      return;
    }
    const loadContent = async () => {
      try {
        // @ts-ignore
        const content = await window.ipcRenderer.invoke('agent:read-file', { filePath: activeTab });
        setActiveFileContent(content);
      } catch (e) {
        setActiveFileContent('// Error reading file');
      }
    };
    loadContent();
    
    // Listen for agent edits specifically to reload the currently viewed file
    const handleActiveFileUpdate = (_event: any, data: any) => {
      if (data.filePath === activeTab || data.filePath.endsWith(activeTab)) {
        if (data.isEdit && data.oldContent && data.newContent) {
          setDiffState({ original: data.oldContent, modified: data.newContent });
          setTimeout(() => setDiffState(null), 5000);
        } else if (data.range) {
          setHighlightRange(data.range);
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

  // Auto-scroll the active tab into view so it doesn't get hidden behind the scroll boundary
  useEffect(() => {
    if (activeTab) {
      setTimeout(() => {
        const activeTabEl = document.querySelector('.tab-bar .tab.active');
        if (activeTabEl) {
          activeTabEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
        }
      }, 50); // slight delay to allow DOM to render the new tab
    }
  }, [activeTab]);

  useEffect(() => {
    if (editorRef.current && highlightRange) {
      if (decorationsRef.current) {
        decorationsRef.current.clear();
      }
      decorationsRef.current = editorRef.current.createDecorationsCollection([
        {
          range: {
            startLineNumber: highlightRange.startLine,
            startColumn: 1,
            endLineNumber: highlightRange.endLine,
            endColumn: 1
          },
          options: {
            isWholeLine: true,
            className: 'agent-edit-highlight',
            marginClassName: 'agent-edit-margin'
          }
        }
      ]);
      editorRef.current.revealLinesInCenter(highlightRange.startLine, highlightRange.endLine);
      
      const timer = setTimeout(() => {
        if (decorationsRef.current) {
           decorationsRef.current.clear();
        }
        setHighlightRange(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [activeFileContent, highlightRange]);

  // Load workspace state from main process
  useEffect(() => {
    if (!workspacePath) {
      setIsStateLoaded(false);
      return;
    }
    const loadState = async () => {
      try {
        // @ts-ignore
        const state = await window.ipcRenderer.invoke('agent:load-workspace-state', { workspacePath });
        if (state) {
          setOpenTabs(state.openTabs || []);
          setActiveTab(state.activeTab || '');
        } else {
          setOpenTabs([]);
          setActiveTab('');
        }
      } catch(e) {}
      setIsStateLoaded(true);
    };
    loadState();
  }, [workspacePath]);

  // Save workspace state to main process
  useEffect(() => {
    if (!workspacePath || !isStateLoaded) return;
    try {
      // @ts-ignore
      window.ipcRenderer.invoke('agent:save-workspace-state', {
        workspacePath,
        state: { 
          openTabs, activeTab
        }
      });
    } catch(e) {}
  }, [
    openTabs, activeTab, workspacePath, isStateLoaded
  ]);


  const handleOpenWorkspace = async () => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      // @ts-ignore
      const path = await window.ipcRenderer.invoke('agent:select-workspace');
      if (path) {
        setWorkspacePath(path);
        // Scan the directory initially
        // @ts-ignore
        const tree = await window.ipcRenderer.invoke('agent:get-fs-tree', { workspacePath: path });
        setFileTree(tree);
      }
    }
  };

  const handleContextMenuAction = (action: 'newFile' | 'newDir' | 'rename' | 'delete' | 'reveal') => {
    if (!contextMenu) return;
    const { path: targetPath, isDir } = contextMenu;
    const sep = targetPath.includes('\\') ? '\\' : '/';
    const parent = isDir ? targetPath : targetPath.substring(0, targetPath.lastIndexOf(sep));
    const basename = targetPath.substring(targetPath.lastIndexOf(sep) + 1);

    if (action === 'newFile' || action === 'newDir') {
      setEditingNode({ path: parent, type: action, initialValue: '' });
    } else if (action === 'rename') {
      setEditingNode({ path: targetPath, type: 'rename', initialValue: basename });
    } else if (action === 'delete') {
      if (window.confirm(`Are you sure you want to delete ${basename}?`)) {
        // @ts-ignore
        window.ipcRenderer.invoke('agent:delete-node', { targetPath }).then(() => {
          refreshFileTree();
          if (activeTab === targetPath) setActiveTab('');
        });
      }
    } else if (action === 'reveal') {
      // @ts-ignore
      window.ipcRenderer.invoke('agent:reveal-in-os', { targetPath });
    }
    setContextMenu(null);
  };

  const handleEditComplete = async (value: string) => {
    if (!editingNode || !value.trim()) {
      setEditingNode(null);
      return;
    }
    const { path: targetPath, type, initialValue } = editingNode;
    const sep = targetPath.includes('\\') ? '\\' : '/';
    
    try {
      if (type === 'rename' && value !== initialValue) {
        const newPath = targetPath.substring(0, targetPath.lastIndexOf(sep)) + sep + value;
        // @ts-ignore
        await window.ipcRenderer.invoke('agent:rename-node', { oldPath: targetPath, newPath });
      } else if (type === 'newFile') {
        const newPath = targetPath + sep + value;
        // @ts-ignore
        await window.ipcRenderer.invoke('agent:create-file', { targetPath: newPath });
      } else if (type === 'newDir') {
        const newPath = targetPath + sep + value;
        // @ts-ignore
        await window.ipcRenderer.invoke('agent:create-dir', { targetPath: newPath });
      }
    } catch (e) {
      console.error(e);
      alert('Operation failed.');
    }
    
    setEditingNode(null);
    refreshFileTree();
  };

  const refreshFileTree = () => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined' && workspacePath) {
      // @ts-ignore
      window.ipcRenderer.invoke('agent:get-fs-tree', { workspacePath, showHiddenFiles }).then((tree: any) => setFileTree(tree)).catch(console.error);
    }
  };

  useEffect(() => {
    if (workspacePath) refreshFileTree();
  }, [showHiddenFiles, workspacePath]);

  const handleSend = async (userTask: string) => {
    let tokenOrKey = '';
    let currentBaseUrl = '';
    let activeProtocol: string = 'openai';
    let authMethodForBackend: string = 'openai';
    
    if (provider === 'openai') {
      tokenOrKey = openaiKey;
      currentBaseUrl = openaiUrl;
      activeProtocol = 'openai';
      authMethodForBackend = 'openai';
    } else if (provider === 'sensenova') {
      tokenOrKey = sensenovaKey;
      currentBaseUrl = sensenovaUrl;
      activeProtocol = 'openai';
      authMethodForBackend = 'openai';
    } else if (provider === 'anthropic') {
      tokenOrKey = anthropicKey;
      currentBaseUrl = anthropicUrl;
      activeProtocol = 'anthropic';
      authMethodForBackend = 'anthropic';
    } else if (provider === 'google') {
      tokenOrKey = googleAuthMethod === 'oauth' ? googleOauthToken : googleKey;
      currentBaseUrl = googleUrl;
      activeProtocol = 'google';
      authMethodForBackend = googleAuthMethod === 'oauth' ? 'google-oauth' : 'google-key';
    }

    // Auto-fix user pasting full chat endpoint instead of base URL
    if (currentBaseUrl.endsWith('/chat/completions')) {
      currentBaseUrl = currentBaseUrl.replace('/chat/completions', '');
    }
    if (currentBaseUrl.endsWith('/')) {
      currentBaseUrl = currentBaseUrl.slice(0, -1);
    }

    if (!userTask || !userTask.trim()) return;
    
    if (!tokenOrKey) {
      alert(`Please configure your ${provider} credentials first!`);
      return;
    }
    const newAiMsgId = crypto.randomUUID();
    setMessages(prev => [
      ...prev, 
      { id: crypto.randomUUID(), role: 'user', content: userTask, statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true },
      { id: newAiMsgId, role: 'ai', content: '', statusLogs: ['Initializing Agent...'], agentSteps: [], apiCallCount: 0, isComplete: false }
    ]);
    
    // Prepare chat history to send to backend (excluding the hardcoded init message)
    const chatHistory = messages
      .filter(m => m.id !== 'init')
      .map(m => {
        let textContent = m.content || '';
        if (m.role === 'ai' && !textContent && m.agentSteps && m.agentSteps.length > 0) {
           const toolsUsed = m.agentSteps.flatMap(s => (s.actions || []).map((a: any) => a.toolName)).filter(Boolean);
           if (toolsUsed.length > 0) {
              textContent = `[Executed tools: ${toolsUsed.join(', ')}]`;
           }
        }
        return {
          role: m.role === 'user' ? 'user' : 'assistant', // Map to CoreMessage roles
          content: textContent
        };
      })
      .filter(m => !!m.content); // Only keep messages that have some textual context

    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      setIsRunning(true);
      try {
        // @ts-ignore
        const result = await window.ipcRenderer.invoke('agent:run-task', { protocol: activeProtocol, authMethod: authMethodForBackend, tokenOrKey, plannerModel, workerModel, maxSteps, task: userTask, workspacePath, baseUrl: currentBaseUrl, chatHistory, runId: newAiMsgId });
        setMessages(prev => {
          const newMsgs = [...prev];
          if (newMsgs.length === 0) return prev;
          const last = { ...newMsgs[newMsgs.length - 1] };
          last.isComplete = true;
          if (typeof result === 'string' && result.startsWith('Error:')) {
             last.content += `\n\n**[Error]**\n${result}`;
          }
          newMsgs[newMsgs.length - 1] = last;
          return newMsgs;
        });
      } catch (e: any) {
        setMessages(prev => {
          const newMsgs = [...prev];
          if (newMsgs.length === 0) return prev;
          const last = { ...newMsgs[newMsgs.length - 1] };
          last.isComplete = true;
          last.content += `\n\n**[Error]**\n${e.message}`;
          newMsgs[newMsgs.length - 1] = last;
          return newMsgs;
        });
      } finally {
        setIsRunning(false);
      }
    } else {
      setMessages(prev => {
        const newMsgs = [...prev];
        newMsgs[newMsgs.length-1].content = '[Error] ipcRenderer is not available.';
        newMsgs[newMsgs.length-1].isComplete = true;
        return newMsgs;
      });
    }
  };

  const handleStop = () => {
    setIsRunning(false);
    setMessages(prev => {
      const newMsgs = [...prev];
      if (newMsgs.length === 0) return prev;
      const last = { ...newMsgs[newMsgs.length - 1] };
      if (!last.isComplete) {
        if (typeof window !== 'undefined' && (window as any).ipcRenderer) {
          (window as any).ipcRenderer.invoke('agent:stop-task', { runId: last.id }).catch(console.error);
        }
        last.isComplete = true;
        last.content = (last.content || '') + '\n\n*[Stopped by user]*';
        newMsgs[newMsgs.length - 1] = last;
      }
      return newMsgs;
    });
  };


  return (
    <>
    {workspacePath ? (
    <div className="app-container">
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
                <button 
                  onClick={refreshFileTree}
                  style={{padding: '2px 6px', fontSize: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'white', borderRadius: '4px', cursor: 'pointer'}}
                  title="Refresh File Tree"
                >
                  🔄
                </button>
              )}
              <button 
                onClick={handleOpenWorkspace}
                style={{padding: '2px 6px', fontSize: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'white', borderRadius: '4px', cursor: 'pointer'}}
              >
                Open Folder
              </button>
            </div>
          </div>
          {workspacePath && <div style={{fontSize: '10px', color: 'var(--accent)', marginBottom: '5px', wordBreak: 'break-all'}}>{workspacePath}</div>}
          
          {fileTree.map(node => (
            <FileTreeNode 
              key={node.path} 
              node={node} 
              activeTab={activeTab} 
              onSelect={(path) => {
                setOpenTabs(prev => {
                  if (!prev.includes(path)) return [...prev, path];
                  return prev;
                });
                setActiveTab(path);
              }}
              onContextMenu={(e, path, isDir) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, path, isDir });
              }}
              editingNode={editingNode}
              onEditComplete={handleEditComplete}
              onEditCancel={() => setEditingNode(null)}
            />
          ))}
          {fileTree.length === 0 && <div className="file-item" style={{color:'var(--text-secondary)', padding: '10px'}}>No files yet. Please open a folder.</div>}
        </div>

      </div>
      <div className="resizer-horizontal" onMouseDown={startResizingSidebar} />

      <div className="editor-container" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div className="editor-header" style={{ display: 'flex', backgroundColor: '#252526', borderBottom: '1px solid var(--border-color)', alignItems: 'center', width: '100%', overflow: 'hidden' }}>
          <div className="tab-bar" style={{ display: 'flex', overflowX: 'auto', flex: 1, borderBottom: 'none', minWidth: 0, paddingRight: '8px' }}>
            {openTabs.map(tab => {
              const isTabActive = tab === activeTab;
              return (
                <div 
                  key={tab} 
                  className={`tab ${isTabActive ? 'active' : ''}`}
                  onClick={() => { setActiveTab(tab); setDiffState(null); }}
                >
                  <span>{tab.split(/[/\\]/).pop()}</span>
                  <span 
                    className="tab-close" 
                    onClick={(e) => {
                      e.stopPropagation();
                      const newTabs = openTabs.filter(t => t !== tab);
                      setOpenTabs(newTabs);
                      if (isTabActive) {
                        setActiveTab(newTabs.length > 0 ? newTabs[newTabs.length - 1] : '');
                      }
                    }}
                  >
                    ×
                  </span>
                </div>
              );
            })}
          </div>
          
          {activeTab && activeTab.endsWith('.html') && (
            <button 
              onClick={() => {
                // @ts-ignore
                window.ipcRenderer.invoke('agent:open-browser-window', { url: `file://${activeTab}` });
              }}
              title="Preview this HTML file in a new window"
              style={{ background: 'var(--accent)', color: 'white', border: 'none', padding: '4px 12px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', marginRight: '8px', flexShrink: 0 }}
            >
              🌐 Preview
            </button>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {diffState ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px', background: '#252526', borderBottom: '1px solid #3c3c3c', fontSize: '11px', color: '#aaa', flexShrink: 0 }}>
                <span style={{ color: '#4CAF50' }}>＋</span>
                <span style={{ color: '#F44336' }}>－</span>
                <span>Diff View (Side-by-Side)</span>
                <button
                  onClick={() => setDiffState(null)}
                  style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #3c3c3c', color: '#aaa', borderRadius: '4px', cursor: 'pointer', padding: '2px 8px', fontSize: '11px' }}
                >
                  ✕ Close Diff
                </button>
              </div>
              <DiffEditor
                height="100%"
                language="javascript"
                theme="vs-dark"
                original={diffState.original}
                modified={diffState.modified}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  enableSplitViewResizing: true
                }}
              />
            </>
          ) : (
            <Editor
              height="100%"
              defaultLanguage="javascript"
              theme="vs-dark"
              value={activeFileContent}
              onMount={(editor) => {
                editorRef.current = editor;
              }}
              onChange={(val) => {
                if (activeTab) {
                  setActiveFileContent(val || '');
                }
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: 'on'
              }}
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

      <div className="chat-container" style={{ width: 'var(--chat-width)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 15px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
            <button onClick={handleNewChat} style={{ background: 'var(--accent)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
              ➕ New Chat
            </button>
            <button onClick={() => setIsHistoryOpen(true)} style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
              💬 History
            </button>
          </div>
          <div className="chat-messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`message ${msg.role}`}>
                {msg.role === 'ai' && (
                  <div className="message-header" style={{display: 'flex', justifyContent: 'space-between'}}>
                    <span>Dual-Engine Agent</span>
                    {msg.apiCallCount > 0 && (
                      <span style={{backgroundColor: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', color: 'var(--accent)'}}>
                        🤖 API Calls: {msg.apiCallCount}
                      </span>
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
                                <a 
                                  href={href} 
                                  {...props}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    if (href) {
                                      let targetUrl = href;
                                      if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('file://')) {
                                        targetUrl = `file://${workspacePath}/${href.startsWith('/') ? href.slice(1) : href}`;
                                      }
                                      // @ts-ignore
                                      window.ipcRenderer.invoke('agent:open-browser-window', { url: targetUrl }).catch(console.error);
                                    }
                                  }}
                                  style={{ cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}
                                >
                                  {children}
                                </a>
                              )
                            },
                            code({node, inline, className, children, ...props}: any) {
                              const match = /language-(\w+)/.exec(className || '')
                              return !inline && match ? (
                                <SyntaxHighlighter
                                  {...props}
                                  children={String(children).replace(/\n$/, '')}
                                  style={vscDarkPlus}
                                  language={match[1]}
                                  PreTag="div"
                                />
                              ) : (
                                <code {...props} className={className}>
                                  {children}
                                </code>
                              )
                            }
                          }}
                        >
                          {finalContent}
                        </ReactMarkdown>
                      )}
                    </div>
                  );
                })()}
                
                {msg.plan && msg.plan.subtasks && msg.plan.subtasks.length > 0 && (
                  <div className="plan-container">
                    <div className="plan-title">Subtasks to Execute:</div>
                    <div className="plan-subtasks">
                      {msg.plan.subtasks.map((st: any, i: number) => (
                        <div key={st.id || i} className="plan-subtask-item">
                          <div className="subtask-desc">
                            <span className="subtask-num">{i + 1}.</span> 
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
                
                {msg.agentSteps && msg.agentSteps.length > 0 && (() => {
                  const mergedSteps: any[] = [];
                  for (let i = 0; i < msg.agentSteps.length; i++) {
                    const step = msg.agentSteps[i];
                    const prev = mergedSteps[mergedSteps.length - 1];
                    const stepHasActions = step.actions && step.actions.length > 0;
                    const prevHasFailure = prev && prev.results && prev.results.some((r: any) => r.success === false);
                    
                    if (stepHasActions && prevHasFailure) {
                      mergedSteps[mergedSteps.length - 1] = {
                        ...step,
                        retryCount: (prev.retryCount || 0) + 1,
                        retryHistory: [...(prev.retryHistory || [prev]), prev],
                        thought: step.thought || prev.thought
                      };
                      continue;
                    }
                    mergedSteps.push({ ...step, retryCount: 0 });
                  }
                  return (
                  <div className="agent-steps-container" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                    {mergedSteps.map((step, idx) => (
                      <AgentStepView 
                        key={idx}
                        step={step}
                        idx={idx}
                        mergedSteps={mergedSteps}
                        msg={msg}
                        openTabs={openTabs}
                        setOpenTabs={setOpenTabs}
                        setActiveTab={setActiveTab}
                        setDiffState={setDiffState}
                      />
                    ))}
                  </div>
                )})()}
                
                {!msg.content && !msg.isComplete && msg.statusLogs.length === 0 && (
                  <div className="typing-indicator" style={{marginTop: '10px'}}>
                    <span></span><span></span><span></span>
                  </div>
                )}

                {msg.statusLogs.length > 0 && !msg.isComplete && (
                  <div className="status-log" style={{ marginTop: '10px' }}>
                    {msg.statusLogs[msg.statusLogs.length - 1]}
                    <div className="typing-indicator">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <ChatInputBox 
            onSend={handleSend}
            isRunning={isRunning}
            handleStop={handleStop}
            messages={messages}
            plannerModel={plannerModel}
            setPlannerModel={setPlannerModel}
            workerModel={workerModel}
            setWorkerModel={setWorkerModel}
            availableModels={availableModels}
          />
        </div>
      </div>
    ) : (
      <div className="welcome-container">
        <h1 className="welcome-title">Dual-Engine Agent</h1>
        <p className="welcome-subtitle">
          Your intelligent, context-aware coding assistant.
          <br/>
          Open a folder to start building, refactoring, and debugging with ease.
        </p>
        <button className="welcome-button" onClick={handleOpenWorkspace}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          Open Folder
        </button>
        
        <button onClick={() => setIsSettingsOpen(true)} style={{marginTop: '40px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', textDecoration: 'underline'}}>
          Configure Settings
        </button>
      </div>
    )}
      
      {contextMenu && (
        <ContextMenu 
          x={contextMenu.x} 
          y={contextMenu.y} 
          isDir={contextMenu.isDir} 
          onAction={handleContextMenuAction} 
          onClose={() => setContextMenu(null)} 
        />
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        activeTab={activeSettingsTab}
        setActiveTab={setActiveSettingsTab}
        provider={provider}
        setProvider={setProvider}
        openaiKey={openaiKey}
        setOpenaiKey={setOpenaiKey}
        sensenovaKey={sensenovaKey}
        setSensenovaKey={setSensenovaKey}
        anthropicKey={anthropicKey}
        setAnthropicKey={setAnthropicKey}
        googleKey={googleKey}
        setGoogleKey={setGoogleKey}
        openaiUrl={openaiUrl}
        setOpenaiUrl={setOpenaiUrl}
        sensenovaUrl={sensenovaUrl}
        setSensenovaUrl={setSensenovaUrl}
        anthropicUrl={anthropicUrl}
        setAnthropicUrl={setAnthropicUrl}
        googleUrl={googleUrl}
        setGoogleUrl={setGoogleUrl}
        plannerModel={plannerModel}
        setPlannerModel={setPlannerModel}
        workerModel={workerModel}
        setWorkerModel={setWorkerModel}
        maxSteps={maxSteps}
        setMaxSteps={setMaxSteps}
        showHiddenFiles={showHiddenFiles}
        setShowHiddenFiles={setShowHiddenFiles}
        googleAuthMethod={googleAuthMethod}
        setGoogleAuthMethod={setGoogleAuthMethod}
        googleOauthToken={googleOauthToken}
        isLoadingModels={isLoadingModels}
        availableModels={availableModels}
        handleOAuthLogin={handleOAuthLogin}
        handleLogout={handleLogout}
      />
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        conversations={conversations}
        currentConversationId={currentConversationId}
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
  )
}

export default App
