const test = require('node:test');
const assert = require('node:assert/strict');
const table = require('../js/core/table.js');
const { FIELD_ALIASES } = require('../js/core/fields.js');

test('plain list keeps the original separators', () => {
  const r = table.parseRoster('王小明\n李大華，陳美玲、張三\t李四\n# 備註\n\n');
  assert.equal(r.mode, 'list');
  assert.deepEqual(r.people.map((p) => p.name), ['王小明', '李大華', '陳美玲', '張三', '李四']);
  assert.equal(r.comments, 1);
  assert.equal(r.people[1].line, 1);
});

test('table mode from a 姓名 header with tabs', () => {
  const src = '姓名\t講師\t部門\n王小明\t張老師\t業務部\n\t\t\n李大華\t\t研發部\n\t王老師\t';
  const r = table.parseRoster(src, FIELD_ALIASES);
  assert.equal(r.mode, 'table');
  assert.deepEqual(r.mapped, ['講師']);
  assert.deepEqual(r.people.map((p) => p.name), ['王小明', '李大華']);
  assert.deepEqual(r.people[0].overrides, { instructor: '張老師' });
  assert.deepEqual(r.people[1].overrides, {});
  assert.deepEqual(r.people[0].vars, { 講師: '張老師', 部門: '業務部' });
  assert.equal(r.skipped, 1);
  assert.equal(r.people[1].line, 3);
});

test('CSV with quotes, commas and line breaks inside cells', () => {
  const src = '﻿姓名,班級名稱\r\n"王,小明","AI ""進階"" 班"\r\n李大華,"第一行\n第二行"\r\n';
  const r = table.parseRoster(src, FIELD_ALIASES);
  assert.equal(r.mode, 'table');
  assert.equal(r.people[0].name, '王,小明');
  assert.equal(r.people[0].overrides.className, 'AI "進階" 班');
  assert.equal(r.people[1].overrides.className, '第一行\n第二行');
});

test('detectDelimiter', () => {
  assert.equal(table.detectDelimiter('a\tb'), '\t');
  assert.equal(table.detectDelimiter('# x\na,b'), ',');
  assert.equal(table.detectDelimiter('a;b'), ';');
});

test('decodeText handles UTF-8, UTF-16 and Big5', () => {
  assert.equal(table.decodeText(new TextEncoder().encode('王小明')), '王小明');
  const utf16 = new Uint8Array([0xff, 0xfe, 0x8b, 0x73, 0x0f, 0x5c]);
  assert.equal(table.decodeText(utf16).replace(/^﻿/, ''), '王小');
  // "王小明" in Big5
  const big5 = new Uint8Array([0xa4, 0xfd, 0xa4, 0x70, 0xa9, 0xfa]);
  assert.equal(table.decodeText(big5), '王小明');
});

test('rowsToRoster keeps tables and takes the first column of plain rows', () => {
  const t1 = table.rowsToRoster([['姓名', '講師'], ['王小明', '張老師'], [], ['李大華', '']]);
  assert.equal(t1.mode, 'table');
  assert.equal(t1.text, '姓名\t講師\n王小明\t張老師\n李大華');
  const t2 = table.rowsToRoster([['王小明', 'A'], ['', '李大華'], ['']]);
  assert.deepEqual(t2, { text: '王小明\n李大華', mode: 'list', firstColumnOnly: true });
});

test('rowsToCsv quotes when needed', () => {
  assert.equal(table.rowsToCsv([['a,b', 'c"d'], ['e', '']]), '"a,b","c""d"\r\ne,');
});

test('cleanRoster on a list', () => {
  const ops = { numbering: true, spaces: true, halfWidth: true, dedupe: true };
  const r = table.cleanRoster('1. 王 小明\n2、李大華\n# 註\n3. 王小明\nＪｏｈｎ Smith', ops);
  assert.equal(r.text, '王小明\n李大華\n# 註\nJohn Smith');
  assert.equal(r.removed, 1);
  assert.equal(r.changed, 4);
});

test('cleanRoster on a table keeps other columns', () => {
  const r = table.cleanRoster('姓名\t講師\n王 小明\t張老師\n王小明\t李老師', { spaces: true, dedupe: true });
  assert.equal(r.text, '姓名\t講師\n王小明\t張老師');
  assert.equal(r.removed, 1);
});
