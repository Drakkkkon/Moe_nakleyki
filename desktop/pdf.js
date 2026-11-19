/* Мое_граббер — только программа (с 1.9.0): «PDF из ZIP».
   Архивы комиксов (ZIP/CBZ) → PDF: страницы строго по номеру в имени файла (1, 2, 3 … 10, 11), одна картинка на страницу,
   имя файла и свойства PDF — из сведений архива (ComicInfo.xml / info.json / имя «Автор_Название»).
   JPEG вставляется без пересжатия; PNG, WEBP, GIF, AVIF, BMP переводятся в JPEG. */
(function () {
  'use strict';
  var I = window.MGI, N = window.MGNative;
  if (!I || !N || !N.readFile) return;
  var $ = function (s, r) { return (r || document).querySelector(s); }, esc = I.esc;
  var enc = new TextEncoder();
  function fmt(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ'; }
  function baseName(p) { return String(p).split(/[\\/]/).pop(); }
  function dirName(p) { var b = baseName(p); return String(p).slice(0, String(p).length - b.length - 1); }
  function sep(p) { return /\\/.test(p) ? '\\' : '/'; }

  // ---------- ZIP (чтение) ----------
  async function inflateRaw(u8) {
    var ds = new DecompressionStream('deflate-raw');
    var out = new Response(new Blob([u8]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }
  async function unzip(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('это не ZIP-архив');
    var n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true), list = [], dec = new TextDecoder('utf-8');
    for (var i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('архив повреждён');
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      list.push({ name: name, method: method, csize: csize, lho: lho });
      p += 46 + nl + el + cl;
    }
    return {
      names: list.map(function (f) { return f.name; }),
      read: async function (name) {
        var f = list.filter(function (x) { return x.name === name; })[0]; if (!f) return null;
        var nl2 = dv.getUint16(f.lho + 26, true), el2 = dv.getUint16(f.lho + 28, true), st = f.lho + 30 + nl2 + el2;
        var data = u8.subarray(st, st + f.csize);
        if (f.method === 0) return data; if (f.method === 8) return inflateRaw(data);
        throw new Error('неизвестное сжатие в архиве');
      }
    };
  }

  // ---------- сведения и страницы архива ----------
  var IMG = /\.(jpe?g|jfif|png|webp|gif|avif|bmp)$/i;
  function numKey(name) {
    var b = baseName(name).replace(/\.[a-z0-9]+$/i, ''), m = b.match(/\d+/);
    return m ? Number(m[0]) : Infinity;
  }
  function natural(a, b) { return a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' }); }
  function parseComicInfo(xml) {
    try {
      var d = new DOMParser().parseFromString(xml, 'text/xml'), g = function (t) { var e = d.getElementsByTagName(t)[0]; return e ? e.textContent.trim() : ''; };
      return { title: g('Series') || g('Title'), chapterTitle: g('Series') ? g('Title') : '', chapter: g('Number'), author: g('Writer'), artist: g('Penciller'),
        desc: g('Summary'), year: g('Year'), genres: g('Genre').split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean), tags: g('Tags').split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean), url: g('Web') };
    } catch (e) { return {}; }
  }
  async function readArchive(path) {
    var buf = new Uint8Array(await N.readFile(path)), z = await unzip(buf);
    var meta = {};
    var ci = z.names.filter(function (n) { return /(^|\/)comicinfo\.xml$/i.test(n); })[0];
    if (ci) meta = parseComicInfo(new TextDecoder().decode(await z.read(ci)));
    var ij = z.names.filter(function (n) { return /(^|\/)info\.json$/i.test(n); })[0];
    if (ij) { try { var j = JSON.parse(new TextDecoder().decode(await z.read(ij))); ['title', 'author', 'artist', 'desc', 'year', 'chapter', 'chapterTitle', 'url'].forEach(function (k) { if (!meta[k] && j[k]) meta[k] = j[k]; }); if ((!meta.genres || !meta.genres.length) && j.genres) meta.genres = j.genres; if ((!meta.tags || !meta.tags.length) && j.tags) meta.tags = j.tags; } catch (e) {} }
    var file = baseName(path).replace(/\.(zip|cbz)$/i, ''), m = /^([^_]{2,80})_(.+)$/.exec(file);
    if (!meta.title) meta.title = m ? m[2] : file;
    if (!meta.author && m) meta.author = m[1] === 'Неизвестный автор' ? '' : m[1];
    // страницы: без папки _info, без копий «Фото (JPG)» обычного граббинга; строго по номеру в имени
    var pages = z.names.filter(function (n) { return IMG.test(n) && !/(^|\/)_info\//i.test(n) && !/(^|\/)Фото \(/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n); });
    pages.sort(function (a, b) { var x = numKey(a), y = numKey(b); return x !== y ? x - y : natural(a, b); });
    var nums = pages.map(numKey).filter(isFinite), gaps = [];
    for (var i = 1; i < nums.length; i++) { if (nums[i] === nums[i - 1]) gaps.push('страница ' + nums[i] + ' повторяется'); else if (nums[i] !== nums[i - 1] + 1) gaps.push('нет ' + (nums[i - 1] + 1) + (nums[i] - nums[i - 1] > 2 ? '–' + (nums[i] - 1) : '')); }
    return { path: path, file: baseName(path), meta: meta, pages: pages, gaps: gaps, read: z.read, size: buf.length };
  }
  var PCFG = Object.assign({ fit: '' }, I.jget('mg_pdf', {}));
  function pdfName(meta, merged) {
    if (meta.plain) return (MG_META.safe(meta.title) || 'Фото') + '.pdf';
    var a = MG_META.safe((meta.author || '').split(/\s*[,;]\s*/).slice(0, 2).join(', ')), t = MG_META.safe(meta.title) || 'Комикс';
    var ch = merged ? (merged.length > 1 ? ' — Главы ' + merged[0] + '–' + merged[merged.length - 1] : '') : (meta.chapter ? ' — Глава ' + MG_META.safe(meta.chapter) : '');
    return (a || 'Неизвестный автор') + '_' + t + ch + '.pdf';
  }

  // ---------- картинка → JPEG для PDF ----------
  function jpegInfo(u8) {
    if (u8[0] !== 0xFF || u8[1] !== 0xD8) return null;
    var i = 2;
    while (i + 9 < u8.length) {
      if (u8[i] !== 0xFF) { i++; continue; }
      var m = u8[i + 1];
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      var len = (u8[i + 2] << 8) | u8[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: (u8[i + 5] << 8) | u8[i + 6], w: (u8[i + 7] << 8) | u8[i + 8], c: u8[i + 9] };
      i += 2 + len;
    }
    return null;
  }
  async function toJpeg(u8, quality) {
    var j = jpegInfo(u8);
    if (j && (j.c === 3 || j.c === 1) && j.w && j.h) return { data: u8, w: j.w, h: j.h, gray: j.c === 1 };
    var bmp = await createImageBitmap(new Blob([u8]));
    var cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, 0, 0);
    var blob = await new Promise(function (r) { cv.toBlob(r, 'image/jpeg', quality); });
    return { data: new Uint8Array(await blob.arrayBuffer()), w: bmp.width, h: bmp.height, gray: false };
  }

  // ---------- PDF (писатель) ----------
  function utf16(s) { s = String(s || ''); var h = 'FEFF'; for (var i = 0; i < s.length; i++) h += ('0000' + s.charCodeAt(i).toString(16)).slice(-4); return '<' + h.toUpperCase() + '>'; }
  function pdfDate(d) { function p(x) { return String(x).padStart(2, '0'); } return '(D:' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ')'; }
  // groups: [{ title, images: [{data,w,h,gray}] }], info: { title, author, subject, keywords }
  function buildPdf(groups, info) {
    var parts = [], offsets = [], pos = 0;
    function push(x) { var b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); pos += b.length; }
    var total = 0; groups.forEach(function (g) { total += g.images.length; });
    // номера объектов: 1 каталог, 2 страницы, 3 сведения, 4 оглавление; дальше по 3 на страницу; затем пункты оглавления
    var pageObj = [], k = 5;
    groups.forEach(function (g) { g.first = k; g.images.forEach(function () { pageObj.push(k); k += 3; }); });
    var outl = groups.length > 1 ? groups.map(function (g, i) { return k + i; }) : [];
    var count = k + outl.length - 1;
    function obj(n, body) { offsets[n] = pos; push(n + ' 0 obj\n'); if (typeof body === 'string') push(body); else body(); push('\nendobj\n'); }
    push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 0xE2, 0xE3, 0xCF, 0xD3, 10]));   // %PDF-1.4 и двоичная метка
    obj(1, '<< /Type /Catalog /Pages 2 0 R' + (outl.length ? ' /Outlines 4 0 R /PageMode /UseOutlines' : '') + ' >>');
    obj(2, '<< /Type /Pages /Count ' + total + ' /Kids [' + pageObj.map(function (n) { return n + ' 0 R'; }).join(' ') + '] >>');
    obj(3, '<< /Title ' + utf16(info.title) + ' /Author ' + utf16(info.author) + ' /Subject ' + utf16(info.subject) + ' /Keywords ' + utf16(info.keywords) +
      ' /Creator ' + utf16('Мое_граббер ' + (I.version || '')) + ' /Producer ' + utf16('Мое_граббер') + ' /CreationDate ' + pdfDate(new Date()) + ' >>');
    obj(4, outl.length ? '<< /Type /Outlines /First ' + outl[0] + ' 0 R /Last ' + outl[outl.length - 1] + ' 0 R /Count ' + outl.length + ' >>' : '<< /Type /Outlines /Count 0 >>');
    var n = 5;
    groups.forEach(function (g) {
      g.images.forEach(function (im) {
        var W = im.pw.toFixed(2), H = im.ph.toFixed(2), content = 'q ' + im.dw.toFixed(2) + ' 0 0 ' + im.dh.toFixed(2) + ' ' + im.dx.toFixed(2) + ' ' + im.dy.toFixed(2) + ' cm /Im0 Do Q';
        obj(n, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 ' + (n + 2) + ' 0 R >> >> /Contents ' + (n + 1) + ' 0 R >>');
        obj(n + 1, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
        obj(n + 2, function () {
          push('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace ' + (im.gray ? '/DeviceGray' : '/DeviceRGB') + ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.data.length + ' >>\nstream\n');
          push(im.data); push('\nendstream');
        });
        n += 3;
      });
    });
    outl.forEach(function (o, i) {
      obj(o, '<< /Title ' + utf16(groups[i].title) + ' /Parent 4 0 R' + (i ? ' /Prev ' + outl[i - 1] + ' 0 R' : '') + (i < outl.length - 1 ? ' /Next ' + outl[i + 1] + ' 0 R' : '') + ' /Dest [' + groups[i].first + ' 0 R /Fit] >>');
    });
    var xref = pos;
    push('xref\n0 ' + (count + 1) + '\n0000000000 65535 f \n');
    for (var i = 1; i <= count; i++) push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
    push('trailer\n<< /Size ' + (count + 1) + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    var out = new Uint8Array(pos), o = 0; parts.forEach(function (b) { out.set(b, o); o += b.length; });
    return out;
  }
  function infoOf(meta, groups) {
    var chs = groups.length > 1 ? ' — главы ' + groups.map(function (g) { return g.ch; }).filter(Boolean).join(', ') : (meta.chapter ? ' — Глава ' + meta.chapter + (meta.chapterTitle ? ': ' + meta.chapterTitle : '') : '');
    return { title: (meta.title || 'Комикс') + chs, author: [meta.author, meta.artist && meta.artist !== meta.author ? meta.artist : ''].filter(Boolean).join(', '),
      subject: (meta.desc || '').slice(0, 2000), keywords: [].concat(meta.genres || [], meta.tags || []).join(', ') };
  }

  // Размер страниц. fit: '' — как есть; 'width' — все страницы одной ширины; 'page' — все страницы одного размера (картинка по центру).
  // Сами картинки не пересжимаются: в PDF меняется только масштаб, в котором картинка положена на страницу.
  function layout(groups, fit) {
    var all = [], K = 0.75; groups.forEach(function (g) { g.images.forEach(function (im) { all.push(im); }); });
    if (!all.length) return;
    var W = Math.max.apply(null, all.map(function (im) { return im.w; })) * K;
    var hs = all.map(function (im) { return W * im.h / im.w; }).sort(function (a, b) { return a - b; }), H = hs[Math.floor(hs.length / 2)];
    all.forEach(function (im) {
      if (fit === 'width') { im.pw = W; im.ph = W * im.h / im.w; im.dx = 0; im.dy = 0; im.dw = im.pw; im.dh = im.ph; }
      else if (fit === 'page') { var sc = Math.min(W / im.w, H / im.h); im.dw = im.w * sc; im.dh = im.h * sc; im.pw = W; im.ph = H; im.dx = (W - im.dw) / 2; im.dy = (H - im.dh) / 2; }
      else { im.pw = im.w * K; im.ph = im.h * K; im.dx = 0; im.dy = 0; im.dw = im.pw; im.dh = im.ph; }
    });
    var mx = Math.max.apply(null, all.map(function (im) { return Math.max(im.pw, im.ph); })), f = mx > 14400 ? 14400 / mx : 1;   // предел размера страницы PDF
    if (f < 1) all.forEach(function (im) { ['pw', 'ph', 'dx', 'dy', 'dw', 'dh'].forEach(function (k) { im[k] *= f; }); });
  }

  // Собрать один PDF из списка «глав» (каждая: { meta, pages: [имена], read })
  async function makePdf(chapters, quality, onProg, fit) {
    var groups = [], done = 0, all = 0;
    chapters.forEach(function (c) { all += c.pages.length; });
    for (var i = 0; i < chapters.length; i++) {
      var c = chapters[i], imgs = [];
      for (var k = 0; k < c.pages.length; k++) {
        var data = await c.read(c.pages[k]);
        try { imgs.push(await toJpeg(data instanceof Uint8Array ? data : new Uint8Array(data), quality)); } catch (e) { throw new Error('не читается картинка ' + baseName(c.pages[k]) + (c.photos ? '' : ' в ' + c.file)); }
        done++; if (onProg) onProg(done, all);
      }
      groups.push({ title: c.meta.chapter ? 'Глава ' + c.meta.chapter + (c.meta.chapterTitle ? ': ' + c.meta.chapterTitle : '') : (c.photos ? c.meta.title : c.file), ch: c.meta.chapter, images: imgs });
    }
    layout(groups, fit || '');
    return buildPdf(groups, infoOf(chapters[0].meta, groups));
  }

  // ---------- окно «PDF из ZIP» ----------
  var sh = document.createElement('div'); sh.className = 'sheet full'; sh.id = 'pdfSheet'; sh.hidden = true;
  sh.innerHTML = '<div class="sh-head"><button class="ib" data-close aria-label="Закрыть">✕</button><div class="sh-title"><b>📄 PDF из ZIP и фото</b><small>Одна картинка на страницу, страницы по номеру 1, 2, 3…</small></div></div>' +
    '<div class="pad scroll">' +
      '<div class="row"><button class="btn pri" id="pdfPick">Выбрать ZIP-архивы…</button><button class="btn pri" id="pdfPhotos">Выбрать фото (JPEG, PNG…)…</button><button class="btn ghost" id="pdfClear">Очистить список</button></div>' +
      '<div class="list" id="pdfList"></div>' +
      '<div class="card"><label class="pg-r"><input type="radio" name="pdfMode" value="each" checked> Отдельный PDF из каждого архива</label>' +
      '<label class="pg-r"><input type="radio" name="pdfMode" value="one"> Один PDF из всех архивов (по порядку списка, в оглавлении — главы)</label>' +
      '<label class="pg-r"><input type="radio" name="pdfWhere" value="near" checked> Сохранить рядом с архивом</label>' +
      '<label class="pg-r"><input type="radio" name="pdfWhere" value="ask"> Спросить, куда сохранить</label>' +
      '<label class="fld"><span>Размер страниц</span><select id="pdfFit"><option value="">Как есть — у каждой страницы размер своей картинки</option><option value="width">Выровнять по ширине — все страницы одной ширины</option><option value="page">Одинаковые страницы — один размер, картинка по центру</option></select></label>' +
      '<p class="hint">Выравнивание не пересжимает картинки: разрешение остаётся прежним, меняется только масштаб на странице.</p>' +
      '<label class="fld"><span>Качество для PNG/WEBP/GIF: <b id="pdfQv">92</b>% (JPEG вставляется без пересжатия)</span><input type="range" id="pdfQ" min="60" max="100" value="92"></label></div>' +
      '<button class="btn pri big" id="pdfGo" disabled>Собрать PDF</button>' +
      '<div class="pbar" id="pdfBarW" hidden><i id="pdfBar"></i></div><p class="hint" id="pdfState"></p><div class="list" id="pdfOut"></div>' +
    '</div>';
  document.body.appendChild(sh);
  var items = [];
  function drawList() {
    $('#pdfList').innerHTML = items.length ? items.map(function (a, i) {
      var m = a.meta;
      if (a.photos) return '<div class="li pdf-it"><div class="go"><b>🖼 Фото: ' + a.pages.length + ' шт.</b><small>' + esc(dirName(a.path)) + ' · по порядку: ' + esc(baseName(a.pages[0])) + ' … ' + esc(baseName(a.pages[a.pages.length - 1])) + '</small><input class="pdf-nm" data-nm="' + i + '" value="' + esc(m.title) + '" placeholder="Название PDF"></div>' +
        '<button class="ib x" data-up="' + i + '" title="Выше"' + (i ? '' : ' disabled') + '>↑</button><button class="ib x" data-dn="' + i + '" title="Ниже"' + (i < items.length - 1 ? '' : ' disabled') + '>↓</button><button class="ib x" data-rm="' + i + '" title="Убрать">✕</button></div>';
      return '<div class="li pdf-it"><div class="go"><b>' + esc((m.author ? m.author + ' — ' : '') + (m.title || a.file)) + (m.chapter ? ' · глава ' + esc(m.chapter) : '') + '</b><small>' + esc(a.file) + ' · ' + a.pages.length + ' стр. · ' + fmt(a.size) + (a.gaps.length ? ' · ⚠ ' + esc(a.gaps.slice(0, 3).join(', ')) : '') + '</small></div>' +
        '<button class="ib x" data-up="' + i + '" title="Выше"' + (i ? '' : ' disabled') + '>↑</button><button class="ib x" data-dn="' + i + '" title="Ниже"' + (i < items.length - 1 ? '' : ' disabled') + '>↓</button><button class="ib x" data-rm="' + i + '" title="Убрать">✕</button></div>';
    }).join('') : '<p class="hint">Выберите архивы ZIP/CBZ (например скачанные «Авто-листанием») или отдельные фото — JPEG, PNG, WEBP, GIF, AVIF, BMP.</p>';
    $('#pdfGo').disabled = !items.length;
    $('#pdfGo').textContent = items.length > 1 && mode() === 'one' ? 'Собрать один PDF из всего списка (' + items.length + ')' : items.length > 1 ? 'Собрать ' + items.length + ' PDF' : 'Собрать PDF';
  }
  function mode() { var r = sh.querySelector('[name=pdfMode]:checked'); return r ? r.value : 'each'; }
  function where() { var r = sh.querySelector('[name=pdfWhere]:checked'); return r ? r.value : 'near'; }
  sh.addEventListener('change', function (e) { if (e.target.name === 'pdfMode') drawList(); });
  $('#pdfQ').oninput = function () { $('#pdfQv').textContent = this.value; };
  $('#pdfFit').value = PCFG.fit || '';
  $('#pdfFit').onchange = function () { PCFG.fit = this.value; try { localStorage.setItem('mg_pdf', JSON.stringify(PCFG)); } catch (e) {} };
  function fit() { return $('#pdfFit').value; }
  // отдельные фото → PDF: порядок по номеру в имени файла, затем по имени
  function addPhotos(paths) {
    if (!paths || !paths.length) return;
    var list = paths.slice().sort(function (a, b) { var x = numKey(a), y = numKey(b); return x !== y ? x - y : natural(baseName(a), baseName(b)); });
    var folder = baseName(dirName(list[0])) || 'Фото';
    items.push({ photos: true, path: list[0], file: 'Фото', meta: { title: list.length === 1 ? baseName(list[0]).replace(/\.[a-z0-9]+$/i, '') : folder, plain: true }, pages: list, gaps: [], size: 0, read: function (p) { return N.readFile(p); } });
    drawList();
  }
  $('#pdfPhotos').onclick = async function () { addPhotos(await N.pickFiles({ title: 'Фото для PDF', filters: [{ name: 'Фото', extensions: ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'bmp'] }] })); };
  $('#pdfList').addEventListener('input', function (e) { var n = e.target.closest('[data-nm]'); if (n && items[+n.dataset.nm]) items[+n.dataset.nm].meta.title = n.value; });
  async function addPaths(paths) {
    for (var i = 0; i < paths.length; i++) {
      if (items.some(function (x) { return x.path === paths[i]; })) continue;
      $('#pdfState').textContent = 'Читаю ' + baseName(paths[i]) + '…';
      try { var a = await readArchive(paths[i]); if (!a.pages.length) throw new Error('в архиве нет картинок'); items.push(a); }
      catch (e) { I.toast(baseName(paths[i]) + ': ' + (e.message || e), true); }
    }
    // главы одного комикса — по номеру главы
    items.sort(function (a, b) { var x = parseFloat(a.meta.chapter), y = parseFloat(b.meta.chapter); return (a.meta.title || '').localeCompare(b.meta.title || '') || (isNaN(x) || isNaN(y) ? natural(a.file, b.file) : x - y); });
    $('#pdfState').textContent = ''; drawList();
  }
  $('#pdfPick').onclick = async function () { var p = await N.pickFiles({ title: 'Архивы для PDF' }); if (p.length) addPaths(p); };
  $('#pdfClear').onclick = function () { items = []; $('#pdfOut').innerHTML = ''; drawList(); };
  $('#pdfList').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var i = +(b.dataset.up || b.dataset.dn || b.dataset.rm);
    if (b.dataset.rm != null) items.splice(i, 1);
    else if (b.dataset.up != null && i > 0) items.splice(i - 1, 0, items.splice(i, 1)[0]);
    else if (b.dataset.dn != null && i < items.length - 1) items.splice(i + 1, 0, items.splice(i, 1)[0]);
    drawList();
  });
  function outLine(p, size, pages) {
    var d = document.createElement('div'); d.className = 'li';
    d.innerHTML = '<div class="go"><b>✓ ' + esc(baseName(p)) + '</b><small>' + pages + ' стр. · ' + fmt(size) + ' · ' + esc(dirName(p)) + '</small></div><button class="btn ghost">Открыть</button><button class="btn ghost">В папке</button>';
    var bs = d.querySelectorAll('button'); bs[0].onclick = function () { N.openPath(p); }; bs[1].onclick = function () { N.showFile(p); };
    $('#pdfOut').appendChild(d);
  }
  async function savePdf(bytes, name, dir) {
    if (where() === 'ask') return N.savePdfAs(name, bytes, dir);
    return N.writeFile(dir, name, bytes);
  }
  $('#pdfGo').onclick = async function () {
    if (!items.length) return;
    var q = +$('#pdfQ').value / 100, btn = this; btn.disabled = true; $('#pdfBarW').hidden = false; $('#pdfOut').innerHTML = ''; $('#pdfState').textContent = 'Начинаю…';
    function prog(d, t, label) { $('#pdfBar').style.width = Math.round(d / t * 100) + '%'; $('#pdfState').textContent = label + ' — страница ' + d + ' из ' + t; }
    try {
      if (mode() === 'one' && items.length > 1) {
        var pdf = await makePdf(items, q, function (d, t) { prog(d, t, 'Собираю один PDF'); }, fit());
        var chs = items.map(function (a) { return a.meta.chapter; }).filter(Boolean);
        var p = await savePdf(pdf, pdfName(items[0].meta, chs.length ? chs : [1, items.length]), dirName(items[0].path));
        if (p) outLine(p, pdf.length, items.reduce(function (s, a) { return s + a.pages.length; }, 0));
      } else {
        for (var i = 0; i < items.length; i++) {
          var a = items[i];
          var pdf1 = await makePdf([a], q, function (d, t) { prog(d, t, (items.length > 1 ? (i + 1) + ' из ' + items.length + ': ' : '') + (a.photos ? a.meta.title : a.file)); }, fit());
          var p1 = await savePdf(pdf1, pdfName(a.meta), dirName(a.path));
          if (p1) outLine(p1, pdf1.length, a.pages.length);
        }
      }
      $('#pdfState').textContent = 'Готово.';
    } catch (e) { $('#pdfState').textContent = 'Не получилось: ' + (e.message || e); }
    btn.disabled = false; $('#pdfBarW').hidden = true;
  };
  function openPdf(paths) { I.openSheet('pdfSheet'); drawList(); if (paths && paths.length) addPaths(paths); }

  // ---------- готовые страницы (после авто-листания или из архива в памяти) → PDF ----------
  // pages: [{ name, bytes }]; сохраняет в dir (или спрашивает), возвращает путь
  async function pagesToPdf(pages, meta, dir, ask) {
    var list = pages.slice().sort(function (a, b) { var x = numKey(a.name), y = numKey(b.name); return x !== y ? x - y : natural(a.name, b.name); });
    var map = {}; list.forEach(function (p) { map[p.name] = p.bytes; });
    var pdf = await makePdf([{ meta: meta || {}, file: '', pages: list.map(function (p) { return p.name; }), read: async function (n) { return map[n]; } }], 0.92, null, PCFG.fit);
    var name = pdfName(meta || {});
    var p = ask ? await N.savePdfAs(name, pdf, dir) : await N.writeFile(dir, name, pdf);
    return p ? { path: p, size: pdf.length, pages: list.length } : null;
  }
  async function zipBlobToPdf(blob, fallbackName) {
    var z = await unzip(new Uint8Array(await blob.arrayBuffer())), meta = {};
    var ci = z.names.filter(function (n) { return /(^|\/)comicinfo\.xml$/i.test(n); })[0];
    if (ci) meta = parseComicInfo(new TextDecoder().decode(await z.read(ci)));
    if (!meta.title) { var m = /^([^_]{2,80})_(.+)$/.exec(String(fallbackName || '').replace(/\.(zip|cbz)$/i, '')); meta.title = m ? m[2] : String(fallbackName || 'Фото').replace(/\.(zip|cbz)$/i, ''); if (m && !meta.author && m[1] !== 'Мое_граббер') meta.author = m[1]; }
    var pages = z.names.filter(function (n) { return IMG.test(n) && !/(^|\/)_info\//i.test(n) && !/(^|\/)Фото \(/i.test(n); });
    var out = []; for (var i = 0; i < pages.length; i++) out.push({ name: pages[i], bytes: await z.read(pages[i]) });
    if (!out.length) throw new Error('в архиве нет картинок');
    return pagesToPdf(out, meta, await N.downloadsDir(), false);
  }

  // ---------- кнопки: меню ⋮, окно сохранения после граббинга ----------
  var grid = $('#menu .menuGrid');
  if (grid) {
    grid.insertAdjacentHTML('beforeend', '<button class="mi" data-act4="pdf"><span>📄</span>PDF из ZIP</button>');
    grid.addEventListener('click', function (e) { if (e.target.closest('[data-act4]')) { I.closeSheet('menu'); openPdf(); } });
  }
  var svCol = $('#save .col');
  if (svCol) {
    var b = document.createElement('button'); b.className = 'btn big'; b.id = 'svPdf'; b.textContent = '📄 Сделать PDF из этих фото';
    svCol.appendChild(b);
    b.onclick = async function () {
      var z = I.lastZip; if (!z) return;
      b.disabled = true; b.textContent = 'Собираю PDF…';
      try { var r = await zipBlobToPdf(z.blob, I.zipName ? I.zipName() : ''); if (r) { I.toast('PDF сохранён: ' + r.path, true); N.showFile(r.path); } }
      catch (e) { I.toast('PDF не получился: ' + (e.message || e), true); }
      b.disabled = false; b.textContent = '📄 Сделать PDF из этих фото';
    };
  }
  window.MG_pdf = { addPhotos: addPhotos, open: openPdf, readArchive: readArchive, makePdf: makePdf, pagesToPdf: pagesToPdf, zipBlobToPdf: zipBlobToPdf, buildPdf: buildPdf, numKey: numKey };
})();
