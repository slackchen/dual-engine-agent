import React, { useState } from 'react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: 'general' | 'auth' | 'models';
  setActiveTab: (tab: 'general' | 'auth' | 'models') => void;
  provider: string;
  setProvider: (p: string) => void;
  openaiKey: string;
  setOpenaiKey: (k: string) => void;
  sensenovaKey: string;
  setSensenovaKey: (k: string) => void;
  anthropicKey: string;
  setAnthropicKey: (k: string) => void;
  googleKey: string;
  setGoogleKey: (k: string) => void;
  openaiUrl: string;
  setOpenaiUrl: (u: string) => void;
  sensenovaUrl: string;
  setSensenovaUrl: (u: string) => void;
  anthropicUrl: string;
  setAnthropicUrl: (u: string) => void;
  googleUrl: string;
  setGoogleUrl: (u: string) => void;
  plannerModel: string;
  setPlannerModel: (m: string) => void;
  workerModel: string;
  setWorkerModel: (m: string) => void;
  maxSteps: number;
  setMaxSteps: (s: number) => void;
  showHiddenFiles: boolean;
  setShowHiddenFiles: (s: boolean) => void;
  googleAuthMethod: string;
  setGoogleAuthMethod: (m: string) => void;
  googleOauthToken: string;
  isLoadingModels: boolean;
  availableModels: string[];
  handleOAuthLogin: () => void;
  handleLogout: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen, onClose, activeTab, setActiveTab,
  provider, setProvider, openaiKey, setOpenaiKey, sensenovaKey, setSensenovaKey, anthropicKey, setAnthropicKey, googleKey, setGoogleKey,
  openaiUrl, setOpenaiUrl, sensenovaUrl, setSensenovaUrl, anthropicUrl, setAnthropicUrl, googleUrl, setGoogleUrl,
  plannerModel, setPlannerModel, workerModel, setWorkerModel, maxSteps, setMaxSteps,
  showHiddenFiles, setShowHiddenFiles,
  googleAuthMethod, setGoogleAuthMethod, googleOauthToken,
  isLoadingModels, availableModels,
  handleOAuthLogin, handleLogout
}) => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [isEditingBaseUrl, setIsEditingBaseUrl] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000}}>
      <div className="modal-content" style={{backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', width: '600px', height: '400px', border: '1px solid var(--border-color)', display: 'flex', overflow: 'hidden'}}>
        
        {/* Left Sidebar for Tabs */}
        <div style={{ width: '150px', background: 'var(--bg-primary)', borderRight: '1px solid var(--border-color)', padding: '20px 0', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '0 20px', marginBottom: '20px', fontWeight: 'bold' }}>Settings</div>
          <button 
            onClick={() => setActiveTab('auth')}
            style={{ background: activeTab === 'auth' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', border: 'none', padding: '10px 20px', textAlign: 'left', cursor: 'pointer', borderLeft: activeTab === 'auth' ? '3px solid var(--accent)' : '3px solid transparent' }}
          >Provider & Auth</button>
          <button 
            onClick={() => setActiveTab('models')}
            style={{ background: activeTab === 'models' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', border: 'none', padding: '10px 20px', textAlign: 'left', cursor: 'pointer', borderLeft: activeTab === 'models' ? '3px solid var(--accent)' : '3px solid transparent' }}
          >Models</button>
          <button 
            onClick={() => setActiveTab('general')}
            style={{ background: activeTab === 'general' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', border: 'none', padding: '10px 20px', textAlign: 'left', cursor: 'pointer', borderLeft: activeTab === 'general' ? '3px solid var(--accent)' : '3px solid transparent' }}
          >General</button>
        </div>

        {/* Right Pane for Content */}
        <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column' }}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
            <h3 style={{margin: 0}}>
              {activeTab === 'general' && 'General Settings'}
              {activeTab === 'auth' && 'Authentication Provider'}
              {activeTab === 'models' && 'Model Configuration'}
            </h3>
            <button onClick={onClose} style={{background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px'}}>✕</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px', paddingRight: '10px' }}>
            
            {/* --- AUTH TAB --- */}
            {activeTab === 'auth' && (
              <>
                <div>
                  <div style={{fontWeight: 'bold', marginBottom: '5px', fontSize: '12px'}}>Authentication Provider</div>
                  <div style={{display:'flex', gap:'10px', fontSize:'12px', flexWrap: 'wrap'}}>
                    <label><input type="radio" name="provider" checked={provider === 'openai'} onChange={() => { setProvider('openai');  }} /> OpenAI</label>
                    <label><input type="radio" name="provider" checked={provider === 'sensenova'} onChange={() => { setProvider('sensenova');  }} /> SenseNova</label>
                    <label><input type="radio" name="provider" checked={provider === 'anthropic'} onChange={() => { setProvider('anthropic');  }} /> Anthropic</label>
                    <label><input type="radio" name="provider" checked={provider === 'google'} onChange={() => { setProvider('google');  }} /> Google Gemini</label>
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
                          if (provider === 'openai') { setOpenaiKey(val);  }
                          else if (provider === 'sensenova') { setSensenovaKey(val);  }
                          else { setAnthropicKey(val);  }
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
                        if (provider === 'openai') { setOpenaiUrl(val);  }
                        else if (provider === 'sensenova') { setSensenovaUrl(val);  }
                        else { setAnthropicUrl(val);  }
                      }}
                      style={{width: '100%', padding:'6px', fontSize:'12px', background: isEditingBaseUrl ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: isEditingBaseUrl ? 'text' : 'not-allowed', boxSizing: 'border-box'}}
                    />
                  </div>
                )}

                {provider === 'google' && (
                  <div>
                    <div style={{fontWeight: 'bold', marginBottom: '5px', fontSize: '12px'}}>Authentication Method</div>
                    <div style={{display:'flex', gap:'10px', fontSize:'12px', flexWrap: 'wrap', marginBottom: '10px'}}>
                      <label><input type="radio" name="google-auth" checked={googleAuthMethod === 'oauth'} onChange={() => { setGoogleAuthMethod('oauth');  }} /> OAuth (Browser)</label>
                      <label><input type="radio" name="google-auth" checked={googleAuthMethod === 'key'} onChange={() => { setGoogleAuthMethod('key');  }} /> API Key</label>
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
                              setGoogleKey(val); 
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
                        
                      }}
                      style={{width: '100%', padding:'6px', fontSize:'12px', background: isEditingBaseUrl ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: isEditingBaseUrl ? 'text' : 'not-allowed', boxSizing: 'border-box'}}
                    />
                  </div>
                )}
              </>
            )}

            {/* --- MODELS TAB --- */}
            {activeTab === 'models' && (
              <div>
                {isLoadingModels ? (
                   <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Loading models...</div>
                ) : (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
                    <div>
                      <div style={{fontSize: '12px', fontWeight: 'bold', marginBottom: '5px'}}>Planner Model</div>
                      <div style={{fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '5px'}}>Used for high-level reasoning and planning.</div>
                      <select 
                        value={plannerModel} 
                        onChange={e => { setPlannerModel(e.target.value);  }}
                        style={{width: '100%', padding: '6px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px'}}
                      >
                        <option value="" disabled>Select Planner Model</option>
                        {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize: '12px', fontWeight: 'bold', marginBottom: '5px'}}>Worker Model</div>
                      <div style={{fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '5px'}}>Used for executing specific tasks quickly.</div>
                      <select 
                        value={workerModel} 
                        onChange={e => { setWorkerModel(e.target.value);  }}
                        style={{width: '100%', padding: '6px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px'}}
                      >
                        <option value="" disabled>Select Worker Model</option>
                        {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* --- GENERAL TAB --- */}
            {activeTab === 'general' && (
              <div style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
                <div>
                  <div style={{fontWeight: 'bold', marginBottom: '5px', fontSize: '12px'}}>Max Tool Steps (Retries)</div>
                  <div style={{fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '5px'}}>The maximum number of sequential steps (including tool calls and self-corrections) the agent can take per request.</div>
                  <input 
                    type="number" 
                    min={1}
                    max={50}
                    value={maxSteps}
                    onChange={e => setMaxSteps(parseInt(e.target.value) || 20)}
                    style={{width: '100%', padding: '6px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px', boxSizing: 'border-box'}}
                  />
                </div>
                <div>
                  <div style={{fontWeight: 'bold', marginBottom: '10px', fontSize: '12px'}}>Explorer Settings</div>
                <label style={{display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer'}}>
                  <input 
                    type="checkbox" 
                    checked={showHiddenFiles}
                    onChange={(e) => setShowHiddenFiles(e.target.checked)}
                  />
                  Show hidden files (e.g. .DS_Store)
                </label>
              </div>
              </div>
            )}

          </div>

          {/* Action Buttons */}
          <div style={{marginTop: '20px', display: 'flex', justifyContent: 'flex-end'}}>
             <button onClick={onClose} style={{padding: '6px 16px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}>
               Done
             </button>
          </div>
        </div>
      </div>
    </div>
  );
};
