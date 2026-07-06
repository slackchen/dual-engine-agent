import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_BASE_URLS,
  PROVIDER_LABELS,
  type AppSettingsValues,
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

export type SettingsTab = 'general' | 'auth' | 'models';

interface SettingsModalProps {
  onClose: () => void;
  activeTab: SettingsTab;
  setActiveTab: (tab: SettingsTab) => void;
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
}

const PROVIDER_OPTIONS: Provider[] = ['openai', 'sensenova', 'anthropic', 'google'];

const createConfigId = (provider: Provider) =>
  `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cloneProviderConfig = (config: ProviderConfig): ProviderConfig => ({
  ...config,
  modelConverterOverrides: { ...(config.modelConverterOverrides || {}) },
});

const buildSettingsDraft = (values: {
  providerConfigs: ProviderConfig[];
  activeProviderConfigId: string;
  plannerProviderConfigId: string;
  workerProviderConfigId: string;
  plannerModel: string;
  workerModel: string;
  maxSteps: number;
  showHiddenFiles: boolean;
}): AppSettingsValues => ({
  providerConfigs: values.providerConfigs.map(cloneProviderConfig),
  activeProviderConfigId: values.activeProviderConfigId,
  plannerProviderConfigId: values.plannerProviderConfigId,
  workerProviderConfigId: values.workerProviderConfigId,
  plannerModel: values.plannerModel,
  workerModel: values.workerModel,
  maxSteps: values.maxSteps,
  showHiddenFiles: values.showHiddenFiles,
});

const createDraftProviderConfig = (provider: Provider, values: Partial<ProviderConfig> = {}): ProviderConfig => {
  const config: ProviderConfig = {
    id: values.id || createConfigId(provider),
    name: values.name || `${PROVIDER_LABELS[provider]} Config`,
    provider,
    apiKey: values.apiKey || '',
    baseUrl: values.baseUrl || DEFAULT_BASE_URLS[provider],
    converterPluginId: values.converterPluginId || NO_CONVERTER_PLUGIN_ID,
    modelConverterOverrides: { ...(values.modelConverterOverrides || {}) },
  };

  if (provider === 'google') {
    config.googleAuthMethod = values.googleAuthMethod || 'oauth';
    config.googleOauthToken = values.googleOauthToken || '';
  }

  return config;
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  onClose,
  activeTab,
  setActiveTab,
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
}) => {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isEditingBaseUrl, setIsEditingBaseUrl] = useState(false);
  const [overrideModel, setOverrideModel] = useState('');
  const [overrideConverterId, setOverrideConverterId] = useState<ConverterPluginId>('local-responses-proxy');
  const [isOverrideModelSelectOpen, setIsOverrideModelSelectOpen] = useState(false);
  const [isPlannerModelSelectOpen, setIsPlannerModelSelectOpen] = useState(false);
  const [isWorkerModelSelectOpen, setIsWorkerModelSelectOpen] = useState(false);
  const [draft, setDraft] = useState<AppSettingsValues | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setDraft(buildSettingsDraft({
        providerConfigs,
        activeProviderConfigId,
        plannerProviderConfigId,
        workerProviderConfigId,
        plannerModel,
        workerModel,
        maxSteps,
        showHiddenFiles,
      }));
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  const draftSelected = draft
    ? draft.providerConfigs.find(config => config.id === draft.activeProviderConfigId) || draft.providerConfigs[0] || null
    : null;
  const selectedModels = draftSelected ? modelsByConfigId[draftSelected.id] || [] : [];
  const visibleOverrideModels = useMemo(
    () => isOverrideModelSelectOpen
      ? selectedModels
      : overrideModel && selectedModels.includes(overrideModel)
        ? [overrideModel]
        : [],
    [isOverrideModelSelectOpen, overrideModel, selectedModels]
  );
  const plannerAvailableModels = draft ? modelsByConfigId[draft.plannerProviderConfigId] || [] : [];
  const workerAvailableModels = draft ? modelsByConfigId[draft.workerProviderConfigId] || [] : [];
  const visiblePlannerModels = useMemo(
    () => isPlannerModelSelectOpen
      ? plannerAvailableModels
      : draft?.plannerModel && plannerAvailableModels.includes(draft.plannerModel)
        ? [draft.plannerModel]
        : [],
    [draft?.plannerModel, isPlannerModelSelectOpen, plannerAvailableModels]
  );
  const visibleWorkerModels = useMemo(
    () => isWorkerModelSelectOpen
      ? workerAvailableModels
      : draft?.workerModel && workerAvailableModels.includes(draft.workerModel)
        ? [draft.workerModel]
        : [],
    [draft?.workerModel, isWorkerModelSelectOpen, workerAvailableModels]
  );

  useEffect(() => {
    if (overrideModel && !selectedModels.includes(overrideModel)) {
      setOverrideModel('');
    }
  }, [overrideModel, selectedModels]);

  const selected = draftSelected || createDraftProviderConfig('openai');
  const modelConverterOverrides = selected.modelConverterOverrides || {};
  const modelOverrideEntries = Object.entries(modelConverterOverrides);
  const isLoadingPlannerModels = !!draft && !!loadingModelsByConfigId[draft.plannerProviderConfigId];
  const isLoadingWorkerModels = !!draft && !!loadingModelsByConfigId[draft.workerProviderConfigId];
  const isGoogle = selected.provider === 'google';
  const googleAuthMethod: GoogleAuthMethod = selected.googleAuthMethod || 'oauth';
  const selectedSecret = isGoogle && googleAuthMethod === 'oauth'
    ? selected.googleOauthToken || ''
    : selected.apiKey;

  const updateSelected = (patch: Partial<ProviderConfig>) => {
    setDraft(current => {
      if (!current) return current;
      return {
        ...current,
        providerConfigs: current.providerConfigs.map(config => {
          if (config.id !== selected.id) return config;
          const provider = patch.provider || config.provider;
          return createDraftProviderConfig(provider, {
            ...config,
            ...patch,
            provider,
            baseUrl: typeof patch.baseUrl === 'string' ? patch.baseUrl : config.baseUrl || DEFAULT_BASE_URLS[provider],
          });
        }),
      };
    });
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
    if (!draft) return;
    if (draft.providerConfigs.length <= 1) return;
    if (window.confirm(`Delete configuration "${selected.name}"?`)) {
      setDraft(current => {
        if (!current || current.providerConfigs.length <= 1) return current;
        const nextConfigs = current.providerConfigs.filter(config => config.id !== selected.id);
        const fallbackId = nextConfigs[0].id;
        return {
          ...current,
          providerConfigs: nextConfigs,
          activeProviderConfigId: current.activeProviderConfigId === selected.id ? fallbackId : current.activeProviderConfigId,
          plannerProviderConfigId: current.plannerProviderConfigId === selected.id ? fallbackId : current.plannerProviderConfigId,
          workerProviderConfigId: current.workerProviderConfigId === selected.id ? fallbackId : current.workerProviderConfigId,
        };
      });
    }
  };

  const addProviderConfig = () => {
    const nextConfig = createDraftProviderConfig(selected.provider);
    setDraft(current => current ? ({
      ...current,
      providerConfigs: [...current.providerConfigs, nextConfig],
      activeProviderConfigId: nextConfig.id,
    }) : current);
  };

  const handleOAuthLoginClick = async () => {
    const token = await handleOAuthLogin();
    if (token) updateSelected({ googleOauthToken: token });
  };

  const handleLogoutClick = () => {
    updateSelected({ googleOauthToken: '' });
  };

  const closeVisuallyThen = (afterHidden?: () => void) => {
    const overlay = overlayRef.current;
    if (overlay) {
      overlay.style.display = 'none';
      overlay.style.pointerEvents = 'none';
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        afterHidden?.();
        onClose();
      });
    });
  };

  const handleCancel = () => {
    closeVisuallyThen();
  };

  const handleDone = () => {
    if (!draft) {
      handleCancel();
      return;
    }

    const settingsSnapshot = draft;
    closeVisuallyThen(() => onApplySettings(settingsSnapshot));
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

  if (!draft) {
    return (
      <div ref={overlayRef} className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
        <div className="modal-content" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', width: '680px', height: '520px', border: '1px solid var(--border-color)', display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: '160px', background: 'var(--bg-primary)', borderRight: '1px solid var(--border-color)', padding: '20px 0' }}>
            <div style={{ padding: '0 20px', marginBottom: '20px', fontWeight: 'bold' }}>Settings</div>
          </div>
          <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>Settings</h3>
              <button onClick={handleCancel} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px' }}>X</button>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '12px' }}>
              Loading settings...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={overlayRef} className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
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
            <button onClick={handleCancel} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px' }}>X</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px', paddingRight: '10px' }}>
            {activeTab === 'auth' && (
              <>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Configuration</div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      value={draft.activeProviderConfigId}
                      onChange={e => setDraft(current => current ? { ...current, activeProviderConfigId: e.target.value } : current)}
                      style={{ ...inputStyle, flex: 1 }}
                    >
                      {draft.providerConfigs.map(config => (
                        <option key={config.id} value={config.id}>
                          {config.name} ({PROVIDER_LABELS[config.provider]})
                        </option>
                      ))}
                    </select>
                    <button onClick={addProviderConfig} style={buttonStyle}>Add</button>
                    <button
                      onClick={handleDelete}
                      disabled={draft.providerConfigs.length <= 1}
                      style={{ ...buttonStyle, cursor: draft.providerConfigs.length <= 1 ? 'not-allowed' : 'pointer', opacity: draft.providerConfigs.length <= 1 ? 0.5 : 1 }}
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
                          onClick={handleOAuthLoginClick}
                          style={{ flex: 1, padding: '7px 12px', fontSize: '12px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          {selected.googleOauthToken ? 'Re-authenticate' : 'Login with Google'}
                        </button>
                        {selected.googleOauthToken && (
                          <button
                            onClick={handleLogoutClick}
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
                        onFocus={() => setIsOverrideModelSelectOpen(true)}
                        onMouseDown={() => setIsOverrideModelSelectOpen(true)}
                        onBlur={() => setIsOverrideModelSelectOpen(false)}
                        style={inputStyle}
                      >
                        <option value="" disabled>Select model</option>
                        {visibleOverrideModels.map(model => <option key={model} value={model}>{model}</option>)}
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
                    value={draft.plannerProviderConfigId}
                    onChange={e => setDraft(current => current ? { ...current, plannerProviderConfigId: e.target.value } : current)}
                    style={{ ...inputStyle, marginBottom: '8px' }}
                  >
                    {draft.providerConfigs.map(config => (
                      <option key={config.id} value={config.id}>{config.name} ({PROVIDER_LABELS[config.provider]})</option>
                    ))}
                  </select>
                  <select
                    value={draft.plannerModel}
                    onChange={e => setDraft(current => current ? { ...current, plannerModel: e.target.value } : current)}
                    onFocus={() => setIsPlannerModelSelectOpen(true)}
                    onMouseDown={() => setIsPlannerModelSelectOpen(true)}
                    onBlur={() => setIsPlannerModelSelectOpen(false)}
                    style={inputStyle}
                  >
                    <option value="" disabled>{isLoadingPlannerModels ? 'Loading planner models...' : 'Select Planner Model'}</option>
                    {visiblePlannerModels.map(model => <option key={model} value={model}>{model}</option>)}
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '5px' }}>Worker Configuration</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '5px' }}>Used for executing subtasks and tool calls.</div>
                  <select
                    value={draft.workerProviderConfigId}
                    onChange={e => setDraft(current => current ? { ...current, workerProviderConfigId: e.target.value } : current)}
                    style={{ ...inputStyle, marginBottom: '8px' }}
                  >
                    {draft.providerConfigs.map(config => (
                      <option key={config.id} value={config.id}>{config.name} ({PROVIDER_LABELS[config.provider]})</option>
                    ))}
                  </select>
                  <select
                    value={draft.workerModel}
                    onChange={e => setDraft(current => current ? { ...current, workerModel: e.target.value } : current)}
                    onFocus={() => setIsWorkerModelSelectOpen(true)}
                    onMouseDown={() => setIsWorkerModelSelectOpen(true)}
                    onBlur={() => setIsWorkerModelSelectOpen(false)}
                    style={inputStyle}
                  >
                    <option value="" disabled>{isLoadingWorkerModels ? 'Loading worker models...' : 'Select Worker Model'}</option>
                    {visibleWorkerModels.map(model => <option key={model} value={model}>{model}</option>)}
                  </select>
                </div>
              </div>
            )}

            {activeTab === 'general' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Max Tool Steps</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '5px' }}>The maximum number of tool steps per request. Values below 6 are treated as 6 so failed tools still have room for recovery.</div>
                  <input
                    type="number"
                    min={6}
                    max={50}
                    value={draft.maxSteps}
                    onChange={e => setDraft(current => current ? { ...current, maxSteps: Math.max(6, parseInt(e.target.value, 10) || 20) } : current)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '12px' }}>Explorer Settings</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={draft.showHiddenFiles}
                      onChange={e => setDraft(current => current ? { ...current, showHiddenFiles: e.target.checked } : current)}
                    />
                    Show hidden files (e.g. .DS_Store)
                  </label>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleDone} style={{ padding: '6px 16px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
