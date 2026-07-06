import { tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
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
        urlOrFilePath: z.string().optional().describe('The URL or relative file path to the HTML file in the workspace to preview.'),
        url_or_file_path: z.string().optional().describe('Alias for urlOrFilePath.'),
        urlOrFilepath: z.string().optional().describe('Alias for urlOrFilePath.'),
        url: z.string().optional(),
        filePath: z.string().optional(),
        file_path: z.string().optional(),
        path: z.string().optional(),
        file: z.string().optional(),
        filename: z.string().optional(),
        htmlFile: z.string().optional(),
        htmlFilePath: z.string().optional(),
        href: z.string().optional()
      }).passthrough(),
      // @ts-ignore
      execute: async (input: any) => {
        let urlOrFilePath = input?.urlOrFilePath
          ?? input?.url_or_file_path
          ?? input?.urlOrFilepath
          ?? input?.url
          ?? input?.filePath
          ?? input?.file_path
          ?? input?.path
          ?? input?.file
          ?? input?.filename
          ?? input?.htmlFile
          ?? input?.htmlFilePath
          ?? input?.href;
        try {
          if (typeof urlOrFilePath !== 'string' || !urlOrFilePath.trim()) {
            const defaultHtml = resolveSafePath(workspacePath, 'index.html');
            if (fs.existsSync(defaultHtml)) {
              urlOrFilePath = 'index.html';
            } else {
              return { success: false, error: 'urlOrFilePath is required. Use { "urlOrFilePath": "index.html" } or a full http(s) URL.' };
            }
          }

          const target = urlOrFilePath.trim();
          let finalUrl = target;
          if (!/^https?:\/\//i.test(target)) {
            const fullPath = resolveSafePath(workspacePath, target);
            finalUrl = pathToFileURL(fullPath).href;
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
