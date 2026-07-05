import { tool } from 'ai';
import { z } from 'zod';
import { resolveSafePath } from './utils';

export function createBrowserTools(
  workspacePath: string,
  onLog: (log: string) => void,
  onOpenBrowser: (url: string) => void
) {
  return {
    openBrowser: tool({
      description: 'Open a web browser to preview a local HTML file or a URL.',
      parameters: z.object({
        urlOrFilePath: z.string().optional().describe('The URL or relative file path to the HTML file in the workspace to preview.')
      }),
      // @ts-ignore
      execute: async (input: any) => {
        const { urlOrFilePath } = input ?? {};
        try {
          if (typeof urlOrFilePath !== 'string' || !urlOrFilePath) {
            return { success: false, error: 'urlOrFilePath is required.' };
          }
          let finalUrl = urlOrFilePath;
          if (!urlOrFilePath.startsWith('http://') && !urlOrFilePath.startsWith('https://')) {
            const fullPath = resolveSafePath(workspacePath, urlOrFilePath);
            finalUrl = `file://${fullPath}`;
          }
          onLog(`\n> Opening browser preview: ${finalUrl}\n`);
          onOpenBrowser(finalUrl);
          return { success: true, message: `Opened browser for ${finalUrl}` };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      }
    })
  };
}
