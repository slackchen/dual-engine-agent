import React, { useState, useEffect, useRef } from 'react';
import './index.css';
// @ts-ignore
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

type Message = {
  id: string;
  role: 'user' | 'ai';
  content: string;
  statusLogs: string[];
  plan?: {
    summary: string;
    subtasks: { id: string, description: string, expected_output: string }[];
  };
  agentSteps: any[];
  apiCallCount: number;
  isComplete: boolean;
};

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

function App() {
  const [provider, setProvider] = useState<'openai' | 'sensenova' | 'anthropic' | 'google'>(
    (localStorage.getItem('active_provider') as 'openai' | 'sensenova' | 'anthropic' | 'google') || 'openai'
  );

  // OpenAI
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem('provider_openai_key') || '');
  const [openaiUrl, setOpenaiUrl] = useState(localStorage.getItem('provider_openai_url') || 'https://api.openai.com/v1');

  // SenseNova
  const [sensenovaKey, setSensenovaKey] = useState(localStorage.getItem('provider_sensenova_key') || '');
  const [sensenovaUrl, setSensenovaUrl] = useState(localStorage.getItem('provider_sensenova_url') || 'https://token.sensenova.cn/v1');

  // Anthropic
  const [anthropicKey, setAnthropicKey] = useState(localStorage.getItem('protocol_anthropic_key') || '');
  const [anthropicUrl, setAnthropicUrl] = useState(localStorage.getItem('protocol_anthropic_url') || 'https://api.anthropic.com/v1');

  // Google
  const [googleAuthMethod, setGoogleAuthMethod] = useState<'oauth' | 'key'>(
    (localStorage.getItem('protocol_google_auth_method') as 'oauth' | 'key') || 'oauth'
  );
  const [googleKey, setGoogleKey] = useState(localStorage.getItem('protocol_google_key') || '');
  const [googleUrl, setGoogleUrl] = useState(localStorage.getItem('protocol_google_url') || 'https://generativelanguage.googleapis.com/v1beta');
  const [googleOauthToken, setGoogleOauthToken] = useState(localStorage.getItem('antigravity_token') || '');
  
  const [isEditingBaseUrl, setIsEditingBaseUrl] = useState(false);
  
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [plannerModel, setPlannerModel] = useState<string>(localStorage.getItem('planner_model') || '');
  const [workerModel, setWorkerModel] = useState<string>(localStorage.getItem('worker_model') || '');
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const [workspacePath, setWorkspacePath] = useState<string>(
    localStorage.getItem('last_workspace_path') || ''
  );
  const [activeFile, setActiveFile] = useState<string>('');
  const [chatInput, setChatInput] = useState('');
  const [terminalLogs, setTerminalLogs] = useState<string>('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLogs]);
  
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
  
  const [fileSystem, setFileSystem] = useState<Record<string, any>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  useEffect(() => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      const listener = (event: any, data: any) => {
        setMessages(prev => {
          const newMessages = [...prev];
          if (newMessages.length === 0) return prev;
          
          const lastMsg = { ...newMessages[newMessages.length - 1] };
          if (lastMsg.role !== 'ai' || lastMsg.isComplete) return prev;
          
          if (data.type === 'status') {
             lastMsg.statusLogs = [...lastMsg.statusLogs, data.data];
          } else if (data.type === 'plan') {
             lastMsg.plan = data.data;
             lastMsg.content += `**[Plan Created]**\n${data.data.summary}\n\n`;
          } else if (data.type === 'subtask-result') {
             lastMsg.content += `\n\n---\n\n${data.data}`;
          } else if (data.type === 'fs-state') {
             setFileSystem(data.data);
          } else if (data.type === 'api-call') {
             lastMsg.apiCallCount = (lastMsg.apiCallCount || 0) + 1;
          } else if (data.type === 'agent-step') {
             lastMsg.agentSteps = [...(lastMsg.agentSteps || []), data.data];
          }
          
          newMessages[newMessages.length - 1] = lastMsg;
          return newMessages;
        });
      };
      
      const logListener = (event: any, data: string) => {
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

  // Auto-load the file tree for the persisted workspace path on mount
  useEffect(() => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined' && workspacePath) {
      // @ts-ignore
      window.ipcRenderer.invoke('agent:get-fs-tree', { workspacePath }).then((tree: any) => {
        setFileSystem(tree);
      }).catch((e: any) => console.error('Failed to load initial workspace', e));
    }
  }, []); // Only on mount

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
    const timeoutId = setTimeout(() => {
      fetchModels();
    }, 1000);
    
  }, [provider, openaiKey, sensenovaKey, anthropicKey, googleKey, googleOauthToken, googleAuthMethod, openaiUrl, sensenovaUrl, anthropicUrl, googleUrl]);

  const handleOAuthLogin = async () => {
    try {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: '[System] Opening browser for Google OAuth login...', statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);
      // @ts-ignore
      const token = await window.ipcRenderer.invoke('agent:login-oauth');
      setGoogleOauthToken(token);
      localStorage.setItem('antigravity_token', token);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: '[System] Google OAuth login successful!', statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: `[System Error] OAuth login failed: ${err.message}`, statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);
    }
  };

  const handleLogout = () => {
    setGoogleOauthToken('');
    setAvailableModels([]);
    localStorage.removeItem('antigravity_token');
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'ai', content: '[System] Logged out successfully. Token cleared.', statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true }]);
  };

  const handleOpenWorkspace = async () => {
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      // @ts-ignore
      const path = await window.ipcRenderer.invoke('agent:select-workspace');
      if (path) {
        setWorkspacePath(path);
        localStorage.setItem('last_workspace_path', path);
        // Scan the directory initially
        // @ts-ignore
        const tree = await window.ipcRenderer.invoke('agent:get-fs-tree', { workspacePath: path });
        setFileSystem(tree);
      }
    }
  };

  const handleSend = async () => {
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

    if (!chatInput.trim()) return;
    
    if (!tokenOrKey) {
      alert(`Please configure your ${provider} credentials first!`);
      return;
    }

    const userTask = chatInput;
    setChatInput('');
    setMessages(prev => [
      ...prev, 
      { id: crypto.randomUUID(), role: 'user', content: userTask, statusLogs: [], agentSteps: [], apiCallCount: 0, isComplete: true },
      { id: crypto.randomUUID(), role: 'ai', content: '', statusLogs: ['Initializing Agent...'], agentSteps: [], apiCallCount: 0, isComplete: false }
    ]);
    
    localStorage.setItem('active_provider', provider);
    localStorage.setItem('planner_model', plannerModel);
    localStorage.setItem('worker_model', workerModel);
    
    // @ts-ignore
    if (typeof window.ipcRenderer !== 'undefined') {
      // @ts-ignore
      const result = await window.ipcRenderer.invoke('agent:run-task', { protocol: activeProtocol, authMethod: authMethodForBackend, tokenOrKey, plannerModel, workerModel, task: userTask, workspacePath, baseUrl: currentBaseUrl });
      setMessages(prev => {
        const newMsgs = [...prev];
        if (newMsgs.length === 0) return prev;
        
        const last = { ...newMsgs[newMsgs.length - 1] };
        last.isComplete = true;
        if (result.startsWith('Error:')) {
           last.content += `\n\n**[Error]**\n${result}`;
        }
        newMsgs[newMsgs.length - 1] = last;
        return newMsgs;
      });
    } else {
      setMessages(prev => {
        const newMsgs = [...prev];
        newMsgs[newMsgs.length-1].content = '[Error] ipcRenderer is not available.';
        newMsgs[newMsgs.length-1].isComplete = true;
        return newMsgs;
      });
    }
  };

  const fileNodes = Object.keys(fileSystem);

  return (
    <>
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header" style={{display:'flex', justifyContent: 'space-between', alignItems: 'center'}}>
           <div style={{fontWeight: 'bold'}}>Dual-Engine Agent</div>
           <button onClick={() => setIsSettingsOpen(true)} style={{background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px'}}>
             ⚙️ Settings
           </button>
        </div>
        
        <div className="file-tree">
           

          <div style={{color:'var(--text-secondary)', fontSize:'11px', marginBottom:'5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <span style={{textTransform:'uppercase'}}>Workspace</span>
            <button 
              onClick={handleOpenWorkspace}
              style={{padding: '2px 6px', fontSize: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'white', borderRadius: '4px', cursor: 'pointer'}}
            >
              Open Folder
            </button>
          </div>
          {workspacePath && <div style={{fontSize: '10px', color: 'var(--accent)', marginBottom: '5px', wordBreak: 'break-all'}}>{workspacePath}</div>}
          
          {fileNodes.map(filePath => {
            const displayPath = workspacePath ? filePath.replace(workspacePath, '') : filePath;
            return (
            <div 
              key={filePath} 
              className="file-item" 
              onClick={() => setActiveFile(filePath)}
              style={{
                backgroundColor: activeFile === filePath ? 'var(--accent)' : 'transparent',
                fontWeight: activeFile === filePath ? 'bold' : 'normal'
              }}
            >
              📄 {displayPath}
            </div>
          )})}
          {fileNodes.length === 0 && <div className="file-item" style={{color:'var(--text-secondary)'}}>No files yet. Please open a folder.</div>}
        </div>

      </div>

      <div className="editor-container" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            height="100%"
            defaultLanguage="javascript"
            theme="vs-dark"
            value={fileSystem[activeFile] || '// Select a file to view code'}
            onChange={(val) => {
              if (activeFile) {
                setFileSystem(prev => ({ ...prev, [activeFile]: val || '' }));
                // Write back to real fs if user types
                try {
                  // This is a UI level edit, we could implement a save feature or auto-save.
                } catch(e) {}
              }
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: 'on'
            }}
          />
        </div>
        <div className="terminal-container" style={{ height: '200px', backgroundColor: '#1e1e1e', color: '#cccccc', padding: '10px', overflowY: 'auto', borderTop: '1px solid var(--border-color)', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
          <div style={{color: '#888', marginBottom: '5px', textTransform: 'uppercase', fontSize: '10px'}}>Terminal Logs</div>
          {terminalLogs || 'Terminal ready...'}
          <div ref={terminalEndRef} />
        </div>
      </div>

      <div className="chat-container">
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
                
                {msg.statusLogs.length > 0 && !msg.isComplete && (
                  <div className="status-log">
                    {msg.statusLogs[msg.statusLogs.length - 1]}
                    <div className="typing-indicator">
                      <span></span><span></span><span></span>
                    </div>
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
                                      // @ts-ignore
                                      window.ipcRenderer.invoke('agent:open-browser-window', { url: href });
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
                      {msg.plan.subtasks.map((st, i) => (
                        <div key={st.id || i} className="plan-subtask-item">
                          <div className="subtask-desc"><span className="subtask-num">{i + 1}.</span> {st.description}</div>
                          {st.expected_output && <div className="subtask-expected">Expected: {st.expected_output}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {msg.agentSteps && msg.agentSteps.length > 0 && (
                  <div className="agent-steps-container" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                    {msg.agentSteps.map((step, idx) => (
                      <div key={idx} className="agent-step-item" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px', fontSize: '12px' }}>
                        {step.thought && (
                          <div style={{ marginBottom: '6px', color: 'var(--text-secondary)' }}>
                            <span style={{ marginRight: '4px' }}>🤖</span> {step.thought}
                          </div>
                        )}
                        {step.actions && step.actions.map((act: any, actIdx: number) => {
                          const res = step.results ? step.results.find((r: any) => r.toolName === act.toolName) : null;
                          return (
                            <details key={actIdx} style={{ background: '#252526', borderRadius: '4px', border: '1px solid #3c3c3c', marginTop: '4px' }}>
                              <summary style={{ padding: '6px', cursor: 'pointer', outline: 'none', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>🔧 {act.toolName}</span>
                                {res && (
                                  <span style={{ marginLeft: 'auto', color: res.success ? '#4CAF50' : '#F44336' }}>
                                    {res.success ? '✅ Success' : '❌ Failed'}
                                  </span>
                                )}
                              </summary>
                              <div style={{ padding: '6px', borderTop: '1px solid #3c3c3c', color: '#ccc' }}>
                                <div style={{ marginBottom: '4px', fontWeight: 'bold', color: '#888' }}>Arguments:</div>
                                <pre style={{ margin: 0, background: '#1e1e1e', padding: '4px', borderRadius: '4px', overflowX: 'auto', fontSize: '11px' }}>
                                  {JSON.stringify(act.args, null, 2)}
                                </pre>
                                {res && (
                                  <>
                                    <div style={{ marginTop: '6px', marginBottom: '4px', fontWeight: 'bold', color: '#888' }}>Result:</div>
                                    <div style={{ background: '#1e1e1e', padding: '4px', borderRadius: '4px', overflowX: 'auto', fontSize: '11px', whiteSpace: 'pre-wrap' }}>
                                      {res.message}
                                    </div>
                                  </>
                                )}
                              </div>
                            </details>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
                
                {!msg.content && !msg.isComplete && msg.statusLogs.length === 0 && (
                  <div className="typing-indicator" style={{marginTop: '10px'}}>
                    <span></span><span></span><span></span>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <div className="chat-input">
            <input 
              type="text" 
              placeholder="Ask the Agent to do something..." 
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  handleSend();
                }
              }}
            />
            <button onClick={handleSend}>Send</button>
          </div>
        </div>
      </div>
      
      {isSettingsOpen && (
        <div className="modal-overlay" style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000}}>
          <div className="modal-content" style={{backgroundColor: 'var(--bg-secondary)', padding: '20px', borderRadius: '8px', width: '400px', border: '1px solid var(--border-color)'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
              <h3 style={{margin: 0}}>Settings</h3>
              <button onClick={() => setIsSettingsOpen(false)} style={{background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px'}}>✕</button>
            </div>
            
            <div style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
              <div>
                <div style={{fontWeight: 'bold', marginBottom: '5px', fontSize: '12px'}}>Authentication Provider</div>
                <div style={{display:'flex', gap:'10px', fontSize:'12px', flexWrap: 'wrap'}}>
                  <label><input type="radio" name="provider" checked={provider === 'openai'} onChange={() => { setProvider('openai'); localStorage.setItem('active_provider', 'openai'); }} /> OpenAI</label>
                  <label><input type="radio" name="provider" checked={provider === 'sensenova'} onChange={() => { setProvider('sensenova'); localStorage.setItem('active_provider', 'sensenova'); }} /> SenseNova</label>
                  <label><input type="radio" name="provider" checked={provider === 'anthropic'} onChange={() => { setProvider('anthropic'); localStorage.setItem('active_provider', 'anthropic'); }} /> Anthropic</label>
                  <label><input type="radio" name="provider" checked={provider === 'google'} onChange={() => { setProvider('google'); localStorage.setItem('active_provider', 'google'); }} /> Google Gemini</label>
                </div>
              </div>
              
              {(provider === 'openai' || provider === 'sensenova' || provider === 'anthropic') && (
                <div>
                  <div style={{fontWeight: 'bold', marginBottom: '5px', fontSize: '12px'}}>API Key</div>
                  <div style={{display: 'flex', gap: '5px', marginBottom: '10px'}}>
                    <input 
                      type={showApiKey ? "text" : "password"} 
                      placeholder={`Enter ${provider === 'openai' ? 'OpenAI' : (provider === 'sensenova' ? 'SenseNova' : 'Anthropic')} API Key`} 
                      value={provider === 'openai' ? openaiKey : (provider === 'sensenova' ? sensenovaKey : anthropicKey)} 
                      onChange={e => {
                        const val = e.target.value;
                        if (provider === 'openai') { setOpenaiKey(val); localStorage.setItem('provider_openai_key', val); }
                        else if (provider === 'sensenova') { setSensenovaKey(val); localStorage.setItem('provider_sensenova_key', val); }
                        else { setAnthropicKey(val); localStorage.setItem('provider_anthropic_key', val); }
                      }} 
                      style={{flex: 1, padding:'6px', fontSize:'12px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px'}}
                    />
                    <button onClick={() => setShowApiKey(!showApiKey)} style={{padding: '4px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', borderRadius: '4px', cursor: 'pointer'}}>
                      {showApiKey ? '🙈' : '👁️'}
                    </button>
                    <button onClick={() => {
                        const key = provider === 'openai' ? openaiKey : (provider === 'sensenova' ? sensenovaKey : anthropicKey);
                        navigator.clipboard.writeText(key);
                      }} 
                      style={{padding: '4px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', borderRadius: '4px', cursor: 'pointer'}} title="Copy API Key">
                      📋
                    </button>
                  </div>
                  
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px'}}>
                    <div style={{fontWeight: 'bold', fontSize: '12px'}}>Base URL</div>
                    <button onClick={() => setIsEditingBaseUrl(!isEditingBaseUrl)} style={{background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px', padding: 0}}>
                      ✏️ Edit
                    </button>
                  </div>
                  <input 
                    type="text" 
                    readOnly={!isEditingBaseUrl}
                    value={provider === 'openai' ? openaiUrl : (provider === 'sensenova' ? sensenovaUrl : anthropicUrl)} 
                    onChange={e => {
                      const val = e.target.value;
                      if (provider === 'openai') { setOpenaiUrl(val); localStorage.setItem('provider_openai_url', val); }
                      else if (provider === 'sensenova') { setSensenovaUrl(val); localStorage.setItem('provider_sensenova_url', val); }
                      else { setAnthropicUrl(val); localStorage.setItem('provider_anthropic_url', val); }
                    }}
                    style={{width: '100%', padding:'6px', fontSize:'12px', background: isEditingBaseUrl ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: isEditingBaseUrl ? 'text' : 'not-allowed', boxSizing: 'border-box'}}
                  />
                </div>
              )}

              {provider === 'google' && (
                <div>
                  <div style={{fontWeight: 'bold', marginBottom: '5px', fontSize: '12px'}}>Authentication Method</div>
                  <div style={{display:'flex', gap:'10px', fontSize:'12px', flexWrap: 'wrap', marginBottom: '10px'}}>
                    <label><input type="radio" name="google-auth" checked={googleAuthMethod === 'oauth'} onChange={() => { setGoogleAuthMethod('oauth'); localStorage.setItem('protocol_google_auth_method', 'oauth'); }} /> OAuth (Browser)</label>
                    <label><input type="radio" name="google-auth" checked={googleAuthMethod === 'key'} onChange={() => { setGoogleAuthMethod('key'); localStorage.setItem('protocol_google_auth_method', 'key'); }} /> API Key</label>
                  </div>

                  {googleAuthMethod === 'key' ? (
                    <>
                      <div style={{fontWeight: 'bold', marginBottom: '5px', fontSize: '12px'}}>API Key</div>
                      <div style={{display: 'flex', gap: '5px', marginBottom: '10px'}}>
                        <input 
                          type={showApiKey ? "text" : "password"} 
                          placeholder="Enter Google API Key" 
                          value={googleKey} 
                          onChange={e => {
                            const val = e.target.value;
                            setGoogleKey(val); localStorage.setItem('protocol_google_key', val);
                          }} 
                          style={{flex: 1, padding:'6px', fontSize:'12px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px'}}
                        />
                        <button onClick={() => setShowApiKey(!showApiKey)} style={{padding: '4px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', borderRadius: '4px', cursor: 'pointer'}}>
                          {showApiKey ? '🙈' : '👁️'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{fontWeight: 'bold', marginBottom: '5px', fontSize: '12px'}}>OAuth Authorization</div>
                      <div style={{display: 'flex', gap: '5px'}}>
                        <button 
                          onClick={handleOAuthLogin}
                          style={{flex: 1, padding:'6px 12px', fontSize:'12px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                        >
                          {googleOauthToken ? 'Re-authenticate' : 'Login with Google'}
                        </button>
                        {googleOauthToken && (
                          <button 
                            onClick={handleLogout}
                            style={{padding:'6px 12px', fontSize:'12px', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                          >
                            Logout
                          </button>
                        )}
                      </div>
                      {googleOauthToken && <div style={{fontSize: '11px', color: 'var(--text-secondary)', marginTop: '5px'}}>Logged in successfully.</div>}
                    </>
                  )}
                  
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', marginBottom: '5px'}}>
                    <div style={{fontWeight: 'bold', fontSize: '12px'}}>Base URL</div>
                    <button onClick={() => setIsEditingBaseUrl(!isEditingBaseUrl)} style={{background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px', padding: 0}}>
                      ✏️ Edit
                    </button>
                  </div>
                  <input 
                    type="text" 
                    readOnly={!isEditingBaseUrl}
                    value={googleUrl} 
                    onChange={e => {
                      const val = e.target.value;
                      setGoogleUrl(val); 
                      localStorage.setItem('protocol_google_url', val);
                    }}
                    style={{width: '100%', padding:'6px', fontSize:'12px', background: isEditingBaseUrl ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: isEditingBaseUrl ? 'text' : 'not-allowed', boxSizing: 'border-box'}}
                  />
                </div>
              )}

              {(openaiKey || sensenovaKey || anthropicKey || googleKey || googleOauthToken) && (
                <div>
                  <div style={{fontWeight: 'bold', marginBottom: '5px', fontSize: '12px'}}>{isLoadingModels ? 'Loading models...' : 'Model Configuration'}</div>
                  <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                    <div>
                      <div style={{fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px'}}>Planner Model</div>
                      <select 
                        value={plannerModel} 
                        onChange={e => { setPlannerModel(e.target.value); localStorage.setItem('planner_model', e.target.value); }}
                        style={{width: '100%', padding: '6px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px'}}
                      >
                        <option value="" disabled>Select Planner Model</option>
                        {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px'}}>Worker Model</div>
                      <select 
                        value={workerModel} 
                        onChange={e => { setWorkerModel(e.target.value); localStorage.setItem('worker_model', e.target.value); }}
                        style={{width: '100%', padding: '6px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px'}}
                      >
                        <option value="" disabled>Select Worker Model</option>
                        {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div style={{marginTop: '20px', display: 'flex', justifyContent: 'flex-end'}}>
               <button onClick={() => setIsSettingsOpen(false)} style={{padding: '6px 16px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}>
                 Done
               </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
