/* ============================================================================
 *  MIXER OF ALEXANDRIA: MINIMAL · DSP
 *  ----------------------------------------------------------------------------
 *  JS puro: sin DOM y sin Web Audio. Se carga como script normal en el hilo
 *  principal, se serializa (toString) dentro de un Worker creado con Blob, y se
 *  puede cargar con require() desde Node para los tests.
 *
 *  Qué hace:
 *   · renderAmbient(): convierte una grabación en un "ambiente". Los efectos
 *     (glitch, granulado, filtro, delay, reverb...) se generan UNA vez a partir
 *     de una semilla y quedan fijos para esa grabación. El ciclo de los efectos
 *     puede ser ½, 1, 2 o 4 veces la duración del loop.
 *   · renderVocal(): trata la grabación como voz (gate, afinación a la
 *     tonalidad, compresión, EQ y una sala corta).
 * ========================================================================== */
function NRB_DSP_FACTORY() {
  'use strict';
  const D = {};
  const PI = Math.PI, TAU = Math.PI * 2;

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dbToLin = (db) => Math.pow(10, db / 20);
  const linToDb = (x) => 20 * Math.log10(Math.max(Math.abs(x), 1e-12));
  const mod = (a, n) => ((a % n) + n) % n;
  D.dbToLin = dbToLin;
  D.linToDb = linToDb;

  /* ------------------------------------------------------------------------
   *  Aleatoriedad determinista (misma semilla -> mismo resultado siempre)
   * ---------------------------------------------------------------------- */
  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash32(a, b, c) {
    let h = (a | 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (b | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h ^ (c | 0), 0xc2b2ae35);
    h ^= h >>> 16;
    h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
    h ^= h >>> 13;
    return h >>> 0;
  }
  const rngFor = (seed, a, b) => mulberry32(hash32(seed, a, b));
  D.mulberry32 = mulberry32;
  D.hash32 = hash32;
  D.rngFor = rngFor;

  function wpick(r, items, weights) {
    let t = 0;
    for (let i = 0; i < weights.length; i++) t += weights[i];
    let x = r() * t;
    for (let i = 0; i < items.length; i++) {
      x -= weights[i];
      if (x <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /* ------------------------------------------------------------------------
   *  Filtros
   * ---------------------------------------------------------------------- */
  class Biquad {
    constructor() {
      this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
      this.z1 = 0; this.z2 = 0;
    }
    set(type, fc, q, gainDb, sr) {
      const w0 = (TAU * clamp(fc, 10, sr * 0.499)) / sr;
      const c = Math.cos(w0), s = Math.sin(w0);
      const alpha = s / (2 * (q || 0.7071));
      let b0, b1, b2, a0, a1, a2;
      switch (type) {
        case 'lp':
          b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha; break;
        case 'hp':
          b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha; break;
        case 'bp':
          b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha; break;
        case 'peak': {
          const A = Math.pow(10, (gainDb || 0) / 40);
          b0 = 1 + alpha * A; b1 = -2 * c; b2 = 1 - alpha * A;
          a0 = 1 + alpha / A; a1 = -2 * c; a2 = 1 - alpha / A; break;
        }
        case 'hshelf': {
          const A = Math.pow(10, (gainDb || 0) / 40);
          const sq = 2 * Math.sqrt(A) * ((s / 2) * Math.SQRT2);
          b0 = A * (A + 1 + (A - 1) * c + sq);
          b1 = -2 * A * (A - 1 + (A + 1) * c);
          b2 = A * (A + 1 + (A - 1) * c - sq);
          a0 = A + 1 - (A - 1) * c + sq;
          a1 = 2 * (A - 1 - (A + 1) * c);
          a2 = A + 1 - (A - 1) * c - sq; break;
        }
        default:
          b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
      }
      const inv = 1 / a0;
      this.b0 = b0 * inv; this.b1 = b1 * inv; this.b2 = b2 * inv;
      this.a1 = a1 * inv; this.a2 = a2 * inv;
      return this;
    }
    process(x) {
      const y = this.b0 * x + this.z1;
      this.z1 = this.b1 * x - this.a1 * y + this.z2;
      this.z2 = this.b2 * x - this.a2 * y;
      return y;
    }
    reset() { this.z1 = 0; this.z2 = 0; }
  }

  /* Filtro de variables de estado (TPT): estable aunque el corte se modula rápido */
  class SVF {
    constructor() {
      this.ic1 = 0; this.ic2 = 0;
      this.a1 = 1; this.a2 = 0; this.a3 = 0; this.k = 1;
      this.lp = 0; this.bp = 0; this.hp = 0;
    }
    set(fc, q, sr) {
      const g = Math.tan((PI * Math.min(fc, sr * 0.45)) / sr);
      this.k = 1 / q;
      this.a1 = 1 / (1 + g * (g + this.k));
      this.a2 = g * this.a1;
      this.a3 = g * this.a2;
    }
    process(x) {
      const v3 = x - this.ic2;
      const v1 = this.a1 * this.ic1 + this.a2 * v3;
      const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
      this.ic1 = 2 * v1 - this.ic1;
      this.ic2 = 2 * v2 - this.ic2;
      this.lp = v2; this.bp = v1; this.hp = x - this.k * v1 - v2;
      return v2;
    }
  }

  /* Pasa la señal 2 veces por la cadena y devuelve la 2ª: el resultado es "circular"
     (el final del loop enlaza con el principio sin transitorios) */
  function runFilters(x, filters) {
    const n = x.length, y = new Float32Array(n);
    for (let f = 0; f < filters.length; f++) filters[f].reset();
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < n; i++) {
        let v = x[i];
        for (let k = 0; k < filters.length; k++) v = filters[k].process(v);
        if (p === 1) y[i] = v;
      }
    }
    return y;
  }

  function rmsOf(x, a, b) {
    a = a || 0; b = b == null ? x.length : b;
    let e = 0;
    for (let i = a; i < b; i++) e += x[i] * x[i];
    return Math.sqrt(e / Math.max(1, b - a));
  }
  D.rmsOf = rmsOf;

  /* ------------------------------------------------------------------------
   *  Reverb (red de retardos con realimentación, 8 líneas + difusión)
   * ---------------------------------------------------------------------- */
  class Allpass {
    constructor(len, g) { this.b = new Float32Array(Math.max(1, len)); this.i = 0; this.g = g; }
    process(x) {
      const z = this.b[this.i];
      const w = x + this.g * z;
      this.b[this.i] = w;
      if (++this.i >= this.b.length) this.i = 0;
      return z - this.g * w;
    }
  }

  function wht8(v) {
    for (let i = 0; i < 8; i += 2) { const a = v[i], b = v[i + 1]; v[i] = a + b; v[i + 1] = a - b; }
    for (let i = 0; i < 8; i += 4) {
      for (let j = 0; j < 2; j++) { const a = v[i + j], b = v[i + j + 2]; v[i + j] = a + b; v[i + j + 2] = a - b; }
    }
    for (let j = 0; j < 4; j++) { const a = v[j], b = v[j + 4]; v[j] = a + b; v[j + 4] = a - b; }
    const s = 0.35355339059327373;
    for (let i = 0; i < 8; i++) v[i] *= s;
  }

  const FDN_BASE = [1031, 1327, 1559, 1823, 2053, 2309, 2663, 2999];
  const FDN_SGN = [1, -1, 1, -1, -1, 1, -1, 1];

  class FDN {
    /* loopLen (opcional): cuantiza las LFO para que sean periódicas con el loop,
       así el final del loop enlaza con el principio sin ningún salto */
    constructor(sr, rt60, damp, preDelay, sizeScale, seed, loopLen) {
      const sc = (sr / 44100) * (sizeScale || 1);
      this.len = FDN_BASE.map((b) => Math.max(16, Math.round(b * sc)));
      this.size = this.len.map((l) => l + 40);
      this.buf = this.size.map((s) => new Float32Array(s));
      this.w = new Int32Array(8);
      this.g = new Float32Array(8);
      for (let i = 0; i < 8; i++) this.g[i] = Math.pow(10, (-3 * this.len[i]) / (Math.max(0.1, rt60) * sr));
      this.damp = clamp(damp, 0, 0.97);
      /* doble precisión: la fase de las LFO acumula millones de incrementos minúsculos y con
         32 bits se pierde precisión (el loop dejaría de cerrar bien) */
      this.lp = new Float64Array(8);
      this.d = new Float64Array(8);
      this.v = new Float64Array(8);
      this.ph = new Float64Array(8);
      this.inc = new Float64Array(8);
      this.depth = new Float64Array(8);
      const r = mulberry32(seed || 12345);
      for (let i = 0; i < 8; i++) {
        this.ph[i] = r() * TAU;
        const rate = 0.07 + r() * 0.35;
        if (loopLen) this.inc[i] = (TAU * Math.max(1, Math.round((rate * loopLen) / sr))) / loopLen;
        else this.inc[i] = (TAU * rate) / sr;
        this.depth[i] = 3 + r() * 6;
      }
      this.ap = [[142, 0.62], [107, 0.62], [379, 0.6], [277, 0.6]].map((p) => new Allpass(Math.round(p[0] * sc), p[1]));
      this.pre = new Float32Array(Math.max(1, preDelay | 0));
      this.pi = 0;
      this.outL = 0; this.outR = 0;
    }
    process(x) {
      if (this.pre.length > 1) {
        const y = this.pre[this.pi];
        this.pre[this.pi] = x;
        if (++this.pi >= this.pre.length) this.pi = 0;
        x = y;
      }
      for (let a = 0; a < 4; a++) x = this.ap[a].process(x);
      const d = this.d, v = this.v;
      for (let i = 0; i < 8; i++) {
        const b = this.buf[i], sz = this.size[i];
        const m = this.depth[i] * Math.sin(this.ph[i]);
        this.ph[i] += this.inc[i];
        const rp = this.w[i] - this.len[i] - m;
        let ri = Math.floor(rp);
        const f = rp - ri;
        ri = ((ri % sz) + sz) % sz;
        const r2 = ri + 1 === sz ? 0 : ri + 1;
        d[i] = b[ri] + (b[r2] - b[ri]) * f;
      }
      const dm = this.damp;
      for (let i = 0; i < 8; i++) {
        this.lp[i] = d[i] * (1 - dm) + this.lp[i] * dm;
        v[i] = this.lp[i] * this.g[i];
      }
      wht8(v);
      for (let i = 0; i < 8; i++) {
        this.buf[i][this.w[i]] = x * 0.35 * FDN_SGN[i] + v[i];
        if (++this.w[i] >= this.size[i]) this.w[i] = 0;
      }
      this.outL = (d[0] - d[1] + d[2] - d[3] + d[4] - d[5] + d[6] - d[7]) * 0.5;
      this.outR = (d[0] + d[1] - d[2] - d[3] + d[4] + d[5] - d[6] - d[7]) * 0.5;
    }
  }

  /* Delay en ping-pong con realimentación filtrada */
  class PingPong {
    constructor(sr, delaySamples, fb) {
      this.n = Math.max(32, delaySamples | 0);
      this.bl = new Float32Array(this.n);
      this.br = new Float32Array(this.n);
      this.i = 0; this.fb = fb;
      this.lpL = new Biquad().set('lp', 3200, 0.7071, 0, sr);
      this.lpR = new Biquad().set('lp', 3200, 0.7071, 0, sr);
      this.hpL = new Biquad().set('hp', 220, 0.7071, 0, sr);
      this.hpR = new Biquad().set('hp', 220, 0.7071, 0, sr);
      this.outL = 0; this.outR = 0;
    }
    process(inL, inR) {
      const i = this.i;
      const yL = this.bl[i], yR = this.br[i];
      this.outL = yL; this.outR = yR;
      const fL = this.hpL.process(this.lpL.process(yL));
      const fR = this.hpR.process(this.lpR.process(yR));
      this.bl[i] = (inL + inR) * 0.5 + this.fb * fR;
      this.br[i] = this.fb * fL;
      if (++this.i >= this.n) this.i = 0;
    }
  }

  /* ------------------------------------------------------------------------
   *  Preparar la toma recién grabada
   *  - compensa la latencia (entrada + salida)
   *  - cierra el loop con un crossfade usando el audio que sigue al final
   * ---------------------------------------------------------------------- */
  D.prepareTake = function (raw, latSamples, loopSamples, seamSamples) {
    const n = loopSamples;
    const x = new Float32Array(n + seamSamples);
    for (let i = 0; i < x.length; i++) {
      const j = i + latSamples;
      x[i] = j < raw.length ? raw[j] : 0;
    }
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i];
    for (let i = 0; i < seamSamples; i++) {
      const w = 0.5 - 0.5 * Math.cos((PI * (i + 0.5)) / seamSamples);
      y[i] = x[i] * w + x[n + i] * (1 - w);
    }
    let m = 0;
    for (let i = 0; i < n; i++) m += y[i];
    m /= n;
    for (let i = 0; i < n; i++) y[i] -= m;
    return y;
  };

  /* ========================================================================
   *  AMBIENT
   * ====================================================================== */
  const GLITCHES = ['stutter', 'reverse', 'tapestop', 'rise', 'freeze', 'drop', 'crush', 'shuffle'];

  /* "Personalidad" del ambiente: sale de la semilla, se calcula una vez y no cambia */
  D.ambientCharacter = function (seed) {
    const r = rngFor(seed >>> 0, 101, 7);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const ch = {};
    ch.cycleMult = wpick(r, [0.5, 1, 2, 4], [0.14, 0.2, 0.36, 0.3]);
    ch.glitch = 0.1 + r() * 0.25;
    ch.glitchW = GLITCHES.map(() => 0.2 + r());
    ch.cloud = 0.45 + r() * 0.55;
    ch.drone = r() < 0.7 ? 0.25 + r() * 0.5 : 0;
    ch.density = 5 + r() * 12;
    ch.pitches = pick([[1], [1, 2, 0.5], [1, 1.5, 0.5, 0.75], [1, 1.2599, 1.4983, 2, 0.5], [1, 0.5, 0.5, 2]]);
    ch.filter = wpick(r, ['lp', 'bp'], [0.7, 0.3]);
    ch.fLo = 200 + r() * 450;
    ch.fHi = 2200 + r() * 5600;
    ch.fQ = 0.9 + r() * 2.6;
    ch.rt60 = 3 + r() * 6;
    ch.damp = 0.3 + r() * 0.5;
    ch.verbWet = 0.5 + r() * 0.4;
    ch.delay = r() < 0.75;
    ch.delayBeats = pick([0.75, 1, 1.5, 0.5]);
    ch.delayFb = 0.4 + r() * 0.25;
    ch.delayWet = 0.18 + r() * 0.3;
    ch.drive = 1 + r() * 2.5;
    ch.dryMix = 0.35 + r() * 0.4;
    ch.width = 1 + r() * 0.5;
    return ch;
  };

  function readLin(src, n, p) {
    let i = Math.floor(p);
    const f = p - i;
    i = mod(i, n);
    const a = src[i], b = src[i + 1 === n ? 0 : i + 1];
    return a + (b - a) * f;
  }

  /* acondiciona la toma: quita graves molestos y la lleva a un nivel de trabajo */
  function conditionAmbient(dry, sr) {
    const hp = new Biquad().set('hp', 60, 0.7071, 0, sr);
    const x = runFilters(dry, [hp]);
    const rms = Math.max(1e-9, rmsOf(x));
    const gain = Math.min(dbToLin(40), dbToLin(-22) / rms);
    for (let i = 0; i < x.length; i++) x[i] *= gain;
    return x;
  }

  /* -- A) re-ordenado de la fuente: stutters, reversas, tape-stops... ------ */
  function applyGlitch(g, src, T, st, len, ev, sr, beat) {
    const n = src.length;
    const fl = Math.max(8, Math.min(Math.floor(0.003 * sr), len >> 2));
    let k = mod(st, T);
    const put = (u, v) => {
      const w = Math.min(1, (u + 1) / fl, (len - u) / fl);
      g[k] += (v - g[k]) * w;
      if (++k === T) k = 0;
    };
    switch (ev.type) {
      case 'stutter': {
        const sl = Math.max(64, Math.round(beat * ev.slice));
        const f2 = Math.max(4, Math.min(fl, sl >> 2));
        for (let u = 0; u < len; u++) {
          const i = u % sl;
          put(u, readLin(src, n, st + i * ev.rate) * Math.min(1, i / f2, (sl - 1 - i) / f2));
        }
        break;
      }
      case 'reverse':
        for (let u = 0; u < len; u++) put(u, readLin(src, n, st + len - 1 - u));
        break;
      case 'tapestop': {
        const tau = len / 3;
        for (let u = 0; u < len; u++) {
          const sp = Math.exp(-u / tau);
          put(u, readLin(src, n, st + tau * (1 - sp)) * Math.pow(sp, 0.6));
        }
        break;
      }
      case 'rise':
        for (let u = 0; u < len; u++) {
          const pos = st + u + (2.5 * u * u * u) / (3 * len * len);
          put(u, readLin(src, n, pos) * Math.min(1, u / (fl * 2)));
        }
        break;
      case 'freeze': {
        const gl = Math.round(ev.fz * sr), hop = gl >> 1;
        const tmp = new Float32Array(len);
        for (let s0 = 0; s0 < len; s0 += hop) {
          for (let i = 0; i < gl && s0 + i < len; i++) {
            tmp[s0 + i] += (0.5 - 0.5 * Math.cos((TAU * (i + 0.5)) / gl)) * readLin(src, n, st + i);
          }
        }
        for (let u = 0; u < len; u++) put(u, tmp[u]);
        break;
      }
      case 'drop':
        for (let u = 0; u < len; u++) put(u, 0);
        break;
      case 'crush': {
        const q = Math.pow(2, ev.bits - 1);
        let held = 0;
        for (let u = 0; u < len; u++) {
          if (u % ev.hold === 0) held = Math.round(readLin(src, n, st + u) * q * 0.8) / q;
          put(u, held * 0.9);
        }
        break;
      }
      case 'shuffle': {
        const sl = Math.max(64, Math.floor(len / ev.slices));
        const rr = mulberry32(hash32(st, ev.slices, 77));
        let idx = 0;
        for (let u = 0; u < len; u++) {
          const i = u % sl;
          if (i === 0) idx = Math.floor(rr() * ev.slices);
          const f2 = Math.max(4, Math.min(fl, sl >> 2));
          put(u, readLin(src, n, st + idx * sl + i) * Math.min(1, i / f2, (sl - 1 - i) / f2));
        }
        break;
      }
    }
  }

  function buildGlitch(src, T, cycle, beat, ch, seed, sr) {
    const n = src.length;
    const g = new Float32Array(T);
    for (let i = 0; i < T; i++) g[i] = src[i % n];
    const cycleBeats = Math.max(1, Math.round(cycle / beat));
    const reps = Math.max(1, Math.round(T / cycle));
    const cycleEnd = Math.round(cycleBeats * beat);
    const events = [];
    /* Cada beat decide por sí mismo (a partir de la semilla y su número de beat):
       si cambias el ciclo de efectos, los beats que ya existían no cambian. */
    const makeEvent = (b, force) => {
      const r = rngFor(seed, 201, b);
      const roll = r();
      if (!force && roll > ch.glitch) return null;
      const type = wpick(r, GLITCHES, ch.glitchW);
      const lenBeats = [1, 0.5, 0.5, 0.25, 0.75, 1][Math.floor(r() * 6)];
      const offBeats = r() < 0.35 ? [0.25, 0.5][Math.floor(r() * 2)] : 0;
      const pr = rngFor(seed, 202, b);
      const rateRoll = pr();
      const ev = {
        type,
        slice: [0.5, 0.25, 0.125][Math.floor(pr() * 3)],
        rate: rateRoll < 0.1 ? 0.5 : rateRoll < 0.2 ? 2 : 1,
        hold: [6, 9, 14][Math.floor(pr() * 3)],
        bits: 4 + Math.floor(pr() * 3),
        slices: [4, 6, 8][Math.floor(pr() * 3)],
        fz: 0.045 + pr() * 0.06,
      };
      const st = Math.round((b + offBeats) * beat);
      const len = Math.min(Math.round(lenBeats * beat), cycleEnd - st);
      return len < 256 ? null : { ev, st, len };
    };
    for (let b = 0; b < cycleBeats; b++) {
      const e = makeEvent(b, false);
      if (e) events.push(e);
    }
    if (!events.length && cycleBeats >= 4) {         // al menos un glitch por ciclo
      const e = makeEvent(Math.floor(rngFor(seed, 203, 0)() * cycleBeats), true);
      if (e) events.push(e);
    }
    for (const e of events) {
      for (let j = 0; j < reps; j++) applyGlitch(g, src, T, j * cycle + e.st, e.len, e.ev, sr, beat);
    }
    return { g, events: events.length };
  }

  /* -- B) nube granular: convierte cualquier sonido en textura/drone ------- */
  function buildCloud(src, T, cycle, beat, ch, seed, sr) {
    const n = src.length;
    const L = new Float32Array(T), R = new Float32Array(T);
    const reps = Math.max(1, Math.round(T / cycle));
    const srcRms = Math.max(1e-6, rmsOf(src));
    const layers = [
      { salt: 301, level: ch.cloud, density: ch.density, minLen: 0.07, maxLen: 0.28, pitches: ch.pitches },
      { salt: 302, level: ch.drone, density: 0.35 + ch.density * 0.04, minLen: 1.0, maxLen: 2.8, pitches: [0.5, 0.5, 0.75, 1] },
    ];
    for (const layer of layers) {
      if (layer.level <= 0) continue;
      const tL = new Float32Array(T), tR = new Float32Array(T);
      const step = sr / layer.density;
      const nGr = Math.max(1, Math.floor(cycle / step));
      for (let gi = 0; gi < nGr; gi++) {
        const r = rngFor(seed, layer.salt, gi);
        const onset = Math.round(gi * step + (r() - 0.5) * step * 0.8);
        const len = Math.max(64, Math.round(lerp(layer.minLen, layer.maxLen, Math.pow(r(), 1.5)) * sr));
        const ratio = layer.pitches[Math.floor(r() * layer.pitches.length)];
        const jump = r() < 0.25;
        const off = jump ? Math.floor(r() * n) : Math.round((r() - 0.5) * 0.8 * sr);
        const pan = (r() * 2 - 1) * 0.85;
        const amp = 0.5 + 0.5 * r();
        const ang = (pan * 0.5 + 0.5) * (PI / 2);
        const gl = Math.cos(ang) * amp, gr = Math.sin(ang) * amp;
        for (let j = 0; j < reps; j++) {
          const o = j * cycle + onset;
          const base = jump ? off : o + off;
          let k = mod(o, T);
          for (let i = 0; i < len; i++) {
            const w = 0.5 - 0.5 * Math.cos((TAU * (i + 0.5)) / len);
            const s = readLin(src, n, base + i * ratio) * w;
            tL[k] += s * gl;
            tR[k] += s * gr;
            if (++k === T) k = 0;
          }
        }
      }
      const rr = Math.max(1e-9, Math.sqrt((rmsOf(tL) ** 2 + rmsOf(tR) ** 2) / 2));
      const gain = (srcRms / rr) * layer.level;
      for (let i = 0; i < T; i++) { L[i] += tL[i] * gain; R[i] += tR[i] * gain; }
    }
    return { L, R };
  }

  /* -- curvas de control periódicas (Catmull-Rom) -------------------------- */
  function makeCurve(seed, salt, n) {
    const r = rngFor(seed, salt, 0);
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = r();
    return a;
  }
  function evalCurve(a, pos) {
    const n = a.length;
    let i = Math.floor(pos);
    const f = pos - i;
    i = mod(i, n);
    const p0 = a[(i - 1 + n) % n], p1 = a[i], p2 = a[(i + 1) % n], p3 = a[(i + 2) % n];
    const v = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
    return clamp(v, 0, 1);
  }

  /* -- C) cadena serie: filtro móvil -> saturación -> delay -> reverb ------
        Se procesa con un "pre-roll" para que las colas de reverb/delay del final
        entren en el principio: el loop suena continuo, sin corte. -------- */
  const REV_GAIN = 1.0;

  function runChain(g, cl, T, cycle, beat, ch, seed, sr) {
    const outL = new Float32Array(T), outR = new Float32Array(T);
    const cycleBeats = Math.max(1, Math.round(cycle / beat));
    const cpBeats = cycleBeats >= 8 ? 2 : 1;
    const nCp = Math.max(2, Math.round(cycleBeats / cpBeats));
    const cpLen = cycle / nCp;
    const cF = makeCurve(seed, 401, nCp), cW = makeCurve(seed, 402, nCp), cD = makeCurve(seed, 403, nCp);
    const svfL = new SVF(), svfR = new SVF();
    const lnLo = Math.log(ch.fLo), lnHi = Math.log(ch.fHi);
    const dly = ch.delay ? new PingPong(sr, Math.round(ch.delayBeats * beat), ch.delayFb) : null;
    const rev = new FDN(sr, ch.rt60, ch.damp, Math.round(0.03 * sr), 1 + (ch.rt60 - 3) * 0.06, hash32(seed, 9, 9), T);
    const hpL = new Biquad().set('hp', 55, 0.7071, 0, sr), hpR = new Biquad().set('hp', 55, 0.7071, 0, sr);
    const lpL = new Biquad().set('lp', 9500, 0.6, 0, sr), lpR = new Biquad().set('lp', 9500, 0.6, 0, sr);
    const warm = Math.min(Math.round(ch.rt60 * sr * 0.9), Math.round(14 * sr));
    const total = warm + T;
    const drive = ch.drive, invDrive = 1 / ch.drive;
    let wet = 0, dw = 0;
    for (let c = 0; c < total; c++) {
      const n = c - warm;
      const idx = n >= 0 ? n : mod(n, T);
      if ((c & 31) === 0) {
        const pos = (idx % cycle) / cpLen;
        const cut = Math.exp(lerp(lnLo, lnHi, evalCurve(cF, pos)));
        svfL.set(cut, ch.fQ, sr);
        svfR.set(cut * 1.03, ch.fQ, sr);
        wet = ch.verbWet * (0.45 + 0.55 * evalCurve(cW, pos));
        dw = ch.delayWet * (0.2 + 0.8 * evalCurve(cD, pos));
      }
      const x = g[idx] * ch.dryMix;
      svfL.process(x + cl.L[idx]);
      svfR.process(x + cl.R[idx]);
      let fL, fR;
      if (ch.filter === 'lp') { fL = svfL.lp; fR = svfR.lp; }
      else { fL = 0.8 * svfL.k * svfL.bp + 0.35 * svfL.lp; fR = 0.8 * svfR.k * svfR.bp + 0.35 * svfR.lp; }
      fL = Math.tanh(fL * drive) * invDrive;
      fR = Math.tanh(fR * drive) * invDrive;
      let dL = 0, dR = 0;
      if (dly) { dly.process(fL, fR); dL = dly.outL * dw; dR = dly.outR * dw; }
      rev.process((fL + fR) * 0.5 + (dL + dR) * 0.3);
      const oL = hpL.process(lpL.process(fL + dL + rev.outL * wet * REV_GAIN));
      const oR = hpR.process(lpR.process(fR + dR + rev.outR * wet * REV_GAIN));
      if (n >= 0) { outL[n] = oL; outR[n] = oR; }
    }
    return { l: outL, r: outR };
  }

  function finalizeStereo(l, r, width, targetDb) {
    const n = l.length;
    for (let i = 0; i < n; i++) {
      const m = (l[i] + r[i]) * 0.5, s = (l[i] - r[i]) * 0.5 * width;
      l[i] = m + s; r[i] = m - s;
    }
    const rms = Math.max(1e-9, Math.sqrt((rmsOf(l) ** 2 + rmsOf(r) ** 2) / 2));
    const gain = Math.min(dbToLin(30), dbToLin(targetDb) / rms);
    for (let i = 0; i < n; i++) { l[i] = Math.tanh(l[i] * gain); r[i] = Math.tanh(r[i] * gain); }
  }

  D.renderAmbient = function (o) {
    const sr = o.sampleRate, dry = o.dry, loopLen = dry.length;
    const seed = o.seed >>> 0;
    const ch = D.ambientCharacter(seed);
    let k = o.cycleMult != null ? o.cycleMult : ch.cycleMult;
    const beat = loopLen / (4 * o.loopBars);
    while (k > 1 && loopLen * Math.round(k) > sr * 60) k /= 2;     // tope de memoria
    const passes = k >= 1 ? Math.round(k) : 1;
    const T = loopLen * passes;
    const cycle = k >= 1 ? T : Math.round(T * k);
    const src = conditionAmbient(dry, sr);
    const gl = buildGlitch(src, T, cycle, beat, ch, seed, sr);
    const cl = buildCloud(src, T, cycle, beat, ch, seed, sr);
    const out = runChain(gl.g, cl, T, cycle, beat, ch, seed, sr);
    finalizeStereo(out.l, out.r, ch.width, -20);
    return {
      l: out.l, r: out.r, passes, renderBars: o.loopBars * passes, cycleMult: k,
      info: {
        kind: 'ambient', cycleMult: k, passes, glitch: gl.events, filter: ch.filter,
        rt60: ch.rt60, delay: ch.delay ? ch.delayBeats : 0, drone: ch.drone > 0, seed,
      },
    };
  };

  /* ========================================================================
   *  VOZ
   * ====================================================================== */
  D.SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10],
    major: [0, 2, 4, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    harmonic: [0, 2, 3, 5, 7, 8, 11],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };
  D.scaleMask = function (root, scale) {
    const m = new Array(12).fill(false);
    const s = D.SCALES[scale] || D.SCALES.minor;
    for (let i = 0; i < s.length; i++) m[(root + s[i]) % 12] = true;
    return m;
  };

  /* Seguimiento de tono (YIN) sobre una versión diezmada de la señal */
  D.yinTrack = function (x, sr) {
    const Dn = Math.max(1, Math.round(sr / 12000));
    const sd = sr / Dn;
    const nd = Math.floor(x.length / Dn);
    const xd = new Float32Array(nd);
    for (let i = 0; i < nd; i++) {
      let s = 0;
      for (let j = 0; j < Dn; j++) s += x[i * Dn + j];
      xd[i] = s / Dn;
    }
    const hop = Math.max(8, Math.round(sd * 0.006));
    const W = Math.round(sd * 0.03);
    const tauMin = Math.max(2, Math.floor(sd / 800));
    const tauMax = Math.ceil(sd / 70);
    const frames = Math.max(0, Math.floor((nd - W - tauMax - 1) / hop));
    const f0 = new Float32Array(frames), conf = new Float32Array(frames), center = new Float32Array(frames);
    const d = new Float32Array(tauMax + 2), dn = new Float32Array(tauMax + 2);
    for (let fr = 0; fr < frames; fr++) {
      const s0 = fr * hop;
      center[fr] = (s0 + W / 2 + tauMax / 3) * Dn;
      let e = 0;
      for (let j = 0; j < W; j++) e += xd[s0 + j] * xd[s0 + j];
      if (e / W < 2.5e-7) continue;                         // silencio
      for (let tau = 1; tau <= tauMax; tau++) {
        let sum = 0;
        for (let j = 0; j < W; j++) { const dl = xd[s0 + j] - xd[s0 + j + tau]; sum += dl * dl; }
        d[tau] = sum;
      }
      dn[0] = 1;
      let run = 0;
      for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; dn[tau] = run > 0 ? (d[tau] * tau) / run : 1; }
      let tauE = -1;
      for (let tau = tauMin; tau < tauMax; tau++) {
        if (dn[tau] < 0.15) {
          while (tau + 1 < tauMax && dn[tau + 1] < dn[tau]) tau++;
          tauE = tau; break;
        }
      }
      if (tauE < 0) {
        let best = 1e9;
        for (let tau = tauMin; tau < tauMax; tau++) if (dn[tau] < best) { best = dn[tau]; tauE = tau; }
        if (best > 0.35) continue;
      }
      let tf = tauE;
      if (tauE > 1 && tauE < tauMax) {
        const a = dn[tauE - 1], b = dn[tauE], c = dn[tauE + 1];
        const den = a - 2 * b + c;
        if (Math.abs(den) > 1e-9) tf = tauE + (a - c) / (2 * den);
      }
      f0[fr] = sd / tf;
      conf[fr] = 1 - dn[tauE];
    }
    return { f0, conf, center, hop: hop * Dn, n: frames };
  };

  /* Afinación suave a la escala (TD-PSOLA). Solo corrige como máximo ~1,5 semitonos. */
  D.autotune = function (x, sr, mask, opts) {
    opts = opts || {};
    const strength = opts.strength != null ? opts.strength : 0.92;
    const speed = opts.speed || 0.028;
    const N = x.length;
    const trk = D.yinTrack(x, sr);
    const nF = trk.n;
    if (nF < 6) return { y: x, voiced: 0 };

    // 1) mascara de tramos con voz (mediana + limpieza de tramos cortos)
    const voiced = new Uint8Array(nF);
    for (let i = 0; i < nF; i++) voiced[i] = trk.f0[i] > 0 && trk.conf[i] >= 0.65 ? 1 : 0;
    const lf = new Float32Array(nF);
    for (let i = 0; i < nF; i++) lf[i] = voiced[i] ? Math.log2(trk.f0[i]) : 0;
    const med = new Float32Array(nF);
    for (let i = 0; i < nF; i++) {
      if (!voiced[i]) continue;
      const w = [];
      for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < nF && voiced[j]) w.push(lf[j]); }
      w.sort((a, b) => a - b);
      med[i] = w[w.length >> 1];
    }
    for (let i = 0; i < nF;) {
      if (!voiced[i]) { i++; continue; }
      let j = i;
      while (j < nF && voiced[j]) j++;
      if (j - i < 4) for (let k = i; k < j; k++) voiced[k] = 0;
      i = j;
    }

    // 2) contorno de corrección en semitonos
    const corr = new Float32Array(nF);
    const aS = 1 - Math.exp(-(trk.hop / sr) / speed);
    let prev = false, cur = 0, voicedFrames = 0;
    for (let i = 0; i < nF; i++) {
      if (!voiced[i]) { prev = false; continue; }
      voicedFrames++;
      const m = 69 + 12 * (med[i] - Math.log2(440));
      const r0 = Math.round(m);
      let best = null, bd = 99;
      for (let c = r0 - 2; c <= r0 + 2; c++) {
        if (mask[mod(c, 12)]) { const dd = Math.abs(c - m); if (dd < bd) { bd = dd; best = c; } }
      }
      if (best === null) { prev = false; continue; }
      const delta = clamp((best - m) * strength, -1.6, 1.6);
      if (!prev) cur = delta; else cur += (delta - cur) * aS;
      corr[i] = cur;
      prev = true;
    }

    // 3) marcas de pitch (picos de la señal filtrada) en los tramos con voz
    const lpf = new Biquad().set('lp', 700, 0.7071, 0, sr);
    const xl = new Float32Array(N);
    for (let i = 0; i < N; i++) xl[i] = lpf.process(x[i]);
    const frameAt = (pos) => clamp(Math.round((pos - trk.center[0]) / trk.hop), 0, nF - 1);
    const periodAt = (pos) => sr / Math.max(60, trk.f0[frameAt(pos)] || 150);
    const marks = [];
    for (let i = 0; i < nF;) {
      if (!voiced[i]) { i++; continue; }
      let j = i;
      while (j < nF && voiced[j]) j++;
      const start = Math.max(0, Math.round(trk.center[i] - trk.hop / 2));
      const end = Math.min(N - 1, Math.round(trk.center[j - 1] + trk.hop / 2));
      let pos = start;
      const T0 = Math.round(periodAt(start));
      let bv = -1e9;
      for (let k = start; k < Math.min(end, start + T0); k++) if (xl[k] > bv) { bv = xl[k]; pos = k; }
      marks.push(pos);
      while (pos < end) {
        const T = periodAt(pos);
        const nx = pos + T;
        let best = Math.round(nx);
        bv = -1e9;
        const a = Math.max(0, Math.round(nx - 0.22 * T)), b = Math.min(N - 1, Math.round(nx + 0.22 * T));
        for (let k = a; k <= b; k++) if (xl[k] > bv) { bv = xl[k]; best = k; }
        if (best <= pos) best = Math.round(nx);
        marks.push(best);
        pos = best;
      }
      i = j;
    }
    if (marks.length < 4) return { y: x, voiced: 0 };

    // 4) síntesis PSOLA
    const acc = new Float32Array(N), wsum = new Float32Array(N);
    const Tu = Math.round(0.01 * sr);
    let ts = 0, mi = 0;
    const M = marks.length;
    while (ts < N) {
      const fr = frameAt(ts);
      let hl, srcC, hop;
      let ok = false;
      if (voiced[fr]) {
        while (mi + 1 < M && Math.abs(marks[mi + 1] - ts) <= Math.abs(marks[mi] - ts)) mi++;
        const T = periodAt(marks[mi]);
        if (Math.abs(marks[mi] - ts) <= T * 1.2) {
          ok = true;
          hl = Math.max(8, Math.round(T));
          srcC = marks[mi];
          hop = T / Math.pow(2, corr[fr] / 12);
        }
      }
      if (!ok) { hl = Tu; srcC = Math.round(ts); hop = Tu; }
      const dc = Math.round(ts);
      for (let i = -hl; i <= hl; i++) {
        const si = srcC + i, di = dc + i;
        if (si < 0 || si >= N || di < 0 || di >= N) continue;
        const w = 0.5 + 0.5 * Math.cos((PI * i) / hl);
        acc[di] += w * x[si];
        wsum[di] += w;
      }
      ts += Math.max(8, hop);
    }
    const y = new Float32Array(N);
    for (let i = 0; i < N; i++) y[i] = wsum[i] > 1e-3 ? acc[i] / wsum[i] : x[i];
    return { y, voiced: voicedFrames / nF };
  };

  /* Gate adaptativo: calcula el umbral a partir del propio ruido de la toma */
  function gate(x, sr) {
    const n = x.length;
    const hop = Math.max(16, Math.round(sr * 0.005));
    const nf = Math.floor(n / hop);
    if (nf < 8) return { y: x, active: false };
    const db = new Float32Array(nf);
    for (let f = 0; f < nf; f++) {
      let e = 0;
      for (let i = f * hop; i < (f + 1) * hop; i++) e += x[i] * x[i];
      db[f] = 10 * Math.log10(e / hop + 1e-12);
    }
    const sorted = Float32Array.from(db).sort();
    const noise = sorted[Math.floor(nf * 0.1)], top = sorted[Math.floor(nf * 0.9)];
    if (top < -58 || top - noise < 10) return { y: x, active: false };
    const open = noise + (top - noise) * 0.35, close = open - 4;
    const holdF = Math.round(0.06 / (hop / sr));
    const state = new Uint8Array(nf);
    let on = 0, hold = 0;
    for (let f = 0; f < nf; f++) {
      const lvl = Math.max(db[f], f + 1 < nf ? db[f + 1] : db[f]);
      if (lvl > open) { on = 1; hold = holdF; }
      else if (on) { if (lvl < close) { if (--hold <= 0) on = 0; } else hold = holdF; }
      state[f] = on;
    }
    const aA = Math.exp(-1 / (0.002 * sr)), aR = Math.exp(-1 / (0.09 * sr));
    const floorG = 0.02;
    const y = new Float32Array(n);
    let g = state[nf - 1] ? 1 : floorG;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const f = Math.min(nf - 1, Math.floor(i / hop));
        const tgt = state[f] ? 1 : floorG;
        g = tgt > g ? tgt + (g - tgt) * aA : tgt + (g - tgt) * aR;
        if (pass === 1) y[i] = x[i] * g;
      }
    }
    return { y, active: true };
  }

  function levelPercentile(x, sr, p) {
    const hop = Math.max(16, Math.round(sr * 0.01));
    const nf = Math.floor(x.length / hop);
    if (nf < 2) return -90;
    const db = new Float32Array(nf);
    for (let f = 0; f < nf; f++) {
      let e = 0;
      for (let i = f * hop; i < (f + 1) * hop; i++) e += x[i] * x[i];
      db[f] = 10 * Math.log10(e / hop + 1e-12);
    }
    db.sort();
    return db[Math.min(nf - 1, Math.floor(nf * p))];
  }

  function compressor(x, sr, thrDb, ratio, kneeDb, attMs, relMs) {
    const n = x.length, y = new Float32Array(n);
    const aA = Math.exp(-1 / (attMs * 0.001 * sr)), aR = Math.exp(-1 / (relMs * 0.001 * sr));
    const slope = 1 / ratio - 1;
    let env = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const a = Math.abs(x[i]);
        env = a > env ? aA * env + (1 - aA) * a : aR * env + (1 - aR) * a;
        const over = 20 * Math.log10(env + 1e-9) - thrDb;
        let gr = 0;
        if (2 * over > kneeDb) gr = slope * over;
        else if (2 * over > -kneeDb) { const t = over + kneeDb / 2; gr = (slope * t * t) / (2 * kneeDb); }
        if (pass === 1) y[i] = x[i] * dbToLin(gr);
      }
    }
    return y;
  }

  D.renderVocal = function (o) {
    const sr = o.sampleRate, dry = o.dry, n = dry.length;
    const key = o.key || { root: 9, scale: 'minor' };
    // 1) limpieza de graves
    let x = runFilters(dry, [new Biquad().set('hp', 85, 0.7071, 0, sr), new Biquad().set('hp', 85, 0.7071, 0, sr)]);
    // 2) gate
    const gt = gate(x, sr);
    x = gt.y;
    // 3) afinación a la tonalidad del proyecto
    let tuned = 0;
    if (o.tune !== false) {
      const at = D.autotune(x, sr, D.scaleMask(key.root, key.scale));
      x = at.y; tuned = at.voiced;
    }
    // 4) compresión (el umbral sale del propio nivel de la voz)
    const speech = levelPercentile(x, sr, 0.85);
    x = compressor(x, sr, speech, 4, 6, 4, 90);
    // 5) EQ de voz: menos barro, más presencia y un poco de aire
    x = runFilters(x, [
      new Biquad().set('peak', 280, 1.0, -2.0, sr),
      new Biquad().set('peak', 3200, 0.9, 2.5, sr),
      new Biquad().set('hshelf', 9000, 0.7071, 1.5, sr),
    ]);
    // 6) sala corta y oscura
    const fdn = new FDN(sr, 0.75, 0.55, Math.round(0.012 * sr), 0.55, 99, n);
    const l = new Float32Array(n), r = new Float32Array(n);
    const warm = Math.min(n, Math.round(1.2 * sr));
    const wet = 0.16;
    for (let c = 0; c < warm + n; c++) {
      const idx = mod(c - warm, n);
      fdn.process(x[idx]);
      if (c >= warm) { const k = c - warm; l[k] = x[k] + fdn.outL * wet; r[k] = x[k] + fdn.outR * wet; }
    }
    // 7) nivel: RMS de las zonas activas a -19 dBFS
    const act = levelPercentile(l, sr, 0.75);
    const gain = Math.min(dbToLin(30), dbToLin(-19 - act));
    for (let i = 0; i < n; i++) { l[i] = Math.tanh(l[i] * gain); r[i] = Math.tanh(r[i] * gain); }
    return {
      l, r, passes: 1, renderBars: o.loopBars, cycleMult: 1,
      info: { kind: 'vocal', gate: gt.active, tuned, key },
    };
  };

  /* ------------------------------------------------------------------------
   *  Picos para dibujar la onda (min/max por columna)
   * ---------------------------------------------------------------------- */
  D.peaks = function (l, r, cols) {
    const n = l.length, out = new Float32Array(cols * 2);
    for (let c = 0; c < cols; c++) {
      const a = Math.floor((c * n) / cols);
      const b = Math.max(a + 1, Math.floor(((c + 1) * n) / cols));
      let mn = 1e9, mx = -1e9;
      for (let i = a; i < b; i++) {
        const v = r ? (l[i] + r[i]) * 0.5 : l[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      out[c * 2] = mn; out[c * 2 + 1] = mx;
    }
    return out;
  };

  D._internals = { Biquad, SVF, FDN, PingPong, runFilters, gate, compressor, levelPercentile, REV_GAIN, buildGlitch, buildCloud, runChain, conditionAmbient };
  return D;
}

if (typeof module !== 'undefined' && module.exports) module.exports = NRB_DSP_FACTORY;
