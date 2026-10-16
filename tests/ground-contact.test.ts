import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT, Physics, initPhysics } from '../src/physics/Physics';
import { ImpactTracker } from '../src/physics/Impacts';
import { HEALTHY, VehicleSim } from '../src/vehicles/VehicleSim';
import { SPECS } from '../src/vehicles/VehicleSpec';
import { CHUNK, TERRAIN_CELL } from '../src/world/bounds';
import { heightAt, surfaceAt } from '../src/world/layout';
import { HIGHWAYS, besideHighway, highwayCoords, pointAt, profileAt } from '../src/world/outer';
import { groundPiece } from '../src/world/terrain';

const q = { surfaceAt, inStickZone: () => false, boostAt: () => false };

/** Real ground chunks (as OuterWorld builds them) around a spot. */
function groundAround(physics: Physics, x: number, z: number) {
  const N = CHUNK / TERRAIN_CELL;
  for (let ix = Math.floor(x / CHUNK) - 1; ix <= Math.floor(x / CHUNK) + 1; ix++)
    for (let iz = Math.floor(z / CHUNK) - 1; iz <= Math.floor(z / CHUNK) + 1; iz++) {
      const x0 = ix * CHUNK, z0 = iz * CHUNK;
      groundPiece(physics, x0, z0, N + 1, N + 1, (b, a) => heightAt(x0 + b * TERRAIN_CELL, z0 + a * TERRAIN_CELL));
    }
}

describe('car body against the ground', () => {
  beforeAll(() => initPhysics());

  it('a lambo flat out over a highway crest has no phantom crash', () => {
    // RT 5 eastbound crest where a speculative contact on a heightfield vertex used to stop the car dead.
    const h = HIGHWAYS[4], lane = 7, from = 1900, to = 2350;
    const physics = new Physics();
    groundAround(physics, pointAt(h, 2100).x, pointAt(h, 2100).z);
    const [x, z] = besideHighway(h, from, lane);
    const u = pointAt(h, from);
    const car = new VehicleSim(physics, SPECS.lambo, x, profileAt(h, from) + 1, z, Math.atan2(u.ux, u.uz));
    car.body.setLinvel({ x: u.ux * 66, y: 0, z: u.uz * 66 }, true);
    const tr = new ImpactTracker(physics, car.collider);
    let worst = 0, minSpeed = Infinity;
    for (let step = 0; step < 60 * 20; step++) {
      const p = car.body.translation();
      const c = highwayCoords(h, p.x, p.z);
      if (c.s > to) break;
      const [tx0, tz0] = besideHighway(h, c.s + 40, lane);
      const f = car.forward();
      const tx = tx0 - p.x, tz = tz0 - p.z, tl = Math.hypot(tx, tz);
      const steer = Math.max(-1, Math.min(1, ((f.x * tz - f.z * tx) / tl) * 3));
      car.update(FIXED_DT, { steer, throttle: 1, reverse: 0 }, HEALTHY, q);
      tr.beforeStep();
      physics.step();
      if (step > 30) minSpeed = Math.min(minSpeed, car.speed);
      for (const imp of tr.collect()) worst = Math.max(worst, imp.impulse / SPECS.lambo.mass);
    }
    physics.dispose();
    expect(worst).toBeLessThan(3);
    expect(minSpeed).toBeGreaterThan(60);
  });

  for (const [name, flip] of [['upright', false], ['upside down', true]] as const)
    it(`a car dropped ${name} from high up lands on the ground, not through it`, () => {
      const h = HIGHWAYS[4];
      const { x, z } = pointAt(h, 2100);
      const physics = new Physics();
      groundAround(physics, x, z);
      const g = heightAt(x, z);
      const car = new VehicleSim(physics, SPECS.lambo, x, g + 15, z, 0.3);
      if (flip) car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
      car.body.setLinvel({ x: 0, y: -25, z: 0 }, true);
      let lowest = Infinity;
      for (let step = 0; step < 60 * 4; step++) {
        car.update(FIXED_DT, { steer: 0, throttle: 0, reverse: 0 }, HEALTHY, q);
        physics.step();
        lowest = Math.min(lowest, car.body.translation().y - g);
      }
      const rest = car.body.translation().y - g;
      physics.dispose();
      expect(lowest).toBeGreaterThan(-0.5);
      expect(rest).toBeGreaterThan(-0.2);
      expect(rest).toBeLessThan(2);
    });
});
