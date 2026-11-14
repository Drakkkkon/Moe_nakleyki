/* Мое_граббер — простой ZIP без сжатия (фото и так сжаты), имена в UTF-8. Работает без интернета и без библиотек. */
(function () {
  'use strict';
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function ZipWriter() { this.files = []; this.names = {}; }
  // Уникальное имя внутри архива: «фото.jpg», «фото (2).jpg»…
  ZipWriter.prototype.uniq = function (path) {
    var key = path.toLowerCase();
    if (!this.names[key]) { this.names[key] = 1; return path; }
    var m = path.match(/^(.*?)(\.[^./]+)?$/), base = m[1], ext = m[2] || '', i = 2;
    while (this.names[(base + ' (' + i + ')' + ext).toLowerCase()]) i++;
    var p = base + ' (' + i + ')' + ext; this.names[p.toLowerCase()] = 1; return p;
  };
  ZipWriter.prototype.add = function (path, data) {
    var u8 = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    path = this.uniq(path);
    this.files.push({ name: new TextEncoder().encode(path), data: u8, crc: crc32(u8), when: dosTime(new Date()) });
    return path;
  };
  ZipWriter.prototype.blob = function () {
    var parts = [], central = [], offset = 0;
    this.files.forEach(function (f) {
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, f.when.time, true); h.setUint16(12, f.when.date, true); h.setUint32(14, f.crc, true);
      h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, f.name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, f.name, f.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, f.when.time, true); c.setUint16(14, f.when.date, true); c.setUint32(16, f.crc, true);
      c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, f.name.length, true);
      c.setUint32(42, offset, true);
      central.push(c.buffer, f.name);
      offset += 30 + f.name.length + f.data.length;
    });
    var csize = 0; central.forEach(function (b) { csize += b.byteLength; });
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, this.files.length, true); e.setUint16(10, this.files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [e.buffer]), { type: 'application/zip' });
  };
  window.ZipWriter = ZipWriter;
})();
