import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { JUMP, LOOP, TRACK } from './layout';
import { StaticBatch } from './batch';
import { box } from '../vehicles/builders/geo';
import { textPanel, twoSidedSign } from './landmarks';
import type { PropSpawn } from './propModels';

/** Static mesh + trimesh collider from the same triangles. */
function solid(batch: StaticBatch, physics: Physics, material: string, pos: number[], idx: number[], colors: number[], isLoop = false) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  batch.add(material, g);
  const desc = RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)).setFriction(0.9);
  const col = physics.world.createCollider(desc);
  if (isLoop) physics.registerLoop(col);
  physics.setOwner(col, { kind: 'ground', material: 'ground' });
}

/**
 * A ramp from `a` to `b` (ground x,z), rising from h0 to h1 (with an optional curve,
 * >1 = kicker that gets steeper at the top), `w` wide. Solid underneath, down to `base`.
 */
export function ramp(batch: StaticBatch, physics: Physics, a: [number, number], b: [number, number], h0: number, h1: number, w: number, color: [number, number, number], curve = 1, steps = 10, base = 0) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
  const px = -dz, pz = dx; // across the ramp
  const pos: number[] = [], idx: number[] = [], col: number[] = [];
  const hw = w / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const h = h0 + (h1 - h0) * Math.pow(t, curve);
    const cx = a[0] + dx * len * t, cz = a[1] + dz * len * t;
    // top-left, top-right, bottom-left, bottom-right (left = -perp)
    pos.push(cx - px * hw, h, cz - pz * hw, cx + px * hw, h, cz + pz * hw, cx - px * hw, base, cz - pz * hw, cx + px * hw, base, cz + pz * hw);
    // Stripes on the top so ramps read clearly
    const stripe = i % 2 ? 1 : 0.82;
    for (let k = 0; k < 4; k++) col.push(color[0] * (k < 2 ? stripe : 0.7), color[1] * (k < 2 ? stripe : 0.7), color[2] * (k < 2 ? stripe : 0.7));
  }
  for (let i = 0; i < steps; i++) {
    const p = i * 4, q = (i + 1) * 4;
    idx.push(p, p + 1, q + 1, p, q + 1, q); // top
    idx.push(p, q, q + 2, p, q + 2, p + 2); // left side
    idx.push(p + 1, p + 3, q + 3, p + 1, q + 3, q + 1); // right side
  }
  const e = steps * 4;
  idx.push(0, 2, 3, 0, 3, 1);
  idx.push(e, e + 1, e + 3, e, e + 3, e + 2);
  solid(batch, physics, 'plain', pos, idx, col);
}

/** Ramp along +x (kept for the track jump). */
export function wedge(batch: StaticBatch, physics: Physics, x0: number, x1: number, h0: number, h1: number, z: number, w: number, color: [number, number, number], curve = 1, steps = 8) {
  ramp(batch, physics, [x0, z], [x1, z], h0, h1, w, color, curve, steps);
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
  solid(batch, physics, 'loop', pos, idx, col, true);
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

  // Infield stunt area: tabletop jump, kicker pairs, crate walls and dominoes.
  // Laid out in the track's original coordinates (centre at -600, -420).
  const X = (x: number) => x + 600 + TRACK.cx, Z = (z: number) => z + 420 + TRACK.cz;
  const ic: [number, number, number] = [0.62, 0.45, 0.3];
  ramp(batch, physics, [X(-705), Z(-420)], [X(-688), Z(-420)], 0, 3.5, 12, ic, 1.2);
  ramp(batch, physics, [X(-688), Z(-420)], [X(-664), Z(-420)], 3.5, 3.5, 12, ic, 1, 2); // the table
  ramp(batch, physics, [X(-664), Z(-420)], [X(-644), Z(-420)], 3.5, 0, 12, ic, 0.9);
  for (const z of [Z(-385), Z(-455)]) {
    ramp(batch, physics, [X(-610), z], [X(-598), z], 0, 2.4, 8, [0.85, 0.35, 0.25], 1.4, 8);
    ramp(batch, physics, [X(-572), z], [X(-556), z], 2.0, 0, 9, [0.85, 0.35, 0.25], 0.9, 8);
  }
  for (const x of [X(-515), X(-500)])
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 9; i++) props.push({ kind: 'crate', x, y: row * 1.0, z: Z(-420) + (i - 4) * 1.02, rot: 0 });
  for (let i = 0; i < 18; i++) props.push({ kind: 'domino', x: X(-640) + i * 2.6, y: 0, z: Z(-490), rot: 0 });

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
