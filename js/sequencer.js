/* ============================================================================
 *  MIXER OF ALEXANDRIA: MINIMAL · transporte y looper
 *
 *  Transport: reloj maestro con "lookahead" (programa el audio unos ms antes con
 *             el reloj de Web Audio, no con timers). Aplica swing / humanize /
 *             groove POR PISTA a los pasos de batería y a las notas del bajo.
 *  Looper:    las 4 pistas REC. Grabar = pulsar REC (arma) -> empieza en el
 *             siguiente compás -> pulsar otra vez -> termina en el siguiente
 *             compás. La toma se procesa (ambient o vocal) y suena en loop,
 *             sincronizada con la rejilla.
 * ========================================================================== */
(function () {
  'use strict';
  const NRB = (window.NRB = window.NRB || {});
  const SPB = NRB.STEPS_PER_BAR;
  const LOOKAHEAD = 0.14;
  const clamp = NRB.clamp;

  NRB.dsp = function () { return NRB._dsp || (NRB._dsp = NRB_DSP_FACTORY()); };

  /* ======================================================================= */
  class Transport {
    constructor(engine) {
      this.e = engine;
      this.state = NRB.state;
      this.running = false;
      this.anchors = [];
      this.pendingBpm = null;
      this.sd = 60 / this.state.bpm / 4;
      NRB.emitter(this);
    }

    start() {
      if (this.running) return;
      const ctx = this.e.ctx;
      ctx.resume();
      this.running = true;
      this.sd = 60 / this.state.bpm / 4;
      this.pendingBpm = null;
      this.nextStep = 0;
      this.nextTime = ctx.currentTime + 0.12;
      this.anchors = [{ t: this.nextTime, step: 0, sd: this.sd }];
      this.looper.onStart();
      this.e.startTicker(() => this.tick());
      this.emit('state', true);
      this.tick();
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      this.e.stopTicker();
      this.e.cutInstruments();
      this.looper.onStop();
      this.emit('state', false);
    }

    toggle() { this.running ? this.stop() : this.start(); }

    setBpm(bpm) {
      bpm = clamp(Math.round(bpm), 60, 200);
      if (bpm === this.state.bpm) return;
      this.state.bpm = bpm;
      if (this.running) this.pendingBpm = bpm;
      NRB.store.touch();
      this.emit('bpm', bpm);
    }

    tick() {
      if (!this.running) return;
      const ctx = this.e.ctx;
      const now = ctx.currentTime;
      if (this.nextTime < now - 0.5) {                      // el hilo se quedó dormido: re-sincroniza
        const skip = Math.ceil((now - this.nextTime) / this.sd);
        this.nextStep += skip;
        this.nextTime += skip * this.sd;
      }
      const horizon = now + LOOKAHEAD;
      let guard = 0;
      while (this.nextTime < horizon && guard++ < 64) {
        const n = this.nextStep, T = this.nextTime;
        if (this.pendingBpm) {
          this.sd = 60 / this.pendingBpm / 4;
          this.anchors.push({ t: T, step: n, sd: this.sd });
          if (this.anchors.length > 8) this.anchors.shift();
          this.looper.applyRate(T, this.pendingBpm);
          this.pendingBpm = null;
        }
        this.scheduleStep(n, T);
        this.nextStep++;
        this.nextTime += this.sd;
      }
    }

    scheduleStep(n, T) {
      if (n % SPB === 0) this.looper.onBar(Math.floor(n / SPB), T);
      for (let i = 0; i < NRB.INSTRUMENT_IDS.length; i++) {
        const id = NRB.INSTRUMENT_IDS[i];
        if (id === 'bass') this.scheduleBass(this.state.tracks.bass, n, T);
        else this.scheduleDrum(id, this.state.tracks[id], n, T);
      }
    }

    scheduleDrum(id, tr, n, T) {
      const s = n % (SPB * tr.bars);
      const raw = tr.steps[s];
      if (!(raw > 0)) return;
      const gi = s % 16, gr = NRB.GROOVES[tr.groove] || NRB.GROOVES.off, amt = tr.grooveAmt, h = tr.humanize;
      const off = (s & 1 ? tr.swing * 0.5 : 0) + gr.t[gi] * amt;
      const rnd = () => Math.random() * 2 - 1;
      let time = T + off * this.sd + rnd() * 0.01 * h;
      const vel = clamp(raw * (1 + (gr.v[gi] - 1) * amt) * (1 + rnd() * 0.2 * h), 0.05, 1);
      const v = { pitch: 1 + rnd() * 0.025 * h, decay: 1 + rnd() * 0.18 * h };
      time = Math.max(time, this.e.ctx.currentTime + 0.002);
      NRB.Synth.drums[id](this.e.env, this.e.channels[id].bus, time, vel, v);
    }

    scheduleBass(tr, n, T) {
      const notes = tr.notes;
      if (!notes.length) return;
      const patLen = SPB * tr.bars, s = n % patLen;
      let cand = null;
      for (let i = 0; i < notes.length; i++) {
        if (Math.floor(notes[i].start + 1e-6) === s) (cand || (cand = [])).push(notes[i]);
      }
      if (!cand) return;
      const starts = notes.map((x) => x.start).sort((a, b) => a - b);
      const gr = NRB.GROOVES[tr.groove] || NRB.GROOVES.off, amt = tr.grooveAmt, h = tr.humanize;
      const rnd = () => Math.random() * 2 - 1;
      const ctx = this.e.ctx;
      for (let i = 0; i < cand.length; i++) {
        const nt = cand[i];
        if (nt.start >= patLen) continue;
        let next = Infinity;
        for (let k = 0; k < starts.length; k++) if (starts[k] > nt.start + 1e-6) { next = starts[k]; break; }
        let endPos = Math.min(nt.start + nt.len, patLen);
        if (next < endPos) endPos = next;                       // bajo monofónico: la nota siguiente corta a la anterior
        const w0 = NRB.swingWarp(nt.start, tr.swing), w1 = NRB.swingWarp(endPos, tr.swing);
        const gi = ((Math.round(nt.start) % 16) + 16) % 16;
        let time = T + (w0 - s + gr.t[gi] * amt) * this.sd + rnd() * 0.008 * h;
        time = Math.max(time, ctx.currentTime + 0.002);
        const dur = Math.max(0.025, (w1 - w0) * this.sd * (1 + rnd() * 0.08 * h) - 0.003);
        const vel = clamp(nt.vel * (1 + (gr.v[gi] - 1) * amt) * (1 + rnd() * 0.2 * h), 0.05, 1);
        const v = { pitch: 1 + rnd() * 0.002 * h, decay: 1 + rnd() * 0.15 * h };
        NRB.Synth.bass(this.e.env, this.e.channels.bass.bus, time, dur, nt.pitch, vel, v);
      }
    }

    /* posición actual (en pasos, con decimales) ya compensada con la latencia de salida,
       para que el cursor visual coincida con lo que se oye */
    stepPos() {
      if (!this.running) return -1;
      const t = this.e.ctx.currentTime - this.e.outLatency;
      let a = this.anchors[0];
      for (let i = this.anchors.length - 1; i >= 0; i--) if (this.anchors[i].t <= t) { a = this.anchors[i]; break; }
      return Math.max(0, a.step + (t - a.t) / a.sd);
    }
  }

  /* ======================================================================= */
  class Looper {
    constructor(engine) {
      this.e = engine;
      this.state = NRB.state;
      this.tracks = {};
      this.collecting = 0;                // tomas terminadas cuyo audio aún se está recogiendo
      this.micTimer = null;
      NRB.REC_IDS.forEach((id) => {
        this.tracks[id] = {
          id, state: 'empty', hasLoop: false, stopReq: false, minBar: 0, minTime: 0, gen: 0, renderGen: 0,
          dry: null, render: null, recBpm: 0, seed: 0, bars: 0, pendingStart: false, anchorBar: null,
          activeSource: null, startBar: 0, startTime: 0, error: '',
        };
      });
      NRB.emitter(this);
    }

    /* ---- micrófono bajo demanda ----
       Se abre al pulsar REC y se cierra unos segundos después de terminar la última toma
       (salvo que el usuario lo mantenga abierto con el botón MIC). */
    micBusy() {
      return this.collecting > 0 || NRB.REC_IDS.some((id) => {
        const s = this.tracks[id].state;
        return s === 'opening' || s === 'armed' || s === 'recording';
      });
    }
    cancelMicRelease() { clearTimeout(this.micTimer); this.micTimer = null; }
    scheduleMicRelease() {
      this.cancelMicRelease();
      this.micTimer = setTimeout(() => {
        this.micTimer = null;
        if (this.e.micHold || !this.e.mic.ok) return;
        if (this.micBusy()) { this.scheduleMicRelease(); return; }
        this.e.closeMic();
      }, 5000);
    }

    /* ---- acciones del usuario ---- */
    async press(id) {
      const r = this.tracks[id], e = this.e;
      e.ctx.resume();
      if (r.state === 'empty' || r.state === 'ready') {
        r.error = '';
        r.state = 'opening';                                   // abriendo el micrófono si no lo está
        this.emit('track', id);
        this.cancelMicRelease();
        const wasOpen = e.mic.ok;
        const ok = await e.openMic();
        if (r.state !== 'opening') return;                     // se canceló mientras tanto
        if (!ok) {
          r.state = r.hasLoop ? 'ready' : 'empty';
          this.emit('track', id);
          if (NRB.micFailToast) NRB.micFailToast(e.mic.error);
          this.scheduleMicRelease();
          return;
        }
        r.state = 'armed';
        r.minBar = 0;
        r.minTime = wasOpen ? 0 : e.ctx.currentTime + 0.45;    // el micro recién abierto necesita unos ms para arrancar
        if (!this.transport.running) { r.minBar = 1; this.transport.start(); }   // un compás de entrada
      } else if (r.state === 'opening' || r.state === 'armed') {
        r.state = r.hasLoop ? 'ready' : 'empty';
        this.scheduleMicRelease();
      } else if (r.state === 'recording') {
        r.stopReq = true;
      }
      this.emit('track', id);
    }

    clear(id) {
      const r = this.tracks[id];
      r.gen++; r.renderGen++;
      if (r.activeSource) { try { r.activeSource.stop(); } catch (e) { /* ya parada */ } r.activeSource = null; }
      this.e.cutChannel(id);
      r.render = null; r.dry = null; r.hasLoop = false; r.state = 'empty';
      r.pendingStart = false; r.anchorBar = null; r.stopReq = false; r.error = '';
      this.state.tracks[id].fx = null;
      NRB.store.touch();
      this.emit('track', id);
      this.scheduleMicRelease();
    }

    setMode(id, mode) {
      this.state.tracks[id].mode = mode;
      NRB.store.touch();
      const r = this.tracks[id];
      if (r.dry && r.state === 'ready') this.rerender(r);
      this.emit('track', id);
    }

    setFx(id, mult) {
      this.state.tracks[id].fx = mult;
      NRB.store.touch();
      const r = this.tracks[id];
      if (r.dry && r.state === 'ready') this.rerender(r);
      this.emit('track', id);
    }

    onKeyChange() {                                           // las voces se re-afinan a la nueva tonalidad
      NRB.REC_IDS.forEach((id) => {
        const r = this.tracks[id];
        if (r.dry && r.state === 'ready' && this.state.tracks[id].mode === 'vocal') this.rerender(r);
      });
    }

    /* ---- eventos del transporte ---- */
    onStart() {
      NRB.REC_IDS.forEach((id) => {
        const r = this.tracks[id];
        r.anchorBar = null;
        r.pendingStart = !!r.render;
        r.activeSource = null;
      });
    }

    onStop() {
      this.e.cutLoops();
      NRB.REC_IDS.forEach((id) => {
        const r = this.tracks[id];
        r.activeSource = null;
        if (r.state === 'opening' || r.state === 'armed' || r.state === 'recording') {   // grabación abortada
          r.gen++;
          r.state = r.hasLoop ? 'ready' : 'empty';
          r.stopReq = false;
          this.emit('track', id);
        }
      });
      this.scheduleMicRelease();
    }

    onBar(bar, T) {
      for (let i = 0; i < NRB.REC_IDS.length; i++) {
        const r = this.tracks[NRB.REC_IDS[i]];
        if (r.state === 'armed' && bar >= r.minBar && T >= r.minTime) {
          r.state = 'recording';
          r.startBar = bar;
          r.startTime = T;
          r.stopReq = false;
          this.emit('track', r.id);
        } else if (r.state === 'recording') {
          const n = bar - r.startBar, fixed = this.state.recBars;
          if (n > 0 && (r.stopReq || (fixed > 0 && n >= fixed) || n >= 16)) this.finishTake(r, bar, T);
        }
        this.playLoop(r, bar, T);
      }
    }

    applyRate(T, bpm) {
      NRB.REC_IDS.forEach((id) => {
        const r = this.tracks[id];
        if (r.activeSource && r.recBpm) {
          r.activeSource.playbackRate.setValueAtTime(bpm / r.recBpm, Math.max(T, this.e.ctx.currentTime));
        }
      });
    }

    playLoop(r, bar, T) {
      if (!r.render) return;
      if (r.pendingStart) { r.anchorBar = bar; r.pendingStart = false; }
      if (r.anchorBar == null) return;
      if ((bar - r.anchorBar) % r.render.renderBars !== 0) return;
      const ctx = this.e.ctx;
      const src = ctx.createBufferSource();
      src.buffer = r.render.buffer;
      src.playbackRate.value = this.state.bpm / r.recBpm;       // si cambias el BPM el loop va "a cinta": mismo compás, otro tono
      src.connect(this.e.channels[r.id].bus);
      if (r.activeSource) { try { r.activeSource.stop(T); } catch (e) { /* ya terminó */ } }
      src.start(T);
      r.activeSource = src;
      src.onended = () => {
        try { src.disconnect(); } catch (e) { /* ya está */ }
        if (r.activeSource === src) r.activeSource = null;
      };
    }

    /* ---- fin de la toma: recoger el audio, prepararlo y procesarlo ---- */
    finishTake(r, bar, T) {
      r.bars = bar - r.startBar;
      r.state = 'processing';
      this.emit('track', r.id);
      const e = this.e, sr = e.ctx.sampleRate;
      const dur = T - r.startTime;
      const loopLen = Math.round(dur * sr);
      const F0 = Math.round(r.startTime * sr);
      const lat = e.roundTripSamples;
      const pad = lat + Math.round(0.1 * sr);              // tras el final hace falta: latencia + cierre del loop
      const gen = ++r.gen;
      const waitMs = Math.max(0, ((F0 + loopLen + pad) / sr - e.ctx.currentTime + 0.12) * 1000);
      this.collecting++;
      setTimeout(() => this.collect(r, gen, F0, loopLen, pad, lat, dur), waitMs);
    }

    async collect(r, gen, F0, loopLen, pad, lat, dur) {
      let released = false;
      const release = () => {                                // el audio ya está recogido (o falló): el micro puede cerrarse
        if (released) return;
        released = true;
        this.collecting--;
        this.scheduleMicRelease();
      };
      try {
        const sr = this.e.ctx.sampleRate;
        const raw = await this.e.recorder.grab(F0, F0 + loopLen + pad);
        release();
        if (gen !== r.gen) return;
        r.dry = NRB.dsp().prepareTake(raw, lat, loopLen, Math.round(0.015 * sr));
        r.recBpm = (r.bars * 240) / dur;
        r.seed = crypto.getRandomValues(new Uint32Array(1))[0];
        this.state.tracks[r.id].fx = null;                 // cada grabación nueva sortea también su propio ciclo de efectos
        NRB.store.touch();
        await this.rerender(r);
      } catch (err) {
        release();
        console.error('[NRB] toma fallida', err);
        if (gen !== r.gen) return;
        r.error = 'No se pudo recoger la toma';
        r.state = r.hasLoop ? 'ready' : 'empty';
        this.emit('track', r.id);
      }
    }

    async rerender(r) {
      if (!r.dry) return;
      const st = this.state.tracks[r.id];
      const gen = ++r.renderGen;
      r.state = 'processing';
      this.emit('track', r.id);
      try {
        const res = await this.e.render({
          type: st.mode === 'vocal' ? 'vocal' : 'ambient',
          dry: r.dry.slice(), sampleRate: this.e.ctx.sampleRate, bpm: r.recBpm, loopBars: r.bars,
          seed: r.seed, cycleMult: st.fx != null ? st.fx : undefined, key: this.state.key,
        });
        if (gen !== r.renderGen) return;
        const ctx = this.e.ctx;
        const buf = ctx.createBuffer(2, res.l.length, ctx.sampleRate);
        buf.copyToChannel(res.l, 0);
        buf.copyToChannel(res.r, 1);
        r.render = {
          buffer: buf, peaks: NRB.dsp().peaks(res.l, res.r, 1200), renderBars: res.renderBars,
          loopBars: r.bars, passes: res.passes, cycleMult: res.cycleMult, info: res.info,
        };
        r.hasLoop = true;
        r.pendingStart = true;
        r.state = 'ready';
        r.error = '';
      } catch (err) {
        if (gen !== r.renderGen) return;
        console.error('[NRB] render fallido', err);
        r.error = 'Fallo al procesar la toma';
        r.state = r.hasLoop ? 'ready' : 'empty';
      }
      this.emit('track', r.id);
    }

    /* fase del loop 0..1 para el cursor de la pista (o -1 si no suena) */
    phase(id, stepPos) {
      const r = this.tracks[id];
      if (!r.render || r.anchorBar == null || stepPos < 0) return -1;
      const rb = r.render.renderBars;
      let p = (stepPos / SPB - r.anchorBar) / rb;
      if (p < 0) return -1;
      p -= Math.floor(p);
      return p;
    }
  }

  NRB.Transport = Transport;
  NRB.Looper = Looper;
})();
