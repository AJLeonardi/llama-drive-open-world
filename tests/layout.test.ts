import { describe, expect, it } from 'vitest';
import {
  BOSTON, BRIDGES, NYC, SPAWN, WATER_LEVEL, heightAt, isDeepWater, roadAt, surfaceAt, waterDepth, JUMP, TRACK,
  DEMO_PARK, LAKE, MOUNTAIN, PARK_ROAD, TRACK_BOUNDS, TRACK_ROAD, ALL_ROADS, MOUNTAIN_ROAD, roadSegments,
} from '../src/world/layout';
import { distToSegment, inAABB } from '../src/util/math';

describe('world layout', () => {
  it('the car spawns on the highway between the two cities', () => {
    expect(roadAt(SPAWN.x, SPAWN.z)).toBe('highway');
    expect(surfaceAt(SPAWN.x, SPAWN.z)).toBe('asphalt');
    expect(SPAWN.x).toBeGreaterThan(BOSTON.x1);
    expect(SPAWN.x).toBeLessThan(NYC.x0);
    expect(heightAt(SPAWN.x, SPAWN.z)).toBeCloseTo(0, 3);
  });

  it('the highway connects Boston to NYC and stays flat', () => {
    for (let x = BOSTON.x1 + 5; x <= NYC.x0 - 5; x += 10) {
      expect(roadAt(x, 0)).toBe('highway');
      expect(Math.abs(heightAt(x, 0))).toBeLessThan(0.01);
    }
  });

  it('the dirt track is dirt', () => {
    expect(surfaceAt((JUMP.takeoff.x0 + JUMP.landing.x1) / 2, JUMP.z)).toBe('dirt');
    expect(surfaceAt(TRACK.cx, TRACK.cz - TRACK.radius)).toBe('dirt');
  });

  it('the river is deep enough to sink in, except on the bridges', () => {
    const b = BRIDGES[0];
    const midZ = (b.z0 + b.z1) / 2;
    expect(isDeepWater(b.x + 40, midZ)).toBe(true);
    expect(waterDepth(b.x + 40, midZ) - -WATER_LEVEL).toBeGreaterThan(2);
    expect(isDeepWater(b.x, midZ)).toBe(false);
    expect(surfaceAt(b.x, midZ)).toBe('asphalt');
  });

  it('the places are a few seconds apart at Bronco speed (~47 m/s)', () => {
    // (NYC is further out east, towards Mariano-ville.)
    const gap = NYC.x0 - BOSTON.x1;
    expect(gap / 47).toBeGreaterThan(15);
    expect(gap / 47).toBeLessThan(25);
    // Track (north) and park (south) are each 4–7 s from the city corners.
    for (const d of [BOSTON.z0 - TRACK_BOUNDS.z1, DEMO_PARK.z0 - BOSTON.z1]) {
      expect(d / 47).toBeGreaterThan(4);
      expect(d / 47).toBeLessThan(7);
    }
  });

  it('the roads out to the track and the park are connected at both ends', () => {
    expect(roadAt(TRACK_ROAD.pts[0][0], 0)).toBe('highway');
    expect(roadAt(PARK_ROAD.pts[0][0], 0)).toBe('highway');
    const end = TRACK_ROAD.pts[TRACK_ROAD.pts.length - 1];
    expect(roadAt(end[0], end[1] - 6)).toBe('dirt');
    const gate = PARK_ROAD.pts[PARK_ROAD.pts.length - 1];
    expect(inAABB(gate[0], gate[1] + 4, DEMO_PARK)).toBe(true);
  });

  it('Thunder Mountain: a plateau with cliffs, and a road that climbs steadily to the top', () => {
    const { x, z, r, h, road, cliff, gap } = MOUNTAIN;
    expect(heightAt(x, z)).toBeGreaterThan(h - 1);
    // Cliff side: plateau edge to the ground within a few metres.
    const out = (d: number) => heightAt(x + Math.sin(cliff) * d, z + Math.cos(cliff) * d);
    expect(out(r - 2)).toBeGreaterThan(h - 1);
    expect(out(r + 10)).toBeLessThan(1);
    // The road: from the foot to the top, never steeper than ~12 % along its centre line.
    const rr = r + road / 2;
    let prev = -1;
    const n = 300;
    for (let i = 0; i <= n; i++) {
      const a = cliff + gap + 0.01 + ((2 * Math.PI - 2 * gap - 0.02) * i) / n;
      const y = heightAt(x + Math.sin(a) * rr, z + Math.cos(a) * rr);
      if (prev >= 0) expect(Math.abs(y - prev) / ((rr * (2 * Math.PI - 2 * gap)) / n)).toBeLessThan(0.12);
      prev = y;
    }
    expect(prev).toBeGreaterThan(h - 2);
    expect(surfaceAt(x + Math.sin(cliff + gap + 1) * rr, z + Math.cos(cliff + gap + 1) * rr)).toBe('dirt');
  });

  it('no street just stops: every road end meets another road (except the park gate and the mountain foot)', () => {
    const lonely: string[] = [];
    ALL_ROADS.forEach((r, i) => {
      if (r.closed || r === PARK_ROAD || r === MOUNTAIN_ROAD) return;
      for (const end of [r.pts[0], r.pts[r.pts.length - 1]]) {
        const touches = ALL_ROADS.some((o, j) => j !== i && roadSegments(o).some(([a, b]) => distToSegment(end[0], end[1], a[0], a[1], b[0], b[1]).d <= o.width / 2 + 1));
        if (!touches) lonely.push(`${r.kind} ending at ${end.map(Math.round)}`);
      }
    });
    expect(lonely).toEqual([]);
  });

  it('the lake under the cliff is deep enough to sink in', () => {
    expect(isDeepWater(LAKE.x, LAKE.z)).toBe(true);
  });

  it('both cities are flat ground (apart from water)', () => {
    for (const box of [BOSTON, NYC])
      for (let i = 0; i < 50; i++) {
        const x = box.x0 + ((box.x1 - box.x0) * i) / 49, z = box.z0 + 40;
        if (waterDepth(x, z) === 0 && inAABB(x, z, box, -20)) expect(Math.abs(heightAt(x, z))).toBeLessThan(0.01);
      }
  });
});
