/* =====================================================================================================
   Общий аккаунт для всех сайтов Drakkkkon (mm-account.js, 1.0.0)
   Вход и регистрация по почте и паролю через Firebase (проект money99774 — тот же, что «Аккаунт My Money»).
   Все сайты лежат на одном адресе drakkkkon.github.io, поэтому вход общий: вошли на одном сайте — вошли на всех.
   Данные каждого сайта — в своей ветке базы: users/<uid>/apps/<сайт> = { json: снимок строкой, updatedAt, v }.
   Правила базы пускают каждого только в свою ветку users/<uid>: чужие данные не прочитать.

   Подключение: MMAccount.setup({ app, title, mount, ... }) — см. описание опций ниже.
   Два способа синхронизации:
     snapshot — сайт сам умеет собрать снимок, слить два снимка и применить результат (iLife);
     items    — модуль сам сохраняет выбранные ключи localStorage и записи IndexedDB. У каждого ключа своё время
                изменения: побеждает более свежая правка, удаления передаются «надгробиями» (180 дней).
   Синхронизация: при входе, при открытии страницы, раз в минуту, при возврате на вкладку, при появлении интернета
   и после изменений (MMAccount.changed()). Большие файлы (фото, музыка, страницы) остаются там, где были.
   ===================================================================================================== */
(function () {
    'use strict';
    if (window.MMAccount) return;

    var FIREBASE_CONFIG = {
        apiKey: 'AIzaSyB27Rqisiz2OyavjImphW-M0PBg5hbIdiE',
        authDomain: 'money99774.firebaseapp.com',
        databaseURL: 'https://money99774-default-rtdb.firebaseio.com',
        projectId: 'money99774',
        storageBucket: 'money99774.firebasestorage.app',
        messagingSenderId: '711455509046',
        appId: '1:711455509046:web:dbedd1a788759ccaa22697'
    };
    var SDK = [
        'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
        'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
        'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js'
    ];
    var APP_NAME = 'mm-account';             // то же имя, что в My Money 4.13+: вход общий и с ним
    var USER_KEY = 'mma.user';               // запомненный вход (чтобы грузить Firebase только тем, кто входил)
    var TOMB_TTL = 180 * 86400000;
    var PERIOD = 60000;

    var cfg = null, fbApp = null, user = null, ready = false;
    var running = false, again = false, timer = null, startedAt = Date.now(), paused = false;
    var status = { state: 'off', text: '' }, mode = 'login', firstSyncDone = false;
    var readyResolve, readyPromise = new Promise(function (r) { readyResolve = r; });

    // ---------- мелочи ----------
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
    function jget(k, d) { try { var v = lsGet(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
    function hash(str) { var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + ':' + str.length; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function toast(t) {
        if (cfg && typeof cfg.toast === 'function') { try { cfg.toast(t); return; } catch (e) {} }
        var el = document.createElement('div'); el.className = 'mma-toast'; el.textContent = t; document.body.appendChild(el);
        setTimeout(function () { el.classList.add('is-out'); }, 2600); setTimeout(function () { el.remove(); }, 3100);
    }
    function loadScript(src) {
        return new Promise(function (res, rej) {
            if (document.querySelector('script[data-mma="' + src + '"]')) { res(); return; }
            var s = document.createElement('script'); s.src = src; s.async = false; s.setAttribute('data-mma', src);
            s.onload = function () { res(); }; s.onerror = function () { s.remove(); rej(new Error('Не загрузился ' + src)); };
            document.head.appendChild(s);
        });
    }
    function sdk() {
        if (fbApp) return Promise.resolve(fbApp);
        var chain = Promise.resolve();
        SDK.forEach(function (src) { chain = chain.then(function () { return loadScript(src); }); });
        return chain.then(function () {
            var ex = firebase.apps.filter(function (a) { return a.name === APP_NAME; })[0];
            fbApp = ex || firebase.initializeApp(FIREBASE_CONFIG, APP_NAME);
            try { fbApp.auth().languageCode = 'ru'; } catch (e) {}
            return fbApp;
        });
    }
    function userFrom(u) { return u ? { uid: u.uid, email: u.email || '', name: u.displayName || '', verified: !!u.emailVerified } : null; }
    function ref() { return fbApp.database().ref('users/' + user.uid + '/apps/' + cfg.app); }
    function k(name) { return 'mma.' + name + '.' + cfg.app + '.' + (user ? user.uid : ''); }

    // ---------- понятные ошибки ----------
    function errText(e) {
        var code = String((e && e.code) || ''), map = {
            'auth/email-already-in-use': 'Аккаунт с этой почтой уже есть. Нажмите «Вход» или «Забыли пароль?».',
            'auth/invalid-email': 'Почта записана неправильно.',
            'auth/weak-password': 'Слишком простой пароль: нужно не меньше 6 символов.',
            'auth/missing-password': 'Введите пароль.',
            'auth/wrong-password': 'Неверная почта или пароль.', 'auth/user-not-found': 'Неверная почта или пароль.',
            'auth/invalid-credential': 'Неверная почта или пароль.', 'auth/invalid-login-credentials': 'Неверная почта или пароль.',
            'auth/user-disabled': 'Этот аккаунт отключён.',
            'auth/too-many-requests': 'Слишком много попыток. Подождите несколько минут и попробуйте снова.',
            'auth/network-request-failed': 'Нет связи с сервером. Проверьте интернет.',
            'auth/requires-recent-login': 'Для этого действия выйдите и войдите заново.'
        };
        if (map[code]) return map[code];
        if (/permission/i.test(String(e && e.message))) return 'Нет доступа к данным аккаунта. Выйдите и войдите снова.';
        return 'Ошибка: ' + ((e && e.message) || e);
    }

    // =================================================================================================
    // Способ «items»: ключи localStorage и записи IndexedDB
    // =================================================================================================
    // Значения IndexedDB переводим в JSON: байты — base64, даты — числом, Blob/File не передаём (метка $blob)
    function b64(u8) { var s = '', CH = 0x8000; for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
    function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
    function enc(v) {
        if (v == null || typeof v !== 'object') return v;
        if (typeof Blob !== 'undefined' && v instanceof Blob) return { $blob: 1 };
        if (v instanceof Date) return { $date: v.getTime() };
        if (v instanceof ArrayBuffer) return { $ab: b64(new Uint8Array(v)) };
        if (ArrayBuffer.isView(v)) return { $ta: v.constructor.name, d: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
        if (Array.isArray(v)) return v.map(enc);
        var o = {}; Object.keys(v).forEach(function (key) { o[key] = enc(v[key]); }); return o;
    }
    function dec(v, local) {
        if (v == null || typeof v !== 'object') return v;
        if (v.$blob) return local;                       // файл не передавался: оставляем свой (или ничего)
        if ('$date' in v) return new Date(v.$date);
        if ('$ab' in v) return unb64(v.$ab).buffer;
        if ('$ta' in v) { var u = unb64(v.d), C = window[v.$ta] || Uint8Array; return C === Uint8Array ? u : new C(u.buffer); }
        if (Array.isArray(v)) return v.map(function (x, i) { return dec(x, local && local[i]); });
        var o = {}; Object.keys(v).forEach(function (key) { o[key] = dec(v[key], local && typeof local === 'object' ? local[key] : undefined); }); return o;
    }

    function lsRule(key) {
        if (/^mma\./.test(key)) return null;
        if ((cfg.lsExclude || []).some(function (x) { return x instanceof RegExp ? x.test(key) : x === key; })) return null;
        var hit = null;
        (cfg.ls || []).some(function (r) {
            if (typeof r === 'string') { if (r.slice(-1) === '*' ? key.indexOf(r.slice(0, -1)) === 0 : key === r) { hit = {}; return true; } }
            else if (r && r.key === key) { hit = r; return true; }
            return false;
        });
        return hit;
    }
    function lsKeys() { var out = []; try { for (var i = 0; i < localStorage.length; i++) { var key = localStorage.key(i); if (key != null && lsRule(key)) out.push(key); } } catch (e) {} return out; }
    // keepLocal — поля JSON, которые у каждого устройства свои (токены, время последней синхронизации…): в облако не уходят
    function lsOut(key, raw, rule) {
        if (!rule.keepLocal || !rule.keepLocal.length) return raw;
        try { var o = JSON.parse(raw); if (o && typeof o === 'object') { rule.keepLocal.forEach(function (f) { delete o[f]; }); return JSON.stringify(o); } } catch (e) {}
        return raw;
    }
    function lsIn(key, val, rule) {
        if (!rule.keepLocal || !rule.keepLocal.length) return val;
        try {
            var o = JSON.parse(val), cur = JSON.parse(lsGet(key) || 'null');
            if (o && typeof o === 'object' && cur && typeof cur === 'object') rule.keepLocal.forEach(function (f) { if (f in cur) o[f] = cur[f]; else delete o[f]; });
            return JSON.stringify(o);
        } catch (e) { return val; }
    }

    // IndexedDB: открываем только уже существующую базу (новую не создаём — иначе сломаем самому сайту первую установку)
    var dbCache = {};
    function openExisting(name) {
        if (dbCache[name]) return dbCache[name];
        dbCache[name] = new Promise(function (res) {
            var created = false, req;
            try { req = indexedDB.open(name); } catch (e) { res(null); return; }
            req.onupgradeneeded = function () { created = true; try { req.transaction.abort(); } catch (e) {} };
            req.onsuccess = function () {
                var db = req.result;
                db.onversionchange = function () { try { db.close(); } catch (e) {} delete dbCache[name]; };
                res(created ? (db.close(), null) : db);
            };
            req.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); res(null); };
            req.onblocked = function () { res(null); };
        });
        dbCache[name].then(function (db) { if (!db) delete dbCache[name]; });
        return dbCache[name];
    }
    function idbReadAll(spec) {
        return openExisting(spec.db).then(function (db) {
            if (!db || !db.objectStoreNames.contains(spec.store)) return null;
            return new Promise(function (res) {
                var out = [], t;
                try { t = db.transaction(spec.store, 'readonly'); } catch (e) { res(null); return; }
                var st = t.objectStore(spec.store), c = st.openCursor();
                c.onsuccess = function () { var cur = c.result; if (!cur) return; out.push([cur.primaryKey, cur.value]); cur.continue(); };
                t.oncomplete = function () { res({ inline: !!st.keyPath, list: out }); };
                t.onerror = t.onabort = function () { res(null); };
            });
        });
    }
    function idbWrite(spec, ops) {   // ops: [{ key, value } | { key, del: true }]
        if (!ops.length) return Promise.resolve();
        return openExisting(spec.db).then(function (db) {
            if (!db || !db.objectStoreNames.contains(spec.store)) return;
            return new Promise(function (res) {
                var t = db.transaction(spec.store, 'readwrite'), st = t.objectStore(spec.store);
                ops.forEach(function (op) {
                    try {
                        if (op.del) st.delete(op.key);
                        else if (st.keyPath) st.put(op.value); else st.put(op.value, op.key);
                    } catch (e) { console.warn('mm-account: запись не удалась', op.key, e); }
                });
                t.oncomplete = function () { res(); }; t.onerror = t.onabort = function () { res(); };
            });
        });
    }
    function idbGet(spec, key) {
        return openExisting(spec.db).then(function (db) {
            if (!db || !db.objectStoreNames.contains(spec.store)) return undefined;
            return new Promise(function (res) { var r = db.transaction(spec.store).objectStore(spec.store).get(key); r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(undefined); }; });
        });
    }

    // Все свои данные: Map «ключ» → строка. Для IndexedDB ключ записи сохраняем внутри значения (bk)
    function collectLocal() {
        var map = new Map(), meta = {};
        lsKeys().forEach(function (key) { var raw = lsGet(key); if (raw != null) map.set('ls:' + key, lsOut(key, raw, lsRule(key))); });
        var specs = cfg.idb || [];
        return specs.reduce(function (p, spec, si) {
            return p.then(function () {
                return idbReadAll(spec).then(function (r) {
                    if (!r) return;
                    r.list.forEach(function (pair) {
                        var pk = pair[0], val = pair[1];
                        if (spec.filter && !spec.filter(pk, val)) return;
                        var s = JSON.stringify({ k: enc(pk), v: enc(spec.strip ? spec.strip(val) : val) });
                        if (spec.maxBytes && s.length > spec.maxBytes) return;
                        var id = 'idb:' + si + ':' + JSON.stringify(enc(pk));
                        map.set(id, s); meta[id] = { spec: spec, pk: pk };
                    });
                });
            });
        }, Promise.resolve()).then(function () { return { map: map, meta: meta }; });
    }
    function specOf(id) { var m = /^idb:(\d+):/.exec(id); return m ? (cfg.idb || [])[Number(m[1])] : null; }

    function itemsSync() {
        var now = Date.now(), base = jget(k('base'), {}), changedLocal = false;
        return collectLocal().then(function (L) {
            var local = L.map;
            var localHashes = {};
            local.forEach(function (v, id) { localHashes[id] = hash(v); });
            // что поменялось на устройстве с прошлой синхронизации
            var lc = {};
            Object.keys(localHashes).forEach(function (id) { if (!base[id] || base[id][0] !== localHashes[id]) lc[id] = true; });
            Object.keys(base).forEach(function (id) {
                if (local.has(id)) return;
                var sp = specOf(id);
                if (sp && sp.noDelete) return;       // такие записи сайт создаёт сам (например комиксы со страницами): их отсутствие — не удаление
                if (id.indexOf('ls:') === 0 && !lsRule(id.slice(3))) return;
                lc[id] = true;
            });
            changedLocal = Object.keys(lc).length > 0;
            return ref().child('updatedAt').once('value').then(function (s) {
                var remoteAt = Number(s.val()) || 0, lastRemote = Number(lsGet(k('remote'))) || 0;
                if (!changedLocal && remoteAt === lastRemote && firstSyncDone) return { applied: false, uploaded: false };
                var getRemote = remoteAt ? ref().child('json').once('value').then(function (x) { try { return JSON.parse(x.val() || '{}') || {}; } catch (e) { return {}; } }) : Promise.resolve({});
                return getRemote.then(function (R) {
                    var Ri = R.items || {}, Rd = R.del || {};
                    // Первый вход на этом устройстве в аккаунт, где уже есть данные: берём данные аккаунта,
                    // а своё отправляем только то, чего в аккаунте ещё нет (иначе пустой новый телефон затёр бы всё)
                    if (!Object.keys(base).length && remoteAt) Object.keys(lc).forEach(function (id) { if (Ri[id] || Rd[id]) delete lc[id]; });
                    var out = { items: {}, del: {} }, toApply = [];
                    var ids = {}; [Object.keys(Ri), Object.keys(Rd), Object.keys(base), Array.from(local.keys())].forEach(function (a) { a.forEach(function (id) { ids[id] = 1; }); });
                    Object.keys(ids).forEach(function (id) {
                        var ri = Ri[id], rd = Number(Rd[id]) || 0, rT = ri ? Number(ri.t) || 0 : rd;
                        var bT = base[id] ? base[id][1] : 0, isLc = !!lc[id];
                        if (rT > bT && !isLc) {
                            // правка с другого устройства
                            if (ri) { out.items[id] = ri; if (localHashes[id] !== hash(ri.v)) toApply.push({ id: id, v: ri.v }); }
                            else { out.del[id] = rd; if (local.has(id)) toApply.push({ id: id, del: true }); }
                        } else if (isLc) {
                            if (local.has(id)) out.items[id] = { v: local.get(id), t: now };
                            else out.del[id] = now;
                        } else if (ri) out.items[id] = ri;
                        else if (rd) out.del[id] = rd;
                        else if (local.has(id)) out.items[id] = { v: local.get(id), t: bT || now };
                    });
                    Object.keys(out.del).forEach(function (id) { if (out.del[id] < now - TOMB_TTL) delete out.del[id]; });
                    return applyItems(toApply, L.meta).then(function (applied) {
                        var nb = {};
                        Object.keys(out.items).forEach(function (id) {
                            // запись «только обновлять», которой на этом устройстве нет — в базе не запоминаем (её не стало бы и не появится)
                            var sp = specOf(id);
                            if (sp && sp.updateOnly && !local.has(id) && !applied.wrote[id]) return;
                            nb[id] = [hash(out.items[id].v), out.items[id].t];
                        });
                        var json = JSON.stringify(out), remoteJson = JSON.stringify({ items: Ri, del: Rd });
                        var up = json !== remoteJson ? ref().set({ json: json, updatedAt: firebase.database.ServerValue.TIMESTAMP, v: 1 })
                            .then(function () { return ref().child('updatedAt').once('value'); }).then(function (x) { return Number(x.val()) || Date.now(); }) : Promise.resolve(remoteAt);
                        return up.then(function (at) {
                            lsSet(k('base'), JSON.stringify(nb)); lsSet(k('remote'), String(at));
                            return { applied: applied.count > 0, uploaded: json !== remoteJson };
                        });
                    });
                });
            });
        });
    }

    function applyItems(list, meta) {
        var res = { count: 0, wrote: {} };
        if (!list.length) return Promise.resolve(res);
        var bySpec = new Map();
        var chain = Promise.resolve();
        list.forEach(function (it) {
            if (it.id.indexOf('ls:') === 0) {
                var key = it.id.slice(3), rule = lsRule(key);
                if (!rule) return;
                if (it.del) lsDel(key); else lsSet(key, lsIn(key, it.v, rule));
                res.count++; res.wrote[it.id] = true;
                return;
            }
            var sp = specOf(it.id); if (!sp) return;
            if (!bySpec.has(sp)) bySpec.set(sp, []);
            bySpec.get(sp).push(it);
        });
        bySpec.forEach(function (items, sp) {
            chain = chain.then(function () {
                var ops = [];
                return items.reduce(function (p, it) {
                    return p.then(function () {
                        if (it.del) { if (!sp.noDelete) { var m = meta[it.id]; if (m) ops.push({ key: m.pk, del: true, id: it.id }); } return; }
                        var parsed; try { parsed = JSON.parse(it.v); } catch (e) { return; }
                        var pk = dec(parsed.k);
                        return idbGet(sp, pk).then(function (cur) {
                            if (sp.updateOnly && cur === undefined) return;
                            var val = dec(parsed.v, cur);
                            if (sp.restore && cur !== undefined) val = sp.restore(val, cur);
                            ops.push({ key: pk, value: val, id: it.id });
                        });
                    });
                }, Promise.resolve()).then(function () {
                    return idbWrite(sp, ops).then(function () { ops.forEach(function (o) { res.count++; res.wrote[o.id] = true; }); });
                });
            });
        });
        return chain.then(function () { return res; });
    }

    // =================================================================================================
    // Способ «snapshot»: сайт сам собирает и сливает снимки
    // =================================================================================================
    function snapshotSync() {
        var S = cfg.snapshot, local = S.get(), localKey = hash(S.key(local));
        return ref().child('updatedAt').once('value').then(function (s) {
            var remoteAt = Number(s.val()) || 0, lastRemote = Number(lsGet(k('remote'))) || 0, lastLocal = lsGet(k('local'));
            var remoteChanged = remoteAt !== lastRemote, localChanged = localKey !== lastLocal;
            if (!remoteChanged && !localChanged && firstSyncDone) return { applied: false, uploaded: false };
            var getRemote = remoteAt ? ref().child('json').once('value').then(function (x) { try { return JSON.parse(x.val() || 'null'); } catch (e) { return null; } }) : Promise.resolve(null);
            return getRemote.then(function (remote) {
                var merged = remote ? S.merge(local, remote) : local, mk = S.key(merged);
                var needApply = remote && mk !== S.key(local);
                var needUpload = !remote || mk !== S.key(remote);
                return Promise.resolve(needApply ? S.apply(merged) : null).then(function () {
                    var after = needApply ? S.get() : merged;
                    var up = needUpload ? ref().set({ json: JSON.stringify(after), updatedAt: firebase.database.ServerValue.TIMESTAMP, v: 1 })
                        .then(function () { return ref().child('updatedAt').once('value'); }).then(function (x) { return Number(x.val()) || Date.now(); }) : Promise.resolve(remoteAt);
                    return up.then(function (at) { lsSet(k('remote'), String(at)); lsSet(k('local'), hash(S.key(after))); return { applied: !!needApply, uploaded: needUpload }; });
                });
            });
        });
    }

    // =================================================================================================
    // Общий ход синхронизации
    // =================================================================================================
    function setStatus(state, text) { status = { state: state, text: text || '' }; render(); if (cfg && cfg.onStatus) { try { cfg.onStatus(status); } catch (e) {} } }
    function sync(manual) {
        if (!user || !cfg || paused) return Promise.resolve(false);
        if (running) { again = true; return Promise.resolve(false); }
        if (!navigator.onLine) { setStatus('offline', 'Нет интернета — синхронизация позже'); return Promise.resolve(false); }
        running = true; setStatus('syncing', 'Синхронизация…');
        var p = (cfg.snapshot ? snapshotSync() : itemsSync());
        return p.then(function (r) {
            firstSyncDone = true;
            lsSet(k('last'), String(Date.now()));
            setStatus('ok', 'Синхронизировано ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
            if (manual) toast('Синхронизировано с аккаунтом');
            if (r && r.applied) onRemoteApplied();
            return true;
        }).catch(function (e) {
            console.warn('mm-account: синхронизация', e);
            setStatus('error', errText(e));
            if (manual) toast('Синхронизация не удалась');
            return false;
        }).then(function (ok) {
            running = false;
            if (again) { again = false; schedule(1500); }
            return ok;
        });
    }
    // Пришли данные с другого устройства. У сайтов «items» данные уже лежат в памяти страницы — её нужно перезапустить
    function onRemoteApplied() {
        if (cfg.snapshot) return;   // snapshot-сайт применил всё сам
        if (typeof cfg.onRemoteApplied === 'function') { try { cfg.onRemoteApplied(); } catch (e) {} return; }
        var early = Date.now() - startedAt < 15000, busy = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
        if ((early || document.visibilityState === 'hidden') && !busy) { location.reload(); return; }
        showBanner();
    }
    function showBanner() {
        if (document.getElementById('mma-banner')) return;
        var b = document.createElement('div'); b.id = 'mma-banner'; b.className = 'mma-banner';
        b.innerHTML = '<span>Пришли изменения с другого устройства</span><button type="button">Обновить</button>';
        b.querySelector('button').onclick = function () { location.reload(); };
        document.body.appendChild(b);
    }
    function schedule(ms) { if (!user) return; clearTimeout(timer); timer = setTimeout(function () { sync(false); }, ms == null ? 2500 : ms); }

    function onUser(u) {
        var prev = user && user.uid;
        user = userFrom(u);
        if (user) lsSet(USER_KEY, JSON.stringify({ email: user.email })); else lsDel(USER_KEY);
        // My Money (4.13+) помнит вход в своём ключе: ставим и его — тогда вход общий и с My Money
        if (user) lsSet('finance_acct_user', JSON.stringify(user)); else lsDel('finance_acct_user');
        ready = true; render();
        if (user && user.uid !== prev) { firstSyncDone = false; sync(false).then(function () { readyResolve(); }); }
        else { if (!user) setStatus('off', ''); readyResolve(); }
    }

    // ---------- вход и регистрация ----------
    function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    function msg(t, ok) { var el = document.getElementById('mma-msg'); if (!el) return; el.textContent = t || ''; el.className = 'mma-msg' + (ok ? ' is-ok' : ''); el.hidden = !t; }
    function busy(on) { document.querySelectorAll('.mma-card button, .mma-card input').forEach(function (b) { b.disabled = !!on; }); }
    function submit() {
        var email = val('mma-email').trim(), pass = val('mma-pass');
        if (!email) { msg('Введите почту.'); return; }
        if (mode !== 'reset' && !pass) { msg('Введите пароль.'); return; }
        if (mode === 'register') {
            if (pass.length < 6) { msg('Пароль — не меньше 6 символов.'); return; }
            if (pass !== val('mma-pass2')) { msg('Пароли не совпадают.'); return; }
        }
        if (!navigator.onLine) { msg('Нет интернета.'); return; }
        busy(true); msg(mode === 'register' ? 'Создаём аккаунт…' : mode === 'reset' ? 'Отправляем письмо…' : 'Входим…', true);
        sdk().then(function (app) {
            var auth = app.auth();
            if (mode === 'reset') return auth.sendPasswordResetEmail(email).then(function () { mode = 'login'; render(); msg('Письмо для смены пароля отправлено на ' + email + '. Если его нет — проверьте «Спам».', true); });
            if (mode === 'register') return auth.createUserWithEmailAndPassword(email, pass).then(function (cred) {
                try { cred.user.sendEmailVerification(); } catch (e) {}
                onUser(cred.user); toast('Аккаунт создан. Мы отправили письмо для подтверждения почты.');
            });
            return auth.signInWithEmailAndPassword(email, pass).then(function (cred) { onUser(cred.user); toast('Вы вошли в аккаунт'); });
        }).catch(function (e) { msg(errText(e)); }).then(function () { busy(false); });
    }
    function signOut() {
        sdk().then(function (app) { return app.auth().signOut(); }).catch(function () {}).then(function () { onUser(null); toast('Вы вышли из аккаунта. Данные остались на этом устройстве.'); });
    }

    // ---------- карточка ----------
    var mountEl = null, floating = null;
    function cardHtml(inPop) {
        if (!user) {
            var reg = mode === 'register', rst = mode === 'reset';
            return '<div class="mma-head"><b>' + (reg ? 'Регистрация' : rst ? 'Смена пароля' : 'Вход в аккаунт') + '</b></div>' +
                '<p class="mma-hint">Один аккаунт для всех моих сайтов: My Money, iLife, Геометрия Полки, Мое_коровы, My_topsecret, Мое_наклейки. ' +
                'Данные «' + esc(cfg.title) + '» хранятся в облаке и сами переходят между телефоном и компьютером.' + (cfg.note ? ' ' + esc(cfg.note) : '') + '</p>' +
                '<input id="mma-email" type="email" placeholder="Почта" autocomplete="username">' +
                (rst ? '' : '<input id="mma-pass" type="password" placeholder="Пароль" autocomplete="' + (reg ? 'new-password' : 'current-password') + '">') +
                (reg ? '<input id="mma-pass2" type="password" placeholder="Пароль ещё раз" autocomplete="new-password">' : '') +
                '<p id="mma-msg" class="mma-msg" hidden></p>' +
                '<button type="button" class="mma-main" data-mma="submit">' + (reg ? 'Создать аккаунт' : rst ? 'Прислать письмо' : 'Войти') + '</button>' +
                '<div class="mma-links">' +
                (mode !== 'login' ? '<a href="#" data-mma="login">Вход</a>' : '<a href="#" data-mma="register">Регистрация</a>') +
                (mode === 'login' ? '<a href="#" data-mma="reset">Забыли пароль?</a>' : '') + '</div>';
        }
        var last = Number(lsGet(k('last'))) || 0;
        return (inPop ? '<div class="mma-head"><b>Аккаунт</b></div>' : '') +
            '<p class="mma-who">Вы вошли как <b>' + esc(user.email) + '</b>' + (user.verified ? '' : '<br><small>Почта не подтверждена — проверьте письмо.</small>') + '</p>' +
            '<p class="mma-status mma-st-' + status.state + '">' + esc(status.text || (last ? 'Последняя синхронизация: ' + new Date(last).toLocaleString('ru-RU') : '')) + '</p>' +
            (cfg.note ? '<p class="mma-hint">' + esc(cfg.note) + '</p>' : '') +
            '<div class="mma-row"><button type="button" class="mma-main" data-mma="sync">Синхронизировать</button><button type="button" data-mma="out">Выйти</button></div>';
    }
    function render() {
        if (!cfg) return;
        var boxes = [];
        if (mountEl) boxes.push(mountEl);
        var pop = document.getElementById('mma-pop'); if (pop) boxes.push(pop.querySelector('.mma-card'));
        var keep = {}; ['mma-email', 'mma-pass', 'mma-pass2'].forEach(function (id) { var el = document.getElementById(id); if (el) keep[id] = el.value; });
        var focus = document.activeElement && document.activeElement.id;
        boxes.forEach(function (b) { if (b) { b.classList.add('mma-card'); b.innerHTML = cardHtml(b !== mountEl); } });
        Object.keys(keep).forEach(function (id) { var el = document.getElementById(id); if (el) el.value = keep[id]; });
        if (focus) { var f = document.getElementById(focus); if (f) f.focus(); }
        if (floating) { floating.classList.toggle('is-in', !!user); floating.title = user ? 'Аккаунт: ' + user.email : 'Войти в аккаунт'; floating.classList.toggle('is-err', status.state === 'error'); }
    }
    function onClick(e) {
        var a = e.target.closest && e.target.closest('.mma-card [data-mma]');
        if (!a) return;
        e.preventDefault();
        var act = a.getAttribute("data-mma");
        if (act === 'submit') submit();
        else if (act === 'sync') sync(true);
        else if (act === 'out') signOut();
        else { mode = act; msg(''); render(); var f = document.getElementById('mma-email'); if (f) f.focus(); sdk().catch(function () {}); }
    }
    function onKey(e) { if (e.key === 'Enter' && e.target && /^mma-(email|pass2?)$/.test(e.target.id)) { e.preventDefault(); submit(); } }
    function openPop() {
        if (document.getElementById('mma-pop')) return closePop();
        var p = document.createElement('div'); p.id = 'mma-pop'; p.className = 'mma-pop';
        p.innerHTML = '<div class="mma-card" role="dialog" aria-label="Аккаунт"></div><button type="button" class="mma-x" aria-label="Закрыть">×</button>';
        p.addEventListener('click', function (e) { if (e.target === p || e.target.classList.contains('mma-x')) closePop(); });
        document.body.appendChild(p); render();
        sdk().catch(function () {});
    }
    function closePop() { var p = document.getElementById('mma-pop'); if (p) p.remove(); }

    var CSS = '.mma-card{display:flex;flex-direction:column;gap:8px;text-align:left}.mma-card input{width:100%;box-sizing:border-box;padding:9px 10px;font:inherit;border-radius:8px;border:1px solid rgba(127,127,127,.5);background:rgba(255,255,255,.92);color:#111}' +
        '.mma-card button{font:inherit;padding:9px 14px;border-radius:8px;border:1px solid rgba(127,127,127,.5);background:rgba(127,127,127,.12);color:inherit;cursor:pointer}.mma-card button.mma-main{background:#1a73e8;border-color:#1a73e8;color:#fff}' +
        '.mma-card button:disabled{opacity:.6}.mma-head{font-size:1.05em}.mma-hint{margin:0;font-size:.88em;opacity:.8}.mma-who{margin:0}.mma-status{margin:0;font-size:.9em;opacity:.85}.mma-st-error{color:#d93025;opacity:1}' +
        '.mma-msg{margin:0;color:#d93025;font-size:.9em}.mma-msg.is-ok{color:inherit;opacity:.8}.mma-links{display:flex;justify-content:space-between;gap:10px;font-size:.92em}.mma-links a{color:#1a73e8}.mma-row{display:flex;gap:8px;flex-wrap:wrap}.mma-row button{flex:1 1 auto}' +
        '.mma-fab{position:fixed;z-index:2147483000;left:10px;bottom:10px;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.6);background:rgba(0,0,0,.45);color:#fff;font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;backdrop-filter:blur(4px)}' +
        '.mma-fab.is-in{background:rgba(26,115,232,.85)}.mma-fab.is-err::after{content:"";position:absolute;top:2px;right:2px;width:9px;height:9px;border-radius:50%;background:#d93025}' +
        '.mma-pop{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}.mma-pop>.mma-card{font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fff;color:#111;border-radius:14px;padding:18px;width:min(380px,100%);box-shadow:0 12px 40px rgba(0,0,0,.35);max-height:90vh;overflow:auto}' +
        '.mma-x{position:absolute;top:10px;right:14px;font-size:28px;background:none;border:none;color:#fff;cursor:pointer}' +
        '.mma-toast{position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:2147483002;background:rgba(32,33,36,.95);color:#fff;padding:10px 16px;border-radius:10px;font:14px/1.35 system-ui,sans-serif;max-width:90vw;transition:opacity .4s}.mma-toast.is-out{opacity:0}' +
        '.mma-banner{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483002;background:#1a73e8;color:#fff;padding:8px 10px 8px 14px;border-radius:10px;display:flex;gap:10px;align-items:center;font:14px/1.3 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3)}.mma-banner button{font:inherit;border:none;border-radius:8px;padding:6px 10px;background:#fff;color:#1a73e8;cursor:pointer}';

    // =================================================================================================
    // Публичное
    // =================================================================================================
    window.MMAccount = {
        version: '1.0.0',
        /* opts:
             app       — имя ветки данных (латиница): ilife, polka, korovy, topsecret, nakleyki
             title     — название сайта для подсказок
             mount     — элемент или селектор, куда нарисовать карточку аккаунта (можно позже: MMAccount.mount(el))
             fab       — true: круглая кнопка 👤 в углу экрана (для сайтов без своих Настроек, например игры)
             note      — строка-пояснение в карточке (что не синхронизируется)
             toast     — функция всплывающей подсказки сайта
             snapshot  — { get(), merge(local, remote), apply(merged) → Promise, key(snap) → строка }
             ls        — ключи localStorage: 'точное_имя', 'префикс*' или { key, keepLocal: [поля JSON, которые не передавать] }
             lsExclude — ключи-исключения (строки или RegExp)
             idb       — [{ db, store, filter(key, value), strip(value), restore(remote, local), updateOnly, noDelete, maxBytes }]
             onRemoteApplied — что делать, когда пришли чужие изменения (по умолчанию перезагрузить страницу или показать полосу «Обновить») */
        setup: function (opts) {
            cfg = opts || {};
            if (!document.getElementById('mma-css')) { var st = document.createElement('style'); st.id = 'mma-css'; st.textContent = CSS; document.head.appendChild(st); }
            document.addEventListener('click', onClick);
            document.addEventListener('keydown', onKey);
            var go = function () {
                if (cfg.mount) MMAccount.mount(cfg.mount);
                if (cfg.fab && !floating) {
                    floating = document.createElement('button'); floating.type = 'button'; floating.className = 'mma-fab'; floating.textContent = '👤';
                    floating.setAttribute('aria-label', 'Аккаунт'); floating.onclick = openPop; document.body.appendChild(floating);
                }
                render();
            };
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
            // Firebase грузим сразу только тем, кто уже входил на этом адресе (здесь или на другом моём сайте)
            var remembered = lsGet(USER_KEY) || lsGet('finance_acct_user');
            if (remembered) {
                sdk().then(function (app) { app.auth().onAuthStateChanged(function (u) { onUser(u); }); })
                    .catch(function (e) { console.warn('mm-account: Firebase не загрузился', e); ready = true; readyResolve(); });
            } else { ready = true; readyResolve(); }
            setInterval(function () { if (user && document.visibilityState === 'visible') sync(false); }, PERIOD);
            document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') schedule(800); else if (user) sync(false); });
            window.addEventListener('online', function () { schedule(1000); });
            setTimeout(function () { if (!ready) { ready = true; readyResolve(); } }, 8000);
        },
        mount: function (el) { mountEl = typeof el === 'string' ? document.querySelector(el) : el; render(); },
        changed: function () { schedule(); },
        sync: function () { return sync(true); },
        open: openPop,
        banner: showBanner,
        // Остановить синхронизацию до перезагрузки страницы (игра: пришло чужое сохранение — своё старое не отправлять)
        pause: function () { paused = true; },   // полоса «Пришли изменения с другого устройства — Обновить»
        // Промис: вход проверен и первая синхронизация закончилась (или её не будет). Для игр — ждать перед запуском
        whenReady: function (ms) { return Promise.race([readyPromise, new Promise(function (r) { setTimeout(r, ms || 5000); })]); },
        user: function () { return user; },
        status: function () { return status; }
    };
})();
