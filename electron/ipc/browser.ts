import { ipcMain, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function openBrowserPreview(url: string) {
  const finalUrl = normalizePreviewUrl(url);
  const previewWin = new BrowserWindow({
    width: 1024,
    height: 768,
    center: true,
    show: false,
    title: 'Browser Preview',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  previewWin.setMenuBarVisibility(false);
  previewWin.once('ready-to-show', () => {
    previewWin.show();
    previewWin.focus();
  });
  
  previewWin.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === 'w') {
      event.preventDefault();
      previewWin.close();
    }
  });

  previewWin.loadURL(finalUrl).catch((err) => {
    console.error(`Failed to load preview URL ${finalUrl}:`, err);
  });
}

function normalizePreviewUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;

  if (/^file:\/\//i.test(url)) {
    try {
      return pathToFileURL(fileURLToPath(url)).href;
    } catch {
      return pathToFileURL(decodeURIComponent(url.replace(/^file:\/\/\/?/i, ''))).href;
    }
  }

  if (path.isAbsolute(url)) {
    return pathToFileURL(url).href;
  }

  return url;
}

export function registerBrowserHandlers() {
  ipcMain.handle('agent:open-browser-window', async (_event, { url }) => {
    openBrowserPreview(url);
    return true;
  });
}
