// Roster parsing: plain name lists, and spreadsheet-style tables whose header
// row has a 姓名 column (pasted from Excel, or imported CSV / XLSX).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.Cert = root.Cert || {}).table = factory(root.Cert.text);
})(typeof self !== 'undefined' ? self : this, function (text) {
  'use strict';

  const NAME_HEADERS = ['姓名', '學員姓名', '學員', '名字', 'name'];
  const LIST_SEPARATORS = /[,，、\t]+/;

  const isNameHeader = (cell) => NAME_HEADERS.includes(String(cell).trim().toLowerCase());
  const isComment = (s) => String(s).trim().startsWith('#');
  const isBlankRow = (cells) => cells.every((c) => !String(c).trim());

  // RFC 4180 style: quoted cells may hold the delimiter, "" and line breaks.
  // `lines[i]` is the zero-based source line where row i starts.
  function parseDelimited(source, delimiter) {
    const s = String(source).replace(/^﻿/, '');
    const rows = [];
    const lines = [];
    let row = [];
    let cell = '';
    let quoted = false;
    let line = 0;
    let rowLine = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"' && s[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          if (ch === '\n') line++;
          cell += ch;
        }
      } else if (ch === '"' && cell === '') {
        quoted = true;
      } else if (ch === delimiter) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        lines.push(rowLine);
        row = [];
        cell = '';
        rowLine = ++line;
      } else {
        cell += ch;
      }
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
      lines.push(rowLine);
    }
    return { rows, lines };
  }

  function detectDelimiter(source) {
    const first = String(source).split(/\r\n|\r|\n/).find((l) => l.trim() && !isComment(l)) || '';
    if (first.includes('\t')) return '\t';
    if (first.includes(',')) return ',';
    if (first.includes(';')) return ';';
    return '\t';
  }

  function parseList(source) {
    const people = [];
    let comments = 0;
    String(source)
      .split(/\r\n|\r|\n/)
      .forEach((raw, line) => {
        const t = raw.trim();
        if (!t) return;
        if (isComment(t)) {
          comments++;
          return;
        }
        t.split(LIST_SEPARATORS)
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((name) => people.push({ name, line, overrides: {}, vars: {} }));
      });
    return { mode: 'list', headers: [], mapped: [], people, skipped: 0, comments };
  }

  // `aliases` maps a header text to a field key, e.g. { 講師: 'instructor' }.
  function parseTable(source, delimiter, aliases) {
    const { rows, lines } = parseDelimited(source, delimiter);
    const h = rows.findIndex((r) => !isBlankRow(r) && !isComment(r[0]));
    const headers = rows[h].map((c) => c.trim());
    const nameCol = headers.findIndex(isNameHeader);
    const fieldOf = headers.map((hd, i) => (i !== nameCol && aliases[hd]) || null);
    const people = [];
    let skipped = 0;
    let comments = 0;
    for (let r = h + 1; r < rows.length; r++) {
      const cells = rows[r];
      if (isBlankRow(cells)) continue;
      if (isComment(cells[0])) {
        comments++;
        continue;
      }
      const name = (cells[nameCol] || '').trim();
      if (!name) {
        skipped++;
        continue;
      }
      const overrides = {};
      const vars = {};
      headers.forEach((hd, i) => {
        if (i === nameCol || !hd) return;
        const value = (cells[i] || '').trim();
        vars[hd] = value;
        if (fieldOf[i] && value) overrides[fieldOf[i]] = value;
      });
      people.push({ name, line: lines[r], overrides, vars });
    }
    return {
      mode: 'table',
      delimiter,
      headers,
      mapped: headers.filter((hd, i) => fieldOf[i]),
      people,
      skipped,
      comments,
    };
  }

  // Table mode when the first real line has a 姓名 header; otherwise a name list
  // split on line breaks, commas, 、 and tabs (the original behaviour).
  function parseRoster(source, aliases = {}) {
    const first = String(source || '')
      .split(/\r\n|\r|\n/)
      .find((l) => l.trim() && !isComment(l));
    if (first) {
      const delimiter = first.includes('\t') ? '\t' : ',';
      if (first.split(delimiter).some(isNameHeader)) return parseTable(source, delimiter, aliases);
    }
    return parseList(source || '');
  }

  // UTF-16 (BOM), then strict UTF-8, then Big5, which older Taiwanese Excel CSVs use.
  function decodeText(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(b);
    } catch (err) {
      return new TextDecoder('big5').decode(b);
    }
  }

  function quoteCell(cell, delimiter) {
    const s = String(cell ?? '');
    return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const rowsToText = (rows, delimiter, eol = '\n') =>
    rows.map((r) => r.map((c) => quoteCell(c, delimiter)).join(delimiter)).join(eol);
  const rowsToTsv = (rows) => rowsToText(rows, '\t');
  const rowsToCsv = (rows) => rowsToText(rows, ',', '\r\n');

  function trimRows(rows) {
    const out = rows.map((r) => {
      const cells = r.map((c) => String(c ?? '').trim());
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      return cells;
    });
    while (out.length && !out[out.length - 1].length) out.pop();
    return out;
  }

  // Imported rows -> text for the roster box. Rows with a 姓名 header stay a
  // table; otherwise the first filled cell of each row is taken as the name.
  function rowsToRoster(rows) {
    const clean = trimRows(rows);
    const header = clean.find((r) => r.length);
    if (header && header.some(isNameHeader)) {
      return { text: rowsToTsv(clean.filter((r) => r.length)), mode: 'table', firstColumnOnly: false };
    }
    const multiColumn = clean.some((r) => r.filter(Boolean).length > 1);
    const names = clean.map((r) => r.find(Boolean)).filter(Boolean);
    return { text: names.join('\n'), mode: 'list', firstColumnOnly: multiColumn };
  }

  function cleanName(name, ops) {
    let s = String(name);
    if (ops.numbering) s = text.stripNumbering(s);
    if (ops.spaces) s = text.collapseHanSpaces(s);
    if (ops.halfWidth) s = text.toHalfWidthAlnum(s);
    return s.replace(/[\s　]+/g, ' ').trim();
  }

  // Applies the chosen clean-up steps to every name. A list comes back one
  // name per line; a table comes back as tab-separated rows.
  function cleanRoster(source, ops, aliases = {}) {
    const roster = parseRoster(source, aliases);
    let changed = 0;
    let removed = 0;
    const seen = new Set();
    const keep = (name) => {
      if (!ops.dedupe) return true;
      if (seen.has(name)) {
        removed++;
        return false;
      }
      seen.add(name);
      return true;
    };

    if (roster.mode === 'list') {
      const out = [];
      String(source)
        .split(/\r\n|\r|\n/)
        .forEach((raw) => {
          const t = raw.trim();
          if (!t) return;
          if (isComment(t)) {
            out.push(t);
            return;
          }
          // Numbering goes first, or "2、李大華" would split on 、 into "2" and a name.
          const line = ops.numbering ? text.stripNumbering(t) : t;
          line
            .split(LIST_SEPARATORS)
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((name, i) => {
              const cleaned = cleanName(name, ops);
              if (!cleaned) return;
              if (cleaned !== name || (i === 0 && line !== t)) changed++;
              if (keep(cleaned)) out.push(cleaned);
            });
        });
      return { text: out.join('\n'), changed, removed };
    }

    const { rows } = parseDelimited(source, roster.delimiter);
    const h = rows.findIndex((r) => !isBlankRow(r) && !isComment(r[0]));
    const nameCol = rows[h].findIndex(isNameHeader);
    const out = [rows[h]];
    rows.slice(h + 1).forEach((cells) => {
      if (isBlankRow(cells)) return;
      if (isComment(cells[0])) {
        out.push(cells);
        return;
      }
      const name = cells[nameCol] || '';
      const cleaned = cleanName(name, ops);
      if (cleaned !== name) changed++;
      if (cleaned && !keep(cleaned)) return;
      const next = cells.slice();
      next[nameCol] = cleaned;
      out.push(next);
    });
    return { text: rowsToTsv(trimRows(out)), changed, removed };
  }

  return {
    NAME_HEADERS,
    parseDelimited,
    detectDelimiter,
    parseRoster,
    decodeText,
    rowsToTsv,
    rowsToCsv,
    rowsToRoster,
    cleanRoster,
  };
});
