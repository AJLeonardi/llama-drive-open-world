import * as THREE from 'three';
import { valueNoise } from '../util/math';

const across = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

/**
 * Crush a mesh around an impact like sheet metal, not clay: whatever sticks out
 * towards the impact gets flattened back to a crush plane `depth` deep (as if pressed
 * by a wall), with sharp accordion folds running across the flattened face, easing
 * off towards the edge of the hit. Repeated hits keep crushing further. Total movement
 * from the undamaged shape is capped at `maxDisp` so parts never fold through each
 * other. Displacement depends only on each vertex's position (and its original
 * position, for the fold pattern), so vertices that share a position move together
 * and the mesh never cracks open by itself.
 *
 * @param point  impact point in the geometry's local space
 * @param dir    unit direction to push (local space, pointing into the object)
 * @param original undamaged positions
 * @returns how many vertices moved
 */
export function dentGeometry(
  geo: THREE.BufferGeometry,
  original: Float32Array,
  point: THREE.Vector3,
  dir: THREE.Vector3,
  depth: number,
  radius: number,
  maxDisp = 0.5,
) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  const colAttr = geo.attributes.color as THREE.BufferAttribute | undefined;
  const col = colAttr?.array as Float32Array | undefined;
  const r2 = radius * radius;
  // Folds run across the direction of the hit (horizontal creases on a side hit,
  // vertical ones on a head-on hit).
  across.crossVectors(dir, up);
  if (across.lengthSq() < 1e-4) across.set(1, 0, 0);
  across.normalize();
  const fold = Math.min(0.14, 0.03 + depth * 0.09); // crease height
  const wave = 0.22; // crease spacing (m)
  let moved = 0;
  for (let i = 0; i < pos.count; i++) {
    const o = i * 3;
    const dx = arr[o] - point.x, dy = arr[o + 1] - point.y, dz = arr[o + 2] - point.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) continue;
    // How far into the car this vertex is, and how far off the line of the hit.
    const into = dx * dir.x + dy * dir.y + dz * dir.z;
    const side = Math.sqrt(Math.max(0, d2 - into * into));
    // Flat plateau in the middle of the hit, easing off at the edge.
    const reach = 1 - smooth(radius * 0.45, radius, side);
    if (reach <= 0) continue;
    // Accordion creases keyed on the undamaged shape (sharp triangle wave).
    const u = (original[o] * across.x + original[o + 1] * across.y + original[o + 2] * across.z) / wave;
    const crease = (Math.abs(u - Math.floor(u) - 0.5) * 2 - 0.5) * fold;
    const plane = (depth + crease) * reach;
    if (into >= plane) continue; // already pushed in further than this hit reaches
    const push = plane - into;
    let nx = arr[o] + dir.x * push, ny = arr[o + 1] + dir.y * push, nz = arr[o + 2] + dir.z * push;
    // Cap total movement from the undamaged shape.
    const ox = nx - original[o], oy = ny - original[o + 1], oz = nz - original[o + 2];
    const len = Math.hypot(ox, oy, oz);
    if (len > maxDisp) {
      const k = maxDisp / len;
      nx = original[o] + ox * k;
      ny = original[o + 1] + oy * k;
      nz = original[o + 2] + oz * k;
    }
    arr[o] = nx;
    arr[o + 1] = ny;
    arr[o + 2] = nz;
    // Shade the creases (darker in the valleys) so the folds read as bent metal even
    // with smooth shading.
    if (col && fold > 0) {
      const valley = Math.max(0, -crease / (fold * 0.5));
      const k = 1 - 0.32 * valley * reach;
      for (let ch = 0; ch < 3; ch++) col[o + ch] = Math.max(0.03, col[o + ch] * k);
    }
    moved++;
  }
  if (moved) {
    pos.needsUpdate = true;
    if (colAttr) colAttr.needsUpdate = true;
    geo.computeBoundingSphere();
  }
  return moved;
}

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const scrape = new THREE.Color();

/**
 * Scrape the paint around an impact: vertex colours blend toward bare metal/primer
 * with darker scratch streaks. Keyed on original positions so it stays stable.
 */
export function scuffGeometry(geo: THREE.BufferGeometry, original: Float32Array, point: THREE.Vector3, radius: number, strength: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = geo.attributes.color as THREE.BufferAttribute | undefined;
  if (!col) return;
  const arr = pos.array as Float32Array, c = col.array as Float32Array;
  const r2 = radius * radius;
  let changed = false;
  for (let i = 0; i < pos.count; i++) {
    const o = i * 3;
    const dx = arr[o] - point.x, dy = arr[o + 1] - point.y, dz = arr[o + 2] - point.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) continue;
    const f = (1 - Math.sqrt(d2) / radius) * strength;
    // Smooth patches (not per-vertex speckle, which blends into camouflage blotches):
    // mostly bright bare metal, a few darker scratch streaks, a little rust-brown primer.
    const ox = original[o], oy = original[o + 1], oz = original[o + 2];
    const patchy = valueNoise((ox + oz) / 0.22 + 3, oy / 0.22);
    const streak = valueNoise((ox - oz) / 0.05, oy / 0.6 + 9);
    if (streak > 0.82) scrape.setRGB(0.12, 0.12, 0.13);
    else if (patchy < 0.18) scrape.setRGB(0.36, 0.22, 0.14);
    else scrape.setRGB(0.6 + patchy * 0.15, 0.61 + patchy * 0.15, 0.63 + patchy * 0.15);
    const k = Math.min(0.85, f * (0.35 + patchy * 0.8));
    c[o] += (scrape.r - c[o]) * k;
    c[o + 1] += (scrape.g - c[o + 1]) * k;
    c[o + 2] += (scrape.b - c[o + 2]) * k;
    changed = true;
  }
  if (changed) col.needsUpdate = true;
}

/**
 * Tear holes in crushed sheet metal: triangles near the impact whose vertices have been
 * pushed far from where they started are removed (collapsed), leaving a ragged hole
 * that shows what's underneath. Bigger hits tear more. Keyed on original positions so
 * the edge of the hole is the same ragged shape however often it's hit.
 *
 * @returns how many triangles tore, and where (centroid of the torn area, local space)
 */
export function tearGeometry(geo: THREE.BufferGeometry, original: Float32Array, point: THREE.Vector3, radius: number, strength: number) {
  const index = geo.index;
  const out = { torn: 0, center: new THREE.Vector3() };
  if (!index) return out;
  const pos = geo.attributes.position.array as Float32Array;
  const idx = index.array as Uint16Array | Uint32Array;
  const r2 = radius * radius;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a === b && b === c) continue; // already torn
    let cx = 0, cy = 0, cz = 0, disp = 0, ox = 0, oy = 0, oz = 0;
    for (const v of [a, b, c]) {
      const o = v * 3;
      cx += pos[o] / 3;
      cy += pos[o + 1] / 3;
      cz += pos[o + 2] / 3;
      ox += original[o] / 3;
      oy += original[o + 1] / 3;
      oz += original[o + 2] / 3;
      disp += Math.hypot(pos[o] - original[o], pos[o + 1] - original[o + 1], pos[o + 2] - original[o + 2]) / 3;
    }
    const dx = cx - point.x, dy = cy - point.y, dz = cz - point.z;
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    // Only metal that's really been crushed tears, and more of it the harder the hit.
    // Smooth noise (not a per-triangle coin toss) so whole patches go, leaving real holes
    // with jagged edges rather than a sieve.
    const n = 0.6 * valueNoise((ox + oz * 0.7) / 0.32, oy / 0.32) + 0.4 * valueNoise((oz - ox * 0.6) / 0.13 + 7, oy / 0.13 - 3);
    if (disp < 0.3 || n > 0.22 + strength * 0.7) continue;
    idx[t + 1] = a;
    idx[t + 2] = a;
    out.torn++;
    out.center.x += cx;
    out.center.y += cy;
    out.center.z += cz;
  }
  if (out.torn) {
    out.center.divideScalar(out.torn);
    index.needsUpdate = true;
  }
  return out;
}
