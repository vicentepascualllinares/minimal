/* ============================================================================
 *  NIGHT RIDE THROUGHT BUDAPEST · núcleo
 *  Nombres, estado del proyecto, mapeos de controles, grooves y persistencia.
 * ========================================================================== */
(function () {
  'use strict';
  const NRB = (window.NRB = window.NRB || {});

  NRB.APP_NAME = 'Night Ride Throught Budapest';

  /* mini emisor de eventos */
  NRB.emitter = function (obj) {
    const h = {};
    obj.on = (n, f) => { (h[n] = h[n] || []).push(f); return obj; };
    obj.emit = (n, ...a) => { (h[n] || []).forEach((f) => f(...a)); };
    return obj;
  };

  /* ---- pistas (orden = orden visual y del mezclador) ---- */
  NRB.TRACKS = [
    { id: 'kick', name: 'KICK', short: 'KICK', type: 'drum' },
    { id: 'clap', name: 'CLAP', short: 'CLAP', type: 'drum' },
    { id: 'snare', name: 'SNARE', short: 'SNARE', type: 'drum' },
    { id: 'hat', name: 'HAT', short: 'HAT', type: 'drum' },
    { id: 'ohat', name: 'OPEN HAT', short: 'O.HAT', type: 'drum' },
    { id: 'bass', name: 'BASS', short: 'BASS', type: 'bass' },
    { id: 'rec1', name: 'REC 1', short: 'REC 1', type: 'rec' },
    { id: 'rec2', name: 'REC 2', short: 'REC 2', type: 'rec' },
    { id: 'rec3', name: 'REC 3', short: 'REC 3', type: 'rec' },
    { id: 'rec4', name: 'REC 4', short: 'REC 4', type: 'rec' },
  ];
  NRB.TRACK_BY_ID = {};
  NRB.TRACKS.forEach((t) => (NRB.TRACK_BY_ID[t.id] = t));
  NRB.STEPS_PER_BAR = 16;
  NRB.MAX_STEPS = 64;

  NRB.NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  NRB.noteName = (midi) => NRB.NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  NRB.SCALE_LIST = [
    ['minor', 'MINOR'], ['major', 'MAJOR'], ['dorian', 'DORIAN'],
    ['phrygian', 'PHRYGIAN'], ['harmonic', 'HARM. MINOR'], ['chromatic', 'CHROMATIC'],
  ];

  /* ---- perfiles de buffer de audio ----
     Esta app programa el audio con antelación, así que no necesita latencia mínima.
     Un buffer más grande absorbe cualquier microparón (CPU ocupada, drivers de altavoces
     o auriculares de cable...). El Bluetooth ya añade su propio buffer, por eso se oía bien. */
  NRB.AUDIO_PROFILES = {
    low: { label: 'MÍN', hint: 'interactive', desc: 'latencia mínima (10 ms)' },
    balanced: { label: 'ESTABLE', hint: 0.08, desc: 'recomendado (~85 ms)' },
    safe: { label: 'MÁX', hint: 0.2, desc: 'máxima estabilidad (~210 ms)' },
  };

  /* ---- cuantización del piano roll (en pasos de 1/16) ---- */
  NRB.QUANT = [
    { id: '1/4', label: '1/4', steps: 4 },
    { id: '1/8', label: '1/8', steps: 2 },
    { id: '1/16', label: '1/16', steps: 1 },
    { id: '1/32', label: '1/32', steps: 0.5 },
    { id: '1/8T', label: '1/8T', steps: 4 / 3 },
    { id: '1/16T', label: '1/16T', steps: 2 / 3 },
    { id: 'free', label: 'LIBRE', steps: 0 },
  ];
  NRB.quantSteps = (id) => (NRB.QUANT.find((q) => q.id === id) || NRB.QUANT[2]).steps;

  /* ---- mapeos de los controles del mezclador ---- */
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  NRB.clamp = clamp;
  NRB.map = {
    faderToDb(p) {
      if (p <= 0.002) return -Infinity;
      return p < 0.8 ? -60 + 60 * Math.pow(p / 0.8, 0.45) : ((p - 0.8) / 0.2) * 6;
    },
    faderToGain(p) {
      const db = NRB.map.faderToDb(p);
      return db === -Infinity ? 0 : Math.pow(10, db / 20);
    },
    hp: (p) => 20 * Math.pow(100, p),          // 20 Hz .. 2 kHz
    lp: (p) => 400 * Math.pow(50, p),          // 400 Hz .. 20 kHz
    fmtHz(f) {
      if (f >= 10000) return Math.round(f / 1000) + ' kHz';
      if (f >= 1000) return (f / 1000).toFixed(1) + ' kHz';
      return Math.round(f) + ' Hz';
    },
    fmtDb(db) { return db === -Infinity ? '-∞ dB' : (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB'; },
    fmtPan(p) { return Math.abs(p) < 0.02 ? 'C' : (p < 0 ? 'L' : 'R') + Math.round(Math.abs(p) * 100); },
  };

  /* ---- groove: micro-timing (en pasos) y dinámica por cada uno de los 16 pasos ---- */
  const Z = () => new Array(16).fill(0);
  const O = () => new Array(16).fill(1);
  const mk = (fn) => Array.from({ length: 16 }, (_, i) => fn(i));
  NRB.GROOVES = {
    off: { name: 'OFF', t: Z(), v: O() },
    laid: { name: 'LAID BACK', t: mk((i) => (i % 4 === 0 ? 0.03 : 0.08)), v: mk((i) => [1, 0.74, 0.9, 0.74][i % 4]) },
    push: { name: 'PUSH', t: mk((i) => (i % 4 === 0 ? 0 : -0.07)), v: mk((i) => [0.92, 0.7, 1, 0.74][i % 4]) },
    roll: { name: 'ROLLING', t: mk((i) => (i % 2 ? 0.03 : 0)), v: mk((i) => [1, 0.58, 0.84, 0.52][i % 4]) },
    drunk: {
      name: 'DRUNK',
      t: [0, 0.18, -0.05, 0.22, 0.04, -0.08, 0.15, 0.25, 0, 0.12, -0.07, 0.2, 0.03, -0.1, 0.17, 0.28],
      v: [1, 0.66, 0.9, 0.8, 0.96, 0.6, 0.86, 0.7, 1, 0.64, 0.92, 0.78, 0.94, 0.58, 0.88, 0.72],
    },
    ghost: { name: 'GHOST', t: mk((i) => (i % 2 ? 0.05 : 0)), v: mk((i) => (i % 4 === 0 ? 1 : i % 2 === 0 ? 0.8 : 0.42)) },
    mpc: { name: 'MPC', t: mk((i) => (i % 2 ? 0.11 : 0)), v: mk((i) => (i % 4 === 0 ? 1 : i % 2 === 0 ? 0.88 : 0.78)) },
  };
  NRB.GROOVE_ORDER = ['off', 'laid', 'push', 'roll', 'drunk', 'ghost', 'mpc'];

  /* swing: retrasa los 16avos "de contratiempo".
     swing 0..1 -> 50%..75% (0.5 pasos de retraso como máximo). Funciona también con posiciones libres. */
  NRB.swingWarp = function (pos, swing) {
    if (!swing) return pos;
    const off = swing * 0.5;
    const m = Math.floor(pos / 2) * 2, u = pos - m;
    return m + (u < 1 ? u * (1 + off) : 1 + off + (u - 1) * (1 - off));
  };

  /* ---- estado por defecto (con un groove de arranque en La menor) ---- */
  function steps(map) {
    const a = new Array(NRB.MAX_STEPS).fill(0);
    Object.keys(map).forEach((k) => (a[+k] = map[k]));
    return a;
  }
  function drumTrack(over) {
    return Object.assign({
      vol: 0.72, pan: 0, hp: 0, lp: 1, mute: false, solo: false,
      steps: steps({}), bars: 1, swing: 0, humanize: 0, groove: 'off', grooveAmt: 1,
    }, over);
  }
  const A_MINOR_BASS = [
    [2, 1.5, 33], [6, 1, 33], [7, 1, 36], [10, 1.5, 33], [14, 1.5, 31],
    [18, 1.5, 33], [22, 1, 33], [23, 1, 40], [26, 1.5, 38], [30, 1.5, 31],
  ].map((n, i) => ({ id: i + 1, start: n[0], len: n[1], pitch: n[2], vel: 0.85 }));

  NRB.defaultState = function () {
    const tracks = {
      kick: drumTrack({ vol: 0.78, steps: steps({ 0: 1, 4: 1, 8: 1, 12: 1 }) }),
      clap: drumTrack({ vol: 0.7, pan: 0.06, steps: steps({ 4: 0.9, 12: 0.9 }) }),
      snare: drumTrack({ vol: 0.62, steps: steps({ 10: 0.5, 15: 0.34 }) }),
      hat: drumTrack({
        vol: 0.66, pan: -0.12, humanize: 0.2, groove: 'roll', grooveAmt: 0.8,
        steps: steps({ 1: 0.45, 3: 0.8, 5: 0.45, 7: 0.8, 9: 0.45, 11: 0.8, 13: 0.45, 15: 0.8 }),
      }),
      ohat: drumTrack({ vol: 0.66, pan: 0.14, steps: steps({ 2: 0.8, 6: 0.8, 10: 0.8, 14: 0.8 }) }),
      bass: {
        vol: 0.68, pan: 0, hp: 0, lp: 1, mute: false, solo: false,
        notes: A_MINOR_BASS, bars: 2, quant: '1/16', swing: 0, humanize: 0.1, groove: 'off', grooveAmt: 1,
      },
    };
    NRB.REC_IDS.forEach((id, i) => {
      tracks[id] = { vol: 0.6, pan: 0, hp: 0, lp: 1, mute: false, solo: false, mode: 'ambient', fx: null };
    });
    return {
      v: 1,
      bpm: 126,
      key: { root: 9, scale: 'minor' },
      recBars: 0,
      master: { vol: 0.66 },
      micId: '',
      audio: { profile: 'balanced', aec: false },
      tracks,
    };
  };
  NRB.REC_IDS = ['rec1', 'rec2', 'rec3', 'rec4'];
  NRB.INSTRUMENT_IDS = ['kick', 'clap', 'snare', 'hat', 'ohat', 'bass'];

  /* ---- persistencia local (solo patrones y mezcla; las grabaciones NUNCA se guardan) ---- */
  function deepMerge(base, saved) {
    if (Array.isArray(base)) return Array.isArray(saved) ? saved : base;
    if (base && typeof base === 'object') {
      const out = {};
      Object.keys(base).forEach((k) => {
        out[k] = saved && typeof saved === 'object' && k in saved ? deepMerge(base[k], saved[k]) : base[k];
      });
      return out;
    }
    return typeof saved === typeof base || base === null ? saved : base;
  }

  const KEY = 'nrb.night-ride.v1';
  let timer = null;
  NRB.store = {
    load() {
      const def = NRB.defaultState();
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return def;
        return deepMerge(def, JSON.parse(raw));
      } catch (e) { return def; }
    },
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(NRB.state)); } catch (e) { /* sin almacenamiento: no pasa nada */ }
    },
    touch() {
      clearTimeout(timer);
      timer = setTimeout(NRB.store.save, 350);
    },
    reset() {
      try { localStorage.removeItem(KEY); } catch (e) { /* idem */ }
    },
  };
  NRB.state = NRB.store.load();
})();
