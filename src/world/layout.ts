// The world map as plain data (no three.js / Rapier), shared by world building,
// physics (terrain height, surface under each wheel) and tests.
//
// Axes: +x = east, +z = south, +y = up. Boston is in the west, NYC in the east,
// joined by a highway along z = 0.

import { AABB2, Vec2, distOutsideAABB, distToSegment, inAABB, lerp, smoothstep, valueNoise } from '../util/math';
import type { Surface } from '../physics/surfaces';
import { WORLD } from './bounds';
import { terrainBase } from './hills';
import { biomeAt } from './biomes';
import { outerLakeAt, outerRoadAt, shapeOuter, townAt } from './outer';

export { WORLD, OUTER, TERRAIN_CELL, CHUNK } from './bounds';

// The four places sit around a circle: Boston (west) and NYC (east) joined by a
// highway, the dirt track to the north and the demolition park to the south, each a
// few seconds' drive from its neighbours (NYC a bit further out east). Thunder Mountain stands on the north-east
// outskirts. Beyond them lies highway country (outer.ts).

export type RoadKind = 'highway' | 'avenue' | 'street' | 'ramp' | 'dirt';

export interface Road {
  pts: Vec2[];
  width: number;
  kind: RoadKind;
  closed?: boolean;
}

/** The cities' street plans are authored in their own coordinates, then shifted into place. */
const BOSTON_DX = 1290;
const NYC_DX = -690;
const shift = (pts: Vec2[], dx: number, dz = 0): Vec2[] => pts.map(([x, z]) => [x + dx, z + dz]);

export const BOSTON: AABB2 = { x0: -1070, z0: -460, x1: -150, z1: 460 };
export const NYC: AABB2 = { x0: 750, z0: -460, x1: 1670, z1: 460 };
export const DEMO_PARK: AABB2 = { x0: -160, z0: 690, x1: 180, z1: 1060 };
export const DEMO_PARK_GATE = { x0: -40, x1: 40 };

export const TRACK = { cx: 0, cz: -780, halfStraight: 150, radius: 85, width: 18 };
export const TRACK_BOUNDS: AABB2 = {
  x0: TRACK.cx - TRACK.halfStraight - TRACK.radius - 12,
  x1: TRACK.cx + TRACK.halfStraight + TRACK.radius + 12,
  z0: TRACK.cz - TRACK.radius - 12,
  z1: TRACK.cz + TRACK.radius + 12,
};

/** The loop-the-loop on the track's north straight (cars drive west through it). */
export const LOOP = { x: TRACK.cx, z: TRACK.cz - TRACK.radius, radius: 11, width: 9, lateral: 4.5 };
/** The jump on the south straight (cars drive east over it). */
export const JUMP = {
  z: TRACK.cz + TRACK.radius,
  takeoff: { x0: TRACK.cx - 42, x1: TRACK.cx - 22, h: 2.6 },
  landing: { x0: TRACK.cx + 8, x1: TRACK.cx + 34, h: 2.2 },
  width: 12,
};

/**
 * Thunder Mountain: a flat-topped mountain with cliffs all round. A dirt road spirals
 * up the outside (with a drop off its outer edge the whole way), and on the side
 * facing the lake there's no road at all: just a sheer cliff to launch off.
 */
export const MOUNTAIN = {
  x: 720, z: -940,
  /** Plateau radius and height. */
  r: 95, h: 42,
  /** Width of the spiral road band around the plateau. */
  road: 32,
  /** Direction (heading angle) of the cliff side, facing the lake. */
  cliff: Math.atan2(-0.6, 0.8),
  /** Half-angle of the cliff side (the road covers the rest). */
  gap: Math.PI / 4,
};
export const LAKE = {
  x: MOUNTAIN.x + Math.sin(MOUNTAIN.cliff) * (MOUNTAIN.r + 72),
  z: MOUNTAIN.z + Math.cos(MOUNTAIN.cliff) * (MOUNTAIN.r + 72),
  r: 55, bank: 10, depth: 5,
};

/**
 * City stunt spots. Parking garages (drive up the ramps, launch off the roof) are 72 m
 * long (along x) and 36 m wide; "skyramps" are a long ramp straight up onto a flat
 * roof; Beacon Hill is a building with a grassy hill behind it, so you can drive up the
 * hill right onto its roof.
 */
export const GARAGES = [{ x: -260, z: 202 }, { x: 1134, z: 172 }];
export const GARAGE = { length: 72, width: 36, level: 4.2, levels: 3 };
export const SKYRAMPS = [
  { x0: -728, z: -48, ramp: 52, roof: 36, depth: 36, h: 10 },
  { x0: 846, z: 315, ramp: 52, roof: 36, depth: 36, h: 10 },
];
export const BEACON_HILL = { x: -660, z: 478, w: 40, d: 30, h: 14, slope: 130 };

/** Height of the hill behind the Beacon Hill building (0 elsewhere). */
export function beaconHillHeight(x: number, z: number) {
  const { x: bx, z: bz, w, d, h, slope } = BEACON_HILL;
  const along = z - (bz + d / 2); // metres south of the building's back wall
  if (along < -8 || along > slope + 10) return 0;
  const across = 1 - smoothstep(w / 2 - 2, w / 2 + 30, Math.abs(x - bx));
  return h * across * (1 - smoothstep(6, slope, along));
}

export const BOSTON_COMMON: AABB2 = { x0: -1820 + BOSTON_DX, z0: 35, x1: -1700 + BOSTON_DX, z1: 150 };
export const CENTRAL_PARK: AABB2 = { x0: 1768 + NYC_DX, z0: -414, x1: 1992 + NYC_DX, z1: -216 };
export const PARKS = [BOSTON_COMMON, CENTRAL_PARK];

// Deep enough to sink a car (you get a few seconds with the fish, then a restart).
export const RIVER = { z: -296, halfWidth: 34, x0: WORLD.x0, x1: -1470 + BOSTON_DX, bank: 12, depth: 4.5 };
export const HARBOR_X = -2280 + BOSTON_DX;
/** The harbour bay's far (west) shore and its half-width north–south. */
export const HARBOR = { x0: -1460, z: 640 };
export const WATER_LEVEL = -0.9;

// Start at the edge of Boston on the westbound side of the highway, facing into the city.
export const SPAWN = { x: BOSTON.x1 + 45, z: -7, heading: -Math.PI / 2 };

function arc(cx: number, cz: number, r: number, a0: number, a1: number, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + r * Math.sin(a), cz + r * Math.cos(a)]);
  }
  return out;
}

function trackPolyline(): Vec2[] {
  const { cx, cz, halfStraight: hs, radius: r } = TRACK;
  return [
    ...arc(cx + hs, cz, r, 0, Math.PI, 16), // east end: south → north
    ...arc(cx - hs, cz, r, Math.PI, 2 * Math.PI, 16), // west end: north → south
  ];
}

const highway: Road = { pts: [[BOSTON.x1 - 20, 0], [NYC.x0 + 20, 0]], width: 30, kind: 'highway' };
/** A smooth curve through control points (Catmull-Rom), with points about `step` metres apart. */
function smooth(ctrl: Vec2[], step = 10): Vec2[] {
  const out: Vec2[] = [];
  const cr = (a: number, b: number, c: number, d: number, t: number) =>
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) out.push([cr(p0[0], p1[0], p2[0], p3[0], k / n), cr(p0[1], p1[1], p2[1], p3[1], k / n)]);
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

/**
 * Exit ramps. Each one peels off the highway's edge at a shallow angle, like a real
 * off-ramp, then curves away: the track exit leaves westbound traffic to the north, the
 * park exit leaves eastbound traffic to the south. (Both are two-way.)
 */
export const TRACK_ROAD: Road = {
  pts: smooth([[100, -15], [45, -24], [5, -40], [-35, -78], [-58, -150], [-70, -260], [-95, -450], [TRACK.cx - 100, TRACK.cz + TRACK.radius + 4]]),
  width: 14, kind: 'ramp',
};
export const PARK_ROAD: Road = {
  pts: smooth([[-100, 15], [-45, 24], [-5, 40], [35, 78], [58, 150], [65, 260], [25, 470], [(DEMO_PARK_GATE.x0 + DEMO_PARK_GATE.x1) / 2, DEMO_PARK.z0 - 2]]),
  width: 14, kind: 'ramp',
};
/** Where each exit splits from the highway (for the EXIT signs). */
export const EXIT_GORES = [
  { x: 25, z: -22, faceX: 1, lines: ['EXIT ↗', 'DIRT TRACK'] },
  { x: -25, z: 22, faceX: -1, lines: ['EXIT ↘', 'DEMO PARK'] },
];
/** Dirt road from NYC's north end to the foot of the mountain road. */
const mountainFoot = MOUNTAIN.cliff + MOUNTAIN.gap;
export const MOUNTAIN_ROAD: Road = {
  pts: [[800, NYC.z0 + 5], [770, -600], [MOUNTAIN.x + Math.sin(mountainFoot) * 150, MOUNTAIN.z + Math.cos(mountainFoot) * 150 + 20], [MOUNTAIN.x + Math.sin(mountainFoot) * 138, MOUNTAIN.z + Math.cos(mountainFoot) * 138]],
  width: 14, kind: 'dirt',
};

export const COUNTRY_ROADS: Road[] = [
  highway,
  TRACK_ROAD,
  PARK_ROAD,
  MOUNTAIN_ROAD,
  { pts: trackPolyline(), width: TRACK.width, kind: 'dirt', closed: true },
];

// Every street ends on another street: a ring road runs round each city (the harbour
// front is Boston's west side), and the crooked old streets all run out to it.
const BR = { e: -1452, w: -2250, n: -448, s: 448 }; // Boston ring (city coordinates)
const bostonRoads: Road[] = ([
  { pts: [[BR.e, BR.n], [BR.e, BR.s]], width: 14, kind: 'avenue' }, // ring: east
  { pts: [[BR.e, BR.n], [BR.w, BR.n]], width: 14, kind: 'avenue' }, // ring: north
  { pts: [[BR.e, BR.s], [BR.w, BR.s]], width: 14, kind: 'avenue' }, // ring: south
  { pts: [[BR.w, BR.s], [BR.w, BR.n]], width: 12, kind: 'street' }, // ring: harbor front
  { pts: [[-1460, 0], [-1700, 12], [-1960, -8], [BR.w, 4]], width: 18, kind: 'avenue' }, // the "Pike"
  { pts: [[BR.e, -232], [-1800, -236], [BR.w, -230]], width: 14, kind: 'avenue' }, // river drive
  { pts: [[BR.e, -362], [-1800, -360], [BR.w, -364]], width: 12, kind: 'street' }, // north bank
  { pts: [[-1690, BR.s], [-1676, 200], [-1684, 0], [-1680, -232], [-1680, BR.n]], width: 14, kind: 'avenue' }, // bridge road
  { pts: [[-2050, BR.s], [-2030, 220], [-2040, 0], [-2020, -232], [-2020, BR.n]], width: 14, kind: 'avenue' }, // bridge road
  { pts: [[BR.e, 380], [-1650, 250], [-1860, 172], [-2080, 92], [BR.w, 60]], width: 12, kind: 'street' },
  { pts: [[BR.e, 140], [-1580, 118], [-1760, -110], [-1900, -142], [BR.w, -150]], width: 12, kind: 'street' },
  { pts: [[-1840, BR.s], [-1850, 250], [-1833, 2]], width: 11, kind: 'street' },
  { pts: [[-2200, BR.s], [-2180, 250], [-2190, 4]], width: 11, kind: 'street' },
  { pts: [[-1560, -232], [-1545, -60], [-1562, 121]], width: 11, kind: 'street' },
  { pts: [[BR.e, 300], [-1850, 318], [BR.w, 330]], width: 12, kind: 'street' },
  { pts: [[-1880, -232], [-1900, -142]], width: 10, kind: 'street' },
] as Road[]).map((r) => ({ ...r, pts: shift(r.pts, BOSTON_DX) }));

const NR = { w: 1452, e: 2348, n: -452, s: 452 }; // NYC ring (city coordinates)
function nycRoads(): Road[] {
  const roads: Road[] = [
    { pts: [[NR.w, NR.n], [NR.w, NR.s]], width: 16, kind: 'avenue' },
    { pts: [[NR.e, NR.n], [NR.e, NR.s]], width: 16, kind: 'avenue' },
    { pts: [[NR.w, NR.n], [NR.e, NR.n]], width: 16, kind: 'avenue' },
    { pts: [[NR.w, NR.s], [NR.e, NR.s]], width: 16, kind: 'avenue' },
  ];
  for (let x = 1520; x <= 2240; x += 120) roads.push({ pts: [[x, NR.n], [x, NR.s]], width: 16, kind: 'avenue' });
  for (let z = -420; z <= 420; z += 70) {
    roads.push({ pts: [[NR.w, z], [NR.e, z]], width: z === 0 ? 20 : 12, kind: z === 0 ? 'avenue' : 'street' });
  }
  roads.push({ pts: [[1460, NR.n], [1900, -40], [NR.e - 4, 444]], width: 14, kind: 'avenue' }); // "Broadway"
  return roads.map((r) => ({ ...r, pts: shift(r.pts, NYC_DX) }));
}

/** Boston and NYC landmarks are placed in the cities' own coordinates; these move them into the world. */
export const bostonX = (x: number) => x + BOSTON_DX;
export const nycX = (x: number) => x + NYC_DX;

export const CITY_ROADS: Road[] = [...bostonRoads, ...nycRoads()];
export const ALL_ROADS: Road[] = [...COUNTRY_ROADS, ...CITY_ROADS];

/** Road segments flattened, bucketed in a coarse grid for fast point queries. */
interface Seg { ax: number; az: number; bx: number; bz: number; hw: number; kind: RoadKind }
const BUCKET = 64;
let segBuckets: Map<number, Seg[]> | null = null;
const bucketKey = (ix: number, iz: number) => ix * 100003 + iz;

export function roadSegments(road: Road): [Vec2, Vec2][] {
  const segs: [Vec2, Vec2][] = [];
  const n = road.pts.length;
  for (let i = 0; i < n - 1; i++) segs.push([road.pts[i], road.pts[i + 1]]);
  if (road.closed) segs.push([road.pts[n - 1], road.pts[0]]);
  return segs;
}

function buildBuckets() {
  segBuckets = new Map();
  for (const road of ALL_ROADS) {
    for (const [a, b] of roadSegments(road)) {
      const seg: Seg = { ax: a[0], az: a[1], bx: b[0], bz: b[1], hw: road.width / 2, kind: road.kind };
      const pad = seg.hw + 14;
      const ix0 = Math.floor((Math.min(a[0], b[0]) - pad) / BUCKET), ix1 = Math.floor((Math.max(a[0], b[0]) + pad) / BUCKET);
      const iz0 = Math.floor((Math.min(a[1], b[1]) - pad) / BUCKET), iz1 = Math.floor((Math.max(a[1], b[1]) + pad) / BUCKET);
      for (let ix = ix0; ix <= ix1; ix++)
        for (let iz = iz0; iz <= iz1; iz++) {
          const k = bucketKey(ix, iz);
          let list = segBuckets.get(k);
          if (!list) segBuckets.set(k, (list = []));
          list.push(seg);
        }
    }
  }
}

/** The road under a point (if any). Dirt wins over asphalt where they overlap. */
export function roadAt(x: number, z: number): RoadKind | null {
  if (!segBuckets) buildBuckets();
  const list = segBuckets!.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
  if (!list) return null;
  let found: RoadKind | null = null;
  for (const s of list) {
    if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz).d <= s.hw) {
      if (s.kind === 'dirt') return 'dirt';
      found = s.kind;
    }
  }
  return found;
}

/** True if the point is on a road or within `margin` metres of its edge (margin ≤ 12). */
export function nearRoad(x: number, z: number, margin: number) {
  if (!segBuckets) buildBuckets();
  const list = segBuckets!.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
  if (!list) return false;
  for (const s of list) if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz).d <= s.hw + margin) return true;
  return false;
}

/** Distance from a point to the nearest road edge (negative = on the road), search limited to `maxDist`. */
export function distToRoad(x: number, z: number, roads: Road[] = ALL_ROADS) {
  let best = Infinity;
  for (const road of roads)
    for (const [a, b] of roadSegments(road)) best = Math.min(best, distToSegment(x, z, a[0], a[1], b[0], b[1]).d - road.width / 2);
  return best;
}

export function waterDepth(x: number, z: number) {
  const { z: rz, halfWidth, bank, depth, x1 } = RIVER;
  const riverD = Math.abs(z - rz);
  const river = (1 - smoothstep(halfWidth, halfWidth + bank, riverD)) * (1 - smoothstep(x1 - 40, x1, x)) * smoothstep(HARBOR.x0, HARBOR.x0 + 100, x);
  // The harbour is a bay: open water west of the piers, with shores north, south and west.
  const harbor = (1 - smoothstep(HARBOR_X, HARBOR_X + bank, x)) * (1 - smoothstep(HARBOR.z - bank, HARBOR.z, Math.abs(z))) * smoothstep(HARBOR.x0, HARBOR.x0 + bank * 4, x);
  const lake = (1 - smoothstep(LAKE.r, LAKE.r + LAKE.bank, Math.hypot(x - LAKE.x, z - LAKE.z))) * (LAKE.depth / depth);
  return depth * Math.max(river, harbor, lake);
}

/** Areas that must stay flat (cities, parks, track, ramps…), as distance-to-flat. */
function distToFlat(x: number, z: number) {
  let d = Math.min(
    distOutsideAABB(x, z, BOSTON),
    distOutsideAABB(x, z, NYC),
    distOutsideAABB(x, z, DEMO_PARK) - 10,
    distOutsideAABB(x, z, TRACK_BOUNDS) - 10,
  );
  if (d > 0) d = Math.min(d, distToCountryRoad(x, z) - 8);
  return d;
}

// Country-road segments bucketed (with a wide margin) so the flattening check only
// looks at roads close by; it runs for every terrain sample.
const FLAT_REACH = 110;
let countryBuckets: Map<number, [Vec2, Vec2, number][]> | null = null;
function distToCountryRoad(x: number, z: number) {
  if (!countryBuckets) {
    countryBuckets = new Map();
    for (const road of COUNTRY_ROADS)
      for (const [a, b] of roadSegments(road)) {
        const pad = road.width / 2 + FLAT_REACH;
        for (let ix = Math.floor((Math.min(a[0], b[0]) - pad) / BUCKET); ix <= Math.floor((Math.max(a[0], b[0]) + pad) / BUCKET); ix++)
          for (let iz = Math.floor((Math.min(a[1], b[1]) - pad) / BUCKET); iz <= Math.floor((Math.max(a[1], b[1]) + pad) / BUCKET); iz++) {
            const k = bucketKey(ix, iz);
            let l = countryBuckets.get(k);
            if (!l) countryBuckets.set(k, (l = []));
            l.push([a, b, road.width / 2]);
          }
      }
  }
  let best = FLAT_REACH;
  for (const [a, b, hw] of countryBuckets.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET))) ?? [])
    best = Math.min(best, distToSegment(x, z, a[0], a[1], b[0], b[1]).d - hw);
  return best;
}

const wrapAngle = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
/** Share of the way round the mountain covered by the spiral road. */
const SPIRAL = 2 * Math.PI - 2 * MOUNTAIN.gap;

/**
 * Where a point sits on the mountain: distance from its centre, and how far up the
 * spiral road it is (0 at the foot, 1 at the top; -1 on the cliff side).
 */
export function mountainCoords(x: number, z: number) {
  const dx = x - MOUNTAIN.x, dz = z - MOUNTAIN.z;
  const r = Math.hypot(dx, dz);
  const a = wrapAngle(Math.atan2(dx, dz) - (MOUNTAIN.cliff + MOUNTAIN.gap));
  return { r, up: a <= SPIRAL ? a / SPIRAL : -1 };
}

/** Thunder Mountain's height (0 away from it). */
export function mountainHeight(x: number, z: number) {
  const { r: R, h: H, road: W } = MOUNTAIN;
  const { r, up } = mountainCoords(x, z);
  if (r > R + W + 10) return 0;
  const roadH = up < 0 ? 0 : H * up;
  // Plateau → (cliff) → road band → (drop-off) → ground.
  const top = H + 0.8 * (valueNoise(x / 30, z / 30) - 0.5);
  const band = lerp(top, roadH, smoothstep(R, R + 5, r));
  return lerp(band, 0, smoothstep(R + W, R + W + 7, r));
}

/** True on the mountain's spiral road (dirt). */
export function onMountainRoad(x: number, z: number) {
  const { r, up } = mountainCoords(x, z);
  return up >= 0 && r > MOUNTAIN.r + 3 && r < MOUNTAIN.r + MOUNTAIN.road;
}

/** Ground height before buildings are added. */
export function heightAt(x: number, z: number) {
  // Keep a flat meadow around the mountain and its lake so the cliffs stand out.
  const nearMountain = Math.min(
    Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z) - MOUNTAIN.r - MOUNTAIN.road,
    Math.hypot(x - LAKE.x, z - LAKE.z) - LAKE.r,
  );
  const flat = smoothstep(0, 90, distToFlat(x, z)) * smoothstep(20, 110, nearMountain);
  const ground = terrainBase(x, z) * flat;
  // The mountain and Beacon Hill rise out of the ground (they're 0 elsewhere, which must
  // not lift valleys up to 0).
  let h = ground;
  const m = mountainHeight(x, z), b = beaconHillHeight(x, z);
  if (m > 0) h = Math.max(h, m);
  if (b > 0) h = Math.max(h, b);
  h -= waterDepth(x, z);
  // Highway country: interchanges, lakes, and the highways' cuts and embankments.
  return shapeOuter(x, z, h);
}

export function surfaceAt(x: number, z: number): Surface {
  const depth = waterDepth(x, z);
  const road = roadAt(x, z);
  if (road === 'dirt') return 'dirt';
  if (road) return 'asphalt';
  if (onMountainRoad(x, z)) return 'dirt';
  if (outerRoadAt(x, z)) return 'asphalt';
  const lake = outerLakeAt(x, z);
  if (lake) return Math.hypot(x - lake.x, z - lake.z) < lake.r * 0.8 ? 'water' : 'sand';
  if (depth > 1.2) return 'water';
  if (depth > 0.05) return 'sand';
  if (inAABB(x, z, DEMO_PARK)) return 'dirt';
  const town = townAt(x, z);
  if (town) return town.kind === 'pad' ? 'concrete' : 'grass'; // (lawns, even in the desert; launch pads are concrete)
  const b = biomeAt(x, z);
  if (b.desert > 0.5) return 'dirt'; // desert sand (firm enough to drive and drift on)
  if (b.mountain > 0.5) return 'snow';
  for (const p of PARKS) if (inAABB(x, z, p)) return 'grass';
  if (inAABB(x, z, BOSTON) || inAABB(x, z, NYC)) return 'concrete';
  return 'grass';
}

/** Speed-boost pads: driving over one gives a short burst of extra power. */
export interface BoostPad { x: number; z: number; heading: number; length: number; width: number }
/** A pad lying on a road, `t` (0..1) of the way along it, facing along the road. */
function padOn(road: Road, t: number, w = 6): BoostPad {
  const seg = Math.min(road.pts.length - 2, Math.floor(t * (road.pts.length - 1)));
  const [a, b] = [road.pts[seg], road.pts[seg + 1]];
  return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, heading: Math.atan2(b[0] - a[0], b[1] - a[1]), length: 10, width: w };
}

export const BOOST_PADS: BoostPad[] = [
  // At the foot of each skyramp
  ...SKYRAMPS.map((r) => ({ x: r.x0 - 4, z: r.z, heading: Math.PI / 2, length: 10, width: 8 })),
  padOn(TRACK_ROAD, 0.35),
  padOn(PARK_ROAD, 0.35),
  { x: LOOP.x + 70, z: LOOP.z - LOOP.lateral, heading: -Math.PI / 2, length: 10, width: 6 }, // lines up with the loop entry lane
  // Demolition park: one before each mega ramp
  { x: DEMO_PARK.x0 + 38, z: DEMO_PARK.z0 + 170, heading: Math.PI / 2, length: 10, width: 8 },
  { x: DEMO_PARK.x0 + 23, z: DEMO_PARK.z0 + 290, heading: Math.PI / 2, length: 10, width: 8 },
];

/** Bridges where roads cross the river: flat decks at road level. */
export interface Bridge { x: number; z0: number; z1: number; width: number }
export const BRIDGES: Bridge[] = [-1680, -2020, -2250].map(bostonX).map((x) => ({
  x,
  z0: RIVER.z - RIVER.halfWidth - RIVER.bank - 4,
  z1: RIVER.z + RIVER.halfWidth + RIVER.bank + 4,
  width: 16,
}));

/** Height of the water surface at a spot, or null if it's dry land. */
export function waterLevelAt(x: number, z: number): number | null {
  if (waterDepth(x, z) > 0 && !bridgeAt(x, z)) return WATER_LEVEL;
  return outerLakeAt(x, z)?.level ?? null;
}

/** Is this spot deep water (car would sink)? */
export const isDeepWater = (x: number, z: number) => {
  if (waterDepth(x, z) > -WATER_LEVEL + 1.0 && !bridgeAt(x, z)) return true;
  const l = outerLakeAt(x, z);
  return !!l && Math.hypot(x - l.x, z - l.z) < l.r * 0.8;
};

export function bridgeAt(x: number, z: number) {
  return BRIDGES.some((b) => Math.abs(x - b.x) <= b.width / 2 && z >= b.z0 && z <= b.z1);
}
