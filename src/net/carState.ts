/**
 * A car's state as sent to the friend's device about 20 times a second, and the buffer
 * that turns those packets into smooth motion (no three.js or DOM, so it's tested in Node).
 */

export interface CarState {
  /** Sender's clock (ms). */
  time: number;
  /** Index into CAR_IDS, or -1 for no car (picking one, or in a menu). */
  car: number;
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  steer: number;
  /** Signed forward speed (m/s), for spinning the wheels. */
  speed: number;
  /** 0..1 damage, for smoke. */
  damage: number;
  /** Where the car is: 0 on Earth, 1 up at the space station. */
  realm: number;
  /** 0..1 how hard its space thrusters are firing. */
  thrust: number;
}

const BYTES = 8 + 4 * 15;

export function packState(s: CarState): ArrayBuffer {
  const buf = new ArrayBuffer(BYTES);
  const v = new DataView(buf);
  v.setFloat64(0, s.time, true);
  // (The last slot: the realm as its whole part, the thrust as the fraction.)
  const f = [s.car, s.x, s.y, s.z, s.qx, s.qy, s.qz, s.qw, s.vx, s.vy, s.vz, s.steer, s.speed, s.damage, s.realm + Math.min(0.99, Math.max(0, s.thrust))];
  f.forEach((n, i) => v.setFloat32(8 + i * 4, n, true));
  return buf;
}

export function unpackState(buf: ArrayBuffer): CarState | null {
  if (buf.byteLength !== BYTES) return null;
  const v = new DataView(buf);
  const f = (i: number) => v.getFloat32(8 + i * 4, true);
  const s: CarState = {
    time: v.getFloat64(0, true),
    car: Math.round(f(0)),
    x: f(1), y: f(2), z: f(3),
    qx: f(4), qy: f(5), qz: f(6), qw: f(7),
    vx: f(8), vy: f(9), vz: f(10),
    steer: f(11), speed: f(12), damage: f(13),
    realm: Math.floor(f(14)), thrust: f(14) - Math.floor(f(14)),
  };
  for (const k of ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'vx', 'vy', 'vz', 'steer', 'speed', 'damage'] as const)
    if (!Number.isFinite(s[k])) return null;
  return s;
}

/** How far behind the newest packet the friend's car is shown (ms): enough to bridge a lost packet or two. */
export const INTERP_DELAY = 110;
/** Past the newest packet the car keeps going on its velocity, for at most this long (ms). */
const MAX_EXTRAPOLATE = 300;

/**
 * Packets in arrival order → where the friend's car is now. The two clocks differ, so the
 * offset is estimated from the quickest-arriving packets (the least delayed ones).
 */
export class StateBuffer {
  private states: CarState[] = [];
  private offset: number | null = null;
  /** Local time (ms) of the newest packet. */
  lastHeard = -Infinity;

  push(s: CarState, localNow: number) {
    const last = this.states[this.states.length - 1];
    if (last && s.time <= last.time) return; // late or duplicate (the channel is unordered)
    // The offset follows the minimum delay; drift up slowly in case clocks wander.
    const o = localNow - s.time;
    this.offset = this.offset === null || o < this.offset ? o : this.offset + (o - this.offset) * 0.02;
    this.states.push(s);
    if (this.states.length > 40) this.states.shift();
    this.lastHeard = localNow;
  }

  get latest(): CarState | null {
    return this.states[this.states.length - 1] ?? null;
  }

  clear() {
    this.states = [];
    this.offset = null;
  }

  /** The state to show at local time `localNow`, or null before anything arrived. */
  sample(localNow: number, out: CarState): CarState | null {
    const n = this.states.length;
    if (!n || this.offset === null) return null;
    const t = localNow - this.offset - INTERP_DELAY;
    const st = this.states;
    if (t <= st[0].time) return Object.assign(out, st[0]);
    for (let i = n - 1; i > 0; i--) {
      const a = st[i - 1], b = st[i];
      if (t >= a.time && t <= b.time) return lerpState(a, b, (t - a.time) / Math.max(1e-6, b.time - a.time), out);
    }
    // Past the newest: carry on along its velocity for a moment.
    const b = st[n - 1];
    const dt = Math.min(MAX_EXTRAPOLATE, t - b.time) / 1000;
    Object.assign(out, b);
    out.x += b.vx * dt;
    out.y += b.vy * dt;
    out.z += b.vz * dt;
    return out;
  }
}

function lerpState(a: CarState, b: CarState, k: number, out: CarState) {
  const l = (p: number, q: number) => p + (q - p) * k;
  out.time = l(a.time, b.time);
  out.car = b.car;
  out.x = l(a.x, b.x); out.y = l(a.y, b.y); out.z = l(a.z, b.z);
  // Normalized lerp along the shorter way round; packets are close enough together for it.
  const sign = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw < 0 ? -1 : 1;
  let qx = l(a.qx, b.qx * sign), qy = l(a.qy, b.qy * sign), qz = l(a.qz, b.qz * sign), qw = l(a.qw, b.qw * sign);
  const ql = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= ql; qy /= ql; qz /= ql; qw /= ql;
  out.qx = qx; out.qy = qy; out.qz = qz; out.qw = qw;
  out.vx = l(a.vx, b.vx); out.vy = l(a.vy, b.vy); out.vz = l(a.vz, b.vz);
  out.steer = l(a.steer, b.steer);
  out.speed = l(a.speed, b.speed);
  out.damage = b.damage;
  out.realm = b.realm;
  out.thrust = b.thrust;
  return out;
}

export function emptyState(): CarState {
  return { time: 0, car: -1, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, steer: 0, speed: 0, damage: 0, realm: 0, thrust: 0 };
}
