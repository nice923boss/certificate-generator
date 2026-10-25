// Layout panel: exact position, size, letter spacing, max width, alignment,
// colour style and shadow for the selected field. Layouts are stored per
// template; dragging on the preview and arrow keys edit the same values.
(function () {
  'use strict';

  const C = window.Cert;
  const { $, h, clamp, confirm, toast } = C.ui.common;
  const ALIGN_LABELS = { left: '靠左', center: '置中', right: '靠右' };
  let app;
  const inputs = {};

  // name: [label, min, max, step, read(field) -> value, write(value, field) -> layout patch]
  const NUMBERS = {
    x: ['X 位置（px）', -2000, 12000, 1, (f) => Math.round(f.x), (v, f) => ({ dx: v - f.base.x })],
    y: ['Y 位置（px）', -2000, 12000, 1, (f) => Math.round(f.y), (v, f) => ({ dy: v - f.base.y })],
    scale: ['字級（%）', 20, 500, 1, (f) => Math.round((f.size / f.base.size) * 100), (v) => ({ scale: v / 100 })],
    spacing: ['字距（字級倍數）', -0.5, 2, 0.01, (f) => Math.round(f.spacing * 100) / 100, (v) => ({ spacing: v })],
    maxWidth: ['最大寬度（px）', 20, 10000, 10, (f) => Math.round(f.maxWidth), (v) => ({ maxWidth: v })],
  };

  function numberRow(name) {
    const [label, min, max, step, , write] = NUMBERS[name];
    const input = h('input', { type: 'number', id: `lay-${name}`, min, max, step, class: 'num-input' });
    input.addEventListener('change', () => {
      const f = app.field(app.selected);
      const v = Number(input.value);
      if (!f || input.value === '' || !Number.isFinite(v)) {
        sync();
        return;
      }
      app.patchLayout(f.key, write(clamp(v, min, max), f));
    });
    inputs[name] = input;
    return [h('label', { for: input.id }, label), input];
  }

  function build() {
    const picker = h('select', { id: 'layField' },
      h('option', { value: '' }, '（請選擇）'),
      ...C.FIELDS.map((d) => h('option', { value: d.key }, d.label)));
    picker.addEventListener('change', () => app.select(picker.value || null));
    inputs.field = picker;

    const align = h('select', { id: 'lay-align' }, ...Object.entries(ALIGN_LABELS).map(([k, l]) => h('option', { value: k }, l)));
    align.addEventListener('change', () => app.selected && app.patchLayout(app.selected, { align: align.value }));
    inputs.align = align;

    const style = h('select', { id: 'lay-style' }, ...Object.entries(C.render.STYLES).map(([k, s]) => h('option', { value: k }, s.label)));
    style.addEventListener('change', () => app.selected && app.patchLayout(app.selected, { style: style.value }));
    inputs.style = style;

    const shadow = h('input', { type: 'checkbox', id: 'lay-shadow' });
    shadow.addEventListener('change', () => app.selected && app.patchLayout(app.selected, { shadow: shadow.checked }));
    inputs.shadow = shadow;

    const resetOne = h('button', { type: 'button', onclick: () => {
      if (!app.selected) return;
      app.resetLayout(app.selected);
      toast(`「${app.fieldDef(app.selected).label}」已回到範本預設位置`, 'info');
    } }, '重設這一欄');
    const resetAll = h('button', { type: 'button', class: 'danger-text', onclick: async () => {
      if (!(await confirm('重設全部版面？', `「${app.template.name}」範本的所有欄位會回到預設位置、字級與樣式。`, { okText: '全部重設', danger: true }))) return;
      app.resetLayout();
      toast('版面已全部重設', 'info');
    } }, '全部重設');
    inputs.resetOne = resetOne;

    $('layoutPanel').replaceChildren(
      h('div', { class: 'grid2' }, h('label', { for: 'layField' }, '調整欄位'), picker),
      h('p', { class: 'note', id: 'layHint' }, '在預覽上點選文字，或從上方選擇欄位。拖曳文字可移動，方向鍵微調。'),
      h('fieldset', { id: 'layControls', class: 'plain' },
        h('legend', { class: 'sr-only' }, '欄位版面'),
        h('div', { class: 'grid2' },
          ...numberRow('x'), ...numberRow('y'), ...numberRow('scale'), ...numberRow('spacing'), ...numberRow('maxWidth'),
          h('label', { for: 'lay-align' }, '對齊'), align,
          h('label', { for: 'lay-style' }, '文字樣式'), style),
        h('label', { class: 'check' }, shadow, ' 文字陰影'),
        h('div', { class: 'row wrap' }, resetOne, resetAll)),
      h('p', { class: 'note' }, '每個範本的版面分開儲存；更換範本不會弄亂原本的位置。'));
  }

  function sync() {
    const f = app.selected ? app.field(app.selected) : null;
    inputs.field.value = app.selected || '';
    $('layControls').disabled = !f;
    $('layHint').hidden = Boolean(f);
    if (!f) return;
    Object.entries(NUMBERS).forEach(([name, spec]) => {
      if (document.activeElement !== inputs[name]) inputs[name].value = spec[4](f);
    });
    inputs.align.value = f.align;
    inputs.style.value = f.style;
    inputs.shadow.checked = f.shadow;
    inputs.resetOne.disabled = !Object.keys(app.layoutOf(f.key)).length;
    inputs.resetOne.title = inputs.resetOne.disabled ? '這一欄還沒調整過，已是範本預設位置' : '';
  }

  function init(a) {
    app = a;
    build();
  }

  function update(changes) {
    if (['all', 'select', 'layout', 'template', 'fontsReady'].some((c) => changes.has(c))) sync();
  }

  C.ui.layout = { init, update };
})();
