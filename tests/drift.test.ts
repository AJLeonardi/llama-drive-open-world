import { expect, it } from 'vitest';
import { makeTestbed } from './helpers';
import { CAR_IDS } from '../src/vehicles/VehicleSpec';

/** Hold full steering + gas at ~55 mph, then let go of the steering. */
async function drift(id: (typeof CAR_IDS)[number], surface: 'asphalt' | 'dirt') {
  const { car, run } = await makeTestbed(id, surface);
  const slipDeg = () => {
    const v = car.body.linvel(), f = car.forward();
    const sp = Math.hypot(v.x, v.z);
    return sp < 3 ? 0 : (Math.acos(Math.min(1, (v.x * f.x + v.z * f.z) / (sp * Math.hypot(f.x, f.z)))) * 180) / Math.PI;
  };
  car.body.setLinvel({ x: 0, y: 0, z: 25 }, true);
  run(0.2, { steer: 0, throttle: 1, reverse: 0 });
  let maxSlip = 0, maxYaw = 0, minUp = 1;
  run(2.5, { steer: 1, throttle: 1, reverse: 0 }, () => {
    maxSlip = Math.max(maxSlip, slipDeg());
    maxYaw = Math.max(maxYaw, Math.abs(car.body.angvel().y));
    minUp = Math.min(minUp, car.up().y);
  });
  const speedInDrift = car.speed;
  run(1.5, { steer: 0, throttle: 1, reverse: 0 });
  return { maxSlip, maxYaw, minUp, speedInDrift, slipAfter: slipDeg() };
}

for (const id of CAR_IDS)
  it(`${id} drifts when turning hard on the gas: more on dirt, never spins out, straightens up after`, async () => {
    const a = await drift(id, 'asphalt'), d = await drift(id, 'dirt');
    expect(a.maxSlip).toBeGreaterThan(12);
    expect(a.maxSlip).toBeLessThan(32);
    expect(d.maxSlip).toBeGreaterThan(a.maxSlip + 8);
    expect(d.maxSlip).toBeLessThan(50);
    for (const r of [a, d]) {
      expect(r.maxYaw).toBeLessThan(2.2); // no spinning round
      expect(r.minUp).toBeGreaterThan(0.8); // no rolling over
      expect(r.speedInDrift).toBeGreaterThan(12); // keeps its speed up
      expect(r.slipAfter).toBeLessThan(5); // straight again after letting go
    }
  });
