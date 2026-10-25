// Pure text helpers: name cleanup, placeholders, dates, file names, ranges.
// Works in the browser (window.Cert.text) and in Node (module.exports) for tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.Cert = root.Cert || {}).text = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HAN = '\\p{Script=Han}';
  const ZH_DIGITS = '〇一二三四五六七八九';

  // Full-width digits and Latin letters only; full-width punctuation such as
  // "，" and "：" is normal in Chinese text and is left alone.
  function toHalfWidthAlnum(text) {
    return String(text).replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    );
  }

  // Inserts a space between Chinese characters and Latin letters or digits.
  function autoSpace(text) {
    return String(text)
      .replace(new RegExp(`(${HAN})([A-Za-z0-9])`, 'gu'), '$1 $2')
      .replace(new RegExp(`([A-Za-z0-9])(${HAN})`, 'gu'), '$1 $2');
  }

  // "王 小 明" -> "王小明"; spaces in "John Smith" are kept.
  function collapseHanSpaces(text) {
    return String(text).replace(new RegExp(`(${HAN})[\\s\\u3000]+(?=${HAN})`, 'gu'), '$1');
  }

  // Removes list numbering such as "1. ", "01、", "(3)", "12 " in front of a name.
  function stripNumbering(text) {
    const stripped = String(text).replace(
      /^[\s　]*(?:[(（]\s*\d{1,4}\s*[)）]|\d{1,4}\s*[.．、:：)）\-]|\d{1,4}(?=[\s　]))[\s　]*/,
      ''
    );
    return stripped || String(text);
  }

  // Names that appear more than once.
  function findDuplicates(names) {
    const counts = new Map();
    names.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1));
    return new Set([...counts].filter(([, c]) => c > 1).map(([n]) => n));
  }

  function dedupe(names) {
    const seen = new Set();
    const list = names.filter((n) => !seen.has(n) && seen.add(n));
    return { list, removed: names.length - list.length };
  }

  // 1..99 as Chinese numerals: 10 -> 十, 21 -> 二十一.
  function toChineseNumeral(n) {
    if (n < 10) return ZH_DIGITS[n];
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return (tens > 1 ? ZH_DIGITS[tens] : '') + '十' + (ones ? ZH_DIGITS[ones] : '');
  }

  // Digit by digit, the usual way to write a year: 115 -> 一一五.
  const digitsZh = (n) => String(n).replace(/\d/g, (d) => ZH_DIGITS[d]);

  const DATE_STYLES = {
    roc: { label: '中華民國 115 年 10 月 21 日', format: (y, m, d) => `中華民國 ${y - 1911} 年 ${m} 月 ${d} 日` },
    rocZh: {
      label: '中華民國一一五年十月二十一日',
      format: (y, m, d) => `中華民國${digitsZh(y - 1911)}年${toChineseNumeral(m)}月${toChineseNumeral(d)}日`,
    },
    ad: { label: '2026 年 10 月 21 日', format: (y, m, d) => `${y} 年 ${m} 月 ${d} 日` },
  };

  // `iso` is "YYYY-MM-DD" as produced by <input type="date">.
  function formatDate(iso, style) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) throw new Error(`日期格式錯誤：${iso}`);
    const def = DATE_STYLES[style] || DATE_STYLES.roc;
    return def.format(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  function todayIso(now = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  // Replaces {key} with vars[key]; unknown keys are left as typed.
  function fillVars(text, vars) {
    return String(text).replace(/\{([^{}\n]{1,30})\}/g, (whole, key) => {
      const k = key.trim();
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : whole;
    });
  }

  // Keys of {key} placeholders in text that vars does not define.
  function unknownVars(text, vars) {
    const keys = [];
    String(text).replace(/\{([^{}\n]{1,30})\}/g, (whole, key) => {
      if (!Object.prototype.hasOwnProperty.call(vars, key.trim())) keys.push(key.trim());
      return whole;
    });
    return keys;
  }

  const padNumber = (n, width) => String(n).padStart(Math.max(0, width), '0');

  // Safe on Windows, macOS and Linux; never returns an empty string.
  function sanitizeFileName(name, fallback = '未命名') {
    let s = String(name)
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '');
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
    s = Array.from(s).slice(0, 100).join('');
    return s || fallback;
  }

  // "a.pdf" seen before -> "a (2).pdf".
  function uniqueName(name, used) {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 2; ; i++) {
      const candidate = `${base} (${i})${ext}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
  }

  // "1-5, 8, 10-" -> zero-based indices; empty text means every page.
  function parseRange(input, total) {
    const text = String(input || '').trim();
    if (!text) return Array.from({ length: total }, (_, i) => i);
    const picked = new Set();
    text.split(/[,，、;\s]+/).filter(Boolean).forEach((part) => {
      const m = /^(\d*)\s*[-~～－]\s*(\d*)$/.exec(part) || /^(\d+)$/.exec(part);
      if (!m) throw new Error(`無法解讀範圍「${part}」`);
      const from = m[1] ? Number(m[1]) : 1;
      const to = m.length > 2 ? (m[2] ? Number(m[2]) : total) : from;
      if (from < 1 || to < from) throw new Error(`範圍「${part}」不正確`);
      if (to > total) throw new Error(`範圍「${part}」超出人數（共 ${total} 位）`);
      for (let i = from; i <= to; i++) picked.add(i - 1);
    });
    return [...picked].sort((a, b) => a - b);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
  }

  return {
    toHalfWidthAlnum,
    autoSpace,
    collapseHanSpaces,
    stripNumbering,
    findDuplicates,
    dedupe,
    toChineseNumeral,
    DATE_STYLES,
    formatDate,
    todayIso,
    fillVars,
    unknownVars,
    padNumber,
    sanitizeFileName,
    uniqueName,
    parseRange,
    formatBytes,
    formatDuration,
  };
});
