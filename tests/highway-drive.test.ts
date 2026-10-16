import { describe, expect, it } from 'vitest';
import { FIXED_DT, Physics, initPhysics } from '../src/physics/Physics';
import { HEALTHY, VehicleSim } from '../src/vehicles/VehicleSim';
import { SPECS } from '../src/vehicles/VehicleSpec';
import { CHUNK, TERRAIN_CELL } from '../src/world/bounds';
import { heightAt, surfaceAt } from '../src/world/layout';
import { CROSSINGS, DC, HIGHWAYS, Highway, RAMPS, TOWN, TOWNS, besideHighway, bridgeSolids, highwayCoords, pointAt, profileAt } from '../src/world/outer';
import { heightfieldCollider } from '../src/world/terrain';
import { addSolid } from '../src/world/OuterWorld';

/** Physics for the real ground (chunk heightfields) and bridges round a crossing. */
async function interchange(index: number) {
  const cr = CROSSINGS[index];
  return { physics: await groundAround(cr.x, cr.z), cr };
}

/** Physics for the real ground (chunk heightfields) and bridges within reach of a spot. */
async function groundAround(cx: number, cz: number, r = 700) {
  await initPhysics();
  const physics = new Physics();
  const cr = { x: cx, z: cz };
  const N = CHUNK / TERRAIN_CELL;
  for (let ix = Math.floor((cr.x - r) / CHUNK); ix <= Math.floor((cr.x + r) / CHUNK); ix++)
    for (let iz = Math.floor((cr.z - r) / CHUNK); iz <= Math.floor((cr.z + r) / CHUNK); iz++) {
      const x0 = ix * CHUNK, z0 = iz * CHUNK;
      const h = new Float32Array((N + 1) * (N + 1));
      for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) h[a * (N + 1) + b] = heightAt(x0 + b * TERRAIN_CELL, z0 + a * TERRAIN_CELL);
      heightfieldCollider(physics, N + 1, N + 1, h, x0 + CHUNK / 2, z0 + CHUNK / 2);
    }
  for (const c of CROSSINGS) if (Math.hypot(c.x - cr.x, c.z - cr.z) < r) for (const b of bridgeSolids(c)) addSolid(physics, b);
  return physics;
}

/** Drive along a curved road's points (either way), steering for the next point. */
function driveCurve(physics: Physics, pts: readonly (readonly [number, number])[], hs: number[], speed: number) {
  const [a, b] = [pts[0], pts[1]];
  const car = new VehicleSim(physics, SPECS.bronco, a[0], hs[0] + 1, a[1], Math.atan2(b[0] - a[0], b[1] - a[1]));
  const q = { surfaceAt, inStickZone: () => false, boostAt: () => false };
  let target = 1, airborne = 0, maxJolt = 0, steps = 0;
  let prev = car.body.linvel();
  for (; steps < 60 * 150 && target < pts.length; steps++) {
    const p = car.body.translation();
    while (target < pts.length && Math.hypot(pts[target][0] - p.x, pts[target][1] - p.z) < 14) target++;
    const t = pts[Math.min(target, pts.length - 1)];
    const f = car.forward();
    const tx = t[0] - p.x, tz = t[1] - p.z, tl = Math.hypot(tx, tz) || 1;
    const steer = Math.max(-1, Math.min(1, ((f.x * tz - f.z * tx) / tl) * 3));
    car.update(FIXED_DT, { steer, throttle: car.speed < speed ? 1 : 0, reverse: 0 }, HEALTHY, q);
    physics.step();
    const v = car.body.linvel();
    if (steps > 60) {
      maxJolt = Math.max(maxJolt, Math.hypot(v.x - prev.x, v.y - prev.y, v.z - prev.z));
      if (car.wheelsInContact < 2) airborne++;
    }
    prev = v;
  }
  physics.removeBody(car.body);
  if (target !== pts.length && process.env.TRACE) {
    const p = car.body.translation();
    console.log(`stuck at ${target}/${pts.length}: car ${p.x.toFixed(0)},${p.y.toFixed(1)},${p.z.toFixed(0)} v=${car.speed.toFixed(1)} next h=${hs[target].toFixed(1)}`);
  }
  return { reached: target === pts.length, airborneFrac: airborne / steps, maxJolt };
}

/** Drive the right-hand lane of `h` from `from` to `to` (distance along it) at full throttle. */
function driveLane(physics: Physics, h: Highway, from: number, to: number) {
  const dir = Math.sign(to - from);
  const lane = 7 * dir; // keep right
  const at = (s: number, d: number) => {
    const [x, z] = besideHighway(h, s, d);
    return { x, z };
  };
  const p0 = at(from, lane);
  const u = pointAt(h, from);
  const heading = Math.atan2(u.ux * dir, u.uz * dir);
  const car = new VehicleSim(physics, SPECS.bronco, p0.x, profileAt(h, from) + 1, p0.z, heading);
  car.body.setLinvel({ x: u.ux * dir * 30, y: 0, z: u.uz * dir * 30 }, true);
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
        physics.removeBody(car.body);
      }
  }, 60000);

  it('the town road takes you off the highway, through Mariano-ville and back on', async () => {
    expect(TOWN).not.toBeNull();
    const r = TOWN!.road;
    const physics = await groundAround(TOWN!.x, TOWN!.z, 800);
    for (const backwards of [false, true]) {
      const pts = backwards ? [...r.pts].reverse() : r.pts, hs = backwards ? [...r.hs].reverse() : r.hs;
      const run = driveCurve(physics, pts, hs, 18);
      expect(run.reached, `backwards=${backwards}`).toBe(true);
      expect(run.airborneFrac).toBeLessThan(0.03);
      expect(run.maxJolt).toBeLessThan(2.5);
    }
  }, 60000);

  it('the loop road through Alexander-ville, and every road into Washington DC, can be driven both ways', async () => {
    const roads = [TOWNS.find((t) => t.kind === 'alexander')!.road, ...DC.roads.filter((r) => r.from >= 0)];
    for (const r of roads) {
      const mid = r.pts[Math.floor(r.pts.length / 2)];
      const physics = await groundAround(mid[0], mid[1], 650);
      for (const backwards of [false, true]) {
        const pts = backwards ? [...r.pts].reverse() : r.pts, hs = backwards ? [...r.hs].reverse() : r.hs;
        const run = driveCurve(physics, pts, hs, 18);
        expect(run.reached, `${mid.map(Math.round)} backwards=${backwards}`).toBe(true);
        expect(run.airborneFrac).toBeLessThan(0.03);
        expect(run.maxJolt).toBeLessThan(2.5);
      }
    }
  }, 120000);

  it('a winding mountain highway can be driven at speed, in lane', async () => {
    // The mountain highway that strays furthest from a straight line.
    const { biomeAt } = await import('../src/world/biomes');
    let best: { h: Highway; s: number } | null = null, bestOff = 0;
    for (const h of HIGHWAYS)
      for (let s = 1500; s < h.len - 1500; s += 100) {
        const p = pointAt(h, s);
        if (biomeAt(p.x, p.z).mountain < 0.9) continue;
        const a = pointAt(h, s - 600), b = pointAt(h, s + 600);
        const off = Math.abs(((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.z - a.z));
        if (off > bestOff) (bestOff = off), (best = { h, s });
      }
    expect(best).not.toBeNull();
    const p = pointAt(best!.h, best!.s);
    const physics = await groundAround(p.x, p.z, 900);
    for (const dir of [1, -1]) {
      const r = driveLane(physics, best!.h, best!.s - dir * 650, best!.s + dir * 650);
      expect(r.finished).toBe(true);
      expect(r.airborneFrac).toBeLessThan(0.03);
      expect(r.maxJolt).toBeLessThan(2.5);
      expect(r.maxOff).toBeLessThan(5);
    }
  }, 60000);
});
