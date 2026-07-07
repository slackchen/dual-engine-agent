import { app, BrowserWindow, session, Menu, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createWindow } from './window';
import { registerAuthHandlers } from './ipc/auth';
import { registerModelsHandlers } from './ipc/models';
import { registerWorkspaceHandlers } from './ipc/workspace';
import { registerBrowserHandlers } from './ipc/browser';
import { registerTaskHandlers } from './ipc/task';
import { registerDebugTraceHandlers } from './ipc/debugTrace';
import { startBuiltInResponsesProxy } from './converters/responsesProxy';

// Removed unused require
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set app name for macOS menu bar
app.setName('Dual-Engine Agent');

process.env.APP_ROOT = path.join(__dirname, '..');

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST;

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(__dirname, VITE_DEV_SERVER_URL, RENDERER_DIST, process.env.VITE_PUBLIC!);
  }
});

app.whenReady().then(() => {
  startBuiltInResponsesProxy();

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);
    // Strip headers that prevent iframe embedding
    if (responseHeaders['X-Frame-Options']) delete responseHeaders['X-Frame-Options'];
    if (responseHeaders['x-frame-options']) delete responseHeaders['x-frame-options'];
    if (responseHeaders['Content-Security-Policy']) delete responseHeaders['Content-Security-Policy'];
    if (responseHeaders['content-security-policy']) delete responseHeaders['content-security-policy'];
    
    callback({ cancel: false, responseHeaders });
  });

  createWindow(__dirname, VITE_DEV_SERVER_URL, RENDERER_DIST, process.env.VITE_PUBLIC!);

  // Register IPC Handlers
  registerAuthHandlers();
  registerModelsHandlers();
  registerWorkspaceHandlers();
  registerBrowserHandlers();
  registerTaskHandlers();
  registerDebugTraceHandlers({ __dirname, VITE_DEV_SERVER_URL, RENDERER_DIST, VITE_PUBLIC: process.env.VITE_PUBLIC! });

  // Setup Menu
  const isMac = process.platform === 'darwin';
  const template: any[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
            if (!win) return;
            const { canceled, filePaths } = await dialog.showOpenDialog(win, {
              properties: ['openDirectory', 'createDirectory']
            });
            if (!canceled && filePaths.length > 0) {
              win.webContents.send('menu:open-folder', filePaths[0]);
            }
          }
        },
        {
          label: 'Close Folder',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
            if (win) {
              win.webContents.send('menu:close-folder');
            }
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          {
            label: 'Speech',
            submenu: [
              { role: 'startSpeaking' },
              { role: 'stopSpeaking' }
            ]
          }
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ])
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
});
