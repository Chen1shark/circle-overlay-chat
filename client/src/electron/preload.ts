import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('talkOverlay', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  flashAttention: () => ipcRenderer.invoke('window:flash-attention'),
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('window:set-always-on-top', enabled),
  captureScreenshot: (options: { hideWindow: boolean }) => ipcRenderer.invoke('screenshot:start', options),
  readyScreenshot: () => ipcRenderer.invoke('screenshot:ready'),
  showScreenshot: () => ipcRenderer.invoke('screenshot:show'),
  completeScreenshot: (selection: { x: number; y: number; width: number; height: number } | null) =>
    ipcRenderer.invoke('screenshot:complete', selection),
  onAlwaysOnTopChanged: (callback: (enabled: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled);
    ipcRenderer.on('always-on-top-changed', listener);
    return () => ipcRenderer.removeListener('always-on-top-changed', listener);
  },
  onScreenshotInit: (
    callback: (payload: { dataUrl: string; viewportWidth: number; viewportHeight: number }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { dataUrl: string; viewportWidth: number; viewportHeight: number }
    ) => callback(payload);
    ipcRenderer.on('screenshot:init', listener);
    return () => ipcRenderer.removeListener('screenshot:init', listener);
  }
});
