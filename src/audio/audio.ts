// All sound is synthesised with Web Audio: no files to download, and every
// hit can vary in pitch so repetition never grates. The context starts on the
// first gesture (browser autoplay rules) and everything is silent before it.

type Kind = 'soft' | 'stone' | 'crystal' | 'metal' | 'ice' | 'bone' | 'none';

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const MINOR = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** chord roots per biome (MIDI), cycled slowly by the music */
const MUSIC: { roots: number[]; scale: number[]; pluck: number; bright: number }[] = [
  { roots: [60, 65, 57, 62], scale: PENTA, pluck: 0.55, bright: 2400 }, // surface / soft earth
  { roots: [57, 53, 60, 55], scale: PENTA, pluck: 0.45, bright: 2800 }, // crystal
  { roots: [50, 53, 48, 55], scale: MINOR, pluck: 0.35, bright: 1600 }, // ruins
  { roots: [52, 57, 55, 50], scale: PENTA, pluck: 0.4, bright: 3200 }, // frozen
  { roots: [45, 48, 43, 50], scale: MINOR, pluck: 0.3, bright: 1300 }, // magma
  { roots: [47, 43, 50, 45], scale: MINOR, pluck: 0.25, bright: 1900 }, // unknown
];

export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private drillNodes: { osc: OscillatorNode; osc2: OscillatorNode; grind: AudioBufferSourceNode; gain: GainNode; grindGain: GainNode; filter: BiquadFilterNode } | null = null;
  private thrustNodes: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private musicTimer: ReturnType<typeof setTimeout> | null = null;
  private musicBiome = 0;
  private chordIdx = 0;
  private padVoices: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private tension = 0;
  sfxVol = 0.8;
  musicVol = 0.55;
  muted = false;
  private lastPlay = new Map<string, number>();

  /** call from a user gesture */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    const len = ctx.sampleRate * 1.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startMusic();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.sfxVol * 0.9, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicVol * 0.32, t, 0.3);
  }

  suspend(on: boolean): void {
    if (!this.ctx) return;
    if (on) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** limit how often a sound can fire */
  private gate(key: string, ms: number): boolean {
    const now = performance.now();
    if ((this.lastPlay.get(key) ?? 0) + ms > now) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private env(gain: GainNode, t: number, a: number, peak: number, decay: number): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  private tone(freq: number, type: OscillatorType, peak: number, decay: number, when = 0, dest?: AudioNode, glide?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + decay);
    const g = ctx.createGain();
    this.env(g, t, 0.004, peak, decay);
    o.connect(g).connect(dest ?? this.sfxBus);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  private burst(peak: number, decay: number, filterType: BiquadFilterType, freq: number, q = 1, when = 0, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rnd(0.8, 1.2);
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.003, peak, decay);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 1);
    src.stop(t + decay + 0.05);
  }

  // ------------------------------------------------------------ drilling
  drill(on: boolean, hardness = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (on && !this.drillNodes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 3;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      const grind = ctx.createBufferSource();
      grind.buffer = this.noise;
      grind.loop = true;
      const gf = ctx.createBiquadFilter();
      gf.type = 'bandpass';
      gf.frequency.value = 900;
      gf.Q.value = 0.8;
      const grindGain = ctx.createGain();
      grindGain.gain.value = 0.0001;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain).connect(this.sfxBus);
      grind.connect(gf).connect(grindGain).connect(this.sfxBus);
      osc.start();
      osc2.start();
      grind.start();
      this.drillNodes = { osc, osc2, grind, gain, grindGain, filter };
    }
    const n = this.drillNodes;
    if (!n) return;
    if (on) {
      const base = 70 + Math.min(6, hardness) * 9;
      n.osc.frequency.setTargetAtTime(base, t, 0.04);
      n.osc2.frequency.setTargetAtTime(base * 1.505, t, 0.04);
      n.filter.frequency.setTargetAtTime(700 + hardness * 140, t, 0.05);
      n.gain.gain.setTargetAtTime(0.11, t, 0.03);
      n.grindGain.gain.setTargetAtTime(0.05 + Math.min(0.12, hardness * 0.02), t, 0.03);
    } else {
      n.gain.gain.setTargetAtTime(0.0001, t, 0.06);
      n.grindGain.gain.setTargetAtTime(0.0001, t, 0.05);
    }
  }

  /** tile destroyed */
  crack(kind: Kind, hardness: number): void {
    if (!this.ctx || !this.gate('crack', 40)) return;
    switch (kind) {
      case 'soft':
        this.burst(0.5, 0.16, 'lowpass', rnd(700, 1000));
        this.tone(rnd(90, 120), 'sine', 0.35, 0.12, 0, undefined, 50);
        break;
      case 'stone':
        this.burst(0.55, 0.22, 'bandpass', rnd(1000, 1500), 0.9);
        this.tone(rnd(70, 95), 'triangle', 0.45, 0.16, 0, undefined, 40);
        this.burst(0.25, 0.08, 'highpass', 3000, 1, 0.02);
        break;
      case 'crystal': {
        this.burst(0.3, 0.12, 'highpass', 2500);
        const root = 84 + Math.floor(rnd(0, 4)) * 2;
        for (let i = 0; i < 3; i++) this.tone(mtof(root + PENTA[Math.floor(rnd(0, 6))]), 'sine', 0.16, 0.5, i * 0.04);
        break;
      }
      case 'metal':
        this.tone(rnd(300, 360), 'square', 0.12, 0.3);
        this.tone(rnd(520, 600), 'sine', 0.14, 0.5);
        this.tone(rnd(1290, 1400), 'sine', 0.08, 0.35);
        this.burst(0.25, 0.1, 'bandpass', 2600, 2);
        break;
      case 'ice':
        this.burst(0.35, 0.18, 'highpass', 3200);
        this.tone(rnd(1500, 1800), 'sine', 0.12, 0.3);
        this.tone(rnd(2200, 2500), 'sine', 0.08, 0.25, 0.03);
        break;
      case 'bone':
        this.tone(rnd(220, 260), 'triangle', 0.3, 0.12, 0, undefined, 160);
        this.burst(0.3, 0.1, 'bandpass', 1200, 2);
        break;
    }
    void hardness;
  }

  bonk(): void {
    if (!this.ctx || !this.gate('bonk', 200)) return;
    this.tone(140, 'square', 0.18, 0.18, 0, undefined, 70);
    this.tone(420, 'sine', 0.12, 0.25);
    this.burst(0.25, 0.12, 'bandpass', 1800, 3);
  }

  collect(rarity: 'common' | 'uncommon' | 'rare' | 'epic', streak: number): void {
    if (!this.ctx) return;
    const up = Math.min(7, streak);
    const base = 72 + PENTA[up % PENTA.length];
    if (rarity === 'common') {
      if (!this.gate('collect', 50)) return;
      this.tone(mtof(base), 'square', 0.09, 0.09);
      this.tone(mtof(base + 7), 'square', 0.08, 0.12, 0.05);
    } else if (rarity === 'uncommon') {
      [0, 4, 7, 12].forEach((s, i) => this.tone(mtof(base + s), 'triangle', 0.16, 0.22, i * 0.05));
    } else {
      const notes = rarity === 'epic' ? [0, 4, 7, 12, 16, 19, 24] : [0, 4, 7, 12, 16];
      notes.forEach((s, i) => this.tone(mtof(base + s), 'triangle', 0.18, 0.4, i * 0.055));
      notes.forEach((s, i) => this.tone(mtof(base + s + 12), 'sine', 0.06, 0.6, i * 0.055 + 0.02));
      this.burst(0.12, 0.6, 'highpass', 6000);
    }
  }

  cargoFull(): void {
    if (!this.ctx || !this.gate('full', 900)) return;
    this.tone(180, 'square', 0.1, 0.14);
    this.tone(150, 'square', 0.1, 0.2, 0.13);
  }

  thrust(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (on && !this.thrustNodes) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      src.connect(filter).connect(gain).connect(this.sfxBus);
      src.start();
      this.thrustNodes = { src, gain, filter };
    }
    const n = this.thrustNodes;
    if (!n) return;
    n.gain.gain.setTargetAtTime(on ? 0.16 : 0.0001, t, on ? 0.04 : 0.08);
    n.filter.frequency.setTargetAtTime(on ? 900 : 400, t, 0.1);
  }

  heat(level: number): void {
    if (!this.ctx) return;
    if (level === 1) this.tone(880, 'sine', 0.1, 0.15);
    else if (level === 2) [0, 0.16].forEach((w) => this.tone(988, 'square', 0.08, 0.1, w));
    else if (level === 3) [0, 0.12, 0.24].forEach((w) => this.tone(1174, 'square', 0.1, 0.08, w, undefined, 1500));
  }

  /** soft repeated alarm while critical */
  heatTick(): void {
    if (!this.ctx || !this.gate('heatTick', 700)) return;
    this.tone(1046, 'square', 0.05, 0.07);
  }

  overheat(): void {
    if (!this.ctx) return;
    this.tone(400, 'sawtooth', 0.2, 1.2, 0, undefined, 60);
    this.burst(0.5, 0.8, 'lowpass', 2000, 1, 0.1, 200);
    for (let i = 0; i < 5; i++) this.burst(0.25, 0.08, 'bandpass', rnd(600, 1800), 3, 0.15 + i * 0.12);
  }

  explosion(): void {
    if (!this.ctx) return;
    this.burst(0.9, 0.9, 'lowpass', 3000, 0.7, 0, 120);
    this.tone(60, 'sine', 0.6, 0.6, 0, undefined, 30);
    this.burst(0.3, 0.3, 'highpass', 2500, 1, 0.05);
  }

  steam(): void {
    if (!this.ctx || !this.gate('steam', 150)) return;
    this.burst(0.35, 0.7, 'highpass', 3500, 0.5, 0, 1800);
  }

  cool(): void {
    if (!this.ctx || !this.gate('cool', 120)) return;
    [0, 5, 12].forEach((s, i) => this.tone(mtof(88 + s), 'sine', 0.1, 0.35, i * 0.04));
    this.burst(0.18, 0.4, 'highpass', 4000, 0.7);
  }

  splash(lava: boolean): void {
    if (!this.ctx || !this.gate('splash', 300)) return;
    if (lava) this.burst(0.4, 0.6, 'lowpass', 1200, 1, 0, 300);
    else this.burst(0.35, 0.4, 'bandpass', 900, 0.7, 0, 400);
  }

  land(speed: number): void {
    if (!this.ctx || !this.gate('land', 120)) return;
    this.tone(70, 'sine', Math.min(0.5, speed / 30), 0.15, 0, undefined, 40);
    this.burst(Math.min(0.3, speed / 50), 0.1, 'lowpass', 600);
  }

  pickup(): void {
    if (!this.ctx) return;
    [0, 4, 7, 11, 14].forEach((s, i) => this.tone(mtof(76 + s), 'triangle', 0.14, 0.3, i * 0.05));
  }

  discovery(): void {
    if (!this.ctx) return;
    const notes = [0, 7, 12, 16, 19, 24];
    notes.forEach((s, i) => this.tone(mtof(62 + s), 'triangle', 0.13, 1.2, i * 0.09));
    notes.forEach((s, i) => this.tone(mtof(74 + s), 'sine', 0.05, 1.4, i * 0.09 + 0.03));
  }

  biome(): void {
    if (!this.ctx) return;
    this.tone(mtof(38), 'sine', 0.4, 2.5);
    [0, 7, 12, 15].forEach((s, i) => this.tone(mtof(50 + s), 'triangle', 0.1, 2, 0.1 + i * 0.12));
  }

  /** coins counting into the bank; rising pitch over the count */
  coin(i: number): void {
    if (!this.ctx) return;
    this.tone(mtof(84 + (i % 12)), 'square', 0.06, 0.06);
    this.tone(mtof(91 + (i % 12)), 'sine', 0.05, 0.12, 0.02);
  }

  bankDone(big: boolean): void {
    if (!this.ctx) return;
    const n = big ? [0, 4, 7, 12, 16] : [0, 7, 12];
    n.forEach((s, i) => this.tone(mtof(72 + s), 'triangle', 0.15, 0.4, i * 0.06));
  }

  upgrade(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 4; i++) this.burst(0.2, 0.04, 'bandpass', 2400, 4, i * 0.05);
    [0, 4, 7, 12, 16].forEach((s, i) => this.tone(mtof(67 + s), 'square', 0.07, 0.25, 0.2 + i * 0.05));
  }

  click(): void {
    if (!this.ctx || !this.gate('click', 40)) return;
    this.tone(1200, 'square', 0.04, 0.03);
  }

  deny(): void {
    if (!this.ctx || !this.gate('deny', 150)) return;
    this.tone(200, 'square', 0.07, 0.1);
    this.tone(160, 'square', 0.07, 0.12, 0.08);
  }

  lift(): void {
    if (!this.ctx) return;
    this.tone(90, 'sawtooth', 0.08, 1.4, 0, undefined, 180);
    for (let i = 0; i < 8; i++) this.burst(0.08, 0.05, 'bandpass', 1500, 5, i * 0.15);
    this.tone(mtof(79), 'sine', 0.1, 0.3, 1.3);
  }

  recall(): void {
    if (!this.ctx) return;
    this.tone(300, 'sine', 0.12, 1.6, 0, undefined, 1200);
    for (let i = 0; i < 6; i++) this.tone(mtof(72 + i * 2), 'square', 0.04, 0.1, i * 0.25);
  }

  // ------------------------------------------------------------ music
  setMusicBiome(b: number): void {
    this.musicBiome = Math.max(0, Math.min(MUSIC.length - 1, b));
  }

  setTension(t: number): void {
    this.tension = t;
  }

  private startMusic(): void {
    if (!this.ctx || this.musicTimer) return;
    const step = () => {
      this.musicTimer = setTimeout(step, 4200);
      if (!this.ctx || this.ctx.state !== 'running' || this.musicVol <= 0) return;
      this.playBar();
    };
    this.musicTimer = setTimeout(step, 600);
  }

  private playBar(): void {
    const ctx = this.ctx!;
    const m = MUSIC[this.musicBiome];
    const root = m.roots[this.chordIdx % m.roots.length];
    this.chordIdx++;
    const t = ctx.currentTime;
    // pad: a soft open fifth that crossfades into the next
    if (this.padVoices) {
      const old = this.padVoices;
      old.gain.gain.setTargetAtTime(0.0001, t, 0.8);
      old.osc.forEach((o) => o.stop(t + 4));
    }
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(0.09, t, 0.9);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = m.bright * 0.5;
    filter.Q.value = 0.6;
    const osc: OscillatorNode[] = [];
    for (const [semi, det] of [
      [-12, 0],
      [0, -6],
      [7, 5],
      [12, 3],
    ]) {
      const o = ctx.createOscillator();
      o.type = semi === -12 ? 'triangle' : 'sawtooth';
      o.frequency.value = mtof(root + semi);
      o.detune.value = det;
      o.connect(filter);
      o.start(t);
      osc.push(o);
    }
    filter.connect(gain).connect(this.musicBus);
    this.padVoices = { osc, gain, filter };
    // sparse plucks from the scale; more of them near the surface
    const notes = 2 + Math.floor(Math.random() * 3 * m.pluck + m.pluck * 2);
    for (let i = 0; i < notes; i++) {
      const when = 0.3 + Math.random() * 3.6;
      const n = root + 12 + m.scale[Math.floor(Math.random() * 7)];
      this.tone(mtof(n), 'triangle', 0.07, 1.1, when, this.musicBus);
    }
    // tension pulse when hot
    if (this.tension > 0.5) {
      const beats = this.tension > 0.85 ? 8 : 4;
      for (let i = 0; i < beats; i++) this.tone(mtof(root - 12), 'sine', 0.12 * this.tension, 0.25, i * (4 / beats), this.musicBus);
    }
  }
}

export const sfx = new Sfx();
export type { Kind as SoundKind };
