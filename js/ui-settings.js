// Templates and settings panel: template choice, uploaded backgrounds,
// named settings profiles, JSON export / import and reset to defaults.
(function () {
  'use strict';

  const C = window.Cert;
  const { $, h, toast, confirm, prompt, pickFile, readText, extOf } = C.ui.common;
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
  const MIN_SIDE = 600;
  const MAX_SIDE = 6000;
  const MAX_CUSTOM = 30;
  let app;

  // ---- Templates ----
  function renderTemplates() {
    const select = $('tplSelect');
    const list = C.templates.list(app.state.customTemplates);
    const builtin = list.filter((t) => t.builtin);
    const custom = list.filter((t) => !t.builtin);
    select.replaceChildren(
      h('optgroup', { label: '內建範本' }, ...builtin.map((t) => h('option', { value: t.id }, t.name))),
      custom.length ? h('optgroup', { label: '自訂底圖' }, ...custom.map((t) => h('option', { value: t.id }, t.name))) : null);
    select.value = app.state.templateId;
    const t = app.template;
    $('tplInfo').textContent = t ? `${t.width} × ${t.height} px${t.builtin ? '' : '，文字位置沿用深藍金框比例，可在「版面調整」修改'}` : '';
    $('tplDelete').hidden = !t || t.builtin;
  }

  // Large images are scaled down so exports stay within memory limits.
  async function prepareImage(file) {
    if (!IMAGE_TYPES.includes(file.type)) throw new Error('只支援 PNG、JPG、WebP 圖片');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('圖片超過 30 MB');
    const url = URL.createObjectURL(file);
    try {
      const img = await C.render.loadImage(url);
      const { width, height } = img;
      if (Math.min(width, height) < MIN_SIDE) throw new Error(`圖片太小（${width} × ${height}），短邊至少要 ${MIN_SIDE} px，列印才清楚`);
      const k = Math.min(1, MAX_SIDE / Math.max(width, height));
      if (k === 1) return { width, height, data: file, resized: false };
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * k);
      canvas.height = Math.round(height * k);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      const data = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片縮小失敗，可能是記憶體不足'))), type, 0.95));
      return { width: canvas.width, height: canvas.height, data, resized: true };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function uploadBackground() {
    const file = await pickFile(IMAGE_TYPES.join(','));
    if (!file) return;
    if (app.state.customTemplates.length >= MAX_CUSTOM) {
      toast(`自訂底圖最多 ${MAX_CUSTOM} 張，請先刪除不用的`, 'warn');
      return;
    }
    try {
      const img = await prepareImage(file);
      const id = `custom-${Date.now().toString(36)}`;
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || '自訂底圖';
      await C.store.files.put('backgrounds', { id, name, width: img.width, height: img.height, data: img.data });
      app.set((s) => ({ ...s, customTemplates: [...s.customTemplates, { id, name, width: img.width, height: img.height }], templateId: id }), ['template']);
      toast(`已加入底圖「${name}」（${img.width} × ${img.height}${img.resized ? '，已縮小' : ''}）。淺色底圖請在「版面調整」把文字樣式改成深藍或黑色。`, 'success', 8000);
    } catch (err) {
      console.warn('Background upload failed', file.name, err);
      toast(`無法使用「${file.name}」：${err.message}`, 'error');
    }
  }

  async function deleteBackground() {
    const t = app.template;
    if (!t || t.builtin) return;
    if (!(await confirm('刪除自訂底圖？', `「${t.name}」與它的版面設定會被刪除，無法復原。`, { okText: '刪除', danger: true }))) return;
    try {
      await C.store.files.remove('backgrounds', t.id);
    } catch (err) {
      console.warn('Background removal failed', t.id, err);
      toast(`刪除失敗：${err.message}`, 'error');
      return;
    }
    app.forgetBackground(t.id);
    app.set((s) => {
      const { [t.id]: gone, ...layouts } = s.layouts;
      return { ...s, layouts, customTemplates: s.customTemplates.filter((c) => c.id !== t.id), templateId: C.templates.ids[0] };
    }, ['template', 'layout']);
    toast(`已刪除底圖「${t.name}」`, 'info');
  }

  // ---- Profiles ----
  function renderProfiles(selected) {
    const select = $('profileSelect');
    const list = C.store.listProfiles();
    select.replaceChildren(
      h('option', { value: '' }, list.length ? '（選擇設定組合）' : '（還沒有設定組合）'),
      ...list.map((p) => h('option', { value: p.name }, p.savedAt ? `${p.name}（${C.text.todayIso(new Date(p.savedAt))}）` : p.name)));
    select.value = selected && list.some((p) => p.name === selected) ? selected : '';
    syncProfileButtons();
  }

  function syncProfileButtons() {
    const has = Boolean($('profileSelect').value);
    $('profileLoad').disabled = !has;
    $('profileDelete').disabled = !has;
    $('profileLoad').title = $('profileDelete').title = has ? '' : '先在上方選擇一個設定組合';
  }

  // Uploaded backgrounds live in this browser only, so the local list wins
  // over whatever list the profile carries.
  function applyLoaded(profile, label) {
    const local = app.state.customTemplates;
    const { customTemplates, templateId, ...rest } = profile;
    const known = C.templates.ids.includes(templateId) || local.some((t) => t.id === templateId);
    const result = C.settings.applyProfile(app.state, { ...rest, customTemplates: local, ...(known ? { templateId } : {}) }, app.ctx);
    app.set(() => result.state, ['all']);
    result.notes.forEach((n) => toast(n, 'warn'));
    if (!known) toast('這組設定用的自訂底圖不在這台電腦上，已改用內建範本；請重新上傳底圖', 'warn');
    toast(`已套用「${label}」`, 'success');
  }

  async function saveProfile() {
    const current = $('profileSelect').value;
    const name = await prompt('另存設定組合', '組合名稱', current || app.state.values.className || '', {
      body: '會儲存證書內容、版面、字型與匯出設定，不含學員名單。',
      okText: '儲存',
    });
    if (!name) return;
    if (name.length > 60) {
      toast('名稱請在 60 個字以內', 'warn');
      return;
    }
    if (C.store.getProfile(name) && !(await confirm('覆蓋設定組合？', `已經有「${name}」，要用目前的設定覆蓋嗎？`, { okText: '覆蓋' }))) return;
    const result = C.store.saveProfile(name, C.settings.toProfile(app.state));
    if (!result.ok) {
      toast(result.reason === 'quota' ? '儲存空間不足，請刪除不用的設定組合或自訂底圖' : '這個瀏覽器不允許儲存', 'error');
      return;
    }
    renderProfiles(name);
    toast(`已儲存設定組合「${name}」`, 'success');
  }

  async function loadProfile() {
    const name = $('profileSelect').value;
    const profile = name && C.store.getProfile(name);
    if (!profile) {
      toast('找不到這個設定組合', 'error');
      renderProfiles();
      return;
    }
    if (!(await confirm('套用設定組合？', `目前的證書內容、版面、字型與匯出設定會換成「${name}」，學員名單不變。`, { okText: '套用' }))) return;
    applyLoaded(profile, name);
  }

  async function deleteProfile() {
    const name = $('profileSelect').value;
    if (!name || !(await confirm('刪除設定組合？', `「${name}」會被刪除，無法復原。`, { okText: '刪除', danger: true }))) return;
    C.store.deleteProfile(name);
    renderProfiles();
    toast(`已刪除「${name}」`, 'info');
  }

  function exportJson() {
    const name = $('profileSelect').value || app.state.values.className || '目前設定';
    const json = C.settings.profileToJson(name, C.settings.toProfile(app.state), new Date());
    const stamp = C.text.todayIso().replace(/-/g, '');
    C.exporter.download(new Blob([json], { type: 'application/json' }), `${C.text.sanitizeFileName(`證書設定_${name}_${stamp}`, '證書設定')}.json`);
    toast('設定已匯出成 JSON（不含學員名單、上傳的字型與底圖檔）', 'info', 6000);
  }

  async function importJson() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      if (extOf(file.name) !== 'json') throw new Error('請選擇 .json 檔');
      const { name, profile, notes } = C.settings.profileFromJson(await readText(file), app.ctx);
      notes.forEach((n) => toast(n, 'warn'));
      if (!(await confirm('套用匯入的設定？', `「${name || file.name}」會取代目前的證書內容、版面、字型與匯出設定，學員名單不變。`, { okText: '套用' }))) return;
      applyLoaded(profile, name || file.name);
    } catch (err) {
      console.warn('Settings import failed', file.name, err);
      toast(`無法匯入「${file.name}」：${err.message}`, 'error');
    }
  }

  async function resetAll() {
    if (!(await confirm('恢復預設值？', '證書內容、版面、字型與匯出設定都會回到初始狀態。學員名單、自訂底圖與設定組合會保留。', { okText: '恢復預設', danger: true }))) return;
    const d = C.settings.defaults(app.ctx);
    app.set((s) => ({ ...d, roster: s.roster, customTemplates: s.customTemplates, view: s.view }), ['all']);
    toast('已恢復預設值', 'info');
  }

  function build() {
    const tpl = h('select', { id: 'tplSelect' });
    tpl.addEventListener('change', () => app.set((s) => ({ ...s, templateId: tpl.value }), ['template']));
    const profile = h('select', { id: 'profileSelect' });
    profile.addEventListener('change', syncProfileButtons);
    $('settingsPanel').replaceChildren(
      h('div', { class: 'grid2' }, h('label', { for: 'tplSelect' }, '範本'), tpl),
      h('p', { class: 'note', id: 'tplInfo' }),
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', onclick: uploadBackground, title: 'PNG、JPG、WebP，短邊至少 600 px' }, '上傳自訂底圖'),
        h('button', { type: 'button', id: 'tplDelete', class: 'danger-text', onclick: deleteBackground, hidden: true }, '刪除這張底圖')),
      h('h3', { class: 'sub-title' }, '設定組合'),
      h('p', { class: 'note' }, '同一門課常用的內容、版面與字型可存成組合，下次一鍵套用。'),
      h('div', { class: 'row' }, h('label', { for: 'profileSelect', class: 'sr-only' }, '設定組合'), profile),
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', id: 'profileLoad', onclick: loadProfile }, '套用'),
        h('button', { type: 'button', onclick: saveProfile }, '另存新組合'),
        h('button', { type: 'button', id: 'profileDelete', class: 'danger-text', onclick: deleteProfile }, '刪除')),
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', onclick: exportJson, title: '帶到別台電腦或備份' }, '匯出 JSON'),
        h('button', { type: 'button', onclick: importJson }, '匯入 JSON'),
        h('button', { type: 'button', class: 'danger-text', onclick: resetAll }, '恢復預設值')));
  }

  function init(a) {
    app = a;
    build();
    renderProfiles();
  }

  function update(changes) {
    if (changes.has('all') || changes.has('template')) renderTemplates();
  }

  C.ui.settings = { init, update };
})();
