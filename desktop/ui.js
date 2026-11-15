/* Мое_граббер — только программа для Windows (с 1.5.0):
   панель вкладок как в Chrome (закреплённые — справа), избранное с папками и панелью избранного,
   окно истории, синхронизация избранного, истории и открытых вкладок через общий аккаунт. */
(function () {
  'use strict';
  var I = window.MGI, N = window.MGNative;
  if (!I || !N) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = I.esc, host = I.host, jget = I.jget;
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function changed() { if (window.MMAccount) window.MMAccount.changed(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function favOf(url) { try { var u = new URL(url); return u.origin + '/favicon.ico'; } catch (e) { return ''; } }
  function letter(t, url) { var s = (t || host(url) || '?').replace(/^www\./, ''); return esc(s.charAt(0).toUpperCase()); }
  function iconHtml(fav, title, url, cls) {
    return '<span class="' + (cls || 'ti') + '"><b>' + letter(title, url) + '</b>' + (fav ? '<img src="' + esc(fav) + '" alt="" onerror="this.remove()">' : '') + '</span>';
  }
  document.documentElement.classList.add('chrome-ui');

  // ======================= устройство =======================
  var DEV = jget('mg_device', null);
  if (!DEV || !DEV.id) { DEV = { id: uid(), name: N.hostname || 'Компьютер' }; jset('mg_device', DEV); }

  // ======================= панель вкладок =======================
  var strip = el('div', 'tabstrip');
  strip.innerHTML = '<div class="ts-normal" id="tsNormal"></div><button class="ts-new" id="tsNew" title="Новая вкладка (Ctrl+T)" aria-label="Новая вкладка">+</button><div class="ts-fill"></div><div class="ts-pinned" id="tsPinned"></div>';
  document.body.insertBefore(strip, document.body.firstChild);
  var bmbar = el('div', 'bmbar'); bmbar.id = 'bmbar';
  document.body.insertBefore(bmbar, $('.load'));

  var closed = [];   // для Ctrl+Shift+T
  var dragIdx = -1;
  function tabTitle(t) { var u = I.curUrlOf(t); return t.title || (u ? host(u) : 'Новая вкладка'); }
  function drawTabs() {
    var tabs = I.tabs, cur = I.cur, nh = '', ph = '';
    tabs.forEach(function (t, i) {
      var u = I.curUrlOf(t), title = tabTitle(t);
      var fav = u ? (t.fav || favOf(u)) : '';
      var ic = t.loading ? '<span class="ti spin"></span>' : (u ? iconHtml(fav, title, u) : '<span class="ti home">⌂</span>');
      var cls = 'tab' + (i === cur ? ' on' : '') + (t.pinned ? ' pin' : '');
      var h = '<div class="' + cls + '" draggable="true" data-i="' + i + '" title="' + esc(title + (u ? '\n' + u : '')) + '">' + ic +
        (t.pinned ? '' : '<span class="tt">' + esc(title) + '</span><button class="tx" data-x="' + i + '" aria-label="Закрыть вкладку">✕</button>') + '</div>';
      if (t.pinned) ph += h; else nh += h;
    });
    $('#tsNormal').innerHTML = nh; $('#tsPinned').innerHTML = ph;
  }
  function closeTab(i) {
    var t = I.tabs[i]; if (!t) return;
    var u = I.curUrlOf(t); if (u) { closed.push({ url: u, pinned: t.pinned }); if (closed.length > 20) closed.shift(); }
    I.closeTab(i); tabsChanged();
  }
  window.MGI_closeCur = function () { closeTab(I.cur); };
  strip.addEventListener('click', function (e) {
    var x = e.target.closest('[data-x]'); if (x) { e.stopPropagation(); closeTab(+x.dataset.x); return; }
    var tb = e.target.closest('.tab'); if (tb) { I.setCur(+tb.dataset.i); return; }
    if (e.target.closest('#tsNew')) I.newTab();
  });
  strip.addEventListener('auxclick', function (e) { var tb = e.target.closest('.tab'); if (tb && e.button === 1) { e.preventDefault(); closeTab(+tb.dataset.i); } });
  strip.addEventListener('dblclick', function (e) { if (!e.target.closest('.tab') && !e.target.closest('button')) I.newTab(); });
  strip.addEventListener('dragstart', function (e) { var tb = e.target.closest('.tab'); if (!tb) return; dragIdx = +tb.dataset.i; e.dataTransfer.effectAllowed = 'move'; tb.classList.add('drag'); });
  strip.addEventListener('dragend', function () { dragIdx = -1; drawTabs(); });
  strip.addEventListener('dragover', function (e) { if (dragIdx >= 0) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
  strip.addEventListener('drop', function (e) {
    e.preventDefault(); if (dragIdx < 0) return;
    var tb = e.target.closest('.tab'), tabs = I.tabs, from = dragIdx, src = tabs[from];
    var to;
    if (tb) {
      to = +tb.dataset.i; var r = tb.getBoundingClientRect();
      var after = e.clientX > r.left + r.width / 2;
      if (!!tabs[to].pinned !== !!src.pinned) { src.pinned = !!tabs[to].pinned; }
      if (after) to++;
      if (from < to) to--;
    } else { to = tabs.length - 1; }
    dragIdx = -1;
    if (to !== from) I.move(from, to); else { I.saveTabs(); drawTabs(); }
    tabsChanged();
  });

  // ---- меню вкладки (правый клик) ----
  var popMenu = el('div', 'cmenu'); popMenu.hidden = true; document.body.appendChild(popMenu);
  function showMenu(x, y, items) {
    popMenu.innerHTML = items.map(function (it, k) { return it === '-' ? '<hr>' : '<button data-k="' + k + '"' + (it.disabled ? ' disabled' : '') + '>' + esc(it.label) + '</button>'; }).join('');
    popMenu.hidden = false;
    var w = popMenu.offsetWidth, h = popMenu.offsetHeight;
    popMenu.style.left = Math.min(x, innerWidth - w - 6) + 'px'; popMenu.style.top = Math.min(y, innerHeight - h - 6) + 'px';
    popMenu.onclick = function (e) { var b = e.target.closest('[data-k]'); if (!b) return; hideMenu(); items[+b.dataset.k].run(); };
  }
  function hideMenu() { popMenu.hidden = true; }
  document.addEventListener('mousedown', function (e) { if (!popMenu.hidden && !popMenu.contains(e.target)) hideMenu(); if (!bmDrop.hidden && !bmDrop.contains(e.target) && !e.target.closest('.bmi')) bmDrop.hidden = true; }, true);
  window.addEventListener('blur', function () { hideMenu(); bmDrop.hidden = true; });
  strip.addEventListener('contextmenu', function (e) {
    var tb = e.target.closest('.tab'); if (!tb) return; e.preventDefault();
    var i = +tb.dataset.i, t = I.tabs[i], u = I.curUrlOf(t);
    showMenu(e.clientX, e.clientY, [
      { label: 'Новая вкладка справа', run: function () { I.newTab(null, i + 1); tabsChanged(); } },
      { label: 'Обновить', disabled: !u, run: function () { I.setCur(i); I.render(true); } },
      { label: 'Дублировать', disabled: !u, run: function () { var nt = I.newTab(u, i + 1); nt.pinned = t.pinned; tabsChanged(); } },
      { label: t.pinned ? 'Открепить' : 'Закрепить (справа)', run: function () { pinTab(i, !t.pinned); } },
      { label: 'Добавить в избранное…', disabled: !u, run: function () { I.setCur(i); openStar(); } },
      '-',
      { label: 'Закрыть', run: function () { closeTab(i); } },
      { label: 'Закрыть другие вкладки', run: function () { var keep = I.tabs[i]; for (var k = I.tabs.length - 1; k >= 0; k--) if (I.tabs[k] !== keep && !I.tabs[k].pinned) closeTab(k); } },
      { label: 'Закрыть вкладки слева', run: function () { var keep = I.tabs[i]; for (var k = I.tabs.indexOf(keep) - 1; k >= 0; k--) if (!I.tabs[k].pinned) closeTab(k); } }
    ]);
  });
  function pinTab(i, on) {
    var t = I.tabs[i]; t.pinned = on;
    // закреплённые — в конце списка (справа), обычные — перед ними
    var tabs = I.tabs, from = tabs.indexOf(t), to;
    if (on) to = tabs.length - 1; else { to = 0; tabs.forEach(function (x, k) { if (!x.pinned && x !== t) to = k + 1; }); if (from < to) to--; }
    if (to !== from) I.move(from, to); else { I.saveTabs(); drawTabs(); }
    tabsChanged();
  }

  // ---- значки, загрузка ----
  function bindWv(wv) {
    if (wv._mg) return; wv._mg = true;
    function tabOf() { var ts = I.tabs; for (var k = 0; k < ts.length; k++) if (ts[k].wv === wv) return ts[k]; return null; }
    wv.addEventListener('page-favicon-updated', function (e) { var t = tabOf(); if (t && e.favicons && e.favicons[0]) { t.fav = e.favicons[0]; I.saveTabs(); drawTabs(); tabsChanged(); } });
    wv.addEventListener('did-start-loading', function () { var t = tabOf(); if (t) { t.loading = true; drawTabs(); } });
    wv.addEventListener('did-stop-loading', function () {
      var t = tabOf(); if (!t) return; t.loading = false; drawTabs();
      // в историю — и страницы без заголовка
      var u = I.curUrlOf(t); if (!/^https?:/i.test(u)) return;
      var h = jget('mg_history', []); if (h[0] && h[0].url === u) return;
      h = h.filter(function (x) { return x.url !== u; }); h.unshift({ url: u, title: t.title || host(u), t: Date.now() });
      jset('mg_history', h.slice(0, 1000)); changed();
    });
    wv.addEventListener('did-navigate', function () { var t = tabOf(); if (t) t.fav = ''; });
  }
  new MutationObserver(function () { document.querySelectorAll('#frameBox webview').forEach(bindWv); }).observe($('#frameBox'), { childList: true });

  // ---- клавиши ----
  N.on('key', function (k) {
    var tabs = I.tabs;
    if (k === 'nexttab') I.setCur((I.cur + 1) % tabs.length);
    else if (k === 'prevtab') I.setCur((I.cur - 1 + tabs.length) % tabs.length);
    else if (/^tab\d$/.test(k)) { var n = +k.slice(3); I.setCur(n === 9 ? tabs.length - 1 : Math.min(n - 1, tabs.length - 1)); }
    else if (k === 'reopen') { var c = closed.pop(); if (c) { var t = I.newTab(c.url); if (c.pinned) pinTab(I.tabs.indexOf(t), true); } }
    else if (k === 'history') openHistory();
    else if (k === 'bookmark') openStar();
    else if (k === 'bookmarks') openBm();
    else if (k === 'bmbar') { S.bar = !S.bar; jset('mg_ui', S); applyBar(); }
  });
  N.on('bm-link', function (d) { addBm(d.url, d.title || host(d.url), lastFolder()); I.toast('Ссылка добавлена в избранное: ' + folderName(lastFolder())); });

  // ======================= избранное =======================
  // mg_bm2 = { items: { id: { id, type: 'folder'|'link', title, url, parent, o, t, del } } }; корень — 'bar' (панель избранного)
  var S = jget('mg_ui', { bar: true });
  function BM() { var b = jget('mg_bm2', null); if (!b || !b.items) b = { items: {} }; return b; }
  function saveBM(b) { jset('mg_bm2', b); changed(); drawBar(); drawStar(); if (!$('#bmMgr').hidden) drawMgr(); }
  // перенос старых закладок (без папок)
  (function () {
    var b = jget('mg_bm2', null); if (b) return;
    b = { items: {} };
    (jget('mg_bookmarks', []) || []).forEach(function (x, k) { var id = uid() + k; b.items[id] = { id: id, type: 'link', title: x.title || host(x.url), url: x.url, parent: 'bar', o: k, t: Date.now() }; });
    jset('mg_bm2', b);
  })();
  function live(b) { return Object.keys(b.items).map(function (k) { return b.items[k]; }).filter(function (x) { return !x.del; }); }
  function kids(b, parent) { return live(b).filter(function (x) { return x.parent === parent; }).sort(function (a, c) { return (a.type === 'folder' ? 0 : 1) - (c.type === 'folder' ? 0 : 1) || (a.o || 0) - (c.o || 0); }); }
  function folders(b) {
    var out = [{ id: 'bar', title: 'Панель избранного', depth: 0 }];
    (function walk(p, d) { kids(b, p).forEach(function (f) { if (f.type === 'folder') { out.push({ id: f.id, title: f.title, depth: d }); walk(f.id, d + 1); } }); })('bar', 1);
    return out;
  }
  function folderName(id) { if (id === 'bar') return 'Панель избранного'; var f = BM().items[id]; return f && !f.del ? f.title : 'Панель избранного'; }
  function lastFolder() { var id = S.lastFolder || 'bar'; var f = BM().items[id]; return id === 'bar' || (f && !f.del) ? id : 'bar'; }
  function nextO(b, parent) { var m = 0; kids(b, parent).forEach(function (x) { m = Math.max(m, x.o || 0); }); return m + 1; }
  function addBm(url, title, parent) { var b = BM(), id = uid(); b.items[id] = { id: id, type: 'link', title: title, url: url, parent: parent || 'bar', o: nextO(b, parent || 'bar'), t: Date.now() }; saveBM(b); return id; }
  function addFolder(title, parent) { var b = BM(), id = uid(); b.items[id] = { id: id, type: 'folder', title: title, parent: parent || 'bar', o: nextO(b, parent || 'bar'), t: Date.now() }; saveBM(b); return id; }
  function upd(id, patch) { var b = BM(), x = b.items[id]; if (!x) return; Object.assign(x, patch, { t: Date.now() }); saveBM(b); }
  function del(id) {
    var b = BM(), now = Date.now();
    (function rm(i) { var x = b.items[i]; if (!x) return; x.del = 1; x.t = now; if (x.type === 'folder') live(b).filter(function (c) { return c.parent === i; }).forEach(function (c) { rm(c.id); }); })(id);
    saveBM(b);
  }
  function findByUrl(url) { if (!url) return null; var l = live(BM()); for (var k = 0; k < l.length; k++) if (l[k].type === 'link' && l[k].url === url) return l[k]; return null; }

  // ---- панель избранного ----
  var bmDrop = el('div', 'bmdrop'); bmDrop.hidden = true; document.body.appendChild(bmDrop);
  function itemHtml(x, cls) {
    if (x.type === 'folder') return '<button class="' + cls + ' fold" data-id="' + esc(x.id) + '" title="' + esc(x.title) + '"><span class="ti fi">📁</span><span class="bt">' + esc(x.title) + '</span></button>';
    return '<button class="' + cls + '" data-id="' + esc(x.id) + '" title="' + esc(x.title + '\n' + x.url) + '">' + iconHtml(favOf(x.url), x.title, x.url) + '<span class="bt">' + esc(x.title) + '</span></button>';
  }
  function drawBar() {
    var b = BM(), list = kids(b, 'bar');
    bmbar.innerHTML = (list.length ? list.map(function (x) { return itemHtml(x, 'bmi'); }).join('') : '<span class="bm-empty">Нажмите ☆ в адресной строке, чтобы добавить сайт в избранное</span>') +
      '<span class="ts-fill"></span><button class="bmi all" id="bmAll" title="Всё избранное (Ctrl+Shift+O)"><span class="ti fi">☰</span><span class="bt">Всё избранное</span></button>';
  }
  function openDrop(anchor, folderId) {
    var b = BM(), list = kids(b, folderId), r = anchor.getBoundingClientRect();
    bmDrop.innerHTML = (list.length ? list.map(function (x) { return itemHtml(x, 'bdi'); }).join('') : '<div class="bm-empty">Пусто</div>') +
      '<hr><button class="bdi openall" data-open="' + esc(folderId) + '"' + (list.some(function (x) { return x.type === 'link'; }) ? '' : ' disabled') + '><span class="ti fi">⧉</span><span class="bt">Открыть все во вкладках</span></button>';
    bmDrop.hidden = false;
    var lft = Math.min(r.left, innerWidth - bmDrop.offsetWidth - 8);
    bmDrop.style.left = Math.max(4, lft) + 'px'; bmDrop.style.top = (r.bottom + 2) + 'px';
  }
  function openLink(x, newTab) { if (newTab) I.newTab(x.url, I.cur + 1); else I.navigate(x.url); tabsChanged(); }
  function bmClick(e, inDrop) {
    var oa = e.target.closest('[data-open]');
    if (oa) { kids(BM(), oa.dataset.open).filter(function (x) { return x.type === 'link'; }).forEach(function (x, k) { I.newTab(x.url, I.cur + 1); }); bmDrop.hidden = true; tabsChanged(); return; }
    if (e.target.closest('#bmAll')) { openBm(); return; }
    var bt = e.target.closest('[data-id]'); if (!bt) return;
    var x = BM().items[bt.dataset.id]; if (!x) return;
    if (x.type === 'folder') { openDrop(bt, x.id); return; }
    bmDrop.hidden = true; openLink(x, e.ctrlKey || e.button === 1);
  }
  bmbar.addEventListener('click', function (e) { bmClick(e, false); });
  bmDrop.addEventListener('click', function (e) { bmClick(e, true); });
  [bmbar, bmDrop].forEach(function (box) {
    box.addEventListener('auxclick', function (e) { if (e.button !== 1) return; var bt = e.target.closest('[data-id]'); if (!bt) return; var x = BM().items[bt.dataset.id]; if (x && x.type === 'link') { e.preventDefault(); openLink(x, true); } });
    box.addEventListener('contextmenu', function (e) {
      var bt = e.target.closest('[data-id]'); if (!bt) return; e.preventDefault();
      var x = BM().items[bt.dataset.id]; if (!x) return;
      var items = x.type === 'link' ? [
        { label: 'Открыть', run: function () { openLink(x, false); } },
        { label: 'Открыть в новой вкладке', run: function () { openLink(x, true); } },
        '-',
        { label: 'Изменить…', run: function () { editItem(x.id); } },
        { label: 'Удалить', run: function () { del(x.id); } }
      ] : [
        { label: 'Открыть все во вкладках', run: function () { kids(BM(), x.id).filter(function (c) { return c.type === 'link'; }).forEach(function (c) { I.newTab(c.url, I.cur + 1); }); tabsChanged(); } },
        { label: 'Переименовать…', run: function () { editItem(x.id); } },
        { label: 'Удалить папку', run: function () { del(x.id); } }
      ];
      showMenu(e.clientX, e.clientY, items);
    });
  });
  function applyBar() { document.documentElement.classList.toggle('no-bmbar', !S.bar); }

  // ---- звёздочка в адресной строке ----
  var star = $('#bStar');
  var starPop = el('div', 'starpop'); starPop.hidden = true; document.body.appendChild(starPop);
  star.addEventListener('click', function (e) { e.stopImmediatePropagation(); e.preventDefault(); openStar(); }, true);
  function drawStar() { var on = !!findByUrl(I.curUrl()); star.textContent = on ? '★' : '☆'; star.classList.toggle('on', on); star.title = on ? 'Изменить закладку (Ctrl+D)' : 'Добавить в избранное (Ctrl+D)'; }
  function folderOptions(sel) { return folders(BM()).map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === sel ? ' selected' : '') + '>' + '  '.repeat(f.depth) + esc(f.title) + '</option>'; }).join('') + '<option value="__new">Новая папка…</option>'; }
  function openStar() {
    var url = I.curUrl(); if (!url) { I.toast('Сначала откройте сайт'); return; }
    var x = findByUrl(url), isNew = !x;
    if (!x) { var id = addBm(url, I.T().title || host(url), lastFolder()); x = BM().items[id]; }
    starPop.innerHTML = '<b>' + (isNew ? 'Добавлено в избранное' : 'Изменить закладку') + '</b>' +
      '<label>Название<input id="spTitle" value="' + esc(x.title) + '"></label>' +
      '<label>Папка<select id="spFolder">' + folderOptions(x.parent) + '</select></label>' +
      '<div class="row"><button class="btn" id="spDel">Удалить</button><button class="btn" id="spMore">Все папки…</button><button class="btn pri" id="spOk">Готово</button></div>';
    var r = star.getBoundingClientRect();
    starPop.hidden = false; starPop.style.top = (r.bottom + 6) + 'px'; starPop.style.left = Math.max(8, Math.min(r.right - starPop.offsetWidth, innerWidth - starPop.offsetWidth - 8)) + 'px';
    var bid = x.id;
    $('#spTitle').focus(); $('#spTitle').select();
    function done() { var f = $('#spFolder').value; if (f === '__new') f = 'bar'; upd(bid, { title: $('#spTitle').value.trim() || host(url), parent: f }); S.lastFolder = f; jset('mg_ui', S); starPop.hidden = true; }
    $('#spOk').onclick = done;
    $('#spDel').onclick = function () { del(bid); starPop.hidden = true; I.toast('Удалено из избранного'); };
    $('#spMore').onclick = function () { done(); openBm(); };
    $('#spTitle').onkeydown = function (e) { if (e.key === 'Enter') done(); if (e.key === 'Escape') starPop.hidden = true; };
  }
  document.addEventListener('mousedown', function (e) { if (!starPop.hidden && !starPop.contains(e.target) && e.target !== star && !askBox.contains(e.target)) { var ok = $('#spOk'); if (ok) ok.click(); } }, true);

  // ---- маленькое окно ввода (prompt в программе не работает) ----
  var askBox = el('div', 'askbox'); askBox.hidden = true; document.body.appendChild(askBox);
  function ask(q, val) {
    return new Promise(function (res) {
      askBox.innerHTML = '<div class="askin"><b>' + esc(q) + '</b><input id="askIn" value="' + esc(val || '') + '"><div class="row"><button class="btn" id="askNo">Отмена</button><button class="btn pri" id="askOk">ОК</button></div></div>';
      askBox.hidden = false; var inp = $('#askIn'); inp.focus(); inp.select();
      function fin(v) { askBox.hidden = true; res(v); }
      $('#askOk').onclick = function () { fin(inp.value); }; $('#askNo').onclick = function () { fin(null); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') fin(inp.value); if (e.key === 'Escape') fin(null); };
    });
  }
  // «Новая папка…» в окне звёздочки
  (function patchFolderSelect() {
    document.addEventListener('change', function (e) {
      if (e.target.id !== 'spFolder' || e.target.value !== '__new') return;
      e.stopImmediatePropagation();
      var sel = e.target, prev = (findByUrl(I.curUrl()) || {}).parent || 'bar';
      ask('Название новой папки', '').then(function (name) {
        name = (name || '').trim();
        if (name) { var fid = addFolder(name, 'bar'); sel.innerHTML = folderOptions(fid); sel.value = fid; } else { sel.innerHTML = folderOptions(prev); }
      });
    }, true);
  })();

  // ---- окно «Всё избранное» ----
  var mgr = el('div', 'sheet full'); mgr.id = 'bmMgr'; mgr.hidden = true;
  mgr.innerHTML = '<div class="sh-head"><button class="ib" data-close aria-label="Закрыть">✕</button><div class="sh-title"><b>Избранное</b><small id="bmPath"></small></div><button class="ib" id="bmNewF" title="Новая папка">📁+</button></div><div class="pad scroll"><div class="bm-tree" id="bmTree"></div><div class="list" id="bmList2"></div></div>';
  document.body.appendChild(mgr);
  var mgrFolder = 'bar';
  function openBm(folder) { mgrFolder = folder || mgrFolder || 'bar'; drawMgr(); I.openSheet('bmMgr'); }
  function drawMgr() {
    var b = BM(); if (mgrFolder !== 'bar' && (!b.items[mgrFolder] || b.items[mgrFolder].del)) mgrFolder = 'bar';
    $('#bmTree').innerHTML = folders(b).map(function (f) { return '<button class="fnode' + (f.id === mgrFolder ? ' on' : '') + '" data-f="' + esc(f.id) + '" style="padding-left:' + (10 + f.depth * 16) + 'px">📁 ' + esc(f.title) + '</button>'; }).join('');
    $('#bmPath').textContent = folderName(mgrFolder) + ' · ' + kids(b, mgrFolder).length + ' шт.';
    var list = kids(b, mgrFolder);
    $('#bmList2').innerHTML = list.length ? list.map(function (x) {
      var ic = x.type === 'folder' ? '<span class="ti fi">📁</span>' : iconHtml(favOf(x.url), x.title, x.url);
      return '<div class="li"><button class="go" data-go="' + esc(x.id) + '">' + '<span class="lrow">' + ic + '<span><b>' + esc(x.title) + '</b><small>' + esc(x.type === 'folder' ? 'Папка' : x.url.replace(/^https?:\/\//, '')) + '</small></span></span></button>' +
        '<select class="mv" data-mv="' + esc(x.id) + '" title="Переместить в папку">' + folders(b).filter(function (f) { return f.id !== x.id; }).map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === x.parent ? ' selected' : '') + '>' + '  '.repeat(f.depth) + esc(f.title) + '</option>'; }).join('') + '</select>' +
        '<button class="ib x" data-ed="' + esc(x.id) + '" title="Переименовать">✎</button><button class="ib x" data-del="' + esc(x.id) + '" title="Удалить">🗑</button></div>';
    }).join('') : '<p class="hint">В этой папке пусто. Добавляйте сайты звёздочкой ☆ в адресной строке.</p>';
  }
  function editItem(id) {
    var x = BM().items[id]; if (!x) return;
    ask(x.type === 'folder' ? 'Название папки' : 'Название закладки', x.title).then(function (v) {
      if (v == null) return; v = v.trim(); if (!v) return;
      if (x.type === 'link') { upd(id, { title: v }); return; }
      upd(id, { title: v });
    });
  }
  mgr.addEventListener('click', function (e) {
    var f = e.target.closest('[data-f]'); if (f) { mgrFolder = f.dataset.f; drawMgr(); return; }
    var g = e.target.closest('[data-go]'); if (g) { var x = BM().items[g.dataset.go]; if (!x) return; if (x.type === 'folder') { mgrFolder = x.id; drawMgr(); } else { I.closeSheet('bmMgr'); openLink(x, false); } return; }
    var ed = e.target.closest('[data-ed]'); if (ed) { editItem(ed.dataset.ed); return; }
    var d = e.target.closest('[data-del]'); if (d) { del(d.dataset.del); return; }
    if (e.target.closest('#bmNewF')) ask('Название новой папки', '').then(function (n) { n = (n || '').trim(); if (n) addFolder(n, mgrFolder); });
  });
  mgr.addEventListener('change', function (e) {
    var m = e.target.closest('[data-mv]'); if (!m) return;
    var id = m.dataset.mv, to = m.value, b = BM();
    // нельзя переместить папку внутрь самой себя
    var p = to; while (p && p !== 'bar') { if (p === id) { I.toast('Нельзя переместить папку внутрь неё самой'); drawMgr(); return; } p = (b.items[p] || {}).parent; }
    upd(id, { parent: to, o: nextO(b, to) });
  });

  // ======================= история =======================
  var hs = el('div', 'sheet full'); hs.id = 'histSheet'; hs.hidden = true;
  hs.innerHTML = '<div class="sh-head"><button class="ib" data-close aria-label="Закрыть">✕</button><div class="sh-title"><b>История</b><small id="hsSub"></small></div><button class="btn ghost" id="hsClear">Очистить</button></div><div class="pad"><input class="hsq" id="hsQ" type="search" placeholder="Поиск по истории"></div><div class="pad scroll" id="hsList"></div>';
  document.body.appendChild(hs);
  function openHistory() { $('#hsQ').value = ''; drawHist(); I.openSheet('histSheet'); setTimeout(function () { $('#hsQ').focus(); }, 50); }
  function drawHist() {
    var q = $('#hsQ').value.trim().toLowerCase(), h = jget('mg_history', []);
    if (q) h = h.filter(function (x) { return (x.title + ' ' + x.url).toLowerCase().indexOf(q) >= 0; });
    $('#hsSub').textContent = h.length + ' записей';
    var day = '', out = '';
    h.slice(0, 500).forEach(function (x) {
      var d = new Date(x.t || 0), dk = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      if (dk !== day) { day = dk; out += '<h3 class="cap">' + esc(dk) + '</h3>'; }
      out += '<div class="li"><button class="go" data-hu="' + esc(x.url) + '"><span class="lrow"><small class="tm">' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + '</small>' + iconHtml(favOf(x.url), x.title, x.url) + '<span><b>' + esc(x.title || host(x.url)) + '</b><small>' + esc(host(x.url)) + '</small></span></span></button><button class="ib x" data-hd="' + esc(x.url) + '" title="Удалить из истории">✕</button></div>';
    });
    $('#hsList').innerHTML = out || '<p class="hint">История пуста.</p>';
  }
  $('#hsQ').addEventListener('input', drawHist);
  hs.addEventListener('click', function (e) {
    var g = e.target.closest('[data-hu]'); if (g) { I.closeSheet('histSheet'); if (e.ctrlKey) I.newTab(g.dataset.hu, I.cur + 1); else I.navigate(g.dataset.hu); return; }
    var d = e.target.closest('[data-hd]'); if (d) {
      var u = d.dataset.hd, hd = jget('mg_hist_del', {}); hd[u] = Date.now(); jset('mg_hist_del', hd);
      jset('mg_history', jget('mg_history', []).filter(function (x) { return x.url !== u; })); changed(); drawHist(); I.renderHome(); return;
    }
    if (e.target.closest('#hsClear')) {
      ask('Очистить всю историю на всех устройствах? Напишите «да»', '').then(function (v) {
        if (!v || !/^да$/i.test(v.trim())) return;
        jset('mg_hist_cleared', Date.now()); jset('mg_history', []); jset('mg_hist_del', {}); changed(); drawHist(); I.renderHome(); I.toast('История очищена');
      });
    }
  });

  // ======================= главная: вкладки других устройств =======================
  var devBox = el('div', 'devs'); devBox.id = 'devBox';
  var home = $('#home'); home.insertBefore(devBox, $('#hiHead'));
  function drawDevices() {
    var devs = jget('mg_devices', {}), ids = Object.keys(devs).filter(function (id) { return id !== DEV.id && devs[id].tabs && devs[id].tabs.length; });
    ids.sort(function (a, b) { return (devs[b].t || 0) - (devs[a].t || 0); });
    if (!ids.length) { devBox.innerHTML = ''; return; }
    devBox.innerHTML = '<h2>Вкладки на других компьютерах</h2>' + ids.map(function (id) {
      var d = devs[id], when = new Date(d.t || 0).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return '<div class="dev"><div class="devh"><b>💻 ' + esc(d.name || 'Компьютер') + '</b><small>' + esc(when) + ' · ' + d.tabs.length + '</small><button class="btn ghost" data-dall="' + esc(id) + '">Открыть все</button></div>' +
        d.tabs.slice(0, 12).map(function (t) { return '<button class="go devt" data-du="' + esc(t.url) + '"><span class="lrow">' + iconHtml(t.fav || favOf(t.url), t.title, t.url) + '<span><b>' + esc(t.title || host(t.url)) + (t.pinned ? ' 📌' : '') + '</b><small>' + esc(host(t.url)) + '</small></span></span></button>'; }).join('') +
        (d.tabs.length > 12 ? '<p class="hint">…и ещё ' + (d.tabs.length - 12) + '</p>' : '') + '</div>';
    }).join('');
  }
  devBox.addEventListener('click', function (e) {
    var a = e.target.closest('[data-dall]'); if (a) { var d = jget('mg_devices', {})[a.dataset.dall]; (d && d.tabs || []).forEach(function (t) { I.newTab(t.url); }); tabsChanged(); return; }
    var u = e.target.closest('[data-du]'); if (u) { I.navigate(u.dataset.du); tabsChanged(); }
  });

  // ======================= меню ⋮ =======================
  var grid = $('#menu .menuGrid');
  if (grid) {
    grid.insertAdjacentHTML('beforeend', '<button class="mi" data-act2="hist"><span>🕘</span>История</button><button class="mi" data-act2="bm"><span>★</span>Избранное</button><button class="mi" data-act2="bar"><span>▭</span>Панель избранного</button>');
    grid.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act2]'); if (!b) return; I.closeSheet('menu');
      if (b.dataset.act2 === 'hist') openHistory(); else if (b.dataset.act2 === 'bm') openBm(); else { S.bar = !S.bar; jset('mg_ui', S); applyBar(); }
    });
  }

  // ======================= синхронизация (общий аккаунт) =======================
  function myTabs() {
    return I.tabs.map(function (t) { var u = I.curUrlOf(t); return u ? { url: u, title: t.title || '', fav: t.fav || '', pinned: !!t.pinned } : null; }).filter(Boolean);
  }
  var lastSig = '';
  function tabsChanged() {
    var sig = JSON.stringify(myTabs());
    if (sig !== lastSig) { lastSig = sig; jset('mg_tabs_t', Date.now()); changed(); }
  }
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }
  var DAY = 86400000;
  function snapGet() {
    var dev = Object.assign({}, jget('mg_devices', {}));
    dev[DEV.id] = { name: DEV.name, t: jget('mg_tabs_t', 0) || 0, tabs: myTabs() };
    return { bm: BM().items, hist: jget('mg_history', []), hc: jget('mg_hist_cleared', 0) || 0, hd: jget('mg_hist_del', {}), dev: dev };
  }
  function snapMerge(a, b) {
    var now = Date.now(), out = { bm: {}, hist: [], hc: Math.max(a.hc || 0, b.hc || 0), hd: {}, dev: {} };
    [a.bm || {}, b.bm || {}].forEach(function (m) { Object.keys(m).forEach(function (id) { var x = m[id], o = out.bm[id]; if (!o || (x.t || 0) > (o.t || 0)) out.bm[id] = x; }); });
    Object.keys(out.bm).forEach(function (id) { var x = out.bm[id]; if (x.del && now - (x.t || 0) > 180 * DAY) delete out.bm[id]; });
    [a.hd || {}, b.hd || {}].forEach(function (m) { Object.keys(m).forEach(function (u) { if (!out.hd[u] || m[u] > out.hd[u]) out.hd[u] = m[u]; }); });
    Object.keys(out.hd).forEach(function (u) { if (now - out.hd[u] > 90 * DAY) delete out.hd[u]; });
    var best = {};
    (a.hist || []).concat(b.hist || []).forEach(function (x) {
      if (!x || !x.url || (x.t || 0) <= out.hc || (out.hd[x.url] && (x.t || 0) <= out.hd[x.url])) return;
      var o = best[x.url]; if (!o || (x.t || 0) > (o.t || 0)) best[x.url] = x;
    });
    out.hist = Object.keys(best).map(function (k) { return best[k]; }).sort(function (x, y) { return (y.t || 0) - (x.t || 0); }).slice(0, 1000);
    [a.dev || {}, b.dev || {}].forEach(function (m) { Object.keys(m).forEach(function (id) { var x = m[id], o = out.dev[id]; if (!o || (x.t || 0) > (o.t || 0)) out.dev[id] = x; }); });
    if (a.dev && a.dev[DEV.id]) out.dev[DEV.id] = a.dev[DEV.id];   // свои вкладки — всегда свои
    Object.keys(out.dev).forEach(function (id) { if (id !== DEV.id && now - (out.dev[id].t || 0) > 30 * DAY) delete out.dev[id]; });
    return out;
  }
  function snapApply(m) {
    jset('mg_bm2', { items: m.bm || {} });
    jset('mg_history', m.hist || []); jset('mg_hist_cleared', m.hc || 0); jset('mg_hist_del', m.hd || {});
    var dev = Object.assign({}, m.dev || {}); delete dev[DEV.id]; jset('mg_devices', dev);
    drawBar(); drawStar(); drawDevices(); I.renderHome(); if (!$('#bmMgr').hidden) drawMgr(); if (!$('#histSheet').hidden) drawHist();
    return Promise.resolve();
  }
  function snapKey(s) { var x = Object.assign({}, s); return stable(x); }
  window.MGI_sync = { get: snapGet, merge: snapMerge, apply: snapApply, key: snapKey, device: DEV };   // для проверки
  // карточка аккаунта в Настройках (на сайте она своя — здесь своя)
  var acctCard = $('#acctBox') && $('#acctBox').closest('.card');
  if (acctCard) { acctCard.classList.remove('web-only'); acctCard.querySelector('h3').textContent = 'Аккаунт и синхронизация'; }
  if (window.MMAccount) {
    MMAccount.setup({
      app: 'grabber-pc', title: 'Мое_граббер (программа)', mount: '#acctBox', toast: I.toast,
      note: 'Синхронизируются избранное с папками, история и открытые вкладки — между всеми компьютерами, где вы вошли. Имя этого компьютера: ' + DEV.name + '.',
      snapshot: { get: snapGet, merge: snapMerge, apply: snapApply, key: snapKey }
    });
  }

  // ======================= обновления интерфейса =======================
  window.MGI_onUpdate = function () { drawTabs(); drawStar(); if (!$('#home').hidden) drawDevices(); tabsChanged(); };
  drawTabs(); drawBar(); drawStar(); drawDevices(); applyBar();
  lastSig = JSON.stringify(myTabs());
})();
