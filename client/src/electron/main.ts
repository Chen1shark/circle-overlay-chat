import { BrowserWindow, app, globalShortcut, ipcMain, screen } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let alwaysOnTop = true;

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
  mainWindow.webContents.once('did-finish-load', showMainWindow);
  setTimeout(showMainWindow, 1000);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
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
