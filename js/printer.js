/* Мое_наклейки — связь с принтером по USB (WebUSB) и команды печати.
 * TSPL — язык этикеточных принтеров Xprinter (XP-365B, XP-420B, XP-470B и др.).
 * ESC/POS — язык чековых принтеров (XP-58, XP-80 и др.). */
(function (g) {
  "use strict";

  const ascii = (s) => {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  };

  function concat(parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  const num = (v) => String(Math.round(v * 10) / 10);

  /* Упаковка картинки в байты: bitmap.bits — по одному байту на точку (1 = чёрная).
   * blackBit — каким битом обозначается чёрная точка (в TSPL обычно 0, в ESC/POS — 1). */
  function packRows(bitmap, blackBit, y0, rows) {
    const w = bitmap.width;
    const wBytes = Math.ceil(w / 8);
    const out = new Uint8Array(wBytes * rows);
    const whiteByte = blackBit ? 0x00 : 0xff;
    out.fill(whiteByte);
    for (let y = 0; y < rows; y++) {
      const row = (y0 + y) * w;
      const base = y * wBytes;
      for (let x = 0; x < w; x++) {
        if (bitmap.bits[row + x]) {
          const mask = 0x80 >> (x & 7);
          if (blackBit) out[base + (x >> 3)] |= mask;
          else out[base + (x >> 3)] &= ~mask;
        }
      }
    }
    return out;
  }

  /* Команды TSPL для одной наклейки. opt: widthMm, heightMm, gapMm, density, speed, copies, invert */
  function buildTSPL(bitmap, opt) {
    const wBytes = Math.ceil(bitmap.width / 8);
    const lines = [];
    lines.push("SIZE " + num(opt.widthMm) + " mm," + num(opt.heightMm) + " mm");
    if (opt.gapMm > 0) lines.push("GAP " + num(opt.gapMm) + " mm,0 mm");
    else lines.push("GAP 0,0");
    lines.push("DIRECTION 0");
    lines.push("REFERENCE 0,0");
    if (opt.density != null) lines.push("DENSITY " + Math.max(0, Math.min(15, Math.round(opt.density))));
    if (opt.speed) lines.push("SPEED " + opt.speed);
    lines.push("CLS");
    const head = ascii(lines.join("\r\n") + "\r\nBITMAP 0,0," + wBytes + "," + bitmap.height + ",0,");
    // В TSPL бит 1 — белая точка, 0 — чёрная. «invert» меняет это для редких принтеров.
    const data = packRows(bitmap, opt.invert ? 1 : 0, 0, bitmap.height);
    const tail = ascii("\r\nPRINT " + Math.max(1, opt.copies | 0) + ",1\r\n");
    return concat([head, data, tail]);
  }

  function buildTSPLFeed(opt) {
    const lines = [];
    if (opt.widthMm && opt.heightMm) lines.push("SIZE " + num(opt.widthMm) + " mm," + num(opt.heightMm) + " mm");
    if (opt.gapMm > 0) lines.push("GAP " + num(opt.gapMm) + " mm,0 mm");
    else lines.push("GAP 0,0");
    lines.push("FORMFEED");
    return ascii(lines.join("\r\n") + "\r\n");
  }

  /* Команды ESC/POS. opt: copies, feedLines, cut, invert */
  function buildESCPOS(bitmap, opt) {
    const parts = [];
    const wBytes = Math.ceil(bitmap.width / 8);
    const copies = Math.max(1, opt.copies | 0);
    for (let c = 0; c < copies; c++) {
      parts.push(Uint8Array.of(0x1b, 0x40)); // ESC @ — сброс
      parts.push(Uint8Array.of(0x1b, 0x61, 0x01)); // ESC a 1 — по центру
      const BAND = 128;
      for (let y = 0; y < bitmap.height; y += BAND) {
        const rows = Math.min(BAND, bitmap.height - y);
        parts.push(Uint8Array.of(0x1d, 0x76, 0x30, 0x00, wBytes & 0xff, (wBytes >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff));
        parts.push(packRows(bitmap, opt.invert ? 0 : 1, y, rows));
      }
      const feed = Math.max(0, Math.min(255, opt.feedLines | 0));
      if (feed) parts.push(Uint8Array.of(0x1b, 0x64, feed)); // ESC d n — промотка
      if (opt.cut) parts.push(Uint8Array.of(0x1d, 0x56, 0x42, 0x00)); // GS V 66 0 — отрезать
    }
    return concat(parts);
  }

  function buildESCPOSFeed(opt) {
    return Uint8Array.of(0x1b, 0x40, 0x1b, 0x64, Math.max(1, Math.min(255, opt.feedLines | 0 || 4)));
  }

  /* ---------- WebUSB ---------- */
  class UsbPrinter {
    constructor() {
      this.device = null;
      this.epOut = null;
      this.ifaceNum = null;
      this.onchange = null;
      this.busy = false;
      if (UsbPrinter.supported()) {
        navigator.usb.addEventListener("disconnect", (e) => {
          if (this.device && e.device === this.device) {
            this.device = null;
            this.epOut = null;
            this._emit();
          }
        });
        navigator.usb.addEventListener("connect", () => {
          if (!this.device) this.reconnect().catch(() => {});
        });
      }
    }

    static supported() {
      return typeof navigator !== "undefined" && !!navigator.usb;
    }

    get connected() { return !!(this.device && this.device.opened && this.epOut != null); }

    get name() {
      if (!this.device) return "";
      const d = this.device;
      const n = [d.manufacturerName, d.productName].filter(Boolean).join(" ").trim();
      return n || "USB-принтер";
    }

    _emit() { if (this.onchange) this.onchange(this); }

    async request() {
      if (!UsbPrinter.supported()) throw new Error("NO_WEBUSB");
      const d = await navigator.usb.requestDevice({ filters: [] });
      await this.open(d);
    }

    async reconnect() {
      if (!UsbPrinter.supported()) return false;
      const list = await navigator.usb.getDevices();
      if (!list.length) return false;
      // сначала принтеры (класс 7), потом остальные
      list.sort((a, b) => UsbPrinter._score(b) - UsbPrinter._score(a));
      for (const d of list) {
        try { await this.open(d); return true; } catch (e) { /* пробуем следующее */ }
      }
      return false;
    }

    static _score(d) {
      try {
        for (const cfg of d.configurations) for (const i of cfg.interfaces) for (const a of i.alternates) {
          if (a.interfaceClass === 7) return 2;
        }
      } catch (e) { /* нет данных */ }
      return 0;
    }

    async open(d) {
      if (!d.opened) await d.open();
      if (d.configuration === null) await d.selectConfiguration(1);
      let best = null;
      for (const iface of d.configuration.interfaces) {
        for (const alt of iface.alternates) {
          const out = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
          if (!out) continue;
          const score = alt.interfaceClass === 7 ? 3 : alt.interfaceClass === 255 ? 2 : 1;
          if (!best || score > best.score) best = { iface, alt, out, score };
        }
      }
      if (!best) {
        try { await d.close(); } catch (e) { /* ничего */ }
        throw new Error("NOT_PRINTER");
      }
      try {
        await d.claimInterface(best.iface.interfaceNumber);
      } catch (e) {
        throw new Error("BUSY");
      }
      const cur = best.iface.alternate;
      if (best.iface.alternates.length > 1 && (!cur || cur.alternateSetting !== best.alt.alternateSetting)) {
        try { await d.selectAlternateInterface(best.iface.interfaceNumber, best.alt.alternateSetting); } catch (e) { /* не страшно */ }
      }
      this.device = d;
      this.epOut = best.out.endpointNumber;
      this.ifaceNum = best.iface.interfaceNumber;
      this._emit();
    }

    async disconnect() {
      const d = this.device;
      this.device = null;
      this.epOut = null;
      if (d) {
        try { await d.releaseInterface(this.ifaceNum); } catch (e) { /* ничего */ }
        try { await d.close(); } catch (e) { /* ничего */ }
        try { if (d.forget) await d.forget(); } catch (e) { /* ничего */ }
      }
      this._emit();
    }

    async write(bytes) {
      if (!this.connected) throw new Error("NOT_CONNECTED");
      if (this.busy) throw new Error("BUSY_PRINTING");
      this.busy = true;
      try {
        const CHUNK = 16384;
        for (let o = 0; o < bytes.length; o += CHUNK) {
          const part = bytes.subarray(o, Math.min(bytes.length, o + CHUNK));
          const r = await this.device.transferOut(this.epOut, part);
          if (r.status !== "ok") throw new Error("TRANSFER_" + r.status);
        }
      } finally {
        this.busy = false;
      }
    }
  }

  g.PrinterProto = { buildTSPL, buildTSPLFeed, buildESCPOS, buildESCPOSFeed, packRows };
  g.UsbPrinter = UsbPrinter;
})(typeof window !== "undefined" ? window : globalThis);
