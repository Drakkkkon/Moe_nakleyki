/* Мое_граббер — только программа (с 1.10.0): скриншот всей страницы.
   Перед снимком страница прокручивается до самого конца (подгружаются «ленивые» картинки и догружаемые блоки),
   программа ждёт, пока страница и все картинки загрузятся, возвращает страницу в начало и снимает её целиком.
   Очень длинные страницы снимаются кусками и склеиваются; если не помещаются в одну картинку — несколькими частями. */
(function () {
  'use strict';
  var I = window.MGI, N = window.MGNative;
  if (!I || !N || !window.Grab) return;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // выполняется внутри страницы
  var PREP = function () {
    return (async function () {
      function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
      var t0 = Date.now(), LIMIT = 90000, MAXH = 120000;
      while (document.readyState !== 'complete' && Date.now() - t0 < 15000) await sleep(200);
      // что прокручивать: саму страницу или самый высокий прокручиваемый блок (у сайтов-приложений)
      var el = document.scrollingElement || document.documentElement;
      if (el.scrollHeight <= innerHeight + 4) {
        var best = null, bh = 0;
        document.querySelectorAll('body *').forEach(function (e) { if (e.scrollHeight > e.clientHeight + 50 && e.clientHeight > innerHeight * 0.5 && e.scrollHeight > bh) { var o = getComputedStyle(e).overflowY; if (o === 'auto' || o === 'scroll') { bh = e.scrollHeight; best = e; } } });
        if (best) el = best;
      }
      var view = el === (document.scrollingElement || document.documentElement) ? innerHeight : el.clientHeight;
      var step = Math.max(300, Math.round(view * 0.85)), y = 0, stable = 0, grew = 0;
      while (Date.now() - t0 < LIMIT) {
        var h = el.scrollHeight;
        y = Math.min(y + step, Math.max(0, h - view));
        el.scrollTop = y;
        await sleep(220);
        if (y >= el.scrollHeight - view - 2) {           // дошли до конца — ждём, не вырастет ли страница
          await sleep(900);
          if (el.scrollHeight > h + 2) { stable = 0; grew++; if (el.scrollHeight > MAXH) break; }
          else if (++stable >= 2) break;
        }
      }
      // всё ли загрузилось
      document.querySelectorAll('img[loading="lazy"]').forEach(function (i) { i.loading = 'eager'; });
      function pending() { var n = 0; for (var i = 0; i < document.images.length; i++) { var im = document.images[i]; if ((im.currentSrc || im.getAttribute('src')) && !im.complete) n++; } return n; }
      var t1 = Date.now();
      while (pending() && Date.now() - t1 < 25000) await sleep(300);
      if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, sleep(3000)]);
      var left = pending(), broken = 0;
      for (var k = 0; k < document.images.length; k++) { var im2 = document.images[k]; if (im2.complete && (im2.currentSrc || im2.getAttribute('src')) && !im2.naturalWidth) broken++; }
      el.scrollTop = 0; window.scrollTo(0, 0);
      await sleep(600);
      return { height: el.scrollHeight, images: document.images.length, pending: left, broken: broken, grew: grew, timedOut: Date.now() - t0 >= LIMIT, sec: Math.round((Date.now() - t0) / 1000) };
    })();
  };

  // склейка: кусок кладётся на своё место на странице (последний кусок перекрывает предыдущий — без повторов)
  async function stitch(r) {
    if (r.parts) return [{ bytes: new Uint8Array(r.parts[0]), w: 0, h: 0 }];
    var t = r.tiles, k = t[0].k, bm = [];
    for (var i = 0; i < t.length; i++) bm.push(await createImageBitmap(new Blob([t[i].png], { type: 'image/png' })));
    var W = bm[0].width, total = Math.round((t[t.length - 1].top + r.vh) * k), MAXH = 32000, files = [];
    for (var y0 = 0; y0 < total; y0 += MAXH) {
      var h = Math.min(MAXH, total - y0), cv = document.createElement('canvas'); cv.width = W; cv.height = h;
      var cx = cv.getContext('2d');
      for (var j = 0; j < t.length; j++) { var top = Math.round(t[j].top * k) - y0; if (top + bm[j].height > 0 && top < h) cx.drawImage(bm[j], 0, top); }
      var blob = await new Promise(function (res) { cv.toBlob(res, 'image/png'); });
      files.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: W, h: h });
    }
    return files;
  }

  var base = Grab.screenshot;
  async function fullShot() {
    var t = I.T(), w = t && t.wv && t.wvReady ? t.wv : null; if (!w) return null;
    try { if (w.isLoading()) { I.toast('Жду, пока страница загрузится…'); await new Promise(function (res) { var f = function () { w.removeEventListener('did-stop-loading', f); res(); }; w.addEventListener('did-stop-loading', f); setTimeout(f, 20000); }); } } catch (e) {}
    I.toast('Прокручиваю страницу до конца и жду загрузки…', true);
    var st = null; try { st = await w.executeJavaScript('(' + PREP.toString() + ')()'); } catch (e) {}
    var r = await N.pageShot(w.getWebContentsId());
    if (!r) return null;
    var files = await stitch(r);
    var note = 'скриншот всей страницы, ' + files.reduce(function (s, f) { return s + f.h; }, 0) + ' пикс. в высоту';
    if (st) {
      note += st.pending || st.broken ? '; не загрузилось картинок: ' + (st.pending + st.broken) + ' из ' + st.images : '; все картинки загружены (' + st.images + ')';
      if (st.timedOut) note += '; страница не кончалась — снято то, что успело загрузиться за ' + st.sec + ' с';
    }
    if (r.cut) note += '; страница длиннее ' + r.height + ' пикс. — снята эта часть';
    if (files.length > 1) note += '; частей: ' + files.length;
    var out = { bytes: files[0].bytes, ext: 'png', mime: 'image/png', via: note, info: st };
    out.more = files.slice(1).map(function (f) { return { bytes: f.bytes, ext: 'png', mime: 'image/png' }; });
    return out;
  }
  Grab.screenshot = async function (url, fullPage) {
    if (fullPage && I.curUrl() === url) { try { var r = await fullShot(); if (r) return r; } catch (e) { console.warn(e); } }
    return base(url, fullPage);
  };
  window.MG_shot = { full: fullShot };
})();
