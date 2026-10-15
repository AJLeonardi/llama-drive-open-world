import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type RGB = [number, number, number];
export type ColorFn = (x: number, y: number, z: number) => RGB | number;

const tmpColor = new THREE.Color();
/** sRGB hex → linear RGB (what vertex colours need under three's colour management). */
export const hex = (h: number): RGB => {
  tmpColor.setHex(h);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
};

function toRGB(c: RGB | number): RGB {
  return typeof c === 'number' ? hex(c) : c;
}

/** Strip to position + normal + color so geometries can be merged and dented uniformly. */
export function paint(geo: THREE.BufferGeometry, color: ColorFn | number): THREE.BufferGeometry {
  const g = geo;
  g.deleteAttribute('uv');
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = toRGB(typeof color === 'number' ? color : color(pos.getX(i), pos.getY(i), pos.getZ(i)));
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

export interface BoxOpts {
  /** center */
  at: [number, number, number];
  size: [number, number, number];
  /** approx segment length for dentable detail (m) */
  seg?: number;
  rot?: [number, number, number];
  color: ColorFn | number;
}

export function box(o: BoxOpts) {
  const s = o.seg ?? 0.35;
  const [w, h, d] = o.size;
  const geo = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.round(w / s)), Math.max(1, Math.round(h / s)), Math.max(1, Math.round(d / s)));
  if (o.rot) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...o.rot)));
  geo.translate(...o.at);
  return paint(geo, o.color);
}

export interface CylOpts {
  at: [number, number, number];
  radius: number;
  length: number;
  /** axis the cylinder runs along */
  axis: 'x' | 'y' | 'z';
  segments?: number;
  radiusTop?: number;
  /** Rings along the length (needed for colour stripes). */
  heightSegments?: number;
  color: ColorFn | number;
}

export function cyl(o: CylOpts) {
  const geo = new THREE.CylinderGeometry(o.radiusTop ?? o.radius, o.radius, o.length, o.segments ?? 14, o.heightSegments ?? 1);
  if (o.axis === 'x') geo.rotateZ(Math.PI / 2);
  if (o.axis === 'z') geo.rotateX(Math.PI / 2);
  geo.translate(...o.at);
  return paint(geo, o.color);
}

export function torus(at: [number, number, number], r: number, tube: number, rot: [number, number, number], color: number) {
  const geo = new THREE.TorusGeometry(r, tube, 6, 16);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
  geo.translate(...at);
  return paint(geo, color);
}

export function merge(geos: THREE.BufferGeometry[]) {
  // Some three.js shapes (rounded boxes) are non-indexed; index them so everything merges.
  const out = mergeGeometries(geos.map((g) => (g.index ? g : mergeVertices(g))), false);
  if (!out) throw new Error('merge failed');
  return out;
}

// ---------------------------------------------------------------------------
// Smooth modelling tools

export interface RBoxOpts extends BoxOpts {
  radius?: number;
  /** Rounding smoothness; 1 = cheap chamfer (default), 2+ = rounder but many more triangles. */
  smooth?: number;
}

/** Box with rounded edges (smooth shading). */
export function rbox(o: RBoxOpts) {
  const [w, h, d] = o.size;
  const r = Math.min(o.radius ?? 0.04, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const geo = new RoundedBoxGeometry(w, h, d, o.smooth ?? 1, Math.max(0.001, r));
  if (o.rot) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...o.rot)));
  geo.translate(...o.at);
  return paint(geo, o.color);
}

/**
 * Cross-section of a sculpted body at position z.
 * The outline goes: bottom (half width wB at y0) → widest point (wM at ys) → top (wT at y1),
 * then gets rounded by corner-cutting. `round` = 0 (crisp, Lamborghini) … 3 (soft).
 */
export interface Sculpt {
  y0: number;
  ys: number;
  y1: number;
  wB: number;
  wM: number;
  wT: number;
}

export interface SculptOpts {
  z0: number;
  z1: number;
  /** Section at z (any smooth function — use `keyframes` for convenience). */
  at: (z: number) => Sculpt;
  /** Approximate spacing between stations (m). */
  step?: number;
  round?: number;
  /** Raise the underside over the wheels: [axle z, arch radius, wheel centre y]. */
  arches?: [number, number, number][];
  color: ColorFn | number;
}

function chaikin(pts: [number, number][], iterations: number) {
  let p = pts;
  for (let k = 0; k < iterations; k++) {
    const out: [number, number][] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = out;
  }
  return p;
}

/** Underside height including wheel-arch cut-outs. */
export function archY(z: number, base: number, arches: [number, number, number][] = []) {
  let y = base;
  for (const [az, r, cy] of arches) {
    const dz = Math.abs(z - az);
    if (dz < r) y = Math.max(y, cy + Math.sqrt(r * r - dz * dz));
  }
  return y;
}

export function sculptRing(s: Sculpt, round: number) {
  // Extra points on the flat sides keep the shape even after rounding.
  const base: [number, number][] = [
    [0, s.y0], [s.wB, s.y0], [s.wM, (s.y0 + s.ys) / 2], [s.wM, s.ys], [(s.wM + s.wT) / 2, (s.ys + s.y1) / 2 + (s.y1 - s.ys) * 0.15],
    [s.wT, s.y1], [0, s.y1], [-s.wT, s.y1], [-(s.wM + s.wT) / 2, (s.ys + s.y1) / 2 + (s.y1 - s.ys) * 0.15],
    [-s.wM, s.ys], [-s.wM, (s.y0 + s.ys) / 2], [-s.wB, s.y0],
  ];
  return chaikin(base, round);
}

/** Smooth closed body. Indexed, smooth normals, dense enough to dent nicely. */
export function sculpt(o: SculptOpts) {
  const step = o.step ?? 0.1;
  const round = o.round ?? 2;
  const n = Math.max(2, Math.round((o.z1 - o.z0) / step));
  const positions: number[] = [];
  const indices: number[] = [];
  let rn = 0;
  for (let i = 0; i <= n; i++) {
    // Denser stations at the ends for crisp noses/tails.
    const t = i / n;
    const z = o.z0 + (o.z1 - o.z0) * t;
    const s = { ...o.at(z) };
    s.y0 = archY(z, s.y0, o.arches);
    if (s.y0 > s.ys - 0.02) s.ys = s.y0 + 0.02;
    if (s.ys > s.y1 - 0.01) s.y1 = s.ys + 0.01;
    const ring = sculptRing(s, round);
    rn = ring.length;
    for (const [x, y] of ring) positions.push(x, y, z);
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < rn; j++) {
      const a = i * rn + j, b = i * rn + ((j + 1) % rn), c = (i + 1) * rn + j, d = (i + 1) * rn + ((j + 1) % rn);
      indices.push(a, b, c, b, d, c);
    }
  for (const [si, flip] of [[0, false], [n, true]] as const) {
    const center = positions.length / 3;
    let cy = 0;
    for (let j = 0; j < rn; j++) cy += positions[(si * rn + j) * 3 + 1];
    positions.push(0, cy / rn, positions[si * rn * 3 + 2]);
    for (let j = 0; j < rn; j++) {
      const a = si * rn + j, b = si * rn + ((j + 1) % rn);
      if (flip) indices.push(center, a, b);
      else indices.push(center, b, a);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return paint(geo, o.color);
}

/** Smoothly interpolate section parameters between keyframes (by z). */
export function keyframes(frames: ({ z: number } & Sculpt)[]) {
  const f = [...frames].sort((a, b) => a.z - b.z);
  const keys: (keyof Sculpt)[] = ['y0', 'ys', 'y1', 'wB', 'wM', 'wT'];
  return (z: number): Sculpt => {
    if (z <= f[0].z) return { ...f[0] };
    if (z >= f[f.length - 1].z) return { ...f[f.length - 1] };
    let i = 0;
    while (f[i + 1].z < z) i++;
    const a = f[i], b = f[i + 1];
    let t = (z - a.z) / (b.z - a.z);
    t = t * t * (3 - 2 * t); // ease so the surface has no creases between keyframes
    const out = {} as Sculpt;
    for (const k of keys) out[k] = a[k] + (b[k] - a[k]) * t;
    return out;
  };
}

/**
 * Cut a panel (door, hood…) out of a surface: keeps the triangles whose vertices all
 * pass `keep`, and pushes them `offset` metres out along the normals so they sit on top.
 */
export function patch(src: THREE.BufferGeometry, keep: (x: number, y: number, z: number) => boolean, offset: number, color: ColorFn | number) {
  const pos = src.attributes.position, nor = src.attributes.normal;
  const idx = src.index!;
  const map = new Map<number, number>();
  const out: number[] = [], nrm: number[] = [], ind: number[] = [];
  const ok = (i: number) => keep(pos.getX(i), pos.getY(i), pos.getZ(i));
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    if (!ok(a) || !ok(b) || !ok(c)) continue;
    for (const v of [a, b, c]) {
      let m = map.get(v);
      if (m === undefined) {
        m = out.length / 3;
        map.set(v, m);
        out.push(pos.getX(v) + nor.getX(v) * offset, pos.getY(v) + nor.getY(v) * offset, pos.getZ(v) + nor.getZ(v) * offset);
        nrm.push(nor.getX(v), nor.getY(v), nor.getZ(v));
      }
      ind.push(m);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  // Keep the source surface's normals so the panel shades exactly like the body around it.
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(ind);
  return paint(g, color);
}

/** Lathe around the x axis (wheels, lamps). Profile points are [radius, x]. */
export function latheX(profile: [number, number][], segments: number, at: [number, number, number], color: ColorFn | number) {
  const g = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), segments);
  g.rotateZ(-Math.PI / 2);
  g.translate(...at);
  return paint(g, color);
}

/** Round tube through points (roll bars, flares, handles). */
export function tube(points: [number, number, number][], radius: number, color: ColorFn | number, segments = 24, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, segments, radius, radial, false);
  return paint(g, color);
}

/** Arc of points around a wheel (for flares/arches): angles in radians from straight up, in the y-z plane. */
export function arcPoints(x: number, cy: number, cz: number, r: number, a0: number, a1: number, n = 12): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([x, cy + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

/** Ellipsoid (lamps, mirrors, blobs). */
export function blob(at: [number, number, number], r: [number, number, number], color: ColorFn | number, detail = 12) {
  const g = new THREE.SphereGeometry(1, detail, Math.max(6, detail * 0.6));
  g.scale(...r);
  g.translate(...at);
  return paint(g, color);
}
