// Export panel and actions: format, paper, overprint, background format and
// quality, resolution, range, file name patterns; the export run with
// progress, time left and cancel; current-page PNG and printing.
(function () {
  'use strict';

  const C = window.Cert;
  const { $, h, toast, confirm } = C.ui.common;
  const { formatBytes, formatDuration, parseRange, sanitizeFileName, fillVars } = C.text;
  const FORMATS = { pdf: '合併成一個 PDF', 'pdf-zip': '每人一個 PDF（ZIP）', 'png-zip': '每人一張 PNG（ZIP）', 'jpg-zip': '每人一張 JPG（ZIP）' };
  const PAPERS = { 'a4-center': 'A4（完整顯示，四周留白）', 'a4-full': 'A4 滿版（裁掉超出部分）', native: '依底圖比例' };
  const BG_FORMATS = { jpeg: 'JPEG（檔案小）', png: 'PNG（無損，檔案大）' };
  const SCALES = { 1: '標準', 2: '高（建議）', 3: '最高（檔案較大）' };
  const RANGES = { all: '全部', current: '只有目前這位', custom: '指定範圍' };
  const EXT_LABEL = { pdf: 'PDF', 'pdf-zip': 'PDF', 'png-zip': 'PNG', 'jpg-zip': 'JPG' };
  let app;
  let busy = null; // AbortController while a job runs
  let printUrls = [];

  const ex = () => app.state.export;
  const setExport = (values) => app.patch('export', values, ['export']);
  const bgReady = () => app.background && app.background.id === app.template.id;

  // Indexes of the pages in the chosen range; throws a readable error.
  function selectedIndexes() {
    const o = ex();
    if (o.range === 'current') return [app.current().index];
    if (o.range === 'custom') return parseRange(o.rangeText, app.pages.length);
    return app.pages.map((p) => p.index);
  }

  function jobFor(pages) {
    return { pages, template: app.template, background: app.background, fields: app.fields, options: ex() };
  }

  // ---- Panel ----
  function select(id, options, onChange) {
    const el = h('select', { id }, ...Object.entries(options).map(([v, l]) => h('option', { value: v }, l)));
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  function textInput(id, key, placeholder) {
    const el = h('input', { type: 'text', id, maxlength: 80, placeholder, spellcheck: 'false' });
    el.addEventListener('change', () => setExport({ [key]: el.value.trim() }));
    return el;
  }

  function build() {
    const quality = h('input', { type: 'range', id: 'exQuality', min: 0.5, max: 1, step: 0.01 });
    quality.addEventListener('input', () => ($('exQualityValue').textContent = `${Math.round(quality.value * 100)}%`));
    quality.addEventListener('change', () => setExport({ jpegQuality: Number(quality.value) }));
    const overprint = h('input', { type: 'checkbox', id: 'exOverprint' });
    overprint.addEventListener('change', () => setExport({ overprint: overprint.checked }));
    const rangeText = textInput('exRangeText', 'rangeText', '例如 1-5, 8, 12-');

    $('exportPanel').replaceChildren(
      h('div', { class: 'grid2' },
        h('label', { for: 'exFormat' }, '格式'), select('exFormat', FORMATS, (v) => setExport({ format: v })),
        h('label', { for: 'exPaper' }, '紙張'), select('exPaper', PAPERS, (v) => setExport({ paper: v })),
        h('label', { for: 'exRange' }, '範圍'), select('exRange', RANGES, (v) => setExport({ range: v }))),
      h('div', { class: 'helper', id: 'exRangeRow', hidden: true },
        h('label', { for: 'exRangeText' }, '第幾位（用逗號分隔，可寫 3-8）'), rangeText,
        h('p', { class: 'note error-text', id: 'exRangeError', hidden: true })),
      h('p', { class: 'note', id: 'exCount' }),
      h('label', { class: 'check' }, overprint, ' 套印模式（不輸出底圖，印在已印好底圖的證書紙上）'),
      h('details', { class: 'sub' },
        h('summary', {}, '進階：畫質與檔名'),
        h('div', { class: 'grid2' },
          h('label', { for: 'exScale' }, '文字解析度'), select('exScale', SCALES, (v) => setExport({ scale: Number(v) })),
          h('label', { for: 'exBgFormat' }, '底圖格式'), select('exBgFormat', BG_FORMATS, (v) => setExport({ bgFormat: v })),
          h('label', { for: 'exQuality' }, 'JPEG 品質'), h('div', { class: 'row' }, quality, h('output', { id: 'exQualityValue', for: 'exQuality' }))),
        h('label', { for: 'exFileName' }, '檔名'),
        textInput('exFileName', 'fileName', '結業證書_{班級名稱}_{人數}人'),
        h('div', { id: 'exItemRow' },
          h('label', { for: 'exItemName' }, '每人的檔名（ZIP 內）'),
          textInput('exItemName', 'itemName', '{序號}_{姓名}')),
        h('p', { class: 'note' }, '檔名可用 {班級名稱}、{姓名}、{序號}、{人數}、{日期} 等變數。檔名不能用的符號會自動換掉。')),
      h('p', { class: 'note', id: 'exSizeHint' }));
  }

  // A disabled control says why on hover; the label carries it too because
  // some browsers show no tooltip over disabled inputs.
  function disableWithReason(id, reason) {
    $(id).disabled = Boolean(reason);
    $(id).title = reason;
    document.querySelector(`label[for="${id}"]`).title = reason;
  }

  function syncControls() {
    const o = ex();
    const image = !o.format.startsWith('pdf');
    $('exFormat').value = o.format;
    $('exPaper').value = o.paper;
    disableWithReason('exPaper', image ? '圖片依底圖原尺寸輸出，不套用紙張設定' : '');
    $('exRange').value = o.range;
    $('exRangeRow').hidden = o.range !== 'custom';
    if (document.activeElement !== $('exRangeText')) $('exRangeText').value = o.rangeText;
    $('exOverprint').checked = o.overprint;
    $('exScale').value = String(o.scale);
    $('exBgFormat').value = o.bgFormat;
    disableWithReason('exBgFormat', image ? '只有 PDF 需要選底圖格式' : o.overprint ? '套印模式不輸出底圖' : '');
    const usesJpeg = o.format === 'jpg-zip' || (!image && !o.overprint && o.bgFormat === 'jpeg');
    $('exQuality').value = o.jpegQuality;
    disableWithReason('exQuality', usesJpeg ? '' : '只有輸出 JPG，或 PDF 底圖選 JPEG 時才用得到');
    $('exQualityValue').textContent = `${Math.round(o.jpegQuality * 100)}%`;
    if (document.activeElement !== $('exFileName')) $('exFileName').value = o.fileName;
    if (document.activeElement !== $('exItemName')) $('exItemName').value = o.itemName;
    $('exItemRow').hidden = o.format === 'pdf';
    $('exSizeHint').textContent = o.overprint
      ? '套印模式只輸出文字，請先用「只看文字」檢查位置，再用一張白紙試印對位。'
      : image
        ? `每張圖片 ${app.template.width * o.scale} × ${app.template.height * o.scale} px（解析度設定會放大整張圖）。${o.format === 'png-zip' && o.scale > 1 ? 'PNG 放大後每張可達 20 MB 以上，人數多建議改 JPG 或「標準」。' : ''}`
        : o.format === 'pdf' && o.bgFormat === 'jpeg'
          ? '合併 PDF 的底圖只存一次，人數多檔案也不會變大太多。'
          : '';
  }

  function syncCount() {
    const o = ex();
    const err = $('exRangeError');
    let count = 0;
    try {
      count = selectedIndexes().length;
      err.hidden = true;
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
    const sample = app.pages.length === 1 && app.pages[0].sample;
    $('exCount').textContent = sample ? '名單是空的，只會輸出一張範例證書。' : `將輸出 ${count} 份（名單共 ${app.pages.length} 位）。`;
    const kind = o.format === 'pdf' || count === 1 ? EXT_LABEL[o.format] : 'ZIP';
    $('exportBtn').textContent = count > 1 ? `下載 ${kind}（${count} 份）` : `下載 ${kind}`;
  }

  // ---- Running jobs ----
  function setBusy(controller) {
    busy = controller;
    ['exportBtn', 'pngBtn', 'printBtn'].forEach((id) => ($(id).disabled = Boolean(controller)));
    $('progressBox').hidden = !controller;
    if (controller) {
      $('progress').value = 0;
      $('progressText').textContent = '準備中…';
      window.addEventListener('beforeunload', holdPage);
    } else {
      window.removeEventListener('beforeunload', holdPage);
    }
  }

  function holdPage(e) {
    e.preventDefault();
    e.returnValue = '';
  }

  function progressReporter(verb) {
    const started = performance.now();
    return ({ done, total, name }) => {
      $('progress').value = total ? done / total : 0;
      const left = done >= 2 ? `，約剩 ${formatDuration(((performance.now() - started) / done) * (total - done))}` : '';
      $('progressText').textContent = done < total ? `${verb} ${done + 1}／${total}：${name}${left}` : '打包中…';
    };
  }

  // Checks before a job; resolves with the pages to use or null.
  async function preparePages() {
    let indexes;
    try {
      indexes = selectedIndexes();
    } catch (err) {
      toast(err.message, 'error');
      return null;
    }
    if (!indexes.length) {
      toast('範圍內沒有任何一位', 'warn');
      return null;
    }
    if (!ex().overprint && !bgReady()) {
      toast('底圖還在載入，請稍候再試', 'warn');
      return null;
    }
    const pages = indexes.map((i) => app.pages[i]);
    if (pages.length === 1 && pages[0].sample && !(await confirm('名單是空的', `只會輸出一張範例證書（${pages[0].name}）。要繼續嗎？`, { okText: '繼續' }))) return null;
    const warned = pages.filter((p) => app.warningsFor(p).length);
    if (warned.length) {
      const lines = warned.slice(0, 8).map((p) => `${p.index + 1}. ${p.name}：${app.warningsFor(p).map((w) => w.text).join('；')}`);
      if (warned.length > 8) lines.push(`另外還有 ${warned.length - 8} 位`);
      const ok = await confirm(`有 ${warned.length} 位需要確認`, [...lines, '要直接輸出嗎？可以先按「取消」回去修正。'], { okText: '直接輸出' });
      if (!ok) return null;
    }
    return pages;
  }

  async function runExport() {
    if (busy) return;
    const o = ex();
    if (o.format.startsWith('pdf') && !window.jspdf) {
      toast('PDF 元件沒有載入，請改選 PNG 或 JPG 格式', 'error');
      return;
    }
    const pages = await preparePages();
    if (!pages) return;
    const controller = new AbortController();
    setBusy(controller);
    $('exportSummary').textContent = '';
    try {
      const result = await C.exporter.run(jobFor(pages), { signal: controller.signal, onProgress: progressReporter('產生') });
      C.exporter.download(result.blob, result.fileName);
      const summary = `已輸出 ${result.pages} 份，${formatBytes(result.bytes)}，花了 ${formatDuration(result.ms)}：${result.fileName}`;
      $('exportSummary').textContent = summary;
      toast(summary, 'success', 6000);
    } catch (err) {
      if (err.name === 'AbortError') {
        toast('已取消匯出', 'info');
      } else {
        console.error('Export failed', err);
        $('exportSummary').textContent = `匯出失敗：${err.message}`;
        toast(`匯出失敗：${err.message}。人數很多時可改用「指定範圍」分批輸出，或把文字解析度調低。`, 'error');
      }
    } finally {
      setBusy(null);
    }
  }

  async function currentPng() {
    if (busy) return;
    const o = ex();
    if (!o.overprint && !bgReady()) {
      toast('底圖還在載入，請稍候再試', 'warn');
      return;
    }
    const page = app.current();
    try {
      await C.render.ensureFonts(app.fields, [page.texts]);
      const { canvas } = C.render.renderPageCanvas({
        template: app.template,
        background: o.overprint ? null : app.background.bitmap,
        fields: app.fields,
        texts: page.texts,
        scale: 1,
      });
      const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片編碼失敗'))), 'image/png'));
      const name = `${sanitizeFileName(fillVars(o.itemName, page.fileVars), `證書_${page.index + 1}`)}.png`;
      C.exporter.download(blob, name);
      toast(`已下載 ${name}（${formatBytes(blob.size)}）`, 'success');
    } catch (err) {
      console.error('PNG export failed', err);
      toast(`PNG 產生失敗：${err.message}`, 'error');
    }
  }

  function clearPrint() {
    printUrls.forEach((u) => URL.revokeObjectURL(u));
    printUrls = [];
    $('printArea').replaceChildren();
  }

  // Page orientation follows the template; a4-full fills the sheet.
  function printPageStyle() {
    const landscape = app.template.width > app.template.height;
    let style = $('printPageStyle');
    if (!style) {
      style = h('style', { id: 'printPageStyle' });
      document.head.append(style);
    }
    style.textContent = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 0; }`;
    $('printArea').classList.toggle('fill', ex().paper === 'a4-full');
  }

  async function print() {
    if (busy) return;
    const pages = await preparePages();
    if (!pages) return;
    clearPrint();
    const controller = new AbortController();
    setBusy(controller);
    try {
      printUrls = await C.exporter.printImages(jobFor(pages), { signal: controller.signal, onProgress: progressReporter('準備列印') });
      const imgs = printUrls.map((src, i) => h('img', { src, alt: `第 ${pages[i].index + 1} 位 ${pages[i].name}` }));
      $('printArea').replaceChildren(...imgs);
      await Promise.all(imgs.map((img) => img.decode().catch(() => null)));
    } catch (err) {
      clearPrint();
      if (err.name === 'AbortError') toast('已取消列印', 'info');
      else {
        console.error('Print preparation failed', err);
        toast(`列印準備失敗：${err.message}`, 'error');
      }
      return;
    } finally {
      setBusy(null);
    }
    printPageStyle();
    window.addEventListener('afterprint', clearPrint, { once: true });
    window.print();
  }

  function init(a) {
    app = a;
    build();
    $('exportBtn').addEventListener('click', runExport);
    $('pngBtn').addEventListener('click', currentPng);
    $('printBtn').addEventListener('click', print);
    $('cancelBtn').addEventListener('click', () => busy && busy.abort());
  }

  function update(changes) {
    if (changes.has('all') || changes.has('export') || changes.has('template')) syncControls();
    if (['all', 'export', 'roster', 'page', 'values', 'options'].some((c) => changes.has(c))) syncCount();
  }

  C.ui.export = { init, update, print };
})();
