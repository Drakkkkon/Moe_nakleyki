/* Мое_наклейки — приложение */
(function () {
  "use strict";

  const VERSION = "1.1.0";
  const CHANGELOG = "1.1.0 — общий аккаунт по почте и паролю (Настройки → «Аккаунт»), один на все мои сайты: шаблоны, текущая наклейка и настройки сами переходят между телефоном и компьютером. 1.0.0 — первая версия: печать с телефона по USB (принтеры наклеек TSPL и чековые ESC/POS), текст, картинки, QR-коды, штрихкоды Code 128 и EAN-13, шаблоны и примеры, отправка фото и ссылок через «Поделиться».";

  /* ---------- утилиты ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const r1 = (v) => Math.round(v * 10) / 10;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); if (window.MMAccount) window.MMAccount.changed(); return true; } catch (e) { return false; } },
  };

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = !!v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const icon = (d) => h("span", { html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>' }).firstChild;
  const IC = {
    centerH: "M11 2h2v20h-2zM4 8h5v8H4zm11 0h5v8h-5z",
    centerV: "M2 11h20v2H2zM8 4h8v5H8zm0 11h8v5H8z",
    copy: "M8 8h12v12H8zm2 2v8h8v-8zM4 4h12v2H6v10H4z",
    trash: "M9 3h6l1 2h4v2H4V5h4zM6 8h12l-1 13H7zm4 3v7h1.5v-7zm2.5 0v7H14v-7z",
    left: "M4 5h16v2H4zm0 4h10v2H4zm0 4h16v2H4zm0 4h10v2H4z",
    center: "M4 5h16v2H4zm3 4h10v2H7zm-3 4h16v2H4zm3 4h10v2H7z",
    right: "M4 5h16v2H4zm6 4h10v2H10zm-6 4h16v2H4zm6 4h10v2H10z",
  };

  let toastT;
  function toast(msg, err) {
    if (!msg) return;
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("err", !!err);
    t.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("show"), err ? 5200 : 2600);
  }

  /* ---------- состояние ---------- */
  const PRESETS = [[58, 40], [58, 30], [50, 30], [40, 30], [30, 20], [60, 40], [70, 50], [80, 50], [100, 50], [100, 100], [100, 150]];
  const DEFAULTS = {
    lang: "tspl", dpi: 203, density: 8, speed: "", gapMm: 2,
    paper: 58, feedLines: 4, cut: false,
    offX: 0, offY: 0, rotate: false, invert: false, theme: "auto",
  };
  let settings = Object.assign({}, DEFAULTS, store.get("mn_settings", {}));
  let design = store.get("mn_design", null) || starterDesign();
  let templates = store.get("mn_templates", []);
  let selectedId = null;
  let lastRender = null;
  const printer = new UsbPrinter();

  function starterDesign() {
    return {
      widthMm: 58, heightMm: 40, border: false,
      items: [
        { id: uid(), type: "text", x: 3, y: 11, w: 52, text: "Моя первая\nнаклейка", size: 20, bold: true, align: "center", font: "sans", invert: false },
      ],
    };
  }
  const dpmm = () => (+settings.dpi === 300 ? 12 : 8);
  const saveSettings = () => store.set("mn_settings", settings);
  let saveT, warnedQuota = false;
  function saveSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      if (!store.set("mn_design", design) && !warnedQuota) {
        warnedQuota = true;
        toast("Не хватает места для автосохранения — уберите лишние картинки", true);
      }
    }, 300);
  }

  /* ---------- картинки ---------- */
  const images = new Map();
  function getImage(src) {
    if (!src) return null;
    let rec = images.get(src);
    if (!rec) {
      const img = new Image();
      rec = { img, ok: false };
      images.set(src, rec);
      rec.p = new Promise((res) => {
        img.onload = () => { rec.ok = true; scheduleRender(); res(); };
        img.onerror = () => res();
      });
      img.src = src;
    }
    return rec.ok ? rec.img : null;
  }
  async function preloadImages(d) {
    const ps = [];
    for (const it of d.items) if (it.type === "image") { getImage(it.src); const r = images.get(it.src); if (r && r.p) ps.push(r.p); }
    await Promise.all(ps);
  }
  function loadImgEl(url) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  }
  /* Уменьшает картинку до 1000 px, кладёт на белый фон — для хранения и печати этого достаточно */
  async function shrinkImage(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImgEl(url);
      const max = 1000;
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * s)), hh = Math.max(1, Math.round(img.naturalHeight * s));
      const c = document.createElement("canvas");
      c.width = w; c.height = hh;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, hh);
      ctx.drawImage(img, 0, 0, w, hh);
      return { src: c.toDataURL("image/jpeg", 0.9), w, h: hh };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ---------- отрисовка ---------- */
  const paper = $("#paper"), overlay = $("#overlay"), previewCanvas = $("#preview");
  let raf = 0;
  function scheduleRender() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderPreview(); }); }
  function renderPreview() {
    lastRender = LabelRender.render(design, { dpmm: dpmm(), canvas: previewCanvas, getImage });
    layoutPaper();
    drawOverlay();
    updateWarnings();
  }
  function layoutPaper() {
    const stage = $("#stage");
    const avail = Math.max(120, stage.clientWidth - 36);
    const maxH = Math.min(window.innerHeight * 0.42, 440);
    const ratio = design.widthMm / design.heightMm;
    let w = Math.min(avail, maxH * ratio);
    paper.style.width = Math.round(w) + "px";
    paper.style.height = Math.round(w / ratio) + "px";
  }

  let guides = { v: false, h: false };
  function drawOverlay() {
    overlay.textContent = "";
    if (!lastRender) return;
    const W = design.widthMm, H = design.heightMm;
    const pct = (v, t) => (v / t) * 100 + "%";
    for (const [id, msg] of Object.entries(lastRender.warnings)) {
      const b = lastRender.boxes[id];
      if (!b) continue;
      overlay.append(h("div", { class: "warn-dot", title: msg, style: "left:" + pct(b.x, W) + ";top:" + pct(b.y, H) }, "!"));
    }
    const sel = selectedId && lastRender.boxes[selectedId];
    if (sel) {
      overlay.append(h("div", {
        class: "sel",
        style: "left:" + pct(sel.x, W) + ";top:" + pct(sel.y, H) + ";width:" + pct(sel.w, W) + ";height:" + pct(sel.h, H),
      }, h("div", { class: "handle", "aria-label": "Изменить размер" })));
    }
    if (guides.v) overlay.append(h("div", { class: "guide v", style: "left:50%" }));
    if (guides.h) overlay.append(h("div", { class: "guide h", style: "top:50%" }));
  }

  /* ---------- перетаскивание ---------- */
  let drag = null;
  function toMm(e) {
    const r = paper.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * design.widthMm,
      y: ((e.clientY - r.top) / r.height) * design.heightMm,
      perPx: design.widthMm / r.width,
    };
  }
  const itemById = (id) => design.items.find((i) => i.id === id);
  function hitTest(pt) {
    const pad = 8 * pt.perPx;
    for (let i = design.items.length - 1; i >= 0; i--) {
      const it = design.items[i];
      const b = lastRender && lastRender.boxes[it.id];
      if (!b) continue;
      if (pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad) return it;
    }
    return null;
  }
  overlay.addEventListener("pointerdown", (e) => {
    const pt = toMm(e);
    if (e.target.closest(".handle") && selectedId) {
      const it = itemById(selectedId), b = lastRender.boxes[selectedId];
      drag = { mode: "resize", it, start: pt, w: it.w, h: b.h, ratio: b.w / b.h };
    } else {
      const it = hitTest(pt);
      if (!it) { select(null); return; }
      if (it.id !== selectedId) select(it.id);
      drag = { mode: "move", it, start: pt, x: it.x, y: it.y, moved: false };
    }
    overlay.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  overlay.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const pt = toMm(e);
    const dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
    const it = drag.it;
    if (drag.mode === "move") {
      if (!drag.moved && Math.hypot(dx, dy) < 6 * pt.perPx) return;
      drag.moved = true;
      const b = lastRender.boxes[it.id];
      const W = design.widthMm, H = design.heightMm, tol = 7 * pt.perPx;
      let nx = drag.x + dx, ny = drag.y + dy;
      guides = { v: false, h: false };
      if (Math.abs(nx + b.w / 2 - W / 2) < tol) { nx = W / 2 - b.w / 2; guides.v = true; }
      if (Math.abs(ny + b.h / 2 - H / 2) < tol) { ny = H / 2 - b.h / 2; guides.h = true; }
      it.x = r1(clamp(nx, -b.w + 2, W - 2));
      it.y = r1(clamp(ny, -b.h + 2, H - 2));
    } else {
      if (it.type === "text") it.w = r1(Math.max(5, drag.w + dx));
      else if (it.type === "qr") it.w = r1(Math.max(6, drag.w + Math.max(dx, dy)));
      else if (it.type === "image") {
        if (it.keepRatio !== false) { it.w = r1(Math.max(3, drag.w + dx)); it.h = r1(it.w / drag.ratio); }
        else { it.w = r1(Math.max(3, drag.w + dx)); it.h = r1(Math.max(3, drag.h + dy)); }
      } else if (it.type === "barcode") { it.w = r1(Math.max(10, drag.w + dx)); it.h = r1(Math.max(4, drag.h + dy)); }
    }
    syncPosFields();
    scheduleRender();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    guides = { v: false, h: false };
    scheduleRender();
    saveSoon();
  };
  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", endDrag);

  /* ---------- выбор и свойства ---------- */
  function select(id) {
    selectedId = id;
    buildProps();
    scheduleRender();
    $("#stageHint").textContent = id
      ? "Тащите элемент пальцем, а кружок в углу — чтобы изменить размер."
      : design.items.length
        ? "Нажмите на элемент, чтобы изменить его."
        : "Добавьте на наклейку текст, картинку, QR-код или штрихкод.";
  }

  const changed = () => { scheduleRender(); saveSoon(); };

  function numField(label, it, key, opts = {}) {
    return h("label", { class: "field" }, h("span", null, label),
      h("input", {
        type: "number", inputmode: "decimal", step: opts.step || 0.5, "data-k": key,
        value: r1(it[key]),
        oninput: (e) => {
          const v = parseFloat(e.target.value);
          if (!isFinite(v)) return;
          it[key] = Math.max(opts.min ?? -999, v);
          if (it.type === "image" && it.keepRatio !== false && (key === "w" || key === "h")) {
            const ratio = it.ratio || 1;
            if (key === "w") it.h = r1(it.w / ratio); else it.w = r1(it.h * ratio);
            syncPosFields();
          }
          changed();
        },
      }));
  }
  function posBlock(it, keys) {
    const labels = { x: "X, мм", y: "Y, мм", w: it.type === "qr" ? "Размер" : "Ширина", h: "Высота" };
    return h("details", null, h("summary", null, "Точное положение"),
      h("div", { class: keys.length > 3 ? "four" : "three" }, keys.map((k) => numField(labels[k], it, k, { min: k === "w" || k === "h" ? 3 : -999 }))));
  }
  function syncPosFields() {
    const it = itemById(selectedId);
    if (!it) return;
    for (const inp of $$("#props input[data-k]")) {
      if (document.activeElement === inp) continue;
      inp.value = r1(it[inp.dataset.k]);
    }
  }
  function seg(options, current, onPick, cls) {
    const wrap = h("div", { class: "seg " + (cls || ""), role: "radiogroup" });
    for (const [val, label] of options) {
      const b = h("button", { type: "button", class: val === current ? "on" : "", "aria-pressed": val === current ? "true" : "false" }, label);
      b.addEventListener("click", () => {
        $$("button", wrap).forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("on");
        b.setAttribute("aria-pressed", "true");
        onPick(val);
      });
      wrap.append(b);
    }
    return wrap;
  }
  function sw(label, checked, onChange) {
    return h("label", { class: "switch" }, h("input", { type: "checkbox", checked, onchange: (e) => onChange(e.target.checked) }), h("span", null, label));
  }
  function rangeRow(min, max, step, value, fmt, onInput) {
    const out = h("output", null, fmt(value));
    const inp = h("input", { type: "range", min, max, step, value, oninput: (e) => { const v = +e.target.value; out.textContent = fmt(v); onInput(v); } });
    return h("div", { class: "range-row" }, inp, out);
  }

  function centerItem(it, axis) {
    const b = lastRender.boxes[it.id];
    if (!b) return;
    if (axis === "h") it.x = r1((design.widthMm - b.w) / 2);
    else it.y = r1((design.heightMm - b.h) / 2);
    syncPosFields();
    changed();
  }

  function buildProps() {
    const box = $("#props");
    box.textContent = "";
    const it = itemById(selectedId);
    if (!it) return;
    const names = { text: "Текст", image: "Картинка", qr: "QR-код", barcode: "Штрихкод" };
    const iconBtn = (d, title, fn, cls) => h("button", { type: "button", class: "icon-btn " + (cls || ""), title, "aria-label": title, onclick: fn }, icon(d));
    box.append(h("div", { class: "props-head" }, h("b", null, names[it.type]),
      h("div", { class: "icon-btns" },
        iconBtn(IC.centerH, "По центру по горизонтали", () => centerItem(it, "h")),
        iconBtn(IC.centerV, "По центру по вертикали", () => centerItem(it, "v")),
        iconBtn(IC.copy, "Копия", () => {
          const c = clone(it); c.id = uid(); c.x = r1(c.x + 2); c.y = r1(c.y + 2);
          design.items.push(c); select(c.id); changed();
        }),
        iconBtn(IC.trash, "Удалить", () => {
          design.items = design.items.filter((x) => x.id !== it.id); select(null); changed();
        }, "danger"))));

    if (it.type === "text") {
      box.append(
        h("label", { class: "field" }, h("span", null, "Текст"),
          h("textarea", { rows: 2, value: it.text, oninput: (e) => { it.text = e.target.value; changed(); } })),
        h("div", { class: "field" }, h("span", null, "Размер шрифта"),
          rangeRow(5, 96, 1, it.size, (v) => v, (v) => { it.size = v; changed(); })),
        h("div", { class: "field" }, h("span", null, "Выравнивание"),
          seg([["left", icon(IC.left)], ["center", icon(IC.center)], ["right", icon(IC.right)]], it.align || "left", (v) => { it.align = v; changed(); })),
        h("label", { class: "field" }, h("span", null, "Шрифт"),
          h("select", { onchange: (e) => { it.font = e.target.value; changed(); } },
            [["sans", "Обычный"], ["narrow", "Узкий"], ["serif", "С засечками"], ["mono", "Моноширинный"]].map(([v, l]) =>
              h("option", { value: v, selected: (it.font || "sans") === v ? "selected" : null }, l)))),
        sw("Жирный", it.bold, (v) => { it.bold = v; changed(); }),
        sw("Белым по чёрному", it.invert, (v) => { it.invert = v; changed(); }),
        posBlock(it, ["x", "y", "w"]));
    } else if (it.type === "image") {
      box.append(
        h("div", { class: "btn-row" },
          h("button", { type: "button", class: "btn", onclick: () => pickImage(it.id) }, "Заменить"),
          h("button", { type: "button", class: "btn ghost", onclick: () => { fitImage(it); syncPosFields(); changed(); } }, "На всю наклейку")),
        h("div", { class: "field" }, h("span", null, "Как печатать"),
          seg([["photo", "Фото (точками)"], ["bw", "Чёрно-белая"]], it.mode || "photo", (v) => { it.mode = v; changed(); })),
        h("div", { class: "field" }, h("span", null, "Яркость"),
          rangeRow(-100, 100, 5, it.level || 0, (v) => (v > 0 ? "+" + v : v), (v) => { it.level = v; changed(); })),
        sw("Сохранять пропорции", it.keepRatio !== false, (v) => { it.keepRatio = v; if (v) { it.h = r1(it.w / (it.ratio || 1)); syncPosFields(); } changed(); }),
        posBlock(it, ["x", "y", "w", "h"]));
    } else if (it.type === "qr") {
      box.append(
        h("label", { class: "field" }, h("span", null, "Текст или ссылка"),
          h("textarea", { rows: 2, value: it.text, oninput: (e) => { it.text = e.target.value; changed(); } })),
        h("div", { class: "field" }, h("span", null, "Размер, мм"),
          rangeRow(8, Math.max(10, Math.floor(Math.min(design.widthMm, design.heightMm))), 1, Math.round(it.w), (v) => v,
            (v) => { it.w = v; syncPosFields(); changed(); })),
        h("label", { class: "field" }, h("span", null, "Защита от повреждений"),
          h("select", { onchange: (e) => { it.ecc = e.target.value; changed(); } },
            [["L", "Низкая — мельче точки"], ["M", "Обычная"], ["Q", "Повышенная"], ["H", "Высокая — крупнее код"]].map(([v, l]) =>
              h("option", { value: v, selected: (it.ecc || "M") === v ? "selected" : null }, l)))),
        posBlock(it, ["x", "y", "w"]));
    } else if (it.type === "barcode") {
      box.append(
        h("div", { class: "field" }, h("span", null, "Тип штрихкода"),
          seg([["code128", "Code 128"], ["ean13", "EAN-13 (товары)"]], it.format || "code128", (v) => { it.format = v; changed(); })),
        h("label", { class: "field" }, h("span", null, "Код"),
          h("input", { type: "text", value: it.text, autocapitalize: "off", autocomplete: "off", spellcheck: "false", oninput: (e) => { it.text = e.target.value; changed(); } }),
          h("small", { class: "muted" }, "Code 128 — латинские буквы и цифры. EAN-13 — 12 цифр, последняя посчитается сама.")),
        sw("Подпись под штрихкодом", it.showText !== false, (v) => { it.showText = v; changed(); }),
        posBlock(it, ["x", "y", "w", "h"]));
    }
    box.append(h("div", { class: "warn", id: "propWarn", hidden: true }));
    updateWarnings();
  }
  function updateWarnings() {
    const w = $("#propWarn");
    if (!w) return;
    const msg = lastRender && selectedId && lastRender.warnings[selectedId];
    w.hidden = !msg;
    w.textContent = msg || "";
  }

  /* ---------- добавление ---------- */
  let replaceImageId = null;
  function pickImage(replaceId) {
    replaceImageId = replaceId || null;
    $("#fileInput").click();
  }
  function fitImage(it, margin = 1) {
    const W = design.widthMm, H = design.heightMm;
    const ratio = it.ratio || 1;
    let w = W - margin * 2, hh = w / ratio;
    if (hh > H - margin * 2) { hh = H - margin * 2; w = hh * ratio; }
    it.w = r1(w); it.h = r1(hh);
    it.x = r1((W - w) / 2); it.y = r1((H - hh) / 2);
  }
  function addImageItem(img, opts = {}) {
    const it = { id: uid(), type: "image", x: 0, y: 0, w: 10, h: 10, src: img.src, ratio: img.w / img.h, mode: "photo", level: 0, keepRatio: true };
    fitImage(it, opts.margin ?? 2);
    design.items.push(it);
    return it;
  }
  $("#fileInput").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const img = await shrinkImage(f);
      const target = replaceImageId && itemById(replaceImageId);
      if (target) {
        target.src = img.src;
        const oldRatio = target.ratio;
        target.ratio = img.w / img.h;
        if (target.keepRatio !== false && oldRatio !== target.ratio) target.h = r1(target.w / target.ratio);
        select(target.id);
      } else {
        const it = addImageItem(img);
        select(it.id);
      }
      changed();
    } catch (err) {
      toast("Не удалось открыть картинку. Попробуйте другую (JPG или PNG).", true);
    }
  });
  function addItem(type) {
    const W = design.widthMm, H = design.heightMm;
    let it;
    if (type === "image") { pickImage(null); return; }
    if (type === "text") {
      const size = clamp(Math.round(Math.min(H * 0.2, 8) / 0.3528), 8, 48);
      it = { id: uid(), type: "text", x: 2, y: 0, w: r1(W - 4), text: "Текст", size, bold: false, align: "center", font: "sans", invert: false };
      it.y = r1(Math.max(0, (H - LabelRender.measureText(it, dpmm())) / 2));
    } else if (type === "qr") {
      const s = Math.min(30, Math.min(W, H) - 6);
      it = { id: uid(), type: "qr", x: r1((W - s) / 2), y: r1((H - s) / 2), w: r1(s), text: "https://example.com", ecc: "M" };
    } else if (type === "barcode") {
      const w = W - 6, bh = Math.min(18, H * 0.45);
      it = { id: uid(), type: "barcode", x: 3, y: r1((H - bh) / 2), w: r1(w), h: r1(bh), text: "12345678", format: "code128", showText: true };
    }
    design.items.push(it);
    select(it.id);
    changed();
  }
  $$("[data-add]").forEach((b) => b.addEventListener("click", () => addItem(b.dataset.add)));

  /* ---------- размер наклейки ---------- */
  const sizeSel = $("#sizePreset");
  function fillSizes() {
    sizeSel.textContent = "";
    let found = false;
    for (const [w, hh] of PRESETS) {
      const on = w === design.widthMm && hh === design.heightMm;
      if (on) found = true;
      sizeSel.append(h("option", { value: w + "x" + hh, selected: on ? "selected" : null }, w + " × " + hh + " мм"));
    }
    sizeSel.append(h("option", { value: "custom", selected: found ? null : "selected" }, found ? "Свой размер…" : "Свой: " + design.widthMm + " × " + design.heightMm + " мм"));
    $("#customSize").hidden = found;
    $("#labelW").value = design.widthMm;
    $("#labelH").value = design.heightMm;
  }
  function resizeLabel(w, hh) {
    w = clamp(r1(w), 10, 120); hh = clamp(r1(hh), 10, 300);
    const sx = w / design.widthMm, sy = hh / design.heightMm, s = Math.min(sx, sy);
    for (const it of design.items) {
      it.x = r1(it.x * sx); it.y = r1(it.y * sy);
      if (it.type === "text") { it.w = r1(it.w * sx); it.size = Math.max(5, Math.round(it.size * s)); }
      else if (it.type === "qr") it.w = r1(it.w * s);
      else if (it.type === "image") { it.w = r1(it.w * s); it.h = r1(it.h * s); }
      else if (it.type === "barcode") { it.w = r1(it.w * sx); it.h = r1(it.h * sy); }
    }
    design.widthMm = w; design.heightMm = hh;
    buildProps();
    changed();
  }
  sizeSel.addEventListener("change", () => {
    if (sizeSel.value === "custom") { $("#customSize").hidden = false; $("#labelW").focus(); return; }
    const [w, hh] = sizeSel.value.split("x").map(Number);
    resizeLabel(w, hh);
    fillSizes();
  });
  const customChange = () => {
    const w = parseFloat($("#labelW").value), hh = parseFloat($("#labelH").value);
    if (w >= 10 && hh >= 10) resizeLabel(w, hh);
  };
  $("#labelW").addEventListener("change", customChange);
  $("#labelH").addEventListener("change", customChange);
  $("#borderToggle").addEventListener("change", (e) => { design.border = e.target.checked; changed(); });

  /* ---------- печать ---------- */
  function errText(e) {
    const m = e && e.message;
    if (m === "NO_WEBUSB") return "Этот браузер не умеет печатать по USB. Откройте сайт в Google Chrome на Android.";
    if (m === "NOT_PRINTER") return "Это устройство не похоже на принтер. Выберите принтер.";
    if (m === "BUSY") return "Принтер занят другим приложением. Закройте его и переподключите кабель.";
    if (m === "NOT_CONNECTED") return "Принтер не подключён.";
    if (m === "BUSY_PRINTING") return "Подождите, идёт печать.";
    if (e && e.name === "NotFoundError") return null; // выбор отменён
    if (e && e.name === "SecurityError") return "Нет доступа к USB. Откройте сайт по ссылке https:// в Google Chrome.";
    if (e && e.name === "NetworkError") return "Связь с принтером потеряна. Переподключите кабель.";
    return "Ошибка печати: " + (m || e);
  }
  async function connect() {
    if (!UsbPrinter.supported()) { toast(errText(new Error("NO_WEBUSB")), true); return false; }
    try {
      await printer.request();
      toast("Принтер подключён: " + printer.name);
      return true;
    } catch (e) {
      const t = errText(e);
      if (t) toast(t, true);
      return false;
    }
  }
  function cropWidth(r, maxW) {
    if (r.width <= maxW) return r;
    const off = Math.floor((r.width - maxW) / 2);
    const bits = new Uint8Array(maxW * r.height);
    for (let y = 0; y < r.height; y++) bits.set(r.bits.subarray(y * r.width + off, y * r.width + off + maxW), y * maxW);
    return { width: maxW, height: r.height, bits };
  }
  function buildJob(d, copies) {
    const r = LabelRender.render(d, { dpmm: dpmm(), offsetXmm: +settings.offX || 0, offsetYmm: +settings.offY || 0, rotate180: !!settings.rotate, getImage });
    if (settings.lang === "escpos") {
      const head = (+settings.paper === 80 ? 72 : 48) * dpmm();
      if (r.width > head) toast("Наклейка шире, чем печатает принтер (" + (+settings.paper === 80 ? 72 : 48) + " мм) — края обрежутся", true);
      return PrinterProto.buildESCPOS(cropWidth(r, head), { copies, feedLines: settings.feedLines, cut: settings.cut, invert: settings.invert });
    }
    return PrinterProto.buildTSPL(r, {
      widthMm: d.widthMm, heightMm: d.heightMm, gapMm: +settings.gapMm || 0, density: +settings.density,
      speed: settings.speed ? +settings.speed : null, copies, invert: settings.invert,
    });
  }
  async function send(bytes, okMsg) {
    const btn = $("#printBtn");
    btn.classList.add("busy");
    btn.textContent = "Печатаю…";
    try {
      await printer.write(bytes);
      toast(okMsg);
      return true;
    } catch (e) {
      toast(errText(e), true);
      return false;
    } finally {
      btn.classList.remove("busy");
      updateStatus();
    }
  }
  async function printDesign(d, copies) {
    if (!printer.connected && !(await connect())) return;
    await preloadImages(d);
    const bytes = buildJob(d, copies);
    await send(bytes, copies > 1 ? "Отправлено на печать: " + copies + " шт." : "Отправлено на печать");
  }
  $("#printBtn").addEventListener("click", () => {
    if (!printer.connected) { connect(); return; }
    printDesign(design, getCopies());
  });
  function getCopies() { return clamp(parseInt($("#copies").value, 10) || 1, 1, 999); }
  $("#copiesMinus").addEventListener("click", () => { $("#copies").value = Math.max(1, getCopies() - 1); });
  $("#copiesPlus").addEventListener("click", () => { $("#copies").value = Math.min(999, getCopies() + 1); });
  $("#copies").addEventListener("change", () => { $("#copies").value = getCopies(); });

  function testDesign() {
    const W = design.widthMm, H = design.heightMm;
    const q = Math.max(8, Math.min(H - 10, W * 0.4, 24));
    return {
      widthMm: W, heightMm: H, border: true,
      items: [
        { id: "t1", type: "text", x: 2, y: 2.4, w: W - 4, text: "↑ верх", size: Math.max(6, Math.round(Math.min(H * 0.1, 3.2) / 0.3528)), bold: true, align: "center", font: "sans" },
        { id: "t2", type: "text", x: 3, y: H / 2 - q / 2, w: W - q - 8, text: "Тест печати\n" + W + " × " + H + " мм", size: Math.max(6, Math.round(Math.min(H * 0.12, 4.2) / 0.3528)), bold: false, align: "left", font: "sans" },
        { id: "q1", type: "qr", x: W - q - 3, y: H / 2 - q / 2, w: q, text: "Мое_наклейки " + VERSION, ecc: "M" },
      ],
    };
  }

  /* ---------- статус ---------- */
  function updateStatus() {
    const on = printer.connected;
    $("#statusChip").classList.toggle("on", on);
    $("#statusText").textContent = on ? (printer.device.productName || printer.name) : "Нет принтера";
    $("#printerName").textContent = on ? printer.name : "Не подключён";
    $("#printerSub").textContent = on
      ? "Готов к печати по USB"
      : UsbPrinter.supported() ? "Подключите принтер кабелем через переходник OTG" : "Нужен Google Chrome на Android";
    $("#connectBtn").textContent = on ? "Отключить" : "Подключить";
    const pb = $("#printBtn");
    if (!pb.classList.contains("busy")) pb.textContent = on ? "Печать" : "Подключить принтер";
  }
  printer.onchange = updateStatus;
  $("#statusChip").addEventListener("click", () => { if (printer.connected) showPage("settings"); else connect(); });
  $("#connectBtn").addEventListener("click", async () => {
    if (printer.connected) { await printer.disconnect(); toast("Принтер отключён"); }
    else await connect();
  });
  $("#testPrint").addEventListener("click", () => printDesign(testDesign(), 1));
  $("#feedBtn").addEventListener("click", async () => {
    if (!printer.connected && !(await connect())) return;
    const bytes = settings.lang === "escpos"
      ? PrinterProto.buildESCPOSFeed({ feedLines: settings.feedLines || 4 })
      : PrinterProto.buildTSPLFeed({ widthMm: design.widthMm, heightMm: design.heightMm, gapMm: +settings.gapMm || 0 });
    await send(bytes, "Готово");
  });

  /* ---------- настройки ---------- */
  function applyTheme() {
    const t = settings.theme;
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("mn_theme", t); } catch (e) { /* ничего */ }
    $$("#themeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.theme === t));
  }
  function bindSettings() {
    const bind = (id, key, type) => {
      const el = $(id);
      if (type === "check") el.checked = !!settings[key];
      else el.value = settings[key];
      el.addEventListener(type === "check" ? "change" : "input", () => {
        let v = type === "check" ? el.checked : el.value;
        if (type === "num") v = parseFloat(v) || 0;
        settings[key] = v;
        saveSettings();
        if (key === "lang") document.body.dataset.lang = v;
        if (key === "dpi") { scheduleRender(); }
        if (key === "density") $("#densityVal").textContent = v;
      });
    };
    bind("#setLang", "lang");
    bind("#setDpi", "dpi");
    bind("#setDensity", "density", "num");
    bind("#setSpeed", "speed");
    bind("#setGap", "gapMm", "num");
    bind("#setPaper", "paper");
    bind("#setFeed", "feedLines", "num");
    bind("#setCut", "cut", "check");
    bind("#setOffX", "offX", "num");
    bind("#setOffY", "offY", "num");
    bind("#setRotate", "rotate", "check");
    bind("#setInvert", "invert", "check");
    $("#densityVal").textContent = settings.density;
    document.body.dataset.lang = settings.lang;
    $$("#themeSeg button").forEach((b) => b.addEventListener("click", () => { settings.theme = b.dataset.theme; saveSettings(); applyTheme(); }));
    applyTheme();
  }

  /* ---------- шаблоны ---------- */
  function thumbOf(d) {
    const r = LabelRender.render(d, { dpmm: dpmm(), getImage });
    const max = 260;
    const s = Math.min(1, max / Math.max(r.width, r.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(r.width * s));
    c.height = Math.max(1, Math.round(r.height * s));
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(r.canvas, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  }
  const EXAMPLES = [
    () => ({
      name: "Ценник", design: {
        widthMm: 58, heightMm: 40, border: false, items: [
          { id: uid(), type: "text", x: 2, y: 2, w: 54, text: "Название товара", size: 12, bold: true, align: "center", font: "sans", invert: false },
          { id: uid(), type: "text", x: 2, y: 8, w: 54, text: "1 990 ₸", size: 30, bold: true, align: "center", font: "sans", invert: false },
          { id: uid(), type: "barcode", x: 4, y: 22.5, w: 50, h: 15, text: "487000123456", format: "ean13", showText: true },
        ],
      },
    }),
    () => ({
      name: "QR со ссылкой", design: {
        widthMm: 40, heightMm: 30, border: false, items: [
          { id: uid(), type: "qr", x: 1.5, y: 3, w: 24, text: "https://example.com", ecc: "M" },
          { id: uid(), type: "text", x: 25.5, y: 8, w: 13.5, text: "Наведи камеру", size: 8, bold: true, align: "left", font: "sans", invert: false },
        ],
      },
    }),
    () => ({
      name: "Подпись на банку", design: {
        widthMm: 50, heightMm: 30, border: true, items: [
          { id: uid(), type: "text", x: 3, y: 6, w: 44, text: "Малиновое варенье", size: 15, bold: true, align: "center", font: "serif", invert: false },
          { id: uid(), type: "text", x: 3, y: 20, w: 44, text: "июль 2026", size: 9, bold: false, align: "center", font: "sans", invert: false },
        ],
      },
    }),
  ];
  function openDesign(d) {
    design = clone(d);
    for (const it of design.items) it.id = it.id || uid();
    selectedId = null;
    fillSizes();
    $("#borderToggle").checked = !!design.border;
    select(null);
    changed();
    showPage("label");
  }
  function tplCard(name, d, thumb, onDel) {
    const card = h("div", { class: "tpl" },
      h("button", { type: "button", class: "thumb", "aria-label": "Открыть «" + name + "»", onclick: () => { openDesign(d); toast("Открыто: " + name); } },
        h("img", { src: thumb, alt: "" })),
      h("div", { class: "meta" },
        h("div", null, h("div", { class: "name" }, name), h("div", { class: "size" }, d.widthMm + " × " + d.heightMm + " мм")),
        onDel ? h("button", { type: "button", class: "del", "aria-label": "Удалить шаблон", onclick: onDel, html: '<svg viewBox="0 0 24 24"><path d="' + IC.trash + '"/></svg>' }) : null));
    return card;
  }
  function renderTemplates() {
    const list = $("#tplList");
    list.textContent = "";
    if (!templates.length) list.append(h("div", { class: "empty" }, "Здесь появятся сохранённые наклейки"));
    templates.forEach((t, i) => list.append(tplCard(t.name, t.design, t.thumb, () => {
      if (!confirm("Удалить шаблон «" + t.name + "»?")) return;
      templates.splice(i, 1);
      store.set("mn_templates", templates);
      renderTemplates();
    })));
    const ex = $("#exampleList");
    ex.textContent = "";
    for (const mk of EXAMPLES) { const e = mk(); ex.append(tplCard(e.name, e.design, thumbOf(e.design), null)); }
  }
  $("#tplSave").addEventListener("click", async () => {
    const name = $("#tplName").value.trim() || "Наклейка " + (templates.length + 1);
    await preloadImages(design);
    templates.unshift({ id: uid(), name, design: clone(design), thumb: thumbOf(design), created: Date.now() });
    if (!store.set("mn_templates", templates)) {
      templates.shift();
      toast("Не хватает места — удалите старые шаблоны или уменьшите картинки", true);
      return;
    }
    $("#tplName").value = "";
    renderTemplates();
    toast("Шаблон сохранён");
  });
  $("#newLabel").addEventListener("click", () => {
    openDesign({ widthMm: design.widthMm, heightMm: design.heightMm, border: false, items: [] });
  });
  $("#downloadPng").addEventListener("click", async () => {
    await preloadImages(design);
    const r = LabelRender.render(design, { dpmm: dpmm(), getImage });
    r.canvas.toBlob((b) => {
      const a = h("a", { href: URL.createObjectURL(b), download: "nakleyka_" + design.widthMm + "x" + design.heightMm + ".png" });
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }, "image/png");
  });

  /* ---------- страницы ---------- */
  function showPage(name) {
    document.body.dataset.page = name;
    $$(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + name));
    $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.page === name));
    if (name === "templates") renderTemplates();
    if (name === "label") requestAnimationFrame(renderPreview);
    window.scrollTo(0, 0);
  }
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => showPage(b.dataset.page)));

  /* ---------- «Поделиться» из других приложений ---------- */
  async function takeShared() {
    const params = new URLSearchParams(location.search);
    if (!params.has("shared")) return;
    history.replaceState(null, "", location.pathname);
    try {
      const cache = await caches.open("mn-share");
      const metaRes = await cache.match("shared-meta");
      const fileRes = await cache.match("shared-file");
      const meta = metaRes ? await metaRes.json() : {};
      const blob = fileRes ? await fileRes.blob() : null;
      await cache.delete("shared-meta");
      await cache.delete("shared-file");
      const text = [meta.title, meta.text].filter(Boolean).join("\n").trim();
      const urlMatch = (meta.url || "") || (text.match(/https?:\/\/\S+/) || [""])[0];
      if (!blob && !text && !urlMatch) return;
      if (design.items.length) {
        templates.unshift({ id: uid(), name: "Черновик " + new Date().toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }), design: clone(design), thumb: thumbOf(design), created: Date.now() });
        store.set("mn_templates", templates);
      }
      design = { widthMm: design.widthMm, heightMm: design.heightMm, border: false, items: [] };
      const W = design.widthMm, H = design.heightMm;
      if (blob) {
        addImageItem(await shrinkImage(blob), { margin: 1 });
      } else if (urlMatch) {
        const s = Math.min(W, H) - 4;
        design.items.push({ id: uid(), type: "qr", x: r1((W - s) / 2), y: 2, w: r1(s), text: urlMatch, ecc: "M" });
      } else {
        const it = { id: uid(), type: "text", x: 2, y: 2, w: W - 4, text, size: clamp(Math.round(Math.min(H * 0.15, 6) / 0.3528), 7, 30), bold: false, align: "center", font: "sans", invert: false };
        it.y = r1(Math.max(1, (H - LabelRender.measureText(it, dpmm())) / 2));
        design.items.push(it);
      }
      fillSizes();
      select(design.items[0] ? design.items[0].id : null);
      changed();
      toast("Получено — проверьте и нажмите «Печать»");
    } catch (e) {
      toast("Не удалось принять файл", true);
    }
  }

  /* ---------- запуск ---------- */
  $("#verLabel").textContent = "v" + VERSION;
  $("#aboutVer").textContent = "версия " + VERSION;
  $("#changelog").textContent = CHANGELOG;
  bindSettings();
  fillSizes();
  $("#borderToggle").checked = !!design.border;
  showPage("label");
  select(null);
  updateStatus();
  window.addEventListener("resize", () => { layoutPaper(); });
  if (UsbPrinter.supported()) printer.reconnect().then(updateStatus).catch(() => {});
  takeShared();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  window.__mn = { get design() { return design; }, settings, printer, buildJob, render: () => renderPreview() };
})();
