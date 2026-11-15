/* Мое_граббер — сеть, разбор страниц, поиск картинок, скачивание и скриншоты.
   Сайт работает в браузере телефона, поэтому чужие страницы и фото забираются через «прокси» (посредники),
   которые разрешают читать чужие сайты. Если фото не отдаётся ни напрямую, ни через прокси — делаем его скриншот. */
(function () {
  'use strict';

  // 1.1.0: codetabs закрыт (июнь 2026), corsproxy.io бесплатно только для разработки — поставлены живые прокси.
  // {u} — адрес целиком закодированный, {raw} — как есть. r.jina.ai отдаёт страницу текстом (Markdown) — последний запасной.
  // 1.3.0: больше прокси, опрашиваются почти одновременно. « #json» в конце — прокси отдаёт страницу внутри JSON
  var DEFAULT_PROXIES = [
    'https://proxy.cors.dev/{raw}',
    'https://api.allorigins.win/raw?url={u}',
    'https://api.allorigins.win/get?url={u} #json',
    'https://api.cors.lol/?url={u}',
    'https://whateverorigin.org/get?url={u} #json',
    'https://everyorigin.jwvbremen.nl/api/get?url={u} #json',
    'https://corsproxy.io/?url={u}',
    'https://r.jina.ai/{raw}'
  ];
  var V2_DEFAULTS = [
    'https://proxy.cors.dev/{raw}',
    'https://api.allorigins.win/raw?url={u}',
    'https://corsproxy.io/?url={u}',
    'https://r.jina.ai/{raw}'
  ];
  var OLD_DEFAULTS = [
    'https://api.allorigins.win/raw?url={u}',
    'https://corsproxy.io/?url={u}',
    'https://api.codetabs.com/v1/proxy?quest={u}'
  ];
  var IMG_EXT = /\.(jpe?g|jfif|pjpeg|png|apng|gif|webp|avif|svg|bmp|ico|tiff?|heic|heif)(?:$|[?#])/i;
  var BAD_SCHEME = /^(javascript|mailto|tel|sms|about|blob|chrome|intent):/i;

  var G = {
    proxies: DEFAULT_PROXIES.slice(),
    DEFAULT_PROXIES: DEFAULT_PROXIES,
    OLD_DEFAULTS: OLD_DEFAULTS.concat(V2_DEFAULTS),
    timeout: 20000,
    good: 0, // номер прокси, который сработал последним — с него и начинаем
    fails: {} // сколько раз подряд прокси не сработал (в этом сеансе)
  };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function abs(u, base) { try { return new URL(u, base).href; } catch (e) { return null; } }
  function isJson(tpl) { return /\s#json\s*$/i.test(tpl); }
  function proxyUrl(tpl, url) { return tpl.replace(/\s#json\s*$/i, '').trim().replace('{u}', encodeURIComponent(url)).replace('{raw}', url); }
  // Достаём страницу из JSON-обёртки (allorigins/get, whateverorigin, everyorigin…)
  function unwrapJson(text) {
    var j; try { j = JSON.parse(text); } catch (e) { return { err: 'ответ не JSON' }; }
    var c = j && (j.contents != null ? j.contents : j.html != null ? j.html : j.body != null ? j.body : j.data && (j.data.contents || j.data.html));
    var code = j && j.status && (j.status.http_code || j.status.code);
    if (typeof c !== 'string' || !c) return { err: (j && (j.error || j.Error || j.message)) ? String(j.error || j.Error || j.message).slice(0, 100) : 'пустой ответ' };
    if (/^data:[^;]+;base64,/.test(c)) { try { c = decodeURIComponent(escape(atob(c.split(',')[1]))); } catch (e) {} }
    return { text: c, code: code };
  }
  function isReader(tpl) { return /r\.jina\.ai/.test(tpl); }
  function pname(tpl) { try { var u = new URL(proxyUrl(tpl, 'x')); return u.hostname.replace(/^(www|api|proxy)\./, '') + (isJson(tpl) ? ' (json)' : ''); } catch (e) { return tpl; } }

  function timedFetch(url, opts, ms) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms || G.timeout);
    opts = Object.assign({ signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }, opts || {});
    return fetch(url, opts).finally(function () { clearTimeout(t); });
  }

  // Порядок прокси: сначала тот, что сработал в прошлый раз; те, что 3 раза подряд не ответили, — в конец
  function order(binary) {
    var list = G.proxies.filter(function (p) { return p && !(binary && isReader(p)); });
    var i = list.indexOf(G.proxies[G.good]);
    var out = i > 0 ? [list[i]].concat(list.filter(function (_, k) { return k !== i; })) : list.slice();
    var alive = out.filter(function (p) { return (G.fails[p] || 0) < 3; }), dead = out.filter(function (p) { return (G.fails[p] || 0) >= 3; });
    return alive.concat(dead);
  }
  function remember(tpl) { var i = G.proxies.indexOf(tpl); if (i >= 0) G.good = i; G.fails[tpl] = 0; }
  function failed(tpl) { G.fails[tpl] = (G.fails[tpl] || 0) + 1; }

  // Ответ прокси с ошибкой вместо страницы (лимиты, «нужен ключ», блок по IP, IPv4/IPv6 и т. п.)
  var ERR_RE = /rate.?limit|too many requests|quota|api.?key|unauthori[sz]ed|forbidden|access denied|not allowed|blocked|ipv[46]|\bip address\b|your ip|upgrade (your )?plan|pricing|error\s*(code)?\s*:?\s*5\d\d|bad gateway|gateway time-?out|service unavailable|origin (is )?unreachable|failed to fetch|could not (fetch|proxy)|proxy error|shut ?down|disabled|cloudflare ray id/i;
  function proxyError(text, url) {
    var t = (text || '').trim();
    if (t.length < 30) return 'пустой ответ';
    var head = t.slice(0, 400);
    if (/^[\[{]/.test(head)) {
      try { var j = JSON.parse(t); if (j && (j.error || j.Error || j.message && !j.contents)) return String((j.error && (j.error.message || j.error)) || j.Error || j.message).slice(0, 120); } catch (e) {}
    }
    // Короткий ответ с текстом ошибки — это не сайт
    if (t.length < 4000 && ERR_RE.test(t) && !/<(img|article|main|section|nav)\b/i.test(t)) {
      var plain = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return plain.slice(0, 120) || 'ошибка прокси';
    }
    return null;
  }

  // Markdown от r.jina.ai → простая страница
  function mdToHtml(md, url) {
    var title = (md.match(/^Title:\s*(.*)$/m) || [])[1] || '';
    var body = md.split(/^Markdown Content:\s*$/m)[1] || md;
    function e(x) { return x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function inline(x) {
      x = e(x);
      x = x.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, '<img src="$2" alt="$1">');
      x = x.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, '<a href="$2">$1</a>');
      x = x.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      return x;
    }
    var html = body.split(/\n{2,}/).map(function (blk) {
      blk = blk.trim(); if (!blk) return '';
      var h = blk.match(/^(#{1,6})\s+(.*)$/); if (h && blk.indexOf('\n') < 0) return '<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>';
      if (/^([*+-]|\d+\.)\s/.test(blk)) return '<ul>' + blk.split('\n').map(function (l) { return '<li>' + inline(l.replace(/^\s*([*+-]|\d+\.)\s+/, '')) + '</li>'; }).join('') + '</ul>';
      return '<p>' + inline(blk).replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + e(title) + '</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:12px 16px;color:#222}img{max-width:100%;height:auto}a{color:#4a3fe0}.mg-note{font-size:13px;background:#fff6dc;border-radius:8px;padding:8px 10px;color:#6b5600}</style></head><body><p class="mg-note">Упрощённый вид страницы (через r.jina.ai): сайт не открылся через обычные прокси.</p>' + html + '</body></html>';
  }

  // ---------- страницы ----------
  // Один прокси: вернёт { html } или бросит ошибку с понятной причиной
  async function tryProxy(tpl, url, ctl) {
    var nm = pname(tpl), ms = isReader(tpl) ? 30000 : G.timeout;
    var t = setTimeout(function () { ctl.abort(); }, ms);
    try {
      var res = await fetch(proxyUrl(tpl, url), { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: isReader(tpl) ? { 'X-Return-Format': 'markdown' } : undefined });
      var ct = res.headers.get('content-type') || '';
      if (res.ok && /^image\//i.test(ct)) return { image: true, url: url, via: tpl };
      var html = await res.text();
      if (!res.ok) throw new Error(nm + ': ' + res.status + (proxyError(html) ? ' ' + proxyError(html) : ''));
      if (isJson(tpl)) {
        var w = unwrapJson(html);
        if (w.err) throw new Error(nm + ': ' + w.err);
        if (w.code && w.code >= 400 && w.text.length < 3000) throw new Error(nm + ': сайт ответил ' + w.code);
        html = w.text;
      }
      var bad = proxyError(html, url);
      if (bad) throw new Error(nm + ': ' + bad);
      if (isReader(tpl)) html = mdToHtml(html, url);
      return { html: html, url: url, via: tpl, reader: isReader(tpl) };
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(nm + ': ' + (ctl.won ? 'не понадобился' : 'не ответил вовремя'));
      if (e instanceof TypeError) throw new Error(nm + ': нет связи или запрещено браузером');
      throw e;
    } finally { clearTimeout(t); }
  }

  // Страница: сначала напрямую, затем прокси «волнами» — каждые 2 секунды подключается следующий, побеждает первый успешный
  async function fetchPage(url) {
    try {
      var r = await timedFetch(url, { mode: 'cors' }, 8000);
      if (r.ok) { var t0 = await r.text(); if (t0 && t0.length > 50) return { html: t0, url: r.url || url, via: 'напрямую' }; }
    } catch (e) { /* обычно чужой сайт не разрешает — идём через прокси */ }
    var list = order(false);
    if (!list.length) throw new Error('Страница не открылась.\nНет прокси в настройках');
    // Запуск по цепочке: следующий прокси стартует, как только предыдущий отказал, или через 2,5 секунды ожидания
    return await new Promise(function (resolve, reject) {
      var errors = [], ctls = [], won = false, next = 0, finished = 0;
      function launch() {
        if (won || next >= list.length) return;
        var tpl = list[next++], ctl = new AbortController(), started = false;
        ctls.push(ctl);
        var timer = setTimeout(function () { if (!started) { started = true; launch(); } }, 2500);
        tryProxy(tpl, url, ctl).then(function (res) {
          clearTimeout(timer);
          if (won) return;
          won = true; remember(tpl);
          ctls.forEach(function (c) { if (c !== ctl) { c.won = true; c.abort(); } });
          resolve(res);
        }, function (e) {
          clearTimeout(timer); finished++;
          if (won) return;
          failed(tpl); errors.push(e.message);
          if (!started) { started = true; launch(); }
          if (finished >= list.length) {
            var err = new Error('Страница не открылась.\n' + errors.join('\n'));
            err.codes = errors; reject(err);
          }
        });
      }
      launch();
    });
  }

  // Диагностика: каждый прокси на нескольких сайтах — что отвечает на этом телефоне
  async function diagnose(onRow) {
    var tests = [
      ['example.com', 'https://example.com/', /Example Domain/],
      ['Википедия', 'https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D1%88%D0%BA%D0%B0', /Кошк|Felis/],
      ['Google', 'https://www.google.com/search?q=cat&hl=ru&gbv=1', /<a [^>]*href="\/url\?|<h3/],
      ['Bing', 'https://www.bing.com/search?q=cat', /b_algo|b_results/]
    ];
    var list = G.proxies.filter(Boolean);
    await Promise.all(list.map(async function (tpl) {
      var cells = [];
      for (var k = 0; k < tests.length; k++) {
        var t0 = Date.now(), ctl = new AbortController();
        try {
          var r = await tryProxy(tpl, tests[k][1], ctl);
          cells.push(r.html && tests[k][2].test(r.html) ? { ok: true, ms: Date.now() - t0 } : { ok: false, why: r.image ? 'прислал картинку' : 'не та страница (капча/заглушка)' });
        } catch (e) { cells.push({ ok: false, why: String(e.message).replace(/^[^:]+:\s*/, '').slice(0, 90) }); }
        onRow(tpl, tests.map(function (x) { return x[0]; }), cells);
      }
    }));
    // напрямую и запасные службы для фото
    var extra = [];
    async function probe(name, u, okFn) {
      var t0 = Date.now();
      try { var r = await timedFetch(u, { mode: 'cors' }, 20000); var ok = r.ok && await okFn(r); extra.push({ name: name, ok: ok, why: ok ? (Date.now() - t0) + ' мс' : 'ответ ' + r.status }); }
      catch (e) { extra.push({ name: name, ok: false, why: e.name === 'AbortError' ? 'не ответил вовремя' : 'нет связи или запрещено' }); }
    }
    await Promise.all([
      probe('Фото напрямую (Викисклад)', 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/120px-Cat03.jpg', async function (r) { return !!(await blobToImage(r)); }),
      probe('Фото через wsrv.nl', 'https://wsrv.nl/?url=' + encodeURIComponent('https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/120px-Cat03.jpg'), async function (r) { return !!(await blobToImage(r)); }),
      probe('Скриншоты microlink', 'https://api.microlink.io/?url=' + encodeURIComponent('https://example.com') + '&meta=false', async function (r) { var j = await r.json(); return j && j.status === 'success'; })
    ]);
    return extra;
  }

  // ---------- определение формата по первым байтам ----------
  function sniff(u8) {
    function s(a, b) { return String.fromCharCode.apply(null, u8.subarray(a, b)); }
    if (u8.length < 4) return null;
    if (u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return { ext: 'jpg', mime: 'image/jpeg' };
    if (u8[0] === 0x89 && s(1, 4) === 'PNG') return { ext: 'png', mime: 'image/png' };
    if (s(0, 4) === 'GIF8') return { ext: 'gif', mime: 'image/gif' };
    if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
    if (s(4, 8) === 'ftyp') {
      var brand = s(8, 12);
      if (/avi[fs]/.test(brand)) return { ext: 'avif', mime: 'image/avif' };
      if (/hei[cx]|mif1|msf1|heim|heis/.test(brand)) return { ext: 'heic', mime: 'image/heic' };
    }
    if (s(0, 2) === 'BM') return { ext: 'bmp', mime: 'image/bmp' };
    if (u8[0] === 0 && u8[1] === 0 && u8[2] === 1 && u8[3] === 0) return { ext: 'ico', mime: 'image/x-icon' };
    if (s(0, 4) === 'II*\u0000' || s(0, 4) === 'MM\u0000*') return { ext: 'tif', mime: 'image/tiff' };
    var head = s(0, Math.min(u8.length, 600)).replace(/^﻿/, '').trim().toLowerCase();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/.test(head)) return { ext: 'svg', mime: 'image/svg+xml' };
    return null;
  }

  async function blobToImage(res) {
    var buf = new Uint8Array(await res.arrayBuffer());
    var t = sniff(buf);
    if (!t) { // svg без заголовка, но с правильным типом
      var ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('svg') >= 0 && /<svg/i.test(new TextDecoder().decode(buf.subarray(0, 2000)))) t = { ext: 'svg', mime: 'image/svg+xml' };
    }
    if (!t || buf.length < 24) return null;
    return { bytes: buf, ext: t.ext, mime: t.mime };
  }

  // Фото «как есть»: те же байты, что отдаёт сайт. Запасной путь — wsrv.nl (может пересжать, формат сохраняет)
  async function viaProxy(url, ms) {
    var list = order(true);
    for (var i = 0; i < list.length; i++) {
      try {
        var res = await timedFetch(proxyUrl(list[i], url), {}, ms || 15000);
        if (!res.ok) { failed(list[i]); continue; }
        if (isJson(list[i])) { var w = unwrapJson(await res.text()); if (w.err || !/^data:image\//.test(w.text || '')) continue; res = await fetch(w.text); }
        var img = await blobToImage(res);
        if (img) { remember(list[i]); img.via = 'через ' + pname(list[i]); return img; }
      } catch (e) { failed(list[i]); }
    }
    return null;
  }
  async function viaWsrv(url) {
    try {
      var r = await timedFetch('https://wsrv.nl/?url=' + encodeURIComponent(url) + '&n=-1', { mode: 'cors' }, 20000);
      if (r.ok) { var im = await blobToImage(r); if (im) { im.via = 'через wsrv.nl (может быть пересжато)'; return im; } }
    } catch (e) {}
    return null;
  }
  async function fetchImage(url) {
    if (/^data:/i.test(url)) {
      try { var rd = await fetch(url); return Object.assign(await blobToImage(rd) || {}, { via: 'со страницы' }); } catch (e) { return null; }
    }
    try {
      var r = await timedFetch(url, { mode: 'cors' }, 12000);
      if (r.ok) { var im = await blobToImage(r); if (im) { im.via = 'напрямую'; return im; } }
    } catch (e) { /* нет разрешения — дальше прокси */ }
    return (await viaProxy(url)) || (await viaWsrv(url));
  }

  // ---------- скриншоты (службы-фотографы страниц) ----------
  async function getBinary(url) {
    try { var r = await timedFetch(url, { mode: 'cors' }, 40000); if (r.ok) { var im = await blobToImage(r); if (im) return im; } } catch (e) {}
    return (await viaProxy(url, 40000)) || (await viaWsrv(url));
  }
  async function screenshot(url, fullPage) {
    // 1) microlink (бесплатно ~50 снимков в день)
    try {
      var api = 'https://api.microlink.io/?url=' + encodeURIComponent(url) + '&screenshot=true&meta=false&viewport.width=1280&viewport.height=900' + (fullPage ? '&screenshot.fullPage=true' : '');
      var r = await timedFetch(api, { mode: 'cors' }, 45000);
      if (r.ok) {
        var j = await r.json(), su = j && j.data && j.data.screenshot && j.data.screenshot.url;
        if (su) { var a = await getBinary(su); if (a) { a.via = 'скриншот microlink'; return a; } }
      }
    } catch (e) {}
    // 2) thum.io
    try {
      var b = await getBinary('https://image.thum.io/get/' + (fullPage ? 'fullpage/' : '') + 'width/1280/noanimate/' + url);
      if (b && b.bytes.length > 3000) { b.via = 'скриншот thum.io'; return b; }
    } catch (e) {}
    // 3) mshots (WordPress) — первый ответ бывает заглушкой «готовлю снимок», ждём
    for (var k = 0; k < 3; k++) {
      try {
        var c = await getBinary('https://s0.wp.com/mshots/v1/' + encodeURIComponent(url) + '?w=1280&h=' + (fullPage ? 3000 : 900));
        if (c && c.ext !== 'gif' && c.bytes.length > 5000) { c.via = 'скриншот mshots'; return c; }
      } catch (e) {}
      await sleep(4000);
    }
    return null;
  }

  // Перевод в JPG/PNG/WEBP (копия рядом с оригиналом)
  async function convert(img, type, quality) {
    if (!type || img.ext === 'gif') return null;
    var mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[type];
    if (!mime || img.mime === mime) return null;
    var url = URL.createObjectURL(new Blob([img.bytes], { type: img.mime }));
    try {
      var el = new Image(); el.decoding = 'async'; el.src = url;
      await el.decode();
      var w = el.naturalWidth || 1024, h = el.naturalHeight || 1024;
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      var cx = cv.getContext('2d');
      if (type === 'jpg') { cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); }
      cx.drawImage(el, 0, 0, w, h);
      var blob = await new Promise(function (r) { cv.toBlob(r, mime, quality || 0.92); });
      if (!blob) return null;
      return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: type, mime: mime };
    } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
  }

  // ---------- поиск картинок в HTML ----------
  function extOf(url) {
    if (/^data:image\/([a-z0-9+.-]+)/i.test(url)) { var m = RegExp.$1.toLowerCase(); return m === 'jpeg' ? 'jpg' : m === 'svg+xml' ? 'svg' : m; }
    var mm = url.match(IMG_EXT); if (!mm) return '';
    var e = mm[1].toLowerCase(); return e === 'jpeg' || e === 'jfif' || e === 'pjpeg' ? 'jpg' : e === 'tiff' ? 'tif' : e === 'heif' ? 'heic' : e;
  }
  function bestFromSrcset(ss, base) {
    if (!ss) return null;
    var best = null, bestW = -1;
    ss.split(/,\s+(?=\S)/).forEach(function (part) {
      var p = part.trim().split(/\s+/), u = p[0], d = p[1] || '1x', w = parseFloat(d) * (/x$/.test(d) ? 1000 : 1);
      if (u && w > bestW) { bestW = w; best = u; }
    });
    return best ? abs(best, base) : null;
  }
  var LAZY = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-full', 'data-full-src', 'data-hi-res-src', 'data-zoom-src', 'data-zoom-image', 'data-large_image', 'data-large-file', 'data-orig-file', 'data-image', 'data-img', 'data-bg', 'data-background', 'data-background-image'];

  function Collector(base) { this.base = base; this.map = {}; this.list = []; }
  Collector.prototype.add = function (u, kind, extra) {
    if (!u) return;
    u = String(u).trim();
    if (!u || BAD_SCHEME.test(u)) return;
    if (/^data:/i.test(u)) { if (!/^data:image\//i.test(u) || u.length < 200) return; }
    else { u = abs(u.replace(/&amp;/g, '&'), this.base); if (!u || !/^https?:/i.test(u)) return; }
    var key = u.replace(/#.*$/, '');
    if (this.map[key]) { var o = this.map[key]; if (extra && extra.alt && !o.alt) o.alt = extra.alt; if (kind === 'img' && o.kind !== 'img') o.kind = 'img'; return; }
    if (this.list.length >= 2000) return;
    var it = Object.assign({ url: key, kind: kind, ext: extOf(key), alt: '' }, extra || {});
    this.map[key] = it; this.list.push(it);
  };

  function cssUrls(text) {
    var out = [], re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, m;
    while ((m = re.exec(text))) out.push(m[2]);
    return out;
  }

  function extract(html, base) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var bEl = doc.querySelector('base[href]'); if (bEl) base = abs(bEl.getAttribute('href'), base) || base;
    var C = new Collector(base);
    // разметка noscript у многих сайтов содержит настоящие <img>
    doc.querySelectorAll('noscript').forEach(function (n) { try { var d = new DOMParser().parseFromString(n.textContent, 'text/html'); d.querySelectorAll('img').forEach(function (i) { C.add(i.getAttribute('src'), 'img', { alt: i.getAttribute('alt') || '' }); }); } catch (e) {} });
    doc.querySelectorAll('img, image, source, input[type=image]').forEach(function (el) {
      var alt = el.getAttribute('alt') || el.getAttribute('title') || '';
      var big = bestFromSrcset(el.getAttribute('srcset') || el.getAttribute('data-srcset') || el.getAttribute('data-lazy-srcset'), base);
      if (big) C.add(big, 'img', { alt: alt });
      for (var i = 0; i < LAZY.length; i++) { var v = el.getAttribute(LAZY[i]); if (v) C.add(v, 'img', { alt: alt }); }
      C.add(el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href'), el.tagName === 'SOURCE' ? 'img' : 'img', { alt: alt, w: +el.getAttribute('width') || 0, h: +el.getAttribute('height') || 0 });
    });
    doc.querySelectorAll('a[href]').forEach(function (a) {
      var h = a.getAttribute('href');
      if (IMG_EXT.test(h)) C.add(h, 'link', { alt: a.getAttribute('title') || a.textContent.trim().slice(0, 80) });
      // Google «Картинки»: полный размер в параметре imgurl
      var m = h.match(/[?&]imgurl=([^&]+)/); if (m) { try { C.add(decodeURIComponent(m[1]), 'img'); } catch (e) {} }
    });
    doc.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"], meta[name="twitter:image"], meta[name="twitter:image:src"], meta[itemprop="image"]').forEach(function (m) { C.add(m.getAttribute('content'), 'meta', { alt: 'Обложка страницы' }); });
    doc.querySelectorAll('link[rel~="image_src"], link[rel~="apple-touch-icon"], link[rel~="icon"], link[rel="preload"][as="image"]').forEach(function (l) { C.add(l.getAttribute('href'), /icon/.test(l.getAttribute('rel')) ? 'icon' : 'img', { alt: 'Значок сайта' }); });
    doc.querySelectorAll('video[poster]').forEach(function (v) { C.add(v.getAttribute('poster'), 'img', { alt: 'Обложка видео' }); });
    doc.querySelectorAll('[style*="url("]').forEach(function (el) { cssUrls(el.getAttribute('style')).forEach(function (u) { C.add(u, 'bg'); }); });
    doc.querySelectorAll('style').forEach(function (s) { cssUrls(s.textContent).forEach(function (u) { if (IMG_EXT.test(u) || /^data:image/.test(u)) C.add(u, 'bg'); }); });
    // Bing «Картинки»: полный размер в атрибуте m
    doc.querySelectorAll('a.iusc[m], [data-m]').forEach(function (a) { try { var j = JSON.parse(a.getAttribute('m') || a.getAttribute('data-m')); if (j.murl) C.add(j.murl, 'img', { alt: j.t || '' }); } catch (e) {} });
    // Любые атрибуты со ссылкой на картинку
    doc.querySelectorAll('*').forEach(function (el) {
      for (var i = 0; i < el.attributes.length; i++) {
        var at = el.attributes[i]; if (at.name === 'href' || at.name === 'src' || at.name === 'style') continue;
        var v = at.value; if (v.length < 8 || v.length > 2000) continue;
        if (/^(https?:)?\/\/|^\//.test(v) && IMG_EXT.test(v) && !/\s/.test(v.trim())) C.add(v, 'img');
      }
    });
    // Встроенные SVG-рисунки
    doc.querySelectorAll('svg').forEach(function (svg) {
      var box = svg.getAttribute('viewBox'), w = parseFloat(svg.getAttribute('width')) || (box ? parseFloat(box.split(/[\s,]+/)[2]) : 0);
      if (w && w < 32) return;
      if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      var src = new XMLSerializer().serializeToString(svg);
      if (src.length < 150 || src.length > 400000 || /<use[\s>]/.test(src) && src.length < 800) return;
      C.add('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src), 'svg', { alt: 'Рисунок SVG со страницы' });
    });
    // Ссылки на картинки внутри данных страницы (JSON) — так сайты-приложения хранят полные фото
    var re = /https?:(?:\\?\/){2}[^\s"'<>\\()]+?\.(?:jpe?g|png|gif|webp|avif)(?:\?[^\s"'<>\\]*)?(?=["'\\\s<)])/gi, m, n = 0;
    var raw = html.replace(/\\u002[fF]/g, '/');
    while ((m = re.exec(raw)) && n < 600) { n++; C.add(m[0].replace(/\\\//g, '/').replace(/\\u0026/gi, '&'), 'data'); }
    var title = (doc.querySelector('title') || {}).textContent || '';
    return { items: C.list, title: title.trim(), base: base, doc: doc };
  }

  // ---------- подготовка страницы для встроенного браузера ----------
  // Скрипт внутри страницы: ссылки, формы, «ленивые» картинки, долгий тап по картинке, сбор картинок с живой страницы
  var FRAME_JS = function () {
    var BASE = document.baseURI;
    var LZ = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-full', 'data-hi-res-src'];
    function abs(u) { try { return new URL(u, document.baseURI).href; } catch (e) { return null; } }
    function post(o) { o.mg = 1; parent.postMessage(o, '*'); }
    function fix(root) {
      (root || document).querySelectorAll('img, source').forEach(function (el) {
        for (var i = 0; i < LZ.length; i++) { var v = el.getAttribute(LZ[i]); if (v && el.tagName === 'IMG' && (!el.getAttribute('src') || /^data:|blank|placeholder|lazy|spacer/i.test(el.getAttribute('src')))) { el.setAttribute('src', v); break; } }
        var ss = el.getAttribute('data-srcset') || el.getAttribute('data-lazy-srcset'); if (ss) el.setAttribute('srcset', ss);
        if (el.tagName === 'IMG') { el.loading = 'eager'; el.referrerPolicy = 'no-referrer'; }
      });
      (root || document).querySelectorAll('[data-bg],[data-background-image]').forEach(function (el) { var v = el.getAttribute('data-bg') || el.getAttribute('data-background-image'); if (v && !el.style.backgroundImage) el.style.backgroundImage = 'url("' + v + '")'; });
    }
    document.addEventListener('DOMContentLoaded', function () { fix(); post({ type: 'loaded', title: document.title }); });
    try { new MutationObserver(function () { fix(); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
      var h = a.getAttribute('href').trim();
      if (h[0] === '#') { e.preventDefault(); var t = document.getElementById(decodeURIComponent(h.slice(1))) || document.querySelector('[name="' + h.slice(1).replace(/"/g, '') + '"]'); if (t) t.scrollIntoView({ behavior: 'smooth' }); return; }
      e.preventDefault();
      if (/^(javascript|mailto|tel|sms):/i.test(h)) return;
      post({ type: 'nav', url: abs(h), tab: a.target === '_blank' });
    }, true);
    document.addEventListener('submit', function (e) {
      var f = e.target; e.preventDefault();
      var act = abs(f.getAttribute('action') || BASE);
      if ((f.getAttribute('method') || 'get').toLowerCase() !== 'get') { post({ type: 'toast', text: 'Эта форма отправляет данные — во встроенном браузере так нельзя. Откройте сайт в Chrome (меню ⋮).' }); return; }
      var u = new URL(act); u.search = ''; u.hash = '';
      new FormData(f).forEach(function (v, k) { if (typeof v === 'string') u.searchParams.append(k, v); });
      if (e.submitter && e.submitter.name) u.searchParams.append(e.submitter.name, e.submitter.value || '');
      post({ type: 'nav', url: u.href });
    }, true);
    // долгий тап по картинке
    document.addEventListener('contextmenu', function (e) {
      var el = e.target, u = null;
      if (el.tagName === 'IMG') u = el.currentSrc || el.src;
      else { var bg = getComputedStyle(el).backgroundImage; var m = bg && bg.match(/url\(["']?(.*?)["']?\)/); if (m) u = abs(m[1]); }
      if (u) { e.preventDefault(); post({ type: 'ctx', url: u, alt: el.alt || '' }); }
    }, true);
    function collect() {
      var out = [], seen = {};
      function add(u, kind, alt, w, h) { if (!u || seen[u]) return; seen[u] = 1; out.push({ url: u, kind: kind, alt: alt || '', nw: w || 0, nh: h || 0 }); }
      document.querySelectorAll('img').forEach(function (i) { add(i.currentSrc || i.src, 'img', i.alt, i.naturalWidth, i.naturalHeight); });
      var els = document.querySelectorAll('body *'), n = Math.min(els.length, 5000);
      for (var k = 0; k < n; k++) {
        var bg = getComputedStyle(els[k]).backgroundImage;
        if (bg && bg !== 'none') { var re = /url\(["']?(.*?)["']?\)/g, m; while ((m = re.exec(bg))) add(abs(m[1]), 'bg'); }
      }
      document.querySelectorAll('canvas').forEach(function (c) { try { if (c.width > 64 && c.height > 64) add(c.toDataURL('image/png'), 'canvas', 'Рисунок с холста'); } catch (e) {} });
      return out;
    }
    window.addEventListener('message', function (e) {
      var d = e.data; if (!d || !d.mg) return;
      if (d.type === 'collect') post({ type: 'collected', id: d.id, items: collect() });
    });
  };

  function prepare(html, url, mode) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var bEl = doc.querySelector('base[href]'), base = (bEl && abs(bEl.getAttribute('href'), url)) || url;
    doc.querySelectorAll('base, meta[http-equiv]').forEach(function (m) {
      var he = (m.getAttribute('http-equiv') || '').toLowerCase();
      if (m.tagName === 'BASE' || he === 'refresh' || he === 'content-security-policy' || he === 'x-frame-options') m.remove();
    });
    if (mode !== 'full') {
      doc.querySelectorAll('script, iframe[src*="ads"], link[rel=preload][as=script], link[rel=modulepreload]').forEach(function (s) { s.remove(); });
      doc.querySelectorAll('noscript').forEach(function (n) { var t = doc.createElement('div'); t.innerHTML = n.textContent; n.replaceWith(t); });
      doc.querySelectorAll('*').forEach(function (el) {
        for (var i = el.attributes.length - 1; i >= 0; i--) { var a = el.attributes[i].name; if (/^on/i.test(a)) el.removeAttribute(a); }
      });
      doc.querySelectorAll('[href^="javascript:"]').forEach(function (a) { a.setAttribute('href', '#'); });
      // Сайты-приложения прячут страницу до загрузки скриптов — показываем
      var fixCss = doc.createElement('style');
      fixCss.textContent = 'html,body{opacity:1!important;visibility:visible!important;overflow:auto!important}img{max-width:100%;height:auto}';
      (doc.head || doc.documentElement).appendChild(fixCss);
    }
    var head = doc.head || doc.documentElement.insertBefore(doc.createElement('head'), doc.body);
    var b = doc.createElement('base'); b.href = base; head.insertBefore(b, head.firstChild);
    var meta = doc.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; head.insertBefore(meta, b.nextSibling);
    if (!doc.querySelector('meta[name=viewport]')) { var vp = doc.createElement('meta'); vp.name = 'viewport'; vp.content = 'width=device-width, initial-scale=1'; head.appendChild(vp); }
    var sc = doc.createElement('script'); sc.textContent = '(' + FRAME_JS.toString() + ')();';
    head.insertBefore(sc, meta.nextSibling);
    return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
  }

  function metaRefresh(html, base) {
    var m = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?\s*(\d+)\s*;\s*url=([^"'>]+)/i);
    if (m && +m[1] <= 5) return abs(m[2].trim(), base);
    return null;
  }

  // Ссылки-переходники поисковиков → настоящий адрес
  function unwrap(url) {
    try {
      var u = new URL(url);
      if (/duckduckgo\.com$/.test(u.hostname) && u.pathname === '/l/' && u.searchParams.get('uddg')) return u.searchParams.get('uddg');
      if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/url') return u.searchParams.get('q') || u.searchParams.get('url') || url;
      if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/imgres' && u.searchParams.get('imgurl')) return u.searchParams.get('imgurl');
      if (/bing\.com$/.test(u.hostname) && u.pathname === '/ck/a') {
        var p = u.searchParams.get('u'); if (p && p.slice(0, 2) === 'a1') return atob(p.slice(2).replace(/-/g, '+').replace(/_/g, '/'));
      }
      if (/(^|\.)yandex\.[a-z]+$/.test(u.hostname) && u.searchParams.get('img_url')) return u.searchParams.get('img_url');
    } catch (e) {}
    return url;
  }

  // Имя файла из адреса
  function nameFrom(url, alt) {
    var n = '';
    if (!/^data:/i.test(url)) {
      try { var p = new URL(url).pathname.split('/').filter(Boolean); n = decodeURIComponent(p[p.length - 1] || ''); } catch (e) {}
      n = n.replace(/\.[a-z0-9]{2,5}$/i, '');
    }
    if (!n || /^(image|img|photo|file|download|index|\d{1,3})$/i.test(n) || n.length < 2) n = (alt || n || 'картинка');
    n = n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 70);
    return n || 'картинка';
  }

  Object.assign(G, { diagnose: diagnose, isJson: isJson, proxyError: proxyError, mdToHtml: mdToHtml, pname: pname, isReader: isReader, fetchPage: fetchPage, fetchImage: fetchImage, screenshot: screenshot, convert: convert, extract: extract, prepare: prepare, metaRefresh: metaRefresh, unwrap: unwrap, nameFrom: nameFrom, extOf: extOf, sniff: sniff, abs: abs, proxyUrl: proxyUrl, timedFetch: timedFetch });
  window.Grab = G;
})();
