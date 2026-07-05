import { ipcMain, BrowserWindow } from 'electron';

export function openBrowserPreview(url: string) {
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

  previewWin.loadURL(url);
}

export function registerBrowserHandlers() {
  ipcMain.handle('agent:open-browser-window', async (_event, { url }) => {
    openBrowserPreview(url);
    return true;
  });
}
