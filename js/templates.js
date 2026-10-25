// Certificate templates. Coordinates are in background-image pixels: `x` is
// the anchor (centre for align "center", left / right edge otherwise; the image
// centre when omitted), `y` the vertical middle of the line. Text wider than
// `maxWidth` is shrunk to fit; `spacing` is letter spacing as a fraction of size.
(function () {
  'use strict';

  const BASE_WIDTH = 1536;
  const BASE_HEIGHT = 2048;

  const NAVY_GOLD_FIELDS = {
    className: { y: 742, size: 72, weight: 900, spacing: 0.22, maxWidth: 960, style: 'goldLight' },
    name: { y: 960, size: 133, weight: 900, spacing: 0.16, maxWidth: 560, style: 'gold' },
    line1: { y: 1181, size: 52, weight: 900, spacing: 0.15, maxWidth: 1040, style: 'cream' },
    line2: { y: 1266, size: 52, weight: 900, spacing: 0.15, maxWidth: 1040, style: 'cream' },
    organizer: { y: 1576, size: 45, weight: 900, spacing: 0.13, maxWidth: 1040, style: 'cream' },
    // Where the instructor line was baked into the original background.
    instructor: { y: 1650, size: 45, weight: 900, spacing: 0.13, maxWidth: 900, style: 'cream' },
    date: { y: 1763, size: 36, weight: 900, spacing: 0.26, maxWidth: 900, style: 'cream' },
    serial: { x: 1330, y: 335, size: 30, weight: 900, spacing: 0.08, maxWidth: 420, style: 'goldLight', align: 'right' },
  };

  const BUILT_IN = [
    {
      id: 'navy-gold',
      name: '深藍金框',
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
      builtin: true,
      fields: NAVY_GOLD_FIELDS,
    },
  ];

  function withDefaults(fields, width) {
    const out = {};
    Object.entries(fields).forEach(([key, f]) => {
      out[key] = { align: 'center', ...f, x: f.x ?? width / 2 };
    });
    return out;
  }

  // An uploaded background reuses the navy-gold layout, scaled to its size.
  function scaledFields(width, height) {
    const sx = width / BASE_WIDTH;
    const sy = height / BASE_HEIGHT;
    const s = Math.min(sx, sy);
    const out = {};
    Object.entries(withDefaults(NAVY_GOLD_FIELDS, BASE_WIDTH)).forEach(([key, f]) => {
      out[key] = { ...f, x: f.x * sx, y: f.y * sy, size: f.size * s, maxWidth: f.maxWidth * s };
    });
    return out;
  }

  // Template definitions for the select box: built-ins, then uploaded ones.
  function list(customTemplates) {
    return [
      ...BUILT_IN.map((t) => ({ id: t.id, name: t.name, builtin: true })),
      ...customTemplates.map((t) => ({ id: t.id, name: t.name, builtin: false })),
    ];
  }

  // Geometry of one template; `meta` is the state.customTemplates entry for uploads.
  function get(id, customTemplates) {
    const builtin = BUILT_IN.find((t) => t.id === id);
    if (builtin) return { ...builtin, fields: withDefaults(builtin.fields, builtin.width) };
    const meta = customTemplates.find((t) => t.id === id);
    if (!meta) return get(BUILT_IN[0].id, customTemplates);
    return { id: meta.id, name: meta.name, width: meta.width, height: meta.height, builtin: false, fields: scaledFields(meta.width, meta.height) };
  }

  const builtinBackground = (id) => (window.CERT_BACKGROUNDS || {})[id] || null;

  window.Cert = window.Cert || {};
  window.Cert.templates = { ids: BUILT_IN.map((t) => t.id), list, get, builtinBackground };
})();
