// App state and orchestration. Every change goes through app.set(updater,
// changes); derived data (roster, pages, fields) is rebuilt, the state is
// saved, and each UI module refreshes the parts the change names.
(function () {
  'use strict';

  const C = window.Cert;
  const { $, toast, debounce, clamp, bindSections } = C.ui.common;
  const MODULES = ['roster', 'fields', 'layout', 'preview', 'grid', 'fonts', 'settings', 'export'];
  // Changes that do not affect page content, layout or what gets saved.
  const VIEW_ONLY = new Set(['select', 'analysis', 'background', 'export', 'view', 'page']);
  const UNSAVED = new Set(['select', 'analysis', 'background', 'fontsReady']);

  const ctx = { fields: C.FIELDS, styles: Object.keys(C.render.STYLES), templateIds: C.templates.ids };
  const loaded = C.settings.sanitize(C.store.loadState(), ctx);

  const app = {
    ctx,
    state: loaded.state,
    roster: null,
    pages: [],
    template: null,
    fields: [],
    fontAliases: { name: '', body: '' },
    background: null, // { id, src, bitmap }
    selected: null,
    analysis: { ratios: new Map(), missing: { name: [], body: [] } },
  };

  // ---- State updates ----
  app.set = (updater, changes = []) => {
    app.state = updater(app.state);
    commit(new Set(changes));
  };
  app.patch = (section, values, changes = [section]) =>
    app.set((s) => ({ ...s, [section]: { ...s[section], ...values } }), changes);

  app.layoutOf = (key) => ((app.state.layouts[app.state.templateId] || {})[key]) || {};
  app.patchLayout = (key, values) =>
    app.set((s) => {
      const own = s.layouts[s.templateId] || {};
      return { ...s, layouts: { ...s.layouts, [s.templateId]: { ...own, [key]: { ...(own[key] || {}), ...values } } } };
    }, ['layout']);
  // key omitted: reset every field of the current template.
  app.resetLayout = (key) =>
    app.set((s) => {
      if (!key) {
        const { [s.templateId]: gone, ...rest } = s.layouts;
        return { ...s, layouts: rest };
      }
      const { [key]: gone, ...own } = s.layouts[s.templateId] || {};
      return { ...s, layouts: { ...s.layouts, [s.templateId]: own } };
    }, ['layout']);

  app.patchFieldProps = (key, values) =>
    app.set((s) => ({ ...s, fieldProps: { ...s.fieldProps, [key]: { ...(s.fieldProps[key] || {}), ...values } } }), ['fieldProps']);

  app.slotOf = (key) => (app.state.fieldProps[key] || {}).font || (key === 'name' ? 'name' : 'body');
  app.fieldDef = (key) => C.FIELDS.find((d) => d.key === key);
  app.field = (key) => app.fields.find((f) => f.key === key);
  app.current = () => app.pages[app.state.view.current] || app.pages[0];

  app.goTo = (index) => {
    const i = clamp(Math.round(index), 0, Math.max(0, app.pages.length - 1));
    if (i !== app.state.view.current) app.patch('view', { current: i }, ['page']);
  };
  app.select = (key) => {
    if (app.selected === key) return;
    app.selected = key;
    commit(new Set(['select']));
  };

  // Warnings for one page: duplicates and unknown variables from the page
  // builder, plus shrink and missing-glyph results from the last analysis.
  app.warningsFor = (page) => {
    const list = [...page.warnings];
    const ratio = (app.analysis.ratios.get(page.index) || {}).name;
    if (ratio && ratio < 0.85) list.push({ type: 'shrink', text: `姓名較長，已縮小到 ${Math.round(ratio * 100)}%` });
    const found = new Set();
    ['name', 'body'].forEach((slot) => {
      const missing = app.analysis.missing[slot];
      if (!missing || !missing.length) return;
      const set = new Set(missing);
      app.fields.forEach((f) => {
        if (app.slotOf(f.key) !== slot) return;
        for (const ch of page.texts[f.key] || '') if (set.has(ch)) found.add(ch);
      });
    });
    if (found.size) list.push({ type: 'missing', text: `目前字型缺少「${[...found].join('')}」，這些字會用其他字型代替` });
    return list;
  };

  // ---- Derived data ----
  function commit(changes) {
    const all = changes.has('all');
    if (all || changes.has('roster')) app.roster = C.table.parseRoster(app.state.roster, C.FIELD_ALIASES);
    if (all || changes.has('template')) {
      app.template = C.templates.get(app.state.templateId, app.state.customTemplates);
      loadBackground();
    }
    const content = [...changes].some((c) => !VIEW_ONLY.has(c));
    if (content) {
      app.pages = C.pages.buildPages(app.roster, app.state, C.FIELDS);
      app.fields = C.render.resolveFields(app.template, app.state.layouts[app.template.id], app.state.fieldProps, fontSpecs());
    }
    if (app.state.view.current >= app.pages.length) app.state = { ...app.state, view: { ...app.state.view, current: app.pages.length - 1 } };
    if (all || changes.has('fonts')) registerFonts();
    if ([...changes].some((c) => !UNSAVED.has(c))) save();
    MODULES.forEach((m) => C.ui[m].update(changes));
    if (content) analyze();
  }

  const fontSpecs = () => ({
    name: { family: app.fontAliases.name, weight: app.state.fonts.name.weight },
    body: { family: app.fontAliases.body, weight: app.state.fonts.body.weight },
  });

  let fontToken = 0;
  async function registerFonts() {
    const token = ++fontToken;
    const out = {};
    for (const slot of ['name', 'body']) {
      const choice = app.state.fonts[slot];
      try {
        out[slot] = await C.fonts.register(choice);
      } catch (err) {
        console.warn('Font registration failed', choice, err);
        toast(`${slot === 'name' ? '姓名' : '內文'}字型「${choice.label || choice.id}」無法載入，已改回預設字型（${err.message}）`, 'warn');
        out[slot] = '';
        app.state = { ...app.state, fonts: { ...app.state.fonts, [slot]: { source: 'default', id: '', label: '', weight: choice.weight } } };
      }
    }
    if (token !== fontToken) return;
    app.fontAliases = out;
    commit(new Set(['fontsReady']));
  }

  const bgCache = new Map();
  let bgToken = 0;
  async function loadBackground() {
    const t = app.template;
    const token = ++bgToken;
    try {
      let bg = bgCache.get(t.id);
      if (!bg) {
        let src = null;
        if (t.builtin) {
          src = C.templates.builtinBackground(t.id);
        } else {
          const record = await C.store.files.get('backgrounds', t.id);
          if (!record) throw new Error('找不到這個自訂底圖，可能已被瀏覽器清除');
          src = URL.createObjectURL(record.data);
        }
        if (!src) throw new Error('底圖資料沒有載入（templates 資料夾是否完整？）');
        bg = { id: t.id, src, bitmap: await C.render.loadImage(src) };
        bgCache.set(t.id, bg);
      }
      if (token !== bgToken) return;
      app.background = bg;
      commit(new Set(['background']));
    } catch (err) {
      console.error('Background load failed', t.id, err);
      toast(`底圖載入失敗：${err.message}`, 'error');
      if (!t.builtin && token === bgToken) app.set((s) => ({ ...s, templateId: C.templates.ids[0] }), ['template']);
    }
  }
  app.forgetBackground = (id) => {
    const bg = bgCache.get(id);
    if (bg && bg.src.startsWith('blob:')) URL.revokeObjectURL(bg.src);
    bgCache.delete(id);
  };

  // ---- Analysis: shrink ratios and missing glyphs, after fonts load ----
  let analysisToken = 0;
  const analyze = debounce(async () => {
    const token = ++analysisToken;
    const { fields, pages } = app;
    try {
      await C.render.ensureFonts(fields, pages.map((p) => p.texts));
    } catch (err) {
      console.warn('Font loading for analysis failed', err);
    }
    if (token !== analysisToken) return;
    const ratios = new Map();
    const chars = { name: '', body: '' };
    pages.forEach((p) => {
      const r = {};
      fields.forEach((f) => {
        const t = p.texts[f.key];
        if (!t) return;
        chars[app.slotOf(f.key)] += t;
        const m = C.render.measureField(f, t);
        if (m.ratio < 0.995) r[f.key] = m.ratio;
      });
      ratios.set(p.index, r);
    });
    const missing = {};
    ['name', 'body'].forEach((slot) => {
      const alias = app.fontAliases[slot];
      // Without the web font every glyph falls back anyway; skip the check.
      missing[slot] = !alias && !C.fonts.webFontReady() ? null : C.fonts.missingGlyphs(alias, app.state.fonts[slot].weight || 900, chars[slot]);
    });
    app.analysis = { ratios, missing };
    commit(new Set(['analysis']));
  }, 400);

  // ---- Saving ----
  let quotaWarned = false;
  const save = debounce(() => {
    const result = C.store.saveState(app.state);
    const el = $('saveStatus');
    el.classList.remove('warn', 'error');
    if (result.ok) {
      el.textContent = `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (result.reason === 'quota') {
      el.textContent = '儲存空間不足，最新設定沒有存下來';
      el.classList.add('error');
      if (!quotaWarned) toast('瀏覽器儲存空間不足：請刪除不用的設定組合、自訂底圖，或匯出設定 JSON 備份', 'error');
      quotaWarned = true;
    } else {
      el.textContent = '這個瀏覽器不允許儲存，關閉後設定會消失';
      el.classList.add('warn');
    }
  }, 400);

  // ---- Keyboard ----
  function onKey(e) {
    if (e.key === 'F1') {
      e.preventDefault();
      openHelp();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      C.ui.export.print();
      return;
    }
    if (document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const sel = app.selected;
    if (e.key === 'Escape') {
      if (sel) app.select(null);
      return;
    }
    if (sel) {
      const step = e.shiftKey ? 10 : 1;
      const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (move) {
        e.preventDefault();
        const l = app.layoutOf(sel);
        app.patchLayout(sel, { dx: (l.dx || 0) + move[0], dy: (l.dy || 0) + move[1] });
        return;
      }
      const grow = { '+': 1.05, '=': 1.05, '-': 1 / 1.05, _: 1 / 1.05 }[e.key];
      if (grow) {
        e.preventDefault();
        app.patchLayout(sel, { scale: clamp(Math.round((app.layoutOf(sel).scale || 1) * grow * 1000) / 1000, 0.2, 5) });
        return;
      }
    }
    const cur = app.state.view.current;
    const target = { ArrowLeft: cur - 1, ArrowUp: cur - 1, ArrowRight: cur + 1, ArrowDown: cur + 1, Home: 0, End: app.pages.length - 1, PageUp: cur - 10, PageDown: cur + 10 }[e.key];
    if (target !== undefined) {
      e.preventDefault();
      app.goTo(target);
    }
  }

  function openHelp() {
    const dialog = $('helpDialog');
    if (dialog.open) return;
    const opener = document.activeElement;
    dialog.addEventListener('close', () => opener && opener.focus && opener.focus(), { once: true });
    dialog.showModal();
  }

  function init() {
    bindSections(app);
    MODULES.forEach((m) => C.ui[m].init(app));
    commit(new Set(['all']));
    loaded.notes.forEach((n) => toast(n, 'warn'));

    document.addEventListener('keydown', onKey);
    $('helpBtn').addEventListener('click', openHelp);
    if (!app.state.view.tipDismissed) $('tip').hidden = false;
    $('tipClose').addEventListener('click', () => {
      $('tip').hidden = true;
      app.patch('view', { tipDismissed: true });
    });

    if (!window.jspdf) toast('PDF 元件（vendor/jspdf.umd.min.js）載入失敗，目前只能匯出 PNG 或 JPG', 'error', 0);
    if (!C.store.localOk()) toast('這個瀏覽器不允許儲存設定，關閉頁面後設定會消失，請用「匯出 JSON」備份', 'warn');
    C.store.files.persist().then((ok) => {
      if (!ok) toast('瀏覽器資料庫無法使用，上傳的字型與底圖只在這次開啟期間有效', 'warn');
    });
    // The web font may finish after the first analysis; re-check glyphs then.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => analyze());
  }

  window.Cert.app = app;
  init();
})();
