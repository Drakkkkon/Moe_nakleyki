/* Мост между окном программы и главным процессом: сеть без ограничений, скриншоты, сохранение */
const { contextBridge, ipcRenderer } = require('electron');
// перенос данных из версий 1.4.x — до того, как интерфейс прочитает свои данные
try {
  const old = ipcRenderer.sendSync('migrate-get');
  if (old) Object.keys(old).forEach((k) => { if (localStorage.getItem(k) == null) localStorage.setItem(k, old[k]); });
} catch (e) {}
const HOST = (() => { try { return ipcRenderer.sendSync('hostname'); } catch (e) { return ''; } })();
contextBridge.exposeInMainWorld('MGNative', {
  platform: process.platform,
  hostname: HOST,
  fetch: (url, referer) => ipcRenderer.invoke('fetch', url, referer || ''),
  shot: (url, fullPage) => ipcRenderer.invoke('shot', url, !!fullPage),
  pageShot: (wcId) => ipcRenderer.invoke('page-shot', wcId),
  saveAs: (name, bytes) => ipcRenderer.invoke('save-as', name, bytes),
  saveDownloads: (name, bytes) => ipcRenderer.invoke('save-downloads', name, bytes),
  showFile: (p) => ipcRenderer.invoke('show-file', p),
  downloadsDir: () => ipcRenderer.invoke('downloads-dir'),
  pickDir: (def) => ipcRenderer.invoke('pick-dir', def || ''),
  writeFile: (dir, name, bytes) => ipcRenderer.invoke('write-file', dir, name, bytes),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  uniqueDir: (p) => ipcRenderer.invoke('unique-dir', p),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  version: () => ipcRenderer.invoke('version'),
  on: (ch, fn) => { if (['open-tab', 'ctx', 'key', 'bm-link'].includes(ch)) ipcRenderer.on(ch, (e, d) => fn(d)); }
});
