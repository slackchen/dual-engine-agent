import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { openDebugTraceWindow } from './debugTraceWindow';

export function createWindow(
  __dirname: string, 
  VITE_DEV_SERVER_URL: string | undefined, 
  RENDERER_DIST: string, 
  VITE_PUBLIC: string
) {
  const boundsFile = path.join(app.getPath('userData'), 'window-bounds.json');
  let bounds = { width: 1200, height: 800 };
  try {
    if (fs.existsSync(boundsFile)) {
      bounds = JSON.parse(fs.readFileSync(boundsFile, 'utf8'));
    }
  } catch (e) {}

  const win = new BrowserWindow({
    ...bounds,
    title: 'Dual-Engine Agent',
    icon: path.join(VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  });

  win.on('close', () => {
    if (win) {
      try {
        fs.writeFileSync(boundsFile, JSON.stringify(win.getBounds()));
      } catch (e) {}
    }
  });

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })
  
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] Level ${level}: ${message} (line ${line} in ${sourceId})`);
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  win.webContents.on('before-input-event', (_event, input) => {
    if (
      input.type === 'keyDown'
      && input.control
      && input.shift
      && input.alt
      && input.key.toLowerCase() === 'd'
    ) {
      _event.preventDefault();
      openDebugTraceWindow({ __dirname, VITE_DEV_SERVER_URL, RENDERER_DIST, VITE_PUBLIC });
      return;
    }

    if (input.key === 'F12' && input.type === 'keyDown') {
      win?.webContents.toggleDevTools();
    }
  });

  return win;
}
