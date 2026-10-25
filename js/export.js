// Export jobs: one merged PDF, one PDF / PNG / JPG per person (zipped), and
// print images. Pages are rendered one at a time to keep memory flat.
(function () {
  'use strict';

  const { text, zip, render } = window.Cert;
  const A4 = { w: 210, h: 297 }; // mm
  const APP_NAME = '結業證書產生器 v2.0';

  // Page size in mm and the certificate image's box on it.
  // a4-center fits the whole image, a4-full fills the page and crops the
  // overflow, native sizes the page to the image's own proportions.
  function pageGeometry(template, paper) {
    const landscape = template.width > template.height;
    const ratio = template.height / template.width;
    if (paper === 'native') {
      const w = landscape ? A4.h : A4.w;
      return { landscape, page: { w, h: w * ratio }, img: { x: 0, y: 0, w, h: w * ratio } };
    }
    const page = landscape ? { w: A4.h, h: A4.w } : { ...A4 };
    const fit = paper === 'a4-full' ? Math.max : Math.min;
    const s = fit(page.w / template.width, page.h / template.height);
    const w = template.width * s;
    const h = template.height * s;
    return { landscape, page, img: { x: (page.w - w) / 2, y: (page.h - h) / 2, w, h } };
  }

  // Background converted once per template / format / quality.
  const bgCache = new Map();
  function pdfBackground(template, background, format, quality) {
    const key = `${template.id}|${format}|${quality}`;
    if (!bgCache.has(key)) {
      if (bgCache.size > 4) bgCache.clear();
      if (format === 'png' && background.src.startsWith('data:image/png')) {
        bgCache.set(key, { data: background.src, type: 'PNG' });
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = template.width;
        canvas.height = template.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(background.bitmap, 0, 0);
        const type = format === 'png' ? 'PNG' : 'JPEG';
        bgCache.set(key, { data: canvas.toDataURL(`image/${type.toLowerCase()}`, quality), type });
      }
    }
    return bgCache.get(key);
  }

  // jsPDF writes metadata bytes as-is; UTF-16BE with a BOM keeps Chinese readable.
  function pdfText(s) {
    let out = 'þÿ';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out += String.fromCharCode(c >> 8, c & 0xff);
    }
    return out;
  }

  function newPdf(geo, title, subject) {
    const pdf = new window.jspdf.jsPDF({
      unit: 'mm',
      format: [geo.page.w, geo.page.h],
      orientation: geo.landscape ? 'landscape' : 'portrait',
      compress: true,
    });
    pdf.setProperties({ title: pdfText(title), subject: pdfText(subject), creator: pdfText(APP_NAME) });
    return pdf;
  }

  // Background (unless overprinting) plus one cropped image per text field.
  function addPdfPage(pdf, job, page, i) {
    const { template, geo } = job;
    const mm = geo.img.w / template.width;
    if (job.bg) pdf.addImage(job.bg.data, job.bg.type, geo.img.x, geo.img.y, geo.img.w, geo.img.h, 'bg', 'FAST');
    render.renderFieldImages(job.fields, page.texts, job.options.scale).forEach((img, j) => {
      pdf.addImage(img.canvas, 'PNG', geo.img.x + img.x * mm, geo.img.y + img.y * mm, img.w * mm, img.h * mm, `t${i}-${j}`, 'FAST');
    });
  }

  function pageImage(job, page) {
    const { canvas } = render.renderPageCanvas({
      template: job.template,
      background: job.options.overprint ? null : job.background.bitmap,
      fields: job.fields,
      texts: page.texts,
      scale: job.options.scale,
      fill: job.options.overprint || job.options.format === 'jpg-zip' ? '#fff' : null,
    });
    const type = job.options.format === 'jpg-zip' ? 'image/jpeg' : 'image/png';
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('圖片編碼失敗，可能是記憶體不足'))), type, job.options.jpegQuality);
    });
  }

  const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));
  function checkAbort(signal) {
    if (signal && signal.aborted) throw new DOMException('已取消匯出', 'AbortError');
  }

  const EXT = { pdf: 'pdf', 'pdf-zip': 'pdf', 'png-zip': 'png', 'jpg-zip': 'jpg' };

  // File names from the patterns, with {人數} etc. filled from page variables.
  function names(job) {
    const vars = job.pages.length ? job.pages[0].fileVars : {};
    const base = text.sanitizeFileName(text.fillVars(job.options.fileName, { ...vars, 人數: String(job.pages.length) }), '結業證書');
    const used = new Set();
    const item = (page) =>
      text.uniqueName(`${text.sanitizeFileName(text.fillVars(job.options.itemName, page.fileVars), `證書_${page.index + 1}`)}.${EXT[job.options.format]}`, used);
    return { base, item };
  }

  // job: { pages, template, background: { src, bitmap }, fields, options }
  // where options is state.export. -> { blob, fileName, pages, bytes, ms }
  async function run(job, { signal, onProgress } = {}) {
    const started = performance.now();
    const { pages, options } = job;
    if (!pages.length) throw new Error('沒有要匯出的頁面');
    await render.ensureFonts(job.fields, pages.map((p) => p.texts));
    const geo = pageGeometry(job.template, options.paper);
    const bg = options.overprint ? null : pdfBackground(job.template, job.background, options.bgFormat, options.jpegQuality);
    const ctx = { ...job, geo, bg };
    const fileNames = names(job);
    const subject = (pages[0].fileVars || {}).班級名稱 || '結業證書';

    let merged = null;
    const files = [];
    for (let i = 0; i < pages.length; i++) {
      checkAbort(signal);
      const page = pages[i];
      if (onProgress) onProgress({ done: i, total: pages.length, name: page.name });
      await nextFrame();
      try {
        if (options.format === 'pdf') {
          if (!merged) merged = newPdf(geo, fileNames.base, subject);
          else merged.addPage([geo.page.w, geo.page.h], geo.landscape ? 'landscape' : 'portrait');
          addPdfPage(merged, ctx, page, i);
        } else if (options.format === 'pdf-zip') {
          const name = fileNames.item(page);
          const pdf = newPdf(geo, name.replace(/\.pdf$/, ''), subject);
          addPdfPage(pdf, ctx, page, 0);
          files.push({ name, blob: pdf.output('blob') });
        } else {
          files.push({ name: fileNames.item(page), blob: await pageImage(ctx, page) });
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.error('Export failed on page', i + 1, err);
        throw new Error(`第 ${page.index + 1} 位「${page.name}」產生失敗：${err.message}`);
      }
    }
    checkAbort(signal);
    if (onProgress) onProgress({ done: pages.length, total: pages.length, name: '' });

    let blob;
    let fileName;
    if (merged) {
      blob = merged.output('blob');
      fileName = `${fileNames.base}.pdf`;
    } else if (files.length === 1) {
      blob = files[0].blob;
      fileName = files[0].name;
    } else {
      const entries = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })));
      blob = new Blob([zip.createZip(entries)], { type: 'application/zip' });
      fileName = `${fileNames.base}.zip`;
    }
    return { blob, fileName, pages: pages.length, bytes: blob.size, ms: performance.now() - started };
  }

  // Full-page JPEG object URLs for the print view; caller revokes them.
  async function printImages(job, { signal, onProgress } = {}) {
    await render.ensureFonts(job.fields, job.pages.map((p) => p.texts));
    const urls = [];
    try {
      for (let i = 0; i < job.pages.length; i++) {
        checkAbort(signal);
        if (onProgress) onProgress({ done: i, total: job.pages.length, name: job.pages[i].name });
        await nextFrame();
        const blob = await pageImage({ ...job, options: { ...job.options, format: 'jpg-zip', jpegQuality: 0.92 } }, job.pages[i]);
        urls.push(URL.createObjectURL(blob));
      }
    } catch (err) {
      urls.forEach((u) => URL.revokeObjectURL(u));
      throw err;
    }
    return urls;
  }

  function download(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  window.Cert.exporter = { pageGeometry, run, printImages, download };
})();
