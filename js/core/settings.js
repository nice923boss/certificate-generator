// Saved settings: defaults, validation of anything read back from storage or an
// imported JSON file, migration from the v1 format, and setting profiles.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./text.js'));
  else (root.Cert = root.Cert || {}).settings = factory(root.Cert.text);
})(typeof self !== 'undefined' ? self : this, function (text) {
  'use strict';

  const VERSION = 2;
  const FILE_MARK = 'cert-generator';
  const ALIGNS = ['left', 'center', 'right'];
  const FONT_SOURCES = ['default', 'local', 'upload'];

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function fontDefault() {
    return { source: 'default', id: '', label: '', weight: 0 };
  }

  // ctx: { fields: Cert.FIELDS }
  function defaults(ctx) {
    const values = {};
    ctx.fields.forEach((d) => {
      if (!d.fromRoster) values[d.key] = d.value ?? '';
    });
    return {
      version: VERSION,
      templateId: 'navy-gold',
      customTemplates: [],
      roster: '',
      values,
      fieldProps: {},
      layouts: {},
      fonts: { name: fontDefault(), body: fontDefault() },
      options: {
        sampleName: '王小明',
        serialStart: 1,
        serialPad: 3,
        autoSpace: false,
        halfWidth: false,
        dateIso: '',
        dateStyle: 'roc',
      },
      export: {
        format: 'pdf',
        paper: 'a4-center',
        overprint: false,
        bgFormat: 'jpeg',
        jpegQuality: 0.92,
        scale: 2,
        range: 'all',
        rangeText: '',
        fileName: '結業證書_{班級名稱}_{人數}人',
        itemName: '{序號}_{姓名}',
      },
      view: { current: 0, zoom: 'fit', guides: false, textOnly: false, mode: 'single', collapsed: {}, tipDismissed: false },
    };
  }

  const RULES = {
    roster: { maxLength: 1000000 },
    'options.serialStart': { int: true, min: 0, max: 999999 },
    'options.serialPad': { int: true, min: 0, max: 8 },
    'options.dateIso': { pattern: /^(\d{4}-\d{2}-\d{2})?$/ },
    'options.dateStyle': { oneOf: Object.keys(text.DATE_STYLES) },
    'export.format': { oneOf: ['pdf', 'pdf-zip', 'png-zip', 'jpg-zip'] },
    'export.paper': { oneOf: ['a4-center', 'a4-full', 'native'] },
    'export.bgFormat': { oneOf: ['jpeg', 'png'] },
    'export.jpegQuality': { min: 0.5, max: 1 },
    'export.scale': { oneOf: [1, 2, 3] },
    'export.range': { oneOf: ['all', 'current', 'custom'] },
    'view.current': { int: true, min: 0 },
    'view.zoom': { oneOf: ['fit', '0.25', '0.5', '0.75', '1', '1.5'] },
    'view.mode': { oneOf: ['single', 'grid'] },
  };
  ['name', 'body'].forEach((slot) => {
    RULES[`fonts.${slot}.source`] = { oneOf: FONT_SOURCES };
    RULES[`fonts.${slot}.weight`] = { int: true, min: 0, max: 1000 };
  });

  function valid(v, fallback, rule = {}) {
    if (typeof v !== typeof fallback) return false;
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || (rule.int && !Number.isInteger(v))) return false;
      if ((rule.min != null && v < rule.min) || (rule.max != null && v > rule.max)) return false;
    }
    if (typeof v === 'string') {
      if (v.length > (rule.maxLength || 2000)) return false;
      if (rule.pattern && !rule.pattern.test(v)) return false;
    }
    return !rule.oneOf || rule.oneOf.includes(v);
  }

  // Copies valid values of `raw` onto the shape of `def`; invalid paths go to `bad`.
  // Objects with dynamic keys (empty in the defaults) are handled by the caller.
  function merge(def, raw, path, bad) {
    if (raw !== undefined && !isObj(raw)) bad.push(path);
    const src = isObj(raw) ? raw : {};
    const out = {};
    Object.entries(def).forEach(([k, dv]) => {
      const p = path ? `${path}.${k}` : k;
      const rv = src[k];
      if (isObj(dv) && Object.keys(dv).length) out[k] = merge(dv, rv, p, bad);
      else if (isObj(dv) || Array.isArray(dv)) out[k] = clone(dv);
      else if (rv === undefined) out[k] = dv;
      else if (valid(rv, dv, RULES[p])) out[k] = rv;
      else {
        out[k] = dv;
        bad.push(p);
      }
    });
    return out;
  }

  function cleanFieldProps(raw, fieldKeys) {
    const out = {};
    if (!isObj(raw)) return out;
    Object.entries(raw).forEach(([key, p]) => {
      if (!fieldKeys.includes(key) || !isObj(p)) return;
      const v = {};
      if (typeof p.prefix === 'string' && p.prefix.length <= 200) v.prefix = p.prefix;
      if (typeof p.suffix === 'string' && p.suffix.length <= 200) v.suffix = p.suffix;
      if (typeof p.hidden === 'boolean') v.hidden = p.hidden;
      if (p.font === 'name' || p.font === 'body') v.font = p.font;
      if (Object.keys(v).length) out[key] = v;
    });
    return out;
  }

  const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

  function cleanLayout(p, styleKeys) {
    const v = {};
    if (num(p.dx, -10000, 10000)) v.dx = p.dx;
    if (num(p.dy, -10000, 10000)) v.dy = p.dy;
    if (num(p.scale, 0.2, 5)) v.scale = p.scale;
    if (num(p.spacing, -0.5, 2)) v.spacing = p.spacing;
    if (num(p.maxWidth, 20, 10000)) v.maxWidth = p.maxWidth;
    if (ALIGNS.includes(p.align)) v.align = p.align;
    if (styleKeys.includes(p.style)) v.style = p.style;
    if (typeof p.shadow === 'boolean') v.shadow = p.shadow;
    return v;
  }

  function cleanLayouts(raw, fieldKeys, styleKeys) {
    const out = {};
    if (!isObj(raw)) return out;
    Object.entries(raw).forEach(([tid, fields]) => {
      if (!isObj(fields) || tid.length > 60) return;
      const t = {};
      Object.entries(fields).forEach(([key, p]) => {
        if (!fieldKeys.includes(key) || !isObj(p)) return;
        const v = cleanLayout(p, styleKeys);
        if (Object.keys(v).length) t[key] = v;
      });
      if (Object.keys(t).length) out[tid] = t;
    });
    return out;
  }

  function cleanCustomTemplates(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (t) =>
          isObj(t) &&
          /^custom-[\w-]{1,40}$/.test(t.id) &&
          typeof t.name === 'string' &&
          num(t.width, 100, 10000) &&
          num(t.height, 100, 10000)
      )
      .slice(0, 30)
      .map((t) => ({ id: t.id, name: t.name.slice(0, 60), width: Math.round(t.width), height: Math.round(t.height) }));
  }

  // The v1 format was { names, fields, fonts: { name, other: { local, label } } }.
  function fromV1(raw) {
    const font = (f) =>
      isObj(f) && typeof f.local === 'string'
        ? { source: 'local', id: f.local, label: String(f.label || f.local), weight: 0 }
        : undefined;
    const fonts = isObj(raw.fonts) ? raw.fonts : {};
    return {
      roster: typeof raw.names === 'string' ? raw.names : '',
      values: isObj(raw.fields) ? raw.fields : {},
      fonts: { name: font(fonts.name), body: font(fonts.other) },
    };
  }

  // ctx: { fields, styles: [style keys], templateIds: [built-in ids] }
  // -> { state, notes: [messages for the user] }
  function sanitize(raw, ctx) {
    const notes = [];
    let src = raw;
    if (raw != null && !isObj(raw)) {
      notes.push('儲存的設定已損毀，已改用預設值');
      src = {};
    } else if (isObj(raw) && raw.version !== VERSION && ('names' in raw || 'fields' in raw)) {
      src = fromV1(raw);
      notes.push('已沿用舊版的名單與欄位內容');
    }
    src = src || {};
    const bad = [];
    const state = merge(defaults(ctx), src, '', bad);
    const fieldKeys = ctx.fields.map((d) => d.key);
    state.version = VERSION;
    state.fieldProps = cleanFieldProps(src.fieldProps, fieldKeys);
    state.layouts = cleanLayouts(src.layouts, fieldKeys, ctx.styles || []);
    state.customTemplates = cleanCustomTemplates(src.customTemplates);
    const collapsed = isObj(src.view) && isObj(src.view.collapsed) ? src.view.collapsed : {};
    Object.entries(collapsed).forEach(([k, v]) => {
      if (typeof v === 'boolean' && k.length <= 40) state.view.collapsed[k] = v;
    });
    const ids = [...(ctx.templateIds || ['navy-gold']), ...state.customTemplates.map((t) => t.id)];
    if (!ids.includes(state.templateId)) {
      if (src.templateId !== undefined) bad.push('templateId');
      state.templateId = ids[0];
    }
    const realBad = bad.filter((p) => p !== 'version');
    if (realBad.length) notes.push(`設定中有 ${realBad.length} 個值無效，已改回預設值`);
    return { state, notes };
  }

  // A profile is everything except the roster and the view position.
  function toProfile(state) {
    const { roster, view, ...rest } = clone(state);
    return rest;
  }

  function applyProfile(state, profile, ctx) {
    return sanitize({ ...clone(profile), version: VERSION, roster: state.roster, view: state.view }, ctx);
  }

  function profileToJson(name, profile, now = new Date()) {
    return JSON.stringify({ app: FILE_MARK, kind: 'profile', version: VERSION, name, savedAt: now.toISOString(), data: profile }, null, 2);
  }

  // Validates an imported JSON file and returns { name, profile }.
  function profileFromJson(source, ctx) {
    let doc;
    try {
      doc = JSON.parse(source);
    } catch (err) {
      throw new Error('檔案不是有效的 JSON');
    }
    if (!isObj(doc) || doc.app !== FILE_MARK || doc.kind !== 'profile' || !isObj(doc.data)) {
      throw new Error('這不是結業證書產生器匯出的設定檔');
    }
    if (doc.version > VERSION) throw new Error('設定檔來自較新的版本，請更新本工具後再匯入');
    const { state, notes } = sanitize({ ...doc.data, version: VERSION }, ctx);
    return { name: typeof doc.name === 'string' ? doc.name.slice(0, 60) : '匯入的設定', profile: toProfile(state), notes };
  }

  return { VERSION, defaults, sanitize, toProfile, applyProfile, profileToJson, profileFromJson };
});
