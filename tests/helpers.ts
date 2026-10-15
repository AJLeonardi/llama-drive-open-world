import { FIXED_DT, Physics, RAPIER, initPhysics } from '../src/physics/Physics';
import type { Surface } from '../src/physics/surfaces';
import { DriveInput, HEALTHY, VehicleSim, WorldQueries } from '../src/vehicles/VehicleSim';
import { CarId, SPECS } from '../src/vehicles/VehicleSpec';

export const flatWorld = (surface: Surface = 'asphalt'): WorldQueries => ({
  surfaceAt: () => surface,
  inStickZone: () => false,
  boostAt: () => false,
});

export async function makeTestbed(id: CarId, ground: Surface = 'asphalt') {
  await initPhysics();
  const physics = new Physics();
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0));
  const car = new VehicleSim(physics, SPECS[id], 0, 0.3, 0, 0);
  const q = flatWorld(ground);
  const beforeStep: (() => void)[] = [];
  const run = (seconds: number, input: DriveInput, onStep?: () => void) => {
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      car.update(FIXED_DT, input, HEALTHY, q);
      for (const f of beforeStep) f();
      physics.step();
      onStep?.();
    }
  };
  // settle onto suspension
  run(1, { steer: 0, throttle: 0, reverse: 0 });
  return { physics, car, run, beforeStep };
}
