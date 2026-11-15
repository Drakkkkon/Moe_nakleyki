/* Мое_граббер — только программа (с 1.6.0): «Авто-листание».
   На каждой странице находит самую тяжёлую картинку (страницу комикса), сохраняет её в папку по порядку,
   нажимает «Следующая» и повторяет — до конца главы или до самого конца. */
(function () {
  'use strict';
  var I = window.MGI, N = window.MGNative;
  if (!I || !N || !N.writeFile) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = I.esc, host = I.host, jget = I.jget;
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fmt(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ'; }

  var CFG = Object.assign({ stop: 'chapter', max: 300, delay: 1.5, arrow: true, zip: true }, jget('mg_pager', {}));
  function saveCfg() { jset('mg_pager', CFG); }
  // кнопка «Следующая», указанная вручную, — своя для каждого сайта
  function siteBtn(h) { return (jget('mg_pager_btn', {}) || {})[h] || null; }
  function setSiteBtn(h, d) { var m = jget('mg_pager_btn', {}) || {}; if (d) m[h] = d; else delete m[h]; jset('mg_pager_btn', m); }

  // ---------- что выполняется внутри страницы ----------
  // Поиск кнопки «Следующая». D — описание кнопки, указанной вручную (или null)
  var FIND_NEXT = function (D) {
    function vis(e) { var r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.disabled && e.getAttribute('aria-disabled') !== 'true'; }
    function act(el, how) {
      var a = el.closest('a[href]');
      if (a && /^https?:/i.test(a.href) && a.href.split('#')[0] !== location.href.split('#')[0]) return { href: a.href, how: how, text: (el.innerText || '').trim().slice(0, 40) };
      el.click(); return { clicked: true, how: how, text: (el.innerText || '').trim().slice(0, 40) };
    }
    var el = null;
    if (D) {
      if (D.id) { el = document.getElementById(D.id); if (el && !vis(el)) el = null; }
      if (!el && D.path) { try { el = document.querySelector(D.path); if (el && !vis(el)) el = null; } catch (e) { el = null; } }
      if (!el && D.text) { var all = document.querySelectorAll(D.tag || 'a,button'); for (var i = 0; i < all.length; i++) if (vis(all[i]) && (all[i].innerText || '').trim() === D.text) { el = all[i]; break; } }
      if (!el && D.cls) { try { var q = (D.tag || '') + '.' + D.cls.split(' ').filter(Boolean).map(function (c) { return CSS.escape(c); }).join('.'); el = document.querySelector(q); if (el && !vis(el)) el = null; } catch (e) { el = null; } }
      if (el) return act(el, 'указанная кнопка');
    }
    var rel = document.querySelector('a[rel~="next"][href], link[rel~="next"][href]');
    if (rel && /^https?:/i.test(rel.href)) return { href: rel.href, how: 'rel=next' };
    var NEXT = /(^|[^a-zа-яё])(next|след|далее|дальше|вперед|вперёд|следующ|nxt)|›|»|→|❯|▶|⟩|>>|^\s*>\s*$/i;
    var PREV = /prev|пред|назад|back|‹|«|←|❮|◀|<<|first|перв|last|послед|comment|коммент|share|подел/i;
    var best = null, bestS = 0;
    document.querySelectorAll('a[href], button, [role="button"], [onclick], input[type="button"], input[type="submit"]').forEach(function (e) {
      if (!vis(e)) return;
      var t = ((e.innerText || e.value || '') + '').trim(), meta = [e.getAttribute('aria-label'), e.title, e.id, typeof e.className === 'string' ? e.className : '', e.getAttribute('rel'), e.getAttribute('data-action')].join(' ');
      var s = 0;
      if (t && t.length <= 30 && NEXT.test(t)) s += 10;
      if (NEXT.test(meta)) s += 6;
      var im = e.querySelector('img[alt], img[title]'); if (im && NEXT.test((im.alt || '') + ' ' + (im.title || ''))) s += 6;
      if (!s) return;
      if (PREV.test(t) || PREV.test(meta)) return;
      if (/chap|глав|episode|эпизод/i.test(t + ' ' + meta)) s -= 3;   // «следующая глава» — хуже, чем «следующая страница»
      if (t.length <= 3) s += 1;
      if (s > bestS) { bestS = s; best = e; }
    });
    if (best) return act(best, 'кнопка «' + ((best.innerText || best.value || best.getAttribute('aria-label') || '').trim().slice(0, 20) || '→') + '»');
    // комиксы: щелчок по самой картинке ведёт дальше
    var big = null, ba = 0;
    document.querySelectorAll('a[href] img').forEach(function (i) { var a = i.naturalWidth * i.naturalHeight; if (a > ba && vis(i)) { ba = a; big = i; } });
    if (big && ba > 200 * 200) { var a = big.closest('a[href]'); if (/^https?:/i.test(a.href) && a.href.split('#')[0] !== location.href.split('#')[0]) return { href: a.href, how: 'ссылка на картинке' }; }
    return null;
  };
  // Режим «Указать кнопку»: подсветка под мышью, щелчок запоминает кнопку (переход не выполняется)
  var PICK = function () {
    return new Promise(function (resolve) {
      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #5b4ff5;background:rgba(91,79,245,.15);border-radius:6px;transition:all .05s';
      var tip = document.createElement('div');
      tip.textContent = 'Щёлкните по кнопке «Следующая страница» · Esc — отмена';
      tip.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:10px;transform:translateX(-50%);background:#5b4ff5;color:#fff;font:14px system-ui;padding:8px 14px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3)';
      document.body.appendChild(box); document.body.appendChild(tip);
      function target(e) { var t = e.target; return t.closest('a,button,[role="button"],[onclick],input') || t; }
      function move(e) { var r = target(e).getBoundingClientRect(); box.style.left = r.left - 3 + 'px'; box.style.top = r.top - 3 + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px'; }
      function path(el) {
        var parts = [];
        while (el && el.nodeType === 1 && el !== document.body && parts.length < 7) {
          var s = el.tagName.toLowerCase();
          if (el.id) { parts.unshift('#' + CSS.escape(el.id)); break; }
          var i = 1, p = el; while ((p = p.previousElementSibling)) if (p.tagName === el.tagName) i++;
          parts.unshift(s + ':nth-of-type(' + i + ')'); el = el.parentElement;
        }
        return parts.join(' > ');
      }
      function done(v) { document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); box.remove(); tip.remove(); resolve(v); }
      function click(e) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        var el = target(e);
        done({ tag: el.tagName.toLowerCase(), id: el.id || '', text: (el.innerText || el.value || '').trim().slice(0, 40), cls: typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join(' ') : '', path: path(el) });
      }
      function key(e) { if (e.key === 'Escape') { e.preventDefault(); done(null); } }
      document.addEventListener('mousemove', move, true); document.addEventListener('click', click, true); document.addEventListener('keydown', key, true);
    });
  };

  // ---------- работа со вкладкой ----------
  function wv() { var t = I.T(); return t && t.wv && t.wvReady ? t.wv : null; }
  function waitLoad(w, ms) {
    return new Promise(function (res) {
      var done = false, t;
      function fin() { if (done) return; done = true; clearTimeout(t); w.removeEventListener('did-stop-loading', fin); res(); }
      w.addEventListener('did-stop-loading', fin);
      t = setTimeout(fin, ms);
    });
  }
  // самая тяжёлая картинка страницы: крупнейшие по размеру → скачиваем → берём самую тяжёлую по байтам
  async function heaviest(w) {
    var r;
    try { r = await w.executeJavaScript(Grab.COLLECT_JS); } catch (e) { return null; }
    var list = (r.items || []).filter(function (it) { return it.url && /^(https?:|data:image)/.test(it.url) && !(/^data:/.test(it.url) && it.url.length < 2000); });
    if (!list.length) return null;
    var maxA = 0; list.forEach(function (it) { it.a = (it.nw || 0) * (it.nh || 0); if (it.a > maxA) maxA = it.a; });
    var cands = maxA ? list.filter(function (it) { return it.a >= maxA * 0.4 && it.a >= 150 * 150; }).sort(function (a, b) { return b.a - a.a; }).slice(0, 4) : list.slice(0, 6);
    var best = null;
    for (var i = 0; i < cands.length; i++) {
      var it = cands[i], bytes = null;
      if (/^data:/.test(it.url)) { try { bytes = new Uint8Array(await (await fetch(it.url)).arrayBuffer()); } catch (e) {} }
      else { var f = await N.fetch(it.url, r.url); if (f && f.ok && f.body) bytes = f.body; }
      if (!bytes || bytes.length < 1000) continue;
      var t = Grab.sniff(bytes); if (!t) continue;
      if (!best || bytes.length > best.bytes.length) best = { url: it.url, bytes: bytes, ext: t.ext, w: it.nw, h: it.nh };
    }
    if (best) best.page = r.url;
    return best;
  }
  function hash(u8) { var h = 2166136261; for (var i = 0; i < u8.length; i += Math.max(1, (u8.length / 4096) | 0)) { h ^= u8[i]; h = Math.imul(h, 16777619); } return (h >>> 0) + ':' + u8.length; }
  // «ключ главы»: адрес без последнего числа (номера страницы). Поменялся ключ — началась другая глава
  function chapterKey(url) {
    try {
      var u = new URL(url), s = decodeURIComponent(u.pathname) + '?' + u.searchParams.toString();
      var m = s.match(/\d+(?!.*\d)/); if (m) s = s.slice(0, m.index) + '#' + s.slice(m.index + m[0].length);
      return u.host + s;
    } catch (e) { return url; }
  }

  // ---------- окно ----------
  var panel = document.createElement('div'); panel.className = 'pager'; panel.hidden = true;
  panel.innerHTML =
    '<div class="pg-head"><b>📖 Авто-листание</b><span id="pgSite"></span><button class="ib x" id="pgClose" aria-label="Закрыть">✕</button></div>' +
    '<div class="pg-body" id="pgSetup">' +
      '<p class="hint">Откройте первую страницу главы. Программа сохранит самую тяжёлую картинку страницы, нажмёт «Следующая» и так дальше.</p>' +
      '<div class="pg-row"><span>Кнопка «Следующая»:</span><b id="pgBtn">найду сама</b></div>' +
      '<div class="row sm"><button class="btn" id="pgPick">👆 Указать на странице</button><button class="btn ghost" id="pgAuto">Искать самой</button><button class="btn ghost" id="pgTest">Проверить</button></div>' +
      '<label class="pg-r"><input type="radio" name="pgStop" value="chapter"> До конца главы</label>' +
      '<label class="pg-r"><input type="radio" name="pgStop" value="end"> До самого конца (пока есть «Следующая»)</label>' +
      '<div class="pg-grid"><label>Не больше страниц<input type="number" id="pgMax" min="1" max="5000"></label><label>Пауза, сек<input type="number" id="pgDelay" min="0.5" max="20" step="0.5"></label></div>' +
      '<label class="sw"><input type="checkbox" id="pgArrow"><span>Если кнопки нет — нажать стрелку → на клавиатуре</span></label>' +
      '<label class="sw"><input type="checkbox" id="pgZip"><span>В конце упаковать всё в ZIP (рядом с папкой)</span></label>' +
      '<div class="pg-row"><span>Папка:</span><b id="pgDir" class="pg-dir"></b><button class="btn ghost" id="pgDirBtn">Изменить…</button></div>' +
      '<button class="btn pri big" id="pgStart">▶ Начать</button>' +
    '</div>' +
    '<div class="pg-body" id="pgRun" hidden>' +
      '<div class="pg-now"><img id="pgThumb" alt=""><div><b id="pgCount">Страница 0</b><small id="pgState"></small><small id="pgLast"></small></div></div>' +
      '<ol class="log" id="pgLog"></ol>' +
      '<div class="row"><button class="btn" id="pgPause">⏸ Пауза</button><button class="btn" id="pgStop">⏹ Стоп</button><button class="btn" id="pgOpen">📂 Папка</button><button class="btn ghost" id="pgBack">Ещё раз</button></div>' +
    '</div>';
  document.body.appendChild(panel);

  var run = null, dir = '', dirAuto = true;
  async function defaultDir() {
    var d = await N.downloadsDir(), u = I.curUrl(), now = new Date();
    var title = (I.T().title || host(u) || 'комикс').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
    var sep = /\\/.test(d) ? '\\' : '/';
    var p2 = function (x) { return String(x).padStart(2, '0'); };
    return d + sep + 'Мое_граббер' + sep + title + ' ' + now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate()) + ' ' + p2(now.getHours()) + '-' + p2(now.getMinutes());
  }
  async function open() {
    var u = I.curUrl(); if (!u || !wv()) { I.toast('Сначала откройте первую страницу комикса'); return; }
    $('#pgSetup').hidden = !!run && !run.done ? true : false; $('#pgRun').hidden = !(run && !run.done);
    $('#pgSite').textContent = host(u);
    var d = siteBtn(host(u)); $('#pgBtn').textContent = d ? '«' + (d.text || d.id || d.tag) + '» (указана)' : 'найду сама';
    panel.querySelectorAll('[name=pgStop]').forEach(function (r) { r.checked = r.value === CFG.stop; });
    $('#pgMax').value = CFG.max; $('#pgDelay').value = CFG.delay; $('#pgArrow').checked = !!CFG.arrow; $('#pgZip').checked = !!CFG.zip;
    if (dirAuto || !dir) { dir = await defaultDir(); dirAuto = true; }
    $('#pgDir').textContent = dir;
    panel.hidden = false;
  }
  function readCfg() {
    var r = panel.querySelector('[name=pgStop]:checked'); CFG.stop = r ? r.value : 'chapter';
    CFG.max = Math.max(1, Math.min(5000, +$('#pgMax').value || 300)); CFG.delay = Math.max(0.5, Math.min(20, +$('#pgDelay').value || 1.5));
    CFG.arrow = $('#pgArrow').checked; CFG.zip = $('#pgZip').checked; saveCfg();
  }
  $('#pgClose').onclick = function () { panel.hidden = true; };
  $('#pgPick').onclick = async function () {
    var w = wv(); if (!w) return;
    panel.classList.add('dim'); I.toast('Щёлкните по кнопке «Следующая» на странице', true);
    var d = null; try { d = await w.executeJavaScript('(' + PICK.toString() + ')()', true); } catch (e) {}
    panel.classList.remove('dim');
    if (d) { setSiteBtn(host(I.curUrl()), d); $('#pgBtn').textContent = '«' + (d.text || d.id || d.tag) + '» (указана)'; I.toast('Кнопка запомнена для ' + host(I.curUrl())); }
  };
  $('#pgAuto').onclick = function () { setSiteBtn(host(I.curUrl()), null); $('#pgBtn').textContent = 'найду сама'; };
  $('#pgTest').onclick = async function () {
    var w = wv(); if (!w) return;
    var img = await heaviest(w);
    var res = await findNext(w, true);
    I.toast((img ? 'Картинка: ' + (img.w || '?') + '×' + (img.h || '?') + ', ' + fmt(img.bytes.length) : 'Картинка не найдена') + ' · ' + (res ? 'Дальше: ' + res.how + (res.href ? ' → ' + res.href.replace(/^https?:\/\//, '').slice(0, 60) : '') : 'кнопка «Следующая» не найдена'), true);
  };
  $('#pgDirBtn').onclick = async function () { var p = await N.pickDir(dir); if (p) { dir = p; dirAuto = false; $('#pgDir').textContent = dir; } };
  $('#pgStart').onclick = function () { readCfg(); start(); };
  $('#pgPause').onclick = function () { if (!run || run.done) return; run.paused = !run.paused; this.textContent = run.paused ? '▶ Дальше' : '⏸ Пауза'; state(run.paused ? 'Пауза' : 'Продолжаю…'); };
  $('#pgStop').onclick = function () { if (run && !run.done) { run.stop = 'остановлено вами'; run.paused = false; } };
  $('#pgOpen').onclick = function () { if (run && run.dir) N.openPath(run.dir); };
  $('#pgBack').onclick = function () { if (run && !run.done) return; $('#pgRun').hidden = true; $('#pgSetup').hidden = false; dirAuto = true; open(); };
  function state(t) { $('#pgState').textContent = t; }
  function logLine(t, cls) { var li = document.createElement('li'); li.textContent = t; if (cls) li.className = cls; var l = $('#pgLog'); l.appendChild(li); l.scrollTop = l.scrollHeight; }

  // «Проверить» и обычный ход: найти кнопку (dry — только узнать, не нажимая)
  async function findNext(w, dry) {
    var D = siteBtn(host(I.curUrl()));
    var src = dry ? FIND_NEXT.toString().replace('el.click(); return { clicked: true', 'return { clicked: true') : FIND_NEXT.toString();
    try { return await w.executeJavaScript('(' + src + ')(' + JSON.stringify(D) + ')'); } catch (e) { return null; }
  }

  async function start() {
    var w = wv(); if (!w) { I.toast('Откройте страницу во вкладке'); return; }
    $('#pgSetup').hidden = true; $('#pgRun').hidden = false; $('#pgLog').innerHTML = ''; $('#pgThumb').removeAttribute('src');
    $('#pgPause').textContent = '⏸ Пауза';
    var tab = I.T();
    run = { n: 0, dir: dir, files: [], stop: '', paused: false, done: false, startKey: chapterKey(I.curUrl()), seen: {}, lastHash: '', total: 0, list: [] };
    var R = run;
    logLine('Папка: ' + dir);
    while (!R.stop) {
      while (R.paused && !R.stop) await sleep(300);
      if (R.stop) break;
      if (I.T() !== tab) { I.setCur(I.tabs.indexOf(tab)); await sleep(300); }
      w = tab.wv;
      $('#pgCount').textContent = 'Страница ' + (R.n + 1); state('Ищу картинку…');
      await sleep(CFG.delay * 1000);
      // ждём, пока на странице появится новая картинка (у некоторых читалок адрес не меняется)
      var img = null;
      for (var k = 0; k < 6 && !R.stop; k++) {
        img = await heaviest(w);
        if (img && hash(img.bytes) !== R.lastHash) break;
        img = img && hash(img.bytes) === R.lastHash ? 'same' : img;
        state(img === 'same' ? 'Страница ещё не сменилась, жду…' : 'Картинка ещё грузится, жду…');
        await sleep(1500);
      }
      if (R.stop) break;
      if (!img) { R.stop = 'на странице нет большой картинки'; break; }
      if (img === 'same') { R.stop = 'страница перестала меняться — похоже, это конец'; break; }
      R.n++; R.lastHash = hash(img.bytes);
      var name = String(R.n).padStart(3, '0') + '.' + img.ext;
      try { await N.writeFile(R.dir, name, img.bytes); } catch (e) { R.stop = 'не удалось сохранить файл: ' + (e.message || e); break; }
      R.total += img.bytes.length; R.list.push(name + '  ←  ' + img.url + '  (страница ' + img.page + ')');
      if (CFG.zip) R.files.push({ name: name, bytes: img.bytes });
      $('#pgThumb').src = URL.createObjectURL(new Blob([img.bytes]));
      $('#pgCount').textContent = 'Сохранено страниц: ' + R.n + ' · ' + fmt(R.total);
      $('#pgLast').textContent = name + ' · ' + (img.w ? img.w + '×' + img.h + ' · ' : '') + fmt(img.bytes.length);
      logLine('✓ ' + name + ' · ' + fmt(img.bytes.length), 'ok');
      if (R.n >= CFG.max) { R.stop = 'достигнут лимит: ' + CFG.max + ' страниц'; break; }
      // дальше
      state('Перехожу на следующую страницу…');
      var before = I.curUrl();
      R.seen[before.split('#')[0]] = 1;
      var nx = await findNext(w, true);
      if (nx && nx.href) {
        if (R.seen[nx.href.split('#')[0]]) { R.stop = 'следующая страница уже была — конец'; break; }
        if (CFG.stop === 'chapter' && chapterKey(nx.href) !== R.startKey) { R.stop = 'конец главы (дальше — ' + nx.href.replace(/^https?:\/\//, '').slice(0, 60) + ')'; break; }
        var wl = waitLoad(w, 20000); w.loadURL(nx.href); await wl;
      } else if (nx && nx.clicked) {
        var wl2 = waitLoad(w, 6000); await findNext(w, false); await wl2;
      } else if (CFG.arrow) {
        logLine('Кнопка не найдена — нажимаю →');
        var wl3 = waitLoad(w, 5000);
        try { w.focus(); w.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); w.sendInputEvent({ type: 'keyUp', keyCode: 'Right' }); } catch (e) {}
        await wl3;
      } else { R.stop = 'кнопка «Следующая» не найдена — конец'; break; }
      var after = I.curUrl();
      if (CFG.stop === 'chapter' && after !== before && chapterKey(after) !== R.startKey) { R.stop = 'конец главы'; break; }
    }
    // конец
    logLine('■ ' + R.stop, 'shot');
    if (R.list.length) { try { await N.writeFile(R.dir, 'список.txt', new TextEncoder().encode('Мое_граббер — авто-листание\n' + new Date().toLocaleString('ru-RU') + '\nОстановка: ' + R.stop + '\n\n' + R.list.join('\n') + '\n')); } catch (e) {} }
    if (CFG.zip && R.files.length) {
      state('Упаковываю ZIP…');
      var z = new ZipWriter(); R.files.forEach(function (f) { z.add(f.name, f.bytes); });
      var blob = z.blob(), parts = R.dir.split(/[\\/]/), base = parts.pop(), parent = R.dir.slice(0, R.dir.length - base.length - 1);
      try { var zp = await N.writeFile(parent, base + '.zip', new Uint8Array(await blob.arrayBuffer())); logLine('ZIP: ' + zp, 'ok'); } catch (e) { logLine('ZIP не сохранился', 'bad'); }
      R.files = [];
    }
    $('#pgCount').textContent = 'Сохранено страниц: ' + R.n + ' · ' + fmt(R.total);
    R.done = true;
    state('Готово: ' + R.stop);
    I.toast('Авто-листание: ' + R.n + ' стр. — ' + R.stop, true);
  }

  // ---------- кнопки запуска ----------
  var btn = document.createElement('button'); btn.className = 'ib'; btn.id = 'bPager'; btn.title = 'Авто-листание (скачать главу по страницам)'; btn.setAttribute('aria-label', 'Авто-листание'); btn.textContent = '📖';
  var menuBtn = $('#bMenu'); if (menuBtn) menuBtn.parentNode.insertBefore(btn, menuBtn);
  btn.onclick = function () { if (panel.hidden) open(); else panel.hidden = true; };
  var grid = $('#menu .menuGrid');
  if (grid) {
    grid.insertAdjacentHTML('beforeend', '<button class="mi" data-act3="pager"><span>📖</span>Авто-листание</button>');
    grid.addEventListener('click', function (e) { if (e.target.closest('[data-act3]')) { I.closeSheet('menu'); open(); } });
  }
  window.MG_pager = { open: open, chapterKey: chapterKey, cfg: CFG };   // для проверки
})();
