// Правки копии js/app.js только для программы (сайт не меняется): доступ к вкладкам для панели вкладок,
// закрепление и значки вкладок в сохранении, длинная история, крючок после обновления адресной строки.
const fs = require('fs');
const file = process.argv[2];
let s = fs.readFileSync(file, 'utf8');
function rep(a, b) {
  if (!s.includes(a)) { console.error('patch.js: не найдено место для правки:\n' + a.slice(0, 120)); process.exit(1); }
  s = s.replace(a, b);
}
rep("return { hist: t.hist.slice(s), i: Math.max(-1, t.i - s), title: t.title, mode: t.mode };",
    "return { hist: t.hist.slice(s), i: Math.max(-1, t.i - s), title: t.title, mode: t.mode, pinned: !!t.pinned, fav: t.fav || '' };");
rep("    document.title = (t.title ? t.title + ' — ' : '') + 'Мое_граббер';\n  }",
    "    document.title = (t.title ? t.title + ' — ' : '') + 'Мое_граббер';\n    if (window.MGI_onUpdate) { try { window.MGI_onUpdate(); } catch (e) { console.warn(e); } }\n  }");
rep("jset('mg_history', h.slice(0, 200));", "jset('mg_history', h.slice(0, 1000));");
rep("  window.MG = { version: VERSION,", `  // ---- программа: доступ к вкладкам для панели вкладок (desktop/ui.js) ----
  window.MGI = {
    get tabs() { return tabs; }, get cur() { return cur; },
    T: T, curUrl: curUrl, curUrlOf: function (t) { return t.i >= 0 ? t.hist[t.i] : ''; },
    setCur: function (i) { if (i < 0 || i >= tabs.length) return; cur = i; saveTabs(); render(); },
    newTab: function (url, at) {
      var t = newTabObj(), idx = at == null ? tabs.length : Math.max(0, Math.min(at, tabs.length));
      tabs.splice(idx, 0, t); cur = idx; saveTabs();
      if (url) navigate(url); else { render(); setTimeout(function () { var q = document.getElementById('homeQ'); if (q) q.focus(); }, 60); }
      return t;
    },
    closeTab: function (i) {
      var t = tabs[i]; if (!t) return null;
      if (t.wv) t.wv.remove();
      var wasCur = i === cur; tabs.splice(i, 1);
      if (!tabs.length) tabs.push(newTabObj());
      if (i < cur) cur--; else if (wasCur) cur = Math.min(i, tabs.length - 1);
      saveTabs(); render(); return t;
    },
    move: function (from, to) {
      var act = tabs[cur], t = tabs.splice(from, 1)[0]; tabs.splice(to, 0, t);
      cur = tabs.indexOf(act); saveTabs(); updateBar();
    },
    navigate: navigate, render: render, saveTabs: saveTabs, updateBar: updateBar, renderHome: renderHome,
    toast: toast, openPicker: openPicker, openSheet: openSheet, closeSheet: closeSheet, goBack: goBack, goFwd: goFwd,
    host: host, esc: esc, jget: jget, jset: jset
  };
  window.MG = { version: VERSION,`);
// клавиши, которые теперь обрабатывает панель вкладок (ui.js): закрытие вкладки — через неё
rep("      else if (k === 'closetab') {", "      else if (k === 'closetab' && window.MGI_closeCur) { window.MGI_closeCur(); }\n      else if (k === 'closetab') {");
// обычное «Скачать в ZIP»: для страниц комиксов — имя Автор_Название и сведения о комиксе внутри архива
rep("    var blob = zip.blob();\n    lastZip = {", "    if (window.MG_zipExtra) { try { await window.MG_zipExtra(zip, ok + shots); } catch (e) { console.warn(e); } }\n    var blob = zip.blob();\n    lastZip = {");
rep("    openSave('Мое_граббер_' +", "    var cname = null; if (window.MG_zipName) { try { cname = await window.MG_zipName(); } catch (e) {} }\n    if (cname) openSave(cname); else openSave('Мое_граббер_' +");
rep("    host: host, esc: esc, jget: jget, jset: jset\n  };", "    host: host, esc: esc, jget: jget, jset: jset, version: VERSION\n  };");
fs.writeFileSync(file, s);
console.log('patch.js: ok');
