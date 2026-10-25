const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const zip = require('../js/core/zip.js');

const enc = (s) => new TextEncoder().encode(s);

test('crc32 matches known values', () => {
  assert.equal(zip.crc32(enc('')), 0);
  assert.equal(zip.crc32(enc('123456789')), 0xcbf43926);
  assert.equal(zip.crc32(enc('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

test('createZip round-trips through readZip with UTF-8 names', async () => {
  const files = [
    { name: '001_王小明.pdf', data: enc('%PDF-a') },
    { name: 'b.txt', data: new Uint8Array(0) },
  ];
  const archive = zip.createZip(files, new Date(2026, 9, 21, 13, 45, 30));
  const entries = zip.readZip(archive);
  assert.deepEqual(entries.map((e) => e.name), ['001_王小明.pdf', 'b.txt']);
  assert.equal(new TextDecoder().decode(await zip.extract(entries[0])), '%PDF-a');
  assert.equal(entries[0].crc, zip.crc32(enc('%PDF-a')));
  assert.equal((await zip.extract(entries[1])).length, 0);
});

test('the archive is valid for zlib-based tools (central directory size and EOCD)', () => {
  const archive = zip.createZip([{ name: 'a.txt', data: enc('hello') }]);
  const view = new DataView(archive.buffer);
  const eocd = archive.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdStart = view.getUint32(eocd + 16, true);
  assert.equal(cdStart + cdSize, eocd);
  // UTF-8 flag on the local header
  assert.equal(view.getUint16(6, true) & 0x0800, 0x0800);
});

test('extract inflates deflated entries', async () => {
  const raw = enc('壓縮測試'.repeat(50));
  const deflated = new Uint8Array(zlib.deflateRawSync(raw));
  const out = await zip.extract({ method: 8, data: deflated });
  assert.deepEqual(out, raw);
});

test('readZip rejects non-zip data', () => {
  assert.throws(() => zip.readZip(enc('not a zip file at all, definitely not')), /不是有效的 ZIP/);
});

test('extract rejects unknown methods', async () => {
  await assert.rejects(zip.extract({ method: 14, data: new Uint8Array(1) }), /不支援的壓縮方式/);
});
