import { describe, expect, it } from 'vitest';
import { FIXED_DT, Physics, RAPIER, initPhysics } from '../src/physics/Physics';
import { DriveInput, HEALTHY, VehicleSim } from '../src/vehicles/VehicleSim';
import { CAR_IDS, CarId, SPECS } from '../src/vehicles/VehicleSpec';
import {
  EDGE_HEADINGS, HOOPS, MEGA, NET, SPACE_GRAVITY, SPAWN, STATION_QUERIES, SY, addStationColliders, bounceTarget, homing, netBounce, overDeck, DECK,
} from '../src/space/stationLayout';
import { flatWorld, makeTestbed } from './helpers';

async function station(id: CarId, x: number, z: number, heading: number) {
  await initPhysics();
  const physics = new Physics(SPACE_GRAVITY);
  addStationColliders(physics);
  const car = new VehicleSim(physics, SPECS[id], x, SY + 0.4, z, heading);
  // Which rings the car flies through (the same test as the game's).
  const passed = new Set<number>();
  const side = HOOPS.map(() => 0);
  const step = (input: DriveInput) => {
    car.update(FIXED_DT, input, HEALTHY, STATION_QUERIES);
    physics.step();
    const p = car.body.translation();
    HOOPS.forEach((h, i) => {
      const dx = p.x - h.x, dy = p.y + 0.8 - h.y, dz = p.z - h.z;
      const c = Math.cos(h.heading), s = Math.sin(h.heading);
      // Into the ring's own frame (it faces along its heading).
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const sd = Math.sign(lz);
      if (side[i] !== 0 && sd !== side[i] && Math.hypot(lx, dy) < h.r + 0.5 && Math.abs(lz) < 6) passed.add(i);
      side[i] = sd;
    });
  };
  const run = (seconds: number, input: (t: number) => DriveInput) => {
    for (let i = 0; i < seconds / FIXED_DT; i++) step(input(i * FIXED_DT));
  };
  run(1, () => ({ steer: 0, throttle: 0, reverse: 0 }));
  return { physics, car, run, passed };
}

const megaRings = HOOPS.map((h, i) => (h.x === 0 && h.heading === MEGA.heading ? i : -1)).filter((i) => i >= 0);

describe('the space station', () => {
  it('every car flies through all the Rocket Ramp rings, on the gas or not', async () => {
    expect(megaRings.length).toBe(4);
    for (const id of CAR_IDS)
      for (const lift of [false, true]) {
        const s = await station(id, SPAWN.x, SPAWN.z, SPAWN.heading);
        s.run(12, () => ({ steer: 0, throttle: lift && s.car.wheelsInContact === 0 ? 0 : 1, reverse: 0 }));
        for (const i of megaRings) expect(s.passed.has(i), `${id} ${lift ? 'off the gas' : 'on the gas'}: ring ${i}`).toBe(true);
      }
  });

  it('the edge jumps launch you through the ring out past them', async () => {
    for (const h of EDGE_HEADINGS) {
      const ux = Math.sin(h), uz = Math.cos(h);
      if (uz > 0.9) continue; // (the south edge has the rocket)
      const ring = HOOPS.findIndex((o) => Math.abs(o.heading - h) < 1e-6 && Math.hypot(o.x, o.z) > DECK.R);
      const s = await station('bronco', ux * 20, uz * 20, h);
      s.run(13, () => ({ steer: 0, throttle: 1, reverse: 0 }));
      expect(s.passed.has(ring), `edge jump heading ${h.toFixed(2)}`).toBe(true);
    }
  });

  it('on the deck the cars drive just like on Earth', async () => {
    for (const id of CAR_IDS) {
      const time = (run: (seconds: number, input: DriveInput, onStep?: () => void) => void, speed: () => number) => {
        let t = 0;
        run(8, { steer: 0, throttle: 1, reverse: 0 }, () => (t += speed() < 20 ? FIXED_DT : 0));
        return t;
      };
      const earth = await makeTestbed(id, 'concrete');
      const tEarth = time(earth.run, () => earth.car.speed);
      // A flat floor in space, the same deck plate.
      const physics = new Physics(SPACE_GRAVITY);
      physics.world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0));
      const car = new VehicleSim(physics, SPECS[id], 0, 0.3, 0, 0);
      const q = { ...flatWorld('concrete'), gravity: SPACE_GRAVITY, thrusters: true };
      const run = (seconds: number, input: DriveInput, onStep?: () => void) => {
        for (let i = 0; i < seconds / FIXED_DT; i++) {
          car.update(FIXED_DT, input, HEALTHY, q);
          physics.step();
          onStep?.();
        }
      };
      run(1, { steer: 0, throttle: 0, reverse: 0 });
      const tSpace = time(run, () => car.speed);
      expect(Math.abs(tSpace - tEarth), id).toBeLessThan(0.4);
      // And it stays on the ground while cornering hard.
      let minContact = 4;
      run(3, { steer: 1, throttle: 1, reverse: 0 }, () => (minContact = Math.min(minContact, car.wheelsInContact)));
      expect(minContact, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('jumps float: long hang time off the Rocket Ramp', async () => {
    const s = await station('bronco', SPAWN.x, SPAWN.z, SPAWN.heading);
    let air = 0, longest = 0;
    s.run(14, () => {
      air = s.car.wheelsInContact === 0 ? air + FIXED_DT : 0;
      longest = Math.max(longest, air);
      return { steer: 0, throttle: 1, reverse: 0 };
    });
    expect(longest).toBeGreaterThan(5);
  });

  it('the thrusters steer the car in the air', async () => {
    const xs: number[] = [];
    for (const steer of [0, 1]) {
      const s = await station('bronco', SPAWN.x, SPAWN.z, SPAWN.heading);
      s.run(9, () => ({ steer: s.car.wheelsInContact === 0 ? steer : 0, throttle: 1, reverse: 0 }));
      xs.push(s.car.body.translation().x);
      if (steer) expect(s.car.thrust).toBeGreaterThan(0.5);
    }
    // Heading north (−z), steering right turns towards east (+x).
    expect(xs[1] - xs[0]).toBeGreaterThan(15);
  });

  it('the force-field net always springs you back up onto the deck, over its edge', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.3)
      for (const r of [0, 60, 150, 170, 200, 350, 650])
        for (const [r1, r2] of [[0, 0], [1, 1], [0.5, 0.2]]) {
          const b = netBounce(Math.cos(a) * r, NET.y + 0.5, Math.sin(a) * r);
          const target = bounceTarget(r1, r2);
          // Follow the flight, with the tractor beam steering it as the game does.
          let { x, y, z } = b.from;
          let { x: vx, y: vy, z: vz } = b.v;
          const dt = 1 / 60;
          for (let t = 0; t < 30; t += dt) {
            const st = homing(x, y, z, vy, target);
            if (st) (vx += (st.x - vx) * dt * 4), (vz += (st.z - vz) * dt * 4);
            x += vx * dt;
            z += vz * dt;
            y += vy * dt;
            vy -= SPACE_GRAVITY * dt;
            if (vy < 0 && y <= SY + 0.5) break;
            // Never over the deck below its top (that would hit its underside or its edge).
            if (overDeck(x, z)) expect(y, `${a.toFixed(1)} ${r}`).toBeGreaterThan(SY + 0.5);
          }
          expect(overDeck(x, z), `lands on the deck from ${a.toFixed(1)}, ${r}`).toBe(true);
          expect(Math.hypot(x - target.x, z - target.z)).toBeLessThan(25);
        }
  });

  it('a car that falls off lands back on the deck after a bounce', async () => {
    for (const [x0, z0] of [[175, 40], [-120, -160], [0, 300]]) {
      const s = await station('wrangler', 0, 0, 0);
      const body = s.car.body;
      const b = netBounce(x0, NET.y + 1, z0);
      const target = bounceTarget(0.3, 0.7);
      body.setTranslation(b.from, true);
      body.setLinvel(b.v, true);
      for (let i = 0; i < 20 * 60; i++) {
        const p = body.translation(), v = body.linvel();
        const st = homing(p.x, p.y, p.z, v.y, target);
        if (st) body.setLinvel({ x: v.x + (st.x - v.x) * FIXED_DT * 4, y: v.y, z: v.z + (st.z - v.z) * FIXED_DT * 4 }, true);
        s.run(FIXED_DT, () => ({ steer: 0, throttle: 0, reverse: 0 }));
      }
      const p = body.translation();
      expect(overDeck(p.x, p.z), `${x0},${z0}`).toBe(true);
      expect(Math.abs(p.y - SY), `${x0},${z0}`).toBeLessThan(1.5);
    }
  });
});
