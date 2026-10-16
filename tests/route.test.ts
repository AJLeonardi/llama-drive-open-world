import { describe, expect, it } from 'vitest';
import { findRoute, routeSeconds } from '../src/world/route';
import { ALL_ROADS, DEMO_PARK, MOUNTAIN, NYC, SPAWN, nearRoad } from '../src/world/layout';
import { TOWNS, townPoint } from '../src/world/outer';

const length = (p: readonly (readonly [number, number])[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);

describe('directions', () => {
  it('finds a sensible road route from the start to New York', () => {
    const tx = (NYC.x0 + NYC.x1) / 2, tz = 0;
    const p = findRoute(SPAWN.x, SPAWN.z, tx, tz);
    expect(p.length).toBeGreaterThan(10);
    expect(p[0]).toEqual([SPAWN.x, SPAWN.z]);
    expect(p[p.length - 1]).toEqual([tx, tz]);
    // Not a crazy detour…
    expect(length(p)).toBeLessThan(Math.hypot(tx - SPAWN.x, tz - SPAWN.z) * 1.4);
    // …and it stays on the roads in between.
    for (const q of p.slice(1, -1)) expect(nearRoad(q[0], q[1], 1)).toBe(true);
  });

  it('goes up the mountain road to the top of Thunder Mountain', () => {
    const p = findRoute(SPAWN.x, SPAWN.z, MOUNTAIN.x, MOUNTAIN.z);
    const last = p[p.length - 2]; // the last road point before the target
    expect(Math.hypot(last[0] - MOUNTAIN.x, last[1] - MOUNTAIN.z)).toBeLessThan(1);
    expect(length(p)).toBeGreaterThan(2 * Math.PI * MOUNTAIN.r); // it climbs round the spiral
  });

  it('leads into the demolition park through the gate', () => {
    const p = findRoute(SPAWN.x, SPAWN.z, (DEMO_PARK.x0 + DEMO_PARK.x1) / 2, (DEMO_PARK.z0 + DEMO_PARK.z1) / 2);
    const gate = p[p.length - 2];
    expect(Math.abs(gate[1] - DEMO_PARK.z0)).toBeLessThan(10);
  });

  it('every road can be reached from the start (the road network is all connected)', () => {
    for (const road of ALL_ROADS)
      for (const q of [road.pts[0], road.pts[Math.floor(road.pts.length / 2)]]) {
        const p = findRoute(SPAWN.x, SPAWN.z, q[0], q[1]);
        expect(p.length, `road ending at ${q.map(Math.round)}`).toBeGreaterThan(2);
      }
  });
});

describe('directions in highway country', () => {
  it('reaches a far corner of the map by highway', async () => {
    const { HIGHWAYS, pointAt } = await import('../src/world/outer');
    const h = HIGHWAYS[HIGHWAYS.length - 1];
    const { x: tx, z: tz } = pointAt(h, h.len * 0.5);
    const t0 = performance.now();
    const p = findRoute(SPAWN.x, SPAWN.z, tx, tz);
    const ms = performance.now() - t0;
    expect(p.length).toBeGreaterThan(10);
    expect(Math.hypot(p[p.length - 2][0] - tx, p[p.length - 2][1] - tz)).toBeLessThan(40);
    expect(ms).toBeLessThan(400); // (includes building the road graph the first time)
  });

  it('never turns from one highway onto another where they only cross on a bridge', async () => {
    const { CROSSINGS, HIGHWAYS, pointAt } = await import('../src/world/outer');
    for (const c of CROSSINGS.slice(0, 8)) {
      const U = pointAt(HIGHWAYS[c.upper], c.sUpper), L = pointAt(HIGHWAYS[c.lower], c.sLower);
      // From just before the crossing on the upper road to just after it on the lower one.
      // Turning at the bridge would be ~240 m; the real way round, by a ramp, is longer.
      const p = findRoute(c.x - U.ux * 120, c.z - U.uz * 120, c.x + L.ux * 120, c.z + L.uz * 120);
      expect(length(p)).toBeGreaterThan(400);
    }
  });

  it('finds the way to every town, right into its streets', () => {
    for (const t of TOWNS) {
      const [tx, tz] = t.kind === 'dc' ? townPoint(t, 180, 0) : townPoint(t, 0, (t.area.b0 + t.area.b1) / 2);
      const p = findRoute(SPAWN.x, SPAWN.z, tx, tz);
      const last = p[p.length - 2];
      expect(Math.hypot(last[0] - tx, last[1] - tz), t.name).toBeLessThan(60);
      expect(length(p), t.name).toBeLessThan(Math.hypot(tx - SPAWN.x, tz - SPAWN.z) * 2.6); // (round by the interchanges)
    }
  });

  it('estimates the time to get there, counting down along the way', () => {
    const tx = (NYC.x0 + NYC.x1) / 2, tz = 0;
    const p = findRoute(SPAWN.x, SPAWN.z, tx, tz);
    expect(p.pace.length).toBe(p.length - 1);
    expect(p.turns.length).toBe(p.length - 1);
    const top = 47;
    const start = routeSeconds(p, SPAWN.x, SPAWN.z, top);
    // Somewhere between flat out all the way and a slow crawl.
    expect(start).toBeGreaterThan(length(p) / top);
    expect(start).toBeLessThan(length(p) / (top * 0.3));
    // Further along the way, less time left; at the end, none.
    let last = start;
    for (const q of p.slice(1, -1).filter((_, i) => i % 10 === 0)) {
      const s = routeSeconds(p, q[0], q[1], top);
      expect(s).toBeLessThanOrEqual(last + 1e-6);
      last = s;
    }
    expect(routeSeconds(p, tx, tz, top)).toBeCloseTo(0);
    // A faster car gets there sooner.
    expect(routeSeconds(p, SPAWN.x, SPAWN.z, 72)).toBeLessThan(start);
  });
});
