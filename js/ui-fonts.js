// Font panel: a font and weight for the name slot and the body slot, chosen
// from the default web font, uploaded font files or installed fonts; upload
// management, slot swap, missing-glyph and offline notices.
(function () {
  'use strict';

  const C = window.Cert;
  const { $, h, toast, confirm } = C.ui.common;
  const { formatBytes } = C.text;
  const SLOTS = { name: '姓名字型', body: '內文字型（其他欄位）' };
  const WEIGHTS = [[0, '範本預設'], [400, '一般 400'], [500, '中等 500'], [700, '粗 700'], [900, '特粗 900']];
  const SAMPLE = { name: '王小明', body: '結業證書 中華民國' };
  let app;
  let uploads = [];
  let local = null; // [{ id, label, family }] once loaded
  let filter = '';

  const choiceValue = (c) => (c.source === 'default' || !c.id ? 'default' : `${c.source}:${c.id}`);

  function setFont(slot, values) {
    app.set((s) => ({ ...s, fonts: { ...s.fonts, [slot]: { ...s.fonts[slot], ...values } } }), ['fonts']);
  }

  function onChoose(slot, value) {
    if (value === 'default') {
      setFont(slot, { source: 'default', id: '', label: '' });
      return;
    }
    const cut = value.indexOf(':');
    const source = value.slice(0, cut);
    const id = value.slice(cut + 1);
    const item = (source === 'local' ? local || [] : uploads).find((f) => f.id === id);
    setFont(slot, { source, id, label: item ? item.label : id });
  }

  function fontOptions(slot) {
    const cur = app.state.fonts[slot];
    const groups = [h('option', { value: 'default' }, '思源宋體（預設）')];
    if (uploads.length) groups.push(h('optgroup', { label: '已上傳' }, ...uploads.map((f) => h('option', { value: `upload:${f.id}` }, f.label))));
    const q = filter.toLowerCase();
    const shownLocal = (local || []).filter((f) => !q || f.label.toLowerCase().includes(q) || f.family.toLowerCase().includes(q));
    if (shownLocal.length) groups.push(h('optgroup', { label: `本機字型（${shownLocal.length}）` }, ...shownLocal.map((f) => h('option', { value: `local:${f.id}` }, f.label))));
    // Keep the saved choice visible even when its list is not loaded or filtered out.
    const value = choiceValue(cur);
    const listed = groups.some((g) => (g.tagName === 'OPTION' ? g.value === value : [...g.children].some((o) => o.value === value)));
    if (!listed) groups.push(h('option', { value }, `${cur.label || cur.id}${cur.source === 'local' ? '（本機）' : ''}`));
    return { groups, value };
  }

  function renderSlots() {
    const box = $('fontSlots');
    box.replaceChildren(...Object.entries(SLOTS).map(([slot, label]) => {
      const { groups, value } = fontOptions(slot);
      const select = h('select', { id: `font-${slot}` }, ...groups);
      select.value = value;
      select.addEventListener('change', () => onChoose(slot, select.value));
      const weight = h('select', { id: `weight-${slot}`, 'aria-label': `${label}的粗細` }, ...WEIGHTS.map(([w, l]) => h('option', { value: w }, l)));
      weight.value = String(app.state.fonts[slot].weight);
      weight.addEventListener('change', () => setFont(slot, { weight: Number(weight.value) }));
      return h('div', { class: 'font-slot' },
        h('label', { for: select.id }, label),
        h('div', { class: 'row' }, select, weight),
        h('div', { class: 'font-sample', id: `sample-${slot}` }, SAMPLE[slot]),
        h('p', { class: 'note warn-text', id: `missing-${slot}`, hidden: true }));
    }));
    renderSamples();
    renderMissing();
  }

  function renderSamples() {
    Object.keys(SLOTS).forEach((slot) => {
      const el = $(`sample-${slot}`);
      if (!el) return;
      const alias = app.fontAliases[slot];
      el.style.fontFamily = alias ? `"${alias}", ${C.render.FONT_FAMILY}` : C.render.FONT_FAMILY;
      el.style.fontWeight = app.state.fonts[slot].weight || 900;
      if (slot === 'name') el.textContent = app.current() ? app.current().name : SAMPLE.name;
    });
  }

  function renderMissing() {
    Object.keys(SLOTS).forEach((slot) => {
      const el = $(`missing-${slot}`);
      if (!el) return;
      const missing = app.analysis.missing[slot];
      el.hidden = !(missing && missing.length);
      if (missing && missing.length) el.textContent = `這個字型缺少：${missing.slice(0, 30).join('')}${missing.length > 30 ? '…' : ''}（會用其他字型代替）`;
    });
    const offline = $('fontOffline');
    if (offline) offline.hidden = !(app.analysis.missing.name === null || app.analysis.missing.body === null);
  }

  async function loadLocal(silent) {
    try {
      local = await C.fonts.listLocal();
      renderSlots();
      $('localSearch').hidden = false;
      $('localBtn').textContent = '重新整理本機字型';
      if (!silent) toast(`讀到 ${local.length} 款可顯示中文的本機字型`, 'success');
    } catch (err) {
      console.warn('Local font access failed', err);
      if (!silent) toast(err.name === 'NotAllowedError' || err.name === 'SecurityError' ? '沒有取得字型讀取權限，請在網址列左側的網站設定中允許「字型」' : `無法讀取本機字型：${err.message}`, 'error');
    }
  }

  async function refreshUploads() {
    try {
      uploads = await C.fonts.listUploads();
    } catch (err) {
      console.warn('Listing uploaded fonts failed', err);
      uploads = [];
    }
    $('uploadList').replaceChildren(...uploads.map((f) => h('li', {},
      h('span', { class: 'who' }, f.label),
      h('span', { class: 'note' }, formatBytes(f.size)),
      h('button', { type: 'button', class: 'small danger-text', 'aria-label': `刪除字型 ${f.label}`, onclick: () => removeUpload(f) }, '刪除'))));
    renderSlots();
  }

  async function upload(file) {
    if (!file) return;
    try {
      const meta = await C.fonts.addUpload(file);
      await refreshUploads();
      toast(`已加入字型「${meta.label}」，可在上方選單選用`, 'success');
    } catch (err) {
      console.warn('Font upload failed', file.name, err);
      toast(`無法加入「${file.name}」：${err.message}`, 'error');
    }
  }

  async function removeUpload(f) {
    if (!(await confirm('刪除字型？', `會從這台電腦的瀏覽器刪除「${f.label}」。`, { okText: '刪除', danger: true }))) return;
    try {
      await C.fonts.removeUpload(f.id);
    } catch (err) {
      console.warn('Font removal failed', f.id, err);
      toast(`刪除失敗：${err.message}`, 'error');
      return;
    }
    Object.keys(SLOTS).forEach((slot) => {
      const c = app.state.fonts[slot];
      if (c.source === 'upload' && c.id === f.id) setFont(slot, { source: 'default', id: '', label: '' });
    });
    await refreshUploads();
    toast(`已刪除字型「${f.label}」`, 'info');
  }

  function swap() {
    app.set((s) => ({ ...s, fonts: { name: s.fonts.body, body: s.fonts.name } }), ['fonts']);
    renderSlots();
  }

  function build() {
    const fileInput = h('input', { type: 'file', id: 'fontFile', accept: '.ttf,.otf,.woff,.woff2', class: 'sr-only' });
    fileInput.addEventListener('change', () => {
      upload(fileInput.files[0]);
      fileInput.value = '';
    });
    const search = h('input', { type: 'search', id: 'localSearch', placeholder: '搜尋本機字型', hidden: true, 'aria-label': '搜尋本機字型' });
    search.addEventListener('input', () => {
      filter = search.value.trim();
      renderSlots();
    });
    const localBtn = h('button', { type: 'button', id: 'localBtn', onclick: () => loadLocal(false) }, '載入本機字型');
    $('fontPanel').replaceChildren(
      h('p', { class: 'note warn-text', id: 'fontOffline', hidden: true }, '預設字型（思源宋體）沒有載入，可能是離線。預覽與輸出會用電腦內建的明體代替。'),
      h('div', { id: 'fontSlots' }),
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', onclick: swap, title: '姓名與內文的字型、粗細互換' }, '互換'),
        C.fonts.localSupported() ? localBtn : null,
        h('label', { class: 'button', for: 'fontFile' }, '上傳字型檔'), fileInput),
      C.fonts.localSupported() ? search : h('p', { class: 'note' }, '這個瀏覽器不能讀取已安裝的字型（Chrome、Edge 可以），請改用「上傳字型檔」。'),
      h('ul', { id: 'uploadList', class: 'upload-list', 'aria-label': '已上傳的字型' }),
      h('p', { class: 'note' }, '支援 .ttf、.otf、.woff、.woff2。上傳的字型只存在這台電腦的瀏覽器，設定組合不會帶走字型檔。'));
  }

  function init(a) {
    app = a;
    build();
    refreshUploads();
    C.fonts.localGranted().then((ok) => ok && loadLocal(true));
  }

  function update(changes) {
    if (changes.has('all')) renderSlots();
    if (['fontsReady', 'fonts'].some((c) => changes.has(c))) renderSamples();
    if (changes.has('fontsReady')) {
      // A failed registration falls back to the default font; reflect that.
      const stale = Object.keys(SLOTS).some((slot) => {
        const select = $(`font-${slot}`);
        return select && select.value !== choiceValue(app.state.fonts[slot]);
      });
      if (stale) renderSlots();
    }
    if (changes.has('page')) renderSamples();
    if (changes.has('analysis')) renderMissing();
  }

  C.ui.fonts = { init, update };
})();
