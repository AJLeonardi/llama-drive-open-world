// Ways up onto the city's rooftops, and off them again:
// - parking garages: ramps up three decks to the roof, then a launch ramp off the end
// - skyramps: one long ramp straight up onto a flat roof (boost pad at the bottom)
// - Beacon Hill: a building with a grassy hill behind it, so you drive up onto the roof
import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { Rect } from '../util/math';
import { BEACON_HILL, GARAGE, GARAGES, SKYRAMPS } from './layout';
import { StaticBatch } from './batch';
import { block, textPanel, twoSidedSign } from './landmarks';
import { box } from '../vehicles/builders/geo';
import { ramp } from './dirtTrack';
import { PropSpawn, tntPyramid } from './propModels';
import { CAR_COLORS, ParkedSpawn } from './streetLife';

const CONCRETE = 0x9b9a95;
const STRIPE: [number, number, number] = [0.95, 0.78, 0.1];

/** Footprints to keep the city's ordinary buildings away from. */
export function stuntKeepOut(): Rect[] {
  const { length: L, width: W } = GARAGE;
  return [
    ...GARAGES.map((g) => ({ cx: g.x, cz: g.z, hw: L / 2 + 3, hd: W / 2 + 3, rot: 0 })),
    ...SKYRAMPS.map((r) => ({ cx: r.x0 + (r.ramp + r.roof) / 2, cz: r.z, hw: (r.ramp + r.roof) / 2 + 3, hd: r.depth / 2 + 3, rot: 0 })),
    { cx: BEACON_HILL.x, cz: BEACON_HILL.z, hw: BEACON_HILL.w / 2 + 4, hd: BEACON_HILL.d / 2 + 4, rot: 0 },
  ];
}

/** Drivable static box (decks, roofs): no crash noises or cracks from driving on it. */
function deck(batch: StaticBatch, physics: Physics, cx: number, top: number, cz: number, sx: number, sz: number, color = CONCRETE, t = 0.4) {
  batch.add('plain', box({ at: [cx, top - t / 2, cz], size: [sx, t, sz], seg: 100, color }));
  const c = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, t / 2, sz / 2).setTranslation(cx, top - t / 2, cz).setFriction(0.9));
  physics.setOwner(c, { kind: 'ground', material: 'concrete' });
}

/** Solid walls and pillars you can crash into. */
function wall(batch: StaticBatch, physics: Physics, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color = 0xb7b4ad) {
  batch.add('plain', box({ at: [cx, cy, cz], size: [sx, sy, sz], color }));
  const c = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(cx, cy, cz));
  physics.setOwner(c, { kind: 'building', material: 'concrete' });
}

/** A floating sloped slab from (xa, ya) to (xb, yb) along x, `w` wide, centred on z. */
function slope(batch: StaticBatch, physics: Physics, xa: number, ya: number, xb: number, yb: number, z: number, w: number) {
  const t = 0.4;
  const run = xb - xa, rise = yb - ya;
  const len = Math.hypot(run, rise);
  const tx = run / len, ty = rise / len;
  // Push the slab down by half its thickness so its top surface runs exactly a→b.
  const nx = -ty * Math.sign(tx), ny = Math.abs(tx);
  const cx = (xa + xb) / 2 - (nx * t) / 2, cy = (ya + yb) / 2 - (ny * t) / 2;
  const angle = Math.atan2(ty, tx);
  const g = box({ at: [0, 0, 0], size: [len, t, w], seg: 100, color: (x) => (Math.floor((x + len / 2) / 2) % 2 ? CONCRETE : 0xb0aea8) });
  g.rotateZ(angle);
  g.translate(cx, cy, z);
  batch.add('plain', g);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
  const c = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2, t / 2, w / 2).setTranslation(cx, cy, z).setRotation(q).setFriction(0.9));
  physics.setOwner(c, { kind: 'ground', material: 'concrete' });
  // Yellow kerbs along both edges so the ramp reads clearly.
  for (const side of [-1, 1]) {
    const k = box({ at: [0, 0, 0], size: [len, 0.25, 0.3], color: 0xf2c230 });
    k.rotateZ(angle);
    k.translate((xa + xb) / 2, (ya + yb) / 2 + 0.12, z + side * (w / 2 - 0.15));
    batch.add('plain', k);
  }
}

function sign(scene: THREE.Object3D, lines: string[], x: number, y: number, z: number, rotY: number, w = 10, bg = '#1f5fbf') {
  const s = twoSidedSign(textPanel(lines, bg, '#ffffff', 1024, 400), w, w * 0.39);
  s.position.set(x, y, z);
  s.rotation.y = rotY;
  scene.add(s);
}

/**
 * Parking garage, long side along x. Decks at 4.2 m steps; ramp k climbs from deck k to
 * deck k+1 in the north lane (k even, heading east) or the south lane (k odd, heading
 * west), under a gap in the deck above. The roof has a launch ramp off its west end.
 */
function garage(batch: StaticBatch, physics: Physics, scene: THREE.Object3D, props: PropSpawn[], parked: ParkedSpawn[], gx: number, gz: number, seed: number) {
  const { length: L, width: W, level: H, levels: N } = GARAGE;
  const x0 = gx - L / 2, x1 = gx + L / 2, z0 = gz - W / 2, z1 = gz + W / 2;
  const LANE = 9, RX = 16; // ramp lane width; ramps span x = gx ± RX
  const laneZ = (k: number) => (k % 2 === 0 ? z0 + LANE / 2 : z1 - LANE / 2);
  // Ground floor: painted concrete.
  batch.add('plain', box({ at: [gx, 0.03, gz], size: [L, 0.06, W], seg: 100, color: 0x8a8984 }));
  for (let k = 1; k <= N; k++) {
    const y = k * H;
    // Deck k has a gap over ramp k-1 (in that ramp's lane, between x = gx ± RX).
    const lz = laneZ(k - 1);
    const laneNorth = lz < gz;
    const restZ0 = laneNorth ? z0 + LANE : z0, restZ1 = laneNorth ? z1 : z1 - LANE;
    deck(batch, physics, gx, y, (restZ0 + restZ1) / 2, L, restZ1 - restZ0);
    for (const [a, b] of [[x0, gx - RX], [gx + RX, x1]]) deck(batch, physics, (a + b) / 2, y, lz, b - a, LANE);
    // Low walls round the edge (not along the gap, and the roof's launch end stays open).
    const wy = y + 0.45;
    wall(batch, physics, gx, wy, z0 + 0.2, L, 0.9, 0.4);
    wall(batch, physics, gx, wy, z1 - 0.2, L, 0.9, 0.4);
    wall(batch, physics, x1 - 0.2, wy, gz, 0.4, 0.9, W);
    if (k < N) wall(batch, physics, x0 + 0.2, wy, gz, 0.4, 0.9, W);
    else for (const z of [z0 + 5, z1 - 5]) wall(batch, physics, x0 + 0.2, wy, z, 0.4, 0.9, 10);
    // Cars parked across the middle of the lower decks (clear of the turnarounds at the ends).
    if (k < N)
      for (let i = 0; i < 4; i++) {
        if ((i + k + seed) % 4 === 0) continue;
        parked.push({ style: (i + seed) % 4 === 0 ? 'van' : 'sedan', color: CAR_COLORS[(i * 3 + k + seed) % CAR_COLORS.length], x: gx - 12 + i * 8, z: gz + (laneNorth ? 2 : -2), heading: (i % 2) * Math.PI, y });
      }
  }
  // Ramps
  for (let k = 0; k < N; k++) {
    const east = k % 2 === 0;
    slope(batch, physics, east ? gx - RX : gx + RX, k * H, east ? gx + RX : gx - RX, (k + 1) * H, laneZ(k), LANE - 0.4);
  }
  // Pillars just outside the long sides, from the ground up to the roof.
  const top = N * H;
  for (let x = x0 + 0.6; x <= x1; x += 12)
    for (const z of [z0 - 0.4, z1 + 0.4]) wall(batch, physics, x, top / 2, z, 0.8, top, 0.8, 0xa9a69f);
  // Roof: launch ramp off the west end, exploding barrels and crates to smash.
  ramp(batch, physics, [x0 + 22, gz], [x0 + 3, gz], top, top + 2.6, 10, STRIPE, 1.5, 10, top - 0.3);
  tntPyramid(props, gx + 8, gz + 9, 4, 0, top);
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 4 - row; i++) props.push({ kind: 'crate', x: gx + 20 + (i - (3 - row) / 2) * 1.02, y: top + row, z: gz - 8, rot: 0 });
  // Big "P" signs on the roof corners.
  for (const [x, z] of [[x1 - 3, z0 + 3], [x0 + 3, z1 - 3]]) {
    batch.add('plain', box({ at: [x, top + 3, z], size: [0.4, 6, 0.4], color: 0x444444 }));
    sign(scene, ['🅿️ PARKING'], x, top + 7.5, z, Math.PI / 4, 9);
  }
}

/** A long ramp up onto a flat roof, with things to smash up top and a jump off the far end. */
function skyramp(batch: StaticBatch, physics: Physics, scene: THREE.Object3D, props: PropSpawn[], r: (typeof SKYRAMPS)[number]) {
  const bx0 = r.x0 + r.ramp, bx1 = bx0 + r.roof, cx = (bx0 + bx1) / 2;
  block(batch, physics, cx, r.z, r.roof, r.depth, 0, r.h - 0.1, 'concrete', 0xe9e3d6);
  deck(batch, physics, cx, r.h + 0.05, r.z, r.roof + 0.2, r.depth + 0.2, 0x7e7d78, 0.3);
  ramp(batch, physics, [r.x0, r.z], [bx0 + 0.5, r.z], 0, r.h + 0.05, 12, [0.92, 0.35, 0.15], 1, 14);
  // Parapet on the sides; the far end has a gap with a kicker.
  for (const side of [-1, 1]) wall(batch, physics, cx, r.h + 0.5, r.z + side * (r.depth / 2 - 0.3), r.roof, 1, 0.6);
  for (const side of [-1, 1]) wall(batch, physics, bx1 - 0.3, r.h + 0.5, r.z + side * (r.depth / 4 + 4.5), 0.6, 1, r.depth / 2 - 9);
  ramp(batch, physics, [bx1 - 18, r.z], [bx1 - 1, r.z], r.h + 0.05, r.h + 2.4, 10, STRIPE, 1.5, 10, r.h - 0.3);
  tntPyramid(props, cx - 6, r.z + 10, 4, 0, r.h + 0.05);
  tntPyramid(props, cx - 6, r.z - 10, 3, 0, r.h + 0.05);
  for (let i = 0; i < 5; i++) props.push({ kind: 'pane', x: cx - 2 + i * 1.6, y: r.h + 0.05, z: r.z, rot: Math.PI / 2 });
  // Sign at the bottom of the ramp.
  batch.add('plain', box({ at: [r.x0 - 2, 3, r.z - 8.5], size: [0.4, 6, 0.4], color: 0x444444 }));
  sign(scene, ['ROOFTOP ⬆'], r.x0 - 2, 6.5, r.z - 8.5, Math.PI / 2, 8, '#d0431a');
}

/** Building with a hill behind it: drive up the hill onto the roof, launch off the front. */
function beaconHill(batch: StaticBatch, physics: Physics, scene: THREE.Object3D, props: PropSpawn[]) {
  const { x, z, w, d, h } = BEACON_HILL;
  block(batch, physics, x, z, w, d, 0, h - 0.1, 'brownstone', 0xf0dcd0);
  deck(batch, physics, x, h + 0.05, z, w + 0.2, d + 0.6, 0x6f6c66, 0.3);
  // Low walls on the sides; the back is open to the hill, the front has the launch ramp.
  for (const side of [-1, 1]) wall(batch, physics, x + side * (w / 2 - 0.3), h + 0.5, z, 0.6, 1, d);
  ramp(batch, physics, [x, z + d / 2 - 6], [x, z - d / 2 + 1], h + 0.05, h + 3, 10, STRIPE, 1.5, 10, h - 0.3);
  for (const side of [-1, 1]) wall(batch, physics, x + side * 12, h + 0.5, z - d / 2 + 0.3, w / 2 - 10, 1, 0.6);
  tntPyramid(props, x - 12, z + 4, 3, Math.PI / 2, h + 0.05);
  // Signs at the bottom of the hill so it's easy to find.
  batch.add('plain', box({ at: [x + 14, 3, z + d / 2 + BEACON_HILL.slope + 6], size: [0.4, 6, 0.4], color: 0x444444 }));
  sign(scene, ['BEACON HILL ⬆', 'drive onto the roof!'], x + 14, 6.8, z + d / 2 + BEACON_HILL.slope + 6, 0, 10, '#2e7d32');
}

export function buildCityStunts(batch: StaticBatch, physics: Physics, scene: THREE.Object3D) {
  const props: PropSpawn[] = [];
  const parked: ParkedSpawn[] = [];
  GARAGES.forEach((g, i) => garage(batch, physics, scene, props, parked, g.x, g.z, i));
  for (const r of SKYRAMPS) skyramp(batch, physics, scene, props, r);
  beaconHill(batch, physics, scene, props);
  return { props, parked };
}
