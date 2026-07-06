export type ConverterPluginId = 'none' | 'local-responses-proxy';

export interface ProviderRuntime {
  config: unknown;
  tokenOrKey: string;
  currentBaseUrl: string;
  activeProtocol: string;
  authMethodForBackend: string;
}

export interface ConverterPluginOption {
  id: ConverterPluginId;
  name: string;
  description: string;
}

interface ConverterPlugin extends ConverterPluginOption {
  apply: (runtime: ProviderRuntime) => ProviderRuntime;
}

export const NO_CONVERTER_PLUGIN_ID: ConverterPluginId = 'none';

const BUILT_IN_RESPONSES_PROXY_URL = 'http://127.0.0.1:18765';

const getBuiltInProxyBaseUrl = (upstreamBaseUrl: string) =>
  `${BUILT_IN_RESPONSES_PROXY_URL}/proxy/${encodeURIComponent(upstreamBaseUrl.replace(/\/+$/, ''))}`;

const converterPlugins: Record<Exclude<ConverterPluginId, 'none'>, ConverterPlugin> = {
  'local-responses-proxy': {
    id: 'local-responses-proxy',
    name: 'Responses API Adapter',
    description: 'Route selected models through the built-in Responses API adapter.',
    apply: (runtime) => ({
      ...runtime,
      activeProtocol: 'openai',
      authMethodForBackend: 'openai',
      currentBaseUrl: getBuiltInProxyBaseUrl(runtime.currentBaseUrl),
    }),
  },
};

export const CONVERTER_PLUGIN_OPTIONS: ConverterPluginOption[] = [
  {
    id: NO_CONVERTER_PLUGIN_ID,
    name: 'None',
    description: 'Use the provider configuration directly.',
  },
  ...Object.values(converterPlugins),
];

export const isConverterPluginId = (value: unknown): value is ConverterPluginId =>
  value === NO_CONVERTER_PLUGIN_ID || Object.prototype.hasOwnProperty.call(converterPlugins, value as string);

export const getConverterPluginName = (id: ConverterPluginId) =>
  CONVERTER_PLUGIN_OPTIONS.find(option => option.id === id)?.name || id;

export const applyConverterPlugin = (id: ConverterPluginId, runtime: ProviderRuntime) => {
  if (id === NO_CONVERTER_PLUGIN_ID) return runtime;
  return converterPlugins[id].apply(runtime);
};
