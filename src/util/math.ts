export type Vec2 = readonly [number, number];

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Deterministic PRNG so the world is identical on every device. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;
export const rand = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
export const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

function hash2(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth 2D value noise in [0, 1]. */
export function valueNoise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Distance from point p to segment ab, plus the parameter t along the segment. */
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1) : 0;
  const cx = ax + dx * t, cz = az + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), t };
}

export interface Rect {
  cx: number;
  cz: number;
  /** half extents */
  hw: number;
  hd: number;
  /** rotation around Y, radians */
  rot: number;
}

export function rectCorners(r: Rect): [number, number][] {
  const c = Math.cos(r.rot), s = Math.sin(r.rot);
  const out: [number, number][] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = sx * r.hw, lz = sz * r.hd;
    out.push([r.cx + lx * c + lz * s, r.cz - lx * s + lz * c]);
  }
  return out;
}

/** Separating-axis overlap test for two rotated rectangles. */
export function rectsOverlap(a: Rect, b: Rect, margin = 0) {
  const ca = rectCorners({ ...a, hw: a.hw + margin, hd: a.hd + margin });
  const cb = rectCorners(b);
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % 4];
      const nx = z2 - z1, nz = x1 - x2;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const [x, z] of ca) { const p = x * nx + z * nz; minA = Math.min(minA, p); maxA = Math.max(maxA, p); }
      for (const [x, z] of cb) { const p = x * nx + z * nz; minB = Math.min(minB, p); maxB = Math.max(maxB, p); }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

export function pointInRect(x: number, z: number, r: Rect, margin = 0) {
  const c = Math.cos(r.rot), s = Math.sin(r.rot);
  const dx = x - r.cx, dz = z - r.cz;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= r.hw + margin && Math.abs(lz) <= r.hd + margin;
}

export interface AABB2 { x0: number; z0: number; x1: number; z1: number }
export const inAABB = (x: number, z: number, b: AABB2, m = 0) => x >= b.x0 - m && x <= b.x1 + m && z >= b.z0 - m && z <= b.z1 + m;
/** Distance outside an axis-aligned box (0 when inside). */
export const distOutsideAABB = (x: number, z: number, b: AABB2) =>
  Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));
