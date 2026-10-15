import * as THREE from 'three';

const tmp = new THREE.Vector3();

function hash(i: number) {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Push a mesh's vertices in around an impact point.
 * Displacement depends only on each vertex's position, so vertices that share a
 * position (box edges) move together and the mesh doesn't tear.
 *
 * @param point  impact point in the geometry's local space
 * @param dir    unit direction to push (local space, pointing into the object)
 * @param original undamaged positions; total displacement is capped at `maxDisp`
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
  const r2 = radius * radius;
  let moved = 0;
  for (let i = 0; i < pos.count; i++) {
    const o = i * 3;
    const dx = arr[o] - point.x, dy = arr[o + 1] - point.y, dz = arr[o + 2] - point.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) continue;
    const f = 1 - Math.sqrt(d2) / radius;
    // Crumple: jitter keyed on the *original* position so shared vertices agree.
    const key = original[o] * 73.1 + original[o + 1] * 19.7 + original[o + 2] * 41.3;
    // Wrinkle amount is limited in metres so deep crushes crumple instead of growing spikes.
    const base = depth * f * f;
    const amount = base + (hash(key) - 0.5) * Math.min(0.12, base * 0.5);
    tmp.set(arr[o] + dir.x * amount, arr[o + 1] + dir.y * amount, arr[o + 2] + dir.z * amount);
    // Cap total displacement from the undamaged shape.
    const ox = tmp.x - original[o], oy = tmp.y - original[o + 1], oz = tmp.z - original[o + 2];
    const len = Math.hypot(ox, oy, oz);
    if (len > maxDisp) {
      const k = maxDisp / len;
      tmp.set(original[o] + ox * k, original[o + 1] + oy * k, original[o + 2] + oz * k);
    }
    arr[o] = tmp.x;
    arr[o + 1] = tmp.y;
    arr[o + 2] = tmp.z;
    moved++;
  }
  if (moved) {
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
  }
  return moved;
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
    const h = hash(original[o] * 31.7 + original[o + 1] * 57.3 + original[o + 2] * 11.1);
    // Mostly grey bare metal, some dark scratches, a few rust-brown primer flecks.
    if (h < 0.18) scrape.setRGB(0.08, 0.08, 0.085);
    else if (h < 0.26) scrape.setRGB(0.32, 0.18, 0.1);
    else scrape.setRGB(0.42 + h * 0.2, 0.43 + h * 0.2, 0.45 + h * 0.2);
    // Patchy: about a third of the area keeps most of its paint.
    const k = Math.min(0.9, f * (h > 0.35 ? 0.5 + h * 0.6 : 0.15));
    c[o] += (scrape.r - c[o]) * k;
    c[o + 1] += (scrape.g - c[o + 1]) * k;
    c[o + 2] += (scrape.b - c[o + 2]) * k;
    changed = true;
  }
  if (changed) col.needsUpdate = true;
}
