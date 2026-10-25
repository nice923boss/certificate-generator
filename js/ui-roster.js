// Roster panel: typing / pasting, file import (xlsx, csv, tsv, txt) by button
// or drag and drop, clean-up, statistics and the searchable people list.
(function () {
  'use strict';

  const C = window.Cert;
  const { $, h, debounce, toast, confirm, readText, extOf } = C.ui.common;
  const TEXT_EXTS = ['csv', 'tsv', 'txt'];
  const LIST_LIMIT = 500;
  let app;

  const setRoster = (text) => app.set((s) => ({ ...s, roster: text }), ['roster']);
  const typed = debounce((text) => setRoster(text), 250);

  // -> { text, summary } for one dropped or chosen file
  async function readRosterFile(file) {
    const ext = extOf(file.name);
    if (file.size > 20 * 1024 * 1024) throw new Error('檔案超過 20 MB，請確認是不是選錯檔案');
    if (ext === 'xlsx' || ext === 'xls') {
      const book = await C.xlsx.readXlsx(await file.arrayBuffer());
      const result = C.table.rowsToRoster(book.rows);
      const notes = [`工作表「${book.sheetName}」`];
      if (book.sheets.length > 1) notes.push(`共有 ${book.sheets.length} 張工作表，只讀取第一張`);
      if (result.firstColumnOnly) notes.push('沒有「姓名」欄名，只取每列第一個有值的儲存格');
      return { text: result.text, notes };
    }
    if (TEXT_EXTS.includes(ext) || file.type.startsWith('text/')) {
      return { text: (await readText(file)).replace(/^﻿/, ''), notes: [] };
    }
    throw new Error(`不支援「.${ext || '未知'}」檔案，請用 .xlsx、.csv、.tsv 或 .txt`);
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const { text, notes } = await readRosterFile(file);
      const before = app.roster.people.length;
      if (before && !(await confirm('取代目前名單？', `匯入「${file.name}」會取代目前的 ${before} 位學員。`, { okText: '取代' }))) return;
      setRoster(text);
      $('roster').value = text;
      const r = app.roster;
      if (!r.people.length) {
        toast(`「${file.name}」裡沒有讀到任何姓名`, 'warn');
        return;
      }
      const mode = r.mode === 'table' ? `表格模式，對應欄位：${r.mapped.join('、') || '無'}` : '名單模式';
      toast(`已匯入「${file.name}」：${r.people.length} 位（${[mode, ...notes].join('；')}）`, 'success', 7000);
    } catch (err) {
      console.warn('Roster import failed', file.name, err);
      toast(`無法匯入「${file.name}」：${err.message}`, 'error');
    }
  }

  function downloadTemplate() {
    const rows = [['姓名', '班級名稱', '證書編號', '備註'], ['王小明', '', '', ''], ['陳美玲', '', '', '']];
    const csv = '﻿' + C.table.rowsToCsv(rows);
    C.exporter.download(new Blob([csv], { type: 'text/csv' }), '學員名單範本.csv');
    toast('範本已下載：只有「姓名」必填，其他欄留空就用證書內容的設定', 'info', 6000);
  }

  async function clearRoster() {
    if (!app.state.roster.trim()) return;
    const n = app.roster.people.length;
    if (!(await confirm('清空名單？', `會刪除目前的 ${n} 位學員，無法復原。`, { okText: '清空', danger: true }))) return;
    $('roster').value = '';
    setRoster('');
    toast('名單已清空', 'info');
  }

  function cleanRoster() {
    const ops = {
      numbering: $('cleanNumbering').checked,
      spaces: $('cleanSpaces').checked,
      halfWidth: $('cleanHalfWidth').checked,
      dedupe: $('cleanDedupe').checked,
    };
    const result = C.table.cleanRoster(app.state.roster, ops, C.FIELD_ALIASES);
    if (!result.changed && !result.removed) {
      toast('名單已經很整齊，沒有需要修改的地方', 'info');
      return;
    }
    $('roster').value = result.text;
    setRoster(result.text);
    toast(`整理完成：修改 ${result.changed} 筆，移除 ${result.removed} 筆重複`, 'success');
  }

  // Moving the caret onto a line previews that person.
  function syncCaret() {
    const ta = $('roster');
    const line = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
    const page = app.pages.find((p) => p.line === line);
    if (page) app.goTo(page.index);
  }

  function bindDrop(zone) {
    const hasFile = (e) => [...(e.dataTransfer.types || [])].includes('Files');
    zone.addEventListener('dragover', (e) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      zone.classList.add('dragging');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
    zone.addEventListener('drop', (e) => {
      zone.classList.remove('dragging');
      if (!hasFile(e)) return;
      e.preventDefault();
      if (e.dataTransfer.files.length > 1) toast('一次只能匯入一個檔案，已讀取第一個', 'warn');
      importFile(e.dataTransfer.files[0]);
    });
    // A file dropped anywhere else would make the browser navigate away.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      if (zone.contains(e.target)) return;
      e.preventDefault();
      if (e.dataTransfer.files.length) toast('請把名單檔拖到「學員名單」欄位裡', 'warn');
    });
  }

  function renderStats() {
    const r = app.roster;
    const n = r.people.length;
    $('rosterCount').textContent = n ? `${n} 位` : '';
    const parts = [];
    if (!n) parts.push('名單是空的，預覽顯示範例姓名');
    else parts.push(`共 ${n} 位`);
    if (r.mode === 'table') parts.push(`表格模式（${r.headers.filter(Boolean).length} 欄${r.mapped.length ? `，覆寫：${r.mapped.join('、')}` : ''}）`);
    const dup = C.text.findDuplicates(r.people.map((p) => p.name)).size;
    if (dup) parts.push(`${dup} 個姓名重複`);
    if (r.skipped) parts.push(`${r.skipped} 列沒有姓名已略過`);
    if (r.comments) parts.push(`${r.comments} 行註解`);
    $('rosterStats').textContent = parts.join('，');
  }

  function renderList() {
    const list = $('peopleList');
    const q = $('peopleSearch').value.trim().toLowerCase();
    const real = app.pages.filter((p) => !p.sample);
    const shown = real.filter((p) => !q || p.name.toLowerCase().includes(q));
    const cur = app.state.view.current;
    list.replaceChildren(
      ...shown.slice(0, LIST_LIMIT).map((p) => {
        const warnings = app.warningsFor(p);
        return h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: `person${p.index === cur ? ' current' : ''}${warnings.length ? ' has-warn' : ''}`,
              'aria-current': p.index === cur ? 'true' : null,
              title: warnings.map((w) => w.text).join('\n') || null,
              onclick: () => app.goTo(p.index),
            },
            h('span', { class: 'num' }, String(p.index + 1)),
            h('span', { class: 'who' }, p.name),
            warnings.length ? h('span', { class: 'warn-dot', 'aria-label': `${warnings.length} 個警告` }, '!') : null
          )
        );
      })
    );
    if (shown.length > LIST_LIMIT) list.append(h('li', { class: 'note' }, `只列出前 ${LIST_LIMIT} 位，請用搜尋找人`));
    if (q && !shown.length) list.append(h('li', { class: 'note' }, '找不到符合的學員'));
    list.parentElement.hidden = !real.length;
  }

  function scrollCurrentIntoView() {
    const el = $('peopleList').querySelector('.current');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function init(a) {
    app = a;
    const ta = $('roster');
    ta.value = app.state.roster;
    ta.addEventListener('input', () => typed(ta.value));
    ta.addEventListener('blur', () => typed.flush(ta.value));
    ['click', 'keyup'].forEach((ev) => ta.addEventListener(ev, syncCaret));
    $('rosterFile').addEventListener('change', (e) => {
      importFile(e.target.files[0]);
      e.target.value = '';
    });
    $('rosterTemplate').addEventListener('click', downloadTemplate);
    $('rosterClear').addEventListener('click', clearRoster);
    $('rosterCleanBtn').addEventListener('click', cleanRoster);
    $('peopleSearch').addEventListener('input', renderList);
    bindDrop($('rosterZone'));
  }

  function update(changes) {
    if (changes.has('all') || changes.has('roster')) renderStats();
    if (changes.has('all') && $('roster').value !== app.state.roster) $('roster').value = app.state.roster;
    if (['all', 'roster', 'page', 'analysis', 'values', 'options', 'fieldProps'].some((c) => changes.has(c))) {
      renderList();
      if (changes.has('page')) scrollCurrentIntoView();
    }
  }

  C.ui.roster = { init, update, importFile };
})();
