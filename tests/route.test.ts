import { describe, expect, it } from 'vitest';
import { findRoute } from '../src/world/route';
import { ALL_ROADS, DEMO_PARK, MOUNTAIN, NYC, SPAWN, nearRoad } from '../src/world/layout';

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
