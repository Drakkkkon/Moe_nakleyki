/* Мост между окном программы и главным процессом: сеть без ограничений, скриншоты, сохранение */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('MGNative', {
  platform: process.platform,
  fetch: (url, referer) => ipcRenderer.invoke('fetch', url, referer || ''),
  shot: (url, fullPage) => ipcRenderer.invoke('shot', url, !!fullPage),
  pageShot: (wcId) => ipcRenderer.invoke('page-shot', wcId),
  saveAs: (name, bytes) => ipcRenderer.invoke('save-as', name, bytes),
  saveDownloads: (name, bytes) => ipcRenderer.invoke('save-downloads', name, bytes),
  showFile: (p) => ipcRenderer.invoke('show-file', p),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  version: () => ipcRenderer.invoke('version'),
  on: (ch, fn) => { if (['open-tab', 'ctx', 'key'].includes(ch)) ipcRenderer.on(ch, (e, d) => fn(d)); }
});
