// Draws certificate text with gradient, bevel and foil styles. All coordinates
// are template pixels; callers set ctx's transform to `scale` and pass the same
// scale in, because canvas shadow values ignore the transform.
(function () {
  'use strict';

  const FONT_FAMILY = '"Noto Serif TC", "Source Han Serif TC", "PMingLiU", serif';

  const STYLES = {
    gold: {
      label: '立體金箔',
      stops: [[0, '#fdeaa4'], [0.35, '#f8d57a'], [0.65, '#efbd5f'], [0.9, '#e0a94a'], [1, '#e8bb62']],
      shadow: { color: 'rgba(0, 0, 0, 0.75)', blur: 10, x: 2, y: 4 },
      bevel: { dark: '#6e4a12', light: '#fff4c6', depth: 1.2 },
      foil: true,
    },
    goldLight: {
      label: '淡金浮雕',
      stops: [[0, '#fffbe2'], [0.45, '#f7e3a8'], [1, '#e6c27a']],
      shadow: { color: 'rgba(0, 0, 0, 0.7)', blur: 8, x: 2, y: 4 },
      bevel: { dark: '#7a5a22', light: '#fffbe8', depth: 1 },
    },
    cream: {
      label: '米白',
      stops: [[0, '#fffaf0'], [1, '#efe3c6']],
      shadow: { color: 'rgba(0, 0, 0, 0.8)', blur: 8, x: 2, y: 4 },
    },
    goldFlat: {
      label: '平面金',
      stops: [[0, '#f6d888'], [1, '#d6a548']],
      shadow: { color: 'rgba(0, 0, 0, 0.6)', blur: 6, x: 1, y: 3 },
    },
    white: {
      label: '純白',
      stops: [[0, '#ffffff'], [1, '#ffffff']],
      shadow: { color: 'rgba(0, 0, 0, 0.7)', blur: 6, x: 1, y: 3 },
    },
    navy: { label: '深藍（淺色底圖用）', stops: [[0, '#1f3d6e'], [1, '#0f2a4f']] },
    black: { label: '黑色（淺色底圖用）', stops: [[0, '#111111'], [1, '#111111']] },
  };

  const CJK = /[⺀-鿿豈-﫿︰-﹏＀-￯　-〿]/;

  const fontSpec = (weight, size, family) => `${weight} ${size}px ${family}`;

  // Gold-leaf grain: coarse random speckles, made once and shared.
  let foilTile = null;
  function foilTexture() {
    if (foilTile) return foilTile;
    const n = 96;
    const noise = document.createElement('canvas');
    noise.width = noise.height = n;
    const nctx = noise.getContext('2d');
    const img = nctx.createImageData(n, n);
    for (let i = 0; i < img.data.length; i += 4) {
      const light = Math.random() < 0.5;
      img.data.set(light ? [255, 232, 140] : [150, 96, 22], i);
      img.data[i + 3] = Math.random() * 100;
    }
    nctx.putImageData(img, 0, 0);
    foilTile = document.createElement('canvas');
    foilTile.width = foilTile.height = n * 7;
    foilTile.getContext('2d').drawImage(noise, 0, 0, foilTile.width, foilTile.height);
    return foilTile;
  }

  const patterns = new WeakMap();
  function foilPattern(ctx) {
    if (!patterns.has(ctx)) patterns.set(ctx, ctx.createPattern(foilTexture(), 'repeat'));
    return patterns.get(ctx);
  }

  // Unit widths by font, so re-rendering the same names skips measureText.
  // Cleared when a font finishes loading, since fallback widths are then stale.
  const widths = new Map();
  const MAX_WIDTHS = 2000;
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.addEventListener('loadingdone', () => widths.clear());
  }
  const measureCtx = document.createElement('canvas').getContext('2d');

  function unitWidth(ctx, unit) {
    const key = `${ctx.font}\u0000${unit}`;
    let w = widths.get(key);
    if (w === undefined) {
      if (widths.size >= MAX_WIDTHS) widths.clear();
      w = ctx.measureText(unit).width;
      widths.set(key, w);
    }
    return w;
  }

  // Each CJK character and each space is its own unit (letter spacing goes
  // between units); Latin/digit runs stay together so "115" is not spread out.
  function splitUnits(text) {
    const units = [];
    let run = '';
    for (const ch of text) {
      if (CJK.test(ch) || ch === ' ') {
        if (run) units.push(run);
        run = '';
        units.push(ch);
      } else {
        run += ch;
      }
    }
    if (run) units.push(run);
    return units;
  }

  // A space gets letter spacing on one side only, so "完成 115" is not too wide.
  function measureLine(ctx, units, f, size) {
    ctx.font = fontSpec(f.weight, size, f.family);
    const spacing = size * f.spacing;
    const xs = [];
    let x = 0;
    units.forEach((u, i) => {
      if (i > 0 && units[i - 1] !== ' ') x += spacing;
      xs.push(x);
      x += unitWidth(ctx, u);
    });
    return { xs, total: x };
  }

  // Final size and position of one line; text wider than maxWidth shrinks.
  function layoutText(ctx, f, text) {
    const units = splitUnits(text);
    let size = f.size;
    let line = measureLine(ctx, units, f, size);
    let ratio = 1;
    if (line.total > f.maxWidth) {
      ratio = f.maxWidth / line.total;
      size *= ratio;
      line = measureLine(ctx, units, f, size);
    }
    const left = f.align === 'left' ? f.x : f.align === 'right' ? f.x - line.total : f.x - line.total / 2;
    return { units, size, xs: line.xs, total: line.total, left, ratio };
  }

  // box: the line's em box; ink: box plus room for shadow, bevel and glyph
  // overhang, used to crop per-field images.
  function bounds(f, lay) {
    const style = STYLES[f.style];
    const k = lay.size / 100;
    const sh = f.shadow && style.shadow;
    const shadowPad = sh ? sh.blur * 1.5 + Math.max(Math.abs(sh.x), Math.abs(sh.y)) : 0;
    const bevelPad = style.bevel ? style.bevel.depth : 0;
    const pad = (shadowPad + bevelPad) * k + lay.size * 0.3;
    const box = { x: lay.left, y: f.y - lay.size / 2, w: lay.total, h: lay.size };
    const ink = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
    return { box, ink };
  }

  function paint(ctx, f, lay, scale) {
    const style = STYLES[f.style];
    const { units, xs, left, size } = lay;
    const y = f.y;
    const k = size / 100;
    const fillAt = (dx, dy) => {
      units.forEach((u, i) => ctx.fillText(u, left + xs[i] + dx, y + dy));
    };

    ctx.save();
    ctx.font = fontSpec(f.weight, size, f.family);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    if (f.shadow && style.shadow) {
      ctx.save();
      ctx.shadowColor = style.shadow.color;
      ctx.shadowBlur = style.shadow.blur * k * scale;
      ctx.shadowOffsetX = style.shadow.x * k * scale;
      ctx.shadowOffsetY = style.shadow.y * k * scale;
      ctx.fillStyle = style.bevel ? style.bevel.dark : '#000';
      fillAt(0, 0);
      ctx.restore();
    }

    if (style.bevel) {
      const d = style.bevel.depth * k;
      ctx.fillStyle = style.bevel.dark;
      fillAt(d, d);
      ctx.fillStyle = style.bevel.light;
      fillAt(-d * 0.6, -d * 0.6);
    }

    const gradient = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    style.stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
    ctx.fillStyle = gradient;
    fillAt(0, 0);

    if (style.foil) {
      const pattern = foilPattern(ctx);
      pattern.setTransform(new DOMMatrix().translate(left, y - size));
      ctx.fillStyle = pattern;
      fillAt(0, 0);
    }
    ctx.restore();
  }

  // Template geometry + the user's layout tweaks for this template + fonts.
  // fonts: { name: { family, weight }, body: { family, weight } }, where family
  // is a registered alias or '' for the default stack and weight 0 means
  // "keep the template weight". The name field uses the name slot by default.
  function resolveFields(template, layout = {}, fieldProps = {}, fonts = {}) {
    return Object.entries(template.fields).map(([key, base]) => {
      const t = layout[key] || {};
      const slot = (fieldProps[key] || {}).font || (key === 'name' ? 'name' : 'body');
      const font = fonts[slot] || {};
      return {
        key,
        base,
        x: base.x + (t.dx || 0),
        y: base.y + (t.dy || 0),
        size: base.size * (t.scale || 1),
        weight: font.weight || base.weight,
        spacing: t.spacing ?? base.spacing,
        maxWidth: t.maxWidth ?? base.maxWidth,
        align: t.align || base.align,
        style: STYLES[t.style] ? t.style : base.style,
        shadow: t.shadow !== false,
        family: font.family ? `"${font.family}", ${FONT_FAMILY}` : FONT_FAMILY,
      };
    });
  }

  // Draws every non-empty field. Returns { key: { box, ink, ratio, size } }.
  function drawTexts(ctx, fields, texts, scale) {
    const info = {};
    fields.forEach((f) => {
      const text = texts[f.key];
      if (!text) return;
      const lay = layoutText(ctx, f, text);
      paint(ctx, f, lay, scale);
      info[f.key] = { ...bounds(f, lay), ratio: lay.ratio, size: lay.size };
    });
    return info;
  }

  // ctx's canvas is template size * scale. Without a background (text-only
  // preview, overprint) the page gets `fill` or stays transparent.
  function drawPage(ctx, { template, background, fields, texts, scale, fill }) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    if (background) ctx.drawImage(background, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return drawTexts(ctx, fields, texts, scale);
  }

  function makeCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    return canvas;
  }

  function renderPageCanvas(opts) {
    const canvas = makeCanvas(opts.template.width * opts.scale, opts.template.height * opts.scale);
    const info = drawPage(canvas.getContext('2d'), opts);
    return { canvas, info };
  }

  // One small transparent image per field, cropped to its ink box, so a PDF
  // stores a few text strips instead of a full-page text layer.
  // -> [{ key, canvas, x, y, w, h }] with position and size in template px.
  function renderFieldImages(fields, texts, scale) {
    const out = [];
    fields.forEach((f) => {
      const text = texts[f.key];
      if (!text) return;
      const lay = layoutText(measureCtx, f, text);
      const { ink } = bounds(f, lay);
      const canvas = makeCanvas(Math.ceil(ink.w * scale), Math.ceil(ink.h * scale));
      const ctx = canvas.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, -ink.x * scale, -ink.y * scale);
      paint(ctx, f, lay, scale);
      out.push({ key: f.key, canvas, x: ink.x, y: ink.y, w: canvas.width / scale, h: canvas.height / scale });
    });
    return out;
  }

  // Shrink ratio and box of a field without drawing (1 = fits at full size).
  function measureField(f, text) {
    if (!text) return { ratio: 1, box: null };
    const lay = layoutText(measureCtx, f, text);
    return { ratio: lay.ratio, size: lay.size, box: bounds(f, lay).box };
  }

  // Web fonts load per character subset; load each font's glyphs once.
  const loaded = new Map();
  function ensureFonts(fields, textsList) {
    const jobs = [];
    fields.forEach((f) => {
      const spec = fontSpec(f.weight, 16, f.family);
      const have = loaded.get(spec) || new Set();
      loaded.set(spec, have);
      let fresh = '';
      // Warm each font once even when all of its texts are empty.
      if (!have.size) {
        have.add('永');
        fresh = '永';
      }
      textsList.forEach((texts) => {
        for (const ch of texts[f.key] || '') {
          if (!have.has(ch)) {
            have.add(ch);
            fresh += ch;
          }
        }
      });
      if (fresh) jobs.push(document.fonts.load(spec, fresh));
    });
    return Promise.all(jobs);
  }

  // Background images decode once into an ImageBitmap where supported.
  async function loadImage(src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    return typeof createImageBitmap === 'function' ? createImageBitmap(img) : img;
  }

  window.Cert = window.Cert || {};
  window.Cert.render = {
    FONT_FAMILY,
    STYLES,
    fontSpec,
    resolveFields,
    drawTexts,
    drawPage,
    renderPageCanvas,
    renderFieldImages,
    measureField,
    ensureFonts,
    loadImage,
  };
})();
