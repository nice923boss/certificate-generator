const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../js/core/text.js');

test('toHalfWidthAlnum converts digits and letters only', () => {
  assert.equal(t.toHalfWidthAlnum('ＡＩ班１２３，：'), 'AI班123，：');
});

test('autoSpace separates Han from Latin and digits', () => {
  assert.equal(t.autoSpace('AI多媒體115年度'), 'AI 多媒體 115 年度');
  assert.equal(t.autoSpace('AI 多媒體'), 'AI 多媒體');
});

test('collapseHanSpaces joins Chinese names but keeps English spaces', () => {
  assert.equal(t.collapseHanSpaces('王 小　明'), '王小明');
  assert.equal(t.collapseHanSpaces('John Smith'), 'John Smith');
});

test('stripNumbering removes common list numbering', () => {
  assert.equal(t.stripNumbering('1. 王小明'), '王小明');
  assert.equal(t.stripNumbering('01、李大華'), '李大華');
  assert.equal(t.stripNumbering('(3)陳美玲'), '陳美玲');
  assert.equal(t.stripNumbering('12 張三'), '張三');
  assert.equal(t.stripNumbering('2024'), '2024');
  assert.equal(t.stripNumbering('王小明'), '王小明');
});

test('findDuplicates and dedupe', () => {
  assert.deepEqual([...t.findDuplicates(['a', 'b', 'a', 'c', 'b'])], ['a', 'b']);
  assert.deepEqual(t.dedupe(['a', 'b', 'a']), { list: ['a', 'b'], removed: 1 });
});

test('formatDate supports the three styles', () => {
  assert.equal(t.formatDate('2026-10-21', 'roc'), '中華民國 115 年 10 月 21 日');
  assert.equal(t.formatDate('2026-10-21', 'rocZh'), '中華民國一一五年十月二十一日');
  assert.equal(t.formatDate('2026-01-05', 'ad'), '2026 年 1 月 5 日');
  assert.throws(() => t.formatDate('2026/1/5', 'roc'), /日期格式錯誤/);
});

test('toChineseNumeral', () => {
  assert.equal(t.toChineseNumeral(0), '〇');
  assert.equal(t.toChineseNumeral(10), '十');
  assert.equal(t.toChineseNumeral(31), '三十一');
});

test('fillVars replaces known keys and keeps unknown ones', () => {
  assert.equal(t.fillVars('{姓名} 第{序號}號 {不明}', { 姓名: '王', 序號: '001' }), '王 第001號 {不明}');
  assert.deepEqual(t.unknownVars('{姓名}{不明}', { 姓名: '王' }), ['不明']);
});

test('sanitizeFileName strips illegal characters', () => {
  assert.equal(t.sanitizeFileName('a/b:c*?"<>|.'), 'abc');
  assert.equal(t.sanitizeFileName('CON'), '_CON');
  assert.equal(t.sanitizeFileName('   '), '未命名');
});

test('uniqueName adds a counter', () => {
  const used = new Set();
  assert.equal(t.uniqueName('a.pdf', used), 'a.pdf');
  assert.equal(t.uniqueName('a.pdf', used), 'a (2).pdf');
  assert.equal(t.uniqueName('a.pdf', used), 'a (3).pdf');
});

test('parseRange', () => {
  assert.deepEqual(t.parseRange('', 3), [0, 1, 2]);
  assert.deepEqual(t.parseRange('1-2, 5, 7-', 8), [0, 1, 4, 6, 7]);
  assert.deepEqual(t.parseRange('3，1', 5), [0, 2]);
  assert.throws(() => t.parseRange('9', 5), /超出人數/);
  assert.throws(() => t.parseRange('a', 5), /無法解讀/);
  assert.throws(() => t.parseRange('4-2', 5), /不正確/);
});

test('formatBytes and formatDuration', () => {
  assert.equal(t.formatBytes(500), '500 B');
  assert.equal(t.formatBytes(2048), '2.0 KB');
  assert.equal(t.formatBytes(3 * 1024 * 1024), '3.0 MB');
  assert.equal(t.formatDuration(4200), '4 秒');
  assert.equal(t.formatDuration(125000), '2 分 5 秒');
});
