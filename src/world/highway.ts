import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { mulberry32, rand } from '../util/math';
import { BOSTON, DEMO_PARK, NYC, TRACK_BOUNDS, WORLD, nearRoad, roadAt, waterDepth } from './layout';
import { StaticBatch } from './batch';
import { box } from '../vehicles/builders/geo';
import { textPanel } from './landmarks';
import type { PropSpawn } from './propModels';
import { inAABB } from '../util/math';
import type { Terrain } from './terrain';
import { terrainHeight } from './terrain';

function gantry(batch: StaticBatch, physics: Physics, scene: THREE.Object3D, x: number, east: string[], west: string[]) {
  for (const z of [-17.5, 17.5]) {
    batch.add('plain', box({ at: [x, 4, z], size: [0.5, 8, 0.5], color: 0x7d8288 }));
    const col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.25, 4, 0.25).setTranslation(x, 4, z));
    physics.setOwner(col, { kind: 'building', material: 'metal' });
  }
  batch.add('plain', box({ at: [x, 7.8, 0], size: [0.4, 0.4, 35.5], seg: 100, color: 0x7d8288 }));
  // Eastbound drivers (heading +x) see the face pointing -x, and vice versa.
  for (const [lines, face, zc] of [[east, -1, 8], [west, 1, -8]] as const) {
    if (!lines.length) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(13, 3.4), new THREE.MeshBasicMaterial({ map: textPanel([...lines]) }));
    m.position.set(x + face * 0.25, 6.2, zc);
    m.rotation.y = face < 0 ? -Math.PI / 2 : Math.PI / 2;
    m.updateMatrix();
    m.matrixAutoUpdate = false;
    scene.add(m);
  }
}

export function buildHighway(batch: StaticBatch, physics: Physics, scene: THREE.Object3D, terrain: Terrain) {
  const rng = mulberry32(95);
  const props: PropSpawn[] = [];

  // Lamp posts along both shoulders.
  for (let x = -1420; x <= 1420; x += 70)
    for (const z of [-16.8, 16.8]) if (!roadAt(x, z) || roadAt(x, z) === 'highway') if (!nearRoad(x, z + Math.sign(z) * 3, 0)) props.push({ kind: 'pole', x, y: 0, z, rot: z > 0 ? Math.PI : 0 });

  gantry(batch, physics, scene, -1180, ['◀ BOSTON    NEW YORK ▶'], ['◀ BOSTON    NEW YORK ▶']);
  gantry(batch, physics, scene, -1060, ['DIRT TRACK ↖', 'NEXT EXIT'], []);
  gantry(batch, physics, scene, -120, [], ['DIRT TRACK ↗', 'NEXT EXIT']);
  gantry(batch, physics, scene, 300, ['DEMOLITION PARK ↘'], []);
  gantry(batch, physics, scene, 900, [], ['DEMOLITION PARK ↙']);
  gantry(batch, physics, scene, 1400, ['NEW YORK'], []);
  gantry(batch, physics, scene, -1420, [], ['BOSTON']);

  // Construction zone: cones down a lane line, barriers and barrels on the shoulder.
  for (let x = -320; x < -160; x += 6) props.push({ kind: 'cone', x, y: 0, z: 4.6, rot: 0 });
  for (let x = -330; x < -170; x += 22) props.push({ kind: 'barrier', x, y: 0, z: 13.5, rot: Math.PI / 2 });
  for (let i = 0; i < 4; i++)
    for (let j = 0; j <= i; j++) props.push({ kind: 'barrel', x: 780 + j * 0.7 - i * 0.35, y: (3 - i) * 0.9, z: -13, rot: 0, color: [0xd22f27, 0x2a6fd6, 0xf2b705][j % 3] });
  // A pile of crates on the westbound shoulder, and a barrel wall further on.
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 3 - row; i++) props.push({ kind: 'crate', x: 1050 + i * 1.05 + row * 0.52, y: row * 1.0, z: -12, rot: 0 });
  for (let i = 0; i < 6; i++) props.push({ kind: 'barrel', x: -700, y: 0, z: 9 + i * 0.7, rot: 0, color: 0xf2b705 });

  // Countryside trees on the hills.
  for (let i = 0; i < 420; i++) {
    const x = rand(rng, WORLD.x0 + 150, WORLD.x1 - 60), z = rand(rng, WORLD.z0 + 40, WORLD.z1 - 40);
    if (inAABB(x, z, BOSTON, 20) || inAABB(x, z, NYC, 20) || inAABB(x, z, DEMO_PARK, 25) || inAABB(x, z, TRACK_BOUNDS, 15)) continue;
    if (nearRoad(x, z, 10) || waterDepth(x, z) > 0) continue;
    props.push({ kind: 'tree', x, y: terrainHeight(terrain, x, z) - 0.3, z, rot: rng() * 6.28 });
  }

  // Invisible walls at the edge of the world.
  const W = WORLD;
  for (const [cx, cz, hx, hz] of [
    [(W.x0 + W.x1) / 2, W.z0, (W.x1 - W.x0) / 2, 2], [(W.x0 + W.x1) / 2, W.z1, (W.x1 - W.x0) / 2, 2],
    [W.x0, 0, 2, (W.z1 - W.z0) / 2], [W.x1, 0, 2, (W.z1 - W.z0) / 2],
  ]) {
    const col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 60, hz).setTranslation(cx, 30, cz));
    physics.setOwner(col, { kind: 'static', material: 'concrete' });
  }
  return { props };
}
