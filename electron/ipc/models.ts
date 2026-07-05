import { ipcMain } from 'electron';

export function registerModelsHandlers() {
  ipcMain.handle('agent:get-models', async (_event, { protocol, authMethod, tokenOrKey, baseUrl }) => {
    try {
      if (protocol === 'google') {
        const url = authMethod === 'google-oauth' 
          ? `${baseUrl}/models` 
          : `${baseUrl}/models?key=${tokenOrKey}`;
        const headers: Record<string, string> = authMethod === 'google-oauth' ? { Authorization: `Bearer ${tokenOrKey}` } : {};
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Failed to fetch Google models');
        
        if (authMethod === 'google-oauth') {
           return data.models.map((m: any) => m.id.replace('models/', ''));
        } else {
           return data.models.map((m: any) => m.name.replace('models/', ''));
        }
      } else if (protocol === 'openai' || protocol === 'anthropic') {
        // Both OpenAI and Anthropic compatible endpoints usually have /v1/models
        const res = await fetch(`${baseUrl}/models`, {
          headers: { 
            'Authorization': `Bearer ${tokenOrKey}`,
            'x-api-key': tokenOrKey // Anthropic standard
          }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || `Failed to fetch ${protocol} models`);
        return (data.data || []).map((m: any) => m.id);
      }
      return [];
    } catch (err: any) {
      console.error("Error fetching models:", err);
      throw new Error(`Model fetch failed: ${err.message}`);
    }
  });
}
