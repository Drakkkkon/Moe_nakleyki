/* Мое_граббер — режим программы для Windows. На сайте ничего не делает (нет window.MGNative).
   В программе: страницы и фото берутся напрямую, без прокси; скриншоты делает сама программа. */
(function () {
  'use strict';
  var N = window.MGNative;
  if (!N || !window.Grab) return;
  document.documentElement.classList.add('native');

  function decode(body, ct) {
    var cs = (/charset=([\w-]+)/i.exec(ct || '') || [])[1];
    if (!cs) {
      var head = '';
      for (var i = 0; i < Math.min(body.length, 4096); i++) head += String.fromCharCode(body[i]);
      cs = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1] || 'utf-8';
    }
    try { return new TextDecoder(cs.toLowerCase()).decode(body); } catch (e) { return new TextDecoder('utf-8').decode(body); }
  }

  Grab.fetchPage = async function (url) {
    var r = await N.fetch(url, '');
    if (!r || !r.status) throw new Error('Страница не открылась: ' + ((r && r.error) || 'нет связи'));
    if (/^image\//i.test(r.ct)) return { image: true, url: r.url || url, via: 'напрямую' };
    return { html: decode(r.body, r.ct), url: r.url || url, via: 'напрямую' };
  };

  async function toImage(r) {
    if (!r || !r.ok || !r.body || r.body.length < 24) return null;
    var t = Grab.sniff(r.body);
    if (!t && /svg/i.test(r.ct)) t = { ext: 'svg', mime: 'image/svg+xml' };
    return t ? { bytes: r.body, ext: t.ext, mime: t.mime } : null;
  }

  Grab.fetchImage = async function (url) {
    if (/^data:/i.test(url)) {
      try { var rd = await fetch(url); var b = new Uint8Array(await rd.arrayBuffer()); var t = Grab.sniff(b); return t ? { bytes: b, ext: t.ext, mime: t.mime, via: 'со страницы' } : null; } catch (e) { return null; }
    }
    var ref = (window.MG_pageUrl && window.MG_pageUrl()) || '';
    var im = await toImage(await N.fetch(url, ref));
    if (im) { im.via = 'напрямую'; return im; }
    return null;
  };

  Grab.screenshot = async function (url, fullPage) {
    // страница, открытая во вкладке, — снимаем её саму (со всей прокруткой)
    if (fullPage && window.MG_pageWcId && window.MG_pageUrl && window.MG_pageUrl() === url) {
      var id = window.MG_pageWcId();
      if (id) { var p = await N.pageShot(id); if (p && p.length) return { bytes: new Uint8Array(p), ext: 'png', mime: 'image/png', via: 'скриншот программы' }; }
    }
    var png = await N.shot(url, !!fullPage);
    if (png && png.length) return { bytes: new Uint8Array(png), ext: 'png', mime: 'image/png', via: 'скриншот программы' };
    return null;
  };

  // Сбор картинок с живой страницы вкладки (как делает скрипт в режиме сайта)
  Grab.COLLECT_JS = '(' + function () {
    function abs(u) { try { return new URL(u, document.baseURI).href; } catch (e) { return null; } }
    var out = [], seen = {};
    function add(u, kind, alt, w, h) { if (!u || seen[u]) return; seen[u] = 1; out.push({ url: u, kind: kind, alt: alt || '', nw: w || 0, nh: h || 0 }); }
    document.querySelectorAll('img').forEach(function (i) {
      add(i.currentSrc || i.src, 'img', i.alt, i.naturalWidth, i.naturalHeight);
      ['data-src', 'data-original', 'data-lazy-src', 'data-full', 'data-zoom-src'].forEach(function (a) { var v = i.getAttribute(a); if (v) add(abs(v), 'img', i.alt); });
    });
    var els = document.querySelectorAll('body *'), n = Math.min(els.length, 6000);
    for (var k = 0; k < n; k++) {
      var bg = getComputedStyle(els[k]).backgroundImage;
      if (bg && bg !== 'none') { var re = /url\(["']?(.*?)["']?\)/g, m; while ((m = re.exec(bg))) add(abs(m[1]), 'bg'); }
    }
    document.querySelectorAll('canvas').forEach(function (c) { try { if (c.width > 64 && c.height > 64) add(c.toDataURL('image/png'), 'canvas', 'Рисунок с холста'); } catch (e) {} });
    return { items: out, html: document.documentElement.outerHTML, url: location.href, title: document.title };
  }.toString() + ')()';
})();
