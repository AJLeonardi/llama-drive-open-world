import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { DEMO_PARK, DEMO_PARK_GATE } from './layout';
import { StaticBatch } from './batch';
import { box } from '../vehicles/builders/geo';
import { textPanel, twoSidedSign } from './landmarks';
import { ramp } from './dirtTrack';
import { PropSpawn, tntPyramid } from './propModels';
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

  // Contents are laid out in the park's original coordinates (north-west corner at 440, 270).
  const X = (x: number) => x - 440 + x0, Z = (z: number) => z - 270 + z0;
  const P = (x: number, z: number): [number, number] => [X(x), Z(z)];

  // ---- North: cone slalom, crate stacks, and a glass-pane alley to smash down the middle
  for (let i = 0; i < 12; i++) props.push({ kind: 'cone', x: X(470 + i * 7), y: 0, z: Z(292 + (i % 2) * 7), rot: 0 });
  crateStack(props, X(500), Z(345), 4);
  crateStack(props, X(545), Z(345), 5);
  for (let i = 0; i < 9; i++) props.push({ kind: 'pane', x: X(600 + i * 7), y: 0, z: Z(318), rot: 0 });
  for (let i = 0; i < 9; i++) props.push({ kind: 'pane', x: X(603 + i * 7), y: 0, z: Z(336), rot: 0 });
  // Tall crate tower
  for (let lvl = 0; lvl < 7; lvl++)
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) props.push({ kind: 'crate', x: X(745 + i * 1.02), y: lvl * 1.0, z: Z(300 + j * 1.02), rot: 0 });

  // ---- Middle: mega ramp A launches east into a huge crate pile; barrels and brick walls
  ramp(batch, physics, P(500, 440), P(545, 440), 0, 7, 14, [0.55, 0.57, 0.62], 1.6, 12);
  crateStack(props, X(615), Z(440), 6);
  crateStack(props, X(628), Z(430), 4);
  crateStack(props, X(628), Z(450), 4);
  barrelStack(props, X(690), Z(385), 5);
  barrelStack(props, X(730), Z(405), 4);
  barrelStack(props, X(470), Z(395), 4);
  blockWall(props, X(660), Z(475), 16, 6, false);
  blockWall(props, X(760), Z(460), 12, 5, true);
  // Giant bowling pins
  for (let row = 0; row < 4; row++)
    for (let i = 0; i <= row; i++) props.push({ kind: 'pin', x: X(700 + row * 2.2), y: 0, z: Z(440 + (i - row / 2) * 2.3), rot: 0 });

  // ---- South: the stunt show — boost, big ramp, fly over a row of junk cars, land, smash a crate wall
  ramp(batch, physics, P(480, 560), P(527, 560), 0, 8.5, 12, [0.95, 0.65, 0.15], 1.5, 12);
  for (let i = 0; i < 10; i++) parked.push({ style: 'junk', color: [0x8a6d4a, 0x6b7a80, 0x7a4a3a, 0x5a6b4a][i % 4], x: X(540 + i * 2.3), z: Z(560), heading: 0, wrecked: true });
  ramp(batch, physics, P(590, 560), P(645, 560), 6.5, 0, 14, [0.95, 0.65, 0.15], 0.8, 12);
  for (let row = 0; row < 4; row++)
    for (let i = 0; i < 8; i++) props.push({ kind: 'crate', x: X(735), y: row * 1.0, z: Z(556 + (i - 3.5) * 1.02), rot: 0 });
  // Small kicker jumps
  ramp(batch, physics, P(480, 615), P(492, 615), 0, 1.8, 7, [0.9, 0.3, 0.25], 1.4, 6);
  ramp(batch, physics, P(520, 615), P(532, 615), 0, 1.8, 7, [0.9, 0.3, 0.25], 1.4, 6);
  // A long line of giant dominoes along the south wall
  for (let i = 0; i < 44; i++) {
    const x = X(560 + i * 2.6);
    props.push({ kind: 'domino', x, y: 0, z: Z(622 - Math.sin(i * 0.25) * 6), rot: Math.cos(i * 0.25) * 0.25 });
  }

  // Exploding barrels: two big pyramids just inside the gate, more pyramids around the
  // park (a big one by the dominoes), and a "minefield" row across the middle.
  tntPyramid(props, X(578), Z(322), 5, 0);
  tntPyramid(props, X(710), Z(345), 5, 0);
  tntPyramid(props, X(560), Z(395), 4, 0);
  tntPyramid(props, X(470), Z(500), 3, Math.PI / 2);
  tntPyramid(props, X(700), Z(598), 5, 0);
  tntPyramid(props, X(690), Z(530), 3, 0);
  for (let i = 0; i < 9; i++) props.push({ kind: 'tnt', x: X(590 + i * 12), y: 0, z: Z(505 + (i % 2) * 6), rot: 0 });

  // Junk car lot along the east side (light — they crumple and go flying)
  for (let i = 0; i < 7; i++)
    parked.push({ style: i % 4 === 3 ? 'van' : 'junk', color: [0x8a6d4a, 0x6b7a80, 0x7a4a3a, 0x5a6b4a][i % 4], x: X(762), z: Z(500 + i * 6), heading: Math.PI / 2 + (i % 2) * 0.2, wrecked: true });
  return { props, parked };
}
