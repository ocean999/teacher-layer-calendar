const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  isDesktop: true,
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (payload) => ipcRenderer.invoke('state:save', payload),
  syncWebDav: (payload) => ipcRenderer.invoke('webdav:sync', payload),
  testWebDav: (cfg) => ipcRenderer.invoke('webdav:test', cfg),
  importSchedule: (opts) => ipcRenderer.invoke('schedule:import', opts),
  exportExcelTemplate: () => ipcRenderer.invoke('excel:template'),
  checkUpdate: (cfg) => ipcRenderer.invoke('updater:check', cfg),
  applyUpdate: (downloadUrl) => ipcRenderer.invoke('updater:apply', downloadUrl),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getWindowInfo: () => ipcRenderer.invoke('win:info'),
  setDesktopOptions: (opts) => ipcRenderer.invoke('win:options', opts),
  windowAction: (action) => ipcRenderer.invoke('win:action', action),
  getLanInfo: () => ipcRenderer.invoke('lan:info'),
  onStateUpdated: (cb) => {
    const listener = (_, state) => cb(state);
    ipcRenderer.on('state:external-update', listener);
    return () => ipcRenderer.removeListener('state:external-update', listener);
  },
  onLockChanged: (cb) => {
    const listener = (_, locked) => cb(locked);
    ipcRenderer.on('win:lock-changed', listener);
    return () => ipcRenderer.removeListener('win:lock-changed', listener);
  },
});
