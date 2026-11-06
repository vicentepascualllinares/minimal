/* ============================================================================
 *  NIGHT RIDE THROUGHT BUDAPEST · piano roll del bajo
 *
 *  - clic en vacío: crea una nota (arrastra a la derecha para alargarla)
 *  - arrastrar una nota: mueve (tiempo y altura) · arrastrar su borde derecho: longitud
 *  - clic derecho / Alt+clic / doble clic: borrar · Supr: borrar la seleccionada
 *  - rueda: desplaza las octavas · Mayús+rueda sobre una nota: velocidad
 *  - cuantización: 1/4 … 1/32, tresillos o LIBRE (sin rejilla)
 * ========================================================================== */
(function () {
  'use strict';
  const NRB = (window.NRB = window.NRB || {});
  const { el, clamp } = NRB;
  const BLACK = [1, 3, 6, 8, 10];
  const isBlack = (p) => BLACK.indexOf(((p % 12) + 12) % 12) >= 0;
  const MONO = '"Cascadia Mono", Consolas, monospace';

  class PianoRoll {
    constructor(host, app, lane) {
      this.app = app;
      this.lane = lane;
      this.host = host;
      this.tr = NRB.state.tracks.bass;
      this.canvas = el('canvas', { class: 'roll' });
      this.playhead = el('div', { class: 'playhead' });
      host.append(this.canvas, this.playhead);
      this.g = this.canvas.getContext('2d');
      this.open = false;
      this.lo = 28;                 // nota más grave visible (abierto)
      this.rows = 24;               // semitonos visibles (abierto)
      this.W = 0; this.H = 0; this.dpr = 1;
      this.gx = 0; this.gw = 0; this.stepW = 1;
      this.sel = null; this.drag = null;
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(host);
      this.bind();
    }

    get patSteps() { return 16 * this.tr.bars; }
    nextId() { return this.tr.notes.reduce((m, n) => Math.max(m, n.id || 0), 0) + 1; }
    scaleMask() {
      const k = NRB.state.key;
      return k.scale === 'chromatic' ? null : NRB.dsp().scaleMask(k.root, k.scale);
    }

    /* rango de notas visible: fijo cuando está abierto, ajustado a las notas cuando está cerrado */
    view() {
      if (this.open) return { lo: this.lo, hi: this.lo + this.rows - 1, rows: this.rows };
      let mn = 127, mx = 0;
      this.tr.notes.forEach((n) => { mn = Math.min(mn, n.pitch); mx = Math.max(mx, n.pitch); });
      if (mn > mx) { mn = 33; mx = 45; }
      const span = Math.max(12, mx - mn + 3);
      const lo = Math.round(mn - (span - (mx - mn + 1)) / 2);
      return { lo, hi: lo + span - 1, rows: span };
    }

    layout() {
      this.keyW = this.open ? 50 : 0;
      this.gx = this.keyW;
      this.gw = Math.max(1, this.W - this.keyW);
      this.stepW = this.gw / this.patSteps;
    }
    resize() {
      const r = this.host.getBoundingClientRect();
      this.W = r.width; this.H = r.height;
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, Math.round(this.W * this.dpr));
      this.canvas.height = Math.max(1, Math.round(this.H * this.dpr));
      this.layout();
      this.draw();
    }
    setOpen(v) { this.open = v; this.layout(); this.draw(); }
    refresh() { this.layout(); this.draw(); }

    pitchAt(y) { const v = this.view(); return clamp(v.hi - Math.floor(y / (this.H / v.rows)), 12, 96); }
    stepAt(x) { return (x - this.gx) / this.stepW; }

    /* ---------------------------------------------------------------- dibujo */
    draw() {
      const g = this.g, W = this.W, H = this.H;
      if (!W || !H) return;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const v = this.view(), rowH = H / v.rows, mask = this.scaleMask(), rootPc = NRB.state.key.root;
      const open = this.open, q = NRB.quantSteps(this.tr.quant);

      for (let i = 0; i < v.rows; i++) {
        const p = v.hi - i, y = i * rowH, pc = ((p % 12) + 12) % 12;
        g.fillStyle = isBlack(p) ? '#09090b' : '#0d0d10';
        g.fillRect(this.gx, y, this.gw, rowH);
        if (open && mask && mask[pc]) {
          g.fillStyle = pc === rootPc ? 'rgba(255,162,58,.085)' : 'rgba(255,162,58,.04)';
          g.fillRect(this.gx, y, this.gw, rowH);
        }
        if (open) {
          g.fillStyle = pc === 0 ? 'rgba(255,255,255,.11)' : 'rgba(255,255,255,.03)';
          g.fillRect(this.gx, y + rowH - 1, this.gw, 1);
        }
      }

      const n = this.patSteps;
      if (open && q > 0 && q < 1) {                       // subdivisión fina de la cuantización
        g.fillStyle = 'rgba(255,255,255,.03)';
        for (let s = q; s < n; s += q) {
          if (Math.abs(s - Math.round(s)) < 1e-6) continue;
          g.fillRect(Math.round(this.gx + s * this.stepW), 0, 1, H);
        }
      }
      for (let s = 0; s <= n; s++) {
        const bar = s % 16 === 0, beat = s % 4 === 0;
        if (!open && !beat) continue;
        g.fillStyle = bar ? 'rgba(255,255,255,.24)' : beat ? 'rgba(255,255,255,.09)' : 'rgba(255,255,255,.035)';
        g.fillRect(Math.round(this.gx + s * this.stepW) - (s === n ? 1 : 0), 0, 1, H);
      }

      this.tr.notes.forEach((nt) => {
        if (nt.pitch > v.hi || nt.pitch < v.lo) return;
        const x = this.gx + nt.start * this.stepW, w = Math.max(3, nt.len * this.stepW - 1);
        const y = (v.hi - nt.pitch) * rowH + (open ? 1 : 0.5), h = Math.max(2, rowH - (open ? 2 : 1));
        g.fillStyle = 'rgba(255,162,58,' + (0.42 + 0.58 * nt.vel).toFixed(2) + ')';
        g.fillRect(x, y, w, h);
        if (open) {
          g.fillStyle = 'rgba(255,238,205,.95)';
          g.fillRect(x, y, Math.min(2, w), h);
        }
        if (nt === this.sel && open) {
          g.strokeStyle = '#fff';
          g.lineWidth = 1;
          g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        }
      });

      if (open) {                                           // teclado
        g.fillStyle = '#060607';
        g.fillRect(0, 0, this.keyW, H);
        g.font = '9px ' + MONO;
        for (let i = 0; i < v.rows; i++) {
          const p = v.hi - i, y = i * rowH, pc = ((p % 12) + 12) % 12, black = isBlack(p);
          g.fillStyle = black ? '#0c0c0f' : '#1c1c21';
          g.fillRect(black ? 0 : 0, y + 0.5, black ? this.keyW * 0.62 : this.keyW - 1, rowH - 1);
          if (pc === 0 && rowH >= 7) {
            g.fillStyle = '#8a857b';
            g.fillText('C' + (Math.floor(p / 12) - 1), this.keyW - 22, y + rowH - 2.5);
          }
          if (pc === rootPc && mask) {
            g.fillStyle = '#ffa23a';
            g.fillRect(this.keyW - 7, y + rowH / 2 - 1.5, 3, 3);
          }
        }
        g.fillStyle = 'rgba(255,255,255,.14)';
        g.fillRect(this.keyW - 1, 0, 1, H);
      }
    }

    /* ----------------------------------------------------------- interacción */
    bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => this.down(e));
      c.addEventListener('pointermove', (e) => this.move(e));
      c.addEventListener('pointerup', () => this.up());
      c.addEventListener('pointercancel', () => this.up());
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      c.addEventListener('dblclick', (e) => {
        if (!this.open) return;
        const p = this.local(e), hit = this.hitNote(p.x, p.y);
        if (hit) this.remove(hit.note);
      });
      c.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
      window.addEventListener('keydown', (e) => {
        if (!this.open || !this.sel) return;
        if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { this.remove(this.sel); e.preventDefault(); }
      });
    }

    local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    hitNote(x, y) {
      const v = this.view(), rowH = this.H / v.rows, notes = this.tr.notes;
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        const nx = this.gx + n.start * this.stepW, nw = Math.max(3, n.len * this.stepW - 1);
        const ny = (v.hi - n.pitch) * rowH;
        if (x >= nx && x <= nx + nw && y >= ny && y <= ny + rowH) {
          return { note: n, edge: x > nx + nw - Math.min(9, nw * 0.45) };
        }
      }
      return null;
    }

    preview(pitch) { if (!this.app.transport.running) this.app.engine.previewBass(pitch); }

    remove(note) {
      this.tr.notes = this.tr.notes.filter((n) => n !== note);
      if (this.sel === note) this.sel = null;
      NRB.store.touch();
      this.draw();
    }

    down(e) {
      if (!this.open) { this.lane.setOpen(true); return; }
      const p = this.local(e);
      if (p.x < this.keyW) { this.app.engine.previewBass(this.pitchAt(p.y)); return; }
      const hit = this.hitNote(p.x, p.y);
      if (e.button === 2 || (hit && e.altKey)) { if (hit) this.remove(hit.note); return; }
      if (e.button !== 0) return;
      this.canvas.setPointerCapture(e.pointerId);
      if (hit) {
        this.sel = hit.note;
        this.drag = hit.edge
          ? { mode: 'resize', note: hit.note }
          : { mode: 'move', note: hit.note, off: this.stepAt(p.x) - hit.note.start };
        this.preview(hit.note.pitch);
      } else {
        const q = NRB.quantSteps(this.tr.quant);
        let s = this.stepAt(p.x);
        s = q > 0 ? Math.floor(s / q + 1e-6) * q : Math.max(0, s);
        s = clamp(s, 0, this.patSteps - (q > 0 ? q : 0.25));
        const note = { id: this.nextId(), start: s, len: q > 0 ? q : 1, pitch: this.pitchAt(p.y), vel: 0.85 };
        note.len = Math.min(note.len, this.patSteps - note.start);
        this.tr.notes.push(note);
        this.sel = note;
        this.drag = { mode: 'resize', note, fresh: true };
        this.preview(note.pitch);
      }
      this.draw();
    }

    move(e) {
      const p = this.local(e);
      if (!this.drag) {
        if (!this.open) { this.canvas.style.cursor = 'pointer'; return; }
        const hit = p.x >= this.keyW ? this.hitNote(p.x, p.y) : null;
        this.canvas.style.cursor = p.x < this.keyW ? 'pointer' : hit ? (hit.edge ? 'ew-resize' : 'grab') : 'crosshair';
        return;
      }
      const d = this.drag, n = d.note, q = NRB.quantSteps(this.tr.quant), pat = this.patSteps;
      if (d.mode === 'move') {
        let s = this.stepAt(p.x) - d.off;
        s = q > 0 ? Math.round(s / q) * q : s;
        n.start = clamp(s, 0, Math.max(0, pat - n.len));
        const pitch = this.pitchAt(p.y);
        if (pitch !== n.pitch) { n.pitch = pitch; this.preview(pitch); }
      } else {
        const min = q > 0 ? q : 0.125;
        let len = this.stepAt(p.x) - n.start;
        len = q > 0 ? Math.max(min, Math.round(len / q) * q) : Math.max(min, len);
        n.len = Math.min(len, pat - n.start);
      }
      this.draw();
    }

    up() {
      if (!this.drag) return;
      this.drag = null;
      NRB.store.touch();
      this.draw();
    }

    wheel(e) {
      if (!this.open) return;
      e.preventDefault();
      const p = this.local(e), hit = this.hitNote(p.x, p.y);
      if (e.shiftKey && hit) {
        hit.note.vel = clamp(hit.note.vel - Math.sign(e.deltaY) * 0.05, 0.1, 1);
        NRB.store.touch();
        this.draw();
        return;
      }
      this.lo = clamp(this.lo - Math.sign(e.deltaY) * (e.ctrlKey ? 12 : 2), 12, 96 - this.rows);
      this.draw();
    }

    /* cursor de reproducción */
    frame(pos) {
      if (pos < 0) { this.playhead.style.opacity = 0; return; }
      const p = (pos % this.patSteps) / this.patSteps;
      this.playhead.style.opacity = 1;
      this.playhead.style.left = this.gx + p * this.gw + 'px';
    }
  }

  NRB.PianoRoll = PianoRoll;
})();
