import { app, dialog, ipcMain, BrowserWindow, shell } from 'electron';
import { exec } from 'node:child_process';
import util from 'node:util';

const execAsync = util.promisify(exec);
import fs from 'node:fs';
import path from 'node:path';

export const buildFileTree = (dir: string, showHiddenFiles: boolean = false): any[] => {
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    const files = fs.readdirSync(dir);
    const nodes: any[] = [];
    for (const file of files) {
      if (file === 'node_modules' || file === '.git' || file === 'dist' || file === '.next') continue;
      if (!showHiddenFiles && file.startsWith('.')) continue; // This ignores .DS_Store and other hidden files
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      nodes.push({
        name: file,
        path: fullPath,
        isDir: stat.isDirectory(),
        children: stat.isDirectory() ? buildFileTree(fullPath, showHiddenFiles) : undefined
      });
    }
    return nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (e) {
    return [];
  }
};

export function registerWorkspaceHandlers() {
  ipcMain.handle('agent:select-workspace', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('agent:get-fs-tree', async (_event, { workspacePath, showHiddenFiles }) => {
    return buildFileTree(workspacePath, showHiddenFiles);
  });

  ipcMain.handle('agent:read-file', async (_event, { filePath }) => {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (e: any) {
      return `// Failed to read file: ${e.message}`;
    }
  });

  // Context Menu File Operations
  ipcMain.handle('agent:create-file', async (_event, { targetPath }) => {
    try {
      fs.writeFileSync(targetPath, '');
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('agent:create-dir', async (_event, { targetPath }) => {
    try {
      fs.mkdirSync(targetPath, { recursive: true });
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('agent:rename-node', async (_event, { oldPath, newPath }) => {
    try {
      fs.renameSync(oldPath, newPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('agent:delete-node', async (_event, { targetPath }) => {
    try {
      if (process.platform === 'darwin') {
        // Use AppleScript on macOS so that "Put Back" history is preserved by Finder
        await execAsync(`osascript -e 'tell application "Finder" to delete POSIX file "${targetPath}"'`);
      } else {
        await shell.trashItem(targetPath);
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('agent:reveal-in-os', async (_event, { targetPath }) => {
    try {
      shell.showItemInFolder(targetPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Workspace State Management
  const getStateFilePath = () => path.join(app.getPath('userData'), 'workspace-state.json');
  const getGlobalConfigPath = () => path.join(app.getPath('userData'), 'global-config.json');

  ipcMain.handle('agent:load-global-config', async () => {
    try {
      const p = getGlobalConfigPath();
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('agent:save-global-config', async (_event, config) => {
    try {
      fs.writeFileSync(getGlobalConfigPath(), JSON.stringify(config, null, 2));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('agent:load-workspace-state', async (_event, { workspacePath }) => {
    try {
      const stateFile = getStateFilePath();
      if (!fs.existsSync(stateFile)) return null;
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return data[workspacePath] || null;
    } catch (e) {
      console.error('Failed to load workspace state', e);
      return null;
    }
  });

  ipcMain.handle('agent:save-workspace-state', async (_event, { workspacePath, state }) => {
    try {
      const stateFile = getStateFilePath();
      let data: any = {};
      if (fs.existsSync(stateFile)) {
        try {
          data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        } catch(e) {}
      }
      data[workspacePath] = state;
      fs.writeFileSync(stateFile, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('Failed to save workspace state', e);
      return false;
    }
  });

  // Chat History Management
  const getHistoryFilePath = () => path.join(app.getPath('userData'), 'chat-history.json');

  ipcMain.handle('agent:load-chat-history', async (_event, { workspacePath }) => {
    try {
      if (!workspacePath) return [];
      const historyFile = getHistoryFilePath();
      if (!fs.existsSync(historyFile)) return [];
      const data = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      return data[workspacePath] || [];
    } catch (e) {
      console.error('Failed to load chat history', e);
      return [];
    }
  });

  ipcMain.handle('agent:save-chat-history', async (_event, { workspacePath, conversations }) => {
    try {
      if (!workspacePath) return false;
      const historyFile = getHistoryFilePath();
      let data: any = {};
      if (fs.existsSync(historyFile)) {
        try {
          data = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        } catch(e) {}
      }
      data[workspacePath] = conversations;
      fs.writeFileSync(historyFile, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('Failed to save chat history', e);
      return false;
    }
  });
}
