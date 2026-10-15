import { describe, expect, it } from 'vitest';
import {
  applyDamage, carDamage, damageStage, dentDepth, handicapFor, objectDamage, MAX_HEALTH,
} from '../src/damage/Damage';
import { SPECS } from '../src/vehicles/VehicleSpec';

describe('damage math', () => {
  const { mass, durability } = SPECS.wrangler;

  it('gentle bumps do no damage', () => {
    expect(carDamage(mass * 2, mass, durability)).toBe(0);
  });

  it('faster crashes do more damage to the car', () => {
    const slow = carDamage(mass * 8, mass, durability);
    const fast = carDamage(mass * 25, mass, durability);
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow * 2);
  });

  it('tougher cars take less damage from the same crash', () => {
    const dv = 20;
    const bronco = carDamage(SPECS.bronco.mass * dv, SPECS.bronco.mass, SPECS.bronco.durability);
    const lambo = carDamage(SPECS.lambo.mass * dv, SPECS.lambo.mass, SPECS.lambo.durability);
    expect(bronco).toBeLessThan(lambo);
  });

  it('bigger impulse and bigger car = more damage to the object', () => {
    expect(objectDamage(20000, 2000, 10000)).toBeGreaterThan(objectDamage(10000, 2000, 10000));
    // Same impulse, heavier car still hits harder.
    expect(objectDamage(10000, SPECS.bronco.mass, 10000)).toBeGreaterThan(objectDamage(10000, SPECS.lambo.mass, 10000));
  });

  it('health only ever goes down and stops at zero', () => {
    let h = MAX_HEALTH;
    h = applyDamage(h, 30);
    expect(h).toBe(70);
    h = applyDamage(h, -50); // negative damage never heals
    expect(h).toBe(70);
    h = applyDamage(h, 500);
    expect(h).toBe(0);
  });

  it('damage stages make the car drive worse', () => {
    expect(damageStage(100)).toBe(0);
    expect(damageStage(70)).toBe(1);
    expect(damageStage(45)).toBe(2);
    expect(damageStage(20)).toBe(3);
    expect(damageStage(0)).toBe(4);
    // A battered car still drives at full speed; only a wrecked one stops.
    const healthy = handicapFor(100), hurt = handicapFor(5), wrecked = handicapFor(0);
    expect(hurt).toEqual(healthy);
    expect(wrecked.engineCut).toBe(true);
    expect(wrecked.power).toBe(0);
  });

  it('dents get deeper with harder hits but are capped', () => {
    expect(dentDepth(5)).toBeGreaterThan(dentDepth(2));
    expect(dentDepth(30)).toBeGreaterThan(dentDepth(5));
    expect(dentDepth(500)).toBeLessThanOrEqual(1.5);
    expect(dentDepth(34)).toBeGreaterThan(0.8); // ~70 mph into a wall crushes the front
  });
});

describe('tearing', () => {
  it('only crushed metal tears, harder hits tear more, and the hole stays put', async () => {
    const THREE = await import('three');
    const { dentGeometry, tearGeometry } = await import('../src/damage/Deformer');
    const make = () => {
      const g = new THREE.PlaneGeometry(2, 2, 20, 20);
      return { g, orig: (g.attributes.position.array as Float32Array).slice() };
    };
    const at = new THREE.Vector3(0, 0, 0), into = new THREE.Vector3(0, 0, -1);
    // A light dent doesn't tear.
    const a = make();
    dentGeometry(a.g, a.orig, at, into, 0.1, 0.8, 1.5);
    expect(tearGeometry(a.g, a.orig, at, 0.8, 0.9).torn).toBe(0);
    // A deep crush does, more with a bigger hit.
    const b = make(), c = make();
    for (const m of [b, c]) dentGeometry(m.g, m.orig, at, into, 1.2, 0.9, 1.5);
    const small = tearGeometry(b.g, b.orig, at, 0.8, 0.2).torn, big = tearGeometry(c.g, c.orig, at, 0.8, 0.8).torn;
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small);
    // Tearing again with the same strength tears nothing new.
    expect(tearGeometry(c.g, c.orig, at, 0.8, 0.8).torn).toBe(0);
  });
});
