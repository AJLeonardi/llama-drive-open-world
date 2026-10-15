// Thunder Mountain extras: the sign at the foot of the road, a launch ramp on top that
// sends you off the cliff towards the lake, and exploding barrels to find on the way.
// (The mountain itself is terrain: see `mountainHeight` in layout.ts.)
import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { MOUNTAIN, MOUNTAIN_ROAD } from './layout';
import { StaticBatch } from './batch';
import { box } from '../vehicles/builders/geo';
import { textPanel, twoSidedSign } from './landmarks';
import { ramp } from './dirtTrack';
import { PropSpawn, tntPyramid } from './propModels';
import { Terrain, terrainHeight } from './terrain';

export function buildMountain(batch: StaticBatch, physics: Physics, scene: THREE.Object3D, terrain: Terrain) {
  const props: PropSpawn[] = [];
  const { x: mx, z: mz, r: R, h: H, cliff } = MOUNTAIN;
  const at = (angle: number, r: number): [number, number] => [mx + Math.sin(angle) * r, mz + Math.cos(angle) * r];
  const ground = (x: number, z: number) => terrainHeight(terrain, x, z);

  // Sign arch over the end of the dirt road, where the climb starts.
  const foot = MOUNTAIN_ROAD.pts[MOUNTAIN_ROAD.pts.length - 1];
  const prev = MOUNTAIN_ROAD.pts[MOUNTAIN_ROAD.pts.length - 2];
  const heading = Math.atan2(foot[0] - prev[0], foot[1] - prev[1]);
  const px = Math.cos(heading), pz = -Math.sin(heading);
  for (const side of [-1, 1]) {
    const x = foot[0] + px * side * 9, z = foot[1] + pz * side * 9;
    batch.add('plain', box({ at: [x, 4.5, z], size: [0.9, 9, 0.9], color: 0x5a3b22 }));
    const c = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.45, 4.5, 0.45).setTranslation(x, 4.5, z));
    physics.setOwner(c, { kind: 'building', material: 'wood' });
  }
  const sign = twoSidedSign(textPanel(['⚡ THUNDER MOUNTAIN ⚡'], '#3b1f0e', '#ffcf3a', 1024, 180), 19, 3.4);
  sign.position.set(foot[0], 8, foot[1]);
  sign.rotation.y = heading;
  scene.add(sign);

  // Launch ramp on the plateau, pointing off the cliff at the lake.
  const [ax, az] = at(cliff, R - 38);
  const [bx, bz] = at(cliff, R - 7);
  ramp(batch, physics, [ax, az], [bx, bz], H - 0.5, H + 4.5, 12, [0.95, 0.75, 0.1], 1.5, 12);
  // Chevron-striped edge markers either side of the take-off.
  for (const side of [-1, 1]) {
    const [x, z] = at(cliff + side * 0.12, R - 4);
    props.push({ kind: 'cone', x, y: ground(x, z), z, rot: 0 });
  }

  // Exploding barrels: on the plateau, halfway up the road, and at the foot.
  for (const [angle, r] of [[cliff + 0.5, R - 30], [cliff - 0.55, R - 25], [cliff + Math.PI, R - 40]] as const) {
    const [x, z] = at(angle, r);
    tntPyramid(props, x, z, 4, angle, ground(x, z));
  }
  const mid = cliff + MOUNTAIN.gap + (2 * Math.PI - 2 * MOUNTAIN.gap) * 0.5;
  const [hx, hz] = at(mid, R + MOUNTAIN.road * 0.5);
  tntPyramid(props, hx, hz, 3, mid, ground(hx, hz));
  tntPyramid(props, foot[0] - px * 16, foot[1] - pz * 16 - 6, 4, heading + Math.PI / 2, ground(foot[0] - px * 16, foot[1] - pz * 16 - 6));

  // Crates to smash on top, and a few trees.
  for (let i = 0; i < 6; i++) {
    const [x, z] = at(cliff + Math.PI * 0.6 + i * 0.05, R - 18);
    for (let row = 0; row < 2; row++) props.push({ kind: 'crate', x, y: ground(x, z) + row, z, rot: 0 });
  }
  for (let i = 0; i < 14; i++) {
    const a = cliff + 1.2 + i * 0.32, r = 30 + ((i * 37) % 50);
    const [x, z] = at(a, r);
    props.push({ kind: 'tree', x, y: ground(x, z) - 0.3, z, rot: i });
  }
  return { props };
}
