// Directions: shortest way by road from one spot to another (pure data, no three.js).
//
// Every road is sampled into nodes a few metres apart, linked along the road and to any
// other road's nodes close by (that's how crossings, T-junctions and ramps join up).
// The way up Thunder Mountain's spiral (terrain, not a Road) is added as an extra path,
// and so is highway country. Straight highways never join each other directly (they
// cross on bridges): only through the ramps, and at the Ring.
import type { Vec2 } from '../util/math';
import { ALL_ROADS, MOUNTAIN, MOUNTAIN_ROAD } from './layout';
import { HIGHWAYS, HW, RAMPS, RAMP_HW, RING, TOWNS } from './outer';

const STEP = 8; // node spacing along a road (m)
const JOIN = 9; // nodes of different roads this close are connected (or within the wider road's half-width)
const CELL = 16;
/** Extra metres charged for each turn (> ~37°) on the way. */
const TURN_COST = 120;
/**
 * How fast each kind of road is driven, as a share of the car's top speed (for the time
 * to get there): flat out on highways, slower through corners and junctions in town.
 */
const PACE = { highway: 0.85, ramp: 0.6, avenue: 0.6, street: 0.5, town: 0.45, dirt: 0.45, mountain: 0.35, offroad: 0.3 };
/** Seconds lost at each turn (slowing down, cornering). */
const TURN_SECONDS = 2;

/** A way by road, with how fast each stretch of it goes (`pace[i]`: from pts[i] to pts[i + 1]). */
export type Route = Vec2[] & { pace: number[]; turns: number[] };

interface Graph {
  x: number[];
  z: number[];
  /** Half-width of the road each node is on. */
  hw: number[];
  /** Share of top speed on the road each node is on. */
  pace: number[];
  adj: number[][];
  grid: Map<number, number[]>;
}

const key = (ix: number, iz: number) => ix * 100003 + iz;

/** Centre line of the spiral road up the mountain, from the end of the dirt road to the top. */
function mountainPath(): Vec2[] {
  const { x, z, r, road, cliff, gap } = MOUNTAIN;
  const pts: Vec2[] = [MOUNTAIN_ROAD.pts[MOUNTAIN_ROAD.pts.length - 1]];
  const start = cliff + gap, sweep = 2 * Math.PI - 2 * gap, rr = r + road / 2;
  for (let i = 0; i <= 48; i++) {
    const a = start + 0.02 + ((sweep - 0.04) * i) / 48;
    pts.push([x + Math.sin(a) * rr, z + Math.cos(a) * rr]);
  }
  pts.push([x, z]);
  return pts;
}

function build(): Graph {
  const g: Graph = { x: [], z: [], hw: [], pace: [], adj: [], grid: new Map() };
  const owner: number[] = [];
  const isLine: boolean[] = [];
  const paths: { pts: Vec2[]; closed: boolean; hw: number; pace: number; line?: boolean; step?: number }[] = [
    ...ALL_ROADS.map((r) => ({ pts: r.pts, closed: !!r.closed, hw: r.width / 2, pace: PACE[r.kind] })),
    { pts: mountainPath(), closed: false, hw: 7, pace: PACE.mountain },
    ...HIGHWAYS.map((h) => ({ pts: h.pts.filter((_, i) => i % 2 === 0 || i === h.pts.length - 1), closed: false, hw: HW, pace: PACE.highway, line: true, step: 50 })),
    { pts: RING.pts.filter((_, i) => i % 2 === 0), closed: true, hw: HW, pace: PACE.highway, step: 50 },
    ...RAMPS.map((r) => ({ pts: r.pts, closed: false, hw: RAMP_HW, pace: PACE.ramp })),
    ...TOWNS.flatMap((t) => t.roads.map((r) => ({ pts: r.pts, closed: false, hw: r.hw, pace: PACE.town }))),
  ];
  paths.forEach((p, pi) => {
    const first = g.x.length;
    const n = p.pts.length;
    const add = (x: number, z: number) => {
      const id = g.x.length;
      g.x.push(x);
      g.z.push(z);
      g.hw.push(p.hw);
      g.pace.push(p.pace);
      g.adj.push([]);
      owner.push(pi);
      isLine.push(!!p.line);
      if (id > first) link(id - 1, id);
    };
    for (let i = 0; i < n - 1 + (p.closed ? 1 : 0); i++) {
      const a = p.pts[i], b = p.pts[(i + 1) % n];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (p.step ?? STEP)));
      for (let k = 0; k < steps; k++) add(a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps);
    }
    if (p.closed) link(g.x.length - 1, first);
    else add(p.pts[n - 1][0], p.pts[n - 1][1]);
  });
  function link(a: number, b: number) {
    if (!g.adj[a].includes(b)) g.adj[a].push(b);
    if (!g.adj[b].includes(a)) g.adj[b].push(a);
  }
  for (let i = 0; i < g.x.length; i++) {
    const k = key(Math.floor(g.x[i] / CELL), Math.floor(g.z[i] / CELL));
    let list = g.grid.get(k);
    if (!list) g.grid.set(k, (list = []));
    list.push(i);
  }
  // Join roads where they meet.
  for (let i = 0; i < g.x.length; i++) {
    const cx = Math.floor(g.x[i] / CELL), cz = Math.floor(g.z[i] / CELL);
    for (let ix = cx - 2; ix <= cx + 2; ix++)
      for (let iz = cz - 2; iz <= cz + 2; iz++)
        for (const j of g.grid.get(key(ix, iz)) ?? [])
          if (j > i && owner[j] !== owner[i] && !(isLine[i] && isLine[j]) && Math.hypot(g.x[i] - g.x[j], g.z[i] - g.z[j]) <= Math.max(JOIN, Math.max(g.hw[i], g.hw[j]) + 2)) link(i, j);
  }
  return g;
}

let graph: Graph | null = null;
const getGraph = () => (graph ??= build());

/** The road node closest to a spot. */
function nearest(x: number, z: number) {
  const g = getGraph();
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let best = -1, bestD = Infinity;
  for (let ring = 0; ring < 40 && (best < 0 || ring * CELL < bestD + CELL); ring++)
    for (let ix = cx - ring; ix <= cx + ring; ix++)
      for (let iz = cz - ring; iz <= cz + ring; iz++) {
        if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
        for (const i of g.grid.get(key(ix, iz)) ?? []) {
          const d = Math.hypot(g.x[i] - x, g.z[i] - z);
          if (d < bestD) (bestD = d), (best = i);
        }
      }
  if (best < 0) for (let i = 0; i < g.x.length; i++) {
    const d = Math.hypot(g.x[i] - x, g.z[i] - z);
    if (d < bestD) (bestD = d), (best = i);
  }
  return best;
}

/**
 * The way from (x0, z0) to (x1, z1): along the roads from the nearest road to the car to
 * the nearest road to the target, with straight legs on and off the road at each end.
 */
export function findRoute(x0: number, z0: number, x1: number, z1: number): Route {
  const g = getGraph();
  const s = nearest(x0, z0), t = nearest(x1, z1);
  const n = g.x.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const h = (i: number) => Math.hypot(g.x[i] - g.x[t], g.z[i] - g.z[t]);
  // A* with a binary heap of [f, node].
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  dist[s] = 0;
  push(h(s), s);
  while (heap.length) {
    const [f, i] = pop();
    if (i === t) break;
    if (f - h(i) > dist[i] + 1e-6) continue;
    const p = prev[i];
    for (const j of g.adj[i]) {
      let d = dist[i] + Math.hypot(g.x[i] - g.x[j], g.z[i] - g.z[j]);
      // Turning costs a bit extra, so the way prefers long straight roads over zig-zags
      // (much easier to follow, and the extra distance is small).
      if (p >= 0) {
        const ax = g.x[i] - g.x[p], az = g.z[i] - g.z[p], bx = g.x[j] - g.x[i], bz = g.z[j] - g.z[i];
        const cos = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1);
        if (cos < 0.8) d += TURN_COST;
      }
      if (d < dist[j]) {
        dist[j] = d;
        prev[j] = i;
        push(d + h(j), j);
      }
    }
  }
  const path: Vec2[] = [[x1, z1]];
  const pace = [PACE.offroad];
  const turns = [0];
  if (dist[t] < Infinity)
    for (let i = t; i >= 0; i = prev[i]) {
      path.push([g.x[i], g.z[i]]);
      // Each stretch goes at the pace of the road it ends on (so a junction counts as the new road).
      const j = prev[i], k = turns.length > 1 ? path[path.length - 2] : null;
      pace.push(j >= 0 ? g.pace[i] : PACE.offroad);
      let turn = 0;
      if (j >= 0 && k) {
        const ax = g.x[i] - g.x[j], az = g.z[i] - g.z[j], bx = k[0] - g.x[i], bz = k[1] - g.z[i];
        turn = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1) < 0.8 ? 1 : 0;
      }
      turns.push(turn);
    }
  path.push([x0, z0]);
  const route = path.reverse() as Route;
  // pace/turns were collected end-first, one per node; shift them onto the stretches.
  route.pace = pace.reverse();
  route.turns = turns.reverse();
  return route;
}

/**
 * Seconds to get from (x, z), somewhere along `route`, to its end, for a car with this top
 * speed: the rest of the stretch it's on plus every stretch after it, at each road's pace,
 * and a little for each turn still to come.
 */
export function routeSeconds(route: Route, x: number, z: number, topSpeed: number): number {
  const pts = route;
  let seg = 0, along = 0, best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
    if (d < best) (best = d), (seg = i), (along = t);
  }
  const v = (i: number) => Math.max(1, topSpeed * (route.pace[i] ?? PACE.street));
  const len = (i: number) => Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  // turns[i]: a turn where stretch i ends.
  let s = (len(seg) * (1 - along)) / v(seg) + (route.turns[seg] ?? 0) * TURN_SECONDS;
  for (let i = seg + 1; i < pts.length - 1; i++) s += len(i) / v(i) + (route.turns[i] ?? 0) * TURN_SECONDS;
  return s;
}
