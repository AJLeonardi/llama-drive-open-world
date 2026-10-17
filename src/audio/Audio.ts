// All sound is synthesized with the Web Audio API — no audio files.
//
// Engine: one engine cycle (two crank revolutions) is rendered into a buffer as a
// train of exhaust pulses, one per cylinder, with per-cylinder irregularity. Looping
// that buffer and setting playbackRate = rpm / BASE_RPM gives the right firing
// frequency for any RPM: a V12 at 8,000 rpm screams, a V6 at 2,000 rpm burbles.
import type { EngineSound } from '../vehicles/VehicleSpec';
import type { MaterialKind } from '../physics/Physics';

const BASE_RPM = 1000;

export interface EngineState {
  rpm: number;
  throttle: number;
  /** m/s */
  speed: number;
  skid: number;
  boosting: boolean;
  /** False once the car is wrecked. */
  running: boolean;
  shifted: boolean;
  misfire: boolean;
  /** 0..1 how damaged (makes the engine rougher) */
  damage: number;
}

interface EngineNodes {
  src: AudioBufferSourceNode;
  sub: AudioBufferSourceNode;
  shaper: WaveShaperNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  subGain: GainNode;
  intake: BiquadFilterNode;
  intakeGain: GainNode;
  /** Turbo spool: band-passed noise (a soft whoosh, not a whistle). */
  turbo: AudioBufferSourceNode | null;
  turboFilter: BiquadFilterNode | null;
  turboGain: GainNode | null;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private engine: EngineNodes | null = null;
  private eng: EngineSound | null = null;
  private wind!: GainNode;
  private skid!: GainNode;
  /** Rocket engines: a deep roar and a crackle on top. */
  private roar!: GainNode;
  private crackle!: GainNode;
  /** The car's space thrusters: a soft jet hiss. */
  private jet!: GainNode;
  private lastThrottle = 0;
  private boostLevel = 0;
  private stalled = false;
  private wasBoosting = false;
  muted = false;

  /** Must be called from a user tap (iOS only allows audio after a gesture). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      // iOS 17+: play even when the ringer switch is on silent.
      const nav = navigator as unknown as { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.noise = this.makeNoise();
      this.wind = this.loopNoise(this.lowpass(700), 0);
      this.skid = this.loopNoise(this.bandpass(750, 2), 0);
      this.roar = this.loopNoise(this.lowpass(160, 0.9), 0);
      this.crackle = this.loopNoise(this.bandpass(1400, 0.6), 0);
      this.jet = this.loopNoise(this.bandpass(2600, 0.9), 0);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Pause/resume all sound (pause menu, app in background). */
  suspend(s: boolean) {
    if (!this.ctx) return;
    if (s) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  // ---------- building blocks
  private makeNoise() {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private lowpass(f: number, q = 0.7) {
    const n = this.ctx!.createBiquadFilter();
    n.type = 'lowpass';
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  }

  private bandpass(f: number, q = 1) {
    const n = this.ctx!.createBiquadFilter();
    n.type = 'bandpass';
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  }

  /** A looping noise source through `filter`, returning its gain node. */
  private loopNoise(filter: AudioNode, gain: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    return g;
  }

  /** One-shot noise burst with an envelope. */
  private burst(filter: BiquadFilterNode, peak: number, attack: number, decay: number, when = 0, out: AudioNode = this.sfx) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(filter).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
    return { src, g, t };
  }

  private tone(type: OscillatorType, f0: number, f1: number, peak: number, dur: number, when = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------- engine
  private engineBuffer(e: EngineSound) {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const cycle = 120 / BASE_RPM; // two revolutions, seconds
    const len = Math.round(sr * cycle);
    const b = ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    // Exhaust "pop" resonance: deep engines ring lower.
    const res = 60 + e.tone * 0.06;
    const decay = 0.012 + (1 - Math.min(1, e.tone / 3000)) * 0.012;
    let seed = e.cylinders * 977;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let c = 0; c < e.cylinders; c++) {
      const jitter = (rnd() - 0.5) * e.roughness * (cycle / e.cylinders);
      const t0 = (c / e.cylinders) * cycle + jitter;
      const amp = 1 - e.roughness * rnd() * 1.5;
      for (let i = 0; i < len; i++) {
        let t = i / sr - t0;
        if (t < 0) t += cycle; // wrap so the loop is seamless
        if (t > decay * 8) continue;
        d[i] += amp * Math.exp(-t / decay) * Math.sin(2 * Math.PI * res * t) + amp * 0.35 * Math.exp(-t / (decay * 0.3));
      }
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (let i = 0; i < len; i++) d[i] /= peak || 1;
    return b;
  }

  private distortionCurve(amount: number) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
    }
    return curve;
  }

  setCar(e: EngineSound) {
    if (!this.ctx) return;
    this.stopEngine();
    const ctx = this.ctx;
    this.eng = e;
    this.stalled = false;
    const buf = this.engineBuffer(e);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const sub = ctx.createBufferSource();
    sub.buffer = buf;
    sub.loop = true;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.distortionCurve(2 + e.roughness * 10);
    const filter = this.lowpass(e.tone, 1.2);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const subGain = ctx.createGain();
    // Big low-revving engines get more low-end weight; the V12 stays clean.
    subGain.gain.value = e.body;
    src.connect(shaper);
    sub.connect(subGain).connect(shaper);
    shaper.connect(filter).connect(gain).connect(this.master);
    const intake = this.bandpass(800, 1.5);
    const intakeGain = ctx.createGain();
    intakeGain.gain.value = 0;
    const isrc = ctx.createBufferSource();
    isrc.buffer = this.noise;
    isrc.loop = true;
    isrc.connect(intake).connect(intakeGain).connect(this.master);
    isrc.start();
    let turbo: AudioBufferSourceNode | null = null, turboFilter: BiquadFilterNode | null = null, turboGain: GainNode | null = null;
    if (e.turbo) {
      // A pure sine whistle was a piercing squeal; filtered noise gives a gentle spool sound.
      turbo = ctx.createBufferSource();
      turbo.buffer = this.noise;
      turbo.loop = true;
      turboFilter = this.bandpass(900, 2.5);
      turboGain = ctx.createGain();
      turboGain.gain.value = 0;
      turbo.connect(turboFilter).connect(turboGain).connect(this.master);
      turbo.start();
    }
    src.start();
    sub.start();
    this.engine = { src, sub, shaper, filter, gain, subGain, intake, intakeGain, turbo, turboFilter, turboGain };
    // Little start-up "vroom"
    this.tone('sawtooth', 50, 120, 0.15, 0.5);
  }

  stopEngine() {
    const n = this.engine;
    if (!n || !this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of [n.gain, n.intakeGain, n.turboGain, this.wind, this.skid, this.jet]) g?.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => {
      try {
        n.src.stop();
        n.sub.stop();
        n.turbo?.stop();
      } catch {
        /* already stopped */
      }
    }, 300);
    this.engine = null;
  }

  update(dt: number, s: EngineState) {
    if (!this.ctx || !this.engine || !this.eng) return;
    const e = this.eng, n = this.engine, t = this.ctx.currentTime;

    // Wind and tire skid don't depend on the engine.
    const sp = Math.abs(s.speed);
    this.wind.gain.setTargetAtTime(e.wind * Math.min(1, (sp / 55) ** 2) * 0.22, t, 0.1);
    this.skid.gain.setTargetAtTime(Math.max(0, s.skid - 0.25) * Math.min(1, sp / 10) * 0.2, t, 0.05);

    if (!s.running) {
      if (!this.stalled) {
        // Cough… and stall.
        this.stalled = true;
        this.backfire(0.6);
        n.src.playbackRate.setTargetAtTime(0.3, t, 0.4);
        n.sub.playbackRate.setTargetAtTime(0.15, t, 0.4);
        n.gain.gain.setTargetAtTime(0, t + 0.3, 0.3);
        n.intakeGain.gain.setTargetAtTime(0, t, 0.1);
        n.turboGain?.gain.setTargetAtTime(0, t, 0.1);
      }
      return;
    }

    const rate = (s.rpm / BASE_RPM) * e.pitch;
    const rough = s.damage > 0.5 ? 1 + (Math.random() - 0.5) * s.damage * 0.12 : 1;
    n.src.playbackRate.setTargetAtTime(rate * rough, t, 0.03);
    n.sub.playbackRate.setTargetAtTime(rate * 0.5, t, 0.03);
    const rpmFrac = (s.rpm - e.idleRpm) / (e.redlineRpm - e.idleRpm);
    const load = s.misfire ? 0 : s.throttle;
    // Capped so high revs never turn shrill.
    n.filter.frequency.setTargetAtTime(Math.min(2800, e.tone * (0.55 + load * 0.5 + rpmFrac * 0.6)), t, 0.05);
    const vol = e.volume * (0.16 + load * 0.16 + rpmFrac * 0.1) * (s.misfire ? 0.25 : 1);
    n.gain.gain.setTargetAtTime(vol, t, 0.04);
    n.intakeGain.gain.setTargetAtTime(load * (0.03 + rpmFrac * 0.05), t, 0.05);
    n.intake.frequency.setTargetAtTime(500 + s.rpm * 0.18, t, 0.05);

    // Turbo spools up with throttle + rpm; lifting off with boost gives the "pssh".
    if (e.turbo && n.turbo && n.turboGain) {
      const target = load * Math.min(1, rpmFrac * 1.6);
      this.boostLevel += (target - this.boostLevel) * Math.min(1, dt * (target > this.boostLevel ? 1.5 : 6));
      n.turboFilter!.frequency.setTargetAtTime(700 + this.boostLevel * 1100, t, 0.08);
      n.turboGain.gain.setTargetAtTime(this.boostLevel * 0.035, t, 0.08);
      if (this.lastThrottle > 0.5 && s.throttle < 0.5 && this.boostLevel > 0.4) this.blowOff(this.boostLevel);
    }
    // V12-style pops and crackles on lift-off at high revs.
    if (this.lastThrottle > 0.5 && s.throttle < 0.5 && rpmFrac > 0.45 && Math.random() < e.popChance) this.crackles(e.cylinders >= 12 ? 9 : 4);
    if (s.shifted && e.cylinders >= 12) this.tone('sawtooth', 110, 55, 0.08, 0.08);
    if (s.misfire) this.backfire(0.5);
    if (s.boosting && !this.wasBoosting) this.whoosh();
    this.wasBoosting = s.boosting;
    this.lastThrottle = s.throttle;
  }

  private blowOff(level: number) {
    const f = this.bandpass(1500, 1.0);
    const { t } = this.burst(f, 0.16 * level, 0.01, 0.3);
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.3);
  }

  private crackles(n: number) {
    for (let i = 0; i < n; i++) {
      const when = 0.05 + Math.random() * 0.7;
      this.burst(this.bandpass(700 + Math.random() * 1200, 2), 0.12 + Math.random() * 0.2, 0.002, 0.03 + Math.random() * 0.04, when);
    }
  }

  backfire(level: number) {
    if (!this.ctx) return;
    this.burst(this.lowpass(500), 0.6 * level, 0.003, 0.18);
    this.tone('sine', 120, 40, 0.4 * level, 0.2);
  }

  private whoosh() {
    const f = this.bandpass(400, 0.8);
    const { t } = this.burst(f, 0.35, 0.05, 0.9);
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.8);
  }

  // ---------- crashes and effects
  /** Bigger `dv` (m/s velocity change) = louder, longer crash. */
  crash(dv: number, material: MaterialKind | undefined) {
    if (!this.ctx) return;
    const k = Math.min(1.2, dv / 22);
    if (k < 0.04) return;
    // Low thump for every hit
    this.tone('sine', 110 + k * 40, 35, 0.35 + k * 0.5, 0.18 + k * 0.25);
    switch (material) {
      case 'wood':
        this.burst(this.bandpass(900, 1.5), 0.3 + k * 0.5, 0.003, 0.12 + k * 0.2);
        for (let i = 0; i < 3 + k * 6; i++) this.burst(this.bandpass(1500 + Math.random() * 1500, 4), 0.15, 0.002, 0.05, Math.random() * 0.3);
        break;
      case 'plastic':
        this.burst(this.bandpass(1400, 2), 0.25 + k * 0.3, 0.002, 0.1);
        this.tone('triangle', 700, 300, 0.1 * k, 0.12);
        break;
      case 'glass':
        this.glass(k);
        break;
      default: {
        // Metal/concrete: crunch + a few inharmonic metallic rings.
        this.burst(this.lowpass(2500 + k * 2000), 0.4 + k * 0.6, 0.003, 0.2 + k * 0.5);
        if (material !== 'concrete' && material !== 'ground') {
          for (const f of [287, 455, 731, 1093]) this.tone('triangle', f * (0.9 + Math.random() * 0.2), f * 0.97, 0.05 + k * 0.08, 0.3 + k * 0.6);
        } else {
          this.burst(this.lowpass(700), 0.3 + k * 0.4, 0.005, 0.3 + k * 0.3, 0.02);
        }
      }
    }
  }

  private lastBoom = 0;

  /** Exploding barrel. `k` 0..1 = how close it was. Chain reactions get quieter follow-ups. */
  explosion(k: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const s = now - this.lastBoom < 0.15 ? k * 0.45 : k;
    this.lastBoom = now;
    this.tone('sine', 85, 22, 0.9 * s, 1.3);
    this.tone('triangle', 60, 28, 0.4 * s, 0.9);
    const f = this.lowpass(2400);
    const { t } = this.burst(f, 0.95 * s, 0.004, 1.8);
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 1.5);
    this.burst(this.bandpass(3500, 0.8), 0.35 * s, 0.002, 0.25);
    // Crackle and bits raining down afterwards
    for (let i = 0; i < 6; i++) this.burst(this.bandpass(1200 + Math.random() * 2500, 3), 0.12 * s, 0.002, 0.05, 0.2 + Math.random() * 0.9);
  }

  glass(k = 0.6) {
    if (!this.ctx) return;
    this.burst(this.bandpass(5000, 1), 0.25 + 0.3 * k, 0.002, 0.25);
    for (let i = 0; i < 10; i++) this.tone('sine', 3000 + Math.random() * 4000, 2500, 0.04, 0.08, Math.random() * 0.4);
  }

  partFall() {
    if (!this.ctx) return;
    for (let i = 0; i < 3; i++) this.tone('triangle', 400 + Math.random() * 600, 200, 0.12, 0.2, 0.1 + i * 0.15 + Math.random() * 0.1);
  }

  landing(vy: number) {
    if (!this.ctx || vy < 3) return;
    const k = Math.min(1, vy / 12);
    this.tone('sine', 90, 35, 0.3 + 0.4 * k, 0.25);
    this.burst(this.lowpass(600), 0.2 * k, 0.005, 0.2);
  }

  splash() {
    if (!this.ctx) return;
    const f = this.lowpass(1800);
    const { t } = this.burst(f, 0.7, 0.01, 1.1);
    f.frequency.setValueAtTime(2500, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 1.1);
    // Bubbly blips
    for (let i = 0; i < 14; i++) this.tone('sine', 300 + Math.random() * 500, 900 + Math.random() * 600, 0.08, 0.08, 0.4 + i * 0.18);
  }

  /** Rocket engines, 0 (off) to 1 (full thrust at liftoff). */
  rocket(level: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.roar.gain.setTargetAtTime(level * 1.6, t, 0.15);
    this.crackle.gain.setTargetAtTime(level * 0.22, t, 0.15);
  }

  /** The car's thrusters, 0..1. */
  thrust(level: number) {
    if (!this.ctx) return;
    this.jet.gain.setTargetAtTime(level * 0.16, this.ctx.currentTime, 0.08);
  }

  /** Countdown beep (higher on "go"). */
  beep(go = false) {
    if (!this.ctx) return;
    this.tone('square', go ? 1320 : 880, go ? 1320 : 880, 0.12, go ? 0.5 : 0.18);
  }

  /** Flying through a ring: a sparkly rising arpeggio. */
  ring(n: number) {
    if (!this.ctx) return;
    const base = 660 * Math.pow(2, (n % 6) / 12);
    [1, 1.26, 1.5, 2].forEach((m, i) => this.tone('sine', base * m, base * m * 1.01, 0.16, 0.35, i * 0.06));
  }

  /** Landing on the force-field net: a big springy boing. */
  boing() {
    if (!this.ctx) return;
    this.tone('sine', 110, 420, 0.5, 0.7);
    this.tone('triangle', 220, 640, 0.18, 0.6, 0.03);
  }

  chime() {
    if (!this.ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.18, 0.25, i * 0.09));
  }

  click() {
    if (!this.ctx) return;
    this.tone('square', 900, 600, 0.05, 0.05);
  }
}
