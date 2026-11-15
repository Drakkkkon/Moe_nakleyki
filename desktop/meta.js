/* Мое_граббер — только программа (с 1.7.0): сведения о комиксе со страницы сайта.
   Одна и та же функция работает и внутри открытой страницы (живой DOM), и на скачанной странице комикса (DOMParser). */
(function () {
  'use strict';
  // doc — документ, url — его адрес. Возвращает все найденные сведения
  function extractMeta(doc, url) {
    var M = { url: url, title: '', altTitle: '', author: '', artist: '', desc: '', genres: [], tags: [], status: '', year: '', translator: '', publisher: '', type: '', age: '', country: '', language: '', chapters: '', cover: '', siteName: '', seriesUrl: '', chapter: '', chapterTitle: '', rating: '', extra: {} };
    function abs(u) { try { return new URL(u, url).href; } catch (e) { return ''; } }
    function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
    function meta(sel) { var e = doc.querySelector(sel); return e ? clean(e.getAttribute('content')) : ''; }
    function uniq(a) { var s = {}, out = []; a.forEach(function (x) { x = clean(x).replace(/^#/, ''); var k = x.toLowerCase(); if (x && x.length < 60 && !s[k]) { s[k] = 1; out.push(x); } }); return out; }
    function names(v) { if (!v) return ''; if (typeof v === 'string') return v; if (Array.isArray(v)) return v.map(names).filter(Boolean).join(', '); return v.name || v.alternateName || ''; }
    function set(k, v) { v = clean(Array.isArray(v) ? v.join(', ') : v); if (v && !M[k]) M[k] = v; }

    // 1) JSON-LD (schema.org)
    var lds = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
      try { var j = JSON.parse(s.textContent); (function walk(o) { if (!o) return; if (Array.isArray(o)) { o.forEach(walk); return; } if (typeof o !== 'object') return; if (o['@graph']) walk(o['@graph']); if (o['@type']) lds.push(o); })(j); } catch (e) {}
    });
    var WORK = /comic|book|creativework|manga|series|novel|movie|tvseries/i;
    lds.filter(function (o) { return WORK.test([].concat(o['@type']).join(' ')); }).forEach(function (o) {
      set('title', o.name || o.headline); set('altTitle', names(o.alternateName) || o.alternativeHeadline);
      set('author', names(o.author) || names(o.creator)); set('artist', names(o.illustrator) || names(o.artist) || names(o.penciler));
      set('publisher', names(o.publisher)); set('desc', o.description || o.abstract);
      if (o.genre) M.genres = M.genres.concat([].concat(o.genre));
      if (o.keywords) M.tags = M.tags.concat(typeof o.keywords === 'string' ? o.keywords.split(/[,;]/) : [].concat(o.keywords));
      set('cover', typeof o.image === 'string' ? o.image : (o.image && (o.image.url || (Array.isArray(o.image) ? (o.image[0].url || o.image[0]) : ''))) || o.thumbnailUrl);
      set('year', String(o.datePublished || o.dateCreated || '').slice(0, 4)); set('language', o.inLanguage);
      set('translator', names(o.translator)); set('age', o.contentRating || o.typicalAgeRange);
      if (o.aggregateRating && o.aggregateRating.ratingValue) set('rating', o.aggregateRating.ratingValue + (o.aggregateRating.bestRating ? ' / ' + o.aggregateRating.bestRating : ''));
      if (o.isPartOf) set('seriesTitle', names(o.isPartOf) || o.isPartOf.name);
      if (o.issueNumber) set('chapter', o.issueNumber);
    });
    lds.filter(function (o) { return /breadcrumblist/i.test([].concat(o['@type']).join(' ')); }).forEach(function (o) {
      M.extra.crumbs = (o.itemListElement || []).map(function (x) { var it = x.item || {}; return { text: clean(x.name || it.name), href: abs(typeof it === 'string' ? it : it['@id'] || it.url || '') }; });
    });

    // 2) OpenGraph и обычные meta
    set('siteName', meta('meta[property="og:site_name"]'));
    var ogTitle = meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]');
    set('cover', meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'));
    set('author', meta('meta[property="book:author"]') || meta('meta[name="author"]') || meta('meta[property="article:author"]'));
    var ogDesc = meta('meta[property="og:description"]') || meta('meta[name="description"]');
    var kw = meta('meta[name="keywords"]');

    // 3) Подписи «Автор: …», «Жанры: …» на странице
    var LABELS = [
      ['altTitle', /^(альтернативн\S* назв\S*|другие назв\S*|назв\S* на \S+|оригинальн\S* назв\S*|alternative( titles?| names?)?|alt(ernate)? names?|also known as|associated names?|original title)$/i],
      ['author', /^(автор\S*|сценарист\S*|история|author\S*|writer\S*|story( by)?|mangaka|автор оригинала)$/i],
      ['artist', /^(художник\S*|иллюстратор\S*|рисовал\S*|artist\S*|art( by)?|illustrator\S*|penciller)$/i],
      ['genres', /^(жанр\S*|genre\S*)$/i],
      ['tags', /^(теги|тэги|метки|tags?|категори\S*|categor\S*|themes?|темы)$/i],
      ['status', /^(статус\S*( тайтла| перевода| выпуска)?|выпуск|status|publication status)$/i],
      ['year', /^(год( выпуска| выхода| релиза)?|дата (выхода|выпуска|релиза)|year|released?|release date|published)$/i],
      ['translator', /^(перевод\S*|переводчик\S*|команда|translat\S*|scanlat\S*|group\S*)$/i],
      ['publisher', /^(издател\S*|издательство|журнал|publisher\S*|serializ\S*|magazine)$/i],
      ['type', /^(тип|формат|type|format)$/i],
      ['age', /^(возраст\S*( рейтинг| ограничение)?|возрастное ограничение|age( rating)?|content rating|мин\. возраст)$/i],
      ['country', /^(страна|country|origin)$/i],
      ['language', /^(язык|language)$/i],
      ['chapters', /^(глав\S*|количество глав|chapters?|кол-во глав)$/i]
    ];
    function labelKey(t) { t = clean(t).replace(/[:：]\s*$/, '').toLowerCase(); if (!t || t.length > 40) return null; for (var i = 0; i < LABELS.length; i++) if (LABELS[i][1].test(t)) return LABELS[i][0]; return null; }
    function put(key, val, el) {
      val = clean(val).replace(/^[:：\-–—\s]+/, '');
      if (!val || val.length > 400) return;
      if (key === 'genres' || key === 'tags') {
        var links = el ? el.querySelectorAll('a') : [];
        var list = links.length ? [].map.call(links, function (a) { return a.textContent; }) : val.split(/[,;|•·\/]|\s{2,}/);
        M[key] = M[key].concat(list); return;
      }
      if (!M[key]) M[key] = val.length > 160 ? val.slice(0, 160) : val;
    }
    // dt/dd, th/td и «метка + значение» рядом
    doc.querySelectorAll('dt, th, b, strong, span, div, li, p, td, label, h4, h5, h6').forEach(function (e) {
      if (e.children.length > 3) return;
      var own = clean(e.childNodes.length && e.childNodes[0].nodeType === 3 ? e.childNodes[0].textContent : e.textContent);
      var full = clean(e.textContent);
      var m = full.match(/^([^:：]{2,40})[:：]\s*(.+)$/);
      var key = labelKey(own) || labelKey(full);
      if (key && full.length <= 40) {
        var nx = e.nextElementSibling || (e.parentElement && e.parentElement.children.length <= 3 && e.parentElement.lastElementChild !== e ? e.parentElement.lastElementChild : null);
        if (nx) put(key, nx.textContent, nx);
      } else if (m && (key = labelKey(m[1])) && e.children.length <= 12) {
        // текст значения — без самой подписи
        var holder = e.cloneNode(true), lab = holder.firstElementChild;
        if (lab && labelKey(lab.textContent)) lab.remove();
        put(key, m[2], holder.querySelectorAll('a').length ? holder : null);
      }
    });
    // 4) жанры и теги по ссылкам
    var gl = [].map.call(doc.querySelectorAll('a[href*="/genre"], a[href*="genres="], a[href*="/genres/"], a[href*="/zhanr"], a[href*="/jenre"]'), function (a) { return a.textContent; });
    var tl = [].map.call(doc.querySelectorAll('a[href*="/tag/"], a[href*="/tags/"], a[href*="tags="], a[rel="tag"]'), function (a) { return a.textContent; });
    if (!M.genres.length && gl.length <= 40) M.genres = gl;
    if (!M.tags.length && tl.length <= 60) M.tags = tl;
    if (!M.tags.length && kw) M.tags = kw.split(/[,;]/).slice(0, 25);
    M.genres = uniq(M.genres); M.tags = uniq(M.tags).filter(function (t) { return M.genres.map(function (g) { return g.toLowerCase(); }).indexOf(t.toLowerCase()) < 0; });

    // 5) описание: самый длинный блок «описание/annotation/synopsis»
    var best = '';
    doc.querySelectorAll('[class*="desc" i], [id*="desc" i], [class*="synops" i], [class*="summary" i], [class*="annot" i], [class*="about" i], [itemprop="description"], [class*="story" i], [class*="opisan" i]').forEach(function (e) {
      if (e.querySelector('img, iframe') && e.textContent.length < 200) return;
      var t = (e.innerText || e.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (t.length > best.length && t.length < 6000 && t.length > 40) best = t;
    });
    if (best && best.length > (M.desc || '').length) M.desc = best;
    if (!M.desc && ogDesc && ogDesc.length > 40) M.desc = ogDesc;

    // 6) название: h1 / og:title / <title> без названия сайта и «глава N»
    var h1 = doc.querySelector('h1'), raw = clean((h1 && h1.textContent) || ogTitle || doc.title);
    var CH = /(\s*[-–—|:,]?\s*)(глава|глав\.|chapter|ch\.?|эпизод|episode|ep\.?|выпуск|issue|#)\s*([\d.]+)(.*)$/i;
    var chm = raw.match(CH) || clean(doc.title).match(CH) || decodeURIComponent(url).match(/(глава|chapter|ch|chap|c|episode|ep)[-_ ]?(\d+(?:[.-]\d+)?)/i);
    if (chm) { M.chapter = M.chapter || (chm[3] || chm[2] || '').replace('-', '.'); if (chm[4]) M.chapterTitle = clean(chm[4]).replace(/^[-–—:.\s]+/, '').replace(/\s*[-–—|]\s*.*$/, ''); }
    var tt = raw.replace(CH, '').replace(/\s*[-–—|:]\s*(том|vol\.?|volume)\s*\d+.*$/i, '');
    if (M.siteName) tt = tt.replace(new RegExp('\\s*[-–—|:·]\\s*' + M.siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$', 'i'), '');
    tt = tt.split(/\s+[|–—]\s+/)[0].replace(/^(читать|read)\s+(онлайн\s+)?(мангу|манхву|маньхуа|комикс|manga|manhwa|comic)?\s*/i, '').replace(/\s+(читать|онлайн|read online|manga online).*$/i, '');
    set('title', M.seriesTitle || clean(tt));
    if (!M.title) M.title = clean(ogTitle || doc.title);

    // 7) страница самого комикса: из «хлебных крошек» или адрес уровнем выше
    var crumbs = M.extra.crumbs || [].map.call(doc.querySelectorAll('[class*="breadcrumb" i] a[href], nav[aria-label*="breadcrumb" i] a[href], [itemtype*="BreadcrumbList"] a[href]'), function (a) { return { text: clean(a.textContent), href: abs(a.getAttribute('href')) }; });
    var here = new URL(url), path = here.pathname.replace(/\/+$/, '');
    var cand = crumbs.filter(function (c) { try { var u = new URL(c.href); return u.host === here.host && u.pathname.replace(/\/+$/, '').length > 1 && path.indexOf(u.pathname.replace(/\/+$/, '')) === 0 && u.pathname.replace(/\/+$/, '') !== path; } catch (e) { return false; } });
    if (cand.length) M.seriesUrl = cand[cand.length - 1].href;
    if (!M.seriesUrl) {
      var best2 = '';
      doc.querySelectorAll('a[href]').forEach(function (a) {
        try { var u = new URL(a.getAttribute('href'), url); var p = u.pathname.replace(/\/+$/, '');
          if (u.host === here.host && p.split('/').length >= 3 && path.indexOf(p + '/') === 0 && p.length > best2.length && !/\/(chapter|глава|ch|page|стр)[-_]?\d/i.test(p)) best2 = p; } catch (e) {}
      });
      if (best2) M.seriesUrl = here.origin + best2;
    }
    if (M.cover) M.cover = abs(M.cover);
    M.genres = M.genres.slice(0, 30); M.tags = M.tags.slice(0, 40);
    delete M.seriesTitle;
    return M;
  }

  // Слить сведения: со страницы комикса (series) важнее, глава — со страницы главы
  function mergeMeta(chapterM, seriesM) {
    if (!seriesM) return chapterM;
    var out = Object.assign({}, chapterM);
    Object.keys(seriesM).forEach(function (k) {
      var v = seriesM[k];
      if (k === 'chapter' || k === 'chapterTitle' || k === 'url' || k === 'extra') return;
      if (Array.isArray(v)) { if (v.length) out[k] = v; }
      else if (v && (k === 'desc' ? v.length > (out.desc || '').length : true)) out[k] = v;
    });
    if (seriesM.title) out.title = seriesM.title;
    out.seriesUrl = chapterM.seriesUrl || seriesM.url;
    return out;
  }

  function xe(s) { return String(s).replace(/[<>&'"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]; }); }
  var AGE = function (a) { a = String(a || ''); return /18|adult|взросл/i.test(a) ? 'Adults Only 18+' : /17|16|mature/i.test(a) ? 'Mature 17+' : /12|13|14|teen|подрост/i.test(a) ? 'Teen' : /10|6/i.test(a) ? 'Everyone 10+' : /0\+|all|every|для всех/i.test(a) ? 'Everyone' : ''; };
  var LANG = function (l) { l = String(l || '').toLowerCase(); return /^(ru|рус)/.test(l) ? 'ru' : /^(en|англ)/.test(l) ? 'en' : /^(ja|jp|япон)/.test(l) ? 'ja' : /^(ko|kr|корей)/.test(l) ? 'ko' : /^(zh|cn|китай)/.test(l) ? 'zh' : /^(uk|укр)/.test(l) ? 'uk' : /^(kk|каз)/.test(l) ? 'kk' : l.length === 2 ? l : ''; };
  // ComicInfo.xml — стандарт архивов комиксов (его читают My_topsecret, Komga, Kavita, CDisplayEx…)
  function comicInfo(M, pages, version) {
    var el = function (n, v) { v = v == null ? '' : String(v).trim(); return v ? '  <' + n + '>' + xe(v) + '</' + n + '>\n' : ''; };
    var year = (String(M.year).match(/\d{4}/) || [''])[0];
    var notes = ['Мое_граббер ' + version].concat(['status', 'country', 'type', 'altTitle', 'chapters', 'rating', 'siteName', 'url'].filter(function (k) { return M[k]; }).map(function (k) { return k + '=' + String(M[k]).replace(/[|\r\n]+/g, ' '); })).join('|');
    return '<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n' +
      el('Title', M.chapterTitle || (M.chapter ? 'Глава ' + M.chapter : '')) + el('Series', M.title) + el('Number', M.chapter) + el('Count', (String(M.chapters).match(/\d+/) || [''])[0]) +
      el('Summary', M.desc) + el('Notes', notes) + el('Year', year) +
      el('Writer', M.author) + el('Penciller', M.artist) + el('Translator', M.translator) + el('Publisher', M.publisher) +
      el('Genre', M.genres.join(', ')) + el('Tags', M.tags.join(', ')) + el('Web', M.seriesUrl || M.url) + el('PageCount', pages) +
      el('LanguageISO', LANG(M.language)) + el('Format', M.type) + el('AgeRating', AGE(M.age)) + el('Manga', /манга|manga/i.test(M.type) ? 'YesAndRightToLeft' : '') +
      '</ComicInfo>\n';
  }
  function infoText(M, pages) {
    var rows = [['Название', M.title], ['Другие названия', M.altTitle], ['Автор', M.author], ['Художник', M.artist], ['Глава', [M.chapter, M.chapterTitle].filter(Boolean).join(' — ')], ['Страниц в архиве', pages],
      ['Жанры', M.genres.join(', ')], ['Теги', M.tags.join(', ')], ['Статус', M.status], ['Год', M.year], ['Тип', M.type], ['Страна', M.country], ['Язык', M.language], ['Возраст', M.age],
      ['Переводчик', M.translator], ['Издатель', M.publisher], ['Глав всего', M.chapters], ['Рейтинг', M.rating], ['Сайт', M.siteName], ['Страница комикса', M.seriesUrl], ['Страница главы', M.url], ['Обложка', M.cover]];
    return rows.filter(function (r) { return r[1]; }).map(function (r) { return r[0] + ': ' + r[1]; }).join('\n') + (M.desc ? '\n\nОписание:\n' + M.desc : '') + '\n';
  }
  function safe(s) { return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80); }
  function archiveName(M) {
    var a = safe((M.author || '').split(/\s*[,;]\s*/).slice(0, 2).join(', ')), t = safe(M.title) || 'Комикс';
    return (a || 'Неизвестный автор') + '_' + t;
  }
  window.MG_META = { extract: extractMeta, merge: mergeMeta, comicInfo: comicInfo, infoText: infoText, archiveName: archiveName, safe: safe, SRC: extractMeta.toString() };
})();
