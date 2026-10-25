const test = require('node:test');
const assert = require('node:assert/strict');
const table = require('../js/core/table.js');
const pages = require('../js/core/pages.js');
const settings = require('../js/core/settings.js');
const { FIELDS, FIELD_ALIASES } = require('../js/core/fields.js');

const ctx = { fields: FIELDS, styles: ['gold'], templateIds: ['navy-gold'] };
const baseState = () => settings.defaults(ctx);

test('sample page when the roster is empty', () => {
  const list = pages.buildPages(table.parseRoster(''), baseState(), FIELDS);
  assert.equal(list.length, 1);
  assert.equal(list[0].sample, true);
  assert.equal(list[0].texts.name, '王小明');
  assert.equal(list[0].texts.organizer, '主辦單位：新竹市勞工職業訓練發展協會');
  assert.equal(list[0].texts.instructor, '講師：黃政文');
  assert.equal(list[0].texts.serial, '');
});

test('placeholders, serial numbers and suffix', () => {
  const state = baseState();
  state.values.serial = '115-{序號}';
  state.fieldProps.serial = { prefix: '證書編號：' };
  state.fieldProps.name = { suffix: ' 君' };
  state.options.serialStart = 7;
  const list = pages.buildPages(table.parseRoster('王小明\n李大華'), state, FIELDS);
  assert.equal(list[0].texts.serial, '證書編號：115-007');
  assert.equal(list[1].texts.serial, '證書編號：115-008');
  assert.equal(list[1].texts.name, '李大華 君');
  assert.equal(list[1].vars.總數, '2');
  assert.equal(list[1].fileVars.人數, '2');
  assert.equal(list[1].fileVars.班級名稱, 'AI 多媒體影音實務班');
});

test('per-person overrides, extra columns and Excel dates', () => {
  const state = baseState();
  state.values.line2 = '{部門}，共計 45 小時';
  state.options.dateStyle = 'rocZh';
  const src = '姓名\t講師\t部門\t日期\n王小明\t張老師\t業務部\t2026-10-21\n李大華\t\t研發部\t';
  const list = pages.buildPages(table.parseRoster(src, FIELD_ALIASES), state, FIELDS);
  assert.equal(list[0].texts.instructor, '講師：張老師');
  assert.deepEqual(list[0].overridden, ['instructor', 'date']);
  assert.equal(list[0].texts.date, '中華民國一一五年十月二十一日');
  assert.equal(list[0].texts.line2, '業務部，共計 45 小時');
  assert.equal(list[1].texts.instructor, '講師：黃政文');
  assert.equal(list[1].texts.date, '中華民國 115 年 10 月 21 日');
  assert.deepEqual(pages.varNames(table.parseRoster(src, FIELD_ALIASES)), ['姓名', '序號', '總數', '講師', '部門', '日期']);
});

test('hidden fields, unknown placeholders and duplicates', () => {
  const state = baseState();
  state.fieldProps.instructor = { hidden: true };
  state.values.line1 = '完成 {課程} 課程';
  const list = pages.buildPages(table.parseRoster('王小明\n王小明'), state, FIELDS);
  assert.equal(list[0].texts.instructor, '');
  assert.equal(list[0].texts.line1, '完成 {課程} 課程');
  const types = list[0].warnings.map((w) => w.type).sort();
  assert.deepEqual(types, ['duplicate', 'unknownVar']);
});

test('half-width and auto spacing apply after placeholders', () => {
  const state = baseState();
  state.options.halfWidth = true;
  state.options.autoSpace = true;
  state.values.className = 'ＡＩ多媒體班';
  const [page] = pages.buildPages(table.parseRoster('Ａｍｙ'), state, FIELDS);
  assert.equal(page.texts.className, 'AI 多媒體班');
  assert.equal(page.texts.name, 'Amy');
});
