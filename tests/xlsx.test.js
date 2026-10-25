const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zip = require('../js/core/zip.js');
const xlsx = require('../js/core/xlsx.js');
const table = require('../js/core/table.js');

const enc = (s) => new TextEncoder().encode(s);

test('reads the visible sheet of an openpyxl workbook', async () => {
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'roster.xlsx'));
  const book = await xlsx.readXlsx(buf);
  assert.deepEqual(book.sheets, ['隱藏', '名單']);
  assert.equal(book.sheetName, '名單');
  assert.deepEqual(book.rows, [
    ['姓名', '講師', '日期', '編號', '通過'],
    ['王小明', '黃政文', '2026-10-21', '1', 'TRUE', 'A&B "quoted"'],
    ['李<大>華', '', '', '2.5', 'FALSE'],
    [],
    ['陳 美 玲', '張老師', '', '3'],
  ]);
  const roster = table.rowsToRoster(book.rows);
  assert.equal(roster.mode, 'table');
});

// Excel-style workbook: shared strings with phonetic runs, a namespace prefix,
// a built-in date format and an absolute relationship target.
function excelLikeWorkbook() {
  const files = {
    'xl/workbook.xml':
      '<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="工作表1" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Type="ws" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml':
      '<sst><si><t>姓名</t></si><si><r><t>王</t></r><r><t xml:space="preserve">小明</t></r><rPh sb="0" eb="1"><t>ㄨㄤˊ</t></rPh></si><si><t>line_x000D_break</t></si></sst>',
    'xl/styles.xml':
      '<styleSheet><cellStyleXfs><xf numFmtId="14"/></cellStyleXfs><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml':
      '<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" s="1"><x:v>46316</x:v></x:c></x:row>' +
      '<x:row r="2"><x:c r="A2" t="s"><x:v>1</x:v></x:c><x:c r="B2" t="str"><x:v>=x</x:v></x:c><x:c r="C2" t="s"><x:v>2</x:v></x:c></x:row></x:sheetData></x:worksheet>',
  };
  return zip.createZip(Object.entries(files).map(([name, s]) => ({ name, data: enc(s) })));
}

test('reads shared strings, skips phonetic runs and decodes dates', async () => {
  const book = await xlsx.readXlsx(excelLikeWorkbook());
  assert.deepEqual(book.rows, [
    ['姓名', '', '2026-10-21'],
    ['王小明', '=x', 'line\rbreak'],
  ]);
});

test('old .xls files get a clear message', async () => {
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  await assert.rejects(xlsx.readXlsx(ole), /舊版 \.xls/);
  await assert.rejects(xlsx.readXlsx(enc('hello')), /不是有效的 Excel/);
});

test('helpers', () => {
  assert.equal(xlsx.columnIndex('A1'), 0);
  assert.equal(xlsx.columnIndex('AB12'), 27);
  assert.equal(xlsx.serialToIso(1), '1899-12-31');
  assert.equal(xlsx.serialToIso(45000), '2023-03-15');
  assert.equal(xlsx.isDateFormat('yyyy/m/d'), true);
  assert.equal(xlsx.isDateFormat('[$-404]e/m/d'), true);
  assert.equal(xlsx.isDateFormat('0.00E+00'), false);
  assert.equal(xlsx.isDateFormat('General'), false);
  assert.equal(xlsx.isDateFormat('"day"0'), false);
  assert.equal(xlsx.decodeXml('&lt;&#x738b;&#29579;&amp;'), '<王王&');
});
