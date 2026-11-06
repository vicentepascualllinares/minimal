/* ============================================================================
 *  NIGHT RIDE THROUGHT BUDAPEST · sintes
 *  Kit estilo 909 (kick, clap, snare, hat, open hat) y bajo monofónico.
 *  Cada voz recibe: env (contexto + buffers), out (nodo destino), t (tiempo),
 *  vel (0..1) y v = { pitch, decay } (variación para el humanize).
 *  Funciona igual con un AudioContext que con un OfflineAudioContext.
 * ========================================================================== */
(function () {
  'use strict';
  const NRB = (window.NRB = window.NRB || {});
  const Synth = (NRB.Synth = {});

  const velGain = (v) => 0.25 + 0.75 * v;

  function tanhCurve(k) {
    const n = 2048, c = new Float32Array(n), d = Math.tanh(k);
    for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i * 2) / (n - 1) - 1)) / d;
    return c;
  }
  function polyBlep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }

  /* buffers compartidos: ruido blanco y "metal" (6 cuadradas inarmónicas de la 808/909) */
  Synth.makeEnv = function (ctx) {
    const sr = ctx.sampleRate;
    const noise = ctx.createBuffer(1, sr * 2, sr);
    {
      const d = noise.getChannelData(0);
      let s = 22222;
      for (let i = 0; i < d.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) | 0; d[i] = s / 2147483648; }
    }
    const metal = ctx.createBuffer(1, sr * 2, sr);
    {
      const d = metal.getChannelData(0);
      [205.3, 304.4, 369.6, 522.7, 540.0, 800.0].forEach((f) => {
        const dt = f / sr;
        let ph = 0;
        for (let i = 0; i < d.length; i++) {
          let v = ph < 0.5 ? 1 : -1;
          v += polyBlep(ph, dt);
          v -= polyBlep((ph + 0.5) % 1, dt);
          d[i] += v;
          ph += dt;
          if (ph >= 1) ph -= 1;
        }
      });
      let pk = 0;
      for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
      for (let i = 0; i < d.length; i++) d[i] /= pk;
    }
    return { ctx, noise, metal, sat: tanhCurve(1.8), satLight: tanhCurve(1.15), openHat: null };
  };

  function noiseSrc(e, t, dur, loop) {
    const s = e.ctx.createBufferSource();
    s.buffer = e.noise;
    s.loop = !!loop;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur);
    return s;
  }
  function filt(ctx, type, f, q) {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    if (q != null) b.Q.value = q;
    return b;
  }

  /* ---- KICK: seno con barrido de tono + saturación + clic ---- */
  Synth.kick = function (e, out, t, vel, v) {
    const ctx = e.ctx, a = velGain(vel);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f = 50 * v.pitch;
    osc.frequency.setValueAtTime(f * 6, t);
    osc.frequency.setTargetAtTime(f, t + 0.001, 0.028);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(a, t + 0.0012);
    g.gain.setTargetAtTime(0, t + 0.0012, 0.085 * v.decay);
    const sh = ctx.createWaveShaper();                  // sin sobremuestreo: los armónicos caen muy por debajo de Nyquist
    sh.curve = e.sat;
    const post = ctx.createGain();
    post.gain.value = 0.76;
    osc.connect(g); g.connect(sh); sh.connect(post); post.connect(out);
    osc.start(t); osc.stop(t + 0.9);
    const click = noiseSrc(e, t, 0.03, false);
    const hp = filt(ctx, 'highpass', 1600, 0.7);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.32 * a, t);
    cg.gain.setTargetAtTime(0, t + 0.0004, 0.004);
    click.connect(hp); hp.connect(cg); cg.connect(out);
  };

  /* ---- CLAP: ruido en banda con 3 ráfagas rápidas y una cola ---- */
  Synth.clap = function (e, out, t, vel, v) {
    const ctx = e.ctx, a = velGain(vel);
    const src = noiseSrc(e, t, 0.5, true);
    const bp = filt(ctx, 'bandpass', 1250 * v.pitch, 1.2);
    const hp = filt(ctx, 'highpass', 600, 0.7);
    const g = ctx.createGain();
    const gaps = [0, 0.0105, 0.021, 0.0305];
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 3; i++) {
      const tb = t + gaps[i];
      g.gain.setValueAtTime(a * 1.7, tb);
      g.gain.setTargetAtTime(0.05 * a, tb + 0.0008, 0.0035);
    }
    const tl = t + gaps[3];
    g.gain.setValueAtTime(a * 1.7, tl);
    g.gain.setTargetAtTime(0, tl + 0.001, 0.05 * v.decay);
    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
  };

  /* ---- SNARE: dos triangulares con caída de tono + ruido "snappy" ---- */
  Synth.snare = function (e, out, t, vel, v) {
    const ctx = e.ctx, a = velGain(vel);
    const mix = ctx.createGain();
    mix.gain.value = 1;
    [[185, 0.5], [330, 0.28]].forEach((p) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(p[0] * v.pitch * 1.28, t);
      o.frequency.setTargetAtTime(p[0] * v.pitch, t + 0.001, 0.012);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(p[1] * a, t + 0.001);
      og.gain.setTargetAtTime(0, t + 0.001, 0.05 * v.decay);
      o.connect(og); og.connect(mix);
      o.start(t); o.stop(t + 0.5);
    });
    const nz = noiseSrc(e, t, 0.5, true);
    const hp = filt(ctx, 'highpass', 1700, 0.7);
    const lpn = filt(ctx, 'lowpass', 8500, 0.7);                 // el ruido de un 909 no llega a 20 kHz
    const pk = filt(ctx, 'peaking', 3800, 0.8);
    pk.gain.value = 4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.78 * a, t + 0.001);
    ng.gain.setTargetAtTime(0, t + 0.001, 0.07 * v.decay);
    nz.connect(hp); hp.connect(lpn); lpn.connect(pk); pk.connect(ng); ng.connect(mix);
    const sh = ctx.createWaveShaper();
    sh.curve = e.satLight;
    const post = ctx.createGain();
    post.gain.value = 0.8;
    mix.connect(sh); sh.connect(post); post.connect(out);
  };

  /* ---- HATS: buffer metálico -> paso banda/alto -> envolvente ---- */
  function hatVoice(e, out, t, vel, v, tc, dur, level) {
    const ctx = e.ctx;
    const src = ctx.createBufferSource();
    src.buffer = e.metal;
    src.loop = true;
    src.playbackRate.value = v.pitch;
    const bp = filt(ctx, 'bandpass', 9800, 0.8);
    const hp = filt(ctx, 'highpass', 6800, 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level * velGain(vel), t + 0.0008);
    g.gain.setTargetAtTime(0, t + 0.0008, tc * v.decay);
    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur);
    return g;
  }
  function chokeOpenHat(e, t) {
    if (!e.openHat) return;
    const g = e.openHat.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0, t, 0.004);
    e.openHat = null;
  }
  Synth.hat = function (e, out, t, vel, v) {
    chokeOpenHat(e, t);
    hatVoice(e, out, t, vel, v, 0.02, 0.25, 2.6);
  };
  Synth.ohat = function (e, out, t, vel, v) {
    chokeOpenHat(e, t);
    const g = hatVoice(e, out, t, vel, v, 0.13, 1.0, 2.4);
    e.openHat = g;
  };

  /* ---- BASS: seno + diente de sierra filtrada con envolvente de corte ---- */
  Synth.bass = function (e, out, t, dur, midi, vel, v) {
    const ctx = e.ctx;
    const f = 440 * Math.pow(2, (midi - 69) / 12) * v.pitch;
    const a = velGain(vel);
    const end = t + Math.max(0.03, dur);
    const lp = filt(ctx, 'lowpass', Math.min(f * 8, 3600), -2);   // Q en dB (≈ 0.8 clásico)
    lp.frequency.setValueAtTime(Math.min(f * 8, 3600), t);
    lp.frequency.setTargetAtTime(f * 2.4, t + 0.002, 0.09 * v.decay);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = f * 1.002;
    const sg = ctx.createGain();
    sg.gain.value = 0.42;
    saw.connect(sg); sg.connect(lp);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f;
    const subG = ctx.createGain();
    subG.gain.value = 0.9;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(a, t + 0.004);
    amp.gain.setTargetAtTime(a * 0.78, t + 0.004, 0.12);
    amp.gain.setTargetAtTime(0, end, 0.022);
    sub.connect(subG); subG.connect(amp);
    lp.connect(amp);
    const sh = ctx.createWaveShaper();
    sh.curve = e.satLight;
    const post = ctx.createGain();
    post.gain.value = 0.6;
    amp.connect(sh); sh.connect(post); post.connect(out);
    saw.start(t); sub.start(t);
    saw.stop(end + 0.2); sub.stop(end + 0.2);
  };

  Synth.drums = { kick: Synth.kick, clap: Synth.clap, snare: Synth.snare, hat: Synth.hat, ohat: Synth.ohat };
})();
