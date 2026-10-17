// Highway country: the big map beyond the cities (pure data, no three.js / Rapier).
//
// Long highways run in three general directions 60° apart (a triangle pattern, not a
// square grid), plus three spurs out from the cities, all ending on a six-sided Ring
// highway round the outside. Their straight "base lines" are spaced so no three ever
// meet at one point; some are left out (more in the mountains) so the network isn't a
// regular grid. Between interchanges each highway then sweeps from side to side in long
// curves, wider and twistier in the mountains, where the land makes valleys for them.
// Near each interchange a highway runs straight, so the crossings and ramps keep their
// shape. Where two highways cross, the newer one goes over on a bridge and four ramps
// link them, one in each corner. Each highway's height follows a smoothed version of the
// land (never steeper than MAX_GRADE), and the land is cut and filled to meet it.
// Lakes and radio towers dot the country, and there are towns: two just off a highway,
// and Washington DC with roads in from three of them.
import { clamp, lerp, mulberry32, smoothstep, type Vec2 } from '../util/math';
import { FAMILY_NORMALS, HEX, OUTER, RING_APOTHEM, WORLD, hexDistance } from './bounds';
import { terrainBase } from './hills';
import { biomeAt, desertWeight, mountainWeight } from './biomes';
import { setCorridors } from './corridors';

/** Highway half-width (6 lanes + shoulders, like the one between the cities). */
export const HW = 15;
/** Ramp (connector) half-width. */
export const RAMP_HW = 6;
/** Town road half-width. */
export const TOWN_HW = 5;
/** How far the upper highway rises to clear the lower one. */
export const OVERPASS_RISE = 8.5;
export const PROFILE_STEP = 25;
const MAX_GRADE = 0.07;
/** Line spacing within each direction. */
const SPACING = 1100;
/** Radius of the Ring's rounded corners. */
const RING_CORNER = 450;
/** A highway runs straight for this far either side of an interchange, then may start to curve. */
const STRAIGHT_NEAR = 480;
const CURVE_IN = 1400;

/** A highway: a gently curving line on the map. */
export interface Highway {
  id: number;
  /** Shown on signs: "RT 7". */
  name: string;
  /** Points every PROFILE_STEP m along it (the last one at `len`). */
  pts: Vec2[];
  /** Direction of travel (unit vector) at each point. */
  dirs: Vec2[];
  len: number;
  /** Road height at each point. */
  profile: Float32Array;
  spur: boolean;
  x0: number; z0: number; x1: number; z1: number;
}

export interface Crossing {
  x: number;
  z: number;
  upper: number;
  lower: number;
  /** Distance along each highway. */
  sUpper: number;
  sLower: number;
  /** Land height the interchange is levelled to. */
  h0: number;
  /** Sine of the crossing angle. */
  sin: number;
  /** Half-length of the level bridge section on the upper highway. */
  flat: number;
}

/** A curved road (an interchange ramp, the Ring, or a town road) as points with a road height at each. */
export interface CurveRoad {
  kind: 'ramp' | 'ring' | 'town';
  /** Town roads: which lane markings (default: a two-lane street). */
  look?: 'street' | 'avenue';
  pts: Vec2[];
  hs: number[];
  hw: number;
  closed: boolean;
  /** Ramps: the highway they leave from and the one they join (roads into town: their highway, twice; streets −1). */
  from: number;
  to: number;
  x0: number; z0: number; x1: number; z1: number;
}

export interface OuterLake { x: number; z: number; r: number; level: number; depth: number }
export interface Tower { x: number; z: number; h: number }

/** Distance outside WORLD (negative inside). */
export const outsideWorld = (x: number, z: number) => Math.max(WORLD.x0 - x, x - WORLD.x1, WORLD.z0 - z, z - WORLD.z1);
/** Distance outside the square at the heart of the map, which the highways run straight past. */
const outsideCore = (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) - 1536;

function bbox(pts: readonly Vec2[]) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (z0 = Math.min(z0, z)), (z1 = Math.max(z1, z));
  return { x0, z0, x1, z1 };
}

/** Smooth a height list over ±w samples, then limit its steepness (fixed points stay put). */
function shapeProfile(raw: ArrayLike<number>, w: number, step: number, fixed?: (k: number) => number | null) {
  const n = raw.length;
  const p = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, k - w); j <= Math.min(n - 1, k + w); j++) (s += raw[j]), c++;
    p[k] = s / c;
  }
  if (fixed)
    for (let k = 0; k < n; k++) {
      const f = fixed(k);
      if (f !== null) p[k] = f;
    }
  const g = MAX_GRADE * step;
  for (let pass = 0; pass < 4; pass++) {
    for (let k = 1; k < n; k++) if (!fixed || fixed(k) === null) p[k] = clamp(p[k], p[k - 1] - g, p[k - 1] + g);
    for (let k = n - 2; k >= 0; k--) if (!fixed || fixed(k) === null) p[k] = clamp(p[k], p[k + 1] - g, p[k + 1] + g);
  }
  return p;
}

// ---------------------------------------------------------------- the Ring

/** The Ring: a hexagon with rounded corners, as a closed list of points ~PROFILE_STEP apart. */
function ringPoints(): Vec2[] {
  const angles = HEX.map(([nx, nz]) => Math.atan2(nz, nx)).sort((a, b) => a - b);
  const out: Vec2[] = [];
  const cornerDist = (RING_APOTHEM - RING_CORNER) / Math.cos(Math.PI / 6);
  angles.forEach((a, k) => {
    const b = k + 1 < angles.length ? angles[k + 1] : angles[0] + 2 * Math.PI;
    const mid = (a + b) / 2;
    const cx = Math.cos(mid) * cornerDist, cz = Math.sin(mid) * cornerDist;
    for (let i = 0; i <= 10; i++) {
      const t = a + ((b - a) * i) / 10;
      out.push([cx + Math.cos(t) * RING_CORNER, cz + Math.sin(t) * RING_CORNER]);
    }
  });
  // Fill the long straight sides in.
  const dense: Vec2[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[i], b = out[(i + 1) % out.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / PROFILE_STEP));
    for (let k = 0; k < n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return dense;
}

const RING_PTS = ringPoints();
/** The Ring (its heights are filled in once the mountains know where the roads are). */
export const RING: CurveRoad = { kind: 'ring', pts: RING_PTS, hs: [], hw: HW, closed: true, from: -1, to: -1, ...bbox(RING_PTS) };

/** Where the line a + t·u meets the Ring, beyond t0 (forwards) — the end of a highway. */
function meetRing(ax: number, az: number, ux: number, uz: number, after: number) {
  let best = Infinity;
  const n = RING.pts.length;
  for (let i = 0; i < n; i++) {
    const [p, q] = [RING.pts[i], RING.pts[(i + 1) % n]];
    const ex = q[0] - p[0], ez = q[1] - p[1];
    const den = ux * ez - uz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const dx = p[0] - ax, dz = p[1] - az;
    const t = (dx * ez - dz * ex) / den, u = (dx * uz - dz * ux) / den;
    if (u >= 0 && u <= 1 && t > after && t < best) best = t;
  }
  return best;
}

/** Height of the Ring nearest a point. */
function ringHeight(x: number, z: number) {
  let best = Infinity, h = 0;
  RING.pts.forEach(([px, pz], i) => {
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < best) (best = d), (h = RING.hs[i]);
  });
  return h;
}

// ---------------------------------------------------------------- base lines

/** A highway's straight base line, before it's given its curves. */
interface Line { ax: number; az: number; ux: number; uz: number; len: number; spur: boolean }

/**
 * Line k of each direction sits at SPACING·(k + phase) from the middle. The normals
 * sum to zero, so three lines meet at one point only if their offsets sum to zero —
 * and phases (½, 0, 0) make every sum an odd multiple of SPACING/2.
 */
const FAMILY_PHASE = [0.5, 0, 0];
/**
 * Places in the middle highways must keep out of (with a margin): the cities with the
 * harbour, the track, the park, Thunder Mountain with its lake, and Beacon Hill.
 */
const KEEP_OUT = [
  { x0: -1600, x1: 1680, z0: -660, z1: 660 }, // Boston, harbour, highway, NYC
  { x0: -260, x1: 260, z0: -890, z1: -660 }, // dirt track
  { x0: 540, x1: 880, z0: -1100, z1: -720 }, // Thunder Mountain and lake
  { x0: -180, x1: 200, z0: 660, z1: 1080 }, // demolition park
  { x0: -730, x1: -590, z0: 450, z1: 640 }, // Beacon Hill
].map((b) => ({ x0: b.x0 - 120, x1: b.x1 + 120, z0: b.z0 - 120, z1: b.z1 + 120 }));
/** Spurs from the city ring roads out to the Ring: start point and direction. */
// (Where along each city ring road they start was searched for, so that their crossings
// stay clear of the other interchanges.)
const SPURS: { x: number; z: number; ux: number; uz: number }[] = [
  { x: 1658, z: -200, ux: 1, uz: 0 }, // east, from NYC's ring road
  { x: -700, z: -448, ux: 0, uz: -1 }, // north, from Boston's ring road
  { x: -540, z: 448, ux: 0, uz: 1 }, // south, from Boston's ring road
];
/**
 * Which lines of each direction are built (a third or so of them): enough for every
 * region to have a few highways, with long stretches between interchanges for the
 * curves, and several running through the mountains.
 */
const CHOSEN: Record<number, number[]> = { 0: [1, 3], 1: [2, 4], 2: [-3, 2, 4] };

function baseLines(): Line[] {
  const out: Line[] = [];
  for (const sp of SPURS) out.push({ ax: sp.x, az: sp.z, ux: sp.ux, uz: sp.uz, len: meetRing(sp.x, sp.z, sp.ux, sp.uz, 0), spur: true });
  FAMILY_NORMALS.forEach((angle, fi) => {
    const nx = Math.cos(angle), nz = Math.sin(angle);
    const ux = -nz, uz = nx;
    for (let k = -6; k <= 6; k++) {
      const c = SPACING * (k + FAMILY_PHASE[fi]);
      if (Math.abs(c) > RING_APOTHEM - 450) continue;
      // Lines may cut across the empty corners of the middle, but not the places in it.
      let blocked = false;
      for (let t = -7000; t <= 7000 && !blocked; t += 40) {
        const x = nx * c + ux * t, z = nz * c + uz * t;
        if (KEEP_OUT.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)) blocked = true;
      }
      if (blocked) continue;
      // Start where the line enters the Ring, end where it meets it again.
      const px = nx * c - ux * 8000, pz = nz * c - uz * 8000;
      const t0 = meetRing(px, pz, ux, uz, 0);
      const t1 = meetRing(px, pz, ux, uz, t0 + 1);
      if (!isFinite(t1)) continue;
      const line = { ax: px + ux * t0, az: pz + uz * t0, ux, uz, len: t1 - t0, spur: false };
      if (CHOSEN[fi].includes(k)) out.push(line);
    }
  });
  return out;
}

/** Where two straight lines cross (distances along each), if within both. */
function lineCross(a: Line, b: Line) {
  const den = a.ux * b.uz - a.uz * b.ux;
  if (Math.abs(den) < 0.2) return null; // parallel
  const dx = b.ax - a.ax, dz = b.az - a.az;
  const sa = (dx * b.uz - dz * b.ux) / den, sb = (dx * a.uz - dz * a.ux) / den;
  if (sa < 0 || sa > a.len || sb < 0 || sb > b.len) return null;
  return { sa, sb };
}

// ---------------------------------------------------------------- curves

/**
 * A highway along a base line, swinging from side to side between its interchanges:
 * two slow waves added together, faded out near every crossing, near its ends, near
 * the middle of the map and near the Ring. Wider in the mountains.
 */
function curvedLine(l: Line, crossAt: number[], amp: number, seed: number) {
  const rng = mulberry32(seed);
  const ph1 = rng() * 6.283, ph2 = rng() * 6.283;
  const lam1 = 2500 + rng() * 800, lam2 = 1200 + rng() * 400;
  const FINE = 5;
  const n = Math.ceil(l.len / FINE);
  const fine: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.min(l.len, i * FINE);
    const bx = l.ax + l.ux * t, bz = l.az + l.uz * t;
    let w = l.spur ? 0 : amp;
    if (w > 0) {
      w *= smoothstep(STRAIGHT_NEAR, CURVE_IN, t) * smoothstep(STRAIGHT_NEAR, CURVE_IN, l.len - t);
      w *= smoothstep(200, 900, outsideCore(bx, bz)) * (1 - smoothstep(RING_APOTHEM - 1100, RING_APOTHEM - 500, hexDistance(bx, bz)));
      for (const sc of crossAt) w *= smoothstep(STRAIGHT_NEAR, CURVE_IN, Math.abs(t - sc));
    }
    const A = w * lerp(260, 470, mountainWeight(bx, bz));
    const off = A * (0.68 * Math.sin((6.283 * t) / lam1 + ph1) + 0.32 * Math.sin((6.283 * t) / lam2 + ph2));
    fine.push([bx - l.uz * off, bz + l.ux * off]);
  }
  // Re-space the points evenly along the curve.
  const cum = [0];
  for (let i = 1; i < fine.length; i++) cum.push(cum[i - 1] + Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]));
  const len = cum[cum.length - 1];
  const pts: Vec2[] = [], dirs: Vec2[] = [];
  let j = 0;
  const count = Math.ceil(len / PROFILE_STEP) + 1;
  for (let k = 0; k < count; k++) {
    const s = Math.min(len, k * PROFILE_STEP);
    while (j < fine.length - 2 && cum[j + 1] < s) j++;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    pts.push([lerp(fine[j][0], fine[j + 1][0], f), lerp(fine[j][1], fine[j + 1][1], f)]);
    const a = fine[Math.max(0, j - 1)], b = fine[Math.min(fine.length - 1, j + 2)];
    const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    dirs.push([(b[0] - a[0]) / dl, (b[1] - a[1]) / dl]);
  }
  return { pts, dirs, len };
}

/** Every point where two polylines cross: distances along each, and the crossing's sine. */
function polyCrossings(a: { pts: Vec2[] }, b: { pts: Vec2[] }) {
  const out: { x: number; z: number; sa: number; sb: number; sin: number }[] = [];
  const A = bbox(a.pts), B = bbox(b.pts);
  if (A.x1 < B.x0 || B.x1 < A.x0 || A.z1 < B.z0 || B.z1 < A.z0) return out;
  for (let i = 0; i < a.pts.length - 1; i++) {
    const [p, q] = [a.pts[i], a.pts[i + 1]];
    const minx = Math.min(p[0], q[0]), maxx = Math.max(p[0], q[0]), minz = Math.min(p[1], q[1]), maxz = Math.max(p[1], q[1]);
    if (maxx < B.x0 || minx > B.x1 || maxz < B.z0 || minz > B.z1) continue;
    for (let j = 0; j < b.pts.length - 1; j++) {
      const [r, t] = [b.pts[j], b.pts[j + 1]];
      if (Math.max(r[0], t[0]) < minx || Math.min(r[0], t[0]) > maxx || Math.max(r[1], t[1]) < minz || Math.min(r[1], t[1]) > maxz) continue;
      const ex = q[0] - p[0], ez = q[1] - p[1], fx = t[0] - r[0], fz = t[1] - r[1];
      const den = ex * fz - ez * fx;
      if (Math.abs(den) < 1e-9) continue;
      const dx = r[0] - p[0], dz = r[1] - p[1];
      const u = (dx * fz - dz * fx) / den, v = (dx * ez - dz * ex) / den;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const le = Math.hypot(ex, ez), lf = Math.hypot(fx, fz);
      out.push({ x: p[0] + ex * u, z: p[1] + ez * u, sa: i * PROFILE_STEP + u * le, sb: j * PROFILE_STEP + v * lf, sin: Math.abs(den) / (le * lf) });
    }
  }
  return out;
}

/** Closest the two polylines come to each other away from where they cross (m). */
function nearMiss(a: { pts: Vec2[] }, b: { pts: Vec2[] }, crossings: { x: number; z: number }[]) {
  let best = Infinity;
  const B = bbox(b.pts), M = 200;
  for (let i = 0; i < a.pts.length; i += 2) {
    const [x, z] = a.pts[i];
    if (x < B.x0 - M || x > B.x1 + M || z < B.z0 - M || z > B.z1 + M) continue;
    if (crossings.some((c) => Math.hypot(c.x - x, c.z - z) < 420)) continue;
    for (let j = 0; j < b.pts.length; j += 2) {
      const d = Math.hypot(b.pts[j][0] - x, b.pts[j][1] - z);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Give the base lines their curves, gentler on any whose curves would run into another
 * highway (crossing it a second time, or passing too close), until none do.
 */
function makeNetwork() {
  const lines = baseLines();
  const crossAt: number[][] = lines.map(() => []);
  const expected = new Map<string, number>();
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const c = lineCross(lines[i], lines[j]);
      expected.set(`${i},${j}`, c ? 1 : 0);
      if (c) crossAt[i].push(c.sa), crossAt[j].push(c.sb);
    }
  const amps = lines.map(() => 1);
  const curves = lines.map((l, i) => curvedLine(l, crossAt[i], amps[i], 1000 + i * 37));
  let changed = new Set(lines.map((_, i) => i));
  for (let round = 0; round < 8; round++) {
    const bad = new Set<number>();
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++) {
        if (!changed.has(i) && !changed.has(j)) continue;
        const cs = polyCrossings(curves[i], curves[j]);
        // Spurs start on a city ring road; lines through the middle may touch them there.
        if (cs.length !== expected.get(`${i},${j}`) || cs.some((c) => c.sin < 0.8) || nearMiss(curves[i], curves[j], cs) < 2 * HW + 90) {
          if (amps[i] > 0) bad.add(i);
          if (amps[j] > 0) bad.add(j);
        }
      }
    // No bend tighter than a gentle highway curve.
    curves.forEach((c, i) => {
      if (amps[i] > 0 && tightestRadius(c.pts) < 230) bad.add(i);
    });
    if (!bad.size) break;
    changed = bad;
    for (const i of bad) {
      amps[i] = round >= 6 ? 0 : amps[i] * 0.8;
      curves[i] = curvedLine(lines[i], crossAt[i], amps[i], 1000 + i * 37);
    }
  }
  return lines.map((l, i) => ({ ...curves[i], spur: l.spur }));
}

// ---------------------------------------------------------------- highways and interchanges

/** 0..1 shape of the upper highway's climb over a bridge. */
const HUMP_RAMP = 280;
const hump = (d: number, flat: number) => (d < flat ? 1 : 1 - smoothstep(flat, flat + HUMP_RAMP, d));
/** Road kept level for this far either side of an interchange. */
const PIN = 250;

/** Position and direction a distance `s` along a highway (carried on straight past its ends). */
export function pointAt(h: Highway, s: number) {
  const n = h.pts.length;
  if (s <= 0 || s >= h.len) {
    const k = s <= 0 ? 0 : n - 1, e = s <= 0 ? s : s - h.len;
    const [ux, uz] = h.dirs[k];
    return { x: h.pts[k][0] + ux * e, z: h.pts[k][1] + uz * e, ux, uz };
  }
  const k = Math.min(n - 2, Math.floor(s / PROFILE_STEP));
  const s0 = k * PROFILE_STEP, s1 = Math.min(h.len, (k + 1) * PROFILE_STEP);
  const f = (s - s0) / (s1 - s0 || 1);
  const [a, b] = [h.pts[k], h.pts[k + 1]], [da, db] = [h.dirs[k], h.dirs[k + 1]];
  const ux = lerp(da[0], db[0], f), uz = lerp(da[1], db[1], f), ul = Math.hypot(ux, uz) || 1;
  return { x: lerp(a[0], b[0], f), z: lerp(a[1], b[1], f), ux: ux / ul, uz: uz / ul };
}

/** The spot `d` m to the side of a highway (positive = to the left of travel, i.e. (−uz, ux)), `s` along it. */
export function besideHighway(h: Highway, s: number, d: number): Vec2 {
  const p = pointAt(h, s);
  return [p.x - p.uz * d, p.z + p.ux * d];
}

/** Road height of highway `h` at distance `s` along it. */
export function profileAt(h: Highway, s: number) {
  const f = clamp(s / PROFILE_STEP, 0, h.profile.length - 1);
  const k = Math.min(h.profile.length - 2, Math.floor(f));
  return lerp(h.profile[k], h.profile[k + 1], f - k);
}

export const HIGHWAYS: Highway[] = makeNetwork().map((c, i) => ({ id: i, name: `RT ${i + 1}`, ...c, profile: new Float32Array(0), ...bbox(c.pts) }));

// Highway segments bucketed for fast "where am I relative to this highway" queries.
const HB = 128, HPAD = 220;
const hwBuckets = new Map<number, number[]>(); // id * 65536 + segment
const hbKey = (ix: number, iz: number) => ix * 100003 + iz;
for (const h of HIGHWAYS)
  for (let i = 0; i < h.pts.length - 1; i++) {
    const [a, b] = [h.pts[i], h.pts[i + 1]];
    for (let ix = Math.floor((Math.min(a[0], b[0]) - HPAD) / HB); ix <= Math.floor((Math.max(a[0], b[0]) + HPAD) / HB); ix++)
      for (let iz = Math.floor((Math.min(a[1], b[1]) - HPAD) / HB); iz <= Math.floor((Math.max(a[1], b[1]) + HPAD) / HB); iz++) {
        const k = hbKey(ix, iz);
        let l = hwBuckets.get(k);
        if (!l) hwBuckets.set(k, (l = []));
        l.push(h.id * 65536 + i);
      }
  }

/** Where a point sits relative to segment i of a highway: distance along, signed distance across, distance away. */
function segCoords(h: Highway, i: number, x: number, z: number) {
  const [ax, az] = h.pts[i], [bx, bz] = h.pts[i + 1];
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
  let t = ((x - ax) * dx + (z - az) * dz) / (L * L);
  if (i > 0) t = Math.max(0, t);
  if (i < h.pts.length - 2) t = Math.min(1, t);
  const across = (-(x - ax) * dz + (z - az) * dx) / L;
  const away = Math.hypot(x - ax - dx * t, z - az - dz * t);
  const d = t < 0 || t > 1 ? across : Math.sign(across || 1) * away;
  return { s: i * PROFILE_STEP + t * L, d, away: t < 0 || t > 1 ? Math.abs(across) : away };
}

/**
 * Where a point sits relative to a highway: distance along it, and signed distance
 * across (positive to the left of travel). Beyond the ends it carries on straight.
 */
export function highwayCoords(h: Highway, x: number, z: number) {
  let best = { s: 0, d: Infinity, away: Infinity };
  const cands = hwBuckets.get(hbKey(Math.floor(x / HB), Math.floor(z / HB)));
  let found = false;
  if (cands)
    for (const e of cands) {
      if (e >> 16 !== h.id) continue;
      found = true;
      const c = segCoords(h, e & 0xffff, x, z);
      if (c.away < best.away) best = c;
    }
  if (!found) for (let i = 0; i < h.pts.length - 1; i++) {
    const c = segCoords(h, i, x, z);
    if (c.away < best.away) best = c;
  }
  return { s: best.s, d: best.d };
}

const nearBest = new Float64Array(64 * 3);
const nearSeen: number[] = [];
/** Calls `f` for each highway within ~200 m of a point, with where the point sits relative to it. */
export function forNearHighways(x: number, z: number, f: (h: Highway, s: number, d: number) => void) {
  const cands = hwBuckets.get(hbKey(Math.floor(x / HB), Math.floor(z / HB)));
  if (!cands) return;
  nearSeen.length = 0;
  for (const e of cands) {
    const id = e >> 16;
    const c = segCoords(HIGHWAYS[id], e & 0xffff, x, z);
    let slot = nearSeen.indexOf(id);
    if (slot < 0) {
      slot = nearSeen.length;
      nearSeen.push(id);
      nearBest[slot * 3 + 2] = Infinity;
    }
    if (c.away < nearBest[slot * 3 + 2]) (nearBest[slot * 3] = c.s), (nearBest[slot * 3 + 1] = c.d), (nearBest[slot * 3 + 2] = c.away);
  }
  const ids = nearSeen.slice();
  ids.forEach((id, slot) => f(HIGHWAYS[id], nearBest[slot * 3], nearBest[slot * 3 + 1]));
}

function findCrossings(): Crossing[] {
  const out: Crossing[] = [];
  for (let i = 0; i < HIGHWAYS.length; i++)
    for (let j = i + 1; j < HIGHWAYS.length; j++) {
      const a = HIGHWAYS[i], b = HIGHWAYS[j];
      for (const c of polyCrossings(a, b)) {
        // (Crossings right next to the Ring stay level: just a flat junction.)
        if (c.sa < 650 || c.sa > a.len - 650 || c.sb < 650 || c.sb > b.len - 650) continue;
        // Level the interchange to the average lie of the land along both highways
        // (so in the mountains it sits on the valley floor, not halfway up a peak).
        let h0 = 0, n = 0;
        for (const [h, s] of [[a, c.sa], [b, c.sb]] as const)
          for (let o = -800; o <= 800; o += 100) {
            const p = pointAt(h, s + o);
            h0 += terrainBase(p.x, p.z);
            n++;
          }
        out.push({ x: c.x, z: c.z, upper: j, lower: i, sUpper: c.sb, sLower: c.sa, h0: h0 / n, sin: c.sin, flat: Math.max(45, (HW + 12) / c.sin + 20) });
      }
    }
  return out;
}

/**
 * Neighbouring interchanges along a highway must be close enough in height for the
 * road between them to stay under MAX_GRADE: nudge them together until they are.
 */
function settleInterchanges(crossings: Crossing[]) {
  // Each highway's ends are fixed too: the Ring's height, or (for a spur) level with the city.
  const ends = HIGHWAYS.map((h) => {
    const out: { s: number; h0: number; pin: number }[] = [{ s: h.len, h0: ringHeight(...h.pts[h.pts.length - 1]), pin: 0 }];
    if (!h.spur) out.push({ s: 0, h0: ringHeight(...h.pts[0]), pin: 0 });
    else {
      let k = 0;
      while (k < h.pts.length - 1 && outsideWorld(...h.pts[k + 1]) < -300) k++;
      out.push({ s: k * PROFILE_STEP, h0: 0, pin: 0 });
    }
    return out;
  });
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (const l of HIGHWAYS) {
      type P = { s: number; h0: number; pin: number; c?: Crossing };
      const mine: P[] = crossings.filter((c) => c.upper === l.id || c.lower === l.id).map((c) => ({ s: c.upper === l.id ? c.sUpper : c.sLower, h0: c.h0, pin: PIN, c }));
      mine.push(...ends[l.id]);
      mine.sort((a, b) => a.s - b.s);
      for (let i = 1; i < mine.length; i++) {
        const a = mine[i - 1], b = mine[i];
        const gap = b.s - a.s - a.pin - b.pin - 60;
        const allowed = Math.max(0, gap) * MAX_GRADE * 0.8;
        const diff = b.h0 - a.h0;
        if (Math.abs(diff) > allowed + 0.01) {
          const excess = (Math.abs(diff) - allowed) * Math.sign(diff);
          // Ends don't move: the interchange takes all of it.
          const fa = a.c ? (b.c ? 0.5 : 1) : 0, fb = b.c ? (a.c ? 0.5 : 1) : 0;
          if (a.c) a.c.h0 += excess * fa;
          if (b.c) b.c.h0 -= excess * fb;
          a.h0 = a.c ? a.c.h0 : a.h0;
          b.h0 = b.c ? b.c.h0 : b.h0;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

function makeProfile(h: Highway, crossings: Crossing[]) {
  const n = h.pts.length;
  const at = (k: number) => h.pts[k];
  const mine = crossings.filter((c) => c.upper === h.id || c.lower === h.id).map((c) => ({ c, s: c.upper === h.id ? c.sUpper : c.sLower }));
  const endH = ringHeight(...at(n - 1)), startH = h.spur ? 0 : ringHeight(...at(0));
  // Pinned heights: level at each interchange, meeting the Ring (or the city) at the ends.
  const fixed = (k: number) => {
    const s = k * PROFILE_STEP;
    for (const { c, s: sc } of mine) if (Math.abs(s - sc) < PIN) return c.h0;
    if (k === n - 1 || s > h.len - 40) return endH;
    if (k === 0 || s < 40) return startH;
    if (h.spur && outsideWorld(...at(k)) < -300) return 0;
    return null;
  };
  const shaped = shapeProfile(Array.from({ length: n }, (_, k) => terrainBase(...at(k))), 12, PROFILE_STEP, fixed);
  // Round off the kinks where a level stretch meets a slope (fast cars would hop there).
  // ±100 m is less than the level stretch at each interchange, so those stay level.
  const p = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0, c = 0;
    for (let j = Math.max(0, k - 4); j <= Math.min(n - 1, k + 4); j++) (sum += shaped[j]), c++;
    p[k] = k === 0 || k === n - 1 ? shaped[k] : sum / c;
  }
  // Bridges: the upper highway climbs over the lower one (one climb where two are close).
  for (let k = 0; k < n; k++) {
    let up = 0;
    for (const { c, s: sc } of mine) if (c.upper === h.id) up = Math.max(up, hump(Math.abs(k * PROFILE_STEP - sc), c.flat));
    p[k] += OVERPASS_RISE * up;
  }
  return p;
}

export const CROSSINGS: Crossing[] = [];
{
  // The mountains make valleys along the roads, so they must know where the roads are
  // before anything asks how high the land is.
  setCorridors([...HIGHWAYS.map((h) => ({ pts: h.pts, closed: false })), { pts: RING.pts, closed: true }]);
  RING.hs = Array.from(shapeProfile(RING.pts.map(([x, z]) => terrainBase(x, z)), 16, PROFILE_STEP));
  CROSSINGS.push(...findCrossings());
  settleInterchanges(CROSSINGS);
  for (const h of HIGHWAYS) h.profile = makeProfile(h, CROSSINGS);
  // Where a lower highway is itself climbing over a nearby bridge, lift the upper one
  // a bit more so every bridge still has full headroom.
  for (const c of CROSSINGS) {
    const U = HIGHWAYS[c.upper];
    const short = profileAt(HIGHWAYS[c.lower], c.sLower) + OVERPASS_RISE - profileAt(U, c.sUpper);
    if (short <= 0) continue;
    for (let k = 0; k < U.profile.length; k++) U.profile[k] += short * hump(Math.abs(k * PROFILE_STEP - c.sUpper), c.flat);
  }
}

// ---------------------------------------------------------------- ramps

/** Ramps join the lower highway this far from the crossing. */
const RAMP_LOWER = 190;

function rampCandidates(): CurveRoad[] {
  const out: CurveRoad[] = [];
  for (const c of CROSSINGS) {
    const U = HIGHWAYS[c.upper], L = HIGHWAYS[c.lower];
    // Both highways run straight near the crossing: work in their directions there.
    const fu = pointAt(U, c.sUpper), fl = pointAt(L, c.sLower);
    const Ux = fu.ux, Uz = fu.uz, Lx = fl.ux, Lz = fl.uz;
    const sOnU = (x: number, z: number) => c.sUpper + (x - c.x) * Ux + (z - c.z) * Uz;
    const sOnL = (x: number, z: number) => c.sLower + (x - c.x) * Lx + (z - c.z) * Lz;
    // Leave the upper highway well before its climb to the bridge.
    const dU = c.flat + HUMP_RAMP + 90;
    for (const sa of [-1, 1])
      for (const sb of [-1, 1]) {
        // Which side of each highway this corner is on.
        const sideU = Math.sign((-Uz * Lx + Ux * Lz) * sb);
        const sideL = Math.sign((-Lz * Ux + Lx * Uz) * sa);
        const p1: Vec2 = [c.x + Ux * sa * dU - Uz * sideU * (HW - 3), c.z + Uz * sa * dU + Ux * sideU * (HW - 3)];
        // How far the ramp has to turn: sharp corners (two highways at 60°) need a 120°
        // turn, so they start and end further out to leave room for a gentle curve.
        const turn = Math.acos(Math.max(-1, Math.min(1, -(Ux * sa * Lx * sb + Uz * sa * Lz * sb))));
        const dL = turn > Math.PI / 2 ? RAMP_LOWER * 1.9 : RAMP_LOWER;
        const p2: Vec2 = [c.x + Lx * sb * dL - Lz * sideL * (HW - 3), c.z + Lz * sb * dL + Lx * sideL * (HW - 3)];
        // A smooth S: it leaves running alongside the upper highway (heading towards the
        // crossing) and arrives running alongside the lower one (heading away from it),
        // like a real exit and entrance, rather than turning off at an angle.
        // Curve handles: long enough for a gentle turn, never reaching back towards the bridge.
        const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * (turn > Math.PI / 2 ? 0.6 : 0.42);
        const h1 = Math.min(chord, dU * 0.5), h2 = Math.min(chord, dL * 0.5);
        const k1: Vec2 = [p1[0] - Ux * sa * h1, p1[1] - Uz * sa * h1];
        const k2: Vec2 = [p2[0] - Lx * sb * h2, p2[1] - Lz * sb * h2];
        const pts: Vec2[] = [], hs: number[] = [];
        const N = 36;
        for (let i = 0; i <= N; i++) {
          const t = i / N, mt = 1 - t;
          const a = mt * mt * mt, b = 3 * mt * mt * t, cc = 3 * mt * t * t, d = t * t * t;
          pts.push([a * p1[0] + b * k1[0] + cc * k2[0] + d * p2[0], a * p1[1] + b * k1[1] + cc * k2[1] + d * p2[1]]);
          // Follow each highway's own height while alongside it (the upper one may already be
          // climbing to its bridge), easing from one to the other in between.
          const [x, z] = pts[pts.length - 1];
          hs.push(lerp(profileAt(U, sOnU(x, z)), profileAt(L, sOnL(x, z)), smoothstep(0.15, 0.85, t)));
        }
        out.push({ kind: 'ramp', pts, hs, hw: RAMP_HW, closed: false, from: U.id, to: L.id, ...bbox(pts) });
      }
  }
  return out;
}

/** The tightest turn along a polyline (radius, m). */
export function tightestRadius(pts: readonly Vec2[]) {
  let min = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    let dh = Math.abs(Math.atan2(c[0] - b[0], c[1] - b[1]) - Math.atan2(b[0] - a[0], b[1] - a[1]));
    if (dh > Math.PI) dh = 2 * Math.PI - dh;
    min = Math.min(min, Math.hypot(c[0] - b[0], c[1] - b[1]) / Math.max(1e-6, dh));
  }
  return min;
}

/** Does a stretch of curved road run into a highway other than the ones it joins? */
function hitsOtherHighway(pts: readonly Vec2[], hw: number, except: number[]) {
  return pts.some(([x, z]) => {
    let hit = false;
    forNearHighways(x, z, (h, s, d) => {
      if (!except.includes(h.id) && Math.abs(d) < HW + hw + 6 && s > -20 && s < h.len + 20) hit = true;
    });
    return hit;
  });
}

/** Ramps that would run into another highway, the Ring or another ramp are left out. */
function makeRamps(): CurveRoad[] {
  const kept: CurveRoad[] = [];
  for (const r of rampCandidates()) {
    const mid = r.pts.slice(2, -2);
    const hitsHighway = hitsOtherHighway(mid, RAMP_HW, [r.from, r.to]);
    const hitsRing = mid.some(([x, z]) => hexDistance(x, z) > RING_APOTHEM - RING_CORNER * 0.2 - 40);
    // Gentle enough to drive at speed, and clear of the bridge (pillars, abutments).
    const cr = CROSSINGS.find((k) => k.upper === r.from && k.lower === r.to && Math.hypot(k.x - r.pts[0][0], k.z - r.pts[0][1]) < 900)!;
    const tooClose = r.pts.some(([x, z]) => Math.hypot(x - cr.x, z - cr.z) < (HW + 11) / cr.sin + 40);
    const tooTight = tightestRadius(r.pts) < 45;
    if (tooClose || tooTight) continue;
    const hitsRamp = kept.some((o) => o.x0 < r.x1 + 20 && o.x1 > r.x0 - 20 && o.z0 < r.z1 + 20 && o.z1 > r.z0 - 20 &&
      r.pts.some(([x, z]) => o.pts.some(([ox, oz]) => Math.hypot(ox - x, oz - z) < RAMP_HW * 2 + 6)));
    if (!hitsHighway && !hitsRing && !hitsRamp) kept.push(r);
  }
  return kept;
}
export const RAMPS: CurveRoad[] = makeRamps();

// ---------------------------------------------------------------- towns

/**
 * Towns out in highway country, each on level ground with its own streets:
 * Mariano-ville, a New England town in the autumn woods; Alexander-ville, a farm town
 * at the foot of the mountains (both just off a highway, a loop road leaving it,
 * running along the front of town and coming back on); and Washington DC, a city in
 * the desert with roads in from three highways. Positions in a town are given in its
 * own coordinates: `a` along (ux, uz) and `b` across, towards `side`. For the towns off
 * a highway `a` runs along the highway and `b` away from it; in DC `a` is east and `b`
 * south.
 */
export interface Town {
  name: string;
  kind: 'mariano' | 'alexander' | 'dc' | 'pad';
  x: number;
  z: number;
  ux: number;
  uz: number;
  /** +1: `b` is to the left of (ux, uz) (with +x east, +z south, that's clockwise). */
  side: number;
  /** Ground level of the town. */
  level: number;
  /** The highway it's built off and where along it (DC: −1, 0). */
  hw: number;
  s: number;
  /** The main road in: the loop off the highway and back (DC: the road in from the west). */
  road: CurveRoad;
  /** Every road in town, the ones in from the highways included. */
  roads: CurveRoad[];
  /** Where the roads into town leave a highway (for the exit signs). */
  exits: TownExit[];
  /** The level part, in town coordinates (plus any `annex`), and how far the land takes to blend back. */
  area: TownArea;
  annex?: TownArea;
  blend: number;
}
export interface TownArea { a0: number; a1: number; b0: number; b1: number }
/** A road into town leaving a highway: where, which side, and the direction of travel that can take it. */
export interface TownExit { hw: number; x: number; z: number; s: number; side: number; dir: number }

/** Main Street runs this far from the highway's centre line (Mariano-ville). */
export const MAIN_ST = 175;
/** Where the loop road leaves and rejoins the highway (along it, ± from the middle). */
const TOWN_EXIT = 470;

/** A spot in town: `a` along, `b` across. */
export function townPoint(t: Town, a: number, b: number): Vec2 {
  return [t.x + t.ux * a - t.uz * t.side * b, t.z + t.uz * a + t.ux * t.side * b];
}

/** Where a spot is in a town's own coordinates. */
export function townCoords(t: Town, x: number, z: number) {
  const dx = x - t.x, dz = z - t.z;
  return { a: dx * t.ux + dz * t.uz, b: (-dx * t.uz + dz * t.ux) * t.side };
}

/** How far a spot is outside a town's level area (0 inside). */
export function townDistance(t: Town, x: number, z: number) {
  const { a, b } = townCoords(t, x, z);
  const out = (r: TownArea) => Math.hypot(Math.max(0, r.a0 - a, a - r.a1), Math.max(0, r.b0 - b, b - r.b1));
  return t.annex ? Math.min(out(t.area), out(t.annex)) : out(t.area);
}

/** A cubic Bézier from p1 to p2 (n + 1 points). */
function bezier(p1: Vec2, k1: Vec2, k2: Vec2, p2: Vec2, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, m = 1 - u;
    const a = m * m * m, b = 3 * m * m * u, c = 3 * m * u * u, d = u * u * u;
    out.push([a * p1[0] + b * k1[0] + c * k2[0] + d * p2[0], a * p1[1] + b * k1[1] + c * k2[1] + d * p2[1]]);
  }
  return out;
}

/** A level street through town points (a, b), with a point at least every 25 m. */
function street(t: Town, pts: [number, number][], hw = TOWN_HW, look: CurveRoad['look'] = 'street'): CurveRoad {
  const w: Vec2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a0, b0] = pts[i], [a1, b1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(a1 - a0, b1 - b0) / 25));
    for (let k = 0; k < n; k++) w.push(townPoint(t, a0 + ((a1 - a0) * k) / n, b0 + ((b1 - b0) * k) / n));
  }
  w.push(townPoint(t, ...pts[pts.length - 1]));
  return { kind: 'town', pts: w, hs: w.map(() => t.level), hw, closed: false, from: -1, to: -1, look, ...bbox(w) };
}

/**
 * The loop road: off the highway, a gentle S out to the front street (`mainB` from the
 * highway), along it for ±`half`, and back on again.
 */
function loopRoad(t: Town, mainB: number, half: number): CurveRoad {
  const h = HIGHWAYS[t.hw];
  const pts: Vec2[] = [], hs: number[] = [];
  // (From the highway's own height beside each point, so the road doesn't float over
  // the highway's ground where it runs alongside it, easing to the town's.)
  const bez = (p1: Vec2, k1: Vec2, k2: Vec2, p2: Vec2, fromHighway: boolean) =>
    bezier(p1, k1, k2, p2, 26).forEach((p, i) => {
      const hh = profileAt(h, highwayCoords(h, p[0], p[1]).s);
      pts.push(p);
      hs.push(lerp(hh, t.level, smoothstep(0.1, 0.9, fromHighway ? i / 26 : 1 - i / 26)));
    });
  // (The ends sit on the highway's edge, running along it.)
  const edge = (ss: number, dir: number): [Vec2, Vec2] => {
    const q = pointAt(h, ss), e = besideHighway(h, ss, t.side * (HW - 3));
    return [e, [e[0] + q.ux * dir * 150, e[1] + q.uz * dir * 150]];
  };
  const [in0, in1] = edge(t.s - TOWN_EXIT, 1), [out0, out1] = edge(t.s + TOWN_EXIT, -1);
  bez(in0, in1, townPoint(t, -half - 120, mainB), townPoint(t, -half, mainB), true);
  for (let i = 1; i < 18; i++) {
    pts.push(townPoint(t, -half + (2 * half * i) / 18, mainB));
    hs.push(t.level);
  }
  bez(townPoint(t, half, mainB), townPoint(t, half + 120, mainB), out1, out0, false);
  return { kind: 'town', pts, hs, hw: TOWN_HW, closed: false, from: h.id, to: h.id, look: 'street', ...bbox(pts) };
}

/**
 * Roads into a town from the highway its edge street faces: from `end` (on the town's
 * edge, world coordinates) straight out along −`inward` to the nearest highway, where
 * the road splits in two, one branch joining the highway each way, like a real exit.
 * Heights are filled in later (`fillLink`), once the town's level is known.
 */
function linkRoads(end: Vec2, inward: Vec2): CurveRoad[] {
  let hit: { h: Highway; s: number } | null = null;
  for (let t = 20; t < 2000 && !hit; t += 10) {
    const x = end[0] - inward[0] * t, z = end[1] - inward[1] * t;
    forNearHighways(x, z, (h, s, d) => {
      if (!hit && Math.abs(d) < HW && s > 0 && s < h.len) hit = { h, s };
    });
  }
  if (!hit) return [];
  const { h } = hit as { h: Highway; s: number };
  const c = highwayCoords(h, end[0], end[1]);
  const L = Math.abs(c.d), side = Math.sign(c.d);
  const D = clamp(L * 0.8, 220, 420);
  // Where it splits: as straight out as possible, but with both branches clear of the
  // highway's ends and of interchanges (their ramps).
  const busy = CROSSINGS.filter((k) => k.upper === h.id || k.lower === h.id).map((k) => (k.upper === h.id ? k.sUpper : k.sLower));
  const ok = (s: number) => s - D > 150 && s + D < h.len - 150 && busy.every((sc) => Math.abs(sc - s) > D + 520);
  let s0 = c.s;
  for (let k = 0; k < 400 && !ok(s0); k++) s0 = c.s + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 10;
  if (!ok(s0)) return [];
  return [1, -1].map((dir) => {
    const s1 = s0 - dir * D;
    const q = pointAt(h, s1);
    const p1 = besideHighway(h, s1, side * (HW - 3));
    const k1: Vec2 = [p1[0] + q.ux * dir * D * 0.55, p1[1] + q.uz * dir * D * 0.55];
    const k2: Vec2 = [end[0] - inward[0] * L * 0.5, end[1] - inward[1] * L * 0.5];
    const pts = bezier(p1, k1, k2, end, 40);
    return { kind: 'town', pts, hs: [], hw: RAMP_HW, closed: false, from: h.id, to: h.id, look: 'street', ...bbox(pts) } as CurveRoad;
  });
}

/** Heights for a road in: the highway's own height while alongside it, easing to the town's. */
function fillLink(r: CurveRoad, level: number) {
  const h = HIGHWAYS[r.from], L = roadLength(r.pts);
  let run = 0, hh = 0;
  r.hs = r.pts.map(([x, z], i) => {
    if (i) run += Math.hypot(x - r.pts[i - 1][0], z - r.pts[i - 1][1]);
    // (Once well away from the highway, the nearest point on it can jump about: keep the last height.)
    const c = highwayCoords(h, x, z);
    if (i === 0 || Math.abs(c.d) < HW + 60) hh = profileAt(h, c.s);
    return lerp(hh, level, smoothstep(0.1, 0.9, run / L));
  });
}

const roadLength = (pts: readonly Vec2[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/** The ends of a town's roads that sit on a highway's edge. */
function exitsOf(roads: CurveRoad[]): TownExit[] {
  const out: TownExit[] = [];
  for (const r of roads)
    for (const end of [0, r.pts.length - 1]) {
      const [x, z] = r.pts[end], next = r.pts[end === 0 ? 1 : end - 1];
      forNearHighways(x, z, (h, s, d) => {
        if (Math.abs(Math.abs(d) - (HW - 3)) > 2 || s < 0 || s > h.len) return;
        const p = pointAt(h, s);
        out.push({ hw: h.id, x, z, s, side: Math.sign(d), dir: Math.sign((next[0] - x) * p.ux + (next[1] - z) * p.uz) });
      });
    }
  return out;
}

/**
 * The best spot off a highway for a town reaching `depth` m from it: `score` rates a
 * spot (null: no good). Clear of interchanges, other highways, the Ring and other towns.
 */
function findSpot(depth: number, score: (h: Highway, s: number, side: number, level: number) => number | null, avoid: Town[]) {
  let best: { score: number; h: Highway; s: number; side: number } | null = null;
  for (const h of HIGHWAYS) {
    if (h.spur) continue;
    for (let s = 1200; s < h.len - 1200; s += 50) {
      const p = pointAt(h, s);
      if (CROSSINGS.some((c) => (c.upper === h.id && Math.abs(c.sUpper - s) < 950) || (c.lower === h.id && Math.abs(c.sLower - s) < 950))) continue;
      const level = Math.abs(profileAt(h, s + TOWN_EXIT) - profileAt(h, s - TOWN_EXIT));
      if (level > 20) continue;
      for (const side of [-1, 1]) {
        const sc = score(h, s, side, level);
        if (sc === null || (best && sc <= best.score)) continue;
        // Nothing else within reach of the town (the road along its far side included).
        let clear = true;
        for (const [a, bb] of [[0, 260], [-260, 200], [260, 200], [0, depth + 120], [-300, depth + 20], [300, depth + 20]]) {
          const q: Vec2 = [p.x + p.ux * a - p.uz * side * bb, p.z + p.uz * a + p.ux * side * bb];
          forNearHighways(q[0], q[1], (o, os, od) => {
            if (o !== h && Math.abs(od) < 200 && os > -50 && os < o.len + 50) clear = false;
          });
          if (hexDistance(q[0], q[1]) > RING_APOTHEM - 300) clear = false;
          if (avoid.some((t) => townDistance(t, q[0], q[1]) < 900)) clear = false;
        }
        const cx = p.x - p.uz * side * 260, cz = p.z + p.ux * side * 260;
        if (RAMPS.some((r) => r.pts.some(([x, z]) => Math.hypot(x - cx, z - cz) < 650))) clear = false;
        if (clear) best = { score: sc, h, s, side };
      }
    }
  }
  return best;
}

/** A town off highway `h` at `s`, on `side`: its frame and level (roads come after). */
function townOff(name: string, kind: Town['kind'], h: Highway, s: number, side: number, area: Town['area']): Town {
  const p = pointAt(h, s);
  const level = (profileAt(h, s - TOWN_EXIT) + profileAt(h, s + TOWN_EXIT) + profileAt(h, s)) / 3;
  return { name, kind, x: p.x, z: p.z, ux: p.ux, uz: p.uz, side, level, hw: h.id, s, road: null!, roads: [], exits: [], area, blend: 160 };
}

/**
 * Mariano-ville: Main Street (the loop road) along the front, the town green behind it
 * with a street down each side, Church Street across the top, and Maple and Oak Streets
 * out at the ends; and up a drive from the end of Church Street, Mariano Mansion.
 */
function makeMariano(): Town | null {
  const spot = findSpot(400, (h, s, side, level) => {
    const p = pointAt(h, s);
    const b = biomeAt(p.x - p.uz * side * 260, p.z + p.ux * side * 260);
    const score = b.forest * b.autumn - level * 0.01;
    return score < 0.6 ? null : score;
  }, []);
  if (!spot) return null;
  const t = townOff('Mariano-ville', 'mariano', spot.h, spot.s, spot.side, { a0: -300, a1: 300, b0: 95, b1: 400 });
  t.road = loopRoad(t, MAIN_ST, 230);
  const church = CHURCH_ST, M = MANSION;
  t.roads = [
    t.road,
    street(t, [[-123, MAIN_ST], [-123, church]]),
    street(t, [[123, MAIN_ST], [123, church]]),
    street(t, [[-230, church], [230, church]]),
    street(t, [[-230, MAIN_ST], [-230, church]]),
    street(t, [[230, MAIN_ST], [230, church]]),
    // Up to Mariano Mansion: the drive, and round the carriage circle in front of the house.
    street(t, [[M.a, church], [M.a, M.circle - M.r]], M.hw),
    street(t, Array.from({ length: 25 }, (_, i): [number, number] => {
      const ang = -Math.PI / 2 + (i / 24) * Math.PI * 2;
      return [M.a + Math.cos(ang) * M.r, M.circle + Math.sin(ang) * M.r];
    }), M.hw),
  ];
  t.annex = { a0: M.a - M.half - 6, a1: M.a + M.half + 6, b0: M.gate - 15, b1: M.back + 6 };
  return t;
}
/** Mariano-ville's town green (town coordinates). */
export const MARIANO_GREEN = { a: 115, b0: MAIN_ST + TOWN_HW + 6, b1: MAIN_ST + TOWN_HW + 106 };
/** Mariano-ville's Church Street. */
export const CHURCH_ST = MARIANO_GREEN.b1 + 16;
/**
 * Mariano Mansion, in the woods behind Mariano-ville (town coordinates): a drive runs
 * straight back at `a` from the end of Church Street, through the gate in the stone wall
 * (at `gate`), to the carriage circle (centre `circle`, radius `r`) in front of the house
 * (its front at `house`). The grounds reach `half` either side of the drive and back to `back`.
 */
export const MANSION = { a: 230, hw: 4.5, gate: 412, circle: 515, r: 20, house: 548, half: 98, back: 618 };

/**
 * Alexander-ville: a farm town out on the plains, the mountains rising close behind it.
 * Front Street (the loop road) along the highway; Main Street straight back from it
 * through a small grid of avenues, with the grain elevator and the railroad behind.
 */
function makeAlexander(avoid: Town[]): Town | null {
  // Every corner of town (the farm out past West Street included) in farmland, well out
  // in it, no mountain in it, but the mountains close by.
  const spot = findSpot(560, (h, s, side, level) => {
    const p = pointAt(h, s);
    const at = (a: number, b: number): Vec2 => [p.x + p.ux * a - p.uz * side * b, p.z + p.uz * a + p.ux * side * b];
    let farm = 1, mtn = 0;
    for (const [a, b] of [[-300, 60], [0, 60], [300, 60], [-300, 330], [0, 330], [300, 330], [-300, 620], [0, 620], [300, 620], [-ALEX.farm.d1, ALEX.farm.b0], [-ALEX.farm.d1, 620]]) {
      const [x, z] = at(a, b);
      farm = Math.min(farm, biomeAt(x, z).farm);
      mtn = Math.max(mtn, mountainWeight(x, z));
    }
    if (farm < 0.85 || mtn > 0.01 || outsideWorld(...at(0, 330)) < 1500) return null;
    let near = 0;
    for (let k = 0; k < 24; k++)
      for (const r of [1000, 1300, 1600]) {
        const [x, z] = at(Math.cos((k / 24) * 6.283) * r, 330 + Math.sin((k / 24) * 6.283) * r);
        near = Math.max(near, mountainWeight(x, z) * (1 - (r - 1000) / 1500));
      }
    return near < 0.5 ? null : near - level * 0.01;
  }, avoid);
  if (!spot) return null;
  const t = townOff('Alexander-ville', 'alexander', spot.h, spot.s, spot.side, { a0: -300, a1: 300, b0: 95, b1: 610 });
  t.annex = { a0: -ALEX.farm.d1 - 20, a1: -280, b0: ALEX.farm.b0 - 20, b1: 610 };
  const F = ALEX.front, [B1, B2, B3] = ALEX.avenues, E = ALEX.edge, Y = ALEX.farm;
  t.road = loopRoad(t, F, E);
  t.roads = [
    t.road,
    street(t, [[0, F], [0, B3]]), // Main Street
    ...ALEX.avenues.map((b) => street(t, [[-E, b], [E, b]])),
    street(t, [[-E, F], [-E, B1], [-E, B2], [-E, B3]]),
    street(t, [[E, F], [E, B1], [E, B2], [E, B3]]),
    // Out to Alexander Acres: the farm lane off West Street, and round the farmyard.
    street(t, [[-E, Y.drive], [-(Y.yard - Y.r), Y.drive]], Y.hw),
    street(t, Array.from({ length: 21 }, (_, i): [number, number] => {
      const ang = (i / 20) * Math.PI * 2;
      return [-Y.yard + Math.cos(ang) * Y.r, Y.drive + Math.sin(ang) * Y.r];
    }), Y.hw),
  ];
  return t;
}
/** Alexander-ville's plan (town coordinates): Front Street, the avenues, the side streets' `a`, the railroad. */
export const ALEX = {
  front: 150, avenues: [260, 370, 480], edge: 220, rail: 565,
  /**
   * Alexander Acres, the farm out past West Street: how far west of Main Street it reaches
   * (d = −a), and its b; the farm lane (at b = `drive`) out to the farmyard, a turning
   * circle (radius `r`) `yard` west of Main Street between the barn and the farmhouse.
   */
  farm: { d0: 300, d1: 540, b0: 330, b1: 590, drive: 400, yard: 400, r: 14, hw: 4.5 },
};

/** Where Washington DC is (its middle) and its streets, in city coordinates (a east, b south). */
const DC_AT: Vec2 = [-3330, 2880];
export const DC_PLAN = {
  /** The edge streets. */
  x0: -470, x1: 470, z0: -330, z1: 330,
  /** The Mall, between Constitution and Independence Avenues, from 23rd Street to 1st Street. */
  mall: { x0: -470, x1: 330, z: 70 },
  monument: [-80, 0] as Vec2,
  lincoln: [-418, 0] as Vec2,
  capitol: [400, 0] as Vec2,
  whiteHouse: [-115, -258] as Vec2,
  basin: { x: -180, z: 200, r: 58 },
  jefferson: [-180, 290] as Vec2,
};
function makeDC(): Town {
  const t: Town = {
    name: 'Washington DC', kind: 'dc', x: DC_AT[0], z: DC_AT[1], ux: 1, uz: 0, side: 1, level: 0, hw: -1, s: 0,
    road: null!, roads: [], exits: [], area: { a0: -500, a1: 500, b0: -360, b1: 360 }, blend: 180,
  };
  const P = DC_PLAN, M = P.mall;
  const S = (pts: [number, number][], hw = 5.5) => street(t, pts, hw, 'street');
  const A = (pts: [number, number][]) => street(t, pts, 7, 'avenue');
  t.roads = [
    S([[P.x0, P.z0], [P.x1, P.z0]]), // H Street
    S([[P.x0, P.z1], [P.x1, P.z1]]), // Maine Avenue
    S([[P.x0, P.z0], [P.x0, P.z1]]), // 23rd Street
    S([[P.x1, P.z0], [P.x1, P.z1]]), // 2nd Street
    A([[M.x0, -M.z], [M.x1, -M.z]]), // Constitution Avenue
    A([[M.x0, M.z], [M.x1, M.z]]), // Independence Avenue
    A([[M.x1, P.z0], [M.x1, P.z1]]), // 1st Street, in front of the Capitol
    S([[0, P.z0], [0, P.z1]]), // 15th Street
    S([[180, P.z0], [180, P.z1]]), // 7th Street
    S([[-230, P.z0], [-230, -M.z]]), // 17th Street
    S([[P.x0, -200], [-230, -200]]), // E Street (west)
    S([[0, -200], [M.x1, -200]]), // E Street (east)
    S([[0, 200], [M.x1, 200]]), // C Street
    A([[0, -265], [M.x1, -115]]), // Pennsylvania Avenue
  ];
  // Roads in: from the west along E Street, from the east to the Capitol, and from the
  // south up 7th Street.
  const links = [
    ...linkRoads(townPoint(t, P.x0, -200), [1, 0]),
    ...linkRoads(townPoint(t, P.x1, 0), [-1, 0]),
    ...linkRoads(townPoint(t, 180, P.z1), [0, -1]),
  ];
  // Level: the lie of the land, as near as the roads in allow (≤ ~7% at their steepest).
  let land = 0, n = 0;
  for (let a = -450; a <= 450; a += 75) for (let b = -300; b <= 300; b += 75) (land += terrainBase(...townPoint(t, a, b))), n++;
  let lo = -Infinity, hi = Infinity;
  for (const r of links) {
    const h0 = profileAt(HIGHWAYS[r.from], highwayCoords(HIGHWAYS[r.from], ...r.pts[0]).s), allow = roadLength(r.pts) * 0.02;
    (lo = Math.max(lo, h0 - allow)), (hi = Math.min(hi, h0 + allow));
  }
  t.level = lo <= hi ? clamp(land / n, lo, hi) : (lo + hi) / 2;
  for (const r of t.roads) r.hs = r.hs.map(() => t.level);
  for (const r of links) fillLink(r, t.level);
  t.road = links[0];
  t.roads.push(...links);
  return t;
}

/**
 * The rocket launch pads, where you can fly up to the space station: a level concrete
 * apron with the rocket standing in the middle, a road round it, and a road in from a
 * highway that splits to join it both ways (two exits). Frame: `a` along the highway,
 * `b` away from it; the rocket stands at (0, 0).
 */
export const PAD = {
  /** Half-size of the level apron. */
  half: 120,
  /** The road round the rocket. */
  circle: 46,
  /** Drive into this circle by the rocket (centre, radius; pad coordinates) to be asked to fly. */
  board: { a: 0, b: -30, r: 9 },
};
/** Alexander Mix, out on the farmland north-west of Alexander-ville; Launch Pad 39A, in the desert east of Red Canyon. */
const PAD_SPOTS: { name: string; at: Vec2; hw: string }[] = [
  { name: 'Alexander Mix', at: [-4000, -2700], hw: 'RT 7' },
  { name: 'Launch Pad 39A', at: [100, 3200], hw: 'RT 5' },
];

function makePad(name: string, at: Vec2, hwName: string): Town {
  const h = HIGHWAYS.find((o) => o.name === hwName)!;
  const c = highwayCoords(h, at[0], at[1]);
  const p = pointAt(h, c.s);
  // `b` points away from the highway: left of travel when the pad is on its left.
  const side = Math.sign(c.d) || 1;
  const t: Town = {
    name, kind: 'pad', x: at[0], z: at[1], ux: p.ux, uz: p.uz, side, level: 0, hw: -1, s: 0,
    road: null!, roads: [], exits: [], area: { a0: -PAD.half, a1: PAD.half, b0: -PAD.half, b1: PAD.half }, blend: 170,
  };
  const inward: Vec2 = [-p.uz * side, p.ux * side];
  const links = linkRoads(townPoint(t, 0, -PAD.half), inward);
  let land = 0, n = 0;
  for (let a = -100; a <= 100; a += 50) for (let b = -100; b <= 100; b += 50) (land += terrainBase(...townPoint(t, a, b))), n++;
  let lo = -Infinity, hi = Infinity;
  for (const r of links) {
    const h0 = profileAt(HIGHWAYS[r.from], highwayCoords(HIGHWAYS[r.from], ...r.pts[0]).s), allow = roadLength(r.pts) * 0.025;
    (lo = Math.max(lo, h0 - allow)), (hi = Math.min(hi, h0 + allow));
  }
  t.level = lo <= hi ? clamp(land / n, lo, hi) : (lo + hi) / 2;
  const C = PAD.circle;
  t.roads = [
    street(t, [[0, -PAD.half], [0, -C]], 5.5),
    street(t, Array.from({ length: 29 }, (_, i): [number, number] => {
      const ang = -Math.PI / 2 + (i / 28) * Math.PI * 2;
      return [Math.cos(ang) * C, Math.sin(ang) * C];
    }), 5.5),
  ];
  for (const r of links) fillLink(r, t.level);
  t.road = links[0] ?? t.roads[0];
  t.roads.push(...links);
  return t;
}

const TOWN_LIST: Town[] = [];
{
  const m = makeMariano();
  if (m) TOWN_LIST.push(m);
  const a = makeAlexander(TOWN_LIST);
  if (a) TOWN_LIST.push(a);
  TOWN_LIST.push(makeDC());
  for (const p of PAD_SPOTS) TOWN_LIST.push(makePad(p.name, p.at, p.hw));
  for (const t of TOWN_LIST) t.exits = exitsOf(t.roads);
}
/** Every town. */
export const TOWNS: readonly Town[] = TOWN_LIST;
/** Mariano-ville. */
export const TOWN: Town | null = TOWNS.find((t) => t.kind === 'mariano') ?? null;
export const ALEXANDER: Town | null = TOWNS.find((t) => t.kind === 'alexander') ?? null;
export const DC: Town = TOWNS.find((t) => t.kind === 'dc')!;
/** The two launch pads. */
export const PADS: readonly Town[] = TOWNS.filter((t) => t.kind === 'pad');

/** The town whose level area a spot is in (or within `margin` of). */
export function townAt(x: number, z: number, margin = 0): Town | null {
  for (const t of TOWNS) if (townDistance(t, x, z) <= margin) return t;
  return null;
}

/** Every curved road: the ramps, the town roads and the Ring. */
export const CURVES: CurveRoad[] = [...RAMPS, ...TOWNS.flatMap((t) => t.roads), RING];

// Curve segments bucketed for fast point queries.
const RB = 128;
const curveBuckets = new Map<number, [number, number][]>(); // [curve, segment]
const rbKey = (ix: number, iz: number) => ix * 100003 + iz;
CURVES.forEach((c, ci) => {
  const n = c.pts.length;
  for (let i = 0; i < n - (c.closed ? 0 : 1); i++) {
    const [a, b] = [c.pts[i], c.pts[(i + 1) % n]];
    const pad = c.hw + 40;
    for (let ix = Math.floor((Math.min(a[0], b[0]) - pad) / RB); ix <= Math.floor((Math.max(a[0], b[0]) + pad) / RB); ix++)
      for (let iz = Math.floor((Math.min(a[1], b[1]) - pad) / RB); iz <= Math.floor((Math.max(a[1], b[1]) + pad) / RB); iz++) {
        const k = rbKey(ix, iz);
        let l = curveBuckets.get(k);
        if (!l) curveBuckets.set(k, (l = []));
        l.push([ci, i]);
      }
  }
});

/** Nearest curved road to a point: how far from its edge, and its road height there. */
export function nearestCurve(x: number, z: number) {
  let best = Infinity, h = 0, hw = RAMP_HW, kind: CurveRoad['kind'] = 'ramp';
  for (const [ci, i] of curveBuckets.get(rbKey(Math.floor(x / RB), Math.floor(z / RB))) ?? []) {
    const c = CURVES[ci];
    const n = c.pts.length, j = (i + 1) % n;
    const [a, b] = [c.pts[i], c.pts[j]];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
    const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) - c.hw;
    if (d < best) (best = d), (h = lerp(c.hs[i], c.hs[j], t)), (hw = c.hw), (kind = c.kind);
  }
  return { edge: best, h, hw, kind };
}

// ---------------------------------------------------------------- lakes and towers

function nearAnyRoad(x: number, z: number, margin: number) {
  for (const h of HIGHWAYS) {
    if (x < h.x0 - margin - HW || x > h.x1 + margin + HW || z < h.z0 - margin - HW || z > h.z1 + margin + HW) continue;
    for (const [px, pz] of h.pts) if (Math.abs(px - x) < HW + margin && Math.abs(pz - z) < HW + margin && Math.hypot(px - x, pz - z) < HW + margin) return true;
  }
  for (const c of CURVES) if (c.kind !== 'ring' && x > c.x0 - margin && x < c.x1 + margin && z > c.z0 - margin && z < c.z1 + margin) return true;
  if (TOWNS.some((t) => townDistance(t, x, z) < margin + 250)) return true;
  return hexDistance(x, z) > RING_APOTHEM - HW - margin;
}

function makeLakes(): OuterLake[] {
  const rng = mulberry32(4242);
  const out: OuterLake[] = [];
  for (let tries = 0; tries < 2000 && out.length < 18; tries++) {
    const x = lerp(OUTER.x0 + 600, OUTER.x1 - 600, rng()), z = lerp(OUTER.z0 + 600, OUTER.z1 - 600, rng());
    const r = lerp(80, 200, rng());
    if (outsideWorld(x, z) < r + 400) continue;
    if (mountainWeight(x, z) > 0.1) continue; // (no lakes up among the peaks)
    if (nearAnyRoad(x, z, r + 150)) continue;
    if (CROSSINGS.some((c) => Math.hypot(c.x - x, c.z - z) < r + 700)) continue;
    if (out.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + r + 300)) continue;
    // Water at about the average lie of the land round it (the banks are shaped to meet it).
    let level = 0;
    for (let k = 0; k < 12; k++) level += terrainBase(x + Math.cos(k * 0.52) * (r + 60), z + Math.sin(k * 0.52) * (r + 60)) / 12;
    out.push({ x, z, r, level: level - 1.5, depth: 6 });
  }
  return out;
}
export const OUTER_LAKES: OuterLake[] = makeLakes();
// DC's Tidal Basin (deep enough to sink in, like the others).
{
  const [x, z] = townPoint(DC, DC_PLAN.basin.x, DC_PLAN.basin.z);
  OUTER_LAKES.push({ x, z, r: DC_PLAN.basin.r, level: DC.level - 1.2, depth: 5 });
}

function makeTowers(): Tower[] {
  const out: Tower[] = [];
  for (const h of HIGHWAYS) {
    let side = h.id % 2 ? 1 : -1;
    for (let s = 450; s < h.len - 300; s += 900) {
      side = -side;
      const [x, z] = besideHighway(h, s, side * 80);
      if (outsideWorld(x, z) < 300) continue;
      if (CROSSINGS.some((c) => Math.hypot(c.x - x, c.z - z) < 420)) continue;
      if (OUTER_LAKES.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + 60)) continue;
      let near = false;
      forNearHighways(x, z, (o, os, od) => {
        if (o !== h && Math.abs(od) < HW + 50 && os > -50 && os < o.len + 50) near = true;
      });
      if (near || nearestCurve(x, z).edge < 50) continue;
      if (TOWNS.some((t) => townDistance(t, x, z) < 450)) continue;
      out.push({ x, z, h: 62 + ((s * 7) % 23) });
    }
  }
  return out;
}
export const TOWERS: Tower[] = makeTowers();

// ---------------------------------------------------------------- bridges

/** A solid box: centre, size, turn about the vertical axis, and what it is to physics. */
export interface Solid { at: [number, number, number]; size: [number, number, number]; heading: number; kind: 'ground' | 'building'; color: number }

/**
 * Where the upper highway crosses the lower one: the deck (with the road on it) and its
 * side walls, pillars either side of the lower road, and concrete abutments where the
 * embankments end.
 */
export function bridgeSolids(cr: Crossing): Solid[] {
  const U = HIGHWAYS[cr.upper], L = HIGHWAYS[cr.lower];
  const top = profileAt(U, cr.sUpper);
  const ground = profileAt(L, cr.sLower);
  // Long enough to reach past where the ground (sampled every 8 m) dips towards the lower road.
  const half = (HW + 11) / cr.sin + 14;
  const { ux, uz } = pointAt(U, cr.sUpper);
  const heading = Math.atan2(ux, uz);
  const out: Solid[] = [];
  const add = (along: number, across: number, y: number, sx: number, sy: number, sz: number, color: number, kind: Solid['kind']) =>
    out.push({ at: [cr.x + ux * along - uz * across, y, cr.z + uz * along + ux * across], size: [sx, sy, sz], heading, kind, color });
  add(0, 0, top - 0.6, HW * 2 + 2, 1.2, half * 2, 0xa7a49c, 'ground');
  for (const side of [-1, 1]) add(0, side * (HW + 0.6), top + 0.55, 0.6, 1.1, half * 2, 0xc9c5bc, 'building');
  for (const s of [-1, 1]) {
    const along = (s * (HW + 5)) / cr.sin;
    for (const across of [-10, 0, 10]) add(along, across, (ground + top - 1.2) / 2, 1.4, top - 1.2 - ground, 1.4, 0x9a968e, 'building');
  }
  for (const s of [-1, 1]) add(s * half, 0, (ground + top) / 2 - 0.5, HW * 2 + 4, top - ground + 1, 2, 0xb3afa6, 'building');
  return out;
}

// ---------------------------------------------------------------- queries

/** The outer lake a point is on, if any. */
export function outerLakeAt(x: number, z: number): OuterLake | null {
  for (const l of OUTER_LAKES) if (Math.abs(x - l.x) < l.r && Math.abs(z - l.z) < l.r && Math.hypot(x - l.x, z - l.z) < l.r) return l;
  return null;
}

/** Is a spot on a highway-country road, or within `m` m of its edge? */
export function nearOuterRoad(x: number, z: number, m: number) {
  let near = false;
  forNearHighways(x, z, (h, s, d) => {
    if (Math.abs(d) < HW + m && s > -m && s < h.len + m) near = true;
  });
  return near || nearestCurve(x, z).edge < m;
}

/** Which highway-country road (if any) is under a point. */
export function outerRoadAt(x: number, z: number): 'highway' | 'ramp' | null {
  let on = false;
  forNearHighways(x, z, (h, s, d) => {
    if (Math.abs(d) <= HW && s >= -2 && s <= h.len + 2) on = true;
  });
  if (on) return 'highway';
  const c = nearestCurve(x, z);
  return c.edge <= 0 ? (c.kind === 'ring' ? 'highway' : 'ramp') : null;
}

/**
 * Shape the land for highway country: level the interchanges, dig the lakes, and cut
 * and fill along every highway and ramp so they sit on the ground. `h` is the land
 * height before this (cities, mountain etc. already applied).
 */
export function shapeOuter(x: number, z: number, h: number) {
  // Interchanges sit on a level plateau.
  for (const c of CROSSINGS) {
    const dx = x - c.x, dz = z - c.z;
    if (Math.abs(dx) > 700 || Math.abs(dz) > 700) continue;
    h = lerp(h, c.h0, 1 - smoothstep(200, 400, Math.hypot(dx, dz)));
  }
  // Towns sit on level ground.
  for (const t of TOWNS) {
    const out = townDistance(t, x, z);
    if (out < t.blend) h = lerp(h, t.level, 1 - smoothstep(0, t.blend, out));
  }
  // Lakes: a basin below the water, a dry bank round it.
  for (const l of OUTER_LAKES) {
    const dx = x - l.x, dz = z - l.z;
    if (Math.abs(dx) > l.r + 115 || Math.abs(dz) > l.r + 115) continue;
    const d = Math.hypot(dx, dz);
    // A basin under the water, and the land sloping gently down to a low bank all round.
    if (d < l.r) h = l.level - l.depth * (1 - smoothstep(l.r * 0.55, l.r, d));
    else h = lerp(l.level + 1.2 * smoothstep(l.r, l.r + 12, d), h, smoothstep(l.r + 8, l.r + 110, d));
  }
  // Roads: each pulls the ground towards its own height, the strongest pull winning.
  // In the desert and the mountains the cuttings are steep rock walls, elsewhere gentle slopes.
  const steep = Math.min(1, desertWeight(x, z) + mountainWeight(x, z) * 0.8);
  const reach = HW + 45 - 30 * steep;
  const pulls: [number, number][] = [];
  forNearHighways(x, z, (hw, s, d) => {
    const ad = Math.abs(d);
    if (ad > reach + 1 || s < -60 || s > hw.len + 60) return;
    let w = 1 - smoothstep(HW + 3, reach, ad);
    if (s < 0 || s > hw.len) w *= 1 - smoothstep(0, 60, s < 0 ? -s : s - hw.len);
    // Under a bridge the lower highway's ground wins (the deck spans the gap).
    for (const c of CROSSINGS) {
      if (c.upper !== hw.id || Math.abs(s - c.sUpper) > c.flat + 5) continue;
      if (Math.abs(highwayCoords(HIGHWAYS[c.lower], x, z).d) < HW + 11) w = 0;
    }
    if (w > 0) pulls.push([w, profileAt(hw, s)]);
  });
  const c = nearestCurve(x, z);
  if (c.edge < 32) pulls.push([(1 - smoothstep(2, 32, c.edge)) * (c.kind === 'ring' ? 1 : 0.999), c.h]);
  pulls.sort((a, b) => a[0] - b[0]);
  for (const [w, ph] of pulls) h = lerp(h, ph, w);
  return h;
}
