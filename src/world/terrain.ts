import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { TERRAIN_CELL, WATER_LEVEL, WORLD, HARBOR_X, RIVER, heightAt, surfaceAt } from './layout';
import { StaticBatch, TILE } from './batch';
import { valueNoise } from '../util/math';
import type { Surface } from '../physics/surfaces';

export interface Terrain {
  cols: number; // samples along x
  rows: number; // samples along z
  heights: Float32Array; // [row * cols + col]
}

/** Sample the terrain on the shared grid (also used by the physics heightfield). */
export function sampleTerrain(): Terrain {
  const cols = Math.round((WORLD.x1 - WORLD.x0) / TERRAIN_CELL) + 1;
  const rows = Math.round((WORLD.z1 - WORLD.z0) / TERRAIN_CELL) + 1;
  const heights = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) heights[r * cols + c] = heightAt(WORLD.x0 + c * TERRAIN_CELL, WORLD.z0 + r * TERRAIN_CELL);
  return { cols, rows, heights };
}

export function addTerrainCollider(physics: Physics, t: Terrain) {
  // Rapier wants column-major heights with rows along z and columns along x.
  const nr = t.rows - 1, nc = t.cols - 1;
  const h = new Float32Array(t.rows * t.cols);
  for (let c = 0; c < t.cols; c++) for (let r = 0; r < t.rows; r++) h[r + c * t.rows] = t.heights[r * t.cols + c];
  // FIX_INTERNAL_EDGES stops cars 'catching' on the seams between terrain triangles.
  const desc = RAPIER.ColliderDesc.heightfield(nr, nc, h, { x: WORLD.x1 - WORLD.x0, y: 1, z: WORLD.z1 - WORLD.z0 }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES)
    .setTranslation((WORLD.x0 + WORLD.x1) / 2, 0, (WORLD.z0 + WORLD.z1) / 2)
    .setFriction(0.8);
  const col = physics.world.createCollider(desc);
  physics.setOwner(col, { kind: 'ground', material: 'ground' });
}

/** Interpolated height from the sampled grid (matches the physics surface). */
export function terrainHeight(t: Terrain, x: number, z: number) {
  const fx = (x - WORLD.x0) / TERRAIN_CELL, fz = (z - WORLD.z0) / TERRAIN_CELL;
  const c = Math.max(0, Math.min(t.cols - 2, Math.floor(fx)));
  const r = Math.max(0, Math.min(t.rows - 2, Math.floor(fz)));
  const u = fx - c, v = fz - r;
  const h = (rr: number, cc: number) => t.heights[rr * t.cols + cc];
  return (h(r, c) * (1 - u) + h(r, c + 1) * u) * (1 - v) + (h(r + 1, c) * (1 - u) + h(r + 1, c + 1) * u) * v;
}

const GROUND_COLORS: Record<Surface, [number, number, number]> = {
  grass: [0.36, 0.58, 0.26],
  concrete: [0.52, 0.52, 0.5],
  dirt: [0.63, 0.47, 0.31],
  sand: [0.85, 0.77, 0.56],
  water: [0.45, 0.5, 0.38],
  asphalt: [0.3, 0.3, 0.32],
};

/** Terrain meshes, one per batch tile, with surface-based vertex colours. */
export function addTerrainMeshes(batch: StaticBatch, t: Terrain) {
  const per = TILE / TERRAIN_CELL;
  for (let c0 = 0; c0 < t.cols - 1; c0 += per) {
    for (let r0 = 0; r0 < t.rows - 1; r0 += per) {
      const nc = Math.min(per, t.cols - 1 - c0), nr = Math.min(per, t.rows - 1 - r0);
      const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let r = 0; r <= nr; r++)
        for (let c = 0; c <= nc; c++) {
          const x = WORLD.x0 + (c0 + c) * TERRAIN_CELL, z = WORLD.z0 + (r0 + r) * TERRAIN_CELL;
          const y = t.heights[(r0 + r) * t.cols + c0 + c];
          pos.push(x, y, z);
          uv.push(x / 24, z / 24);
          let s = surfaceAt(x, z);
          if (s === 'asphalt') s = 'concrete';
          const base = GROUND_COLORS[s];
          const n = 0.88 + 0.24 * valueNoise(x / 40, z / 40);
          // Hills get a little lighter on top.
          const lift = s === 'grass' ? Math.min(0.12, Math.max(0, y) * 0.006) : 0;
          col.push(base[0] * n + lift, base[1] * n + lift, base[2] * n + lift * 0.5);
        }
      for (let r = 0; r < nr; r++)
        for (let c = 0; c < nc; c++) {
          const a = r * (nc + 1) + c, b = a + 1, d = a + nc + 1, e = d + 1;
          idx.push(a, d, b, b, d, e);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      batch.add('ground', g);
    }
  }
}

export function waterMeshes(): THREE.Mesh[] {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a6b96, metalness: 0.1, roughness: 0.06, transparent: true, opacity: 0.86, depthWrite: false, envMapIntensity: 1.2 });
  const mk = (x0: number, x1: number, z0: number, z1: number) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, WATER_LEVEL, (z0 + z1) / 2);
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 2;
    m.receiveShadow = true;
    return m;
  };
  const w = RIVER.halfWidth + RIVER.bank;
  return [mk(HARBOR_X + 6, RIVER.x1, RIVER.z - w, RIVER.z + w), mk(WORLD.x0, HARBOR_X + 6, WORLD.z0, WORLD.z1)];
}
