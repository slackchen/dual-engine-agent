import { ipcMain, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PREVIEW_WIDTH = 1024;
const DEFAULT_PREVIEW_HEIGHT = 768;
const PREVIEW_MARGIN = 48;
const MIN_PREVIEW_WIDTH = 640;
const MIN_PREVIEW_HEIGHT = 480;

export function openBrowserPreview(url: string) {
  const finalUrl = normalizePreviewUrl(url);
  let previewShown = false;
  const showPreview = () => {
    if (previewShown || previewWin.isDestroyed()) return;
    previewShown = true;
    previewWin.show();
    previewWin.focus();
  };

  const previewWin = new BrowserWindow({
    width: DEFAULT_PREVIEW_WIDTH,
    height: DEFAULT_PREVIEW_HEIGHT,
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
    setTimeout(showPreview, 1200);
  });
  
  previewWin.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === 'w') {
      event.preventDefault();
      previewWin.close();
    }
  });

  previewWin.webContents.once('did-finish-load', async () => {
    await resizePreviewToPage(previewWin);
    showPreview();
  });

  previewWin.loadURL(finalUrl).catch((err) => {
    console.error(`Failed to load preview URL ${finalUrl}:`, err);
  });
}

async function resizePreviewToPage(previewWin: BrowserWindow) {
  if (previewWin.isDestroyed()) return;

  try {
    const metrics = await previewWin.webContents.executeJavaScript(`
      (() => {
        const canvases = Array.from(document.querySelectorAll('canvas')).map((canvas) => {
          const rect = canvas.getBoundingClientRect();
          return {
            width: Math.ceil(rect.width || canvas.width || 0),
            height: Math.ceil(rect.height || canvas.height || 0),
            right: Math.ceil(rect.right),
            bottom: Math.ceil(rect.bottom)
          };
        });
        const largestCanvas = canvases.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] || null;
        const doc = document.documentElement;
        const body = document.body;
        return {
          hasCanvas: !!largestCanvas,
          canvasWidth: largestCanvas?.width || 0,
          canvasHeight: largestCanvas?.height || 0,
          canvasRight: largestCanvas?.right || 0,
          canvasBottom: largestCanvas?.bottom || 0,
          scrollWidth: Math.ceil(Math.max(doc.scrollWidth, body?.scrollWidth || 0, doc.clientWidth)),
          scrollHeight: Math.ceil(Math.max(doc.scrollHeight, body?.scrollHeight || 0, doc.clientHeight))
        };
      })()
    `) as {
      hasCanvas: boolean;
      canvasWidth: number;
      canvasHeight: number;
      canvasRight: number;
      canvasBottom: number;
      scrollWidth: number;
      scrollHeight: number;
    };

    const nearestDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const maxWidth = Math.max(MIN_PREVIEW_WIDTH, nearestDisplay.workAreaSize.width - PREVIEW_MARGIN);
    const maxHeight = Math.max(MIN_PREVIEW_HEIGHT, nearestDisplay.workAreaSize.height - PREVIEW_MARGIN);

    const desiredWidth = metrics.hasCanvas
      ? Math.max(metrics.canvasWidth, Math.min(metrics.scrollWidth, metrics.canvasRight))
      : Math.min(metrics.scrollWidth || DEFAULT_PREVIEW_WIDTH, DEFAULT_PREVIEW_WIDTH);
    const desiredHeight = metrics.hasCanvas
      ? Math.max(metrics.canvasHeight, Math.min(metrics.scrollHeight, metrics.canvasBottom))
      : Math.min(metrics.scrollHeight || DEFAULT_PREVIEW_HEIGHT, DEFAULT_PREVIEW_HEIGHT);

    const width = clamp(Math.ceil(desiredWidth), MIN_PREVIEW_WIDTH, maxWidth);
    const height = clamp(Math.ceil(desiredHeight), MIN_PREVIEW_HEIGHT, maxHeight);

    previewWin.setContentSize(width, height, true);
    previewWin.center();
  } catch (error) {
    console.warn('[Browser Preview] failed to auto-size preview window', error);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
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
