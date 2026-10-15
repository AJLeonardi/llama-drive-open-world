// Highway country: the big map beyond the cities (pure data, no three.js / Rapier).
//
// Long straight highways run in three directions 60° apart (a triangle pattern, not a
// square grid), plus three spurs out from the cities, all ending on a six-sided Ring
// highway round the outside. The lines are spaced so no three ever meet at one point,
// which puts a crossing every ~870 m along each highway (~20 s at Bronco speed).
// Where two highways cross, the newer one goes over on a bridge and four ramps link
// them, one in each corner. Each highway's height follows a smoothed version of the
// land (never steeper than MAX_GRADE), and the land is cut and filled to meet it.
// Lakes and radio towers dot the country.
import { clamp, lerp, mulberry32, smoothstep, type Vec2 } from '../util/math';
import { FAMILY_NORMALS, HEX, OUTER, RING_APOTHEM, WORLD, hexDistance } from './bounds';
import { terrainBase } from './hills';
import { desertWeight } from './biomes';

/** Highway half-width (6 lanes + shoulders, like the one between the cities). */
export const HW = 15;
/** Ramp (connector) half-width. */
export const RAMP_HW = 6;
/** How far the upper highway rises to clear the lower one. */
export const OVERPASS_RISE = 8.5;
const PROFILE_STEP = 25;
const MAX_GRADE = 0.07;
/** Line spacing within each direction. */
const SPACING = 1100;
/** Radius of the Ring's rounded corners. */
const RING_CORNER = 450;

/** A straight highway. */
export interface Highway {
  id: number;
  /** Shown on signs: "RT 7". */
  name: string;
  ax: number;
  az: number;
  ux: number;
  uz: number;
  len: number;
  /** Road height every PROFILE_STEP m from the start. */
  profile: Float32Array;
  spur: boolean;
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

/** A curved road (an interchange ramp, or the Ring) as points with a road height at each. */
export interface CurveRoad {
  kind: 'ramp' | 'ring';
  pts: Vec2[];
  hs: number[];
  hw: number;
  closed: boolean;
  /** Ramps: the highway they leave from and the one they join. */
  from: number;
  to: number;
  x0: number; z0: number; x1: number; z1: number;
}

export interface OuterLake { x: number; z: number; r: number; level: number; depth: number }
export interface Tower { x: number; z: number; h: number }

/** Distance outside WORLD (negative inside). */
const outsideWorld = (x: number, z: number) => Math.max(WORLD.x0 - x, x - WORLD.x1, WORLD.z0 - z, z - WORLD.z1);

function bbox(pts: Vec2[]) {
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

function makeRing(): CurveRoad {
  const pts = ringPoints();
  const hs = Array.from(shapeProfile(pts.map(([x, z]) => terrainBase(x, z)), 16, PROFILE_STEP));
  return { kind: 'ring', pts, hs, hw: HW, closed: true, from: -1, to: -1, ...bbox(pts) };
}
export const RING: CurveRoad = makeRing();

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

// ---------------------------------------------------------------- straight highways

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
  { x0: -1600, x1: 1080, z0: -660, z1: 660 }, // Boston, harbour, highway, NYC
  { x0: -260, x1: 260, z0: -890, z1: -660 }, // dirt track
  { x0: 540, x1: 880, z0: -1100, z1: -720 }, // Thunder Mountain and lake
  { x0: -180, x1: 200, z0: 660, z1: 1080 }, // demolition park
  { x0: -730, x1: -590, z0: 450, z1: 640 }, // Beacon Hill
].map((b) => ({ x0: b.x0 - 120, x1: b.x1 + 120, z0: b.z0 - 120, z1: b.z1 + 120 }));
/** Spurs from the city ring roads out to the Ring: start point and direction. */
// (Where along each city ring road they start was searched for, so that their crossings
// stay clear of the other interchanges.)
const SPURS: { x: number; z: number; ux: number; uz: number }[] = [
  { x: 1058, z: -200, ux: 1, uz: 0 }, // east, from NYC's ring road
  { x: -700, z: -448, ux: 0, uz: -1 }, // north, from Boston's ring road
  { x: -540, z: 448, ux: 0, uz: 1 }, // south, from Boston's ring road
];

function makeLines() {
  const out: Omit<Highway, 'profile'>[] = [];
  for (const sp of SPURS) out.push({ id: 0, name: '', ax: sp.x, az: sp.z, ux: sp.ux, uz: sp.uz, len: meetRing(sp.x, sp.z, sp.ux, sp.uz, 0), spur: true });
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
      out.push({ id: 0, name: '', ax: px + ux * t0, az: pz + uz * t0, ux, uz, len: t1 - t0, spur: false });
    }
  });
  out.forEach((h, i) => ((h.id = i), (h.name = `RT ${i + 1}`)));
  return out;
}

function findCrossings(lines: Omit<Highway, 'profile'>[]): Crossing[] {
  const out: Crossing[] = [];
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      const den = a.ux * b.uz - a.uz * b.ux;
      if (Math.abs(den) < 0.2) continue; // parallel
      const dx = b.ax - a.ax, dz = b.az - a.az;
      const sa = (dx * b.uz - dz * b.ux) / den, sb = (dx * a.uz - dz * a.ux) / den;
      // (Crossings right next to the Ring stay level: just a flat junction.)
      if (sa < 650 || sa > a.len - 650 || sb < 650 || sb > b.len - 650) continue;
      const x = a.ax + a.ux * sa, z = a.az + a.uz * sa;
      // Level the interchange to the average lie of the land around it (a wide average,
      // so neighbouring interchanges end up at similar heights).
      let h0 = 0, n = 0;
      for (let r = 0; r <= 800; r += 200)
        for (let k = 0; k < (r ? 8 : 1); k++) {
          h0 += terrainBase(x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r);
          n++;
        }
      const sin = Math.abs(den);
      out.push({ x, z, upper: j, lower: i, sUpper: sb, sLower: sa, h0: h0 / n, sin, flat: Math.max(45, (HW + 12) / sin + 20) });
    }
  return out;
}

/** 0..1 shape of the upper highway's climb over a bridge. */
const HUMP_RAMP = 280;
const hump = (d: number, flat: number) => (d < flat ? 1 : 1 - smoothstep(flat, flat + HUMP_RAMP, d));

/**
 * Neighbouring interchanges along a highway must be close enough in height for the
 * road between them to stay under MAX_GRADE: nudge them together until they are.
 */
function settleInterchanges(lines: Omit<Highway, 'profile'>[], crossings: Crossing[]) {
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (const l of lines) {
      const mine = crossings.filter((c) => c.upper === l.id || c.lower === l.id).sort((a, b) => (a.upper === l.id ? a.sUpper : a.sLower) - (b.upper === l.id ? b.sUpper : b.sLower));
      for (let i = 1; i < mine.length; i++) {
        const a = mine[i - 1], b = mine[i];
        const gap = Math.abs((b.upper === l.id ? b.sUpper : b.sLower) - (a.upper === l.id ? a.sUpper : a.sLower)) - 2 * PIN;
        const allowed = Math.max(0, gap) * MAX_GRADE * 0.85;
        const diff = b.h0 - a.h0;
        if (Math.abs(diff) > allowed + 0.01) {
          const fix = (Math.abs(diff) - allowed) / 2 * Math.sign(diff);
          a.h0 += fix;
          b.h0 -= fix;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/** Road kept level for this far either side of an interchange. */
const PIN = 250;

function makeProfile(h: Omit<Highway, 'profile'>, crossings: Crossing[]) {
  const n = Math.ceil(h.len / PROFILE_STEP) + 1;
  const at = (k: number): Vec2 => {
    const s = Math.min(h.len, k * PROFILE_STEP);
    return [h.ax + h.ux * s, h.az + h.uz * s];
  };
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

export const HIGHWAYS: Highway[] = [];
export const CROSSINGS: Crossing[] = [];
{
  const lines = makeLines();
  CROSSINGS.push(...findCrossings(lines));
  settleInterchanges(lines, CROSSINGS);
  for (const l of lines) HIGHWAYS.push({ ...l, profile: makeProfile(l, CROSSINGS) });
  // Where a lower highway is itself climbing over a nearby bridge, lift the upper one
  // a bit more so every bridge still has full headroom.
  for (const c of CROSSINGS) {
    const U = HIGHWAYS[c.upper];
    const short = profileAt(HIGHWAYS[c.lower], c.sLower) + OVERPASS_RISE - profileAt(U, c.sUpper);
    if (short <= 0) continue;
    for (let k = 0; k < U.profile.length; k++) U.profile[k] += short * hump(Math.abs(k * PROFILE_STEP - c.sUpper), c.flat);
  }
}

/** Road height of highway `h` at distance `s` along it. */
export function profileAt(h: Highway, s: number) {
  const f = clamp(s / PROFILE_STEP, 0, h.profile.length - 1);
  const k = Math.min(h.profile.length - 2, Math.floor(f));
  return lerp(h.profile[k], h.profile[k + 1], f - k);
}

/** Where a point sits relative to a highway: distance along it, and signed distance across. */
export function highwayCoords(h: Highway, x: number, z: number) {
  const dx = x - h.ax, dz = z - h.az;
  return { s: dx * h.ux + dz * h.uz, d: -dx * h.uz + dz * h.ux };
}

// ---------------------------------------------------------------- ramps

/** Ramps join the lower highway this far from the crossing. */
const RAMP_LOWER = 190;

function rampCandidates(): CurveRoad[] {
  const out: CurveRoad[] = [];
  for (const c of CROSSINGS) {
    const U = HIGHWAYS[c.upper], L = HIGHWAYS[c.lower];
    // Leave the upper highway well before its climb to the bridge.
    const dU = c.flat + HUMP_RAMP + 90;
    for (const sa of [-1, 1])
      for (const sb of [-1, 1]) {
        // Which side of each highway this corner is on.
        const sideU = Math.sign((-U.uz * L.ux + U.ux * L.uz) * sb);
        const sideL = Math.sign((-L.uz * U.ux + L.ux * U.uz) * sa);
        const p1: Vec2 = [c.x + U.ux * sa * dU - U.uz * sideU * (HW - 3), c.z + U.uz * sa * dU + U.ux * sideU * (HW - 3)];
        // How far the ramp has to turn: sharp corners (two highways at 60°) need a 120°
        // turn, so they start and end further out to leave room for a gentle curve.
        const turn = Math.acos(Math.max(-1, Math.min(1, -(U.ux * sa * L.ux * sb + U.uz * sa * L.uz * sb))));
        const dL = turn > Math.PI / 2 ? RAMP_LOWER * 1.9 : RAMP_LOWER;
        const p2: Vec2 = [c.x + L.ux * sb * dL - L.uz * sideL * (HW - 3), c.z + L.uz * sb * dL + L.ux * sideL * (HW - 3)];
        // A smooth S: it leaves running alongside the upper highway (heading towards the
        // crossing) and arrives running alongside the lower one (heading away from it),
        // like a real exit and entrance, rather than turning off at an angle.
        // Curve handles: long enough for a gentle turn, never reaching back towards the bridge.
        const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * (turn > Math.PI / 2 ? 0.6 : 0.42);
        const h1 = Math.min(chord, dU * 0.5), h2 = Math.min(chord, dL * 0.5);
        const k1: Vec2 = [p1[0] - U.ux * sa * h1, p1[1] - U.uz * sa * h1];
        const k2: Vec2 = [p2[0] - L.ux * sb * h2, p2[1] - L.uz * sb * h2];
        const pts: Vec2[] = [], hs: number[] = [];
        const N = 36;
        for (let i = 0; i <= N; i++) {
          const t = i / N, mt = 1 - t;
          const a = mt * mt * mt, b = 3 * mt * mt * t, cc = 3 * mt * t * t, d = t * t * t;
          pts.push([a * p1[0] + b * k1[0] + cc * k2[0] + d * p2[0], a * p1[1] + b * k1[1] + cc * k2[1] + d * p2[1]]);
          // Follow each highway's own height while alongside it (the upper one may already be
          // climbing to its bridge), easing from one to the other in between.
          const [x, z] = pts[pts.length - 1];
          const onU = profileAt(U, highwayCoords(U, x, z).s), onL = profileAt(L, highwayCoords(L, x, z).s);
          hs.push(lerp(onU, onL, smoothstep(0.15, 0.85, t)));
        }
        out.push({ kind: 'ramp', pts, hs, hw: RAMP_HW, closed: false, from: U.id, to: L.id, ...bbox(pts) });
      }
  }
  return out;
}

/** The tightest turn along a polyline (radius, m). */
function tightestRadius(pts: Vec2[]) {
  let min = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    let dh = Math.abs(Math.atan2(c[0] - b[0], c[1] - b[1]) - Math.atan2(b[0] - a[0], b[1] - a[1]));
    if (dh > Math.PI) dh = 2 * Math.PI - dh;
    min = Math.min(min, Math.hypot(c[0] - b[0], c[1] - b[1]) / Math.max(1e-6, dh));
  }
  return min;
}

/** Ramps that would run into another highway, the Ring or another ramp are left out. */
function makeRamps(): CurveRoad[] {
  const kept: CurveRoad[] = [];
  for (const r of rampCandidates()) {
    const mid = r.pts.slice(2, -2);
    const hitsHighway = mid.some(([x, z]) =>
      HIGHWAYS.some((h) => {
        if (h.id === r.from || h.id === r.to) return false;
        const q = highwayCoords(h, x, z);
        return Math.abs(q.d) < HW + RAMP_HW + 6 && q.s > -20 && q.s < h.len + 20;
      }),
    );
    const hitsRing = mid.some(([x, z]) => hexDistance(x, z) > RING_APOTHEM - RING_CORNER * 0.2 - 40);
    // Gentle enough to drive at speed, and clear of the bridge (pillars, abutments).
    const cr = CROSSINGS.find((k) => k.upper === r.from && k.lower === r.to)!;
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
/** Every curved road: the ramps and the Ring. */
export const CURVES: CurveRoad[] = [...RAMPS, RING];

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
function nearestCurve(x: number, z: number) {
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
    const { s, d } = highwayCoords(h, x, z);
    if (s > -margin && s < h.len + margin && Math.abs(d) < HW + margin) return true;
  }
  for (const c of RAMPS) if (x > c.x0 - margin && x < c.x1 + margin && z > c.z0 - margin && z < c.z1 + margin) return true;
  return hexDistance(x, z) > RING_APOTHEM - HW - margin;
}

function makeLakes(): OuterLake[] {
  const rng = mulberry32(4242);
  const out: OuterLake[] = [];
  for (let tries = 0; tries < 2000 && out.length < 18; tries++) {
    const x = lerp(OUTER.x0 + 600, OUTER.x1 - 600, rng()), z = lerp(OUTER.z0 + 600, OUTER.z1 - 600, rng());
    const r = lerp(80, 200, rng());
    if (outsideWorld(x, z) < r + 400) continue;
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

function makeTowers(): Tower[] {
  const out: Tower[] = [];
  for (const h of HIGHWAYS) {
    let side = h.id % 2 ? 1 : -1;
    for (let s = 450; s < h.len - 300; s += 900) {
      side = -side;
      const x = h.ax + h.ux * s - h.uz * side * 80, z = h.az + h.uz * s + h.ux * side * 80;
      if (outsideWorld(x, z) < 300) continue;
      if (CROSSINGS.some((c) => Math.hypot(c.x - x, c.z - z) < 420)) continue;
      if (OUTER_LAKES.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + 60)) continue;
      if (HIGHWAYS.some((o) => o !== h && Math.abs(highwayCoords(o, x, z).d) < HW + 50 && highwayCoords(o, x, z).s > -50 && highwayCoords(o, x, z).s < o.len + 50)) continue;
      if (nearestCurve(x, z).edge < 50) continue;
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
  const heading = Math.atan2(U.ux, U.uz);
  const out: Solid[] = [];
  const add = (along: number, across: number, y: number, sx: number, sy: number, sz: number, color: number, kind: Solid['kind']) =>
    out.push({ at: [cr.x + U.ux * along - U.uz * across, y, cr.z + U.uz * along + U.ux * across], size: [sx, sy, sz], heading, kind, color });
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

/** Which highway-country road (if any) is under a point. */
export function outerRoadAt(x: number, z: number): 'highway' | 'ramp' | null {
  for (const h of HIGHWAYS) {
    const { s, d } = highwayCoords(h, x, z);
    if (Math.abs(d) <= HW && s >= -2 && s <= h.len + 2) return 'highway';
  }
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
  // In the desert the cuttings are steep rock walls (canyons), elsewhere gentle slopes.
  const steep = desertWeight(x, z);
  const reach = HW + 45 - 30 * steep;
  const pulls: [number, number][] = [];
  for (const hw of HIGHWAYS) {
    const { s, d } = highwayCoords(hw, x, z);
    const ad = Math.abs(d);
    if (ad > reach + 1 || s < -60 || s > hw.len + 60) continue;
    let w = 1 - smoothstep(HW + 3, reach, ad);
    if (s < 0 || s > hw.len) w *= 1 - smoothstep(0, 60, s < 0 ? -s : s - hw.len);
    // Under a bridge the lower highway's ground wins (the deck spans the gap).
    for (const c of CROSSINGS) {
      if (c.upper !== hw.id || Math.abs(s - c.sUpper) > c.flat + 5) continue;
      if (Math.abs(highwayCoords(HIGHWAYS[c.lower], x, z).d) < HW + 11) w = 0;
    }
    if (w > 0) pulls.push([w, profileAt(hw, s)]);
  }
  const c = nearestCurve(x, z);
  if (c.edge < 32) pulls.push([(1 - smoothstep(2, 32, c.edge)) * (c.kind === 'ring' ? 1 : 0.999), c.h]);
  pulls.sort((a, b) => a[0] - b[0]);
  for (const [w, ph] of pulls) h = lerp(h, ph, w);
  return h;
}
