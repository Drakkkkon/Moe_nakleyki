/* Мое_граббер для Windows — главный процесс (Electron).
   Внутри настоящий Chromium: сайты открываются как в Chrome, без прокси; фото и страницы скачиваются напрямую,
   скриншоты делает сама программа, сохранение — обычным окном Windows. */
'use strict';
const { app, BrowserWindow, ipcMain, session, dialog, shell, Menu, webContents, clipboard, nativeImage, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

// 1.5.0: интерфейс программы открывается по адресу mg://app/ (а не file://) — так работает вход в общий аккаунт
protocol.registerSchemesAsPrivileged([{ scheme: 'mg', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const WEB = 'persist:web';
let win = null;

app.setName('Мое_граббер');
if (process.platform === 'win32') app.setAppUserModelId('kz.drakkkkon.moe-grabber');
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// Обычный Chrome без «Electron» в заголовке — некоторые сайты иначе показывают упрощённую страницу или капчу
function cleanUA(ua) { return ua.replace(/\s(Electron|moe-grabber|Мое_граббер)\/\S+/gi, ''); }
// 1.4.1: один и тот же «паспорт» браузера везде — и в запросах, и внутри страницы (navigator.userAgent).
// Раньше внутри страницы оставалось «Electron», и проверка Cloudflare («Подтвердите, что вы человек») не пропускала.
const UA = cleanUA(app.userAgentFallback);
app.userAgentFallback = UA;

// Разрешения: всё, что нужно обычным сайтам и проверкам «вы не робот»; камера, микрофон, место и уведомления — нет
const DENY = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'hid', 'serial', 'usb', 'idle-detection', 'openExternal', 'pointerLock', 'keyboardLock', 'display-capture', 'speaker-selection']);
function setupSession(ses) {
  ses.setUserAgent(UA);   // язык — как в Windows: одинаковый в запросах и внутри страницы
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(!DENY.has(perm)));
  ses.setPermissionCheckHandler((wc, perm) => !DENY.has(perm));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 420, minHeight: 500,
    title: 'Мое_граббер', backgroundColor: '#f5f6fb', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), webviewTag: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  win.removeMenu();
  win.loadURL('mg://app/index.html');
  // ссылки «открыть в Chrome» из интерфейса — во внешний браузер
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('mg:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') { win.webContents.toggleDevTools(); return; }
    const k = keyAction(input); if (k) { e.preventDefault(); send('key', k); }
  });
}
// Горячие клавиши как в Chrome (и в окне программы, и внутри страниц)
function keyAction(input) {
  const key = (input.key || '').toLowerCase(), c = input.control || input.meta;
  if (key === 'f5' || (c && key === 'r')) return 'reload';
  if (c && key === 'l') return 'address';
  if (c && input.shift && key === 't') return 'reopen';
  if (c && key === 't') return 'newtab';
  if (c && (key === 'w' || key === 'f4')) return 'closetab';
  if (c && key === 'h') return 'history';
  if (c && key === 'd') return 'bookmark';
  if (c && input.shift && key === 'o') return 'bookmarks';
  if (c && input.shift && key === 'b') return 'bmbar';
  if (c && key === 'tab') return input.shift ? 'prevtab' : 'nexttab';
  if (c && /^[1-9]$/.test(key)) return 'tab' + key;
  if (input.alt && input.key === 'ArrowLeft') return 'back';
  if (input.alt && input.key === 'ArrowRight') return 'forward';
  return '';
}
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

// Страницы сайтов во вкладках (<webview>): всплывающие окна → новая вкладка, своё контекстное меню
app.on('web-contents-created', (e, wc) => {
  try { wc.setUserAgent(UA); } catch (err) {}
  if (wc.getType() !== 'webview') return;
  wc.setWindowOpenHandler(({ url }) => { send('open-tab', url); return { action: 'deny' }; });
  wc.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape' && wc.isLoading()) { wc.stop(); return; }
    const k = keyAction(input); if (k) { ev.preventDefault(); send('key', k); }
  });
  wc.on('context-menu', (ev, p) => {
    const items = [];
    const img = p.mediaType === 'image' && p.srcURL ? p.srcURL : '';
    if (img) {
      items.push({ label: 'Скачать эту картинку…', click: () => send('ctx', { url: img, alt: p.titleText || p.altText || '' }) });
      items.push({ label: 'Копировать адрес картинки', click: () => clipboard.writeText(img) });
      items.push({ type: 'separator' });
    }
    if (p.linkURL) {
      items.push({ label: 'Открыть ссылку в новой вкладке', click: () => send('open-tab', p.linkURL) });
      items.push({ label: 'Добавить ссылку в избранное', click: () => send('bm-link', { url: p.linkURL, title: p.linkText || '' }) });
      items.push({ label: 'Копировать адрес ссылки', click: () => clipboard.writeText(p.linkURL) });
      items.push({ type: 'separator' });
    }
    if (p.isEditable) {
      items.push({ label: 'Вырезать', role: 'cut', enabled: p.editFlags.canCut });
      items.push({ label: 'Копировать', role: 'copy', enabled: p.editFlags.canCopy });
      items.push({ label: 'Вставить', role: 'paste', enabled: p.editFlags.canPaste });
      items.push({ label: 'Выделить всё', role: 'selectAll' });
      items.push({ type: 'separator' });
    } else if (p.selectionText) {
      items.push({ label: 'Копировать', role: 'copy' });
      items.push({ type: 'separator' });
    }
    items.push({ label: 'Назад', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() });
    items.push({ label: 'Обновить', click: () => wc.reload() });
    items.push({ label: 'Все картинки страницы…', click: () => send('key', 'picker') });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
});

// ---------- сеть без ограничений браузера ----------
ipcMain.handle('fetch', async (e, url, referer) => {
  const ses = session.fromPartition(WEB);
  const headers = { 'Accept': 'text/html,application/xhtml+xml,image/avif,image/webp,image/apng,image/*,*/*;q=0.8' };
  async function go(withRef) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
    try {
      const opts = { headers: Object.assign({}, headers), signal: ctl.signal, redirect: 'follow' };
      if (withRef && referer) { opts.headers.Referer = referer; }
      const r = await ses.fetch(url, opts);
      const buf = new Uint8Array(await r.arrayBuffer());
      return { ok: r.ok, status: r.status, url: r.url || url, ct: r.headers.get('content-type') || '', body: buf };
    } finally { clearTimeout(t); }
  }
  try {
    const r = await go(true);
    if (!r.ok && referer && (r.status === 403 || r.status === 401)) return await go(false);
    return r;
  } catch (err) {
    try { return await go(false); } catch (err2) { return { ok: false, status: 0, error: String(err2 && err2.message || err2) }; }
  }
});

// Скриншот картинки (или страницы) по адресу — в невидимом окне
ipcMain.handle('shot', async (e, url, fullPage) => {
  const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: WEB, offscreen: true, javascript: true } });
  try {
    await Promise.race([w.loadURL(url), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 40000))]);
    await new Promise(r => setTimeout(r, 1200));
    const size = await w.webContents.executeJavaScript(`(() => { const i = document.images.length === 1 && document.body && document.body.children.length <= 1 ? document.images[0] : null;
      return i ? { w: i.naturalWidth, h: i.naturalHeight, img: true } : { w: 1280, h: Math.min(document.documentElement.scrollHeight || 900, 12000), img: false }; })()`);
    if (size.img) {
      await w.webContents.insertCSS('html,body{margin:0!important;background:transparent!important;overflow:hidden!important}img{position:fixed!important;left:0;top:0;width:100vw!important;height:100vh!important;object-fit:contain!important;margin:0!important}');
      w.setContentSize(Math.max(16, Math.min(size.w, 6000)), Math.max(16, Math.min(size.h, 6000)));
    } else if (fullPage) {
      w.setContentSize(1280, Math.max(600, size.h));
    }
    await new Promise(r => setTimeout(r, 700));
    const im = await w.webContents.capturePage();
    if (im.isEmpty()) return null;
    return im.toPNG();
  } catch (err) { return null; } finally { if (!w.isDestroyed()) w.destroy(); }
});

// Скриншот всей открытой страницы вкладки (через протокол отладки — вместе с невидимой частью)
ipcMain.handle('page-shot', async (e, wcId) => {
  const wc = webContents.fromId(wcId); if (!wc) return null;
  const dbg = wc.debugger;
  try {
    dbg.attach('1.3');
    const m = await dbg.sendCommand('Page.getLayoutMetrics');
    const cs = m.cssContentSize || m.contentSize;
    const width = Math.ceil(Math.min(cs.width, 4000)), height = Math.ceil(Math.min(cs.height, 16000));
    const r = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
    return Buffer.from(r.data, 'base64');
  } catch (err) {
    try { const im = await wc.capturePage(); return im.isEmpty() ? null : im.toPNG(); } catch (e2) { return null; }
  } finally { try { dbg.detach(); } catch (e3) {} }
});

// ---------- сохранение ----------
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p), base = p.slice(0, -ext.length || undefined);
  for (let i = 2; ; i++) { const q = base + ' (' + i + ')' + ext; if (!fs.existsSync(q)) return q; }
}
ipcMain.handle('save-as', async (e, name, bytes) => {
  const r = await dialog.showSaveDialog(win, { title: 'Сохранить архив', defaultPath: path.join(app.getPath('downloads'), name), filters: [{ name: 'ZIP-архив', extensions: ['zip'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(bytes));
  return r.filePath;
});
ipcMain.handle('save-downloads', async (e, name, bytes) => {
  const p = uniquePath(path.join(app.getPath('downloads'), name));
  fs.writeFileSync(p, Buffer.from(bytes));
  shell.showItemInFolder(p);
  return p;
});
ipcMain.handle('show-file', (e, p) => { if (p) shell.showItemInFolder(p); });
// 1.6.0: авто-листание — папка для страниц и запись файлов по одному
ipcMain.handle('downloads-dir', () => app.getPath('downloads'));
ipcMain.handle('pick-dir', async (e, def) => {
  const r = await dialog.showOpenDialog(win, { title: 'Папка для страниц', defaultPath: def || app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.handle('write-file', (e, dir, name, bytes) => {
  fs.mkdirSync(dir, { recursive: true });
  const p = uniquePath(path.join(dir, String(name).replace(/[\\/:*?"<>|]+/g, '_')));
  fs.writeFileSync(p, Buffer.from(bytes)); return p;
});
ipcMain.handle('open-path', (e, p) => { if (p) shell.openPath(p); });
ipcMain.handle('open-external', (e, url) => { if (/^https?:/i.test(url)) shell.openExternal(url); });
ipcMain.handle('version', () => app.getVersion());
ipcMain.on('hostname', (e) => { e.returnValue = os.hostname(); });

// Перенос закладок, истории и вкладок из версий 1.4.x (там интерфейс жил на file://)
let migrated = null;
ipcMain.on('migrate-get', (e) => { e.returnValue = migrated; migrated = null; });
async function readOldStorage() {
  const flag = path.join(app.getPath('userData'), 'migrated-1.5.flag');
  if (fs.existsSync(flag)) return;
  try {
    const old = path.join(app.getPath('userData'), 'old-storage.html');
    fs.writeFileSync(old, '<!doctype html><title>x</title>');
    const w = new BrowserWindow({ show: false, webPreferences: { javascript: true } });
    await w.loadFile(old);
    const data = await w.webContents.executeJavaScript('(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^mg_/.test(k)) o[k] = localStorage.getItem(k); } return o; })()');
    w.destroy();
    if (data && Object.keys(data).length) migrated = data;
  } catch (err) {}
  try { fs.writeFileSync(flag, new Date().toISOString()); } catch (err) {}
}

app.whenReady().then(async () => {
  // файлы интерфейса: mg://app/… → папка программы
  protocol.handle('mg', (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(__dirname, rel));
    if (!file.startsWith(__dirname)) return new Response('no', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  setupSession(session.defaultSession);
  setupSession(session.fromPartition(WEB));
  // общий аккаунт (Firebase): запросы как с моего сайта
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*.googleapis.com/*', 'https://*.firebaseio.com/*', 'wss://*.firebaseio.com/*', 'https://*.firebaseapp.com/*'] }, (d, cb) => {
    d.requestHeaders.Referer = 'https://drakkkkon.github.io/Moe_nakleyki/';
    cb({ requestHeaders: d.requestHeaders });
  });
  await readOldStorage();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
