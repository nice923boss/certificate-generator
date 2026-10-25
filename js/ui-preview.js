// Single-page preview: canvas sized to the viewport and device pixel ratio,
// click to select a field, drag to move it with centre snapping, double-click
// to edit its text, zoom, full screen, guides, A4 crop shading and the pager.
(function () {
  'use strict';

  const C = window.Cert;
  const { $, clamp } = C.ui.common;
  const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5];
  const SNAP = 10; // template px
  const HIT_PAD = 8; // template px
  let app;
  let canvas;
  let shown = 1; // CSS px per template px
  let info = {};
  let drag = null; // { key, start: {x, y}, origin: {x, y}, at: {x, y}, moved }
  let frame = 0;

  const isGrid = () => app.state.view.mode === 'grid';

  function displayScale() {
    const t = app.template;
    const zoom = app.state.view.zoom;
    if (zoom !== 'fit') return Number(zoom);
    const vp = $('viewport');
    return Math.max(0.05, Math.min((vp.clientWidth - 32) / t.width, (vp.clientHeight - 32) / t.height));
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function fieldsForDraw() {
    if (!drag || !drag.moved) return app.fields;
    return app.fields.map((f) => (f.key === drag.key ? { ...f, x: drag.at.x, y: drag.at.y } : f));
  }

  function draw() {
    frame = 0;
    if (isGrid() || !app.template) return;
    const t = app.template;
    const page = app.current();
    const view = app.state.view;
    shown = displayScale();
    const res = Math.min(1, shown * (window.devicePixelRatio || 1));
    const w = Math.round(t.width * res);
    const hgt = Math.round(t.height * res);
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
    }
    const sheet = $('sheet');
    sheet.style.width = `${t.width * shown}px`;
    sheet.style.height = `${t.height * shown}px`;
    const bgReady = app.background && app.background.id === t.id;
    sheet.classList.toggle('checker', view.textOnly);
    $('loading').hidden = bgReady || view.textOnly;
    info = C.render.drawPage(canvas.getContext('2d'), {
      template: t,
      background: !view.textOnly && bgReady ? app.background.bitmap : null,
      fields: fieldsForDraw(),
      texts: page.texts,
      scale: res,
      fill: view.textOnly ? null : bgReady ? null : '#24324d',
    });
    drawOverlay();
  }

  const px = (v) => `${v * shown}px`;
  function place(el, r) {
    el.style.left = px(r.x);
    el.style.top = px(r.y);
    el.style.width = px(r.w);
    el.style.height = px(r.h);
  }

  function drawOverlay() {
    const t = app.template;
    $('overlay').classList.toggle('show-guides', app.state.view.guides);
    // Selection box
    const box = $('selectBox');
    const sel = app.selected && info[app.selected];
    box.hidden = !sel;
    if (sel) {
      const b = sel.box;
      place(box, { x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12 });
      $('selectLabel').textContent = app.fieldDef(app.selected).label;
    }
    // A4 full-bleed crop: shade what the printed page cuts off.
    const crop = $('crop');
    const ex = app.state.export;
    const cropOn = ex.paper === 'a4-full' && ex.format.startsWith('pdf');
    crop.hidden = !cropOn;
    if (cropOn) {
      const g = C.exporter.pageGeometry(t, 'a4-full');
      place(crop, {
        x: (-g.img.x / g.img.w) * t.width,
        y: (-g.img.y / g.img.h) * t.height,
        w: (g.page.w / g.img.w) * t.width,
        h: (g.page.h / g.img.h) * t.height,
      });
    }
  }

  // ---- Pointer interaction ----
  function toTemplate(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * app.template.width, y: ((e.clientY - r.top) / r.height) * app.template.height };
  }

  // Smallest box under the point wins, so the serial number beats a wide line.
  function hitTest(p) {
    let best = null;
    Object.entries(info).forEach(([key, { box }]) => {
      const inside = p.x >= box.x - HIT_PAD && p.x <= box.x + box.w + HIT_PAD && p.y >= box.y - HIT_PAD && p.y <= box.y + box.h + HIT_PAD;
      if (inside && (!best || box.w * box.h < best.area)) best = { key, area: box.w * box.h };
    });
    return best && best.key;
  }

  function onDown(e) {
    if (e.button !== 0) return;
    const p = toTemplate(e);
    const key = hitTest(p);
    app.select(key || null);
    if (!key) return;
    const f = app.field(key);
    drag = { key, start: p, origin: { x: f.x, y: f.y }, at: { x: f.x, y: f.y }, moved: false };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onMove(e) {
    const p = toTemplate(e);
    if (!drag) {
      canvas.style.cursor = hitTest(p) ? 'move' : 'default';
      return;
    }
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) * shown < 3) return;
    drag.moved = true;
    let x = Math.round(drag.origin.x + dx);
    const y = Math.round(drag.origin.y + dy);
    const centre = app.template.width / 2;
    const snapped = !e.altKey && app.field(drag.key).align === 'center' && Math.abs(x - centre) < SNAP;
    if (snapped) x = centre;
    drag.at = { x, y };
    const line = $('snapLine');
    line.hidden = !snapped;
    if (snapped) line.style.left = px(centre);
    const coords = $('coords');
    coords.hidden = false;
    coords.textContent = `X ${x}，Y ${y}${snapped ? '（置中）' : ''}`;
    schedule();
  }

  function endDrag(commitIt) {
    if (!drag) return;
    const d = drag;
    drag = null;
    $('snapLine').hidden = true;
    $('coords').hidden = true;
    if (commitIt && d.moved) {
      const f = app.field(d.key);
      app.patchLayout(d.key, { dx: d.at.x - f.base.x, dy: d.at.y - f.base.y });
    } else {
      schedule();
    }
  }

  function onDblClick(e) {
    const key = hitTest(toTemplate(e));
    if (key) C.ui.fields.focusField(key);
  }

  // Ctrl + wheel steps through the zoom levels.
  function onWheel(e) {
    if (!e.ctrlKey || isGrid()) return;
    e.preventDefault();
    const now = displayScale();
    const next = e.deltaY < 0 ? ZOOMS.find((z) => z > now + 0.001) : [...ZOOMS].reverse().find((z) => z < now - 0.001);
    if (next) app.patch('view', { zoom: String(next) }, ['view']);
  }

  // ---- Toolbar ----
  function toggleView(key) {
    app.patch('view', { [key]: !app.state.view[key] }, ['view']);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('stage').requestFullscreen().catch((err) => C.ui.common.toast(`無法進入全螢幕：${err.message}`, 'warn'));
  }

  function syncToolbar() {
    const v = app.state.view;
    $('zoomSelect').value = v.zoom;
    $('zoomSelect').disabled = v.mode === 'grid';
    $('zoomSelect').title = v.mode === 'grid' ? '縮圖總覽固定大小，切回單張預覽才能縮放' : '縮放（Ctrl＋滾輪）';
    $('modeBtn').setAttribute('aria-pressed', String(v.mode === 'grid'));
    $('modeBtn').textContent = v.mode === 'grid' ? '單張預覽' : '縮圖總覽';
    $('guidesBtn').setAttribute('aria-pressed', String(v.guides));
    $('textOnlyBtn').setAttribute('aria-pressed', String(v.textOnly));
    $('sheet').hidden = v.mode === 'grid';
  }

  function syncPager() {
    const page = app.current();
    const n = app.pages.length;
    const i = page.index;
    $('pageInput').value = i + 1;
    $('pageInput').max = n;
    $('pageTotal').textContent = `／ ${n}`;
    $('pageName').textContent = page.sample ? `${page.name}（範例）` : page.name;
    $('firstBtn').disabled = $('prevBtn').disabled = i <= 0;
    $('lastBtn').disabled = $('nextBtn').disabled = i >= n - 1;
    canvas.setAttribute('aria-label', `證書預覽：第 ${i + 1}／${n} 位，${page.name}${page.sample ? '（範例）' : ''}`);
    const warnings = app.warningsFor(page);
    const box = $('pageWarnings');
    box.textContent = warnings.map((w) => `⚠ ${w.text}`).join('　');
    box.hidden = !warnings.length;
  }

  function init(a) {
    app = a;
    canvas = $('preview');
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', () => endDrag(true));
    canvas.addEventListener('pointercancel', () => endDrag(false));
    canvas.addEventListener('lostpointercapture', () => endDrag(true));
    canvas.addEventListener('dblclick', onDblClick);
    $('viewport').addEventListener('wheel', onWheel, { passive: false });

    $('firstBtn').addEventListener('click', () => app.goTo(0));
    $('prevBtn').addEventListener('click', () => app.goTo(app.state.view.current - 1));
    $('nextBtn').addEventListener('click', () => app.goTo(app.state.view.current + 1));
    $('lastBtn').addEventListener('click', () => app.goTo(app.pages.length - 1));
    $('pageInput').addEventListener('change', (e) => {
      const n = Number(e.target.value);
      if (Number.isFinite(n)) app.goTo(n - 1);
      syncPager();
    });
    $('zoomSelect').addEventListener('change', (e) => app.patch('view', { zoom: e.target.value }, ['view']));
    $('modeBtn').addEventListener('click', () => app.patch('view', { mode: isGrid() ? 'single' : 'grid' }, ['view']));
    $('guidesBtn').addEventListener('click', () => toggleView('guides'));
    $('textOnlyBtn').addEventListener('click', () => toggleView('textOnly'));
    const fs = $('fullscreenBtn');
    if (!document.fullscreenEnabled) fs.hidden = true;
    fs.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', () => {
      fs.textContent = document.fullscreenElement ? '離開全螢幕' : '全螢幕';
      schedule();
    });
    new ResizeObserver(() => {
      if (app.state.view.zoom === 'fit') schedule();
    }).observe($('viewport'));
  }

  function update(changes) {
    if (['all', 'view'].some((c) => changes.has(c))) syncToolbar();
    if (['all', 'page', 'roster', 'analysis', 'values', 'options', 'fieldProps', 'template', 'fontsReady'].some((c) => changes.has(c))) syncPager();
    if (changes.has('fontsReady') || changes.has('analysis') || changes.has('page') || changes.has('all')) {
      // Fonts may still be arriving; draw now and again once they are in.
      C.render.ensureFonts(app.fields, [app.current().texts]).then(schedule, schedule);
    }
    schedule();
  }

  C.ui.preview = { init, update, redraw: schedule };
})();
