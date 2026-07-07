import { BrowserWindow, ipcMain } from 'electron';
import {
  clearDebugTraceEvents,
  getDebugTraceState,
  setDebugTraceEnabled,
  subscribeDebugTrace,
  traceEvent,
} from '../debugTrace';
import { openDebugTraceWindow, type DebugTraceWindowConfig } from '../debugTraceWindow';

let unsubscribeBroadcast: (() => void) | null = null;

export function registerDebugTraceHandlers(windowConfig: DebugTraceWindowConfig) {
  if (!unsubscribeBroadcast) {
    unsubscribeBroadcast = subscribeDebugTrace(event => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('debug-trace:event', event);
        }
      });
    });
  }

  ipcMain.handle('debug-trace:open-window', () => {
    openDebugTraceWindow(windowConfig);
    return getDebugTraceState();
  });

  ipcMain.handle('debug-trace:get-state', () => getDebugTraceState());

  ipcMain.handle('debug-trace:set-enabled', (_event, enabled: boolean) => {
    const nextEnabled = setDebugTraceEnabled(!!enabled);
    traceEvent({
      source: 'system',
      phase: 'lifecycle',
      title: nextEnabled ? 'Trace capture enabled' : 'Trace capture disabled',
    });
    return getDebugTraceState();
  });

  ipcMain.handle('debug-trace:clear', () => {
    clearDebugTraceEvents();
    return getDebugTraceState();
  });
}
