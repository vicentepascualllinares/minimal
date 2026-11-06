/* ============================================================================
 *  MIXER OF ALEXANDRIA: MINIMAL · mezclador
 *  Por canal solo lo imprescindible: HP, LP, PAN y volumen (+ mute / solo).
 * ========================================================================== */
(function () {
  'use strict';
  const NRB = (window.NRB = window.NRB || {});
  const { el, clamp } = NRB;
  const meterNorm = (lin) => clamp((20 * Math.log10(lin + 1e-6) + 54) / 54, 0, 1);

  class Strip {
    constructor(app, id) {
      this.app = app; this.id = id; this.lv = 0;
      const t = NRB.TRACK_BY_ID[id], st = NRB.state.tracks[id], def = NRB.defaultState().tracks[id];
      const apply = () => { app.engine.applyChannel(id); NRB.store.touch(); };
      this.hp = NRB.knob({ label: 'HP', value: st.hp, def: 0, fmt: (v) => NRB.map.fmtHz(NRB.map.hp(v)), onInput: (v) => { st.hp = v; apply(); } });
      this.lp = NRB.knob({ label: 'LP', value: st.lp, def: 1, fmt: (v) => NRB.map.fmtHz(NRB.map.lp(v)), onInput: (v) => { st.lp = v; apply(); } });
      this.pan = NRB.knob({ label: 'PAN', value: (st.pan + 1) / 2, def: 0.5, bipolar: true, fmt: (v) => NRB.map.fmtPan(v * 2 - 1), onInput: (v) => { st.pan = v * 2 - 1; apply(); } });
      this.fader = NRB.fader({
        value: st.vol, def: def.vol, label: 'Volumen ' + t.name,
        fmt: (v) => NRB.map.fmtDb(NRB.map.faderToDb(v)), onInput: (v) => { st.vol = v; apply(); },
      });
      this.mBtn = el('button', { class: 'mini', type: 'button', text: 'M', title: 'Mute', onclick: () => { st.mute = !st.mute; app.mixer.sync(); app.engine.applyAll(); NRB.store.touch(); } });
      this.sBtn = el('button', { class: 'mini mini--s', type: 'button', text: 'S', title: 'Solo', onclick: () => { st.solo = !st.solo; app.mixer.sync(); app.engine.applyAll(); NRB.store.touch(); } });
      this.root = el('div', { class: 'strip strip--' + t.type, 'data-track': id }, [
        el('div', { class: 'strip__name', text: t.short }),
        el('div', { class: 'strip__knobs' }, [this.hp.el, this.lp.el, this.pan.el]),
        el('div', { class: 'strip__fader' }, this.fader.el),
        el('div', { class: 'strip__ms' }, [this.mBtn, this.sBtn]),
      ]);
      this.sync();
    }
    sync() {
      const st = NRB.state.tracks[this.id];
      this.mBtn.classList.toggle('on', st.mute);
      this.sBtn.classList.toggle('on', st.solo);
    }
    frame() {
      this.lv = Math.max(meterNorm(this.app.engine.level(this.id)), this.lv - 0.035);
      this.fader.meter(this.lv);
    }
  }

  class Mixer {
    constructor(app, host) {
      this.app = app;
      this.strips = {};
      host.append(el('div', { class: 'mixer__tag' }, [el('span', { text: 'EQ' }), el('i'), el('span', { text: 'VOL' })]));
      NRB.TRACKS.forEach((t) => { const s = new Strip(app, t.id); this.strips[t.id] = s; host.append(s.root); });
      // master
      const st = NRB.state.master;
      this.mlv = 0;
      this.master = NRB.fader({
        value: st.vol, def: NRB.defaultState().master.vol, label: 'Volumen general',
        fmt: (v) => NRB.map.fmtDb(NRB.map.faderToDb(v)),
        onInput: (v) => { st.vol = v; app.engine.applyMaster(); NRB.store.touch(); },
      });
      host.append(el('div', { class: 'strip strip--master' }, [
        el('div', { class: 'strip__name', text: 'MASTER' }),
        el('div', { class: 'strip__knobs strip__knobs--ph' }),
        el('div', { class: 'strip__fader' }, this.master.el),
        el('div', { class: 'strip__ms strip__ms--ph' }),
      ]));
    }
    sync() { Object.keys(this.strips).forEach((k) => this.strips[k].sync()); }
    frame() {
      Object.keys(this.strips).forEach((k) => this.strips[k].frame());
      this.mlv = Math.max(meterNorm(this.app.engine.masterLevel()), this.mlv - 0.035);
      this.master.meter(this.mlv);
    }
  }

  NRB.Mixer = Mixer;
})();
