import { useState, useEffect } from 'react';

export type Provider = 'openai' | 'sensenova' | 'anthropic' | 'google';
export type GoogleAuthMethod = 'oauth' | 'key';

export interface AppConfig {
  provider: Provider;
  setProvider: (p: Provider) => void;

  openaiKey: string; setOpenaiKey: (v: string) => void;
  openaiUrl: string; setOpenaiUrl: (v: string) => void;

  sensenovaKey: string; setSensenovaKey: (v: string) => void;
  sensenovaUrl: string; setSensenovaUrl: (v: string) => void;

  anthropicKey: string; setAnthropicKey: (v: string) => void;
  anthropicUrl: string; setAnthropicUrl: (v: string) => void;

  googleAuthMethod: GoogleAuthMethod; setGoogleAuthMethod: (v: GoogleAuthMethod) => void;
  googleKey: string; setGoogleKey: (v: string) => void;
  googleUrl: string; setGoogleUrl: (v: string) => void;
  googleOauthToken: string; setGoogleOauthToken: (v: string) => void;

  availableModels: string[]; setAvailableModels: (v: string[]) => void;
  plannerModel: string; setPlannerModel: (v: string) => void;
  workerModel: string; setWorkerModel: (v: string) => void;
  maxSteps: number; setMaxSteps: (v: number) => void;
  isLoadingModels: boolean; setIsLoadingModels: (v: boolean) => void;

  workspacePath: string; setWorkspacePath: (v: string) => void;
  showHiddenFiles: boolean; setShowHiddenFiles: (v: boolean) => void;

  isGlobalLoaded: boolean;
}

export function useAppConfig(): AppConfig {
  const [provider, setProvider] = useState<Provider>('openai');

  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiUrl, setOpenaiUrl] = useState('https://api.openai.com/v1');

  const [sensenovaKey, setSensenovaKey] = useState('');
  const [sensenovaUrl, setSensenovaUrl] = useState('https://token.sensenova.cn/v1');

  const [anthropicKey, setAnthropicKey] = useState('');
  const [anthropicUrl, setAnthropicUrl] = useState('https://api.anthropic.com/v1');

  const [googleAuthMethod, setGoogleAuthMethod] = useState<GoogleAuthMethod>('oauth');
  const [googleKey, setGoogleKey] = useState('');
  const [googleUrl, setGoogleUrl] = useState('https://generativelanguage.googleapis.com/v1beta');
  const [googleOauthToken, setGoogleOauthToken] = useState('');

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [plannerModel, setPlannerModel] = useState('');
  const [workerModel, setWorkerModel] = useState('');
  const [maxSteps, setMaxSteps] = useState(20);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const [workspacePath, setWorkspacePath] = useState('');
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const [isGlobalLoaded, setIsGlobalLoaded] = useState(false);

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
          if (config.lastWorkspacePath) setWorkspacePath(config.lastWorkspacePath);
          if (config.showHiddenFiles !== undefined) setShowHiddenFiles(config.showHiddenFiles);
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
  }, [provider, openaiKey, sensenovaKey, anthropicKey, googleKey, plannerModel, workerModel, maxSteps,
      openaiUrl, sensenovaUrl, anthropicUrl, googleUrl, googleAuthMethod, googleOauthToken,
      showHiddenFiles, workspacePath, isGlobalLoaded]);

  return {
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
    workspacePath, setWorkspacePath,
    showHiddenFiles, setShowHiddenFiles,
    isGlobalLoaded,
  };
}
