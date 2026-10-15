import { describe, expect, it } from 'vitest';
import {
  BOSTON, BRIDGES, NYC, SPAWN, WATER_LEVEL, heightAt, isDeepWater, roadAt, surfaceAt, waterDepth, JUMP, TRACK,
} from '../src/world/layout';
import { inAABB } from '../src/util/math';

describe('world layout', () => {
  it('the car spawns on the highway between the two cities', () => {
    expect(roadAt(SPAWN.x, SPAWN.z)).toBe('highway');
    expect(surfaceAt(SPAWN.x, SPAWN.z)).toBe('asphalt');
    expect(SPAWN.x).toBeGreaterThan(BOSTON.x1);
    expect(SPAWN.x).toBeLessThan(NYC.x0);
    expect(heightAt(SPAWN.x, SPAWN.z)).toBeCloseTo(0, 3);
  });

  it('the highway connects Boston to NYC and stays flat', () => {
    for (let x = -1400; x <= 1400; x += 50) {
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

  it('both cities are flat ground (apart from water)', () => {
    for (const box of [BOSTON, NYC])
      for (let i = 0; i < 50; i++) {
        const x = box.x0 + ((box.x1 - box.x0) * i) / 49, z = box.z0 + 40;
        if (waterDepth(x, z) === 0 && inAABB(x, z, box, -20)) expect(Math.abs(heightAt(x, z))).toBeLessThan(0.01);
      }
  });
});
