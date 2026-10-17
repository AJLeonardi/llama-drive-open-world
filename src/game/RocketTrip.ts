// A rocket flight between Earth and the space station, as a little film: the countdown,
// liftoff in clouds of smoke, the climb (on the way up the sky darkens to black), a
// white flash while the game switches worlds, then the rocket coming down on its engines
// onto the landing pad at the other end, and the car rolling out.
import * as THREE from 'three';
import type { Rocket } from '../space/rocket';
import type { Particles } from '../fx/Particles';
import type { GameAudio } from '../audio/Audio';
import type { Hud } from '../ui/Hud';
import { smoothstep } from '../util/math';

export interface TripEnd {
  rocket: Rocket;
  /** Where the bottom of the rocket stands when it's on the ground, and the way its window faces. */
  base: THREE.Vector3;
  heading: number;
}

export interface TripHost {
  camera: THREE.PerspectiveCamera;
  particles: Particles;
  audio: GameAudio;
  hud: Hud;
  /** 0..1: how far the Earth's sky has darkened towards space (going up). */
  skyFade(k: number): void;
  /** Some more of the station's building, if it's still being built. */
  buildStep(): void;
  /** The screen is white: switch worlds and say where the rocket comes down. */
  arrive(): TripEnd;
  /** Landed: put the car out. */
  done(): void;
}

/** When things happen (seconds from the start). */
const T = { count: 0.4, ignite: 3.4, fadeIn: 9.2, switch: 9.9, land: 15.4, out: 16.6 };
const DESCENT = T.land - T.switch;
const DROP = 170;

const tmp = new THREE.Vector3();
const look = new THREE.Vector3();

export class RocketTrip {
  private t = 0;
  private end: TripEnd | null = null;
  private shown = '';
  private finished = false;
  private camAngle: number;
  /** Camera shake (rumbling at liftoff, the bump on landing). */
  private shake = 0;

  /** `toSpace`: going up from Earth (the sky darkens on the way). */
  constructor(private readonly host: TripHost, private readonly from: TripEnd, private readonly toSpace: boolean) {
    this.camAngle = from.heading + 0.9;
    host.hud.show('cinema');
  }

  /** Each frame. Returns false once it's all over. */
  update(dt: number, time: number): boolean {
    if (this.finished) return false;
    const h = this.host;
    this.t += dt;
    const t = this.t;
    h.buildStep();

    // ---------------------------------------------------------------- countdown
    let text = '';
    if (t > T.count && t < T.ignite) text = String(3 - Math.floor((t - T.count) / 1.0));
    else if (t >= T.ignite && t < T.ignite + 1.6) text = 'LIFTOFF! 🚀';
    else if (t > T.land + 0.2 && t < T.out + 0.5) text = this.toSpace ? 'SPACE! ✨' : 'HOME! 🌍';
    if (text !== this.shown) {
      if (text && text.length === 1) h.audio.beep();
      if (text.startsWith('LIFTOFF')) h.audio.beep(true);
      this.shown = text;
      h.hud.setBig(text || null);
    }

    if (t < T.switch) this.ascent(dt, time, t);
    else {
      if (!this.end) {
        this.end = h.arrive();
        h.hud.setFade(false);
        h.skyFade(0);
      }
      this.descent(dt, time, t - T.switch);
    }
    if (t >= T.out) {
      this.finished = true;
      h.hud.setBig(null);
      h.audio.rocket(0);
      h.done();
      return false;
    }
    return true;
  }

  /** On the pad, then up and away. */
  private ascent(dt: number, time: number, t: number) {
    const h = this.host, r = this.from.rocket, base = this.from.base;
    const tau = Math.max(0, t - T.ignite);
    // Slow off the pad, then faster and faster.
    const alt = 0.6 * tau * tau + 0.9 * tau * tau * tau;
    r.root.position.set(base.x, base.y + alt, base.z);
    const thrust = t < T.ignite - 0.4 ? 0 : t < T.ignite ? 0.35 : 1;
    r.setThrust(thrust, time);
    h.audio.rocket(thrust * (1 - smoothstep(T.fadeIn - 1, T.switch, t) * 0.6));
    // Steam before ignition; then smoke billowing out over the ground and fire out the bottom.
    if (t > T.count + 1 && t < T.ignite && Math.random() < 0.3) h.particles.launchCloud(base, 1);
    if (tau > 0 && tau < 4) h.particles.launchCloud(base, alt < 30 ? 4 : 1);
    if (thrust > 0.5) h.particles.rocketExhaust(r.root.position, 1);
    if (tau > 0 && tau < 3) this.shake = 0.25;
    if (this.toSpace) h.skyFade(smoothstep(T.ignite + 2, T.switch, t));
    if (t > T.fadeIn) h.hud.setFade(true);

    // Camera: circling slowly at the foot of the pad, then (once it's going) chasing it up.
    const cam = h.camera;
    if (tau < 2.2) {
      this.camAngle += dt * 0.06;
      const d = 62;
      cam.position.set(base.x + Math.sin(this.camAngle) * d, base.y + 8, base.z + Math.cos(this.camAngle) * d);
      look.set(base.x, base.y + 18 + alt * 0.8, base.z);
    } else {
      const k = smoothstep(2.2, 4.5, tau);
      const d = 62 - 20 * k;
      tmp.set(base.x + Math.sin(this.camAngle) * d, base.y + 8 + (alt - 30) * k, base.z + Math.cos(this.camAngle) * d);
      cam.position.lerp(tmp, Math.min(1, dt * 3));
      look.set(base.x, base.y + alt + 20, base.z);
    }
    cam.lookAt(look);
    cam.fov = 60;
    cam.updateProjectionMatrix();
    this.jolt(dt);
  }

  private jolt(dt: number) {
    if (this.shake <= 0.01) return;
    const c = this.host.camera;
    c.position.x += (Math.random() - 0.5) * this.shake;
    c.position.y += (Math.random() - 0.5) * this.shake;
    this.shake *= Math.exp(-dt * 4);
  }

  /** Coming down on the engines onto the pad at the other end. */
  private descent(dt: number, time: number, t: number) {
    const h = this.host, e = this.end!, r = e.rocket, base = e.base;
    const k = Math.min(1, t / DESCENT);
    // Fast at first, gently at the end.
    const alt = DROP * (1 - k) * (1 - k);
    r.root.position.set(base.x, base.y + alt, base.z);
    const thrust = k < 1 ? 0.45 + 0.4 * k : Math.max(0, 1 - (t - DESCENT) * 2);
    r.setThrust(thrust, time);
    h.audio.rocket(thrust * 0.8);
    if (thrust > 0.3) h.particles.rocketExhaust(r.root.position, 0.7);
    if (alt < 25 && thrust > 0.1) h.particles.launchCloud(base, 2);
    if (k >= 1 && t - DESCENT < 0.1) this.shake = 0.6;
    const cam = h.camera;
    const a = e.heading + 0.7 + t * 0.05, d = 70 - 18 * k;
    tmp.set(base.x + Math.sin(a) * d, base.y + 14 + alt * 0.4, base.z + Math.cos(a) * d);
    if (t < dt * 1.5) cam.position.copy(tmp);
    else cam.position.lerp(tmp, Math.min(1, dt * 2));
    look.set(base.x, base.y + 16 + alt * 0.9, base.z);
    cam.lookAt(look);
    this.jolt(dt);
  }
}
