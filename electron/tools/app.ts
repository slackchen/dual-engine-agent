import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { resolveSafePath } from './utils';

function normalizeArgs(args: unknown): string[] {
  if (Array.isArray(args)) return args.map(String);
  if (typeof args === 'string' && args.trim()) return [args];
  return [];
}

export function createAppTools(
  workspacePath: string,
  onLog: (log: string) => void
) {
  return {
    launchApp: tool({
      description: 'Launch a desktop GUI application or compiled executable without waiting for it to exit. Use this for native games and long-running apps.',
      parameters: z.object({
        filePath: z.string().optional().describe('Relative path to the executable inside the workspace, or an absolute path inside the workspace.'),
        path: z.string().optional().describe('Alias for filePath.'),
        executablePath: z.string().optional().describe('Alias for filePath.'),
        args: z.array(z.string()).optional().describe('Optional command-line arguments.'),
        cwd: z.string().optional().describe('Optional working directory, relative to the workspace.')
      }).passthrough(),
      // @ts-ignore
      execute: async (input: any) => {
        const filePath = input?.filePath ?? input?.path ?? input?.executablePath;
        try {
          if (typeof filePath !== 'string' || !filePath.trim()) {
            return { success: false, error: 'filePath is required and must point to an executable.' };
          }

          const fullPath = resolveSafePath(workspacePath, filePath);
          if (!fs.existsSync(fullPath)) {
            return { success: false, error: `Executable not found: ${filePath}` };
          }

          const cwd = typeof input?.cwd === 'string' && input.cwd.trim()
            ? resolveSafePath(workspacePath, input.cwd)
            : path.dirname(fullPath);
          const args = normalizeArgs(input?.args);

          onLog(`\n> Launching app: ${fullPath}${args.length ? ` ${args.join(' ')}` : ''}\n`);
          const child = spawn(fullPath, args, {
            cwd,
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
          });
          child.unref();

          return {
            success: true,
            message: `Launched ${path.basename(fullPath)}.`,
            filePath: fullPath,
            displayPath: filePath,
            pid: child.pid,
          };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      }
    })
  };
}
