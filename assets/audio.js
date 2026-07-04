// Procedural WebAudio: synthwave soundtrack + dynamic engine/drift/nitro SFX.
// No audio files — everything is synthesized so the engine can pitch-track speed.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this._engineOn = false;
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = this.ctx = new AC();

    // Master chain: music bus + sfx bus -> compressor (ear safety) -> out
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.16;   // music sits quiet under sfx
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.55;
    this.musicBus.connect(this.comp);
    this.sfxBus.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(ctx.destination);

    this._buildNoise();
    this._buildEngine();
    this._buildDrift();
    this._startMusic();
  }

  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }

  setMuted(m) {
    this.enabled = !m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  _buildNoise() {
    const ctx = this.ctx, len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  // ---------- MUSIC: 4-bar synthwave loop, lookahead scheduler ----------
  _startMusic() {
    const ctx = this.ctx;
    this.bpm = 118;
    this.step = 0;                       // 16th-note counter
    this.stepDur = 60 / this.bpm / 4;
    this.nextT = ctx.currentTime + 0.1;
    // Am F C G — chord tones as semitone offsets from A2 (110 Hz)
    const N = st => 110 * Math.pow(2, st / 12);
    this.chords = [
      { root: N(0),  arp: [0, 3, 7, 12, 7, 3, 0, 3] },       // Am
      { root: N(-4), arp: [-4, 0, 3, 8, 3, 0, -4, 0] },      // F
      { root: N(3),  arp: [3, 7, 10, 15, 10, 7, 3, 7] },     // C
      { root: N(-2), arp: [-2, 2, 5, 10, 5, 2, -2, 2] }      // G
    ];
    this._musicTimer = setInterval(() => this._schedule(), 40);
  }

  _schedule() {
    if (!this.ctx || !this.musicOn) { this.nextT = this.ctx ? Math.max(this.nextT, this.ctx.currentTime + 0.05) : 0; return; }
    const ctx = this.ctx;
    while (this.nextT < ctx.currentTime + 0.18) {
      const s = this.step, t = this.nextT;
      const bar = Math.floor(s / 16) % 4;
      const st16 = s % 16;
      const ch = this.chords[bar];
      // kick: 4 on the floor
      if (st16 % 4 === 0) this._kick(t);
      // snare: beats 2 & 4
      if (st16 === 4 || st16 === 12) this._snare(t);
      // hats: offbeats
      if (st16 % 2 === 1) this._hat(t, st16 % 4 === 3 ? 0.35 : 0.18);
      // bass: 8ths on root
      if (st16 % 2 === 0) this._bass(t, ch.root / 2, this.stepDur * 1.7);
      // arp: every 16th
      this._arp(t, ch.root * Math.pow(2, ch.arp[st16 % 8] / 12) * 2);
      // pad at bar start
      if (st16 === 0) this._pad(t, ch.root, this.stepDur * 16);
      this.nextT += this.stepDur;
      this.step++;
    }
  }

  _env(g, t, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _kick(t) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this._env(g, t, 0.002, 0.22, 0.9);
    o.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + 0.3);
  }

  _snare(t) {
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = this.noiseBuf; f.type = "highpass"; f.frequency.value = 1600;
    this._env(g, t, 0.002, 0.14, 0.4);
    src.connect(f); f.connect(g); g.connect(this.musicBus);
    src.start(t); src.stop(t + 0.2);
  }

  _hat(t, v) {
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = this.noiseBuf; f.type = "highpass"; f.frequency.value = 8000;
    this._env(g, t, 0.001, 0.045, v);
    src.connect(f); f.connect(g); g.connect(this.musicBus);
    src.start(t); src.stop(t + 0.08);
  }

  _bass(t, freq, dur) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = "square"; o.frequency.value = freq;
    f.type = "lowpass"; f.frequency.value = 420; f.Q.value = 4;
    this._env(g, t, 0.004, dur, 0.5);
    o.connect(f); f.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _arp(t, freq) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = "sawtooth"; o.frequency.value = freq;
    f.type = "lowpass";
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.1);
    this._env(g, t, 0.003, 0.11, 0.22);
    o.connect(f); f.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + 0.15);
  }

  _pad(t, root, dur) {
    const ctx = this.ctx;
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = "sawtooth"; o.frequency.value = root * 2; o.detune.value = det;
      f.type = "lowpass"; f.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.10, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(f); f.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }

  // ---------- ENGINE (continuous, pitch-tracked) ----------
  _buildEngine() {
    const ctx = this.ctx;
    this.engMain = ctx.createOscillator(); this.engMain.type = "sawtooth";
    this.engSub = ctx.createOscillator(); this.engSub.type = "square";
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = "lowpass"; this.engFilter.Q.value = 2;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engMain.connect(this.engFilter);
    this.engSub.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.sfxBus);
    this.engMain.start(); this.engSub.start();
    // nitro layer
    this.nitroSrc = ctx.createBufferSource();
    this.nitroSrc.buffer = this.noiseBuf; this.nitroSrc.loop = true;
    this.nitroFilter = ctx.createBiquadFilter(); this.nitroFilter.type = "bandpass"; this.nitroFilter.frequency.value = 900; this.nitroFilter.Q.value = 0.7;
    this.nitroGain = ctx.createGain(); this.nitroGain.gain.value = 0;
    this.nitroSrc.connect(this.nitroFilter); this.nitroFilter.connect(this.nitroGain); this.nitroGain.connect(this.sfxBus);
    this.nitroSrc.start();
  }

  _buildDrift() {
    const ctx = this.ctx;
    this.driftSrc = ctx.createBufferSource();
    this.driftSrc.buffer = this.noiseBuf; this.driftSrc.loop = true;
    this.driftFilter = ctx.createBiquadFilter(); this.driftFilter.type = "bandpass"; this.driftFilter.frequency.value = 2400; this.driftFilter.Q.value = 3.5;
    this.driftGain = ctx.createGain(); this.driftGain.gain.value = 0;
    this.driftSrc.connect(this.driftFilter); this.driftFilter.connect(this.driftGain); this.driftGain.connect(this.sfxBus);
    this.driftSrc.start();
  }

  // speed 0..1, throttle 0..1, drifting bool, nitro bool — call every frame
  engine(speed, throttle, drifting, nitro, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = 55 + speed * 165 + throttle * 22;
    this.engMain.frequency.setTargetAtTime(rpm, t, 0.05);
    this.engSub.frequency.setTargetAtTime(rpm / 2, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(320 + speed * 2400 + (nitro ? 2500 : 0), t, 0.08);
    const vol = this._engineOn ? 0.10 + speed * 0.14 + throttle * 0.05 : 0;
    this.engGain.gain.setTargetAtTime(vol, t, 0.1);
    this.nitroGain.gain.setTargetAtTime(nitro ? 0.32 : 0, t, nitro ? 0.03 : 0.15);
    this.nitroFilter.frequency.setTargetAtTime(nitro ? 1400 + speed * 1200 : 700, t, 0.1);
    const slip = drifting ? 0.22 + speed * 0.12 : 0;
    this.driftGain.gain.setTargetAtTime(slip, t, drifting ? 0.04 : 0.12);
    this.driftFilter.frequency.setTargetAtTime(1800 + speed * 1400, t, 0.1);
  }

  engineStart() { this._engineOn = true; }
  engineStop() {
    this._engineOn = false;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.engGain.gain.setTargetAtTime(0, t, 0.1);
      this.driftGain.gain.setTargetAtTime(0, t, 0.1);
      this.nitroGain.gain.setTargetAtTime(0, t, 0.1);
    }
  }

  // ---------- ONE-SHOTS ----------
  beep(high) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square"; o.frequency.value = high ? 1568 : 784;
    this._env(g, t, 0.005, high ? 0.5 : 0.16, 0.3);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.6);
  }

  lapChime() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [880, 1108, 1318].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      this._env(g, t + i * 0.09, 0.005, 0.3, 0.25);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.4);
    });
  }

  fanfare() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sawtooth"; o.frequency.value = f;
      this._env(g, t + i * 0.13, 0.01, 0.35, 0.2);
      const flt = ctx.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 2500;
      o.connect(flt); flt.connect(g); g.connect(this.sfxBus);
      o.start(t + i * 0.13); o.stop(t + i * 0.13 + 0.45);
    });
  }

  crash(v) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = this.noiseBuf; f.type = "lowpass"; f.frequency.value = 500 + v * 900;
    this._env(g, t, 0.002, 0.18, Math.min(0.5, 0.15 + v * 0.4));
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t); src.stop(t + 0.25);
  }

  click() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 660;
    this._env(g, t, 0.002, 0.07, 0.18);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.1);
  }
}
