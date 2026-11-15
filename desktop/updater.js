/* Мое_граббер — автообновление с GitHub (главный процесс, с 1.8.0).
   Манифест: https://drakkkkon.github.io/maymani/updates/grabber.json (сайт «Мое_сайты»).
   • Обычное обновление — только код программы (~200 КБ, архив Moe_grabber_app_vX.zip): кладётся в папку данных
     программы (…\AppData\Roaming\Мое_граббер\app-updates\X) и запускается вместо встроенного кода. Права администратора не нужны.
   • Полное обновление — когда меняется встроенный Chrome (Electron): весь архив распаковывается рядом с текущей папкой
     программы и запускается новая папка. Закладки, вкладки и настройки общие — они в папке данных.
   • Защита: проверка SHA-256; если обновлённая версия дважды не смогла запуститься — работает встроенная. */
'use strict';
const { app, net, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn } = require('child_process');

const MANIFEST = process.env.MG_UPDATE_URL || 'https://drakkkkon.github.io/maymani/updates/grabber.json';
function updDir() { return path.join(app.getPath('userData'), 'app-updates'); }
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
function newer(a, b) {
  const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}

// Запуск: если скачано более новое обновление кода — работаем на нём. Возвращает true, если управление передано ему.
function boot(baseDir) {
  if (global.__MG_BOOTED) return false;
  global.__MG_BOOTED = true; global.__MG_BASE = baseDir;
  if (process.env.MG_NO_UPDATE || process.argv.includes('--mg-no-update')) return false;
  const builtin = (readJSON(path.join(baseDir, 'package.json')) || {}).version;
  const cur = readJSON(path.join(updDir(), 'current.json'));
  if (!cur || !newer(cur.version, builtin) || cur.electron !== process.versions.electron) return false;
  const mainJs = path.join(cur.dir, 'main.js');
  if (!fs.existsSync(mainJs)) return false;
  const bootF = path.join(updDir(), 'boot.json'), b = readJSON(bootF) || {};
  const tries = b.version === cur.version ? (b.tries || 0) : 0;
  if (tries >= 2) return false;                       // обновление не запускается — остаёмся на встроенной версии
  try { fs.writeFileSync(bootF, JSON.stringify({ version: cur.version, tries: tries + 1 })); } catch (e) {}
  global.__MG_UPDATED = cur.version;
  try { require(mainJs); }
  catch (err) {
    // обновление сломано — запомнить и перезапуститься на встроенной версии
    try { fs.writeFileSync(bootF, JSON.stringify({ version: cur.version, tries: 99, error: String(err && err.stack || err) })); } catch (e) {}
    app.relaunch({ args: process.argv.slice(1).concat(['--mg-no-update']) }); app.exit(0);
  }
  return true;
}
// Окно открылось — обновление рабочее
function bootOk() {
  const bootF = path.join(updDir(), 'boot.json'), b = readJSON(bootF);
  if (b && b.tries) { try { fs.writeFileSync(bootF, JSON.stringify({ version: b.version, tries: 0 })); } catch (e) {} }
}

// ---------- ZIP: распаковка без сторонних библиотек ----------
function unzip(buf, outDir, stripTop) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('это не ZIP-архив');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const list = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('повреждённый архив');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    list.push({ name: buf.toString('utf8', p + 46, p + 46 + nl), method, csize, usize, lho });
    p += 46 + nl + el + cl;
  }
  let top = '';
  if (stripTop) { const firsts = new Set(list.map(f => f.name.split('/')[0])); if (firsts.size === 1 && list.every(f => f.name.includes('/'))) top = [...firsts][0]; }
  const root = path.resolve(outDir);
  for (const f of list) {
    let rel = top ? f.name.slice(top.length + 1) : f.name;
    if (!rel || rel.endsWith('/')) continue;
    const dest = path.resolve(root, rel);
    if (!dest.startsWith(root + path.sep)) throw new Error('недопустимый путь в архиве: ' + rel);
    const nl2 = buf.readUInt16LE(f.lho + 26), el2 = buf.readUInt16LE(f.lho + 28);
    const data = buf.subarray(f.lho + 30 + nl2 + el2, f.lho + 30 + nl2 + el2 + f.csize);
    const out = f.method === 0 ? data : f.method === 8 ? zlib.inflateRawSync(data) : null;
    if (!out) throw new Error('неизвестное сжатие в архиве');
    if (out.length !== f.usize) throw new Error('повреждён файл ' + rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out);
  }
  return top;
}

// ---------- сеть ----------
async function getJSON(url) {
  const r = await net.fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('сервер ответил ' + r.status);
  return r.json();
}
async function download(url, onProgress) {
  const r = await net.fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('скачивание: сервер ответил ' + r.status);
  const total = Number(r.headers.get('content-length')) || 0, chunks = []; let got = 0, last = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(Buffer.from(value)); got += value.length;
    if (onProgress && Date.now() - last > 300) { last = Date.now(); onProgress(got, total); }
  }
  if (onProgress) onProgress(got, total);
  return Buffer.concat(chunks);
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function setup(runningDir, getWin) {
  const running = (readJSON(path.join(runningDir, 'package.json')) || {}).version || app.getVersion();
  const builtin = (readJSON(path.join(global.__MG_BASE || runningDir, 'package.json')) || {}).version || running;
  let manifest = null;
  function send(ch, d) { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, d); }

  ipcMain.handle('upd-info', () => ({ running, builtin, updated: !!global.__MG_UPDATED, electron: process.versions.electron, manifest: MANIFEST }));
  ipcMain.handle('upd-check', async () => {
    try {
      manifest = await getJSON(MANIFEST);
      const available = newer(manifest.version, running);
      const kind = manifest.electron && manifest.electron !== process.versions.electron ? 'full' : 'app';
      const pkg = kind === 'full' ? manifest.full_zip : manifest.app_zip;
      return { ok: true, available, version: manifest.version, date: manifest.date, notes: manifest.notes || [], history: manifest.history || [], kind, size: pkg && pkg.size || 0 };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('upd-download', async () => {
    try {
      if (!manifest) manifest = await getJSON(MANIFEST);
      const kind = manifest.electron && manifest.electron !== process.versions.electron ? 'full' : 'app';
      const pkg = kind === 'full' ? manifest.full_zip : manifest.app_zip;
      if (!pkg || !pkg.url) throw new Error('в описании обновления нет ссылки на архив');
      const buf = await download(pkg.url, (got, total) => send('upd-progress', { got, total }));
      if (pkg.sha256 && sha256(buf) !== pkg.sha256) throw new Error('архив повреждён (не сходится контрольная сумма) — попробуйте позже');
      if (kind === 'app') {
        const dest = path.join(updDir(), manifest.version);
        fs.rmSync(dest, { recursive: true, force: true });
        unzip(buf, dest, true);
        const v = (readJSON(path.join(dest, 'package.json')) || {}).version;
        if (v !== manifest.version || !fs.existsSync(path.join(dest, 'main.js'))) throw new Error('в архиве не та версия программы');
        fs.writeFileSync(path.join(updDir(), 'current.json'), JSON.stringify({ version: v, dir: dest, electron: process.versions.electron, at: new Date().toISOString() }));
        // старые обновления — убрать
        for (const d of fs.readdirSync(updDir())) { const full = path.join(updDir(), d); if (d !== manifest.version && fs.statSync(full).isDirectory()) fs.rmSync(full, { recursive: true, force: true }); }
        return { ok: true, kind, version: v };
      }
      // полное: рядом с папкой программы
      const exeDir = path.dirname(process.execPath), parent = path.dirname(exeDir);
      const tmp = path.join(parent, '.Moe_grabber_update_' + manifest.version);
      fs.rmSync(tmp, { recursive: true, force: true });
      const top = unzip(buf, tmp, true);
      let target = path.join(parent, top || ('Moe_grabber_v' + manifest.version)), k = 2;
      while (fs.existsSync(target)) target = path.join(parent, (top || ('Moe_grabber_v' + manifest.version)) + ' (' + (k++) + ')');
      fs.renameSync(tmp, target);
      const exe = path.join(target, path.basename(process.execPath));
      if (!fs.existsSync(exe)) throw new Error('в архиве нет программы');
      global.__MG_NEW_EXE = exe;
      return { ok: true, kind, version: manifest.version, dir: target };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('upd-restart', () => {
    if (global.__MG_NEW_EXE) {
      app.releaseSingleInstanceLock();
      spawn(global.__MG_NEW_EXE, [], { detached: true, stdio: 'ignore', cwd: path.dirname(global.__MG_NEW_EXE) }).unref();
      setTimeout(() => app.quit(), 300);
      return true;
    }
    app.relaunch(); app.exit(0); return true;
  });
  ipcMain.handle('upd-rollback', () => {
    try { fs.rmSync(path.join(updDir(), 'current.json'), { force: true }); } catch (e) {}
    app.relaunch(); app.exit(0); return true;
  });
  ipcMain.handle('upd-open-folder', () => { const d = global.__MG_NEW_EXE ? path.dirname(global.__MG_NEW_EXE) : updDir(); shell.openPath(d); });
}

module.exports = { boot, bootOk, setup, unzip, newer };
