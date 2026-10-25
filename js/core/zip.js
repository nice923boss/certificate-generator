// Minimal ZIP support without external libraries: writing uses the "store"
// method (PDF / PNG / JPG are already compressed); reading handles stored and
// deflated entries, which is all an .xlsx file needs.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.Cert = root.Cert || {}).zip = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  const UTF8_FLAG = 0x0800;
  const LIMIT = 0xffffffff;

  // files: [{ name, data: Uint8Array }] -> Uint8Array of a .zip archive.
  function createZip(files, now = new Date()) {
    if (files.length > 0xffff) throw new Error('檔案數超過 ZIP 上限 65535');
    const encoder = new TextEncoder();
    const stamp = dosDateTime(now);
    const entries = files.map((f) => ({ name: encoder.encode(f.name), data: f.data, crc: crc32(f.data) }));
    const localSize = entries.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0);
    const centralSize = entries.reduce((sum, e) => sum + 46 + e.name.length, 0);
    if (localSize + centralSize + 22 > LIMIT) throw new Error('檔案總大小超過 4 GB，請縮小匯出範圍');

    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    let p = 0;
    const u16 = (v) => {
      view.setUint16(p, v, true);
      p += 2;
    };
    const u32 = (v) => {
      view.setUint32(p, v, true);
      p += 4;
    };
    const bytes = (b) => {
      out.set(b, p);
      p += b.length;
    };

    const offsets = [];
    entries.forEach((e) => {
      offsets.push(p);
      u32(0x04034b50);
      u16(20);
      u16(UTF8_FLAG);
      u16(0);
      u16(stamp.time);
      u16(stamp.date);
      u32(e.crc);
      u32(e.data.length);
      u32(e.data.length);
      u16(e.name.length);
      u16(0);
      bytes(e.name);
      bytes(e.data);
    });
    const centralStart = p;
    entries.forEach((e, i) => {
      u32(0x02014b50);
      u16(20);
      u16(20);
      u16(UTF8_FLAG);
      u16(0);
      u16(stamp.time);
      u16(stamp.date);
      u32(e.crc);
      u32(e.data.length);
      u32(e.data.length);
      u16(e.name.length);
      u16(0);
      u16(0);
      u16(0);
      u16(0);
      u32(0);
      u32(offsets[i]);
      bytes(e.name);
    });
    u32(0x06054b50);
    u16(0);
    u16(0);
    u16(entries.length);
    u16(entries.length);
    u32(centralSize);
    u32(centralStart);
    u16(0);
    return out;
  }

  // Lists entries from the central directory; data is still compressed.
  function readZip(input) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP 檔案');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder('utf-8');
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 目錄損毀');
      const method = view.getUint16(p + 10, true);
      const crc = view.getUint32(p + 16, true);
      const compressedSize = view.getUint32(p + 20, true);
      const size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = decoder.decode(b.subarray(p + 46, p + 46 + nameLen));
      const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      entries.push({ name, method, crc, size, data: b.subarray(dataStart, dataStart + compressedSize) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream !== 'function') throw new Error('此瀏覽器不支援解壓縮，請改用 Chrome、Edge 或新版 Firefox／Safari');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function extract(entry) {
    if (entry.method === 0) return entry.data;
    if (entry.method === 8) return inflateRaw(entry.data);
    throw new Error(`不支援的壓縮方式 ${entry.method}`);
  }

  return { crc32, createZip, readZip, extract };
});
