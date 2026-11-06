/* Autotest del DSP (sin navegador):  node tests/dsp-selftest.js
   Genera una "toma de micro" sintética y comprueba: sin NaN, niveles, continuidad del loop,
   determinismo, estabilidad al cambiar el ciclo de efectos, afinación y gate de la voz. */
const D = require('../js/dsp.js')();
const sr = 48000, bpm = 126, bars = 2;
const beat = (60 / bpm) * sr;
const loopLen = Math.round(beat * 4 * bars);
let failed = 0;
const check = (name, ok, extra) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

function synthMic() {
  const r = D.mulberry32(42), x = new Float32Array(loopLen);
  let lp = 0;
  for (let i = 0; i < loopLen; i++) { lp += ((r() * 2 - 1) * 0.02 - lp) * 0.2; x[i] = lp; }
  [0.3, 1.1, 2.0, 3.0].forEach((t) => { const s0 = Math.round(t * sr); for (let i = 0; i < 0.12 * sr && s0 + i < loopLen; i++) x[s0 + i] += (r() * 2 - 1) * 0.5 * Math.exp(-i / (0.025 * sr)); });
  const s0 = Math.round(1.6 * sr); for (let i = 0; i < 0.4 * sr; i++) x[s0 + i] += 0.3 * Math.sin((2 * Math.PI * 523 * i) / sr) * Math.exp(-i / (0.2 * sr));
  return x;
}
function vowel(f0, seconds) {
  const n = Math.round(seconds * sr), pulses = new Float32Array(n), r = D.mulberry32(7);
  let ph = 0;
  for (let i = 0; i < n; i++) { ph += (f0 * (1 + 0.01 * Math.sin((2 * Math.PI * 5.5 * i) / sr))) / sr; if (ph >= 1) { ph -= 1; pulses[i] = 1; } }
  const reson = (inp, fc, bw) => { const o = new Float32Array(inp.length), rr = Math.exp((-Math.PI * bw) / sr), th = (2 * Math.PI * fc) / sr, a1 = -2 * rr * Math.cos(th), a2 = rr * rr, g = 1 - rr; let y1 = 0, y2 = 0; for (let i = 0; i < inp.length; i++) { const y = g * inp[i] - a1 * y1 - a2 * y2; o[i] = y; y2 = y1; y1 = y; } return o; };
  const a = reson(pulses, 700, 110), b = reson(pulses, 1200, 130), c = reson(pulses, 2500, 200), x = new Float32Array(n);
  let pk = 0;
  for (let i = 0; i < n; i++) { const t = i / n; x[i] = (a[i] * 3 + b[i] * 2 + c[i] + (r() * 2 - 1) * 0.002) * Math.min(1, t * 20, (1 - t) * 20); pk = Math.max(pk, Math.abs(x[i])); }
  for (let i = 0; i < n; i++) x[i] *= 0.4 / pk;
  return x;
}
const stats = (l, r) => { let pk = 0, nan = 0, e = 0; for (let i = 0; i < l.length; i++) { if (!isFinite(l[i]) || !isFinite(r[i])) nan++; pk = Math.max(pk, Math.abs(l[i]), Math.abs(r[i])); e += l[i] * l[i] + r[i] * r[i]; } return { pk, nan, rmsDb: 10 * Math.log10(e / (2 * l.length)) }; };
const seam = (x) => { const n = x.length; let m = 0; for (let i = 1; i < 300; i++) { m += Math.abs(x[i] - x[i - 1]) + Math.abs(x[n - i] - x[n - i - 1]); } m /= 598; return Math.abs(x[0] - x[n - 1]) / m; };

console.log('AMBIENT');
const raw = Float32Array.from([...new Float32Array(2000), ...synthMic(), ...new Float32Array(20000)]);
const dry = D.prepareTake(raw, 2000, loopLen, Math.round(0.015 * sr));
for (const seed of [1, 2, 3, 4]) {
  for (const k of [0.5, 1, 2, 4]) {
    const t = Date.now(), res = D.renderAmbient({ dry, sampleRate: sr, bpm, loopBars: bars, seed, cycleMult: k }), s = stats(res.l, res.r);
    check('seed ' + seed + ' ciclo x' + k, s.nan === 0 && s.pk <= 1 && s.rmsDb > -23 && s.rmsDb < -17 && seam(res.l) < 8 && res.renderBars === bars * (k >= 1 ? k : 1),
      'pico ' + s.pk.toFixed(2) + ' rms ' + s.rmsDb.toFixed(1) + ' dB, costura ' + seam(res.l).toFixed(1) + ', ' + (Date.now() - t) + ' ms');
  }
}
{
  const a = D.renderAmbient({ dry, sampleRate: sr, bpm, loopBars: bars, seed: 3, cycleMult: 2 });
  const b = D.renderAmbient({ dry, sampleRate: sr, bpm, loopBars: bars, seed: 3, cycleMult: 2 });
  let d = 0; for (let i = 0; i < a.l.length; i++) d = Math.max(d, Math.abs(a.l[i] - b.l[i]));
  check('determinismo (misma semilla = mismo resultado)', d === 0);
  const c1 = D.renderAmbient({ dry, sampleRate: sr, bpm, loopBars: bars, seed: 3, cycleMult: 1 });
  let num = 0, d1 = 0, d2 = 0; for (let i = 0; i < c1.l.length; i++) { num += c1.l[i] * a.l[i]; d1 += c1.l[i] ** 2; d2 += a.l[i] ** 2; }
  const corr = num / Math.sqrt(d1 * d2);
  check('estabilidad: el 1er loop se parece al cambiar el ciclo x1 -> x2', corr > 0.85, 'corr ' + corr.toFixed(3));
}

console.log('VOZ');
const mask = D.scaleMask(9, 'minor');
const medF0 = (x) => { const t = D.yinTrack(x, sr), v = []; for (let i = 0; i < t.n; i++) if (t.f0[i] > 0 && t.conf[i] > 0.7 && t.center[i] > 0.3 * sr && t.center[i] < 1.7 * sr) v.push(t.f0[i]); v.sort((a, b) => a - b); return v[v.length >> 1]; };
for (const [f0, want] of [[215, 220], [227, 220], [240, 246.9], [260, 261.6], [290, 293.7]]) {
  const out = D.autotune(vowel(f0, 2), sr, mask), got = medF0(out.y);
  check('afinar ' + f0 + ' Hz a La menor -> ' + want + ' Hz', Math.abs(got - want) < 3.5, 'resultado ' + got.toFixed(1) + ' Hz');
}
{
  const v = vowel(240, 1.5), buf = new Float32Array(loopLen), r = D.mulberry32(9);
  for (let i = 0; i < loopLen; i++) buf[i] = (r() * 2 - 1) * 0.004;
  for (let i = 0; i < v.length; i++) buf[Math.round(0.8 * sr) + i] += v[i];
  const res = D.renderVocal({ dry: buf, sampleRate: sr, bpm, loopBars: bars, key: { root: 9, scale: 'minor' } }), s = stats(res.l, res.r);
  const noise = D.linToDb(D.rmsOf(res.l, 0, Math.round(0.5 * sr))), voice = D.linToDb(D.rmsOf(res.l, Math.round(1.0 * sr), Math.round(2.0 * sr)));
  check('voz: sin NaN y sin recortes', s.nan === 0 && s.pk <= 1);
  check('voz: el gate baja el ruido de fondo >30 dB respecto a la voz', voice - noise > 30, 'ruido ' + noise.toFixed(1) + ' dB, voz ' + voice.toFixed(1) + ' dB');
}

console.log(failed ? '\n' + failed + ' comprobaciones fallidas' : '\nTodo correcto');
process.exit(failed ? 1 : 0);
