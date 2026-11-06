/* ============================================================================
 *  MIXER OF ALEXANDRIA: MINIMAL · motor de audio
 *
 *  Grafo:
 *    voces / loops -> bus -> [HP 24 dB] -> [LP 24 dB] -> volumen -> pan -> mute -> master
 *    master -> filtro subsónico (24 Hz) -> limitador -> salida
 *
 *  El MICRÓFONO NO SE CONECTA A LA SALIDA:
 *    micro -> analizador (solo para el medidor)
 *    micro -> grabador (AudioWorklet que envía bloques a un anillo en memoria) -> ganancia 0 -> destino
 *    (la ganancia 0 solo existe para que el navegador procese el nodo; además el
 *     grabador nunca escribe en su salida).
 *
 *  Estabilidad (importante con altavoces y auriculares de cable):
 *    · buffer de audio configurable (perfil ESTABLE por defecto): la app programa con antelación,
 *      no necesita latencia mínima, y un buffer mayor absorbe cualquier microparón;
 *    · el hilo de audio no hace nunca trabajo pesado: el grabador envía bloques pequeños y la
 *      copia de la toma se hace en el hilo principal;
 *    · frecuencia de muestreo limitada a 48 kHz aunque el dispositivo trabaje a 96/192 kHz.
 * ========================================================================== */
(function () {
  'use strict';
  const NRB = (window.NRB = window.NRB || {});

  const TICK_MS = 25;
  const qDb = (q) => 20 * Math.log10(q);       // Web Audio expresa la Q de LP/HP en dB

  /* ---- código que corre dentro del AudioWorklet (se serializa con toString) ----
     Solo copia 128 muestras por bloque y envía un mensaje cada 4096 muestras (~85 ms). */
  function recorderModule() {
    class NrbRecorder extends AudioWorkletProcessor {
      constructor() {
        super();
        this.chunk = 4096;
        this.buf = new Float32Array(this.chunk);
        this.n = 0;
        this.f0 = 0;
      }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        const len = ch ? ch.length : 128;
        for (let i = 0; i < len; i++) {
          if (this.n === 0) this.f0 = currentFrame + i;
          this.buf[this.n++] = ch ? ch[i] : 0;
          if (this.n === this.chunk) {
            this.port.postMessage({ f: this.f0, d: this.buf }, [this.buf.buffer]);
            this.buf = new Float32Array(this.chunk);
            this.n = 0;
          }
        }
        return true;                                    // no escribe nada en la salida
      }
    }
    registerProcessor('nrb-recorder', NrbRecorder);
  }

  function blobUrl(code) { return URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); }

  /* ---- grabador: AudioWorklet, o ScriptProcessor si el navegador no deja ----
     Los bloques llegan al hilo principal y se guardan en un anillo de 100 s. */
  class Recorder {
    constructor(engine) { this.e = engine; this.mode = 'none'; this.first = -1; this.last = 0; }

    async init() {
      const ctx = this.e.ctx;
      this.size = Math.floor(ctx.sampleRate * 100);
      this.ring = new Float32Array(this.size);
      try {
        const url = blobUrl('(' + recorderModule.toString() + ')()');
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        this.node = new AudioWorkletNode(ctx, 'nrb-recorder', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          channelCount: 1, channelCountMode: 'explicit',
        });
        this.node.port.onmessage = (ev) => this.push(ev.data.f, ev.data.d);
        this.mode = 'worklet';
      } catch (err) {
        console.warn('[NRB] AudioWorklet no disponible, uso ScriptProcessor:', err);
        const sp = ctx.createScriptProcessor(2048, 1, 1);
        sp.onaudioprocess = (ev) => this.push(Math.round(ev.playbackTime * ctx.sampleRate), ev.inputBuffer.getChannelData(0));
        this.node = sp;
        this.mode = 'script';
      }
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;                           // silencio absoluto
      this.node.connect(this.sink);
      this.sink.connect(ctx.destination);
    }

    connect(source) { source.connect(this.node); }

    push(f, d) {
      const ring = this.ring, size = this.size;
      let k = f % size;
      for (let i = 0; i < d.length; i++) { ring[k] = d[i]; if (++k === size) k = 0; }
      if (this.first < 0) this.first = f;
      if (f + d.length > this.last) this.last = f + d.length;
    }

    /* devuelve las muestras [from, to) del anillo; espera un poco si los últimos bloques aún vienen de camino */
    async grab(from, to) {
      const t0 = performance.now();
      while (to > this.last) {
        if (performance.now() - t0 > 2000) throw new Error('grab fuera de rango');
        await new Promise((r) => setTimeout(r, 40));
      }
      const lo = Math.max(this.first, this.last - this.size);
      if (from < lo || to <= from) throw new Error('grab fuera de rango');
      const out = new Float32Array(to - from);
      let k = from % this.size;
      for (let i = 0; i < out.length; i++) { out[i] = this.ring[k]; if (++k === this.size) k = 0; }
      return out;
    }
  }

  /* ======================================================================= */
  class Engine {
    constructor(state) {
      this.state = state;
      this.channels = {};
      this.mic = { ok: false, source: null, analyser: null, stream: null, label: '', inLatency: 0.02, devices: [], error: '', synthetic: false };
      this.micHold = false;          // true si el usuario ha pedido mantener el micro abierto (botón MIC)
      this.micPromise = null;
      this.jobSeq = 0;
      this.jobs = new Map();
      NRB.emitter(this);
    }

    async init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      const prof = NRB.AUDIO_PROFILES[this.state.audio.profile] || NRB.AUDIO_PROFILES.balanced;
      let ctx = new AC({ latencyHint: prof.hint });
      this.deviceRate = ctx.sampleRate;
      /* Si el dispositivo trabaja a 96/192 kHz (o a una frecuencia baja de manos libres) el coste de
         todo se multiplica o la calidad se hunde: se fuerza 48 kHz y el navegador remuestrea. */
      if (ctx.sampleRate > 48000 || ctx.sampleRate < 44100) {
        try {
          const forced = new AC({ latencyHint: prof.hint, sampleRate: 48000 });
          ctx.close();
          ctx = forced;
        } catch (err) { console.warn('[NRB] no se pudo fijar 48 kHz', err); }
      }
      this.ctx = ctx;
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      ctx.addEventListener('statechange', () => this.emit('ctxstate', ctx.state));

      this.masterGain = ctx.createGain();
      this.subsonic = ctx.createBiquadFilter();           // quita lo que los altavoces no pueden reproducir (<24 Hz)
      this.subsonic.type = 'highpass';
      this.subsonic.frequency.value = 24;
      this.subsonic.Q.value = qDb(0.7071);
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -2;
      this.limiter.knee.value = 2;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.12;
      this.masterMeter = ctx.createAnalyser();
      this.masterMeter.fftSize = 512;
      this.masterMeter.smoothingTimeConstant = 0;
      this.masterBuf = new Float32Array(512);
      this.masterGain.connect(this.subsonic);
      this.subsonic.connect(this.limiter);
      this.limiter.connect(ctx.destination);
      this.limiter.connect(this.masterMeter);

      NRB.TRACKS.forEach((t) => (this.channels[t.id] = this.makeChannel(t.id)));
      this.env = NRB.Synth.makeEnv(ctx);
      this.makeWorkers();
      this.recorder = new Recorder(this);
      await this.recorder.init();
      this.applyAll();
      this.watchDevices();
    }

    /* lecturas para el panel AUDIO */
    describe() {
      const c = this.ctx;
      return {
        state: c.state, sampleRate: c.sampleRate, deviceRate: this.deviceRate,
        baseLatency: c.baseLatency || 0, outputLatency: c.outputLatency || 0,
        profile: this.state.audio.profile, recorder: this.recorder.mode,
      };
    }

    /* Si cambia la salida (enchufas auriculares de cable, conectas/desconectas el Bluetooth...)
       se reengancha a la salida predeterminada y se reanuda el audio. */
    async outputIds() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        return all.filter((d) => d.kind === 'audiooutput').map((d) => d.deviceId).sort().join(',');
      } catch (e) { return ''; }
    }
    async watchDevices() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.addEventListener) return;
      this.lastOuts = await this.outputIds();
      navigator.mediaDevices.addEventListener('devicechange', async () => {
        await this.refreshDevices();
        this.emit('mic');
        const outs = await this.outputIds();
        if (outs !== this.lastOuts) {
          this.lastOuts = outs;
          try {
            if (this.ctx.state !== 'running') await this.ctx.resume();
            if (this.ctx.setSinkId) await this.ctx.setSinkId('');
          } catch (e) { /* si no se puede, el navegador sigue con la salida que tenía */ }
          this.emit('output');
        }
      });
    }

    /* ---------- canales ---------- */
    makeChannel(id) {
      const ctx = this.ctx;
      const input = ctx.createGain();
      const mk = (type, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.Q.value = qDb(q); return b; };
      const hp1 = mk('highpass', 0.5412), hp2 = mk('highpass', 1.3066);   // Butterworth de 4º orden
      const lp1 = mk('lowpass', 0.5412), lp2 = mk('lowpass', 1.3066);
      hp1.frequency.value = hp2.frequency.value = 20;
      lp1.frequency.value = lp2.frequency.value = 20000;
      const vol = ctx.createGain(), pan = ctx.createStereoPanner(), mute = ctx.createGain();
      const meter = ctx.createAnalyser();
      meter.fftSize = 512;
      meter.smoothingTimeConstant = 0;
      input.connect(hp1); hp1.connect(hp2); hp2.connect(lp1); lp1.connect(lp2);
      lp2.connect(vol); vol.connect(pan); pan.connect(mute);
      mute.connect(this.masterGain);
      mute.connect(meter);
      const ch = { id, input, hp: [hp1, hp2], lp: [lp1, lp2], vol, pan, mute, meter, buf: new Float32Array(512), bus: null };
      this.newBus(ch);
      return ch;
    }
    newBus(ch) {
      const bus = this.ctx.createGain();
      bus.connect(ch.input);
      ch.bus = bus;
      return bus;
    }
    /* corta todo lo que esté sonando o programado en un canal (se sustituye el bus) */
    cutChannel(id) {
      const ch = this.channels[id], old = ch.bus, now = this.ctx.currentTime;
      this.newBus(ch);
      old.gain.cancelScheduledValues(now);
      old.gain.setTargetAtTime(0, now, 0.005);
      setTimeout(() => { try { old.disconnect(); } catch (e) { /* ya está */ } }, 800);
    }
    cutInstruments() { NRB.INSTRUMENT_IDS.forEach((id) => this.cutChannel(id)); this.env.openHat = null; }
    cutLoops() { NRB.REC_IDS.forEach((id) => this.cutChannel(id)); }

    applyChannel(id) {
      const st = this.state.tracks[id], c = this.channels[id], now = this.ctx.currentTime;
      const anySolo = Object.keys(this.state.tracks).some((k) => this.state.tracks[k].solo);
      const audible = !st.mute && (!anySolo || st.solo);
      c.vol.gain.setTargetAtTime(NRB.map.faderToGain(st.vol), now, 0.015);
      c.pan.pan.setTargetAtTime(st.pan, now, 0.015);
      const hp = NRB.map.hp(st.hp), lp = NRB.map.lp(st.lp);
      c.hp.forEach((f) => f.frequency.setTargetAtTime(hp, now, 0.02));
      c.lp.forEach((f) => f.frequency.setTargetAtTime(lp, now, 0.02));
      c.mute.gain.setTargetAtTime(audible ? 1 : 0, now, 0.01);
    }
    applyMaster() {
      this.masterGain.gain.setTargetAtTime(NRB.map.faderToGain(this.state.master.vol), this.ctx.currentTime, 0.02);
    }
    applyAll() {
      NRB.TRACKS.forEach((t) => this.applyChannel(t.id));
      this.applyMaster();
    }

    /* ---------- medidores ---------- */
    peak(analyser, buf) {
      analyser.getFloatTimeDomainData(buf);
      let pk = 0;
      for (let i = 0; i < buf.length; i++) { const v = buf[i] < 0 ? -buf[i] : buf[i]; if (v > pk) pk = v; }
      return pk;
    }
    level(id) { const c = this.channels[id]; return this.peak(c.meter, c.buf); }
    masterLevel() { return this.peak(this.masterMeter, this.masterBuf); }
    micLevel() {
      const m = this.mic;
      if (!m.ok || !m.analyser) return 0;
      if (!m.buf) m.buf = new Float32Array(m.analyser.fftSize);
      return this.peak(m.analyser, m.buf);
    }
    micScope(out) {
      const m = this.mic;
      if (!m.ok || !m.analyser) return false;
      m.analyser.getFloatTimeDomainData(out);
      return true;
    }

    get outLatency() { return Math.max(this.ctx.baseLatency || 0, this.ctx.outputLatency || 0); }
    /* latencia total entrada+salida (en muestras) que hay que compensar en una toma */
    get roundTripSamples() {
      const sec = Math.min(0.6, this.outLatency + (this.mic.inLatency || 0.02));
      return Math.round(sec * this.ctx.sampleRate);
    }

    /* ---------- micrófono ----------
       Se abre SOLO cuando hace falta (al grabar) y se cierra al terminar. Motivo (medido en un Acer con
       Realtek): el servicio de audio del fabricante tiene una lista fija de "apps de llamadas" (chrome.exe,
       msedge.exe, firefox.exe, opera.exe…). Si una reproduce sonido con el micro abierto, activa una reducción
       de ruido en la SALIDA (Acer Purified Voice: "Speaker AI noise reduction (Voice Call)") que apaga y
       "cancela" la música de TODO el equipo. Ninguna opción de getUserMedia lo evita: se desactiva en ese
       software. Aquí solo se limita el tiempo con el micro abierto. */
    openMic() {
      if (this.mic.ok) return Promise.resolve(true);
      if (!this.micPromise) {
        this.micPromise = (async () => {
          try {
            return location.hash.indexOf('fakemic') >= 0 ? await this.initSyntheticMic() : await this.initMic(this.state.micId);
          } finally { this.micPromise = null; }
        })();
      }
      return this.micPromise;
    }
    closeMic() { this.stopMic(); this.emit('mic'); }

    stopMic() {
      const m = this.mic;
      try { m.source && m.source.disconnect(); } catch (e) { /* nada */ }
      if (m.stream) m.stream.getTracks().forEach((t) => t.stop());
      m.source = null; m.stream = null; m.ok = false; m.analyser = null; m.buf = null;
    }

    async initMic(deviceId) {
      this.stopMic();
      const m = this.mic;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        m.error = 'unsupported';
        this.emit('mic');
        return false;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            // eco desactivado por defecto: es captura "limpia". Con altavoces se puede activar en AUDIO.
            echoCancellation: !!this.state.audio.aec, noiseSuppression: false, autoGainControl: false,
            channelCount: { ideal: 1 },
          },
        });
      } catch (err) {
        if (deviceId) return this.initMic('');           // el dispositivo ya no está: uso el predeterminado
        m.error = err && err.name ? err.name : 'error';
        this.emit('mic');
        return false;
      }
      const track = stream.getAudioTracks()[0];
      const set = track.getSettings ? track.getSettings() : {};
      m.settings = set;                                   // cómo lo ha abierto realmente el navegador (diagnóstico)
      m.caps = track.getCapabilities ? track.getCapabilities() : null;
      console.info('[NRB] micrófono abierto:', track.label, set, m.caps);
      m.inLatency = set.latency || 0.02;
      m.label = track.label || 'Micrófono';
      m.stream = stream;
      m.source = this.ctx.createMediaStreamSource(stream);
      this.attachMicSource();
      track.addEventListener('ended', () => { m.ok = false; m.error = 'ended'; this.emit('mic'); });
      m.synthetic = false;
      m.error = '';
      await this.refreshDevices();
      this.emit('mic');
      return true;
    }

    attachMicSource() {
      const m = this.mic;
      m.analyser = this.ctx.createAnalyser();
      m.analyser.fftSize = 1024;
      m.analyser.smoothingTimeConstant = 0;
      m.source.connect(m.analyser);                       // solo medidor
      this.recorder.connect(m.source);                    // solo grabador (silenciado)
      m.ok = true;
    }

    /* micro sintético: SOLO para pruebas (#fakemic en la URL) */
    async initSyntheticMic() {
      this.stopMic();
      const ctx = this.ctx, sr = ctx.sampleRate, m = this.mic;
      const len = Math.round(sr * 8), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      let s = 987, lp = 0;
      const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return s / 2147483648; };
      for (let i = 0; i < len; i++) { lp += (rnd() * 0.02 - lp) * 0.2; d[i] = lp; }
      [0.4, 1.3, 2.2, 3.9, 5.1, 6.4].forEach((t) => {
        const s0 = Math.round(t * sr);
        for (let i = 0; i < 0.12 * sr; i++) d[s0 + i] += rnd() * 0.5 * Math.exp(-i / (0.025 * sr));
      });
      [[1.8, 523], [4.4, 330], [6.9, 220]].forEach((p) => {
        const s0 = Math.round(p[0] * sr);
        for (let i = 0; i < 0.5 * sr; i++) d[s0 + i] += 0.3 * Math.sin((2 * Math.PI * p[1] * i) / sr) * Math.exp(-i / (0.25 * sr));
      });
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start();
      m.source = src;
      m.settings = null;
      m.label = 'MIC SINTÉTICO (pruebas)';
      m.synthetic = true;
      m.error = '';
      this.attachMicSource();
      this.emit('mic');
      return true;
    }

    async refreshDevices() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        this.mic.devices = all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || 'Entrada ' + (i + 1) }));
      } catch (e) { this.mic.devices = []; }
    }

    /* ---------- workers ---------- */
    makeWorkers() {
      try {
        const fxSrc =
          'const D=(' + NRB_DSP_FACTORY.toString() + ')();\n' +
          'self.onmessage=function(e){var m=e.data;try{' +
          'var r=m.type==="vocal"?D.renderVocal(m):D.renderAmbient(m);' +
          'r.id=m.id;r.ok=true;self.postMessage(r,[r.l.buffer,r.r.buffer]);' +
          '}catch(err){self.postMessage({id:m.id,ok:false,error:String(err&&err.stack||err)});}};';
        this.fx = new Worker(blobUrl(fxSrc));
        this.fx.onmessage = (ev) => this.onJobDone(ev.data);
        this.fx.onerror = (ev) => console.error('[NRB] fx worker', ev.message);
      } catch (err) {
        console.warn('[NRB] sin Worker para el DSP; se renderiza en el hilo principal', err);
        this.fx = null;
      }
      try {
        const tSrc = 'let id=null;onmessage=function(e){if(e.data==="start"){if(id)clearInterval(id);id=setInterval(function(){postMessage(0)},' + TICK_MS + ');}else if(e.data==="stop"){clearInterval(id);id=null;}};';
        this.tick = new Worker(blobUrl(tSrc));
      } catch (err) { this.tick = null; }
    }

    /* temporizador del scheduler: en un Worker no lo frena el navegador en segundo plano */
    startTicker(cb) {
      this.stopTicker();
      if (this.tick) { this.tick.onmessage = cb; this.tick.postMessage('start'); }
      else this._iv = setInterval(cb, TICK_MS);
    }
    stopTicker() {
      if (this.tick) { this.tick.onmessage = null; this.tick.postMessage('stop'); }
      if (this._iv) { clearInterval(this._iv); this._iv = null; }
    }

    render(job) {
      const id = ++this.jobSeq;
      return new Promise((resolve, reject) => {
        this.jobs.set(id, { resolve, reject });
        const msg = Object.assign({}, job, { id });
        if (this.fx) {
          this.fx.postMessage(msg, [msg.dry.buffer]);
        } else {
          setTimeout(() => {
            try {
              this.localDsp = this.localDsp || NRB_DSP_FACTORY();
              const r = msg.type === 'vocal' ? this.localDsp.renderVocal(msg) : this.localDsp.renderAmbient(msg);
              r.id = id; r.ok = true;
              this.onJobDone(r);
            } catch (err) { this.onJobDone({ id, ok: false, error: String(err) }); }
          }, 30);
        }
      });
    }
    onJobDone(r) {
      const j = this.jobs.get(r.id);
      if (!j) return;
      this.jobs.delete(r.id);
      r.ok ? j.resolve(r) : j.reject(new Error(r.error || 'fallo de render'));
    }

    /* ---------- escucha previa ---------- */
    previewDrum(id, vel) {
      if (!this.ctx) return;
      this.ctx.resume();
      const ch = this.channels[id];
      NRB.Synth.drums[id](this.env, ch.bus, this.ctx.currentTime + 0.004, vel || 0.9, { pitch: 1, decay: 1 });
    }
    previewBass(midi) {
      if (!this.ctx) return;
      this.ctx.resume();
      NRB.Synth.bass(this.env, this.channels.bass.bus, this.ctx.currentTime + 0.004, 0.28, midi, 0.85, { pitch: 1, decay: 1 });
    }
  }

  NRB.Engine = Engine;
})();
