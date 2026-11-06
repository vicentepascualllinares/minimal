/* ============================================================================
 *  NIGHT RIDE THROUGHT BUDAPEST · pistas
 *  DrumLane (secuenciador de pasos), BassLane (piano roll) y RecLane (looper).
 * ========================================================================== */
(function () {
  'use strict';
  const NRB = (window.NRB = window.NRB || {});
  const { el, clamp } = NRB;
  const DEFAULT_VEL = 0.9;
  const hex4 = (n) => ('0000' + (n >>> 0).toString(16).toUpperCase()).slice(-4);
  const fmtSwing = (s) => Math.round(50 + s * 25) + '%';
  const fmtPct = (v) => Math.round(v * 100) + '%';

  /* ---------- popover: swing / humanize / groove (y duración del patrón) ---------- */
  function groovePopover(anchor, id, onChange) {
    const tr = NRB.state.tracks[id];
    const touch = () => NRB.store.touch();
    const val = (t) => el('b', { class: 'row__v', text: t });
    const row = (label, ctrl, v, title) => el('div', { class: 'row', title: title || null }, [el('span', { text: label }), ctrl, v || el('b')]);

    const swV = val(fmtSwing(tr.swing)), huV = val(fmtPct(tr.humanize)), gaV = val(fmtPct(tr.grooveAmt));
    const sw = NRB.slider({ min: 0, max: 100, value: tr.swing * 100, def: 0, onInput: (v) => { tr.swing = v / 100; swV.textContent = fmtSwing(tr.swing); touch(); } });
    const hu = NRB.slider({ min: 0, max: 100, value: tr.humanize * 100, def: 0, onInput: (v) => { tr.humanize = v / 100; huV.textContent = fmtPct(tr.humanize); touch(); } });
    const sel = el('select', { class: 'sel' }, NRB.GROOVE_ORDER.map((k) => el('option', { value: k, text: NRB.GROOVES[k].name })));
    sel.value = tr.groove;
    sel.addEventListener('change', () => { tr.groove = sel.value; touch(); });
    const ga = NRB.slider({ min: 0, max: 100, value: tr.grooveAmt * 100, def: 100, onInput: (v) => { tr.grooveAmt = v / 100; gaV.textContent = fmtPct(tr.grooveAmt); touch(); } });

    const box = el('div', { class: 'pop__body' }, [
      row('SWING', sw, swV, 'Retrasa los 16avos de contratiempo (50% = recto, 66% = tresillo)'),
      row('HUMANIZE', hu, huV, 'Desviación aleatoria de tiempo, intensidad y timbre en cada golpe'),
      row('GROOVE', sel, null, 'Plantilla de micro-tiempo y dinámica'),
      row('AMOUNT', ga, gaV),
    ]);
    if (NRB.TRACK_BY_ID[id].type === 'drum') {
      const len = NRB.seg({
        options: [[1, '1'], [2, '2'], [4, '4']], value: tr.bars,
        onChange: (b) => { tr.bars = b; touch(); if (onChange) onChange(); },     // solo aquí hay que rehacer los pasos
      });
      box.append(row('BARS', len.el, null, 'Duración del patrón en compases'));
    }
    NRB.popover.open(anchor, box, NRB.TRACK_BY_ID[id].name + ' · FEEL');
  }

  /* =========================================================================
   *  Batería: kick, clap, snare, hat, open hat
   * ======================================================================= */
  class DrumLane {
    constructor(app, id) {
      this.app = app; this.id = id; this.tr = NRB.state.tracks[id]; this.cur = -1; this.cells = [];
      const t = NRB.TRACK_BY_ID[id];
      this.root = el('section', { class: 'lane lane--drum', 'data-track': id });
      const name = el('button', { class: 'pill', type: 'button', text: t.name, title: 'Clic: escuchar', onclick: () => app.engine.previewDrum(id) });
      const grv = el('button', {
        class: 'pill pill--mini', type: 'button', text: '≈', title: 'Swing · Humanize · Groove',
        onclick: (e) => groovePopover(e.currentTarget, id, () => this.render()),
      });
      const clr = el('button', {
        class: 'pill pill--mini', type: 'button', text: '×', title: 'Vaciar el patrón',
        onclick: () => { this.tr.steps.fill(0); this.refresh(); NRB.store.touch(); },
      });
      this.root.append(el('div', { class: 'lane__head' }, el('div', { class: 'lane__row' }, [name, grv, clr])));
      this.body = el('div', { class: 'lane__body' });
      this.stepsEl = el('div', { class: 'steps' });
      this.playhead = el('div', { class: 'playhead' });
      this.body.append(this.stepsEl, this.playhead);
      this.root.append(this.body);
      this.bind();
      this.render();
    }

    render() {
      const n = 16 * this.tr.bars;
      this.stepsEl.style.setProperty('--n', n);
      this.stepsEl.textContent = '';
      this.cells = [];
      this.cur = -1;
      for (let i = 0; i < n; i++) {
        const c = el('div', { class: 'step', 'data-i': i }, el('i'));
        if (i % 4 === 0) c.dataset.beat = 1;
        if (i % 16 === 0) c.dataset.bar = 1;
        this.stepsEl.append(c);
        this.cells.push(c);
      }
      this.refresh();
    }

    refresh() {
      this.cells.forEach((c, i) => {
        const v = this.tr.steps[i];
        c.classList.toggle('on', v > 0);
        c.style.setProperty('--v', v > 0 ? v.toFixed(2) : '0');
      });
    }

    bind() {
      const S = this.stepsEl;
      const idxAt = (e) => {
        const r = S.getBoundingClientRect();
        return clamp(Math.floor(((e.clientX - r.left) / r.width) * this.cells.length), 0, this.cells.length - 1);
      };
      let painting = false, val = 0, last = -1;
      const paint = (i) => {
        last = i;
        if (val > 0 && this.tr.steps[i] > 0) return;          // ya activo: conserva su intensidad
        this.tr.steps[i] = val;
        const c = this.cells[i];
        c.classList.toggle('on', val > 0);
        c.style.setProperty('--v', val > 0 ? val.toFixed(2) : '0');
        if (val > 0 && !this.app.transport.running) this.app.engine.previewDrum(this.id, val);
      };
      S.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const i = idxAt(e);
        S.setPointerCapture(e.pointerId);
        painting = true;
        val = this.tr.steps[i] > 0 ? 0 : DEFAULT_VEL;
        paint(i);
        e.preventDefault();
      });
      S.addEventListener('pointermove', (e) => {
        if (!painting) return;
        const i = idxAt(e);
        if (i === last) return;
        const dir = i > last ? 1 : -1;
        for (let k = last + dir; k !== i + dir; k += dir) paint(k);      // no se salta ningún paso aunque el ratón vaya rápido
      });
      const end = () => { if (painting) { painting = false; NRB.store.touch(); } };
      S.addEventListener('pointerup', end);
      S.addEventListener('pointercancel', end);
      S.addEventListener('contextmenu', (e) => {              // clic derecho: acento -> normal -> fantasma
        e.preventDefault();
        const i = idxAt(e), v = this.tr.steps[i];
        if (v > 0) { this.tr.steps[i] = v > 0.85 ? 0.7 : v > 0.55 ? 0.4 : 1; this.refresh(); NRB.store.touch(); }
      });
    }

    frame(pos) {
      if (pos < 0) {
        if (this.cur >= 0 && this.cells[this.cur]) this.cells[this.cur].classList.remove('now');
        this.cur = -1;
        this.playhead.style.opacity = 0;
        return;
      }
      const n = 16 * this.tr.bars, p = pos % n, cur = Math.floor(p);
      this.playhead.style.opacity = 1;
      this.playhead.style.left = (p / n) * 100 + '%';
      if (cur !== this.cur) {
        const prev = this.cells[this.cur];
        if (prev) prev.classList.remove('now');
        const c = this.cells[cur];
        if (c) {
          c.classList.add('now');
          if (c.classList.contains('on')) { c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit'); }
        }
        this.cur = cur;
      }
    }
  }

  /* =========================================================================
   *  Bajo: vista compacta + piano roll
   * ======================================================================= */
  class BassLane {
    constructor(app) {
      this.app = app; this.tr = NRB.state.tracks.bass; this.open = false;
      this.root = el('section', { class: 'lane lane--bass', 'data-track': 'bass' });
      const name = el('button', { class: 'pill', type: 'button', text: 'BASS', title: 'Clic: escuchar', onclick: () => app.engine.previewBass(33) });
      this.editBtn = el('button', { class: 'pill pill--edit', type: 'button', title: 'Abrir / cerrar el piano roll', onclick: () => this.setOpen(!this.open) }, [el('span', { text: 'PIANO ROLL' }), el('i', { class: 'chev' })]);
      const grv = el('button', { class: 'pill pill--mini', type: 'button', text: '≈', title: 'Swing · Humanize · Groove', onclick: (e) => groovePopover(e.currentTarget, 'bass') });
      const clr = el('button', {
        class: 'pill pill--mini', type: 'button', text: '×', title: 'Vaciar las notas',
        onclick: () => { this.tr.notes = []; this.roll.sel = null; this.roll.draw(); NRB.store.touch(); },
      });
      const quant = el('select', { class: 'sel', title: 'Cuantización del piano roll' }, NRB.QUANT.map((q) => el('option', { value: q.id, text: q.label })));
      quant.value = this.tr.quant;
      quant.addEventListener('change', () => { this.tr.quant = quant.value; NRB.store.touch(); this.roll.draw(); });
      const bars = NRB.seg({
        options: [[1, '1'], [2, '2'], [4, '4']], value: this.tr.bars,
        onChange: (b) => this.setBars(b),
      });
      this.root.append(el('div', { class: 'lane__head' }, [
        el('div', { class: 'lane__row' }, [name, grv, clr]),
        el('div', { class: 'lane__row' }, [this.editBtn]),
        el('div', { class: 'lane__row only-open' }, [el('label', { class: 'mini-label', text: 'QUANT' }), quant]),
        el('div', { class: 'lane__row only-open' }, [el('label', { class: 'mini-label', text: 'BARS' }), bars.el]),
      ]));
      this.body = el('div', { class: 'lane__body' });
      this.root.append(this.body);
      this.roll = new NRB.PianoRoll(this.body, app, this);
    }

    setOpen(v) {
      this.open = v;
      this.roll.setOpen(v);
      this.root.classList.toggle('open', v);
    }

    setBars(b) {
      this.tr.bars = b;
      const pat = 16 * b;
      this.tr.notes = this.tr.notes.filter((n) => n.start < pat).map((n) => Object.assign({}, n, { len: Math.min(n.len, pat - n.start) }));
      this.roll.sel = null;
      this.roll.refresh();
      NRB.store.touch();
    }

    frame(pos) { this.roll.frame(pos); }
  }

  /* =========================================================================
   *  Pistas REC (looper)
   * ======================================================================= */
  class RecLane {
    constructor(app, id) {
      this.app = app; this.id = id;
      this.r = app.looper.tracks[id];
      this.st = NRB.state.tracks[id];
      this.live = false;
      this.scopeBuf = new Float32Array(1024);
      this.lastTag = '';
      const idx = NRB.REC_IDS.indexOf(id) + 1;
      this.root = el('section', { class: 'lane lane--rec', 'data-track': id });
      this.recBtn = el('button', {
        class: 'pill pill--rec', type: 'button', title: 'Grabar (tecla ' + idx + '): empieza y termina en el compás',
        onclick: () => app.looper.press(id),
      }, [el('i', { class: 'dot' }), el('span', { text: 'REC' })]);
      this.clrBtn = el('button', { class: 'pill pill--mini', type: 'button', text: '×', title: 'Borrar la grabación', onclick: () => app.looper.clear(id) });
      this.modeSeg = NRB.seg({
        cls: 'seg--pills',
        options: [
          ['ambient', 'AMBIENT', 'Ambiente: glitch, granos, filtro, delay y reverb aleatorios, fijos para esta grabación'],
          ['vocal', 'VOCAL', 'Voz: gate, afinación a la tonalidad, compresión y sala corta'],
        ],
        value: this.st.mode,
        onChange: (m) => app.looper.setMode(id, m),
      });
      this.root.append(el('div', { class: 'lane__head' }, [
        el('div', { class: 'lane__row' }, [this.recBtn, this.clrBtn]),
        el('div', { class: 'lane__row' }, this.modeSeg.el),
      ]));
      this.body = el('div', { class: 'lane__body' });
      this.canvas = el('canvas', { class: 'wave' });
      this.tag = el('div', { class: 'lane__tag' });
      this.playhead = el('div', { class: 'playhead' });
      this.fxSeg = NRB.seg({
        cls: 'seg--fx', options: [[0.5, '½'], [1, '1'], [2, '2'], [4, '4']], value: 1,
        onChange: (m) => app.looper.setFx(id, m),
      });
      this.fxWrap = el('div', { class: 'lane__fx', hidden: true, title: 'Ciclo de los efectos respecto a la duración del loop (½, 1, 2 o 4 veces)' }, [el('span', { text: 'FX ×' }), this.fxSeg.el]);
      this.body.append(this.canvas, this.playhead, this.tag, this.fxWrap);
      this.root.append(this.body);
      this.ro = new ResizeObserver(() => this.drawWave());
      this.ro.observe(this.body);
      this.refresh();
    }

    refresh() {
      const r = this.r, st = this.st, s = r.state;
      this.root.dataset.state = s;
      this.root.dataset.mode = st.mode;
      this.root.classList.toggle('has-loop', r.hasLoop);
      this.modeSeg.set(st.mode);
      this.recBtn.disabled = s === 'processing';
      this.recBtn.dataset.state = s;
      this.clrBtn.disabled = !(r.hasLoop || s !== 'empty');
      const rn = r.render;
      this.fxWrap.hidden = !(rn && st.mode === 'ambient' && rn.info.kind === 'ambient');
      if (rn) this.fxSeg.set(rn.cycleMult);
      this.setTag(this.tagText());
      this.live = s === 'armed' || s === 'recording';
      this.drawWave();
    }

    tagText() {
      const r = this.r, st = this.st, s = r.state;
      if (r.error) return r.error.toUpperCase();
      if (s === 'opening') return 'ABRIENDO EL MICRÓFONO…';
      if (s === 'armed') return 'ARMADO · ENTRA EN EL PRÓXIMO COMPÁS';
      if (s === 'recording') return 'GRABANDO · COMPÁS 1';
      if (s === 'processing') return st.mode === 'vocal' ? 'TRATANDO LA VOZ…' : 'GENERANDO EL AMBIENTE…';
      if (r.render) {
        const i = r.render.info, k = NRB.state.key;
        if (i.kind === 'vocal') return 'VOZ · ' + r.bars + ' COMP · ' + NRB.NOTE_NAMES[k.root] + ' ' + k.scale.toUpperCase() + (i.gate ? ' · GATE' : '') + ' · COMP';
        return r.bars + ' COMP · ' + i.glitch + ' GLITCH · REVERB ' + i.rt60.toFixed(1) + 's · ' + i.filter.toUpperCase() + (i.delay ? ' · DELAY' : '') + (i.drone ? ' · DRONE' : '') + ' · #' + hex4(i.seed);
      }
      return 'PULSA REC · EMPIEZA Y TERMINA EN EL COMPÁS · EL MICRÓFONO SE ABRE SOLO AL GRABAR';
    }
    setTag(t) { if (t !== this.lastTag) { this.tag.textContent = t; this.lastTag = t; } }

    sizeCanvas() {
      const cv = this.canvas, dpr = window.devicePixelRatio || 1;
      const W = this.body.clientWidth, H = this.body.clientHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
      }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { g, W, H };
    }

    drawWave() {
      const { g, W, H } = this.sizeCanvas();
      g.clearRect(0, 0, W, H);
      const rn = this.r.render;
      if (!rn || !W) return;
      const vocal = this.st.mode === 'vocal';
      const col = vocal ? '228,217,195' : '122,163,189';
      const pk = rn.peaks, cols = pk.length / 2, mid = H * 0.52, amp = H * 0.43;
      // marcas: compases, límites del loop y del ciclo de efectos
      for (let b = 1; b < rn.renderBars; b++) {
        const x = Math.round((b / rn.renderBars) * W) + 0.5;
        g.fillStyle = 'rgba(255,255,255,.05)';
        g.fillRect(x, H * 0.62, 1, H * 0.38);
      }
      g.save();
      g.setLineDash([2, 4]);
      g.strokeStyle = 'rgba(255,162,58,.45)';
      const marks = rn.cycleMult < 1 ? Math.round(1 / rn.cycleMult) * rn.passes : rn.passes;
      for (let k = 1; k < marks; k++) {
        const x = Math.round((k / marks) * W) + 0.5;
        g.beginPath(); g.moveTo(x, 4); g.lineTo(x, H - 2); g.stroke();
      }
      g.restore();
      // onda como contorno fino (min/max)
      g.beginPath();
      for (let x = 0; x < W; x++) {
        const i = Math.min(cols - 1, Math.floor((x / W) * cols));
        const y = mid - pk[i * 2 + 1] * amp;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      for (let x = W - 1; x >= 0; x--) {
        const i = Math.min(cols - 1, Math.floor((x / W) * cols));
        g.lineTo(x, mid - pk[i * 2] * amp);
      }
      g.closePath();
      g.fillStyle = 'rgba(' + col + ',.10)';
      g.fill();
      g.strokeStyle = 'rgba(' + col + ',.92)';
      g.lineWidth = 1;
      g.stroke();
    }

    drawScope() {
      const e = this.app.engine;
      if (!e.micScope(this.scopeBuf)) return;
      const { g, W, H } = this.sizeCanvas();
      g.clearRect(0, 0, W, H);
      const rec = this.r.state === 'recording', mid = H * 0.52, amp = H * 0.43, buf = this.scopeBuf;
      g.beginPath();
      for (let x = 0; x < W; x++) {
        const v = clamp(buf[Math.floor((x / W) * buf.length)] * 5, -1, 1);
        x ? g.lineTo(x, mid - v * amp) : g.moveTo(x, mid - v * amp);
      }
      g.strokeStyle = rec ? 'rgba(255,59,47,.95)' : 'rgba(255,162,58,.55)';
      g.lineWidth = 1;
      g.stroke();
    }

    frame(pos) {
      const r = this.r;
      if (this.live) {
        this.drawScope();
        this.playhead.style.opacity = 0;
        if (r.state === 'recording') {
          const bars = Math.max(1, Math.floor(pos / 16 - r.startBar) + 1);
          this.setTag('GRABANDO · COMPÁS ' + bars + (this.app.state.recBars ? ' / ' + this.app.state.recBars : '') + ' · PULSA REC PARA CERRAR');
        }
        return;
      }
      const ph = this.app.looper.phase(this.id, pos);
      if (ph < 0) { this.playhead.style.opacity = 0; return; }
      this.playhead.style.opacity = 1;
      this.playhead.style.left = ph * 100 + '%';
    }
  }

  NRB.DrumLane = DrumLane;
  NRB.BassLane = BassLane;
  NRB.RecLane = RecLane;
})();
