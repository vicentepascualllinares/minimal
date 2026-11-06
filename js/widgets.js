/* ============================================================================
 *  NIGHT RIDE THROUGHT BUDAPEST · widgets
 *  Knob, fader, selector segmentado, slider y popover. Todo propio, sin librerías.
 * ========================================================================== */
(function () {
  'use strict';
  const NRB = (window.NRB = window.NRB || {});
  const clamp = NRB.clamp;

  /* ---- helper para crear nodos DOM ---- */
  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'style') e.style.cssText = v;
        else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
      });
    }
    return e;
  }
  NRB.el = el;

  /* ---- knob (arrastrar en vertical, rueda, doble clic = valor por defecto, teclado) ---- */
  function polar(c, r, deg) {
    const t = ((deg - 90) * Math.PI) / 180;
    return [c + r * Math.cos(t), c + r * Math.sin(t)];
  }
  function arc(c, r, a0, a1) {
    if (Math.abs(a1 - a0) < 0.5) return '';
    const p0 = polar(c, r, a0), p1 = polar(c, r, a1);
    return 'M' + p0[0].toFixed(2) + ',' + p0[1].toFixed(2) + ' A' + r + ',' + r + ' 0 ' + (Math.abs(a1 - a0) > 180 ? 1 : 0) + ' ' + (a1 > a0 ? 1 : 0) + ' ' + p1[0].toFixed(2) + ',' + p1[1].toFixed(2);
  }

  NRB.knob = function (o) {
    const size = o.size || 28, c = size / 2, r = c - 3;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    const mkPath = (cls) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('class', cls); svg.append(p); return p; };
    const track = mkPath('k-track'), val = mkPath('k-val');
    const ind = document.createElementNS(NS, 'line');
    ind.setAttribute('class', 'k-ind');
    svg.append(ind);
    track.setAttribute('d', arc(c, r, -135, 135));
    const labelEl = el('div', { class: 'knob__label', text: o.label });
    const root = el('div', { class: 'knob', tabindex: 0, role: 'slider', 'aria-label': o.label, 'aria-valuemin': 0, 'aria-valuemax': 100 }, [el('div', { class: 'knob__dial' }, svg), labelEl]);
    let v = o.value, tm = null;

    function draw() {
      const ang = -135 + 270 * v;
      val.setAttribute('d', o.bipolar ? arc(c, r, 0, 270 * (v - 0.5)) : arc(c, r, -135, ang));
      const a = polar(c, r * 0.3, ang), b = polar(c, r * 0.98, ang);
      ind.setAttribute('x1', a[0]); ind.setAttribute('y1', a[1]);
      ind.setAttribute('x2', b[0]); ind.setAttribute('y2', b[1]);
      root.setAttribute('aria-valuenow', Math.round(v * 100));
      root.title = o.label + ': ' + (o.fmt ? o.fmt(v) : Math.round(v * 100) + '%') + '  (doble clic: restaurar)';
    }
    function flash() {
      if (!o.fmt) return;
      labelEl.textContent = o.fmt(v);
      labelEl.classList.add('live');
      clearTimeout(tm);
      tm = setTimeout(() => { labelEl.textContent = o.label; labelEl.classList.remove('live'); }, 800);
    }
    function set(nv, emit) {
      nv = clamp(nv, 0, 1);
      if (nv === v) return;
      v = nv;
      draw();
      if (emit) { flash(); o.onInput(v); }
    }
    let startY = 0, startV = 0, dragging = false;
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true; startY = e.clientY; startV = v;
      root.setPointerCapture(e.pointerId);
      root.classList.add('drag');
      root.focus({ preventScroll: true });
      e.preventDefault();
    });
    root.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      set(startV + (startY - e.clientY) / (e.shiftKey ? 700 : 170), true);
    });
    const end = () => { dragging = false; root.classList.remove('drag'); };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('dblclick', () => set(o.def != null ? o.def : 0, true));
    root.addEventListener('wheel', (e) => { e.preventDefault(); set(v - Math.sign(e.deltaY) * (e.shiftKey ? 0.004 : 0.03), true); }, { passive: false });
    root.addEventListener('keydown', (e) => {
      const st = e.shiftKey ? 0.005 : 0.03;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(v + st, true); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(v - st, true); e.preventDefault(); }
      else if (e.key === 'Home') { set(o.def != null ? o.def : 0, true); e.preventDefault(); }
    });
    draw();
    return { el: root, set: (nv) => { v = clamp(nv, 0, 1); draw(); }, get: () => v };
  };

  /* ---- fader vertical con medidor ---- */
  NRB.fader = function (o) {
    const H = o.height || 96, HH = 10;
    const handle = el('div', { class: 'fader__handle' });
    const fill = el('div', { class: 'fader__fill' });
    const meterI = el('i');
    const meter = el('div', { class: 'meter' }, meterI);
    const root = el('div', { class: 'fader', tabindex: 0, role: 'slider', 'aria-label': o.label || 'volumen', style: 'height:' + H + 'px' }, [el('div', { class: 'fader__rail' }), fill, handle, meter]);
    let v = o.value;
    function draw() {
      const top = (1 - v) * (H - HH);
      handle.style.top = top + 'px';
      fill.style.top = top + HH / 2 + 'px';
      root.setAttribute('aria-valuenow', Math.round(v * 100));
      root.title = (o.fmt ? o.fmt(v) : '') + '  (doble clic: restaurar)';
    }
    function set(nv, emit) {
      nv = clamp(nv, 0, 1);
      if (nv === v) return;
      v = nv;
      draw();
      if (emit) o.onInput(v);
    }
    let dragging = false;
    const fromY = (e) => { const r = root.getBoundingClientRect(); return 1 - (e.clientY - r.top - HH / 2) / (H - HH); };
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      root.setPointerCapture(e.pointerId);
      root.focus({ preventScroll: true });
      set(fromY(e), true);
      e.preventDefault();
    });
    root.addEventListener('pointermove', (e) => { if (dragging) set(fromY(e), true); });
    const end = () => { dragging = false; };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('dblclick', () => set(o.def != null ? o.def : 0.72, true));
    root.addEventListener('wheel', (e) => { e.preventDefault(); set(v - Math.sign(e.deltaY) * (e.shiftKey ? 0.004 : 0.025), true); }, { passive: false });
    root.addEventListener('keydown', (e) => {
      const st = e.shiftKey ? 0.005 : 0.03;
      if (e.key === 'ArrowUp') { set(v + st, true); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { set(v - st, true); e.preventDefault(); }
    });
    draw();
    return {
      el: root, set: (nv) => { v = clamp(nv, 0, 1); draw(); }, get: () => v,
      meter: (lvl) => { meterI.style.clipPath = 'inset(' + ((1 - clamp(lvl, 0, 1)) * 100).toFixed(1) + '% 0 0 0)'; },
    };
  };

  /* ---- selector segmentado ---- */
  NRB.seg = function (o) {
    const root = el('div', { class: 'seg ' + (o.cls || '') });
    const btns = o.options.map((p) =>
      el('button', {
        class: 'seg__b', type: 'button', 'data-id': String(p[0]), text: p[1], title: p[2] || null,
        onclick: () => { set(p[0]); if (o.onChange) o.onChange(p[0]); },
      })
    );
    btns.forEach((b) => root.append(b));
    function set(id) { btns.forEach((b) => b.classList.toggle('on', b.dataset.id === String(id))); }
    set(o.value);
    return { el: root, set };
  };

  /* ---- slider horizontal ---- */
  NRB.slider = function (o) {
    const inp = el('input', { type: 'range', class: 'range', min: o.min != null ? o.min : 0, max: o.max != null ? o.max : 100, step: o.step || 1, value: o.value });
    inp.addEventListener('input', () => o.onInput(+inp.value));
    inp.addEventListener('dblclick', () => { inp.value = o.def != null ? o.def : 0; o.onInput(+inp.value); });
    return inp;
  };

  /* ---- popover ---- */
  const pop = (NRB.popover = {
    cur: null,
    open(anchor, content, title) {
      pop.close();
      const box = el('div', { class: 'pop' }, [title ? el('h4', { text: title }) : null, content]);
      document.body.append(box);
      const a = anchor.getBoundingClientRect(), b = box.getBoundingClientRect();
      let x = a.left, y = a.bottom + 8;
      if (x + b.width > innerWidth - 12) x = innerWidth - b.width - 12;
      if (y + b.height > innerHeight - 12) y = Math.max(12, a.top - b.height - 8);
      box.style.left = Math.max(12, x) + 'px';
      box.style.top = y + 'px';
      const off = (e) => { if (!box.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) pop.close(); };
      const key = (e) => { if (e.key === 'Escape') pop.close(); };
      setTimeout(() => { document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key); }, 0);
      pop.cur = { box, anchor, off, key };
      anchor.classList.add('open');
    },
    close() {
      if (!pop.cur) return;
      const c = pop.cur;
      pop.cur = null;
      c.box.remove();
      c.anchor.classList.remove('open');
      document.removeEventListener('pointerdown', c.off, true);
      document.removeEventListener('keydown', c.key);
    },
  });

  NRB.toast = function (text, ms) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(NRB.toast._t);
    NRB.toast._t = setTimeout(() => t.classList.remove('show'), ms || 3200);
  };
})();
