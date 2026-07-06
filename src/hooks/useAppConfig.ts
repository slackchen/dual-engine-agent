import { useCallback, useEffect, useMemo, useState } from 'react';
import { NO_CONVERTER_PLUGIN_ID, type ConverterPluginId, isConverterPluginId } from '../converterPlugins';

export type Provider = 'openai' | 'sensenova' | 'anthropic' | 'google';
export type GoogleAuthMethod = 'oauth' | 'key';

export interface ProviderConfig {
  id: string;
  name: string;
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  converterPluginId?: ConverterPluginId;
  modelConverterOverrides?: Record<string, ConverterPluginId>;
  googleAuthMethod?: GoogleAuthMethod;
  googleOauthToken?: string;
}

export interface AppSettingsValues {
  providerConfigs: ProviderConfig[];
  activeProviderConfigId: string;
  plannerProviderConfigId: string;
  workerProviderConfigId: string;
  plannerModel: string;
  workerModel: string;
  maxSteps: number;
  showHiddenFiles: boolean;
}

export interface AppConfig {
  providerConfigs: ProviderConfig[];
  activeProviderConfigId: string;
  activeProviderConfig: ProviderConfig;
  setActiveProviderConfigId: (id: string) => void;
  plannerProviderConfigId: string;
  setPlannerProviderConfigId: (id: string) => void;
  workerProviderConfigId: string;
  setWorkerProviderConfigId: (id: string) => void;
  updateProviderConfig: (id: string, patch: Partial<ProviderConfig>) => void;
  addProviderConfig: (provider?: Provider) => void;
  deleteProviderConfig: (id: string) => void;
  applySettings: (settings: AppSettingsValues) => void;

  availableModels: string[];
  setAvailableModels: (v: string[]) => void;
  plannerModel: string;
  setPlannerModel: (v: string) => void;
  workerModel: string;
  setWorkerModel: (v: string) => void;
  maxSteps: number;
  setMaxSteps: (v: number) => void;
  isLoadingModels: boolean;
  setIsLoadingModels: (v: boolean) => void;

  showHiddenFiles: boolean;
  setShowHiddenFiles: (v: boolean) => void;

  /** The last workspace path restored from persisted config, used for startup auto-open. */
  lastWorkspacePath: string;
  isGlobalLoaded: boolean;

  /** Call this with the live workspacePath so it gets persisted to global-config.json. */
  saveWorkspacePath: (path: string) => void;
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  sensenova: 'SenseNova',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
};

export const DEFAULT_BASE_URLS: Record<Provider, string> = {
  openai: 'https://api.openai.com/v1',
  sensenova: 'https://token.sensenova.cn/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
};

const PROVIDERS: Provider[] = ['openai', 'sensenova', 'anthropic', 'google'];

const isProvider = (value: unknown): value is Provider =>
  typeof value === 'string' && PROVIDERS.includes(value as Provider);

const isGoogleAuthMethod = (value: unknown): value is GoogleAuthMethod =>
  value === 'oauth' || value === 'key';

const normalizeModelConverterOverrides = (value: unknown): Record<string, ConverterPluginId> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([model, pluginId]) => model.trim() && isConverterPluginId(pluginId))
  ) as Record<string, ConverterPluginId>;
};

const createConfigId = (provider: Provider) =>
  `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createProviderConfig = (
  provider: Provider,
  values: Partial<ProviderConfig> = {},
): ProviderConfig => {
  const config: ProviderConfig = {
    id: values.id || `${provider}-default`,
    name: values.name || PROVIDER_LABELS[provider],
    provider,
    apiKey: values.apiKey || '',
    baseUrl: values.baseUrl || DEFAULT_BASE_URLS[provider],
    converterPluginId: isConverterPluginId(values.converterPluginId) ? values.converterPluginId : NO_CONVERTER_PLUGIN_ID,
    modelConverterOverrides: normalizeModelConverterOverrides(values.modelConverterOverrides),
  };

  if (provider === 'google') {
    config.googleAuthMethod = isGoogleAuthMethod(values.googleAuthMethod) ? values.googleAuthMethod : 'oauth';
    config.googleOauthToken = values.googleOauthToken || '';
  }

  return config;
};

const createDefaultProviderConfigs = () => PROVIDERS.map(provider => createProviderConfig(provider));

const normalizeProviderConfig = (raw: any, index: number): ProviderConfig => {
  const provider: Provider = isProvider(raw?.provider) ? raw.provider : 'openai';
  const id = typeof raw?.id === 'string' && raw.id.trim()
    ? raw.id
    : index < PROVIDERS.length
      ? `${PROVIDERS[index]}-default`
      : createConfigId(provider);

  return createProviderConfig(provider, {
    id,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name : PROVIDER_LABELS[provider],
    apiKey: typeof raw?.apiKey === 'string' ? raw.apiKey : '',
    baseUrl: typeof raw?.baseUrl === 'string' && raw.baseUrl.trim() ? raw.baseUrl : DEFAULT_BASE_URLS[provider],
    converterPluginId: isConverterPluginId(raw?.converterPluginId) ? raw.converterPluginId : NO_CONVERTER_PLUGIN_ID,
    modelConverterOverrides: normalizeModelConverterOverrides(raw?.modelConverterOverrides),
    googleAuthMethod: isGoogleAuthMethod(raw?.googleAuthMethod) ? raw.googleAuthMethod : 'oauth',
    googleOauthToken: typeof raw?.googleOauthToken === 'string' ? raw.googleOauthToken : '',
  });
};

const migrateLegacyProviderConfigs = (config: any): ProviderConfig[] => [
  createProviderConfig('openai', {
    id: 'openai-default',
    name: 'OpenAI',
    apiKey: typeof config?.openaiKey === 'string' ? config.openaiKey : '',
    baseUrl: typeof config?.openaiUrl === 'string' && config.openaiUrl.trim() ? config.openaiUrl : DEFAULT_BASE_URLS.openai,
    converterPluginId: NO_CONVERTER_PLUGIN_ID,
    modelConverterOverrides: {},
  }),
  createProviderConfig('sensenova', {
    id: 'sensenova-default',
    name: 'SenseNova',
    apiKey: typeof config?.sensenovaKey === 'string' ? config.sensenovaKey : '',
    baseUrl: typeof config?.sensenovaUrl === 'string' && config.sensenovaUrl.trim() ? config.sensenovaUrl : DEFAULT_BASE_URLS.sensenova,
    converterPluginId: NO_CONVERTER_PLUGIN_ID,
    modelConverterOverrides: {},
  }),
  createProviderConfig('anthropic', {
    id: 'anthropic-default',
    name: 'Anthropic',
    apiKey: typeof config?.anthropicKey === 'string' ? config.anthropicKey : '',
    baseUrl: typeof config?.anthropicUrl === 'string' && config.anthropicUrl.trim() ? config.anthropicUrl : DEFAULT_BASE_URLS.anthropic,
    converterPluginId: NO_CONVERTER_PLUGIN_ID,
    modelConverterOverrides: {},
  }),
  createProviderConfig('google', {
    id: 'google-default',
    name: 'Google Gemini',
    apiKey: typeof config?.googleKey === 'string' ? config.googleKey : '',
    baseUrl: typeof config?.googleUrl === 'string' && config.googleUrl.trim() ? config.googleUrl : DEFAULT_BASE_URLS.google,
    converterPluginId: NO_CONVERTER_PLUGIN_ID,
    modelConverterOverrides: {},
    googleAuthMethod: isGoogleAuthMethod(config?.googleAuthMethod) ? config.googleAuthMethod : 'oauth',
    googleOauthToken: typeof config?.googleOauthToken === 'string' ? config.googleOauthToken : '',
  }),
];

const ensureUniqueConfigIds = (configs: ProviderConfig[]) => {
  const seen = new Set<string>();
  return configs.map(config => {
    if (!seen.has(config.id)) {
      seen.add(config.id);
      return config;
    }

    const next = { ...config, id: createConfigId(config.provider) };
    seen.add(next.id);
    return next;
  });
};

const loadProviderConfigs = (config: any): ProviderConfig[] => {
  if (Array.isArray(config?.providerConfigs) && config.providerConfigs.length > 0) {
    return ensureUniqueConfigIds(config.providerConfigs.map(normalizeProviderConfig));
  }

  return migrateLegacyProviderConfigs(config);
};

const getInitialActiveConfigId = (config: any, providerConfigs: ProviderConfig[]) => {
  if (typeof config?.activeProviderConfigId === 'string') {
    const existing = providerConfigs.find(item => item.id === config.activeProviderConfigId);
    if (existing) return existing.id;
  }

  if (isProvider(config?.provider)) {
    const legacyMatch = providerConfigs.find(item => item.id === `${config.provider}-default`)
      || providerConfigs.find(item => item.provider === config.provider);
    if (legacyMatch) return legacyMatch.id;
  }

  return providerConfigs[0].id;
};

const getInitialRoleConfigId = (
  config: any,
  key: 'plannerProviderConfigId' | 'workerProviderConfigId',
  providerConfigs: ProviderConfig[],
  fallbackConfigId: string,
) => {
  if (typeof config?.[key] === 'string') {
    const existing = providerConfigs.find(item => item.id === config[key]);
    if (existing) return existing.id;
  }

  return fallbackConfigId;
};

const getLegacyProviderConfig = (
  providerConfigs: ProviderConfig[],
  activeProviderConfig: ProviderConfig,
  provider: Provider,
) => {
  if (activeProviderConfig.provider === provider) return activeProviderConfig;
  return providerConfigs.find(config => config.provider === provider) || createProviderConfig(provider);
};

export function useAppConfig(): AppConfig {
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>(createDefaultProviderConfigs);
  const [activeProviderConfigId, setActiveProviderConfigId] = useState('openai-default');
  const [plannerProviderConfigId, setPlannerProviderConfigId] = useState('openai-default');
  const [workerProviderConfigId, setWorkerProviderConfigId] = useState('openai-default');

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [plannerModel, setPlannerModel] = useState('');
  const [workerModel, setWorkerModel] = useState('');
  const [maxSteps, setMaxSteps] = useState(20);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const [isGlobalLoaded, setIsGlobalLoaded] = useState(false);

  /** Snapshot of last workspace path from config, used only for startup restoration. */
  const [lastWorkspacePath, setLastWorkspacePath] = useState('');
  /** Live workspace path tracked here for persistence. */
  const [liveWorkspacePath, setLiveWorkspacePath] = useState('');

  const activeProviderConfig = useMemo(() => {
    return providerConfigs.find(config => config.id === activeProviderConfigId) || providerConfigs[0];
  }, [activeProviderConfigId, providerConfigs]);

  const updateProviderConfig = useCallback((id: string, patch: Partial<ProviderConfig>) => {
    setProviderConfigs(prev => prev.map(config => {
      if (config.id !== id) return config;

      const provider = isProvider(patch.provider) ? patch.provider : config.provider;
      return createProviderConfig(provider, {
        ...config,
        ...patch,
        provider,
        baseUrl: typeof patch.baseUrl === 'string' ? patch.baseUrl : config.baseUrl || DEFAULT_BASE_URLS[provider],
      });
    }));
  }, []);

  const addProviderConfig = useCallback((provider: Provider = 'openai') => {
    const next = createProviderConfig(provider, {
      id: createConfigId(provider),
      name: `${PROVIDER_LABELS[provider]} Config`,
    });
    setProviderConfigs(prev => [...prev, next]);
    setActiveProviderConfigId(next.id);
  }, []);

  const deleteProviderConfig = useCallback((id: string) => {
    setProviderConfigs(prev => {
      if (prev.length <= 1) return prev;
      const next = prev.filter(config => config.id !== id);
      if (next.length === prev.length) return prev;

      setActiveProviderConfigId(current => current === id ? next[0].id : current);
      setPlannerProviderConfigId(current => current === id ? next[0].id : current);
      setWorkerProviderConfigId(current => current === id ? next[0].id : current);
      return next;
    });
  }, []);

  const applySettings = useCallback((settings: AppSettingsValues) => {
    const nextProviderConfigs = ensureUniqueConfigIds(
      (settings.providerConfigs.length > 0 ? settings.providerConfigs : createDefaultProviderConfigs())
        .map(normalizeProviderConfig)
    );
    const hasConfig = (id: string) => nextProviderConfigs.some(config => config.id === id);
    const fallbackConfigId = nextProviderConfigs[0].id;

    setProviderConfigs(nextProviderConfigs);
    setActiveProviderConfigId(hasConfig(settings.activeProviderConfigId) ? settings.activeProviderConfigId : fallbackConfigId);
    setPlannerProviderConfigId(hasConfig(settings.plannerProviderConfigId) ? settings.plannerProviderConfigId : fallbackConfigId);
    setWorkerProviderConfigId(hasConfig(settings.workerProviderConfigId) ? settings.workerProviderConfigId : fallbackConfigId);
    setPlannerModel(settings.plannerModel);
    setWorkerModel(settings.workerModel);
    setMaxSteps(Math.max(6, Math.min(50, Number.isFinite(settings.maxSteps) ? settings.maxSteps : 20)));
    setShowHiddenFiles(settings.showHiddenFiles);
  }, []);

  // Load global config on mount.
  useEffect(() => {
    // @ts-ignore
    if (typeof window.ipcRenderer === 'undefined') {
      setIsGlobalLoaded(true);
      return;
    }

    // @ts-ignore
    window.ipcRenderer.invoke('agent:load-global-config').then((config: any) => {
      if (config) {
        const nextProviderConfigs = loadProviderConfigs(config);
        const nextActiveConfigId = getInitialActiveConfigId(config, nextProviderConfigs);
        setProviderConfigs(nextProviderConfigs);
        setActiveProviderConfigId(nextActiveConfigId);
        setPlannerProviderConfigId(getInitialRoleConfigId(config, 'plannerProviderConfigId', nextProviderConfigs, nextActiveConfigId));
        setWorkerProviderConfigId(getInitialRoleConfigId(config, 'workerProviderConfigId', nextProviderConfigs, nextActiveConfigId));

        if (typeof config.plannerModel === 'string') setPlannerModel(config.plannerModel);
        if (typeof config.workerModel === 'string') setWorkerModel(config.workerModel);
        if (typeof config.maxSteps === 'number') setMaxSteps(config.maxSteps);
        else setMaxSteps(20);
        if (typeof config.lastWorkspacePath === 'string') {
          setLastWorkspacePath(config.lastWorkspacePath);
          setLiveWorkspacePath(config.lastWorkspacePath);
        }
        if (typeof config.showHiddenFiles === 'boolean') setShowHiddenFiles(config.showHiddenFiles);
      }
      setIsGlobalLoaded(true);
    });
  }, []);

  // Save global config whenever settings change.
  useEffect(() => {
    if (!isGlobalLoaded || !activeProviderConfig) return;
    // @ts-ignore
    if (typeof window.ipcRenderer === 'undefined') return;

    const openaiConfig = getLegacyProviderConfig(providerConfigs, activeProviderConfig, 'openai');
    const sensenovaConfig = getLegacyProviderConfig(providerConfigs, activeProviderConfig, 'sensenova');
    const anthropicConfig = getLegacyProviderConfig(providerConfigs, activeProviderConfig, 'anthropic');
    const googleConfig = getLegacyProviderConfig(providerConfigs, activeProviderConfig, 'google');

    // @ts-ignore
    window.ipcRenderer.invoke('agent:save-global-config', {
      activeProviderConfigId,
      plannerProviderConfigId,
      workerProviderConfigId,
      providerConfigs,
      provider: activeProviderConfig.provider,
      openaiKey: openaiConfig.apiKey,
      sensenovaKey: sensenovaConfig.apiKey,
      anthropicKey: anthropicConfig.apiKey,
      googleKey: googleConfig.apiKey,
      plannerModel,
      workerModel,
      maxSteps,
      openaiUrl: openaiConfig.baseUrl,
      sensenovaUrl: sensenovaConfig.baseUrl,
      anthropicUrl: anthropicConfig.baseUrl,
      googleUrl: googleConfig.baseUrl,
      googleAuthMethod: googleConfig.googleAuthMethod || 'oauth',
      googleOauthToken: googleConfig.googleOauthToken || '',
      showHiddenFiles,
      lastWorkspacePath: liveWorkspacePath,
    });
  }, [
    activeProviderConfig,
    activeProviderConfigId,
    plannerProviderConfigId,
    workerProviderConfigId,
    providerConfigs,
    plannerModel,
    workerModel,
    maxSteps,
    showHiddenFiles,
    liveWorkspacePath,
    isGlobalLoaded,
  ]);

  return {
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
    applySettings,
    availableModels,
    setAvailableModels,
    plannerModel,
    setPlannerModel,
    workerModel,
    setWorkerModel,
    maxSteps,
    setMaxSteps,
    isLoadingModels,
    setIsLoadingModels,
    showHiddenFiles,
    setShowHiddenFiles,
    lastWorkspacePath,
    isGlobalLoaded,
    saveWorkspacePath: setLiveWorkspacePath,
  };
}
