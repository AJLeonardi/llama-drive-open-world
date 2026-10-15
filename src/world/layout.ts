// The world map as plain data (no three.js / Rapier), shared by world building,
// physics (terrain height, surface under each wheel) and tests.
//
// Axes: +x = east, +z = south, +y = up. Boston is in the west, NYC in the east,
// joined by a highway along z = 0.

import { AABB2, Vec2, distOutsideAABB, distToSegment, inAABB, smoothstep, valueNoise } from '../util/math';
import type { Surface } from '../physics/surfaces';

export const WORLD = { x0: -2400, x1: 2400, z0: -1000, z1: 1000 };
/** Terrain sample spacing (m). Physics heightfield and terrain mesh share it. */
export const TERRAIN_CELL = 8;

export type RoadKind = 'highway' | 'avenue' | 'street' | 'ramp' | 'dirt';

export interface Road {
  pts: Vec2[];
  width: number;
  kind: RoadKind;
  closed?: boolean;
}

export const BOSTON: AABB2 = { x0: -2360, z0: -460, x1: -1440, z1: 460 };
export const NYC: AABB2 = { x0: 1440, z0: -460, x1: 2360, z1: 460 };
export const DEMO_PARK: AABB2 = { x0: 440, z0: 270, x1: 780, z1: 640 };
export const DEMO_PARK_GATE = { x0: 560, x1: 640 };

export const TRACK = { cx: -600, cz: -420, halfStraight: 150, radius: 85, width: 18 };
export const TRACK_BOUNDS: AABB2 = {
  x0: TRACK.cx - TRACK.halfStraight - TRACK.radius - 12,
  x1: TRACK.cx + TRACK.halfStraight + TRACK.radius + 12,
  z0: TRACK.cz - TRACK.radius - 12,
  z1: TRACK.cz + TRACK.radius + 12,
};

/** The loop-the-loop on the track's north straight (cars drive west through it). */
export const LOOP = { x: -600, z: TRACK.cz - TRACK.radius, radius: 11, width: 9, lateral: 4.5 };
/** The jump on the south straight (cars drive east over it). */
export const JUMP = {
  z: TRACK.cz + TRACK.radius,
  takeoff: { x0: -642, x1: -622, h: 2.6 },
  landing: { x0: -592, x1: -566, h: 2.2 },
  width: 12,
};

export const BOSTON_COMMON: AABB2 = { x0: -1820, z0: 35, x1: -1700, z1: 150 };
export const CENTRAL_PARK: AABB2 = { x0: 1768, z0: -414, x1: 1992, z1: -216 };
export const PARKS = [BOSTON_COMMON, CENTRAL_PARK];

// Deep enough to sink a car (you get a few seconds with the fish, then a restart).
export const RIVER = { z: -296, halfWidth: 34, x0: WORLD.x0, x1: -1470, bank: 12, depth: 4.5 };
export const HARBOR_X = -2280;
export const WATER_LEVEL = -0.9;

// Start at the edge of Boston on the westbound side of the highway, facing into the city.
export const SPAWN = { x: -1395, z: -7, heading: -Math.PI / 2 };

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

const highway: Road = { pts: [[-1460, 0], [1460, 0]], width: 30, kind: 'highway' };

export const COUNTRY_ROADS: Road[] = [
  highway,
  // Off/on ramps to the dirt track
  { pts: [[-1000, -15], [-900, -40], [-780, -150], [-700, -270], [-690, TRACK.cz + TRACK.radius + 6]], width: 12, kind: 'ramp' },
  { pts: [[-510, TRACK.cz + TRACK.radius + 6], [-500, -270], [-420, -150], [-300, -40], [-200, -15]], width: 12, kind: 'ramp' },
  // Off/on ramps to the demolition park
  { pts: [[380, 15], [470, 50], [560, 160], [590, DEMO_PARK.z0 - 2]], width: 12, kind: 'ramp' },
  { pts: [[620, DEMO_PARK.z0 - 2], [660, 160], [740, 50], [820, 15]], width: 12, kind: 'ramp' },
  { pts: trackPolyline(), width: TRACK.width, kind: 'dirt', closed: true },
];

const bostonRoads: Road[] = [
  { pts: [[-1460, 0], [-1700, 12], [-1960, -8], [-2250, 4]], width: 18, kind: 'avenue' }, // the "Pike"
  { pts: [[-1460, -232], [-1800, -236], [-2250, -230]], width: 14, kind: 'avenue' }, // river drive
  { pts: [[-1470, -362], [-1800, -360], [-2250, -364]], width: 12, kind: 'street' }, // north bank
  { pts: [[-1690, 440], [-1676, 200], [-1684, 0], [-1680, -232], [-1680, -450]], width: 14, kind: 'avenue' }, // bridge road
  { pts: [[-2050, 440], [-2030, 220], [-2040, 0], [-2020, -232], [-2020, -450]], width: 14, kind: 'avenue' }, // bridge road
  { pts: [[-1470, 380], [-1650, 250], [-1860, 172], [-2080, 92], [-2250, 60]], width: 12, kind: 'street' },
  { pts: [[-1470, 140], [-1580, 118], [-1760, -110], [-1900, -142], [-2250, -150]], width: 12, kind: 'street' },
  { pts: [[-1840, 440], [-1850, 250], [-1832, 12]], width: 11, kind: 'street' },
  { pts: [[-2200, 440], [-2180, 250], [-2190, 4]], width: 11, kind: 'street' },
  { pts: [[-1560, -232], [-1545, -60], [-1562, 132]], width: 11, kind: 'street' },
  { pts: [[-1470, 300], [-1850, 318], [-2250, 330]], width: 12, kind: 'street' },
  { pts: [[-1880, -232], [-1900, -142]], width: 10, kind: 'street' },
  { pts: [[-2250, 440], [-2250, -450]], width: 12, kind: 'street' }, // harbor front
];

function nycRoads(): Road[] {
  const roads: Road[] = [];
  for (let x = 1520; x <= 2240; x += 120) roads.push({ pts: [[x, -450], [x, 450]], width: 16, kind: 'avenue' });
  for (let z = -420; z <= 420; z += 70) {
    roads.push({ pts: [[1450, z], [2350, z]], width: z === 0 ? 20 : 12, kind: z === 0 ? 'avenue' : 'street' });
  }
  roads.push({ pts: [[1470, -450], [1900, -40], [2340, 440]], width: 14, kind: 'avenue' }); // "Broadway"
  return roads;
}

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
  const river = (1 - smoothstep(halfWidth, halfWidth + bank, riverD)) * (1 - smoothstep(x1 - 40, x1, x));
  const harbor = 1 - smoothstep(HARBOR_X, HARBOR_X + bank, x);
  return depth * Math.max(river, harbor);
}

/** Areas that must stay flat (cities, parks, track, ramps…), as distance-to-flat. */
function distToFlat(x: number, z: number) {
  let d = Math.min(
    distOutsideAABB(x, z, BOSTON),
    distOutsideAABB(x, z, NYC),
    distOutsideAABB(x, z, DEMO_PARK) - 10,
    distOutsideAABB(x, z, TRACK_BOUNDS) - 10,
  );
  if (d > 0) d = Math.min(d, distToRoad(x, z, COUNTRY_ROADS) - 8);
  return d;
}

/** Ground height before roads/buildings are added. Rolling hills in the countryside, flat elsewhere. */
export function heightAt(x: number, z: number) {
  const hills =
    16 * (valueNoise(x / 260 + 11, z / 260 - 4) - 0.35) +
    6 * (valueNoise(x / 90 + 7, z / 90 + 3) - 0.5);
  const flat = smoothstep(0, 90, distToFlat(x, z));
  // Push the far edges up so the world feels bowl-shaped rather than ending abruptly.
  const edge = Math.max(
    smoothstep(WORLD.z1 - 260, WORLD.z1, z),
    smoothstep(WORLD.z0 + 260, WORLD.z0, z),
  ) * 30;
  return Math.max(hills, -2) * flat + edge * flat - waterDepth(x, z);
}

export function surfaceAt(x: number, z: number): Surface {
  const depth = waterDepth(x, z);
  const road = roadAt(x, z);
  if (road === 'dirt') return 'dirt';
  if (road) return 'asphalt';
  if (depth > 1.2) return 'water';
  if (depth > 0.05) return 'sand';
  if (inAABB(x, z, DEMO_PARK)) return 'dirt';
  for (const p of PARKS) if (inAABB(x, z, p)) return 'grass';
  if (inAABB(x, z, BOSTON) || inAABB(x, z, NYC)) return 'concrete';
  return 'grass';
}

/** Speed-boost pads: driving over one gives a short burst of extra power. */
export interface BoostPad { x: number; z: number; heading: number; length: number; width: number }
export const BOOST_PADS: BoostPad[] = [
  { x: -500, z: 7, heading: Math.PI / 2, length: 10, width: 6 },
  { x: 300, z: -7, heading: -Math.PI / 2, length: 10, width: 6 },
  { x: LOOP.x + 70, z: LOOP.z - LOOP.lateral, heading: -Math.PI / 2, length: 10, width: 6 }, // lines up with the loop entry lane
  // Demolition park: one before each mega ramp
  { x: 478, z: 440, heading: Math.PI / 2, length: 10, width: 8 },
  { x: 463, z: 560, heading: Math.PI / 2, length: 10, width: 8 },
];

/** Bridges where roads cross the river: flat decks at road level. */
export interface Bridge { x: number; z0: number; z1: number; width: number }
export const BRIDGES: Bridge[] = [-1680, -2020, -2250].map((x) => ({
  x,
  z0: RIVER.z - RIVER.halfWidth - RIVER.bank - 4,
  z1: RIVER.z + RIVER.halfWidth + RIVER.bank + 4,
  width: 16,
}));

/** Is this spot deep water (car would sink)? */
export const isDeepWater = (x: number, z: number) => waterDepth(x, z) > -WATER_LEVEL + 1.0 && !bridgeAt(x, z);

export function bridgeAt(x: number, z: number) {
  return BRIDGES.some((b) => Math.abs(x - b.x) <= b.width / 2 && z >= b.z0 && z <= b.z1);
}
