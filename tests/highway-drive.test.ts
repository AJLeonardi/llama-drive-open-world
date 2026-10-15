import { describe, expect, it } from 'vitest';
import { FIXED_DT, Physics, initPhysics } from '../src/physics/Physics';
import { HEALTHY, VehicleSim } from '../src/vehicles/VehicleSim';
import { SPECS } from '../src/vehicles/VehicleSpec';
import { CHUNK, TERRAIN_CELL } from '../src/world/bounds';
import { heightAt, surfaceAt } from '../src/world/layout';
import { CROSSINGS, HIGHWAYS, Highway, RAMPS, bridgeSolids, highwayCoords, profileAt } from '../src/world/outer';
import { heightfieldCollider } from '../src/world/terrain';
import { addSolid } from '../src/world/OuterWorld';

/** Physics for the real ground (chunk heightfields) and bridges round a crossing. */
async function interchange(index: number) {
  await initPhysics();
  const physics = new Physics();
  const cr = CROSSINGS[index];
  const N = CHUNK / TERRAIN_CELL;
  const r = 700;
  for (let ix = Math.floor((cr.x - r) / CHUNK); ix <= Math.floor((cr.x + r) / CHUNK); ix++)
    for (let iz = Math.floor((cr.z - r) / CHUNK); iz <= Math.floor((cr.z + r) / CHUNK); iz++) {
      const x0 = ix * CHUNK, z0 = iz * CHUNK;
      const h = new Float32Array((N + 1) * (N + 1));
      for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) h[a * (N + 1) + b] = heightAt(x0 + b * TERRAIN_CELL, z0 + a * TERRAIN_CELL);
      heightfieldCollider(physics, N + 1, N + 1, h, x0 + CHUNK / 2, z0 + CHUNK / 2);
    }
  for (const c of CROSSINGS) if (Math.hypot(c.x - cr.x, c.z - cr.z) < r) for (const b of bridgeSolids(c)) addSolid(physics, b);
  return { physics, cr };
}

/** Drive the right-hand lane of `h` from `from` to `to` (distance along it) at full throttle. */
function driveLane(physics: Physics, h: Highway, from: number, to: number) {
  const dir = Math.sign(to - from);
  const lane = 7 * dir; // keep right
  const at = (s: number, d: number) => ({ x: h.ax + h.ux * s - h.uz * d, z: h.az + h.uz * s + h.ux * d });
  const p0 = at(from, lane);
  const heading = Math.atan2(h.ux * dir, h.uz * dir);
  const car = new VehicleSim(physics, SPECS.bronco, p0.x, profileAt(h, from) + 1, p0.z, heading);
  car.body.setLinvel({ x: h.ux * dir * 30, y: 0, z: h.uz * dir * 30 }, true);
  const q = { surfaceAt, inStickZone: () => false, boostAt: () => false };
  let steps = 0, airborne = 0, maxJolt = 0, maxOff = 0;
  let prev = car.body.linvel();
  for (; steps < 60 * 40; steps++) {
    const p = car.body.translation();
    const c = highwayCoords(h, p.x, p.z);
    if ((c.s - to) * dir > 0) break;
    // Steer for a point 25 m ahead in the lane.
    const t = at(c.s + dir * 25, lane);
    const f = car.forward();
    const tx = t.x - p.x, tz = t.z - p.z, tl = Math.hypot(tx, tz);
    const steer = Math.max(-1, Math.min(1, ((f.x * tz - f.z * tx) / tl) * 3));
    car.update(FIXED_DT, { steer, throttle: 1, reverse: 0 }, HEALTHY, q);
    physics.step();
    const v = car.body.linvel();
    if (steps > 60) maxJolt = Math.max(maxJolt, Math.hypot(v.x - prev.x, v.y - prev.y, v.z - prev.z));
    prev = v;
    if (steps > 60 && car.wheelsInContact < 2) {
      airborne++;
      if (process.env.TRACE) console.log(`${h.name} dir ${dir} air at s-from=${((c.s - from) * dir).toFixed(0)} off=${c.d.toFixed(1)} v=${car.speed.toFixed(0)} y-road=${(p.y - profileAt(h, c.s)).toFixed(2)} up=${car.up().y.toFixed(2)}`);
    }
    maxOff = Math.max(maxOff, Math.abs(c.d - lane));
  }
  const end = car.body.translation();
  return { finished: (highwayCoords(h, end.x, end.z).s - to) * dir >= 0, airborneFrac: airborne / steps, maxJolt, maxOff, speed: car.speed };
}

describe('driving highway country', () => {
  // A few different crossings (different angles and heights).
  for (const index of [0, Math.floor(CROSSINGS.length / 2), CROSSINGS.length - 1])
    it(`crossing #${index}: over the bridge and underneath it at full speed, smoothly`, async () => {
      const { physics, cr } = await interchange(index);
      for (const [h, sc] of [[HIGHWAYS[cr.upper], cr.sUpper], [HIGHWAYS[cr.lower], cr.sLower]] as const)
        for (const dir of [1, -1]) {
          const r = driveLane(physics, h, sc - dir * 450, sc + dir * 450);
          expect(r.finished, `${h.name} dir ${dir}`).toBe(true);
          expect(r.airborneFrac).toBeLessThan(0.03); // wheels stay on the road
          expect(r.maxJolt).toBeLessThan(2.5); // no crash-sized bumps (m/s change in one step)
          expect(r.maxOff).toBeLessThan(5); // stays in its lane
          expect(r.speed).toBeGreaterThan(30);
        }
    }, 60000);

  it('ramps take you smoothly from one highway to the other', async () => {
    const { physics, cr } = await interchange(0);
    const ramps = RAMPS.filter((r) => Math.hypot(r.pts[0][0] - cr.x, r.pts[0][1] - cr.z) < 700 && ((r.from === cr.upper && r.to === cr.lower)));
    expect(ramps.length).toBeGreaterThan(0);
    for (const ramp of ramps)
      for (const backwards of [false, true]) {
        const pts = backwards ? [...ramp.pts].reverse() : ramp.pts, hs = backwards ? [...ramp.hs].reverse() : ramp.hs;
        const [a, b] = [pts[0], pts[1]];
        const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
        const car = new VehicleSim(physics, SPECS.bronco, a[0], hs[0] + 1, a[1], heading);
        const q = { surfaceAt, inStickZone: () => false, boostAt: () => false };
        let target = 1, airborne = 0, maxJolt = 0, steps = 0;
        let prev = car.body.linvel();
        for (; steps < 60 * 30 && target < pts.length; steps++) {
          const p = car.body.translation();
          while (target < pts.length && Math.hypot(pts[target][0] - p.x, pts[target][1] - p.z) < 14) target++;
          const t = pts[Math.min(target, pts.length - 1)];
          const f = car.forward();
          const tx = t[0] - p.x, tz = t[1] - p.z, tl = Math.hypot(tx, tz) || 1;
          const steer = Math.max(-1, Math.min(1, ((f.x * tz - f.z * tx) / tl) * 3));
          car.update(FIXED_DT, { steer, throttle: car.speed < 22 ? 1 : 0, reverse: 0 }, HEALTHY, q);
          physics.step();
          const v = car.body.linvel();
          if (steps > 60) {
            maxJolt = Math.max(maxJolt, Math.hypot(v.x - prev.x, v.y - prev.y, v.z - prev.z));
            if (car.wheelsInContact < 2) airborne++;
          }
          prev = v;
        }
        if (target !== pts.length && process.env.TRACE) {
          const p = car.body.translation();
          console.log(`stuck: target ${target}/${pts.length} backwards=${backwards} car ${p.x.toFixed(0)},${p.y.toFixed(1)},${p.z.toFixed(0)} v=${car.speed.toFixed(1)} wheels=${car.wheelsInContact} next ${pts[target].map(Math.round)} h=${hs[target].toFixed(1)} up=${car.up().y.toFixed(2)} steps=${steps}`);
        }
        expect(target, 'reached the end of the ramp').toBe(pts.length);
        expect(airborne / steps).toBeLessThan(0.03);
        expect(maxJolt).toBeLessThan(2.5);
        physics.world.removeRigidBody(car.body);
      }
  }, 60000);
});
