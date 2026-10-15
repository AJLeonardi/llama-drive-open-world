import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { DEMO_PARK, DEMO_PARK_GATE } from './layout';
import { StaticBatch } from './batch';
import { box } from '../vehicles/builders/geo';
import { textPanel, twoSidedSign } from './landmarks';
import { wedge } from './dirtTrack';
import type { PropSpawn } from './propModels';
import type { ParkedSpawn } from './streetLife';

const BARREL_COLORS = [0xd22f27, 0x2a6fd6, 0xf2b705, 0x2ea44f];

function crateStack(props: PropSpawn[], x: number, z: number, base: number) {
  for (let row = 0; row < base; row++)
    for (let i = 0; i < base - row; i++)
      props.push({ kind: 'crate', x: x + (i - (base - row - 1) / 2) * 1.02, y: row * 1.0, z, rot: 0 });
}

function barrelStack(props: PropSpawn[], x: number, z: number, base: number) {
  for (let row = 0; row < base; row++)
    for (let i = 0; i < base - row; i++)
      props.push({ kind: 'barrel', x: x + (i - (base - row - 1) / 2) * 0.62, y: row * 0.9, z, rot: 0, color: BARREL_COLORS[(i + row) % 4] });
}

function blockWall(props: PropSpawn[], x: number, z: number, n: number, rows: number, alongZ: boolean) {
  for (let r = 0; r < rows; r++)
    for (let i = 0; i < n; i++) {
      const off = (i - n / 2 + (r % 2) * 0.5) * 0.92;
      props.push({ kind: 'block', x: alongZ ? x : x + off, y: r * 0.45, z: alongZ ? z + off : z, rot: alongZ ? Math.PI / 2 : 0, color: [0xa04a35, 0xb85a40, 0x8c3f2c][(i + r) % 3] });
    }
}

export function buildDemoPark(batch: StaticBatch, physics: Physics, scene: THREE.Object3D) {
  const props: PropSpawn[] = [];
  const parked: ParkedSpawn[] = [];
  const { x0, x1, z0, z1 } = DEMO_PARK;

  // Perimeter wall with a gate on the north side.
  const wall = (cx: number, cz: number, hx: number, hz: number) => {
    batch.add('plain', box({ at: [cx, 0.9, cz], size: [hx * 2, 1.8, hz * 2], seg: 2, color: (x, _y, z) => (Math.floor((x + z) / 4) % 2 ? 0xf2c230 : 0x2b2b2b) }));
    const c = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 0.9, hz).setTranslation(cx, 0.9, cz));
    physics.setOwner(c, { kind: 'building', material: 'concrete' });
  };
  wall((x0 + DEMO_PARK_GATE.x0) / 2, z0, (DEMO_PARK_GATE.x0 - x0) / 2, 0.5);
  wall((DEMO_PARK_GATE.x1 + x1) / 2, z0, (x1 - DEMO_PARK_GATE.x1) / 2, 0.5);
  wall((x0 + x1) / 2, z1, (x1 - x0) / 2, 0.5);
  wall(x0, (z0 + z1) / 2, 0.5, (z1 - z0) / 2);
  wall(x1, (z0 + z1) / 2, 0.5, (z1 - z0) / 2);

  const sign = twoSidedSign(textPanel(['DEMOLITION PARK'], '#1a1a1a', '#ffb000', 1024, 180), 26, 4.5);
  sign.position.set((DEMO_PARK_GATE.x0 + DEMO_PARK_GATE.x1) / 2, 7, z0);
  scene.add(sign);
  for (const gx of [DEMO_PARK_GATE.x0, DEMO_PARK_GATE.x1]) {
    batch.add('plain', box({ at: [gx, 4.5, z0], size: [1, 9, 1], color: 0x2b2b2b }));
    const c = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 4.5, 0.5).setTranslation(gx, 4.5, z0));
    physics.setOwner(c, { kind: 'building', material: 'metal' });
  }

  // Things to smash.
  crateStack(props, 520, 320, 4);
  crateStack(props, 680, 320, 4);
  crateStack(props, 600, 350, 5);
  barrelStack(props, 520, 390, 4);
  barrelStack(props, 680, 390, 4);
  blockWall(props, 600, 405, 14, 5, false);
  blockWall(props, 500, 470, 12, 4, true);

  // Mega ramp (launch eastward) with a boost pad before it and a big crate pile to land in.
  wedge(batch, physics, 520, 560, 0, 7, 448, 14, [0.55, 0.55, 0.6], 1.6, 12);
  crateStack(props, 640, 448, 6);
  crateStack(props, 652, 438, 4);

  // Giant bowling pins
  const px = 700, pz = 470;
  for (let row = 0; row < 4; row++)
    for (let i = 0; i <= row; i++) props.push({ kind: 'pin', x: px + row * 2.2, y: 0, z: pz + (i - row / 2) * 2.3, rot: 0 });

  // Cones slalom
  for (let i = 0; i < 10; i++) props.push({ kind: 'cone', x: 480 + i * 7, y: 0, z: 290 + (i % 2) * 6, rot: 0 });

  // Junk cars in a row
  for (let i = 0; i < 8; i++)
    parked.push({ style: i % 4 === 3 ? 'van' : 'junk', color: [0x8a6d4a, 0x6b7a80, 0x7a4a3a, 0x5a6b4a][i % 4], x: 490 + i * 30, z: 485, heading: Math.PI / 2 + (i % 2) * 0.3, wrecked: true });
  return { props, parked };
}
