import { expect, it } from 'vitest';
import { CAR_IDS } from '../src/vehicles/VehicleSpec';
import { RAPIER } from '../src/physics/Physics';
import { loopGeometry } from '../src/world/dirtTrack';
import { LOOP } from '../src/world/layout';
import { HEALTHY } from '../src/vehicles/VehicleSim';
import { makeTestbed } from './helpers';
import { FIXED_DT } from '../src/physics/Physics';

for (const id of CAR_IDS) it(`${id} can drive all the way round the loop`, async () => {
  const { physics, car } = await makeTestbed(id);
  const { pos, idx } = loopGeometry();
  physics.registerLoop(physics.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx))));
  const q = {
    surfaceAt: () => 'dirt' as const,
    inStickZone: (x: number, z: number) => Math.abs(x - LOOP.x) < LOOP.radius + 12 && Math.abs(z - LOOP.z) < LOOP.lateral + LOOP.width / 2 + 1,
    boostAt: () => false,
    loopLaneZ: (t: number) => LOOP.z - LOOP.lateral + 2 * LOOP.lateral * t,
  };
  const h = -Math.PI / 2;
  const { extent } = loopGeometry();
  car.body.setTranslation({ x: extent.x1 + 30, y: 0.2, z: LOOP.z - LOOP.lateral }, true);
  car.body.setRotation({ x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) }, true);
  car.body.setLinvel({ x: -28, y: 0, z: 0 }, true);
  let maxY = 0, minUp = 1;
  const log: string[] = [];
  for (let i = 0; i < 60 * 6; i++) {
    car.update(FIXED_DT, { steer: 0, throttle: 1, reverse: 0 }, HEALTHY, q);
    physics.step();
    const p = car.position;
    maxY = Math.max(maxY, p.y);
    minUp = Math.min(minUp, car.up().y);
    if (i % 6 === 0 && i < 300) log.push(`${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} up=${car.up().y.toFixed(2)} v=${car.speed.toFixed(1)} w=${car.wheelsInContact}`);
  }
  void log;
  expect(maxY).toBeGreaterThan(LOOP.radius * 1.6); // got near the top
  expect(minUp).toBeLessThan(-0.5); // was upside down at the top
  expect(car.position.x).toBeLessThan(extent.x0 - 10); // came out the other side
});

async function loopRun(id: 'bronco' | 'lambo' | 'wrangler', speed: number, lateral: number, throttle: number) {
  const { physics, car } = await makeTestbed(id);
  const { pos, idx, extent } = loopGeometry();
  physics.registerLoop(physics.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx))));
  const q = {
    surfaceAt: () => 'dirt' as const,
    inStickZone: (x: number, z: number) => Math.abs(x - LOOP.x) < LOOP.radius + 12 && Math.abs(z - LOOP.z) < LOOP.lateral + LOOP.width / 2 + 1,
    boostAt: () => false,
    loopLaneZ: (t: number) => LOOP.z - LOOP.lateral + 2 * LOOP.lateral * t,
  };
  const h = -Math.PI / 2;
  car.body.setTranslation({ x: extent.x1 + 20, y: 0.2, z: LOOP.z + lateral }, true);
  car.body.setRotation({ x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) }, true);
  car.body.setLinvel({ x: -speed, y: 0, z: 0 }, true);
  let minY = 9;
  for (let i = 0; i < 60 * 8; i++) {
    car.update(FIXED_DT, { steer: 0, throttle, reverse: 0 }, HEALTHY, q);
    physics.step();
    minY = Math.min(minY, car.position.y);
  }
  return { car, minY, extent };
}

for (const id of CAR_IDS) {
  it(`${id}: too slow for the loop → rolls back, never falls through`, async () => {
    const { minY } = await loopRun(id, 10, -LOOP.lateral, 0);
    expect(minY).toBeGreaterThan(-0.6);
  });

  it(`${id}: entering on the wrong lane hits the loop instead of passing through it`, async () => {
    const { car, minY, extent } = await loopRun(id, 20, +LOOP.lateral, 1);
    expect(minY).toBeGreaterThan(-0.6);
    // Never ends up on the far side having driven straight through the exit ramp from below.
    expect(car.position.x > extent.x0 - 5 || car.position.y > 1).toBe(true);
  });
}
