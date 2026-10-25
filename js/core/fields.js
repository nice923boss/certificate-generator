// Text fields of a certificate, in drawing order, and the roster column titles
// that map onto them. Geometry lives in templates.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign((root.Cert = root.Cert || {}), api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FIELDS = [
    { key: 'className', label: '班級名稱', value: 'AI 多媒體影音實務班' },
    { key: 'name', label: '姓名', fromRoster: true },
    { key: 'line1', label: '說明第一行', value: '完成 115 年度產業人才投資方案課程' },
    { key: 'line2', label: '說明第二行', value: '共計 45 小時，特頒此證' },
    { key: 'organizer', label: '主辦單位', value: '新竹市勞工職業訓練發展協會', prefix: '主辦單位：' },
    { key: 'instructor', label: '講師', value: '黃政文', prefix: '講師：' },
    { key: 'date', label: '日期', value: '中華民國 115 年 10 月 21 日', isDate: true },
    { key: 'serial', label: '證書編號', value: '' },
  ];

  const FIELD_ALIASES = {
    班級名稱: 'className',
    班級: 'className',
    課程名稱: 'className',
    課程: 'className',
    說明第一行: 'line1',
    說明第二行: 'line2',
    主辦單位: 'organizer',
    講師: 'instructor',
    日期: 'date',
    結業日期: 'date',
    證書編號: 'serial',
    編號: 'serial',
  };

  return { FIELDS, FIELD_ALIASES };
});
