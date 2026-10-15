import * as THREE from 'three';
import { LOOP_GROUPS, Physics, RAPIER } from '../physics/Physics';
import { JUMP, LOOP, TRACK } from './layout';
import { StaticBatch } from './batch';
import { box } from '../vehicles/builders/geo';
import { textPanel, twoSidedSign } from './landmarks';
import type { PropSpawn } from './propModels';

/** Static mesh + trimesh collider from the same triangles. */
function solid(batch: StaticBatch, physics: Physics, material: string, pos: number[], idx: number[], colors: number[], groups?: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  batch.add(material, g);
  const desc = RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)).setFriction(0.9);
  if (groups !== undefined) desc.setCollisionGroups(groups);
  const col = physics.world.createCollider(desc);
  physics.setOwner(col, { kind: 'ground', material: 'ground' });
}

/** Wedge along x: height goes from h0 at x0 to h1 at x1 (with optional curve), full width w centred on z. */
export function wedge(batch: StaticBatch, physics: Physics, x0: number, x1: number, h0: number, h1: number, z: number, w: number, color: [number, number, number], curve = 1, steps = 8) {
  const pos: number[] = [], idx: number[] = [], col: number[] = [];
  const hz = w / 2;
  const prof: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    prof.push([x0 + (x1 - x0) * t, h0 + (h1 - h0) * Math.pow(t, curve)]);
  }
  // Each profile point: 4 verts (top-left, top-right, bottom-left, bottom-right)
  for (const [x, h] of prof) pos.push(x, h, z - hz, x, h, z + hz, x, 0, z - hz, x, 0, z + hz);
  for (let i = 0; i < pos.length / 3; i++) col.push(...color);
  for (let i = 0; i < steps; i++) {
    const a = i * 4, b = (i + 1) * 4;
    idx.push(a, a + 1, b + 1, a, b + 1, b); // top
    idx.push(a, b, b + 2, a, b + 2, a + 2); // side -z
    idx.push(a + 1, a + 3, b + 3, a + 1, b + 3, b + 1); // side +z
  }
  const e = steps * 4;
  idx.push(0, 2, 3, 0, 3, 1); // start face
  idx.push(e, e + 1, e + 3, e, e + 3, e + 2); // end face
  solid(batch, physics, 'plain', pos, idx, col);
}

/**
 * Loop-the-loop surface (shared by rendering, physics and tests).
 *
 * Built like a real one: the curvature ramps up gradually on the way in and back
 * down on the way out (clothoid transitions), so a car's nose doesn't dig into the
 * curve. The path drifts sideways by 2×lateral so the exit misses the entry.
 */
export function loopGeometry() {
  const { x: xc, z: zc, radius: R, width: W, lateral: L } = LOOP;
  const kMax = 1 / R;
  const ramp = 16; // metres of curvature build-up at each end
  const total = (2 * Math.PI) / kMax + ramp;
  const n = 140;
  const ds = total / n;
  const pts: { x: number; y: number; lat: number }[] = [];
  let x = 0, y = 0, phi = 0;
  for (let i = 0; i <= n; i++) {
    const sDist = i * ds;
    pts.push({ x, y, lat: -L + (2 * L * sDist) / total });
    const k = kMax * Math.min(1, sDist / ramp, (total - sDist) / ramp);
    phi += k * ds;
    x -= Math.cos(phi) * ds;
    y += Math.sin(phi) * ds;
  }
  // Centre it on LOOP.x.
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const shift = xc - (minX + maxX) / 2;
  const pos: number[] = [], idx: number[] = [], col: number[] = [];
  pts.forEach((p, i) => {
    const stripe = Math.floor(i / 6) % 2 ? [0.9, 0.15, 0.12] : [0.95, 0.95, 0.95];
    for (const w of [-W / 2, W / 2]) {
      pos.push(p.x + shift, Math.max(0.02, p.y), zc + p.lat + w);
      col.push(...stripe);
    }
  });
  // Wind so the faces point toward the loop's centre (the side the car drives on).
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const extent = { x0: minX + shift, x1: maxX + shift, top: Math.max(...pts.map((p) => p.y)) };
  return { pos, idx, col, n, extent };
}

function loop(batch: StaticBatch, physics: Physics) {
  const { pos, idx, col } = loopGeometry();
  solid(batch, physics, 'loop', pos, idx, col, LOOP_GROUPS);
  // Side rails so it reads as a loop from a distance.
  for (let i = 0; i + 3 < pos.length / 3 - 2; i += 2) {
    for (const side of [0, 1]) {
      const a = new THREE.Vector3(pos[(i + side) * 3], pos[(i + side) * 3 + 1], pos[(i + side) * 3 + 2]);
      const b = new THREE.Vector3(pos[(i + 2 + side) * 3], pos[(i + 2 + side) * 3 + 1], pos[(i + 2 + side) * 3 + 2]);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const g = new THREE.BoxGeometry(0.3, 0.5, a.distanceTo(b) + 0.05);
      g.applyMatrix4(new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 0, 1)));
      g.translate(mid.x, Math.max(0.25, mid.y), mid.z + (side ? 0.15 : -0.15));
      batch.add('plain', g);
    }
  }
}

export function buildDirtTrack(batch: StaticBatch, physics: Physics, scene: THREE.Object3D) {
  const props: PropSpawn[] = [];
  const dirt: [number, number, number] = [0.58, 0.42, 0.27];
  const { takeoff, landing, z, width } = JUMP;
  wedge(batch, physics, takeoff.x0, takeoff.x1, 0, takeoff.h, z, width, dirt, 1.3);
  wedge(batch, physics, landing.x0, landing.x1, landing.h, 0, z, width, dirt, 0.8);
  loop(batch, physics);

  // Tire walls around the inside of both turns.
  const { cx, cz, halfStraight: hs, radius: r, width: tw } = TRACK;
  const inner = r - tw / 2 - 2;
  for (const [ex, a0] of [[cx + hs, 0], [cx - hs, Math.PI]] as const)
    for (let a = 0.15; a < Math.PI - 0.1; a += 9 / inner) {
      const ang = a0 + a;
      const x = ex + inner * Math.sin(ang), zz = cz + inner * Math.cos(ang);
      for (let k = 0; k < 3; k++) props.push({ kind: 'tire', x, y: k * 0.28, z: zz, rot: 0 });
    }

  // Start/finish arch on the south straight.
  const ax = cx + hs - 40, az = cz + r;
  for (const dz of [-tw / 2 - 1, tw / 2 + 1]) {
    batch.add('plain', box({ at: [ax, 3.5, az + dz], size: [0.8, 7, 0.8], color: 0x333333 }));
    const c = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.4, 3.5, 0.4).setTranslation(ax, 3.5, az + dz));
    physics.setOwner(c, { kind: 'building', material: 'metal' });
  }
  const banner = twoSidedSign(textPanel(['LLAMA DRIVE SPEEDWAY'], '#111111', '#ffd400', 1024, 160), tw + 2, 2.6);
  banner.position.set(ax, 6.4, az);
  banner.rotation.y = Math.PI / 2;
  scene.add(banner);
  return { props };
}
