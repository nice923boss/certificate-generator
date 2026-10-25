// Reads the first visible worksheet of an .xlsx file into rows of strings.
// Only what a roster needs: shared / inline strings, numbers, booleans and
// date-formatted numbers (returned as YYYY-MM-DD). No formulas are evaluated;
// the cached value Excel saved is used.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./zip.js'));
  else (root.Cert = root.Cert || {}).xlsx = factory(root.Cert.zip);
})(typeof self !== 'undefined' ? self : this, function (zip) {
  'use strict';

  // Element names may carry a namespace prefix such as <x:c>.
  const NS = '(?:[\\w.-]+:)?';
  const elements = (xml, name) =>
    xml.matchAll(new RegExp(`<${NS}${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}${name}>)`, 'g'));
  const firstElement = (xml, name) => elements(xml, name).next().value || null;

  function attr(attrs, name) {
    const m = new RegExp(`(?:^|\\s)${NS}${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs || '');
    return m ? decodeXml(m[1] ?? m[2]) : null;
  }

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  // XML entities first, then Excel's own _xHHHH_ escapes (e.g. _x000D_).
  function decodeXml(s) {
    return String(s)
      .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
        if (e[0] !== '#') return ENTITIES[e.toLowerCase()];
        return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      })
      .replace(/_x([0-9a-f]{4})_/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  }

  // Text of a string item, skipping phonetic runs (<rPh>) Excel adds for CJK.
  function richText(xml) {
    const body = String(xml || '').replace(new RegExp(`<${NS}rPh\\b[\\s\\S]*?</${NS}rPh>`, 'g'), '');
    let out = '';
    for (const m of elements(body, 't')) out += decodeXml(m[2] || '');
    return out;
  }

  // Built-in number formats that show a date (zh-TW variants included).
  const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 36, 50, 51, 52, 53, 54, 57, 58]);

  function isDateFormat(code) {
    const s = String(code).replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
    return /[yd]/i.test(s) || /e\//i.test(s);
  }

  // Style index -> true when the cell's number format is a date.
  function dateStyles(stylesXml) {
    if (!stylesXml) return [];
    const custom = new Map();
    for (const m of elements(stylesXml, 'numFmt')) {
      custom.set(Number(attr(m[1], 'numFmtId')), attr(m[1], 'formatCode') || '');
    }
    const cellXfs = firstElement(stylesXml, 'cellXfs');
    if (!cellXfs) return [];
    return [...elements(cellXfs[2] || '', 'xf')].map((m) => {
      const id = Number(attr(m[1], 'numFmtId') || 0);
      return custom.has(id) ? isDateFormat(custom.get(id)) : DATE_FORMAT_IDS.has(id);
    });
  }

  // Excel serial day (1900 system) -> "YYYY-MM-DD".
  function serialToIso(serial) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400) * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  function columnIndex(ref) {
    const letters = /^[A-Z]+/i.exec(ref || '');
    if (!letters) return -1;
    let n = 0;
    for (const ch of letters[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function numberText(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    return String(Number.isInteger(n) ? n : parseFloat(n.toPrecision(15)));
  }

  function cellValue(attrs, body, shared, dates) {
    const type = attr(attrs, 't') || 'n';
    if (type === 'inlineStr') return richText((firstElement(body, 'is') || [])[2]);
    const v = firstElement(body, 'v');
    const raw = v ? decodeXml(v[2] || '') : '';
    if (type === 's') return shared[Number(raw)] ?? '';
    if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
    if (type === 'str' || type === 'e' || type === 'd') return raw;
    if (raw === '') return '';
    const style = Number(attr(attrs, 's') || 0);
    return dates[style] ? serialToIso(Number(raw)) : numberText(raw);
  }

  function parseSheet(xml, shared, dates) {
    const rows = [];
    let next = 0;
    const data = firstElement(xml, 'sheetData');
    for (const row of elements(data ? data[2] || '' : '', 'row')) {
      const r = Number(attr(row[1], 'r')) || next + 1;
      next = r;
      const cells = [];
      let col = 0;
      for (const c of elements(row[2] || '', 'c')) {
        const idx = columnIndex(attr(c[1], 'r'));
        col = idx >= 0 ? idx : col;
        cells[col] = cellValue(c[1], c[2] || '', shared, dates);
        col++;
      }
      rows[r - 1] = Array.from(cells, (v) => v ?? '');
    }
    return Array.from(rows, (r) => r || []);
  }

  function resolveTarget(target) {
    const t = String(target).replace(/\\/g, '/');
    if (t.startsWith('/')) return t.slice(1);
    const parts = [];
    `xl/${t}`.split('/').forEach((p) => {
      if (p === '..') parts.pop();
      else if (p && p !== '.') parts.push(p);
    });
    return parts.join('/');
  }

  function isOleFile(b) {
    return b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  }

  // buffer: ArrayBuffer | Uint8Array -> { sheets: [names], sheetName, rows }
  async function readXlsx(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (isOleFile(bytes)) throw new Error('這是舊版 .xls 格式，請在 Excel 用「另存新檔」存成 .xlsx 或 CSV 後再匯入');
    let entries;
    try {
      entries = zip.readZip(bytes);
    } catch (err) {
      throw new Error('不是有效的 Excel 檔案（.xlsx）');
    }
    const byName = new Map(entries.map((e) => [e.name.replace(/\\/g, '/').toLowerCase(), e]));
    const readText = async (path) => {
      const entry = byName.get(path.toLowerCase());
      return entry ? new TextDecoder('utf-8').decode(await zip.extract(entry)) : null;
    };

    const workbook = await readText('xl/workbook.xml');
    if (!workbook) throw new Error('Excel 檔案缺少活頁簿內容，可能已損毀');
    const rels = new Map();
    for (const m of elements((await readText('xl/_rels/workbook.xml.rels')) || '', 'Relationship')) {
      rels.set(attr(m[1], 'Id'), attr(m[1], 'Target'));
    }
    const sheets = [...elements(workbook, 'sheet')].map((m) => ({
      name: attr(m[1], 'name') || '',
      hidden: /hidden/i.test(attr(m[1], 'state') || ''),
      target: rels.get(attr(m[1], 'id')),
    }));
    const sheet = sheets.find((s) => !s.hidden && s.target) || sheets.find((s) => s.target);
    if (!sheet) throw new Error('Excel 檔案裡沒有工作表');

    const sharedXml = (await readText('xl/sharedStrings.xml')) || '';
    const shared = [...elements(sharedXml, 'si')].map((m) => richText(m[2]));
    const dates = dateStyles(await readText('xl/styles.xml'));
    const sheetXml = await readText(resolveTarget(sheet.target));
    if (sheetXml == null) throw new Error(`找不到工作表「${sheet.name}」的內容`);

    return { sheets: sheets.map((s) => s.name), sheetName: sheet.name, rows: parseSheet(sheetXml, shared, dates) };
  }

  return { readXlsx, decodeXml, isDateFormat, serialToIso, columnIndex };
});
