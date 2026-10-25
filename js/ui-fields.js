// Certificate text panel: one input per field with per-field options
// (prefix, suffix, font slot, hidden, reset), variable chips, the date helper,
// serial number options and the text options.
(function () {
  'use strict';

  const C = window.Cert;
  const { $, h, toast, clamp, openSection } = C.ui.common;
  let app;
  let lastInput = null; // the field input variables are inserted into

  const inputId = (key) => `f-${key}`;

  function setValue(key, value) {
    app.set((s) => ({ ...s, values: { ...s.values, [key]: value } }), ['values']);
  }

  function insertVar(name) {
    const input = lastInput && document.body.contains(lastInput) ? lastInput : null;
    if (!input) {
      toast('先點一下要插入變數的文字欄位', 'info');
      return;
    }
    const token = `{${name}}`;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = input.value.slice(0, start) + token + input.value.slice(end);
    input.focus();
    input.setSelectionRange(start + token.length, start + token.length);
    setValue(input.dataset.key, input.value);
  }

  function resetField(def) {
    app.set((s) => {
      const { [def.key]: gone, ...props } = s.fieldProps;
      const values = def.fromRoster ? s.values : { ...s.values, [def.key]: def.value ?? '' };
      return { ...s, values, fieldProps: props };
    }, ['values', 'fieldProps']);
    const input = $(inputId(def.key));
    if (input) input.value = def.value ?? '';
    renderMore(def.key);
    toast(`「${def.label}」已還原預設文字與選項`, 'info');
  }

  // Date helper: a date picker plus display style, written into the date field.
  function dateHelper() {
    const opts = app.state.options;
    const apply = (iso, style) => {
      app.patch('options', { dateIso: iso, dateStyle: style }, ['options']);
      if (!iso) return;
      const text = C.text.formatDate(iso, style);
      $(inputId('date')).value = text;
      setValue('date', text);
    };
    const picker = h('input', { type: 'date', id: 'dateIso', value: opts.dateIso || '' });
    const style = h('select', { id: 'dateStyle' }, ...Object.entries(C.text.DATE_STYLES).map(([k, d]) => h('option', { value: k }, d.label)));
    style.value = opts.dateStyle;
    picker.addEventListener('change', () => apply(picker.value, style.value));
    style.addEventListener('change', () => apply(picker.value, style.value));
    const today = h('button', { type: 'button', onclick: () => {
      picker.value = C.text.todayIso();
      apply(picker.value, style.value);
    } }, '今天');
    return h('div', { class: 'helper row wrap' },
      h('label', { for: 'dateIso', class: 'sr-only' }, '選擇日期'), picker,
      h('label', { for: 'dateStyle', class: 'sr-only' }, '日期格式'), style, today);
  }

  function serialHelper() {
    const opts = app.state.options;
    const num = (id, label, value, min, max, key) => {
      const input = h('input', { type: 'number', id, min, max, step: 1, value: String(value), class: 'num-input' });
      input.addEventListener('change', () => {
        const v = clamp(Math.round(Number(input.value) || 0), min, max);
        input.value = v;
        app.patch('options', { [key]: v }, ['options']);
      });
      return [h('label', { for: id }, label), input];
    };
    return h('div', { class: 'helper' },
      h('div', { class: 'row wrap' }, ...num('serialStart', '{序號} 從', opts.serialStart, 0, 999999, 'serialStart'), ...num('serialPad', '補零到', opts.serialPad, 0, 8, 'serialPad'), h('span', { class: 'note' }, '位')),
      h('p', { class: 'note' }, '例：結字第 {序號} 號。編號也可放在名單的「證書編號」欄逐人指定。'));
  }

  function moreOptions(def) {
    const props = app.state.fieldProps[def.key] || {};
    const id = (n) => `fp-${def.key}-${n}`;
    const text = (name, label, placeholder, maxlength) => {
      const input = h('input', { type: 'text', id: id(name), maxlength, placeholder, value: props[name] ?? (name === 'prefix' ? def.prefix || '' : '') });
      input.addEventListener('input', () => app.patchFieldProps(def.key, { [name]: input.value }));
      return [h('label', { for: id(name) }, label), input];
    };
    const slot = h('select', { id: id('font') }, h('option', { value: 'name' }, '姓名字型'), h('option', { value: 'body' }, '內文字型'));
    slot.value = app.slotOf(def.key);
    slot.addEventListener('change', () => app.patchFieldProps(def.key, { font: slot.value }));
    const hidden = h('input', { type: 'checkbox', id: id('hidden'), checked: Boolean(props.hidden) });
    hidden.addEventListener('change', () => app.patchFieldProps(def.key, { hidden: hidden.checked }));
    return [
      h('div', { class: 'grid2' },
        ...text('prefix', '前綴', '例：主辦單位：', 20),
        ...text('suffix', '後綴', def.key === 'name' ? '例：君、同學' : '', 20),
        h('label', { for: id('font') }, '字型'), slot),
      h('div', { class: 'row wrap' },
        h('label', { class: 'check' }, hidden, ' 不顯示這一欄'),
        h('button', { type: 'button', class: 'small', onclick: () => resetField(def) }, '還原預設')),
    ];
  }

  function renderMore(key) {
    const box = $(`more-${key}`);
    if (box && !box.hidden) box.replaceChildren(...moreOptions(app.fieldDef(key)));
  }

  function fieldBlock(def) {
    const more = h('div', { class: 'field-more', id: `more-${def.key}`, hidden: true });
    const toggle = h('button', { type: 'button', class: 'icon small', 'aria-expanded': 'false', 'aria-controls': `more-${def.key}`, title: `「${def.label}」的更多選項`, 'aria-label': `${def.label}的更多選項` }, '⋯');
    toggle.addEventListener('click', () => {
      more.hidden = !more.hidden;
      toggle.setAttribute('aria-expanded', String(!more.hidden));
      if (!more.hidden) more.replaceChildren(...moreOptions(def));
    });
    const head = h('div', { class: 'field-head' },
      h('label', { for: inputId(def.key) }, def.label),
      h('span', { class: 'badges', id: `badges-${def.key}` }),
      toggle);
    let input;
    if (def.fromRoster) {
      input = h('button', { type: 'button', id: inputId(def.key), class: 'linkish', onclick: () => {
        openSection('roster');
        $('roster').focus();
      } }, '由學員名單帶入（點此編輯名單）');
    } else {
      input = h('input', { type: 'text', id: inputId(def.key), maxlength: 200, value: app.state.values[def.key] ?? '', dataset: { key: def.key } });
      input.addEventListener('input', () => setValue(def.key, input.value));
      input.addEventListener('focus', () => {
        lastInput = input;
        app.select(def.key);
      });
    }
    return h('div', { class: 'field', dataset: { key: def.key } },
      head, input,
      def.isDate ? dateHelper() : null,
      def.key === 'serial' ? serialHelper() : null,
      more);
  }

  function renderFields() {
    $('fieldList').replaceChildren(...C.FIELDS.map(fieldBlock));
  }

  function renderChips() {
    const names = C.pages.varNames(app.roster);
    $('varChips').replaceChildren(...names.map((n) => h('button', { type: 'button', class: 'chip', title: `插入 {${n}}`, onmousedown: (e) => e.preventDefault(), onclick: () => insertVar(n) }, `{${n}}`)));
  }

  // Badges: overridden by the roster, shrink ratio, hidden.
  function renderBadges() {
    const page = app.current();
    const ratios = page ? app.analysis.ratios.get(page.index) || {} : {};
    C.FIELDS.forEach((def) => {
      const box = $(`badges-${def.key}`);
      if (!box) return;
      const badges = [];
      if ((app.state.fieldProps[def.key] || {}).hidden) badges.push(h('span', { class: 'badge muted' }, '已隱藏'));
      if (page && page.overridden.includes(def.key)) badges.push(h('span', { class: 'badge info', title: '這位學員在名單表格中有自己的值' }, '本頁由名單覆寫'));
      const r = ratios[def.key];
      if (r) badges.push(h('span', { class: `badge ${r < 0.85 ? 'warn' : 'muted'}`, title: '文字超過最大寬度，自動縮小' }, `縮小 ${Math.round(r * 100)}%`));
      box.replaceChildren(...badges);
    });
  }

  function syncInputs() {
    C.FIELDS.forEach((def) => {
      const input = $(inputId(def.key));
      if (input && input.tagName === 'INPUT' && document.activeElement !== input) input.value = app.state.values[def.key] ?? '';
    });
    $('sampleName').value = app.state.options.sampleName;
    $('optAutoSpace').checked = app.state.options.autoSpace;
    $('optHalfWidth').checked = app.state.options.halfWidth;
  }

  // Double-clicking text on the preview jumps here.
  function focusField(key) {
    openSection('fields');
    const input = $(inputId(key));
    if (!input) return;
    input.scrollIntoView({ block: 'center' });
    input.focus();
  }

  function init(a) {
    app = a;
    const sample = $('sampleName');
    sample.addEventListener('input', () => app.patch('options', { sampleName: sample.value.trim() || '王小明' }, ['options']));
    $('optAutoSpace').addEventListener('change', (e) => app.patch('options', { autoSpace: e.target.checked }, ['options']));
    $('optHalfWidth').addEventListener('change', (e) => app.patch('options', { halfWidth: e.target.checked }, ['options']));
  }

  function update(changes) {
    if (changes.has('all')) {
      renderFields();
      syncInputs();
    }
    if (changes.has('all') || changes.has('roster')) renderChips();
    if (['all', 'page', 'analysis', 'roster', 'fieldProps', 'values'].some((c) => changes.has(c))) renderBadges();
    if (changes.has('select') && app.selected) {
      document.querySelectorAll('.field.selected').forEach((el) => el.classList.remove('selected'));
      const el = document.querySelector(`.field[data-key="${app.selected}"]`);
      if (el) el.classList.add('selected');
    }
  }

  C.ui.fields = { init, update, focusField };
})();
