import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'node:child_process';

export function createShellTools(
  workspacePath: string,
  onLog: (log: string) => void
) {
  return {
    runCommand: tool({
      description: 'Run a shell command in the workspace (e.g. npm install, node index.js)',
      parameters: z.object({
        command: z.string().describe('The shell command to execute')
      }),
      // @ts-ignore
      execute: async (input: any) => {
        const { command } = input ?? {};
        if (typeof command !== 'string' || !command) {
          return { success: false, error: 'command is required and must be a string.' };
        }
        onLog(`\n> ${command}\n`);
        return new Promise((resolve) => {
          const shellCommand = process.platform === 'win32'
            ? `chcp 65001 > nul && ${command}`
            : command;
          const child = exec(shellCommand, {
            cwd: workspacePath,
            env: {
              ...process.env,
              LANG: 'en_US.UTF-8',
              LC_ALL: 'en_US.UTF-8',
              PYTHONIOENCODING: 'utf-8'
            },
            encoding: 'utf8',
            windowsHide: true
          });
          let output = '';
          
          child.stdout?.on('data', (data) => {
            onLog(data.toString());
            output += data.toString();
          });
          
          child.stderr?.on('data', (data) => {
            onLog(`[STDERR] ${data.toString()}`);
            output += data.toString();
          });
          
          child.on('close', (code) => {
            if (code === 0) {
              resolve({ success: true, message: output });
            } else {
              resolve({ success: false, error: `Command failed with exit code ${code}\n${output}` });
            }
          });
          
          // Timeout after 30 seconds
          setTimeout(() => {
            child.kill();
            resolve({ success: false, error: `Command timed out after 30 seconds.\n${output}` });
          }, 30000);
        });
      }
    })
  };
}
