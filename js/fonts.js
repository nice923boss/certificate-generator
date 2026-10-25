// Fonts besides the default web font: installed fonts through the Local Font
// Access API (Chrome / Edge) and font files the user uploads (kept in
// IndexedDB). Also finds characters a font cannot draw.
(function () {
  'use strict';

  const CJK_CHAR = /[\u3400-\u9FFF]/;
  const MAX_FONT_BYTES = 80 * 1024 * 1024;
  // Two visibly different fallbacks; a glyph the tested font lacks shows one of them.
  const FALLBACK_A = '"Microsoft JhengHei", "PingFang TC", sans-serif';
  const FALLBACK_B = '"PMingLiU", "Songti TC", serif';
  const WEB_FONT = 'Noto Serif TC';

  const quote = (name) => `"${String(name).replace(/["\\]/g, '\\$&')}"`;
  const aliases = new Map(); // "local:<name>" | "upload:<id>" -> alias family
  let aliasCount = 0;

  const probe = document.createElement('canvas');
  probe.width = probe.height = 48;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  function shot(font, ch) {
    probeCtx.clearRect(0, 0, 48, 48);
    probeCtx.font = font;
    probeCtx.fillText(ch, 4, 40);
    return probeCtx.getImageData(0, 0, 48, 48).data.join(',');
  }

  // ---- Installed fonts ----
  let localList = null;

  const localSupported = () => 'queryLocalFonts' in window;

  // True when the user already allowed font access, so the list can load
  // without a click.
  async function localGranted() {
    if (!localSupported() || !navigator.permissions) return false;
    try {
      return (await navigator.permissions.query({ name: 'local-fonts' })).state === 'granted';
    } catch (err) {
      return false;
    }
  }

  // Installed faces that can draw Chinese, Chinese-named families first.
  // -> [{ id, label, family }]. Throws 'unsupported' or the permission error.
  async function listLocal() {
    if (localList) return localList;
    if (!localSupported()) throw new Error('unsupported');
    const faces = await window.queryLocalFonts();
    const hasChinese = new Map();
    const seen = new Set();
    localList = faces
      .filter((f) => {
        if (!hasChinese.has(f.family)) {
          hasChinese.set(f.family, shot(`40px ${quote(f.family)}, ${FALLBACK_A}`, '永') === shot(`40px ${quote(f.family)}, ${FALLBACK_B}`, '永'));
        }
        return hasChinese.get(f.family);
      })
      .map((f) => ({ id: f.postscriptName || f.fullName, label: f.fullName, family: f.family }))
      .filter((f) => !seen.has(f.label) && seen.add(f.label))
      .sort(
        (a, b) =>
          CJK_CHAR.test(b.family) - CJK_CHAR.test(a.family) ||
          a.family.localeCompare(b.family, 'zh-Hant') ||
          a.label.localeCompare(b.label, 'zh-Hant')
      );
    return localList;
  }

  // ---- Uploaded fonts ----
  const MAGIC = { '00010000': 'TrueType', '4f54544f': 'OpenType', '74727565': 'TrueType', '774f4646': 'WOFF', '774f4632': 'WOFF2' };

  // Checks the file signature, then lets the browser parse it.
  async function validateFontFile(file) {
    if (file.size > MAX_FONT_BYTES) throw new Error(`字型檔太大（上限 ${MAX_FONT_BYTES / 1024 / 1024} MB）`);
    const buffer = await file.arrayBuffer();
    const sig = [...new Uint8Array(buffer.slice(0, 4))].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (sig === '74746366') throw new Error('不支援字型集合檔（.ttc），請改用單一字型的 .ttf 或 .otf');
    if (!MAGIC[sig]) throw new Error('不是有效的字型檔，支援 .ttf、.otf、.woff、.woff2');
    try {
      await new FontFace('cert-font-test', buffer).load();
    } catch (err) {
      console.warn('Font file rejected by the browser', file.name, err);
      throw new Error('瀏覽器無法讀取這個字型檔，檔案可能已損毀');
    }
    return buffer;
  }

  // Stores an uploaded font; -> { id, label, fileName, size }.
  async function addUpload(file) {
    const buffer = await validateFontFile(file);
    const record = {
      id: `font-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label: file.name.replace(/\.(ttf|otf|woff2?)$/i, ''),
      fileName: file.name,
      size: file.size,
      added: new Date().toISOString(),
      data: new Blob([buffer], { type: 'application/octet-stream' }),
    };
    await Cert.store.files.put('fonts', record);
    const { data, ...meta } = record;
    return meta;
  }

  async function listUploads() {
    const records = await Cert.store.files.all('fonts');
    return records
      .map(({ data, ...meta }) => meta)
      .sort((a, b) => a.added.localeCompare(b.added));
  }

  const removeUpload = (id) => Cert.store.files.remove('fonts', id);

  // ---- Registration ----

  // Makes a font choice ({ source, id }) usable on canvas; -> alias family,
  // or '' for the default font. The weight range covers every weight so a
  // field asking for 900 is drawn as designed, not faux-bolded.
  async function register(choice) {
    if (!choice || choice.source === 'default' || !choice.id) return '';
    const key = `${choice.source}:${choice.id}`;
    if (aliases.has(key)) return aliases.get(key);
    let src;
    if (choice.source === 'local') {
      src = `local(${quote(choice.id)})`;
    } else {
      const record = await Cert.store.files.get('fonts', choice.id);
      if (!record) throw new Error('找不到上傳的字型檔，可能已被刪除');
      src = await record.data.arrayBuffer();
    }
    const alias = `cert-font-${++aliasCount}`;
    const face = new FontFace(alias, src, { weight: '1 1000' });
    await face.load(); // rejects if an installed font is gone
    document.fonts.add(face);
    aliases.set(key, alias);
    return alias;
  }

  // True when the Google web font is usable (false offline).
  function webFontReady() {
    return [...document.fonts].some((f) => f.family.replace(/"/g, '') === WEB_FONT && f.status === 'loaded');
  }

  // Characters of `chars` that `alias` (or the web font when '') lacks.
  // The font must already be loaded for these characters.
  const glyphCache = new Map();
  function missingGlyphs(alias, weight, chars) {
    const family = quote(alias || WEB_FONT);
    const missing = [];
    new Set(Array.from(chars).filter((ch) => ch.trim())).forEach((ch) => {
      const key = `${family}|${weight}|${ch}`;
      if (!glyphCache.has(key)) {
        const a = shot(`${weight} 40px ${family}, ${FALLBACK_A}`, ch);
        glyphCache.set(key, a !== shot(`${weight} 40px ${family}, ${FALLBACK_B}`, ch));
      }
      if (glyphCache.get(key)) missing.push(ch);
    });
    return missing;
  }

  window.Cert = window.Cert || {};
  window.Cert.fonts = {
    localSupported,
    localGranted,
    listLocal,
    validateFontFile,
    addUpload,
    listUploads,
    removeUpload,
    register,
    webFontReady,
    missingGlyphs,
  };
})();
