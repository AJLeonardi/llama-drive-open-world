import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { mulberry32, rand } from '../util/math';
import { BOSTON, DEMO_PARK, EXIT_GORES, MOUNTAIN, NYC, PARK_ROAD, TRACK_BOUNDS, TRACK_ROAD, WORLD, mountainCoords, nearRoad, roadSegments, waterDepth } from './layout';
import { tntPyramid } from './propModels';
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

/** Green EXIT sign on two posts in the gore between the highway and an exit ramp. */
function exitSign(batch: StaticBatch, physics: Physics, scene: THREE.Object3D, x: number, z: number, faceX: number, lines: string[]) {
  for (const dz of [-1.6, 1.6]) {
    batch.add('plain', box({ at: [x, 2, z + dz], size: [0.2, 4, 0.2], color: 0x7d8288 }));
    const col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 2, 0.1).setTranslation(x, 2, z + dz));
    physics.setOwner(col, { kind: 'building', material: 'metal' });
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.2), new THREE.MeshBasicMaterial({ map: textPanel(lines) }));
  m.position.set(x + faceX * 0.15, 4.4, z);
  m.rotation.y = faceX > 0 ? Math.PI / 2 : -Math.PI / 2;
  m.updateMatrix();
  m.matrixAutoUpdate = false;
  scene.add(m);
}

export function buildHighway(batch: StaticBatch, physics: Physics, scene: THREE.Object3D, terrain: Terrain) {
  const rng = mulberry32(95);
  const props: PropSpawn[] = [];

  // Lamp posts along both shoulders.
  for (let x = BOSTON.x1 + 10; x <= NYC.x0 - 10; x += 50)
    for (const z of [-16.8, 16.8]) if (!nearRoad(x, z + Math.sign(z) * 3, 0)) props.push({ kind: 'pole', x, y: 0, z, rot: z > 0 ? Math.PI : 0 });
  // …and along the exit roads, every 55 m.
  for (const road of [TRACK_ROAD, PARK_ROAD]) {
    let next = 70;
    let dist = 0;
    for (const [a, b] of roadSegments(road)) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
      while (next < dist + len) {
        const t = next - dist;
        for (const side of [-1, 1]) {
          const x = a[0] + ux * t - uz * side * (road.width / 2 + 2), z = a[1] + uz * t + ux * side * (road.width / 2 + 2);
          if (!nearRoad(x, z, 0)) props.push({ kind: 'pole', x, y: 0, z, rot: Math.atan2(ux, uz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2) });
        }
        next += 55;
      }
      dist += len;
    }
  }

  // Overhead signs before each exit, and an EXIT sign where each ramp splits off.
  gantry(batch, physics, scene, -135, ['DEMO PARK  EXIT ↘', 'NEW YORK ▶'], ['◀ BOSTON']);
  gantry(batch, physics, scene, 135, ['NEW YORK'], ['DIRT TRACK  EXIT ↗', '◀ BOSTON']);
  for (const g of EXIT_GORES) exitSign(batch, physics, scene, g.x, g.z, g.faceX, g.lines);

  // Construction zone on the park road: a line of cones down the middle.
  for (const [a, b] of roadSegments(PARK_ROAD).slice(14, 24)) props.push({ kind: 'cone', x: (a[0] + b[0]) / 2, y: 0, z: (a[1] + b[1]) / 2, rot: 0 });
  // Things to smash on the highway between the cities. Westbound lanes are z -2..-14,
  // eastbound z 2..14 (the gantries are at x = ±135, the exits split off near x = ±25..100).
  const crates = (x: number, z: number, base: number, alongZ = true) => {
    for (let row = 0; row < base; row++)
      for (let i = 0; i < base - row; i++) {
        const o = (i - (base - row - 1) / 2) * 1.05;
        props.push({ kind: 'crate', x: alongZ ? x : x + o, y: row * 1.0, z: alongZ ? z + o : z, rot: 0 });
      }
  };
  // Crate pyramids right in the lanes.
  crates(40, -8, 4);
  crates(-70, 8, 4);
  crates(115, 8, 3);
  crates(-115, -8, 3);
  // A wall of crates across both westbound lanes…
  for (let row = 0; row < 2; row++) for (let i = 0; i < 10; i++) props.push({ kind: 'crate', x: -10, y: row * 1.0, z: -3 - i * 1.05, rot: 0 });
  // …and a wall of barrels across the eastbound ones.
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 16; i++) props.push({ kind: 'barrel', x: 75, y: row * 0.9, z: 2.8 + i * 0.68 + (row % 2) * 0.34, rot: 0, color: [0xd22f27, 0x2a6fd6, 0xf2b705][(i + row) % 3] });
  // Cone slalom down the westbound lane line, and on the eastbound side too.
  for (let x = 130; x > 60; x -= 7) props.push({ kind: 'cone', x, y: 0, z: -7.5 + (Math.round(x / 7) % 2) * 1.2, rot: 0 });
  for (let x = -130; x < -85; x += 7) props.push({ kind: 'cone', x, y: 0, z: 7.5 - (Math.round(x / 7) % 2) * 1.2, rot: 0 });
  // Barrels and barriers on the shoulders.
  for (let i = 0; i < 6; i++) props.push({ kind: 'barrel', x: 60, y: 0, z: -13 + i * 0.7, rot: 0, color: 0xf2b705 });
  for (const x of [-40, -20, 0]) props.push({ kind: 'barrier', x, y: 0, z: 13.2, rot: Math.PI / 2 });
  // Giant dominoes along the north shoulder.
  for (let i = 0; i < 14; i++) props.push({ kind: 'domino', x: -95 + i * 2.6, y: 0, z: -12.5, rot: 0 });
  // Exploding barrels on both shoulders.
  tntPyramid(props, -45, -12.5, 3, 0);
  tntPyramid(props, 100, 12.5, 4, 0);

  // On the exit roads: crate stacks to plough through.
  for (const [road, at] of [[TRACK_ROAD, 0.55], [TRACK_ROAD, 0.8], [PARK_ROAD, 0.5], [PARK_ROAD, 0.75]] as const) {
    const [a, b] = roadSegments(road)[Math.floor(at * (road.pts.length - 2))];
    const ux = b[0] - a[0], uz = b[1] - a[1];
    crates((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 3, Math.abs(ux) > Math.abs(uz));
  }
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 3 - row; i++) props.push({ kind: 'crate', x: -80 + i * 1.05 + row * 0.52, y: row * 1.0, z: -300, rot: 0 });

  // Countryside trees on the hills.
  for (let i = 0; i < 380; i++) {
    const x = rand(rng, WORLD.x0 + 150, WORLD.x1 - 60), z = rand(rng, WORLD.z0 + 40, WORLD.z1 - 40);
    if (inAABB(x, z, BOSTON, 20) || inAABB(x, z, NYC, 20) || inAABB(x, z, DEMO_PARK, 25) || inAABB(x, z, TRACK_BOUNDS, 15)) continue;
    if (nearRoad(x, z, 10) || waterDepth(x, z) > 0) continue;
    // Not on the mountain road or its cliffs (the plateau gets a few).
    const m = mountainCoords(x, z);
    if (m.r > MOUNTAIN.r - 8 && m.r < MOUNTAIN.r + MOUNTAIN.road + 10) continue;
    props.push({ kind: 'tree', x, y: terrainHeight(terrain, x, z) - 0.3, z, rot: rng() * 6.28 });
  }

  return { props };
}
