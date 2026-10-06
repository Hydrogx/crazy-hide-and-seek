/* ===================== 核心：程序化音效（WebAudio，无外部资源） ===================== */
(function (global) {
  'use strict';

  const Audio = {
    ctx: null,
    master: null,
    enabled: true,
    ready: false,

    init() {
      if (this.ready) return;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        // 轻微压缩，避免爆音
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 6;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        this.ready = true;
      } catch (e) {
        this.enabled = false;
      }
    },

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    setEnabled(on) {
      this.enabled = on;
      if (this.master) this.master.gain.value = on ? 0.5 : 0;
    },

    /* ---------- 基础发声单元 ---------- */
    tone(opts) {
      if (!this.enabled || !this.ready) return;
      const c = this.ctx;
      const t0 = c.currentTime + (opts.delay || 0);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(opts.freq, t0);
      if (opts.freqTo && opts.freqTo !== opts.freq) {
        const curve = opts.exp ? 'exponentialRampToValueAtTime' : 'linearRampToValueAtTime';
        osc.frequency[curve](Math.max(1, opts.freqTo), t0 + opts.dur);
      }
      const vol = (opts.vol == null ? 0.25 : opts.vol);
      const atk = opts.attack == null ? 0.008 : opts.attack;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + atk);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
      osc.connect(gain);
      gain.connect(opts.dest || this.master);
      osc.start(t0);
      osc.stop(t0 + opts.dur + 0.02);
    },

    noise(opts) {
      if (!this.enabled || !this.ready) return;
      const c = this.ctx;
      const t0 = c.currentTime + (opts.delay || 0);
      const dur = opts.dur;
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (opts.decay === false ? 1 : (1 - i / len));
      const src = c.createBufferSource();
      src.buffer = buf;
      const filter = c.createBiquadFilter();
      filter.type = opts.filter || 'bandpass';
      filter.frequency.setValueAtTime(opts.freq || 900, t0);
      if (opts.freqTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqTo), t0 + dur);
      filter.Q.value = opts.q == null ? 1.2 : opts.q;
      const gain = c.createGain();
      gain.gain.setValueAtTime(opts.vol == null ? 0.2 : opts.vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter); filter.connect(gain); gain.connect(opts.dest || this.master);
      src.start(t0); src.stop(t0 + dur + 0.02);
    },

    /* ---------- 具体音效 ---------- */
    step(sprint) {
      this.noise({ freq: sprint ? 1500 : 900, freqTo: 260, dur: 0.09, vol: sprint ? 0.11 : 0.06, q: 0.7 });
    },
    giggle() {
      // 小捣蛋鬼的笑声：三个上滑短音
      const base = 620 + Math.random() * 260;
      for (let i = 0; i < 3; i++) {
        this.tone({ type: 'triangle', freq: base * (1 + i * 0.16), freqTo: base * (1.3 + i * 0.18), dur: 0.075, vol: 0.075, delay: i * 0.075 });
      }
    },
    rustle() {
      this.noise({ freq: 2600, freqTo: 700, dur: 0.3, vol: 0.08, q: 0.6, filter: 'highpass' });
    },
    grabTick(progress) {
      this.tone({ type: 'square', freq: 300 + progress * 700, dur: 0.05, vol: 0.05 });
    },
    caught() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => this.tone({ type: 'triangle', freq: f, dur: 0.22, vol: 0.16, delay: i * 0.07 }));
      this.tone({ type: 'sine', freq: 261.6, dur: 0.5, vol: 0.12, delay: 0.05 });
    },
    escape() {
      this.tone({ type: 'sine', freq: 880, freqTo: 300, dur: 0.5, vol: 0.14, exp: true });
      this.noise({ freq: 2200, freqTo: 400, dur: 0.45, vol: 0.09, q: 0.5 });
    },
    win() {
      const seq = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      seq.forEach((f, i) => this.tone({ type: 'triangle', freq: f, dur: 0.45, vol: 0.18, delay: i * 0.12 }));
      seq.forEach((f, i) => this.tone({ type: 'sine', freq: f / 2, dur: 0.6, vol: 0.12, delay: i * 0.12 }));
    },
    lose() {
      const seq = [392, 349.23, 293.66, 220];
      seq.forEach((f, i) => this.tone({ type: 'sawtooth', freq: f, dur: 0.42, vol: 0.13, delay: i * 0.16 }));
    },
    countdown(last) {
      this.tone({ type: 'sine', freq: last ? 880 : 560, dur: last ? 0.35 : 0.16, vol: 0.16 });
    },
    whoosh() {
      this.noise({ freq: 400, freqTo: 2400, dur: 0.35, vol: 0.1, q: 0.8, filter: 'bandpass' });
    },
    click() {
      this.tone({ type: 'square', freq: 720, dur: 0.05, vol: 0.06 });
    },
    warn() {
      this.tone({ type: 'sawtooth', freq: 200, freqTo: 320, dur: 0.25, vol: 0.1 });
    }
  };

  global.HS = global.HS || {};
  global.HS.audio = Audio;
})(window);
