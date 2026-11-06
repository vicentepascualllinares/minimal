/* ============================================================================
 *  MIXER OF ALEXANDRIA: MINIMAL · aplicación
 *  Cabecera, arranque (la "puerta"), bucle de animación y atajos.
 * ========================================================================== */
(function () {
  'use strict';
  const NRB = (window.NRB = window.NRB || {});
  const { el, clamp } = NRB;
  const $ = (s, r) => (r || document).querySelector(s);

  const ICON_PLAY = '<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="M5.5 3.2 17 10 5.5 16.8Z" fill="currentColor"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><rect x="4.5" y="4.5" width="11" height="11" fill="currentColor"/></svg>';

  class App {
    constructor(engine, transport, looper) {
      this.engine = engine;
      this.transport = transport;
      this.looper = looper;
      this.state = NRB.state;
      this.lanes = [];
      this.recLanes = {};
      this.lastBar = -1;
      this.lastBeat = -1;
    }

    build() {
      this.buildTop();
      this.buildLanes();
      this.mixer = new NRB.Mixer(this, $('#mixer'));
      this.bindKeys();
      this.bindEvents();
      this.setBeatVar();
      this.refreshMic();
      this.loop();
    }

    /* ---------------------------------------------------------------- cabecera */
    buildTop() {
      const s = this.state, top = $('#top');
      const group = (cls, label, ...kids) => el('div', { class: 'grp ' + cls }, [label ? el('span', { class: 'grp__l', text: label }) : null, ...kids]);

      // brand
      top.append(el('div', { class: 'brand', title: NRB.APP_NAME }, [
        el('i', { class: 'brand__dot' }),
        el('div', { class: 'brand__txt' }, [el('b', { text: 'MIXER OF ALEXANDRIA' }), el('span', { text: 'MINIMAL' })]),
      ]));

      // transporte
      this.playBtn = el('button', { class: 'play', type: 'button', title: 'Reproducir / parar (espacio)', 'aria-label': 'Reproducir', html: ICON_PLAY, onclick: () => this.transport.toggle() });
      top.append(this.playBtn);

      // BPM
      this.bpmIn = el('input', { class: 'bpm__in', type: 'number', min: 60, max: 200, value: s.bpm, 'aria-label': 'BPM' });
      const setBpm = (v) => { this.transport.setBpm(+v); this.bpmIn.value = s.bpm; };
      this.bpmIn.addEventListener('change', () => setBpm(this.bpmIn.value));
      this.bpmIn.addEventListener('wheel', (e) => { e.preventDefault(); setBpm(s.bpm - Math.sign(e.deltaY)); }, { passive: false });
      top.append(el('div', { class: 'grp bpm', title: 'Tempo (rueda del ratón o flechas). Las grabaciones se adaptan "a cinta".' }, [
        el('button', { class: 'bpm__b', type: 'button', text: '−', 'aria-label': 'Bajar BPM', onclick: () => setBpm(s.bpm - 1) }),
        this.bpmIn,
        el('button', { class: 'bpm__b', type: 'button', text: '+', 'aria-label': 'Subir BPM', onclick: () => setBpm(s.bpm + 1) }),
        el('span', { class: 'grp__l', text: 'BPM' }),
      ]));

      // posición
      this.leds = [0, 1, 2, 3].map(() => el('i'));
      this.barTxt = el('span', { class: 'pos__bar', text: '000' });
      top.append(el('div', { class: 'grp pos', title: 'Compás y pulso' }, [el('div', { class: 'pos__leds' }, this.leds), this.barTxt]));

      top.append(el('div', { class: 'spacer' }));

      // tonalidad
      const rootSel = el('select', { class: 'sel', title: 'Tonalidad del proyecto: afina las voces y resalta la escala en el piano roll' }, NRB.NOTE_NAMES.map((n, i) => el('option', { value: i, text: n })));
      rootSel.value = s.key.root;
      const scaleSel = el('select', { class: 'sel', title: 'Escala' }, NRB.SCALE_LIST.map((p) => el('option', { value: p[0], text: p[1] })));
      scaleSel.value = s.key.scale;
      const keyChanged = () => {
        s.key.root = +rootSel.value;
        s.key.scale = scaleSel.value;
        NRB.store.touch();
        this.looper.onKeyChange();
        this.bassLane.roll.draw();
        NRB.REC_IDS.forEach((id) => this.recLanes[id].refresh());
      };
      rootSel.addEventListener('change', keyChanged);
      scaleSel.addEventListener('change', keyChanged);
      top.append(group('key', 'KEY', rootSel, scaleSel));

      // duración de grabación
      const lenSel = el('select', { class: 'sel', title: 'Duración de cada grabación. AUTO: tú decides pulsando REC otra vez (siempre en compases enteros)' },
        [[0, 'AUTO'], [1, '1 BAR'], [2, '2 BARS'], [4, '4 BARS'], [8, '8 BARS']].map((p) => el('option', { value: p[0], text: p[1] })));
      lenSel.value = s.recBars;
      lenSel.addEventListener('change', () => { s.recBars = +lenSel.value; NRB.store.touch(); });
      top.append(group('len', 'LOOP', lenSel));

      // micrófono
      this.micSel = el('select', { class: 'sel sel--mic', title: 'Entrada de micrófono. Solo se usa para grabar: NUNCA suena por los altavoces' });
      this.micSel.addEventListener('change', async () => {
        s.micId = this.micSel.value;
        NRB.store.touch();
        if (this.engine.mic.ok && !this.looper.micBusy()) await this.engine.initMic(s.micId);
      });
      // El micrófono se abre solo al grabar (abrirlo puede hacer que Windows degrade el sonido de todo el equipo).
      this.micBtn = el('button', { class: 'pill pill--mic', type: 'button', text: 'MIC OFF', onclick: () => this.toggleMic() });
      this.micI = el('i');
      this.micMeter = el('div', { class: 'micmeter', title: 'Nivel de entrada (solo medidor)' }, this.micI);
      this.audioBtn = el('button', { class: 'pill pill--mini', type: 'button', text: '⚙', title: 'Audio: buffer, eco del micro y lecturas', onclick: (e) => this.openAudioPanel(e.currentTarget) });
      top.append(el('div', { class: 'grp mic' }, [el('span', { class: 'grp__l', text: 'MIC' }), this.micSel, this.micBtn, this.micMeter, this.audioBtn]));

      // ayuda y nuevo
      top.append(el('button', { class: 'pill pill--mini', type: 'button', text: '?', title: 'Guía rápida', onclick: () => $('#help').classList.toggle('show') }));
      top.append(el('button', {
        class: 'pill pill--mini', type: 'button', text: 'NEW', title: 'Empezar de cero (vacía patrones y mezcla)',
        onclick: () => { if (confirm('¿Empezar un proyecto nuevo? Se borran los patrones y la mezcla (las grabaciones ya se pierden al cerrar).')) { NRB.store.reset(); location.reload(); } },
      }));
      $('#help').addEventListener('click', (e) => { if (e.target.id === 'help' || e.target.classList.contains('help__x')) $('#help').classList.remove('show'); });
    }

    /* -------------------------------------------------------------- panel AUDIO */
    openAudioPanel(anchor) {
      const s = this.state.audio, e = this.engine, d = e.describe();
      const kHz = (hz) => (hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1);
      const row = (label, ctrl, solo) => el('div', { class: 'row' }, [el('span', { text: label }), ctrl, solo ? null : el('b')]);
      const info = el('span', {
        class: 'row__v row__v--l',
        text: kHz(d.sampleRate) + ' kHz · ' + Math.round((d.baseLatency + d.outputLatency) * 1000) + ' ms' +
          (d.deviceRate !== d.sampleRate ? ' (dispositivo a ' + kHz(d.deviceRate) + ')' : ''),
      });
      const prof = NRB.seg({
        options: Object.keys(NRB.AUDIO_PROFILES).map((k) => [k, NRB.AUDIO_PROFILES[k].label, NRB.AUDIO_PROFILES[k].desc]),
        value: s.profile,
        onChange: (p) => this.changeProfile(p),
      });
      const aec = NRB.seg({
        options: [[0, 'OFF', 'Captura limpia'], [1, 'ON', 'Quita del micro el ritmo que sale por los altavoces']],
        value: s.aec ? 1 : 0,
        onChange: async (v) => {
          s.aec = !!v;
          NRB.store.touch();
          if (e.mic.ok && !this.looper.micBusy()) await e.initMic(this.state.micId);      // si está cerrado, se aplica al abrirlo
        },
      });
      // cómo ha abierto el navegador el micrófono (si sale una frecuencia baja, el equipo lo abre en "formato de llamada")
      const ms = e.mic.settings, mk = (e.mic.label || 'micrófono').slice(0, 34);
      let micText = 'cerrado · púlsalo en MIC para ver cómo lo abre el navegador';
      if (e.mic.ok && e.mic.synthetic) micText = 'sintético (pruebas)';
      else if (e.mic.ok) {
        micText = mk + ' · ' + (ms && ms.sampleRate ? kHz(ms.sampleRate) + ' kHz' : '? kHz') + ' · ' + (ms && ms.channelCount ? ms.channelCount : '?') + ' can. · eco ' + (ms && ms.echoCancellation ? 'ON' : 'OFF');
        if (ms && ms.sampleRate && ms.sampleRate < 32000) micText += ' ⚠ formato de llamada (baja calidad)';
      }
      const micInfo = el('span', { class: 'row__v row__v--l', text: micText });
      const box = el('div', { class: 'pop__body' }, [
        row('SALIDA', info, true), row('MIC', micInfo, true), row('BUFFER', prof.el, true), row('ECO MIC', aec.el, true),
        el('p', { class: 'pop__note', text: 'Si con altavoces o auriculares de cable oyes chasquidos o cortes, sube el BUFFER (MÁX). Con altavoces, ECO MIC quita del micro el ritmo que suena; con auriculares no hace falta.' }),
      ]);
      NRB.popover.open(anchor, box, 'AUDIO');
    }

    changeProfile(p) {
      const loops = NRB.REC_IDS.some((id) => this.looper.tracks[id].hasLoop);
      if (loops && !confirm('Cambiar el buffer reinicia el audio: las grabaciones actuales se pierden (los patrones y la mezcla se conservan). ¿Continuar?')) {
        NRB.popover.close();
        return;
      }
      this.state.audio.profile = p;
      NRB.store.save();
      location.reload();
    }

    /* ------------------------------------------------------------------ pistas */
    buildLanes() {
      const host = $('#lanes');
      NRB.TRACKS.forEach((t) => {
        let lane;
        if (t.type === 'drum') lane = new NRB.DrumLane(this, t.id);
        else if (t.type === 'bass') lane = this.bassLane = new NRB.BassLane(this);
        else lane = this.recLanes[t.id] = new NRB.RecLane(this, t.id);
        this.lanes.push(lane);
        host.append(lane.root);
      });
    }

    /* ----------------------------------------------------------------- eventos */
    bindEvents() {
      this.transport.on('state', (run) => {
        document.body.classList.toggle('playing', run);
        this.playBtn.innerHTML = run ? ICON_STOP : ICON_PLAY;
        this.playBtn.classList.toggle('on', run);
        this.playBtn.setAttribute('aria-label', run ? 'Parar' : 'Reproducir');
        if (!run) { this.leds.forEach((l) => l.classList.remove('on')); this.barTxt.textContent = '000'; this.lastBar = this.lastBeat = -1; }
      });
      this.transport.on('bpm', () => this.setBeatVar());
      this.looper.on('track', (id) => this.recLanes[id].refresh());
      this.engine.on('mic', () => this.refreshMic());
      this.engine.on('ctxstate', (st) => { if (st !== 'running') NRB.toast('El audio está en pausa: pulsa play para reanudarlo.', 3000); });
      this.engine.on('output', () => NRB.toast('Salida de audio cambiada: reenganchado a la salida predeterminada.', 3500));
    }

    setBeatVar() { document.documentElement.style.setProperty('--beat', (60 / this.state.bpm).toFixed(3) + 's'); }

    refreshMic() {
      const m = this.engine.mic;
      this.micSel.textContent = '';
      (m.devices.length ? m.devices : [{ id: '', label: m.label || 'Micrófono' }]).forEach((d) => this.micSel.append(el('option', { value: d.id, text: d.label })));
      const cur = m.stream ? (m.stream.getAudioTracks()[0].getSettings().deviceId || '') : '';
      if (cur) this.micSel.value = cur;
      this.micSel.hidden = !m.ok;
      this.micMeter.hidden = !m.ok;
      this.micBtn.textContent = m.ok ? 'MIC ON' : 'MIC OFF';
      this.micBtn.classList.toggle('live', m.ok);
      this.micBtn.title = m.ok
        ? 'Micrófono abierto. Pulsa para cerrarlo (si no, se cierra solo unos segundos después de grabar)'
        : 'El micrófono está cerrado: se abre solo al pulsar REC y se cierra al terminar. Pulsa para abrirlo y mantenerlo abierto';
      document.body.classList.toggle('mic-live', m.ok);
      NRB.REC_IDS.forEach((id) => this.recLanes[id] && this.recLanes[id].refresh());
    }

    async toggleMic() {
      const e = this.engine;
      if (e.mic.ok) {
        if (this.looper.micBusy()) { NRB.toast('Se está grabando: el micrófono se cierra solo al terminar.', 3200); return; }
        e.micHold = false;
        e.closeMic();
      } else {
        e.micHold = true;                                  // lo mantengo abierto hasta que se pulse otra vez
        const ok = await e.openMic();
        if (!ok) { e.micHold = false; NRB.micFailToast(e.mic.error); }
      }
    }

    bindKeys() {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { NRB.popover.close(); $('#help').classList.remove('show'); return; }
        const tag = (e.target && e.target.tagName) || '';
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.code === 'Space') {
          e.preventDefault();
          if (tag === 'BUTTON') e.target.blur();
          this.transport.toggle();
        } else if (e.key >= '1' && e.key <= '4') {
          this.looper.press(NRB.REC_IDS[+e.key - 1]);
        }
      });
    }

    /* ----------------------------------------------------------- bucle visual */
    loop() {
      const pos = this.transport.stepPos();
      for (let i = 0; i < this.lanes.length; i++) this.lanes[i].frame(pos);
      this.mixer.frame();
      if (pos >= 0) {
        const bar = Math.floor(pos / 16), beat = Math.floor((pos % 16) / 4);
        if (bar !== this.lastBar) { this.barTxt.textContent = String(bar + 1).padStart(3, '0'); this.lastBar = bar; }
        if (beat !== this.lastBeat) {
          this.leds.forEach((l, i) => l.classList.toggle('on', i === beat));
          this.lastBeat = beat;
          const g = this.glow || (this.glow = $('#glow'));
          g.className = '';
          void g.offsetWidth;
          g.className = 'b' + (beat === 0 ? ' down' : '');
        }
      }
      if (this.engine.mic.ok) {
        const n = clamp((20 * Math.log10(this.engine.micLevel() + 1e-6) + 54) / 54, 0, 1);
        this.micLv = Math.max(n, (this.micLv || 0) - 0.04);
        this.micI.style.clipPath = 'inset(0 ' + ((1 - this.micLv) * 100).toFixed(1) + '% 0 0)';
      }
      requestAnimationFrame(() => this.loop());
    }
  }
  NRB.App = App;

  /* ---------------------------------------------------------------- la puerta */
  document.addEventListener('DOMContentLoaded', () => {
    document.title = NRB.APP_NAME;
    const btn = $('#enter'), status = $('#gate-status');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      status.textContent = 'Encendiendo el motor de audio…';
      const engine = new NRB.Engine(NRB.state);
      try {
        await engine.init();
      } catch (err) {
        console.error(err);
        status.textContent = 'No se pudo iniciar el audio: ' + (err && err.message ? err.message : err);
        btn.disabled = false;
        return;
      }
      const looper = new NRB.Looper(engine), transport = new NRB.Transport(engine);
      looper.transport = transport;
      transport.looper = looper;
      // OJO: aquí NO se abre el micrófono. Se abre solo al grabar.
      const app = (NRB.app = new App(engine, transport, looper));
      NRB.engine = engine; NRB.transport = transport; NRB.looper = looper;
      app.build();
      $('#app').hidden = false;
      $('#gate').classList.add('gone');
      setTimeout(() => $('#gate').remove(), 1200);
    });
  });

  /* aviso cuando el navegador no puede abrir el micrófono */
  NRB.micFailToast = function (err) {
    const msg = {
      NotAllowedError: 'El navegador no deja usar el micrófono. Pulsa el candado de la barra de direcciones, permítelo y vuelve a pulsar REC.',
      SecurityError: 'El navegador no deja usar el micrófono en esta página.',
      NotFoundError: 'No se encuentra ningún micrófono conectado.',
      NotReadableError: 'El micrófono está en uso por otro programa o no responde.',
      unsupported: 'Este navegador no permite usar el micrófono. Prueba con Chrome o Edge.',
    }[err] || 'No se pudo abrir el micrófono.';
    NRB.toast(msg, 6500);
  };
})();
