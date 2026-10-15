import { describe, expect, it } from 'vitest';
import { RAPIER } from '../src/physics/Physics';
import { ImpactTracker } from '../src/physics/Impacts';
import { carDamage, objectDamage } from '../src/damage/Damage';
import { CAR_IDS, SPECS } from '../src/vehicles/VehicleSpec';
import { makeTestbed } from './helpers';

const GAS = { steer: 0, throttle: 1, reverse: 0 };
const COAST = { steer: 0, throttle: 0, reverse: 0 };

describe('driving', () => {
  it('each car reaches roughly its top speed, Lambo fastest', async () => {
    const tops: Record<string, number> = {};
    for (const id of CAR_IDS) {
      const { car, run } = await makeTestbed(id);
      run(30, GAS);
      tops[id] = car.speed;
      expect(car.speed).toBeGreaterThan(SPECS[id].topSpeed * 0.9);
      expect(car.speed).toBeLessThan(SPECS[id].topSpeed * 1.1);
    }
    expect(tops.lambo).toBeGreaterThan(tops.bronco);
    expect(tops.lambo).toBeGreaterThan(tops.wrangler);
  });

  it('lifting off the gas coasts down slowly, and faster on grass than asphalt', async () => {
    const coastLoss = async (surface: 'asphalt' | 'grass') => {
      const { car, run } = await makeTestbed('wrangler', surface);
      car.body.setLinvel({ x: 0, y: 0, z: 20 }, true);
      run(0.1, COAST);
      const v0 = car.speed;
      run(3, COAST);
      return v0 - car.speed;
    };
    const asphalt = await coastLoss('asphalt');
    const grass = await coastLoss('grass');
    expect(asphalt).toBeGreaterThan(0.5); // it does slow down…
    expect(asphalt).toBeLessThan(8); // …but gently, no brake
    expect(grass).toBeGreaterThan(asphalt);
  });

  it('reverse pedal slows the car first, then backs up', async () => {
    const { car, run } = await makeTestbed('bronco');
    car.body.setLinvel({ x: 0, y: 0, z: 15 }, true);
    run(0.1, COAST);
    run(1, { steer: 0, throttle: 0, reverse: 1 });
    expect(car.speed).toBeLessThan(10);
    run(4, { steer: 0, throttle: 0, reverse: 1 });
    expect(car.speed).toBeLessThan(-3);
  });

  it('the back pedal brakes hard: 60 mph to a stop in under 2 seconds', async () => {
    for (const id of CAR_IDS) {
      const { car, run } = await makeTestbed(id);
      car.body.setLinvel({ x: 0, y: 0, z: 26.8 }, true);
      run(0.05, COAST);
      let t = 0;
      run(4, { steer: 0, throttle: 0, reverse: 1 }, () => { if (car.speed > 0.5) t += 1 / 60; });
      expect(t).toBeLessThan(2);
    }
  });

  it('no car scrapes its body on the road at top speed', async () => {
    for (const id of CAR_IDS) {
      const { physics, car, run } = await makeTestbed(id);
      let contacts = 0, minGap = 9;
      run(15, GAS, () => {
        physics.events.drainContactForceEvents(() => contacts++);
        minGap = Math.min(minGap, car.position.y + car.spec.chassisY - car.spec.half.y);
      });
      expect(contacts).toBe(0);
      expect(minGap).toBeGreaterThan(0.2); // room for seams, curbs and bumps
    }
  });

  it('rolls downhill when coasting', async () => {
    const { physics, car, run } = await makeTestbed('wrangler');
    // Replace flat ground with a 6° slope falling toward +z.
    const slope = 0.1;
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(200, 1, 200).setTranslation(0, 2, 0).setRotation({ x: Math.sin(slope / 2), y: 0, z: 0, w: Math.cos(slope / 2) }),
    );
    car.body.setTranslation({ x: 0, y: 4, z: 0 }, true);
    run(6, COAST);
    expect(Math.abs(car.speed)).toBeGreaterThan(1.5);
  });
});

describe('crashing', () => {
  async function crashInto(id: 'bronco' | 'lambo', mph: number) {
    const { physics, car, run, beforeStep } = await makeTestbed(id);
    const wall = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(10, 3, 0.5).setTranslation(0, 3, 60));
    physics.setOwner(wall, { kind: 'building', material: 'concrete' });
    const tracker = new ImpactTracker(physics, car.collider);
    beforeStep.push(() => tracker.beforeStep());
    car.body.setTranslation({ x: 0, y: 0.1, z: 50 }, true);
    car.body.setLinvel({ x: 0, y: 0, z: mph / 2.237 }, true);
    let impulse = 0;
    let normalZ = 0;
    run(1.5, COAST, () => {
      for (const i of tracker.collect()) {
        impulse += i.impulse;
        normalZ = i.normal.z;
      }
    });
    return { impulse, normalZ, spec: SPECS[id] };
  }

  it('detects wall hits with a normal pointing into the wall', async () => {
    const r = await crashInto('bronco', 30);
    expect(r.impulse).toBeGreaterThan(0);
    expect(r.normalZ).toBeGreaterThan(0.9);
  });

  it('faster crash → more damage, at every speed tested', async () => {
    let prev = -1;
    for (const mph of [15, 30, 60]) {
      const r = await crashInto('lambo', mph);
      const dmg = carDamage(r.impulse, r.spec.mass, r.spec.durability);
      expect(dmg).toBeGreaterThan(prev);
      prev = dmg;
    }
  });

  it('pushing against a wall after a crash does no extra damage', async () => {
    const { physics, car, run, beforeStep } = await makeTestbed('lambo');
    const wall = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(10, 3, 0.5).setTranslation(0, 3, 60));
    physics.setOwner(wall, { kind: 'building', material: 'concrete' });
    const tracker = new ImpactTracker(physics, car.collider);
    beforeStep.push(() => tracker.beforeStep());
    car.body.setTranslation({ x: 0, y: 0.1, z: 50 }, true);
    car.body.setLinvel({ x: 0, y: 0, z: 24 }, true);
    const spec = SPECS.lambo;
    let first = 0, after = 0;
    run(1, COAST, () => { for (const i of tracker.collect()) first += carDamage(i.impulse, spec.mass, spec.durability); });
    run(3, GAS, () => { for (const i of tracker.collect()) after += carDamage(i.impulse, spec.mass, spec.durability); });
    expect(first).toBeGreaterThan(20);
    expect(first).toBeLessThan(90); // a 54 mph wall hit hurts a lot but isn't instantly fatal
    expect(after).toBeLessThan(2);
  });

  it('the Bronco hits the wall harder than the Lambo at the same speed', async () => {
    const b = await crashInto('bronco', 30);
    const l = await crashInto('lambo', 30);
    expect(objectDamage(b.impulse, b.spec.mass, 10000)).toBeGreaterThan(objectDamage(l.impulse, l.spec.mass, 10000));
  });
});
