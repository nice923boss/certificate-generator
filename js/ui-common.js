// Small DOM helpers shared by the UI modules: element builder, toasts,
// confirm / prompt dialogs with focus handling, file reading, debounce.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // h('button', { class: 'x', onclick }, 'text', child) -> element
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach((c) => {
      if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    });
    return el;
  }

  function debounce(fn, ms) {
    let timer = 0;
    const wrapped = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
    wrapped.flush = (...args) => {
      clearTimeout(timer);
      fn(...args);
    };
    return wrapped;
  }

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  // ---- Toasts ----
  // kind: 'info' | 'success' | 'warn' | 'error'
  function toast(message, kind = 'info', ms) {
    const box = $('toasts');
    const item = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
    const close = h('button', { type: 'button', class: 'toast-close', 'aria-label': '關閉通知', onclick: () => item.remove() }, '×');
    item.append(close);
    box.append(item);
    const life = ms ?? (kind === 'error' ? 10000 : kind === 'warn' ? 7000 : 4000);
    if (life > 0) setTimeout(() => item.remove(), life);
    while (box.children.length > 4) box.firstElementChild.remove();
  }

  // ---- Dialogs ----
  // The native <dialog> traps focus; we restore it to the opener afterwards.
  function openDialog({ title, body, okText = '確定', cancelText = '取消', danger = false, input = null }) {
    const dialog = $('dialog');
    const opener = document.activeElement;
    $('dialogTitle').textContent = title;
    const bodyBox = $('dialogBody');
    bodyBox.replaceChildren(...(Array.isArray(body) ? body : [body]).filter(Boolean).map((b) => (b instanceof Node ? b : h('p', {}, b))));
    const ok = $('dialogOk');
    ok.textContent = okText;
    ok.classList.toggle('danger', danger);
    const cancel = $('dialogCancel');
    cancel.textContent = cancelText;
    cancel.hidden = cancelText === null;
    const wrap = $('dialogInputWrap');
    const field = $('dialogInput');
    wrap.hidden = !input;
    if (input) {
      $('dialogInputLabel').textContent = input.label;
      field.value = input.value || '';
    }
    return new Promise((resolve) => {
      const finish = (result) => {
        dialog.removeEventListener('close', onClose);
        cancel.removeEventListener('click', onCancel);
        if (dialog.open) dialog.close();
        if (opener && opener.focus) opener.focus();
        resolve(result);
      };
      const onClose = () => finish(dialog.returnValue === 'ok' ? (input ? field.value.trim() : true) : input ? null : false);
      const onCancel = () => {
        dialog.returnValue = 'cancel';
        dialog.close();
      };
      dialog.returnValue = '';
      dialog.addEventListener('close', onClose);
      cancel.addEventListener('click', onCancel);
      dialog.showModal();
      (input ? field : danger ? cancel : ok).focus();
      if (input) field.select();
    });
  }

  const confirm = (title, body, opts = {}) => openDialog({ title, body, ...opts });
  const alert = (title, body) => openDialog({ title, body, cancelText: null, okText: '知道了' });
  const prompt = (title, label, value, opts = {}) => openDialog({ title, body: opts.body, input: { label, value }, okText: opts.okText || '確定' });

  // ---- Files ----
  const readBuffer = (file) => file.arrayBuffer();
  async function readText(file) {
    return Cert.table.decodeText(new Uint8Array(await file.arrayBuffer()));
  }
  const extOf = (name) => (String(name).match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();

  // A hidden file input opened from code; resolves with the chosen file or null.
  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept, class: 'sr-only' });
      input.addEventListener('change', () => {
        resolve(input.files[0] || null);
        input.remove();
      });
      document.body.append(input);
      input.click();
    });
  }

  // Section open / closed state is remembered in state.view.collapsed.
  function bindSections(app) {
    document.querySelectorAll('details.section[data-section]').forEach((d) => {
      const key = d.dataset.section;
      const collapsed = app.state.view.collapsed || {};
      if (key in collapsed) d.open = !collapsed[key];
      d.addEventListener('toggle', () => {
        app.set((s) => ({ ...s, view: { ...s.view, collapsed: { ...s.view.collapsed, [key]: !d.open } } }), ['view']);
      });
    });
  }

  function openSection(key) {
    const d = document.querySelector(`details.section[data-section="${key}"]`);
    if (d && !d.open) d.open = true;
  }

  window.Cert.ui = window.Cert.ui || {};
  window.Cert.ui.common = { $, h, debounce, clamp, toast, confirm, alert, prompt, readBuffer, readText, extOf, pickFile, bindSections, openSection };
})();
