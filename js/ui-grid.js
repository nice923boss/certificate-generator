// Thumbnail overview of every certificate. Thumbnails render lazily, one per
// frame, only once they scroll near the viewport; clicking one opens it.
(function () {
  'use strict';

  const C = window.Cert;
  const { $, h } = C.ui.common;
  const THUMB_W = 180; // CSS px
  const REDRAW = ['all', 'roster', 'values', 'options', 'fieldProps', 'layout', 'template', 'background', 'fontsReady'];
  let app;
  let observer;
  let queue = [];
  let pumping = false;
  let dirty = true;
  let generation = 0;
  let wasVisible = false;

  const isGrid = () => app.state.view.mode === 'grid';

  function open(index) {
    app.set((s) => ({ ...s, view: { ...s.view, current: index, mode: 'single' } }), ['page', 'view']);
    $('preview').focus();
  }

  function renderThumb(item) {
    const page = app.pages[Number(item.dataset.index)];
    if (!page) return;
    const t = app.template;
    const canvas = item.querySelector('canvas');
    const scale = (THUMB_W * Math.min(2, window.devicePixelRatio || 1)) / t.width;
    canvas.width = Math.round(t.width * scale);
    canvas.height = Math.round(t.height * scale);
    const bgReady = app.background && app.background.id === t.id;
    C.render.drawPage(canvas.getContext('2d'), {
      template: t,
      background: bgReady ? app.background.bitmap : null,
      fields: app.fields,
      texts: page.texts,
      scale,
      fill: bgReady ? null : '#24324d',
    });
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    const gen = generation;
    while (queue.length && gen === generation) {
      renderThumb(queue.shift());
      await new Promise((r) => requestAnimationFrame(r));
    }
    pumping = false;
    if (queue.length) pump();
  }

  function marks(item, page) {
    const warnings = app.warningsFor(page);
    const cur = page.index === app.state.view.current;
    item.classList.toggle('current', cur);
    item.classList.toggle('has-warn', warnings.length > 0);
    if (cur) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
    item.title = [page.name, ...warnings.map((w) => w.text)].join('\n');
  }

  function build() {
    generation++;
    queue = [];
    observer.disconnect();
    const t = app.template;
    const items = app.pages.map((p) => {
      const item = h('button', { type: 'button', class: 'thumb', dataset: { index: p.index }, onclick: () => open(p.index) },
        h('canvas', { width: THUMB_W, height: Math.round((THUMB_W * t.height) / t.width), 'aria-hidden': 'true' }),
        h('span', { class: 'thumb-label' }, `${p.index + 1}. ${p.name}${p.sample ? '（範例）' : ''}`));
      marks(item, p);
      return item;
    });
    $('grid').replaceChildren(...items);
    items.forEach((el) => observer.observe(el));
  }

  function refreshMarks() {
    $('grid').querySelectorAll('.thumb').forEach((item) => {
      const page = app.pages[Number(item.dataset.index)];
      if (page) marks(item, page);
    });
  }

  function init(a) {
    app = a;
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          observer.unobserve(en.target);
          queue.push(en.target);
        });
        pump();
      },
      { root: $('viewport'), rootMargin: '300px' }
    );
  }

  function update(changes) {
    if (REDRAW.some((c) => changes.has(c))) dirty = true;
    const visible = isGrid();
    $('grid').hidden = !visible;
    if (!visible) {
      wasVisible = false;
      return;
    }
    if (dirty) {
      build();
      dirty = false;
    } else if (changes.has('page') || changes.has('analysis')) {
      refreshMarks();
    }
    if (!wasVisible) {
      const cur = $('grid').querySelector('.thumb.current');
      if (cur) cur.scrollIntoView({ block: 'center' });
    }
    wasVisible = true;
  }

  C.ui.grid = { init, update };
})();
