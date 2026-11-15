/* Мое_граббер 1.4.0 — интерфейс: вкладки, адресная строка, выбор картинок, скачивание в ZIP, сохранение */
(function () {
  'use strict';
  var VERSION = '1.4.0';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function jget(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); if (window.MMAccount && /^mg_(settings|bookmarks|history)$/.test(k)) window.MMAccount.changed(); } catch (e) {} }
  function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ'; }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function plural(n, a, b, c) { var m = n % 100, k = n % 10; return n + ' ' + (m > 10 && m < 15 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c); }

  var DEF = { sv: 4, mode: 'fast', search: 'google', conv: '', q: 92, shots: true, min: 100, conc: 4, proxies: Grab.DEFAULT_PROXIES.slice() };
  var STORED = jget('mg_settings', null) || {};
  var S = Object.assign({}, DEF, STORED);
  S.sv = STORED.sv || (Object.keys(STORED).length ? 1 : DEF.sv);
  if (!Array.isArray(S.proxies) || !S.proxies.length) S.proxies = DEF.proxies.slice();
  // 1.1.0: поиск по умолчанию — Google; старый набор прокси (codetabs закрыт) меняем на новый, свои прокси сохраняем
  if ((S.sv || 1) < 2) {
    S.search = 'google';
    var own = S.proxies.filter(function (p) { return Grab.OLD_DEFAULTS.indexOf(p) < 0 && DEF.proxies.indexOf(p) < 0; });
    S.proxies = own.concat(DEF.proxies);
    S.sv = 2; try { localStorage.setItem('mg_settings', JSON.stringify(S)); } catch (e) {}
  }
  // 1.3.0: новый набор прокси (свои, добавленные вручную, остаются сверху)
  if ((S.sv || 1) < 4) {
    var mine = S.proxies.filter(function (p) { return Grab.OLD_DEFAULTS.indexOf(p) < 0 && DEF.proxies.indexOf(p) < 0; });
    S.proxies = mine.concat(DEF.proxies);
    try { localStorage.setItem('mg_settings', JSON.stringify(Object.assign({}, S, { sv: Math.max(S.sv || 1, 3) }))); } catch (e) {}
  }
  var FIX_DIRECT = S.sv < 3; // 1.2.0: «Напрямую» больше не залипает у вкладок
  if (FIX_DIRECT && S.mode === 'direct') S.mode = 'fast';
  if (S.sv < 4) { S.sv = 4; try { localStorage.setItem('mg_settings', JSON.stringify(S)); } catch (e) {} }
  Grab.proxies = S.proxies;
  function saveS() { jset('mg_settings', S); Grab.proxies = S.proxies; }

  var SEARCH = {
    bing: ['https://www.bing.com/search?q={q}', 'https://www.bing.com/images/search?q={q}'],
    ddg: ['https://html.duckduckgo.com/html/?q={q}', 'https://www.bing.com/images/search?q={q}'],
    google: ['https://www.google.com/search?q={q}&hl=ru&gbv=1', 'https://www.google.com/search?q={q}&tbm=isch&hl=ru&gbv=1'],
    yandex: ['https://yandex.ru/search/?text={q}', 'https://yandex.ru/images/search?text={q}']
  };
  var TILES = [
    ['Википедия', 'https://ru.wikipedia.org/', 'W'], ['Викисклад', 'https://commons.wikimedia.org/', '◎'],
    ['Unsplash', 'https://unsplash.com/', '◼'], ['Pexels', 'https://www.pexels.com/ru-ru/', 'P'],
    ['Pinterest', 'https://ru.pinterest.com/', 'P'], ['Reddit', 'https://old.reddit.com/r/pics/', 'R'],
    ['Картинки Bing', 'https://www.bing.com/images/trending', 'B'], ['DeviantArt', 'https://www.deviantart.com/', 'D']
  ];

  // ---------- мелочи ----------
  var toastT;
  function toast(t, long) { var el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('on'); }, long ? 5200 : 2600); }
  function busy(on) { $('#loadBar').classList.toggle('on', !!on); }
  var openSheets = [];
  function openSheet(id) { var el = $('#' + id); el.hidden = false; requestAnimationFrame(function () { el.classList.add('on'); }); if (openSheets.indexOf(id) < 0) openSheets.push(id); }
  function closeSheet(id) { var el = $('#' + id); el.classList.remove('on'); setTimeout(function () { if (!el.classList.contains('on')) el.hidden = true; }, 220); openSheets = openSheets.filter(function (x) { return x !== id; }); }
  document.addEventListener('click', function (e) { var c = e.target.closest('[data-close]'); if (c) closeSheet(c.closest('.sheet').id); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openSheets.length && openSheets[openSheets.length - 1] !== 'work') closeSheet(openSheets[openSheets.length - 1]); });

  // ---------- вкладки ----------
  var tabs = jget('mg_tabs', null), cur = 0, seq = 1;
  if (!Array.isArray(tabs) || !tabs.length) tabs = [newTabObj()];
  tabs.forEach(function (t) { t.id = seq++; t.items = null; t.html = null; });
  cur = Math.min(jget('mg_tab', 0) || 0, tabs.length - 1);
  if (FIX_DIRECT) tabs.forEach(function (t) { if (t.mode === 'direct') t.mode = ''; });
  function newTabObj(url) { return { id: seq++, hist: url ? [url] : [], i: url ? 0 : -1, title: '', mode: '' }; }
  function T() { return tabs[cur]; }
  function curUrl() { var t = T(); return t.i >= 0 ? t.hist[t.i] : ''; }
  function saveTabs() {
    jset('mg_tabs', tabs.map(function (t) { var s = Math.max(0, t.hist.length - 30); return { hist: t.hist.slice(s), i: Math.max(-1, t.i - s), title: t.title, mode: t.mode }; }));
    jset('mg_tab', cur);
  }

  // ---------- адрес ----------
  function toUrl(s, images, engine) {
    s = (s || '').trim(); if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^\/\//.test(s)) return 'https:' + s;
    if (!/\s/.test(s) && /^[^/]+\.[a-zа-яё]{2,}(?::\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
    if (/^localhost(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
    var tpl = (SEARCH[engine || S.search] || SEARCH.google)[images ? 1 : 0];
    return tpl.replace('{q}', encodeURIComponent(s));
  }

  var frame = null, loadId = 0, collectWait = {};
  function makeFrame(direct) {
    var box = $('#frameBox'); box.innerHTML = '';
    frame = document.createElement('iframe');
    frame.id = 'frame';
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', 'fullscreen');
    if (direct) frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    else frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    box.appendChild(frame);
    return frame;
  }

  // ================= Программа для Windows: настоящие вкладки-браузеры (<webview>) =================
  var NATIVE = window.MGNative || null;
  function dvAll() { return $$('#frameBox webview'); }
  function dvShow(t) {
    $('#frameBox').querySelectorAll('iframe').forEach(function (f) { f.remove(); });
    dvAll().forEach(function (w) { w.style.display = w === t.wv ? 'flex' : 'none'; });
  }
  function dvCreate(t, url) {
    var wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:web');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('webpreferences', 'contextIsolation=yes');
    wv.src = url; t.wv = wv; t.wvReady = false;
    wv.addEventListener('dom-ready', function () { t.wvReady = true; if (t === T()) updateBar(); });
    wv.addEventListener('did-start-loading', function () { if (t === T()) busy(true); });
    wv.addEventListener('did-stop-loading', function () {
      if (t === T()) busy(false);
      dvScan(t);
    });
    function onNav(u) {
      if (!/^https?:/i.test(u)) return;
      var pend = t.pending; t.pending = '';
      if (pend === 'back' && t.i > 0) t.i--;
      else if (pend === 'fwd' && t.i < t.hist.length - 1) t.i++;
      if (t.hist[t.i] !== u) {
        if (pend) t.hist[t.i] = u;   // переадресация во время перехода назад/вперёд
        else { t.hist = t.hist.slice(0, t.i + 1); t.hist.push(u); t.i = t.hist.length - 1; }
      }
      t.items = null; t.title = host(u);
      if (t === T()) { setFab(0); updateBar(); $('#err').hidden = true; $('#frameBox').hidden = false; }
      saveTabs();
    }
    wv.addEventListener('did-navigate', function (e) { onNav(e.url); });
    wv.addEventListener('did-navigate-in-page', function (e) { if (e.isMainFrame) onNav(e.url); });
    wv.addEventListener('page-title-updated', function (e) { t.title = e.title; if (t === T()) updateBar(); addHistory(curUrlOf(t), e.title); saveTabs(); });
    wv.addEventListener('did-fail-load', function (e) {
      if (!e.isMainFrame || e.errorCode === -3) return;
      if (t === T()) { busy(false); showErr('Сайт не открылся: ' + (e.errorDescription || e.errorCode) + '\n' + (e.validatedURL || '') + '\n\nПроверьте адрес и интернет, затем «Повторить».'); }
    });
    $('#frameBox').appendChild(wv);
    return wv;
  }
  function curUrlOf(t) { return t.i >= 0 ? t.hist[t.i] : ''; }
  async function dvScan(t) {
    if (!t.wv || !t.wvReady) return null;
    try {
      var r = await t.wv.executeJavaScript(Grab.COLLECT_JS);
      var ex = Grab.extract(r.html, r.url);
      var map = {}, list = [];
      function put(it) { if (!it || !it.url || !/^(https?:|data:image)/.test(it.url) || /^data:/.test(it.url) && it.url.length < 200) return; var m = map[it.url]; if (m) { if ((it.nw || 0) > (m.nw || 0)) { m.nw = it.nw; m.nh = it.nh; } if (it.alt && !m.alt) m.alt = it.alt; return; } var c = Object.assign({ ext: Grab.extOf(it.url) }, it); map[it.url] = c; list.push(c); }
      r.items.forEach(put); ex.items.forEach(put);
      t.items = list; if (r.title) t.title = r.title;
      if (t === T()) { setFab(countBig(list)); updateBar(); }
      return list;
    } catch (e) { return null; }
  }
  function dvRender(reload) {
    var t = T(), url = curUrl();
    hideNote(); $('#err').hidden = true;
    if (!url) { if (t.wv) { t.wv.remove(); t.wv = null; } showHome(); return; }
    showFrame();
    if (!t.wv) dvCreate(t, url);
    else if (reload) t.wv.reload();
    else if (t.wvReady && t.wv.getURL() !== url) t.wv.loadURL(url);
    dvShow(t); updateBar(); setFab(countBig(t.items));
  }
  window.MG_pageUrl = function () { return curUrl(); };
  window.MG_pageWcId = function () { var t = T(); try { return t.wv && t.wvReady ? t.wv.getWebContentsId() : 0; } catch (e) { return 0; } };

  function showHome() {
    $('#home').hidden = false; $('#frameBox').hidden = true; $('#err').hidden = true; hideNote();
    if (NATIVE) dvAll().forEach(function (w) { w.style.display = 'none'; });
    $('#addr').value = ''; $('#lock').textContent = '⌕';
    renderHome(); updateBar(); setFab(0);
  }
  function showFrame() { $('#home').hidden = true; $('#frameBox').hidden = false; $('#err').hidden = true; }
  function showErr(msg) { $('#home').hidden = true; $('#frameBox').hidden = true; $('#err').hidden = false; $('#errText').textContent = msg; }

  function updateBar() {
    var t = T(), u = curUrl();
    $('#bBack').disabled = t.i < 0; $('#bFwd').disabled = t.i >= t.hist.length - 1;
    $('#tabCount').textContent = tabs.length;
    if (document.activeElement !== $('#addr')) $('#addr').value = u ? u.replace(/^https:\/\//, '') : '';
    $('#lock').textContent = !u ? '⌕' : /^https:/.test(u) ? '🔒' : 'ⓘ';
    var bm = jget('mg_bookmarks', []); var on = u && bm.some(function (b) { return b.url === u; });
    $('#bStar').textContent = on ? '★' : '☆'; $('#bStar').classList.toggle('on', !!on); $('#bStar').hidden = !u;
    document.title = (t.title ? t.title + ' — ' : '') + 'Мое_граббер';
  }
  function setFab(n) { var b = $('#fabN'); b.hidden = !n; b.textContent = n > 999 ? '999+' : n; }

  function addHistory(url, title) {
    var h = jget('mg_history', []).filter(function (x) { return x.url !== url; });
    h.unshift({ url: url, title: title || host(url), t: Date.now() }); jset('mg_history', h.slice(0, 200));
  }

  var pageCache = {};
  function navigate(url, opts) {
    opts = opts || {};
    url = Grab.unwrap(url);
    if (!url) return;
    var t = T();
    if (NATIVE) {
      if (t.wv && t.wvReady && !opts.fromHist) { t.pending = ''; t.wv.loadURL(url); showFrame(); dvShow(t); return; }
    }
    if (!opts.fromHist) {
      if (opts.replace && t.i >= 0) t.hist[t.i] = url;
      else { t.hist = t.hist.slice(0, t.i + 1); t.hist.push(url); t.i = t.hist.length - 1; }
    }
    saveTabs(); render(opts.reload);
  }

  async function render(reload) {
    if (NATIVE) { dvRender(reload); return; }
    var t = T(), url = curUrl(), my = ++loadId;
    updateBar();
    if (!url) { showHome(); return; }
    var mode = t.once === url ? 'direct' : (t.mode || S.mode);
    if (t.once && t.once !== url) t.once = '';
    t.items = null; t.html = null; t.title = host(url);
    setFab(0); busy(true); hideNote();
    var gIgu = isGoogleIgu(url);
    if (mode === 'direct' && !gIgu && NOFRAME.test(host(url))) {
      mode = 'fast';
      showNote(esc(host(url)) + ' не разрешает показывать себя внутри других сайтов, поэтому открыт в режиме «Быстро».');
    }
    if (mode === 'direct') {
      if (gIgu) showNote('Это Google напрямую (через прокси он просил капчу). Чтобы скачать фото с найденного сайта: долгое нажатие на ссылку → «Копировать адрес ссылки» → вставьте в адресную строку граббера.', [['Искать в Bing', function () { navigate(toUrl(googleQuery(url), /tbm=isch|udm=2/.test(url), 'bing')); }]]);
      else showNote('Режим «Напрямую». Если видите «не позволяет установить соединение» — сайт запрещает показ внутри граббера.', [['Открыть быстро', function () { t.once = ''; if (t.mode === 'direct') t.mode = ''; saveTabs(); render(); }], ['В Chrome ↗', function () { window.open(url, '_blank', 'noopener'); }]]);
      showFrame(); var f = makeFrame(true); f.src = url;
      f.onload = function () { if (my === loadId) busy(false); };
      setTimeout(function () { if (my === loadId) busy(false); }, 8000);
      addHistory(url, t.title);
      // картинки ищем по коду страницы в фоне
      if (gIgu) { addHistory(url, 'Google'); return; }
      try { var r0 = await getPage(url, reload); if (my !== loadId) return; if (r0.html) { var ex0 = Grab.extract(r0.html, r0.url); t.items = ex0.items; t.title = ex0.title || t.title; setFab(countBig(t.items)); updateBar(); } } catch (e) {}
      return;
    }
    try {
      var res = await getPage(url, reload);
      if (my !== loadId) return;
      if (res.image || Grab.extOf(url) && !res.html) { renderImagePage(url, t); busy(false); return; }
      if (isGoogleBlock(url, res.html)) {
        delete pageCache[url]; busy(false);
        var q = googleQuery(url);
        var gu = 'https://www.google.com/search?igu=1&hl=ru&q=' + encodeURIComponent(q) + (/tbm=isch|udm=2/.test(url) ? '&udm=2' : '');
        t.once = gu; navigate(gu, { replace: true }); return;
      }
      var refresh = Grab.metaRefresh(res.html, res.url);
      if (refresh && refresh !== url) { busy(false); navigate(refresh, { replace: true }); return; }
      var ex = Grab.extract(res.html, res.url);
      if (looksLikeImageText(res.html) && Grab.extOf(url)) { renderImagePage(url, t); busy(false); return; }
      t.items = ex.items; t.html = res.html; t.title = ex.title || host(url);
      showFrame();
      var f2 = makeFrame(false);
      f2.onload = function () { if (my === loadId) busy(false); };
      f2.srcdoc = Grab.prepare(res.html, res.url, mode);
      setFab(countBig(t.items)); updateBar(); addHistory(url, t.title); saveTabs();
    } catch (e) {
      if (my !== loadId) return;
      busy(false);
      if (Grab.extOf(url)) { renderImagePage(url, t); return; }
      showErr((e && e.message ? e.message : 'Ошибка') + '\n\nПопробуйте «Открыть напрямую» или добавьте свой прокси (Настройки → Прокси).');
    }
  }
  // Сайты, которые запрещают показ внутри других сайтов (для них «Напрямую» не работает)
  var NOFRAME = /(^|\.)(google\.[a-z.]+|youtube\.com|bing\.com|yandex\.[a-z]+|ya\.ru|facebook\.com|instagram\.com|x\.com|twitter\.com|vk\.com|ok\.ru|pinterest\.[a-z.]+|reddit\.com|github\.com|tiktok\.com|linkedin\.com|amazon\.[a-z.]+|ozon\.ru|ozon\.kz|wildberries\.[a-z]+|avito\.ru|kaspi\.kz|olx\.kz|telegram\.org|t\.me|mail\.ru|dzen\.ru|apple\.com|microsoft\.com|duckduckgo\.com|deviantart\.com|artstation\.com|behance\.net|flickr\.com|tumblr\.com|unsplash\.com|pexels\.com|freepik\.com|shutterstock\.com)$/i;
  function isGoogleIgu(url) { try { var u = new URL(url); return /(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.searchParams.get('igu') === '1'; } catch (e) { return false; } }
  function showNote(text, btns) {
    var n = $('#note'); n.innerHTML = '<span>' + text + '</span>';
    (btns || []).forEach(function (b) { var el = document.createElement('button'); el.className = 'btn sm'; el.textContent = b[0]; el.onclick = b[1]; n.appendChild(el); });
    var x = document.createElement('button'); x.className = 'ib x'; x.setAttribute('aria-label', 'Скрыть'); x.textContent = '✕'; x.onclick = hideNote; n.appendChild(x);
    n.hidden = false; $('#view').classList.add('noted'); $('#view').style.setProperty('--noteH', n.offsetHeight + 'px');
  }
  function hideNote() { $('#note').hidden = true; $('#view').classList.remove('noted'); }
  function isGoogleBlock(url, html) {
    return /(^|\.)google\.[a-z.]+$/.test(host(url).replace(/^www\./, '')) && /\/search/.test(url) &&
      (/\/sorry\/|unusual traffic|recaptcha|detected unusual|не робот|необычный трафик/i.test(html) || html.length < 1500);
  }
  function googleQuery(url) { try { return new URL(url).searchParams.get('q') || ''; } catch (e) { return ''; } }
  function looksLikeImageText(s) { return /^\s*(�|GIF8|RIFF|\x89PNG)/.test(s.slice(0, 8)); }
  function renderImagePage(url, t) {
    t.items = [{ url: url, kind: 'img', ext: Grab.extOf(url), alt: '' }]; t.title = Grab.nameFrom(url);
    showFrame(); var f = makeFrame(false);
    f.srcdoc = '<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;height:100%;background:#111;display:grid;place-items:center}img{max-width:100%;max-height:100vh}</style><img src="' + esc(url) + '">';
    setFab(1); updateBar(); addHistory(url, t.title);
  }
  async function getPage(url, reload) {
    var c = pageCache[url];
    if (c && !reload && Date.now() - c.t < 10 * 60000) return c.r;
    var r = await Grab.fetchPage(url);
    if (r.image) { pageCache[url] = { r: { image: true, url: url }, t: Date.now() }; return pageCache[url].r; }
    var keys = Object.keys(pageCache); if (keys.length > 15) delete pageCache[keys[0]];
    pageCache[url] = { r: r, t: Date.now() };
    return r;
  }
  function countBig(items) { return (items || []).filter(function (i) { return i.kind !== 'icon'; }).length; }

  // сообщения из страницы
  window.addEventListener('message', function (e) {
    var d = e.data; if (!d || !d.mg || !frame || e.source !== frame.contentWindow) return;
    if (d.type === 'nav' && d.url) {
      if (d.tab) { tabs.push(newTabObj()); cur = tabs.length - 1; }
      navigate(d.url);
    } else if (d.type === 'toast') toast(d.text, true);
    else if (d.type === 'loaded') { busy(false); if (d.title && !T().title) { T().title = d.title; updateBar(); } }
    else if (d.type === 'ctx') openPicker({ only: d.url, alt: d.alt });
    else if (d.type === 'collected' && collectWait[d.id]) { collectWait[d.id](d.items || []); delete collectWait[d.id]; }
  });
  function collectLive() {
    if (NATIVE) return dvScan(T()).then(function (l) { return l || []; });
    return new Promise(function (resolve) {
      if (!frame || !frame.contentWindow || (T().mode || S.mode) === 'direct') { resolve([]); return; }
      var id = Math.random().toString(36).slice(2);
      collectWait[id] = resolve;
      try { frame.contentWindow.postMessage({ mg: 1, type: 'collect', id: id }, '*'); } catch (e) { resolve([]); }
      setTimeout(function () { if (collectWait[id]) { delete collectWait[id]; resolve([]); } }, 1500);
    });
  }

  // ---------- главная ----------
  function renderHome() {
    $('#tiles').innerHTML = TILES.map(function (t) { return '<button class="tile" data-url="' + esc(t[1]) + '"><span>' + esc(t[2]) + '</span>' + esc(t[0]) + '</button>'; }).join('');
    var bm = jget('mg_bookmarks', []), hi = jget('mg_history', []).slice(0, 12);
    $('#bmHead').hidden = !bm.length; $('#hiHead').hidden = !hi.length;
    function row(x, del) { return '<div class="li"><button class="go" data-url="' + esc(x.url) + '"><b>' + esc(x.title || host(x.url)) + '</b><small>' + esc(x.url.replace(/^https?:\/\//, '')) + '</small></button>' + (del ? '<button class="ib x" data-del="' + esc(x.url) + '" aria-label="Удалить">✕</button>' : '') + '</div>'; }
    $('#bmList').innerHTML = bm.map(function (x) { return row(x, true); }).join('');
    $('#hiList').innerHTML = hi.map(function (x) { return row(x, false); }).join('');
  }
  $('#home').addEventListener('click', function (e) {
    var d = e.target.closest('[data-del]');
    if (d) { jset('mg_bookmarks', jget('mg_bookmarks', []).filter(function (b) { return b.url !== d.dataset.del; })); renderHome(); return; }
    var g = e.target.closest('[data-url]'); if (g) navigate(g.dataset.url);
  });
  $('#homeForm').addEventListener('submit', function (e) { e.preventDefault(); var u = toUrl($('#homeQ').value); if (u) { $('#homeQ').blur(); navigate(u); } });
  $('#homeImg').addEventListener('click', function () { var q = $('#homeQ').value.trim(); if (!q) { $('#homeQ').focus(); toast('Напишите, какие картинки искать'); return; } navigate(toUrl(q, true)); });

  // ---------- верхняя панель ----------
  $('#addrForm').addEventListener('submit', function (e) { e.preventDefault(); var u = toUrl($('#addr').value); $('#addr').blur(); if (u) navigate(u); });
  $('#addr').addEventListener('focus', function () { var u = curUrl(); if (u) this.value = u; this.select(); });
  $('#addr').addEventListener('blur', function () { setTimeout(updateBar, 100); });
  function goBack() {
    var t = T();
    if (NATIVE && t.wv && t.wvReady) {
      if (t.i > 0) { t.pending = 'back'; t.wv.loadURL(t.hist[t.i - 1]); return; }   // переход сам сдвинет историю вкладки
      t.i = -1; t.hist = []; t.wv.remove(); t.wv = null; saveTabs(); render(); return;
    }
    if (t.i >= 0) { t.i--; saveTabs(); render(); }
  }
  function goFwd() {
    var t = T();
    if (NATIVE && t.wv && t.wvReady) { if (t.i < t.hist.length - 1) { t.pending = 'fwd'; t.wv.loadURL(t.hist[t.i + 1]); } return; }
    if (t.i < t.hist.length - 1) { t.i++; saveTabs(); render(); }
  }
  $('#bBack').addEventListener('click', goBack);
  $('#bFwd').addEventListener('click', goFwd);
  $('#bReload').addEventListener('click', function () { render(true); });
  $('#bStar').addEventListener('click', function () {
    var u = curUrl(); if (!u) return;
    var bm = jget('mg_bookmarks', []), i = bm.findIndex(function (b) { return b.url === u; });
    if (i >= 0) { bm.splice(i, 1); toast('Убрано из закладок'); } else { bm.unshift({ url: u, title: T().title || host(u) }); toast('Добавлено в закладки'); }
    jset('mg_bookmarks', bm); updateBar();
  });
  $('#errRetry').addEventListener('click', function () { render(true); });
  // «Открыть напрямую» — только для этой страницы, режим вкладки не меняется
  $('#errDirect').addEventListener('click', function () { T().once = curUrl(); render(); });
  $('#errChrome').addEventListener('click', function () { if (NATIVE) NATIVE.openExternal(curUrl()); else window.open(curUrl(), '_blank', 'noopener'); });

  // вкладки
  function renderTabs() {
    $('#tabList').innerHTML = tabs.map(function (t, i) {
      var u = t.i >= 0 ? t.hist[t.i] : '';
      return '<div class="li' + (i === cur ? ' cur' : '') + '"><button class="go" data-tab="' + i + '"><b>' + esc(t.title || (u ? host(u) : 'Новая вкладка')) + '</b><small>' + esc(u ? u.replace(/^https?:\/\//, '') : 'Главная') + '</small></button><button class="ib x" data-tclose="' + i + '" aria-label="Закрыть вкладку">✕</button></div>';
    }).join('');
  }
  $('#bTabs').addEventListener('click', function () { renderTabs(); openSheet('tabs'); });
  $('#tabNew').addEventListener('click', function () { tabs.push(newTabObj()); cur = tabs.length - 1; saveTabs(); closeSheet('tabs'); render(); setTimeout(function () { $('#homeQ').focus(); }, 250); });
  $('#tabList').addEventListener('click', function (e) {
    var c = e.target.closest('[data-tclose]');
    if (c) {
      var i = +c.dataset.tclose; if (tabs[i] && tabs[i].wv) tabs[i].wv.remove(); tabs.splice(i, 1);
      if (!tabs.length) tabs.push(newTabObj());
      if (cur >= tabs.length) cur = tabs.length - 1; else if (i < cur) cur--;
      saveTabs(); renderTabs(); render(); return;
    }
    var g = e.target.closest('[data-tab]'); if (g) { cur = +g.dataset.tab; saveTabs(); closeSheet('tabs'); render(); }
  });

  // меню
  var MODE_HINT = { fast: 'Страница без её скриптов: открывается быстро, картинки находятся надёжно. Сайты-приложения могут выглядеть пустыми.', full: 'Скрипты сайта работают. Сайт выглядит ближе к настоящему, но может работать с ошибками.', direct: 'Сайт как в обычном браузере. Некоторые сайты запрещают показ внутри другого сайта, а адрес при переходах по ссылкам не обновляется.' };
  function renderMenu() {
    var m = T().mode || S.mode;
    $$('#modeSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m); });
    $('#modeHint').textContent = MODE_HINT[m];
    $('#mnUrl').textContent = curUrl() ? host(curUrl()) : 'Главная';
  }
  $('#bMenu').addEventListener('click', function () { renderMenu(); openSheet('menu'); });
  $('#modeSeg').addEventListener('click', function (e) { var b = e.target.closest('[data-mode]'); if (!b) return; T().mode = b.dataset.mode; saveTabs(); renderMenu(); if (curUrl()) render(); });
  $('#menu').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var a = b.dataset.act, u = curUrl(); closeSheet('menu');
    if (a === 'newtab') { tabs.push(newTabObj()); cur = tabs.length - 1; saveTabs(); render(); }
    else if (a === 'home') { var t = T(); t.hist = t.hist.slice(0, t.i + 1); t.i = -1; t.hist = []; t.title = ''; if (t.wv) { t.wv.remove(); t.wv = null; } saveTabs(); render(); }
    else if (a === 'pageshot') { if (!u) { toast('Сначала откройте сайт'); return; } openPicker({ pageShot: true }); }
    else if (a === 'chrome') { if (u) { if (NATIVE) NATIVE.openExternal(u); else window.open(u, '_blank', 'noopener'); } }
    else if (a === 'copy') { if (u) (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { toast('Адрес скопирован'); }, function () { prompt('Адрес:', u); }); }
    else if (a === 'settings') openSettings();
  });

  // ---------- выбор картинок ----------
  var P = { items: [], sel: {}, fmt: 'all' };
  function fmtOf(it) { return it.ext || (it.kind === 'svg' ? 'svg' : it.kind === 'canvas' ? 'png' : ''); }
  function isSmall(it) { if (it.kind === 'icon') return true; var m = Math.max(it.nw || 0, it.nh || 0); return it.loaded && m > 0 && m < S.min; }
  async function openPicker(o) {
    o = o || {};
    var u = curUrl();
    if (!u) { toast('Сначала откройте сайт или вставьте ссылку на фото'); return; }
    var t = T();
    P.fmt = 'all'; $('#pkPage').checked = !!o.pageShot;
    $('#pkTitle').textContent = 'Ищу картинки…'; $('#pkSub').textContent = host(u);
    $('#pkGrid').innerHTML = ''; $('#pkEmpty').hidden = true; $('#pkChips').innerHTML = '';
    openSheet('picker');
    if (!t.items && NATIVE) t.items = (await dvScan(t)) || [];
    if (!t.items) { try { var r = await getPage(u); if (r.html) t.items = Grab.extract(r.html, r.url).items; else t.items = [{ url: u, kind: 'img', ext: Grab.extOf(u) }]; } catch (e) { t.items = Grab.extOf(u) ? [{ url: u, kind: 'img', ext: Grab.extOf(u) }] : []; } }
    var live = await collectLive();
    var map = {}, list = [];
    function put(it) { var k = it.url; if (map[k]) { var m = map[k]; if (it.nw > (m.nw || 0)) { m.nw = it.nw; m.nh = it.nh; } if (it.alt && !m.alt) m.alt = it.alt; return; } var c = Object.assign({ ext: Grab.extOf(k) }, it); map[k] = c; list.push(c); }
    (t.items || []).forEach(put);
    live.forEach(function (it) { if (/^(https?:|data:image)/.test(it.url)) put(it); });
    if (o.only && !map[o.only]) put({ url: o.only, kind: 'img', alt: o.alt || '' });
    P.items = list; P.sel = {};
    list.forEach(function (it) { if (o.only ? it.url === o.only : (it.kind !== 'icon' && it.kind !== 'data')) P.sel[it.url] = 1; });
    if (o.only) { $('#pkSmall').checked = false; }
    drawPicker(true);
    if (o.only) setTimeout(function () { var el = $('#pkGrid [data-u="' + CSS.escape(o.only) + '"]'); if (el) el.scrollIntoView({ block: 'center' }); }, 300);
  }
  function visible() {
    var small = $('#pkSmall').checked, list = P.items.filter(function (it) {
      if (P.fmt !== 'all' && (fmtOf(it) || 'other') !== P.fmt) return false;
      if (small && isSmall(it)) return false;
      return true;
    });
    if ($('#pkSort').value === 'big') list = list.slice().sort(function (a, b) { return (b.nw * b.nh || 0) - (a.nw * a.nh || 0); });
    // не показывающиеся — в конец
    list = list.filter(function (i) { return !i.failed; }).concat(list.filter(function (i) { return i.failed; }));
    return list;
  }
  function drawChips() {
    var cnt = { all: P.items.length };
    P.items.forEach(function (it) { var f = fmtOf(it) || 'other'; cnt[f] = (cnt[f] || 0) + 1; });
    var order = ['all', 'jpg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico', 'tif', 'heic', 'apng', 'other'];
    $('#pkChips').innerHTML = order.filter(function (f) { return cnt[f]; }).map(function (f) {
      var name = f === 'all' ? 'Все' : f === 'other' ? 'Другие' : f.toUpperCase();
      return '<button class="chip' + (P.fmt === f ? ' on' : '') + '" data-f="' + f + '">' + name + ' <i>' + cnt[f] + '</i></button>';
    }).join('');
  }
  function tileHtml(it) {
    var f = fmtOf(it), on = P.sel[it.url];
    var dim = it.nw ? it.nw + '×' + it.nh : '';
    return '<div class="tl' + (on ? ' on' : '') + (it.failed ? ' bad' : '') + '" data-u="' + esc(it.url) + '"><img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="' + esc(it.url) + '" alt="">' +
      '<span class="ck">✓</span><span class="fm">' + esc(f ? f.toUpperCase() : 'IMG') + '</span><span class="dm">' + esc(dim) + '</span><button class="zm" data-zoom aria-label="Посмотреть">⤢</button></div>';
  }
  function drawPicker(first) {
    drawChips();
    var list = visible();
    $('#pkGrid').innerHTML = list.map(tileHtml).join('');
    $('#pkEmpty').hidden = !!list.length;
    $$('#pkGrid img').forEach(function (img) {
      var it = byUrl(img.parentNode.dataset.u);
      img.onload = function () { it.loaded = true; it.nw = img.naturalWidth; it.nh = img.naturalHeight; var d = img.parentNode.querySelector('.dm'); if (d) d.textContent = it.nw + '×' + it.nh; if (first && $('#pkSmall').checked && isSmall(it)) { delete P.sel[it.url]; img.parentNode.remove(); updCount(); } };
      img.onerror = function () {
        // в программе: миниатюры с защитой от чужих ссылок подгружаем сами, с адресом страницы
        if (NATIVE && !it.thumbTried && /^https?:/.test(it.url)) {
          it.thumbTried = true;
          NATIVE.fetch(it.url, curUrl()).then(function (r) {
            if (r && r.ok && r.body && r.body.length > 24) { var t0 = Grab.sniff(r.body); if (t0) { img.src = URL.createObjectURL(new Blob([r.body], { type: t0.mime })); return; } }
            it.failed = true; img.parentNode.classList.add('bad');
          }, function () { it.failed = true; img.parentNode.classList.add('bad'); });
          return;
        }
        it.failed = true; img.parentNode.classList.add('bad');
      };
      if (img.complete && !img.naturalWidth) img.onerror(); else if (img.complete && img.naturalWidth) img.onload();
    });
    updCount();
  }
  function byUrl(u) { for (var i = 0; i < P.items.length; i++) if (P.items[i].url === u) return P.items[i]; return null; }
  function updCount() {
    var n = Object.keys(P.sel).length, shown = $$('#pkGrid .tl').length;
    $('#pkTitle').textContent = 'Найдено: ' + plural(P.items.length, 'картинка', 'картинки', 'картинок');
    $('#pkSub').textContent = host(curUrl()) + (shown !== P.items.length ? ' · показано ' + shown : '');
    var page = $('#pkPage').checked;
    $('#pkGo').textContent = n || page ? 'Скачать ' + (n ? plural(n, 'фото', 'фото', 'фото') : '') + (page ? (n ? ' + скриншот' : 'скриншот страницы') : '') + ' в ZIP' : 'Выберите картинки';
    $('#pkGo').disabled = !n && !page;
  }
  $('#pkGrid').addEventListener('click', function (e) {
    var tl = e.target.closest('.tl'); if (!tl) return;
    var u = tl.dataset.u;
    if (e.target.closest('[data-zoom]')) { openPreview(u); return; }
    if (P.sel[u]) delete P.sel[u]; else P.sel[u] = 1;
    tl.classList.toggle('on', !!P.sel[u]); updCount();
  });
  $('#pkChips').addEventListener('click', function (e) { var c = e.target.closest('[data-f]'); if (!c) return; P.fmt = c.dataset.f; drawPicker(); });
  $('#pkSmall').addEventListener('change', function () { drawPicker(); });
  $('#pkSort').addEventListener('change', function () { drawPicker(); });
  $('#pkPage').addEventListener('change', updCount);
  $('#pkAll').addEventListener('click', function () { $$('#pkGrid .tl').forEach(function (tl) { P.sel[tl.dataset.u] = 1; tl.classList.add('on'); }); updCount(); });
  $('#pkNone').addEventListener('click', function () { P.sel = {}; $$('#pkGrid .tl').forEach(function (tl) { tl.classList.remove('on'); }); updCount(); });
  $('#pkRescan').addEventListener('click', function () { T().items = null; delete pageCache[curUrl()]; openPicker({ pageShot: $('#pkPage').checked }); });
  $('#fab').addEventListener('click', function () { openPicker(); });

  var pvUrl = '';
  function openPreview(u) {
    var it = byUrl(u); pvUrl = u;
    $('#pvImg').src = u; $('#pvName').textContent = Grab.nameFrom(u, it && it.alt) + (fmtOf(it) ? '.' + fmtOf(it) : '');
    $('#pvInfo').textContent = (it && it.nw ? it.nw + '×' + it.nh + ' · ' : '') + (/^data:/.test(u) ? 'встроено в страницу' : host(u));
    $('#pvOpen').href = u; $('#pvOpen').hidden = /^data:/.test(u);
    $('#pvToggle').classList.toggle('on', !!P.sel[u]);
    openSheet('preview');
  }
  $('#pvToggle').addEventListener('click', function () {
    if (P.sel[pvUrl]) delete P.sel[pvUrl]; else P.sel[pvUrl] = 1;
    this.classList.toggle('on', !!P.sel[pvUrl]);
    var tl = $('#pkGrid [data-u="' + CSS.escape(pvUrl) + '"]'); if (tl) tl.classList.toggle('on', !!P.sel[pvUrl]); updCount();
  });

  // ---------- скачивание ----------
  var stop = false, lastZip = null;
  $('#pkGo').addEventListener('click', function () { var urls = P.items.filter(function (it) { return P.sel[it.url]; }); grabAll(urls, $('#pkPage').checked); });
  $('#wkStop').addEventListener('click', function () { stop = true; this.disabled = true; this.textContent = 'Останавливаю…'; });

  async function grabAll(items, pageShot) {
    stop = false; $('#wkStop').disabled = false; $('#wkStop').textContent = 'Остановить и сохранить, что есть';
    closeSheet('picker'); openSheet('work');
    var zip = new ZipWriter(), total = items.length + (pageShot ? 1 : 0), done = 0;
    var ok = 0, shots = 0, fails = [], lines = [];
    var page = curUrl(), pageTitle = T().title || host(page);
    var log = $('#wkLog'); log.innerHTML = '';
    var convDir = S.conv ? 'Фото (' + S.conv.toUpperCase() + ')/' : '';
    function step(text, cls) {
      done++;
      $('#wkBar').style.width = Math.round(done / total * 100) + '%';
      $('#wkTitle').textContent = done < total ? 'Скачиваю ' + done + ' из ' + total + '…' : 'Собираю архив…';
      var li = document.createElement('li'); li.className = cls || ''; li.textContent = text; log.appendChild(li); log.scrollTop = log.scrollHeight;
    }
    $('#wkTitle').textContent = 'Скачиваю 0 из ' + total + '…'; $('#wkBar').style.width = '0%';
    $('#wkSub').textContent = host(page);
    var pad = String(items.length).length < 3 ? 3 : String(items.length).length;
    var queue = items.map(function (it, i) { return { it: it, n: String(i + 1).padStart(pad, '0') }; });
    async function worker() {
      while (queue.length && !stop) {
        var job = queue.shift(), it = job.it, nm = job.n + ' ' + Grab.nameFrom(it.url, it.alt);
        var src = /^data:/.test(it.url) ? '(встроено в страницу)' : it.url;
        var img = await Grab.fetchImage(it.url);
        if (stop && !img) break;
        if (img) {
          var p = zip.add('Фото/' + nm + '.' + img.ext, img.bytes); ok++;
          lines.push(p + '  ←  ' + src + '  [' + img.via + ', ' + fmtSize(img.bytes.length) + ']');
          if (S.conv) { var cv = await Grab.convert(img, S.conv, S.q / 100); if (cv) zip.add(convDir + nm + '.' + cv.ext, cv.bytes); }
          step('✓ ' + nm + '.' + img.ext + ' · ' + fmtSize(img.bytes.length), 'ok');
        } else if (S.shots && !/^data:/.test(it.url)) {
          var sh = await Grab.screenshot(it.url, false);
          if (sh) { var p2 = zip.add('Скриншоты/' + nm + '.' + sh.ext, sh.bytes); shots++; lines.push(p2 + '  ←  ' + src + '  [' + sh.via + ']'); step('📷 ' + nm + ' — скриншот', 'shot'); }
          else { fails.push(src); step('✕ ' + nm + ' — не удалось', 'bad'); }
        } else { fails.push(src); step('✕ ' + nm + ' — не удалось', 'bad'); }
      }
    }
    var ws = []; for (var w = 0; w < Math.min(+S.conc || 4, Math.max(1, items.length)); w++) ws.push(worker());
    await Promise.all(ws);
    if (pageShot && !stop) {
      $('#wkTitle').textContent = 'Снимаю страницу целиком…';
      var ps = await Grab.screenshot(page, true);
      if (ps) { var p3 = zip.add('Скриншот страницы.' + ps.ext, ps.bytes); lines.push(p3 + '  ←  ' + page + '  [' + ps.via + ']'); step('📷 Скриншот страницы · ' + fmtSize(ps.bytes.length), 'shot'); }
      else { fails.push('Скриншот страницы: ' + page); step('✕ Скриншот страницы не получился', 'bad'); }
    }
    queue.forEach(function (j) { fails.push(/^data:/.test(j.it.url) ? '(встроено в страницу)' : j.it.url); });
    var now = new Date();
    var head = 'Мое_граббер ' + VERSION + '\nСтраница: ' + pageTitle + '\n' + page + '\nДата: ' + now.toLocaleString('ru-RU') + '\n\nФото «как есть»: ' + ok + ', скриншотов: ' + shots + ', не удалось: ' + fails.length + '\n\n';
    zip.add('список.txt', head + lines.sort().join('\n') + '\n');
    if (fails.length) zip.add('не скачались.txt', 'Эти картинки не удалось скачать ни напрямую, ни через прокси, ни скриншотом:\n\n' + fails.join('\n') + '\n');
    var blob = zip.blob();
    lastZip = { blob: blob, ok: ok, shots: shots, fails: fails.length, page: page };
    closeSheet('work');
    if (!ok && !shots) { toast('Ничего не скачалось. Проверьте прокси в настройках или включите скриншоты.', true); }
    var stamp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + '_' + String(now.getHours()).padStart(2, '0') + '-' + String(now.getMinutes()).padStart(2, '0');
    openSave('Мое_граббер_' + (host(page) || 'фото').replace(/[^\wа-яё.-]+/gi, '_') + '_' + stamp + '.zip');
  }

  // ---------- сохранение ----------
  function openSave(name) {
    var z = lastZip;
    $('#svName').value = name;
    $('#svSub').textContent = fmtSize(z.blob.size);
    $('#svSum').innerHTML = '<span class="ok">✓ Фото: ' + z.ok + '</span>' + (z.shots ? '<span class="shot">📷 Скриншоты: ' + z.shots + '</span>' : '') + (z.fails ? '<span class="bad">✕ Не удалось: ' + z.fails + '</span>' : '');
    if (NATIVE) {
      $('#svPick').hidden = false; $('#svPick').textContent = '💾 Сохранить как… (выбрать папку и имя)'; $('#svShare').hidden = true;
      $('#svDl').textContent = '⬇ В папку «Загрузки»'; $('#svHint').textContent = 'Можно сохранить несколько раз в разные места.';
      openSheet('save'); return;
    }
    var canPick = 'showSaveFilePicker' in window;
    var canShare = false; try { canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'a.zip', { type: 'application/zip' })] })); } catch (e) {}
    $('#svPick').hidden = !canPick; $('#svShare').hidden = !canShare;
    $('#svShare').classList.toggle('pri', !canPick);
    $('#svHint').textContent = canPick ? 'Можно сохранить несколько раз в разные места.' : 'Совет: чтобы Chrome спрашивал папку для «Загрузок», включите в Chrome → Настройки → Скачанные файлы → «Спрашивать, где сохранять файлы».';
    openSheet('save');
  }
  function zipName() { var n = $('#svName').value.trim() || 'Мое_граббер.zip'; n = n.replace(/[\\/:*?"<>|]+/g, '_'); return /\.zip$/i.test(n) ? n : n + '.zip'; }
  $('#svPick').addEventListener('click', async function () {
    if (NATIVE) {
      var p = await NATIVE.saveAs(zipName(), new Uint8Array(await lastZip.blob.arrayBuffer()));
      if (p) toast('Сохранено: ' + p, true); return;
    }
    try {
      var h = await window.showSaveFilePicker({ suggestedName: zipName(), types: [{ description: 'ZIP-архив', accept: { 'application/zip': ['.zip'] } }] });
      var w = await h.createWritable(); await w.write(lastZip.blob); await w.close();
      toast('Сохранено: ' + h.name);
    } catch (e) { if (e.name !== 'AbortError') { toast('Не получилось сохранить так — пробую «Загрузки»'); download(); } }
  });
  $('#svShare').addEventListener('click', async function () {
    try { var f = new File([lastZip.blob], zipName(), { type: 'application/zip' }); await navigator.share({ files: [f], title: zipName() }); }
    catch (e) { if (e.name !== 'AbortError') toast('Не удалось открыть «Поделиться»: ' + (e.message || e.name)); }
  });
  $('#svDl').addEventListener('click', download);
  async function download() {
    if (NATIVE) { var p = await NATIVE.saveDownloads(zipName(), new Uint8Array(await lastZip.blob.arrayBuffer())); toast('Сохранено в «Загрузки»: ' + p, true); return; }
    var url = URL.createObjectURL(lastZip.blob), a = document.createElement('a');
    a.href = url; a.download = zipName(); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    toast('Архив отправлен в «Загрузки»');
  }

  // ---------- настройки ----------
  function openSettings() {
    $('#stMode').value = S.mode; $('#stSearch').value = S.search; $('#stConv').value = S.conv;
    $('#stQ').value = S.q; $('#stQv').textContent = S.q; $('#stShots').checked = !!S.shots;
    $('#stMin').value = S.min; $('#stConc').value = String(S.conc);
    $('#stProxies').value = S.proxies.join('\n'); $('#stTests').innerHTML = '';
    openSheet('settings');
  }
  function bindSet(id, key, fn) { $(id).addEventListener('change', function () { S[key] = fn ? fn(this) : this.value; saveS(); }); }
  bindSet('#stMode', 'mode'); bindSet('#stSearch', 'search'); bindSet('#stConv', 'conv');
  bindSet('#stQ', 'q', function (el) { return +el.value; }); $('#stQ').addEventListener('input', function () { $('#stQv').textContent = this.value; });
  bindSet('#stShots', 'shots', function (el) { return el.checked; });
  bindSet('#stMin', 'min', function (el) { return Math.max(0, +el.value || 0); });
  bindSet('#stConc', 'conc', function (el) { return +el.value; });
  $('#stProxies').addEventListener('change', function () {
    var l = this.value.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return /^https?:\/\//.test(s); });
    l = l.map(function (s) { return /\{u\}|\{raw\}/.test(s) ? s : s.replace(/\s#json\s*$/i, '') + '{u}' + (/\s#json\s*$/i.test(s) ? ' #json' : ''); });
    S.proxies = l.length ? l : DEF.proxies.slice(); this.value = S.proxies.join('\n'); saveS();
  });
  $('#stReset').addEventListener('click', function () { S.proxies = DEF.proxies.slice(); $('#stProxies').value = S.proxies.join('\n'); saveS(); toast('Прокси как было'); });
  $('#stTest').addEventListener('click', async function () {
    var ul = $('#stTests'); ul.innerHTML = '';
    for (var i = 0; i < S.proxies.length; i++) {
      var li = document.createElement('li'); li.textContent = '… ' + host(S.proxies[i]); ul.appendChild(li);
      var t0 = Date.now();
      var nm = Grab.pname(S.proxies[i]);
      try {
        var r = await Grab.timedFetch(Grab.proxyUrl(S.proxies[i], 'https://example.com/'), {}, 20000); var tx = await r.text();
        var good = r.ok && /Example Domain/.test(tx), why = good ? '' : (Grab.proxyError(tx) || ('ответ ' + r.status));
        li.textContent = (good ? '✓ ' : '✕ ') + nm + ' — ' + (good ? (Date.now() - t0) + ' мс' : why); li.className = good ? 'ok' : 'bad';
      } catch (e) { li.textContent = '✕ ' + nm + ' — не отвечает'; li.className = 'bad'; }
    }
  });
  $('#cfHelpLink').addEventListener('click', function (e) { e.preventDefault(); var h = $('.help'); h.open = true; var d = $('#cfHelp'); d.open = true; d.scrollIntoView({ behavior: 'smooth' }); });
  $('#cfCopy').addEventListener('click', function () {
    var code = $('#cfCode').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(function () { toast('Код скопирован'); }, function () { var r = document.createRange(); r.selectNodeContents($('#cfCode')); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Выделено — скопируйте'); });
  });
  // ---------- диагностика ----------
  async function runDiag() {
    openSheet('diag');
    var box = $('#dgRows'), ex = $('#dgExtra'); box.innerHTML = ''; ex.innerHTML = '';
    $('#dgState').textContent = 'Проверяю… (до минуты)'; $('#dgRun').disabled = true;
    var rows = {};
    var extra = await Grab.diagnose(function (tpl, names, cells) {
      var id = btoa(unescape(encodeURIComponent(tpl))).replace(/[^a-z0-9]/gi, '');
      var tr = rows[id]; if (!tr) { tr = rows[id] = document.createElement('div'); tr.className = 'dgRow'; box.appendChild(tr); }
      tr.innerHTML = '<b>' + esc(Grab.pname(tpl)) + '</b>' + names.map(function (n, i) {
        var c = cells[i]; if (!c) return '<span class="dgC wait">' + esc(n) + ': …</span>';
        return '<span class="dgC ' + (c.ok ? 'ok' : 'bad') + '">' + (c.ok ? '✓ ' : '✕ ') + esc(n) + (c.ok ? ' · ' + c.ms + ' мс' : ' — ' + esc(c.why)) + '</span>';
      }).join('');
    });
    ex.innerHTML = extra.map(function (e) { return '<div class="dgC ' + (e.ok ? 'ok' : 'bad') + '">' + (e.ok ? '✓ ' : '✕ ') + esc(e.name) + ' — ' + esc(e.why) + '</div>'; }).join('');
    var good = $$('#dgRows .dgC.ok').length;
    $('#dgState').textContent = good ? 'Готово. Рабочих проверок: ' + good + '. Сделайте скриншот и пришлите его в чат с Claude.' : 'Ни один прокси не открыл ни одного сайта. Пришлите скриншот в чат с Claude — и, скорее всего, нужен свой прокси (Настройки → Инструкции).';
    $('#dgRun').disabled = false;
  }
  $('#dgRun').addEventListener('click', runDiag);
  $('#stDiag').addEventListener('click', runDiag);
  $('#errDiag').addEventListener('click', runDiag);
  $('#stClearHist').addEventListener('click', function () { jset('mg_history', []); toast('История очищена'); renderHome(); });
  $('#stClearBm').addEventListener('click', function () { if (confirm('Удалить все закладки?')) { jset('mg_bookmarks', []); toast('Закладки удалены'); renderHome(); } });

  // ---------- запуск ----------
  // Ссылка из «Поделиться» (Android) или ?url=
  (function () {
    var q = new URLSearchParams(location.search), shared = q.get('url') || q.get('text') || q.get('title');
    if (shared) {
      var m = shared.match(/https?:\/\/\S+/); var u = m ? m[0] : toUrl(shared);
      history.replaceState(null, '', location.pathname);
      if (u) { if (curUrl()) { tabs.push(newTabObj()); cur = tabs.length - 1; } navigate(u); return; }
    }
    render();
  })();

  if (NATIVE) {
    NATIVE.on('open-tab', function (url) { tabs.push(newTabObj()); cur = tabs.length - 1; saveTabs(); navigate(url); });
    NATIVE.on('ctx', function (d) { openPicker({ only: d.url, alt: d.alt }); });
    NATIVE.on('key', function (k) {
      if (k === 'reload') render(true);
      else if (k === 'address') { $('#addr').focus(); }
      else if (k === 'newtab') { tabs.push(newTabObj()); cur = tabs.length - 1; saveTabs(); render(); setTimeout(function () { $('#homeQ').focus(); }, 100); }
      else if (k === 'closetab') { var t = T(); if (t.wv) t.wv.remove(); tabs.splice(cur, 1); if (!tabs.length) tabs.push(newTabObj()); if (cur >= tabs.length) cur = tabs.length - 1; saveTabs(); render(); }
      else if (k === 'back') goBack(); else if (k === 'forward') goFwd();
      else if (k === 'picker') openPicker();
    });
  }
  window.MG = { version: VERSION, navigate: navigate, openPicker: openPicker, state: function () { return { tabs: tabs, cur: cur, P: P, S: S }; } };
})();
