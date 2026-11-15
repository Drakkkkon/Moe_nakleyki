/* Мое_граббер — только программа (с 1.8.0): автообновление с GitHub — раздел «Обновления» в Настройках и полоса сверху. */
(function () {
  'use strict';
  var I = window.MGI, N = window.MGNative;
  if (!I || !N || !N.upd) return;
  var U = N.upd, $ = function (s, r) { return (r || document).querySelector(s); }, esc = I.esc;
  var CFG = Object.assign({ auto: true }, I.jget('mg_upd', {}));
  function save() { try { localStorage.setItem('mg_upd', JSON.stringify(CFG)); } catch (e) {} }
  function mb(n) { return n ? (n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace('.', ',') + ' МБ' : ''; }
  var info = null, last = null, busy = false, ready = null;

  // ---------- полоса сверху ----------
  var bar = document.createElement('div'); bar.className = 'updbar'; bar.hidden = true; document.body.appendChild(bar);
  function showBar(html, buttons) {
    bar.innerHTML = '<span>' + html + '</span>';
    (buttons || []).forEach(function (b) { var e = document.createElement('button'); e.className = 'btn sm' + (b[2] ? ' pri' : ''); e.textContent = b[0]; e.onclick = b[1]; bar.appendChild(e); });
    var x = document.createElement('button'); x.className = 'ib x'; x.textContent = '✕'; x.setAttribute('aria-label', 'Скрыть'); x.onclick = function () { bar.hidden = true; }; bar.appendChild(x);
    bar.hidden = false;
  }

  // ---------- раздел в Настройках ----------
  var card = document.createElement('div'); card.className = 'card'; card.id = 'updCard';
  card.innerHTML = '<h3>Обновления</h3>' +
    '<div class="upd-row"><span>Версия программы: <b id="updVer">…</b></span><small id="updFrom"></small></div>' +
    '<label class="sw"><input type="checkbox" id="updAuto"><span>Обновлять автоматически (скачивать новую версию с GitHub и предлагать перезапуск)</span></label>' +
    '<div class="row"><button class="btn" id="updCheck">Проверить сейчас</button><button class="btn pri" id="updGo" hidden>Обновить</button><button class="btn ghost" id="updBack" hidden>Вернуться к встроенной версии</button></div>' +
    '<div class="pbar" id="updBarWrap" hidden><i id="updProg"></i></div>' +
    '<p class="hint" id="updState"></p><div id="updNotes"></div>';
  var pad = $('#settings .pad'), acct = $('#acctBox') && $('#acctBox').closest('.card');
  if (pad) { if (acct && acct.nextSibling) pad.insertBefore(card, acct.nextSibling); else pad.insertBefore(card, pad.firstChild); }
  $('#updAuto').checked = !!CFG.auto;
  $('#updAuto').onchange = function () { CFG.auto = this.checked; save(); };
  function st(t) { $('#updState').textContent = t; }
  function notesHtml(r) {
    if (!r || !r.notes || !r.notes.length) return '';
    return '<p class="cap">Что нового в ' + esc(r.version) + (r.date ? ' (' + esc(r.date) + ')' : '') + ':</p><ul class="upd-notes">' + r.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
  }
  async function refreshInfo() {
    info = await U.info();
    $('#updVer').textContent = info.running;
    $('#updFrom').textContent = info.updated ? 'обновлена с GitHub (в папке программы — ' + info.builtin + ')' : 'встроенная в папку программы';
    $('#updBack').hidden = !info.updated;
  }
  U.onProgress(function (d) {
    $('#updBarWrap').hidden = false;
    $('#updProg').style.width = d.total ? Math.round(d.got / d.total * 100) + '%' : '30%';
    st('Скачиваю… ' + mb(d.got) + (d.total ? ' из ' + mb(d.total) : ''));
  });

  async function check(manual) {
    if (busy) return last;
    busy = true; if (manual) st('Проверяю…');
    var r = await U.check(); busy = false; last = r;
    try { localStorage.setItem('mg_upd_last', String(Date.now())); } catch (e) {}
    if (!r.ok) { if (manual) st('Не удалось проверить: ' + r.error); return r; }
    $('#updNotes').innerHTML = r.available ? notesHtml(r) : '';
    if (!r.available) { st('У вас последняя версия (' + info.running + '). Проверено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + '.'); $('#updGo').hidden = true; return r; }
    $('#updGo').hidden = !!ready;
    $('#updGo').textContent = r.kind === 'full' ? 'Скачать и установить (' + mb(r.size) + ')' : 'Обновить до ' + r.version;
    st('Доступна версия ' + r.version + (r.kind === 'full' ? ' — полное обновление: внутри новый Chrome, ' + mb(r.size) + '.' : '.'));
    return r;
  }
  async function download(r) {
    if (busy) return; busy = true;
    $('#updGo').hidden = true; $('#updCheck').disabled = true;
    var res = await U.download(); busy = false; $('#updCheck').disabled = false; $('#updBarWrap').hidden = true;
    if (!res.ok) { st('Обновление не скачалось: ' + res.error); $('#updGo').hidden = false; showBar('Обновление ' + esc(r.version) + ' не скачалось: ' + esc(res.error), [['Ещё раз', function () { bar.hidden = true; download(r); }]]); return; }
    ready = res;
    if (res.kind === 'full') {
      st('Готово: новая версия распакована в папку ' + res.dir + '. Нажмите «Перезапустить» — откроется она. Старую папку потом можно удалить.');
      showBar('Мое_граббер <b>' + esc(res.version) + '</b> установлен рядом с этой папкой.', [['Перезапустить', function () { U.restart(); }, true], ['Открыть папку', function () { U.openFolder(); }]]);
    } else {
      st('Обновление ' + res.version + ' скачано. Перезапустите программу — вкладки откроются те же.');
      showBar('Мое_граббер <b>' + esc(res.version) + '</b> готов.', [['Перезапустить', function () { U.restart(); }, true], ['Что нового', function () { I.closeSheet && I.openSheet('settings'); setTimeout(function () { card.scrollIntoView({ behavior: 'smooth' }); }, 250); }]]);
    }
    $('#updNotes').innerHTML = notesHtml(r);
  }
  $('#updCheck').onclick = function () { check(true); };
  $('#updGo').onclick = function () { if (last && last.available) download(last); };
  $('#updBack').onclick = function () { st('Возвращаюсь к встроенной версии…'); U.rollback(); };

  // ---------- сама по себе: через 10 секунд после запуска и раз в 6 часов ----------
  async function auto() {
    await refreshInfo();
    var r = await check(false);
    if (!r || !r.ok || !r.available || ready) return;
    if (CFG.auto && r.kind === 'app') { download(r); return; }
    showBar('Доступна новая версия Мое_граббер <b>' + esc(r.version) + '</b>' + (r.kind === 'full' ? ' (' + mb(r.size) + ')' : '') + '.',
      [[r.kind === 'full' ? 'Скачать и установить' : 'Обновить', function () { bar.hidden = true; download(r); }, true], ['Что нового', function () { I.openSheet('settings'); setTimeout(function () { card.scrollIntoView({ behavior: 'smooth' }); }, 250); }]]);
  }
  refreshInfo();
  setTimeout(auto, 10000);
  setInterval(auto, 6 * 3600 * 1000);
  window.MG_update = { check: check, auto: auto };   // для проверки
})();
