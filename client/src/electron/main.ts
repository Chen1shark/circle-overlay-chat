import { BrowserWindow, app, desktopCapturer, globalShortcut, ipcMain, screen } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let alwaysOnTop = true;
let screenshotSession: ScreenshotSession | null = null;
let screenshotWindow: BrowserWindow | null = null;
let screenshotWindowLoadPromise: Promise<void> | null = null;
const HIDE_WINDOW_CAPTURE_DELAY_MS = 90;
const SCREENSHOT_PREVIEW_JPEG_QUALITY = 86;

type ScreenshotStartOptions = {
  hideWindow?: boolean;
};

type ScreenshotInitPayload = {
  dataUrl: string;
  viewportWidth: number;
  viewportHeight: number;
};

type ScreenshotSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ScreenshotResult = {
  dataUrl: string;
  width: number;
  height: number;
};

type ScreenshotSession = {
  window: BrowserWindow;
  displayBounds: Electron.Rectangle;
  image: Electron.NativeImage;
  restoreMainWindow: boolean;
  resolve: (result: ScreenshotResult | null) => void;
};

function clearAttention() {
  mainWindow?.flashFrame(false);
  mainWindow?.setProgressBar(-1);
}

function flashAttention() {
  if (!mainWindow) {
    return false;
  }
  const bounds = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const isVisibleOnScreen =
    bounds.x + bounds.width > workArea.x &&
    bounds.y + bounds.height > workArea.y &&
    bounds.x < workArea.x + workArea.width &&
    bounds.y < workArea.y + workArea.height;
  const shouldNotify = mainWindow.isMinimized() || !mainWindow.isVisible() || !isVisibleOnScreen;

  if (!shouldNotify) {
    clearAttention();
    return false;
  }
  // flashFrame 在部分 Windows 设置下不明显；红色 taskbar progress 作为稳定兜底。
  mainWindow.flashFrame(true);
  mainWindow.setProgressBar(1, { mode: 'error' });
  return true;
}

function showMainWindow() {
  if (!mainWindow) {
    return;
  }

  const bounds = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const isVisibleOnScreen =
    bounds.x + bounds.width > workArea.x &&
    bounds.y + bounds.height > workArea.y &&
    bounds.x < workArea.x + workArea.width &&
    bounds.y < workArea.y + workArea.height;

  if (!isVisibleOnScreen) {
    mainWindow.center();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
  clearAttention();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function prewarmScreenshotWindow() {
  try {
    await ensureScreenshotWindow(screen.getPrimaryDisplay().bounds);
  } catch (error) {
    console.error('Failed to prewarm screenshot window.', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 520,
    minWidth: 300,
    minHeight: 260,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: true,
    show: false,
    title: 'CiRCLE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  setAlwaysOnTop(true);
  mainWindow.once('ready-to-show', showMainWindow);
  mainWindow.webContents.once('did-finish-load', () => {
    showMainWindow();
    void prewarmScreenshotWindow();
  });
  setTimeout(showMainWindow, 1000);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (screenshotWindow && !screenshotWindow.isDestroyed()) {
      screenshotWindow.close();
    }
  });
  mainWindow.on('focus', clearAttention);
}

function setAlwaysOnTop(enabled: boolean) {
  const changed = alwaysOnTop !== enabled;
  alwaysOnTop = enabled;
  if (!mainWindow) {
    return;
  }
  if (enabled) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  } else {
    mainWindow.setAlwaysOnTop(false);
  }
  if (changed) {
    mainWindow.webContents.send('always-on-top-changed', enabled);
  }
}

function registerShortcuts() {
  globalShortcut.register('Control+Alt+T', () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      showMainWindow();
      setAlwaysOnTop(alwaysOnTop);
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:set-always-on-top', (_event, enabled: boolean) => {
  setAlwaysOnTop(enabled);
  return enabled;
});

ipcMain.handle('window:flash-attention', () => flashAttention());

ipcMain.handle('screenshot:start', async (_event, options: ScreenshotStartOptions = {}) => {
  if (!mainWindow || screenshotSession) {
    return null;
  }

  const display = screen.getDisplayMatching(mainWindow.getBounds());
  const restoreMainWindow = Boolean(options.hideWindow && mainWindow.isVisible());

  try {
    await ensureScreenshotWindow(display.bounds);

    if (options.hideWindow) {
      mainWindow.hide();
      await delay(HIDE_WINDOW_CAPTURE_DELAY_MS);
    }

    const image = await captureDisplay(display);
    const result = await openScreenshotWindow(display.bounds, image, restoreMainWindow);
    return result;
  } catch (error) {
    console.error('Failed to start screenshot capture.', error);
    if (restoreMainWindow) {
      showMainWindow();
    }
    const activeSession = screenshotSession as ScreenshotSession | null;
    activeSession?.window.close();
    screenshotSession = null;
    throw error;
  }
});

ipcMain.handle('screenshot:ready', (event) => {
  if (!screenshotSession || event.sender !== screenshotSession.window.webContents) {
    return false;
  }
  sendScreenshotInit(screenshotSession);
  return true;
});

ipcMain.handle('screenshot:show', (event) => {
  if (!screenshotSession || event.sender !== screenshotSession.window.webContents) {
    return false;
  }
  screenshotSession.window.show();
  screenshotSession.window.moveTop();
  screenshotSession.window.focus();
  return true;
});

ipcMain.handle('screenshot:complete', (event, selection: ScreenshotSelection | null) => {
  if (!screenshotSession || event.sender !== screenshotSession.window.webContents) {
    return null;
  }

  const session = screenshotSession;
  screenshotSession = null;

  const result = selection ? cropScreenshot(session, selection) : null;
  session.window.hide();
  if (session.restoreMainWindow) {
    showMainWindow();
  }
  session.resolve(result);
  return result;
});

/**
 * 截取指定显示器，返回完整屏幕图片。
 */
async function captureDisplay(display: Electron.Display) {
  const width = Math.round(display.bounds.width * display.scaleFactor);
  const height = Math.round(display.bounds.height * display.scaleFactor);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  });
  const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
  if (!source) {
    throw new Error('screen source not found');
  }
  if (source.thumbnail.isEmpty()) {
    throw new Error('screen source thumbnail is empty');
  }
  return source.thumbnail;
}

/**
 * 创建截图遮罩窗口，并等待用户框选结果。
 */
async function openScreenshotWindow(displayBounds: Electron.Rectangle, image: Electron.NativeImage, restoreMainWindow: boolean) {
  const window = await ensureScreenshotWindow(displayBounds);
  window.setBounds(displayBounds);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const resultPromise = new Promise<ScreenshotResult | null>((resolve) => {
    screenshotSession = {
      window,
      displayBounds,
      image,
      restoreMainWindow,
      resolve
    };
  });

  if (screenshotSession) {
    sendScreenshotInit(screenshotSession);
  }
  return resultPromise;
}

async function ensureScreenshotWindow(displayBounds: Electron.Rectangle) {
  if (screenshotWindow && !screenshotWindow.isDestroyed()) {
    screenshotWindow.setBounds(displayBounds);
    await screenshotWindowLoadPromise;
    return screenshotWindow;
  }

  const nextWindow = new BrowserWindow({
    x: displayBounds.x,
    y: displayBounds.y,
    width: displayBounds.width,
    height: displayBounds.height,
    useContentSize: true,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    show: false,
    title: 'CiRCLE Screenshot',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  screenshotWindow = nextWindow;
  nextWindow.setAlwaysOnTop(true, 'screen-saver');
  nextWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  nextWindow.once('closed', () => {
    if (screenshotSession?.window === nextWindow) {
      const shouldRestore = screenshotSession.restoreMainWindow;
      screenshotSession.resolve(null);
      screenshotSession = null;
      if (shouldRestore) {
        showMainWindow();
      }
    }
    if (screenshotWindow === nextWindow) {
      screenshotWindow = null;
      screenshotWindowLoadPromise = null;
    }
  });

  screenshotWindowLoadPromise = new Promise((resolve, reject) => {
    nextWindow.webContents.once('did-finish-load', () => resolve());
    nextWindow.webContents.once('did-fail-load', (_event, _errorCode, errorDescription) => {
      reject(new Error(errorDescription));
    });
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await nextWindow.loadURL(`${devServerUrl}/screenshot.html`);
  } else {
    await nextWindow.loadFile(path.join(__dirname, '../dist/screenshot.html'));
  }

  await screenshotWindowLoadPromise;
  return nextWindow;
}

function sendScreenshotInit(session: ScreenshotSession) {
  const payload: ScreenshotInitPayload = {
    dataUrl: nativeImageToJpegDataUrl(session.image, SCREENSHOT_PREVIEW_JPEG_QUALITY),
    viewportWidth: session.displayBounds.width,
    viewportHeight: session.displayBounds.height
  };
  session.window.webContents.send('screenshot:init', payload);
}

function nativeImageToJpegDataUrl(image: Electron.NativeImage, quality: number) {
  const encoded = image.toJPEG(quality);
  return `data:image/jpeg;base64,${encoded.toString('base64')}`;
}

/**
 * 把遮罩窗口中的 DIP 选区转换成屏幕截图像素坐标并裁切。
 */
function cropScreenshot(session: ScreenshotSession, selection: ScreenshotSelection): ScreenshotResult | null {
  if (selection.width < 8 || selection.height < 8) {
    return null;
  }

  const imageSize = session.image.getSize();
  const scaleX = imageSize.width / session.displayBounds.width;
  const scaleY = imageSize.height / session.displayBounds.height;
  const cropRect = {
    x: Math.max(0, Math.round(selection.x * scaleX)),
    y: Math.max(0, Math.round(selection.y * scaleY)),
    width: Math.max(1, Math.round(selection.width * scaleX)),
    height: Math.max(1, Math.round(selection.height * scaleY))
  };

  if (cropRect.x + cropRect.width > imageSize.width) {
    cropRect.width = imageSize.width - cropRect.x;
  }
  if (cropRect.y + cropRect.height > imageSize.height) {
    cropRect.height = imageSize.height - cropRect.y;
  }
  if (cropRect.width <= 0 || cropRect.height <= 0) {
    return null;
  }

  const cropped = session.image.crop(cropRect);
  const croppedSize = cropped.getSize();
  return {
    dataUrl: cropped.toDataURL(),
    width: croppedSize.width,
    height: croppedSize.height
  };
}
