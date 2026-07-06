import React, { useEffect, useState } from 'react';
import {
  DEFAULT_BASE_URLS,
  PROVIDER_LABELS,
  type GoogleAuthMethod,
  type Provider,
  type ProviderConfig,
} from '../hooks/useAppConfig';
import {
  CONVERTER_PLUGIN_OPTIONS,
  getConverterPluginName,
  NO_CONVERTER_PLUGIN_ID,
  type ConverterPluginId,
} from '../converterPlugins';

type SettingsTab = 'general' | 'auth' | 'models';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
  providerConfigs: ProviderConfig[];
  modelsByConfigId: Record<string, string[]>;
  activeProviderConfigId: string;
  activeProviderConfig: ProviderConfig;
  setActiveProviderConfigId: (id: string) => void;
  updateProviderConfig: (id: string, patch: Partial<ProviderConfig>) => void;
  addProviderConfig: (provider?: Provider) => void;
  deleteProviderConfig: (id: string) => void;
  plannerProviderConfigId: string;
  setPlannerProviderConfigId: (id: string) => void;
  plannerModel: string;
  setPlannerModel: (m: string) => void;
  plannerAvailableModels: string[];
  isLoadingPlannerModels: boolean;
  workerProviderConfigId: string;
  setWorkerProviderConfigId: (id: string) => void;
  workerModel: string;
  setWorkerModel: (m: string) => void;
  workerAvailableModels: string[];
  isLoadingWorkerModels: boolean;
  maxSteps: number;
  setMaxSteps: (s: number) => void;
  showHiddenFiles: boolean;
  setShowHiddenFiles: (s: boolean) => void;
  handleOAuthLogin: () => void;
  handleLogout: () => void;
}

const PROVIDER_OPTIONS: Provider[] = ['openai', 'sensenova', 'anthropic', 'google'];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
  providerConfigs,
  modelsByConfigId,
  activeProviderConfigId,
  activeProviderConfig,
  setActiveProviderConfigId,
  updateProviderConfig,
  addProviderConfig,
  deleteProviderConfig,
  plannerProviderConfigId,
  setPlannerProviderConfigId,
  plannerModel,
  setPlannerModel,
  plannerAvailableModels,
  isLoadingPlannerModels,
  workerProviderConfigId,
  setWorkerProviderConfigId,
  workerModel,
  setWorkerModel,
  workerAvailableModels,
  isLoadingWorkerModels,
  maxSteps,
  setMaxSteps,
  showHiddenFiles,
  setShowHiddenFiles,
  handleOAuthLogin,
  handleLogout,
}) => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [isEditingBaseUrl, setIsEditingBaseUrl] = useState(false);
  const [overrideModel, setOverrideModel] = useState('');
  const [overrideConverterId, setOverrideConverterId] = useState<ConverterPluginId>('local-responses-proxy');

  const selected = activeProviderConfig;
  const selectedModels = modelsByConfigId[selected.id] || [];
  const modelConverterOverrides = selected.modelConverterOverrides || {};
  const modelOverrideEntries = Object.entries(modelConverterOverrides);
  const isGoogle = selected.provider === 'google';
  const googleAuthMethod: GoogleAuthMethod = selected.googleAuthMethod || 'oauth';
  const selectedSecret = isGoogle && googleAuthMethod === 'oauth'
    ? selected.googleOauthToken || ''
    : selected.apiKey;

  useEffect(() => {
    if (overrideModel && !selectedModels.includes(overrideModel)) {
      setOverrideModel('');
    }
  }, [overrideModel, selectedModels]);

  if (!isOpen) return null;

  const updateSelected = (patch: Partial<ProviderConfig>) => {
    updateProviderConfig(selected.id, patch);
  };

  const handleProviderChange = (provider: Provider) => {
    updateSelected({
      provider,
      baseUrl: DEFAULT_BASE_URLS[provider],
      googleAuthMethod: provider === 'google' ? googleAuthMethod : undefined,
      googleOauthToken: provider === 'google' ? selected.googleOauthToken || '' : undefined,
    });
    setIsEditingBaseUrl(false);
  };

  const handleDelete = () => {
    if (providerConfigs.length <= 1) return;
    if (window.confirm(`Delete configuration "${selected.name}"?`)) {
      deleteProviderConfig(selected.id);
    }
  };

  const setModelConverterOverride = () => {
    if (!overrideModel) return;
    updateSelected({
      modelConverterOverrides: {
        ...modelConverterOverrides,
        [overrideModel]: overrideConverterId,
      },
    });
  };

  const removeModelConverterOverride = (model: string) => {
    const next = { ...modelConverterOverrides };
    delete next[model];
    updateSelected({ modelConverterOverrides: next });
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px',
    fontSize: '12px',
    background: 'var(--bg-primary)',
    color: 'white',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    boxSizing: 'border-box',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '5px 9px',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-secondary)',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  };

  return (
    <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="modal-content" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', width: '680px', height: '520px', border: '1px solid var(--border-color)', display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: '160px', background: 'var(--bg-primary)', borderRight: '1px solid var(--border-color)', padding: '20px 0', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '0 20px', marginBottom: '20px', fontWeight: 'bold' }}>Settings</div>
          <button
            onClick={() => setActiveTab('auth')}
            style={{ background: activeTab === 'auth' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', border: 'none', padding: '10px 20px', textAlign: 'left', cursor: 'pointer', borderLeft: activeTab === 'auth' ? '3px solid var(--accent)' : '3px solid transparent' }}
          >Configurations</button>
          <button
            onClick={() => setActiveTab('models')}
            style={{ background: activeTab === 'models' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', border: 'none', padding: '10px 20px', textAlign: 'left', cursor: 'pointer', borderLeft: activeTab === 'models' ? '3px solid var(--accent)' : '3px solid transparent' }}
          >Models</button>
          <button
            onClick={() => setActiveTab('general')}
            style={{ background: activeTab === 'general' ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', border: 'none', padding: '10px 20px', textAlign: 'left', cursor: 'pointer', borderLeft: activeTab === 'general' ? '3px solid var(--accent)' : '3px solid transparent' }}
          >General</button>
        </div>

        <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ margin: 0 }}>
              {activeTab === 'general' && 'General Settings'}
              {activeTab === 'auth' && 'Configuration Management'}
              {activeTab === 'models' && 'Model Configuration'}
            </h3>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px' }}>X</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px', paddingRight: '10px' }}>
            {activeTab === 'auth' && (
              <>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Configuration</div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      value={activeProviderConfigId}
                      onChange={e => setActiveProviderConfigId(e.target.value)}
                      style={{ ...inputStyle, flex: 1 }}
                    >
                      {providerConfigs.map(config => (
                        <option key={config.id} value={config.id}>
                          {config.name} ({PROVIDER_LABELS[config.provider]})
                        </option>
                      ))}
                    </select>
                    <button onClick={() => addProviderConfig(selected.provider)} style={buttonStyle}>Add</button>
                    <button
                      onClick={handleDelete}
                      disabled={providerConfigs.length <= 1}
                      style={{ ...buttonStyle, cursor: providerConfigs.length <= 1 ? 'not-allowed' : 'pointer', opacity: providerConfigs.length <= 1 ? 0.5 : 1 }}
                    >Delete</button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: '12px' }}>
                  <div>
                    <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Config Name</div>
                    <input
                      type="text"
                      value={selected.name}
                      onChange={e => updateSelected({ name: e.target.value })}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Provider</div>
                    <select
                      value={selected.provider}
                      onChange={e => handleProviderChange(e.target.value as Provider)}
                      style={inputStyle}
                    >
                      {PROVIDER_OPTIONS.map(provider => (
                        <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '12px' }}>
                    {PROVIDER_LABELS[selected.provider]} Settings
                  </div>

                  {isGoogle && (
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Authentication Method</div>
                      <select
                        value={googleAuthMethod}
                        onChange={e => updateSelected({ googleAuthMethod: e.target.value as GoogleAuthMethod })}
                        style={inputStyle}
                      >
                        <option value="oauth">OAuth (Browser)</option>
                        <option value="key">API Key</option>
                      </select>
                    </div>
                  )}

                  {isGoogle && googleAuthMethod === 'oauth' ? (
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>OAuth Authorization</div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={handleOAuthLogin}
                          style={{ flex: 1, padding: '7px 12px', fontSize: '12px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          {selected.googleOauthToken ? 'Re-authenticate' : 'Login with Google'}
                        </button>
                        {selected.googleOauthToken && (
                          <button
                            onClick={handleLogout}
                            style={{ padding: '7px 12px', fontSize: '12px', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            Logout
                          </button>
                        )}
                      </div>
                      {selected.googleOauthToken && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '5px' }}>Logged in successfully.</div>}
                    </div>
                  ) : (
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>API Key</div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input
                          type={showApiKey ? 'text' : 'password'}
                          placeholder={`Enter ${PROVIDER_LABELS[selected.provider]} API Key`}
                          value={selected.apiKey}
                          onChange={e => updateSelected({ apiKey: e.target.value })}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <button onClick={() => setShowApiKey(!showApiKey)} style={buttonStyle}>
                          {showApiKey ? 'Hide' : 'Show'}
                        </button>
                        <button onClick={() => navigator.clipboard.writeText(selectedSecret)} style={buttonStyle} title="Copy API Key">
                          Copy
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '12px' }}>Base URL</div>
                      <button onClick={() => setIsEditingBaseUrl(!isEditingBaseUrl)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px', padding: 0 }}>
                        {isEditingBaseUrl ? 'Lock' : 'Edit'}
                      </button>
                    </div>
                    <input
                      type="text"
                      readOnly={!isEditingBaseUrl}
                      value={selected.baseUrl}
                      onChange={e => updateSelected({ baseUrl: e.target.value })}
                      style={{ ...inputStyle, background: isEditingBaseUrl ? 'var(--bg-primary)' : 'var(--bg-secondary)', cursor: isEditingBaseUrl ? 'text' : 'not-allowed' }}
                    />
                  </div>

                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Default Converter</div>
                    <select
                      value={selected.converterPluginId || NO_CONVERTER_PLUGIN_ID}
                      onChange={e => updateSelected({ converterPluginId: e.target.value as ConverterPluginId })}
                      style={inputStyle}
                    >
                      {CONVERTER_PLUGIN_OPTIONS.map(option => (
                        <option key={option.id} value={option.id}>{option.name}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Model Converter Overrides</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 170px auto', gap: '6px', marginBottom: '8px' }}>
                      <select
                        value={overrideModel}
                        onChange={e => setOverrideModel(e.target.value)}
                        style={inputStyle}
                      >
                        <option value="" disabled>Select model</option>
                        {selectedModels.map(model => <option key={model} value={model}>{model}</option>)}
                      </select>
                      <select
                        value={overrideConverterId}
                        onChange={e => setOverrideConverterId(e.target.value as ConverterPluginId)}
                        style={inputStyle}
                      >
                        {CONVERTER_PLUGIN_OPTIONS.map(option => (
                          <option key={option.id} value={option.id}>{option.name}</option>
                        ))}
                      </select>
                      <button onClick={setModelConverterOverride} disabled={!overrideModel} style={{ ...buttonStyle, opacity: overrideModel ? 1 : 0.5 }}>
                        Set
                      </button>
                    </div>
                    {selectedModels.length === 0 && (
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Models load after this configuration has credentials.</div>
                    )}
                    {modelOverrideEntries.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {modelOverrideEntries.map(([model, converterId]) => (
                          <div key={model} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 140px auto', gap: '6px', alignItems: 'center', fontSize: '12px' }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={model}>{model}</div>
                            <div style={{ color: 'var(--text-secondary)' }}>{getConverterPluginName(converterId)}</div>
                            <button onClick={() => removeModelConverterOverride(model)} style={buttonStyle}>Remove</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'models' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '5px' }}>Planner Configuration</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '5px' }}>Used for high-level reasoning and planning.</div>
                  <select
                    value={plannerProviderConfigId}
                    onChange={e => setPlannerProviderConfigId(e.target.value)}
                    style={{ ...inputStyle, marginBottom: '8px' }}
                  >
                    {providerConfigs.map(config => (
                      <option key={config.id} value={config.id}>{config.name} ({PROVIDER_LABELS[config.provider]})</option>
                    ))}
                  </select>
                  <select
                    value={plannerModel}
                    onChange={e => setPlannerModel(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="" disabled>{isLoadingPlannerModels ? 'Loading planner models...' : 'Select Planner Model'}</option>
                    {plannerAvailableModels.map(model => <option key={model} value={model}>{model}</option>)}
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '5px' }}>Worker Configuration</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '5px' }}>Used for executing subtasks and tool calls.</div>
                  <select
                    value={workerProviderConfigId}
                    onChange={e => setWorkerProviderConfigId(e.target.value)}
                    style={{ ...inputStyle, marginBottom: '8px' }}
                  >
                    {providerConfigs.map(config => (
                      <option key={config.id} value={config.id}>{config.name} ({PROVIDER_LABELS[config.provider]})</option>
                    ))}
                  </select>
                  <select
                    value={workerModel}
                    onChange={e => setWorkerModel(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="" disabled>{isLoadingWorkerModels ? 'Loading worker models...' : 'Select Worker Model'}</option>
                    {workerAvailableModels.map(model => <option key={model} value={model}>{model}</option>)}
                  </select>
                </div>
              </div>
            )}

            {activeTab === 'general' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Max Tool Steps (Retries)</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '5px' }}>The maximum number of sequential steps the agent can take per request.</div>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={maxSteps}
                    onChange={e => setMaxSteps(parseInt(e.target.value, 10) || 20)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '12px' }}>Explorer Settings</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showHiddenFiles}
                      onChange={e => setShowHiddenFiles(e.target.checked)}
                    />
                    Show hidden files (e.g. .DS_Store)
                  </label>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '6px 16px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
