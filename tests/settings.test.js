const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../js/core/settings.js');
const { FIELDS } = require('../js/core/fields.js');

const ctx = { fields: FIELDS, styles: ['gold', 'cream'], templateIds: ['navy-gold'] };

test('null input gives defaults without notes', () => {
  const { state, notes } = settings.sanitize(null, ctx);
  assert.deepEqual(state, settings.defaults(ctx));
  assert.deepEqual(notes, []);
  assert.equal(state.values.instructor, '黃政文');
  assert.equal('name' in state.values, false);
});

test('v1 data is migrated', () => {
  const v1 = {
    names: '王小明\n李大華',
    fields: { className: '進階班', date: '中華民國 115 年 1 月 2 日' },
    fonts: { name: { local: 'DFKai-SB', label: '標楷體' }, other: null },
  };
  const { state, notes } = settings.sanitize(v1, ctx);
  assert.equal(state.roster, '王小明\n李大華');
  assert.equal(state.values.className, '進階班');
  assert.equal(state.values.line1, FIELDS[2].value);
  assert.deepEqual(state.fonts.name, { source: 'local', id: 'DFKai-SB', label: '標楷體', weight: 0 });
  assert.equal(state.fonts.body.source, 'default');
  assert.deepEqual(notes, ['已沿用舊版的名單與欄位內容']);
});

test('invalid values fall back to defaults and are reported', () => {
  const raw = {
    version: 2,
    templateId: 'missing',
    options: { serialPad: 99, dateStyle: 'nope', sampleName: '陳' },
    export: { format: 'docx', scale: 3, jpegQuality: 0.8 },
    view: { zoom: 2, collapsed: { roster: true, bad: 'x' } },
  };
  const { state, notes } = settings.sanitize(raw, ctx);
  assert.equal(state.templateId, 'navy-gold');
  assert.equal(state.options.serialPad, 3);
  assert.equal(state.options.dateStyle, 'roc');
  assert.equal(state.options.sampleName, '陳');
  assert.equal(state.export.format, 'pdf');
  assert.equal(state.export.scale, 3);
  assert.equal(state.export.jpegQuality, 0.8);
  assert.equal(state.view.zoom, 'fit');
  assert.deepEqual(state.view.collapsed, { roster: true });
  assert.deepEqual(notes, ['設定中有 5 個值無效，已改回預設值']);
});

test('corrupt data is replaced', () => {
  const { state, notes } = settings.sanitize('garbage', ctx);
  assert.equal(state.version, 2);
  assert.deepEqual(notes, ['儲存的設定已損毀，已改用預設值']);
});

test('layouts, field props and custom templates are filtered', () => {
  const raw = {
    version: 2,
    templateId: 'custom-abc',
    customTemplates: [
      { id: 'custom-abc', name: '我的底圖', width: 2000, height: 1414 },
      { id: '../evil', name: 'x', width: 10, height: 10 },
    ],
    layouts: {
      'navy-gold': {
        name: { dx: 10, dy: -5, scale: 1.2, style: 'gold', align: 'left', shadow: false, junk: 1 },
        nope: { dx: 1 },
        line1: { scale: 50, style: 'neon' },
      },
    },
    fieldProps: { organizer: { prefix: '主辦：', hidden: 'yes' }, other: { prefix: 'x' } },
  };
  const { state } = settings.sanitize(raw, ctx);
  assert.equal(state.templateId, 'custom-abc');
  assert.equal(state.customTemplates.length, 1);
  assert.deepEqual(state.layouts, {
    'navy-gold': { name: { dx: 10, dy: -5, scale: 1.2, style: 'gold', align: 'left', shadow: false } },
  });
  assert.deepEqual(state.fieldProps, { organizer: { prefix: '主辦：' } });
});

test('profiles exclude the roster and survive a JSON round trip', () => {
  const { state } = settings.sanitize({ version: 2, roster: '王小明', values: { className: '甲班' } }, ctx);
  const profile = settings.toProfile(state);
  assert.equal('roster' in profile, false);
  assert.equal('view' in profile, false);
  const json = settings.profileToJson('甲班設定', profile, new Date('2026-10-25T00:00:00Z'));
  const back = settings.profileFromJson(json, ctx);
  assert.equal(back.name, '甲班設定');
  assert.equal(back.profile.values.className, '甲班');
  const applied = settings.applyProfile({ ...state, roster: '李大華' }, back.profile, ctx).state;
  assert.equal(applied.roster, '李大華');
  assert.equal(applied.values.className, '甲班');
});

test('profileFromJson rejects foreign files', () => {
  assert.throws(() => settings.profileFromJson('{', ctx), /不是有效的 JSON/);
  assert.throws(() => settings.profileFromJson('{"a":1}', ctx), /不是結業證書產生器/);
  const newer = JSON.stringify({ app: 'cert-generator', kind: 'profile', version: 9, data: {} });
  assert.throws(() => settings.profileFromJson(newer, ctx), /較新的版本/);
});
