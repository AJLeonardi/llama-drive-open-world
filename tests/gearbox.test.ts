import { describe, expect, it } from 'vitest';
import { Gearbox } from '../src/vehicles/Gearbox';
import { SPECS } from '../src/vehicles/VehicleSpec';

describe('gearbox (engine sound model)', () => {
  for (const id of ['bronco', 'lambo', 'wrangler'] as const) {
    it(`${id}: climbs through all gears and stays within idle..redline`, () => {
      const s = SPECS[id];
      const gb = new Gearbox(s.engine, s.topSpeed);
      let maxGear = 0;
      for (let v = 0; v <= s.topSpeed; v += 0.05) {
        const rpm = gb.update(1 / 60, v, 1);
        expect(rpm).toBeGreaterThanOrEqual(s.engine.idleRpm - 1);
        expect(rpm).toBeLessThanOrEqual(s.engine.redlineRpm + 1);
        maxGear = Math.max(maxGear, gb.gear);
      }
      expect(maxGear).toBe(s.engine.gears - 1);
    });
  }

  it('the V12 revs higher than the V6s', () => {
    expect(SPECS.lambo.engine.redlineRpm).toBeGreaterThan(SPECS.bronco.engine.redlineRpm);
    expect(SPECS.lambo.engine.cylinders).toBe(12);
    expect(SPECS.bronco.engine.turbo).toBe(true);
  });
});
