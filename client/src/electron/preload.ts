import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('talkOverlay', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  flashAttention: () => ipcRenderer.invoke('window:flash-attention'),
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('window:set-always-on-top', enabled),
  onAlwaysOnTopChanged: (callback: (enabled: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled);
    ipcRenderer.on('always-on-top-changed', listener);
    return () => ipcRenderer.removeListener('always-on-top-changed', listener);
  }
});
