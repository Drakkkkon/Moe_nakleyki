/* Мое_наклейки — отрисовка наклейки в чёрно-белую картинку для термопринтера. */
(function (g) {
  "use strict";

  const FONTS = {
    sans: "Roboto, 'Noto Sans', Arial, sans-serif",
    serif: "'Noto Serif', Georgia, 'Times New Roman', serif",
    mono: "'Roboto Mono', 'Droid Sans Mono', 'Courier New', monospace",
    narrow: "'Roboto Condensed', 'Arial Narrow', sans-serif-condensed, sans-serif",
  };
  const PT_MM = 0.3528;

  function utf8(s) { return unescape(encodeURIComponent(s)); }

  /* ---------- кэши ---------- */
  const qrCache = new Map();
  function qrMatrix(text, ecc) {
    const key = ecc + "|" + text;
    if (qrCache.has(key)) return qrCache.get(key);
    let res;
    try {
      const q = new g.QRCodeLib.QRCode(-1, g.QRCodeLib.ECL[ecc] ?? g.QRCodeLib.ECL.M);
      q.addData(utf8(text));
      q.make();
      const n = q.getModuleCount();
      const m = new Uint8Array(n * n);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) m[r * n + c] = q.isDark(r, c) ? 1 : 0;
      res = { n, m };
    } catch (e) {
      res = { error: "Слишком много текста для QR-кода" };
    }
    if (qrCache.size > 50) qrCache.clear();
    qrCache.set(key, res);
    return res;
  }

  const bcCache = new Map();
  function barcodeData(format, text) {
    const key = format + "|" + text;
    if (bcCache.has(key)) return bcCache.get(key);
    let res;
    try { res = g.Barcode.encode(format, text); } catch (e) { res = { error: e.message }; }
    if (bcCache.size > 50) bcCache.clear();
    bcCache.set(key, res);
    return res;
  }

  const ditherCache = new Map();

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
  }

  /* Растрирование картинки: mode "photo" — точками (Аткинсон), "bw" — по порогу. level −100..100 */
  function ditherImage(img, wPx, hPx, mode, level) {
    const c = makeCanvas(wPx, hPx);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, wPx, hPx);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, wPx, hPx);
    const id = ctx.getImageData(0, 0, wPx, hPx);
    const d = id.data;
    const n = wPx * hPx;
    const gray = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = d[i * 4 + 3] / 255;
      const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      gray[i] = l * a + 255 * (1 - a);
    }
    if (mode === "bw") {
      // level > 0 — светлее (меньше чёрного)
      const thr = 128 - (level || 0) * 1.2;
      for (let i = 0; i < n; i++) gray[i] = gray[i] < thr ? 0 : 255;
    } else {
      // яркость + лёгкий контраст, затем Аткинсон — на термобумаге выглядит чище Флойда—Стейнберга
      const shift = (level || 0) * 1.1;
      for (let i = 0; i < n; i++) {
        let v = (gray[i] - 128) * 1.15 + 128 + shift;
        gray[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      for (let y = 0; y < hPx; y++) {
        for (let x = 0; x < wPx; x++) {
          const i = y * wPx + x;
          const old = gray[i];
          const nv = old < 128 ? 0 : 255;
          gray[i] = nv;
          const err = (old - nv) / 8;
          if (x + 1 < wPx) gray[i + 1] += err;
          if (x + 2 < wPx) gray[i + 2] += err;
          if (y + 1 < hPx) {
            if (x > 0) gray[i + wPx - 1] += err;
            gray[i + wPx] += err;
            if (x + 1 < wPx) gray[i + wPx + 1] += err;
          }
          if (y + 2 < hPx) gray[i + 2 * wPx] += err;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const v = gray[i] < 128 ? 0 : 255;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  /* ---------- текст ---------- */
  function wrapText(ctx, text, maxW) {
    const out = [];
    for (const p of String(text).split("\n")) {
      const tokens = p.split(/(\s+)/).filter((t) => t !== "");
      let line = "";
      for (const t of tokens) {
        if (/^\s+$/.test(t)) { if (line) line += t; continue; }
        const test = line + t;
        if (ctx.measureText(test).width <= maxW) { line = test; continue; }
        if (line.trim()) { out.push(line.trimEnd()); line = ""; }
        if (ctx.measureText(t).width <= maxW) { line = t; continue; }
        // слово длиннее строки — режем по буквам
        let part = "";
        for (const ch of t) {
          if (part && ctx.measureText(part + ch).width > maxW) { out.push(part); part = ch; }
          else part += ch;
        }
        line = part;
      }
      out.push(line.trimEnd());
    }
    return out;
  }

  function textFont(item, px) {
    return (item.bold ? "700 " : "400 ") + px + "px " + (FONTS[item.font] || FONTS.sans);
  }

  /* ---------- основной рендер ----------
   * design: { widthMm, heightMm, border, items:[...] }
   * opt: { dpmm, offsetXmm, offsetYmm, rotate180, getImage(src) } */
  function render(design, opt) {
    const dpmm = opt.dpmm || 8;
    const W = Math.max(8, Math.round(design.widthMm * dpmm));
    const H = Math.max(8, Math.round(design.heightMm * dpmm));
    const canvas = opt.canvas || makeCanvas(W, H);
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate((opt.offsetXmm || 0) * dpmm, (opt.offsetYmm || 0) * dpmm);

    const boxes = {};
    const warnings = {};
    const P = (mm) => mm * dpmm;

    if (design.border) {
      const t = Math.max(2, Math.round(0.4 * dpmm));
      const inset = 1 * dpmm + t / 2;
      const r = 1.5 * dpmm;
      ctx.lineWidth = t;
      ctx.strokeStyle = "#000";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, r);
      else ctx.rect(inset, inset, W - inset * 2, H - inset * 2);
      ctx.stroke();
    }

    for (const it of design.items) {
      const x = P(it.x), y = P(it.y), w = P(it.w);
      if (it.type === "text") {
        const px = Math.max(4, it.size * PT_MM * dpmm);
        ctx.font = textFont(it, px);
        const lines = wrapText(ctx, it.text || "", w);
        const lh = px * 1.18;
        const h = Math.max(lh, lines.length * lh);
        boxes[it.id] = { x: it.x, y: it.y, w: it.w, h: h / dpmm };
        const pad = it.invert ? Math.round(0.8 * dpmm) : 0;
        if (it.invert) {
          ctx.fillStyle = "#000";
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x - pad, y - pad, w + pad * 2, h + pad * 2, pad);
          else ctx.rect(x - pad, y - pad, w + pad * 2, h + pad * 2);
          ctx.fill();
        }
        ctx.fillStyle = it.invert ? "#fff" : "#000";
        ctx.textBaseline = "middle";
        ctx.textAlign = it.align || "left";
        const tx = it.align === "center" ? x + w / 2 : it.align === "right" ? x + w : x;
        lines.forEach((ln, i) => ctx.fillText(ln, tx, y + lh * i + lh / 2));
      } else if (it.type === "image") {
        const h = P(it.h);
        boxes[it.id] = { x: it.x, y: it.y, w: it.w, h: it.h };
        const img = opt.getImage ? opt.getImage(it.src) : null;
        const wPx = Math.max(1, Math.round(w)), hPx = Math.max(1, Math.round(h));
        if (img) {
          const key = it.src.length + "|" + it.src.slice(-32) + "|" + wPx + "x" + hPx + "|" + it.mode + "|" + it.level;
          let dc = ditherCache.get(key);
          if (!dc) {
            dc = ditherImage(img, wPx, hPx, it.mode, it.level);
            if (ditherCache.size > 30) ditherCache.clear();
            ditherCache.set(key, dc);
          }
          ctx.drawImage(dc, Math.round(x), Math.round(y));
        } else {
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          ctx.setLineDash([]);
        }
      } else if (it.type === "qr") {
        const size = w;
        boxes[it.id] = { x: it.x, y: it.y, w: it.w, h: it.w };
        const q = qrMatrix(it.text || " ", it.ecc || "M");
        if (q.error) { warnings[it.id] = q.error; continue; }
        const quiet = 1;
        const mod = Math.floor(size / (q.n + quiet * 2));
        if (mod < 1) { warnings[it.id] = "QR-код слишком маленький — увеличьте его"; continue; }
        if (mod < 2) warnings[it.id] = "QR-код мелковат, сканер может его не прочитать — увеличьте";
        const total = mod * q.n;
        const ox = Math.round(x + (size - total) / 2), oy = Math.round(y + (size - total) / 2);
        ctx.fillStyle = "#000";
        for (let r = 0; r < q.n; r++) {
          for (let c = 0; c < q.n; c++) {
            if (q.m[r * q.n + c]) ctx.fillRect(ox + c * mod, oy + r * mod, mod, mod);
          }
        }
      } else if (it.type === "barcode") {
        const h = P(it.h);
        boxes[it.id] = { x: it.x, y: it.y, w: it.w, h: it.h };
        const b = barcodeData(it.format || "code128", it.text || "");
        if (b.error) { warnings[it.id] = b.error; continue; }
        const totalMods = b.quietLeft + b.modules.length + b.quietRight;
        const mod = Math.floor(w / totalMods);
        if (mod < 1) { warnings[it.id] = "Штрихкод не помещается — сделайте его шире или текст короче"; continue; }
        if (mod < 2 && dpmm < 10) warnings[it.id] = "Штрихкод узковат, сканер может его не прочитать — сделайте шире";
        const textPx = it.showText ? Math.max(10, Math.min(h * 0.28, 3.2 * dpmm)) : 0;
        const barsH = Math.max(4, Math.round(h - (it.showText ? textPx * 1.15 : 0)));
        const ox = Math.round(x + (w - totalMods * mod) / 2 + b.quietLeft * mod);
        const oy = Math.round(y);
        ctx.fillStyle = "#000";
        let run = 0;
        for (let i = 0; i <= b.modules.length; i++) {
          if (i < b.modules.length && b.modules[i]) { run++; continue; }
          if (run) { ctx.fillRect(ox + (i - run) * mod, oy, run * mod, barsH); run = 0; }
        }
        if (it.showText) {
          ctx.font = "500 " + textPx + "px " + FONTS.sans;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          let label = b.text;
          if ((it.format || "code128") === "ean13") label = label[0] + " " + label.slice(1, 7) + " " + label.slice(7);
          ctx.fillText(label, ox + (b.modules.length * mod) / 2, oy + barsH + textPx * 0.12);
        }
      }
    }
    ctx.restore();

    // перевод в чистый ч/б (1 = чёрная точка)
    let src = canvas;
    if (opt.rotate180) {
      const r = makeCanvas(W, H);
      const rc = r.getContext("2d");
      rc.translate(W, H);
      rc.rotate(Math.PI);
      rc.drawImage(canvas, 0, 0);
      src = r;
    }
    const sctx = src.getContext("2d", { willReadFrequently: true });
    const id = sctx.getImageData(0, 0, W, H);
    const d = id.data;
    const bits = new Uint8Array(W * H);
    for (let i = 0, p = 0; i < bits.length; i++, p += 4) {
      const l = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
      const black = l < 128;
      bits[i] = black ? 1 : 0;
      const v = black ? 0 : 255;
      d[p] = d[p + 1] = d[p + 2] = v;
      d[p + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return { canvas, width: W, height: H, bits, boxes, warnings };
  }

  /* Размер текстового блока без полной отрисовки (для новых элементов) */
  function measureText(item, dpmm) {
    const c = makeCanvas(4, 4).getContext("2d");
    const px = Math.max(4, item.size * PT_MM * dpmm);
    c.font = textFont(item, px);
    const lines = wrapText(c, item.text || "", item.w * dpmm);
    return (lines.length * px * 1.18) / dpmm;
  }

  g.LabelRender = { render, measureText, FONTS };
})(typeof window !== "undefined" ? window : globalThis);
