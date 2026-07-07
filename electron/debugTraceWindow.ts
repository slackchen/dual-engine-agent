import { BrowserWindow } from 'electron';
import path from 'node:path';
import { setDebugTraceEnabled, traceEvent } from './debugTrace';

export interface DebugTraceWindowConfig {
  __dirname: string;
  VITE_DEV_SERVER_URL: string | undefined;
  RENDERER_DIST: string;
  VITE_PUBLIC: string;
}

let traceWindow: BrowserWindow | null = null;

export function openDebugTraceWindow(config: DebugTraceWindowConfig) {
  setDebugTraceEnabled(true);

  if (traceWindow && !traceWindow.isDestroyed()) {
    traceWindow.show();
    traceWindow.focus();
    return traceWindow;
  }

  traceWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 500,
    title: 'Agent Trace',
    icon: path.join(config.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(config.__dirname, 'preload.mjs'),
    },
  });

  traceWindow.setMenuBarVisibility(false);
  traceWindow.on('closed', () => {
    traceWindow = null;
  });

  traceWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      traceWindow?.webContents.toggleDevTools();
    }
  });

  if (config.VITE_DEV_SERVER_URL) {
    const url = new URL(config.VITE_DEV_SERVER_URL);
    url.searchParams.set('debugTrace', '1');
    traceWindow.loadURL(url.toString());
  } else {
    traceWindow.loadFile(path.join(config.RENDERER_DIST, 'index.html'), {
      query: { debugTrace: '1' },
    });
  }

  traceEvent({
    source: 'system',
    phase: 'lifecycle',
    title: 'Agent Trace window opened',
  });

  return traceWindow;
}
