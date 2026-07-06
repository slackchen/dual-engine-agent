import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'node:child_process';

class CommandOutputDecoder {
  private utf8Decoder = new TextDecoder('utf-8', { fatal: true });
  private fallbackDecoder = new TextDecoder('gb18030');
  private useFallback = false;

  decode(data: Buffer | string) {
    if (typeof data === 'string') return data;
    if (this.useFallback) return this.fallbackDecoder.decode(data, { stream: true });

    try {
      return this.utf8Decoder.decode(data, { stream: true });
    } catch {
      this.useFallback = true;
      this.utf8Decoder = new TextDecoder('utf-8', { fatal: true });
      return this.fallbackDecoder.decode(data, { stream: true });
    }
  }

  flush() {
    return this.useFallback
      ? this.fallbackDecoder.decode()
      : this.utf8Decoder.decode();
  }
}

function prefixStderr(text: string) {
  if (!text) return '';
  return text
    .split(/(\r?\n)/)
    .map(part => (part.trim() && !/^\r?\n$/.test(part) ? `[STDERR] ${part}` : part))
    .join('');
}

function createShellProcess(command: string, workspacePath: string, env: NodeJS.ProcessEnv) {
  if (process.platform === 'win32') {
    return spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ], {
      cwd: workspacePath,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  return spawn(command, {
    cwd: workspacePath,
    env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

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
          const child = createShellProcess(command, workspacePath, {
            ...process.env,
            LANG: 'en_US.UTF-8',
            LC_ALL: 'en_US.UTF-8',
            PYTHONIOENCODING: 'utf-8',
            POWERSHELL_TELEMETRY_OPTOUT: '1',
          });
          let output = '';
          const stdoutDecoder = new CommandOutputDecoder();
          const stderrDecoder = new CommandOutputDecoder();
          let settled = false;
          let timeout: ReturnType<typeof setTimeout> | null = null;
          const finish = (result: any) => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            resolve(result);
          };
          
          child.stdout?.on('data', (data) => {
            const text = stdoutDecoder.decode(data);
            onLog(text);
            output += text;
          });
          
          child.stderr?.on('data', (data) => {
            const text = stderrDecoder.decode(data);
            onLog(prefixStderr(text));
            output += text;
          });
          
          child.on('close', (code) => {
            const trailingStdout = stdoutDecoder.flush();
            const trailingStderr = stderrDecoder.flush();
            if (trailingStdout) {
              onLog(trailingStdout);
              output += trailingStdout;
            }
            if (trailingStderr) {
              onLog(prefixStderr(trailingStderr));
              output += trailingStderr;
            }

            if (code === 0) {
              finish({ success: true, message: output });
            } else {
              finish({ success: false, error: `Command failed with exit code ${code}\n${output}` });
            }
          });

          child.on('error', (error) => {
            finish({ success: false, error: error.message });
          });
          
          // Timeout after 30 seconds
          timeout = setTimeout(() => {
            child.kill();
            finish({ success: false, error: `Command timed out after 30 seconds.\n${output}` });
          }, 30000);
        });
      }
    })
  };
}
