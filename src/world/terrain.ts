import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { HARBOR, LAKE, TERRAIN_CELL, WATER_LEVEL, WORLD, HARBOR_X, RIVER, heightAt, surfaceAt } from './layout';
import { biomeAt } from './biomes';
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

/** How far (cells) each terrain collider reaches past the area it owns (see Physics.registerGround). */
export const GROUND_OVERLAP = 2;

/**
 * A terrain collider for the area x0..x0+cols-1 cells (z likewise), reaching GROUND_OVERLAP
 * cells further all round; `inside(c, r)` gives the heights within the area, heightAt the rest.
 */
export function groundPiece(physics: Physics, x0: number, z0: number, cols: number, rows: number, inside: (c: number, r: number) => number) {
  const M = GROUND_OVERLAP, C = cols + 2 * M, R = rows + 2 * M;
  const h = new Float32Array(C * R);
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      const ci = c - M, ri = r - M;
      h[r * C + c] = ci >= 0 && ci < cols && ri >= 0 && ri < rows ? inside(ci, ri) : heightAt(x0 + ci * TERRAIN_CELL, z0 + ri * TERRAIN_CELL);
    }
  const w = (cols - 1) * TERRAIN_CELL, d = (rows - 1) * TERRAIN_CELL;
  const col = heightfieldCollider(physics, C, R, h, x0 + w / 2, z0 + d / 2);
  physics.registerGround(col, x0, z0, x0 + w, z0 + d);
  return col;
}

export function addTerrainCollider(physics: Physics, t: Terrain) {
  groundPiece(physics, WORLD.x0, WORLD.z0, t.cols, t.rows, (c, r) => t.heights[r * t.cols + c]);
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
  snow: [0.9, 0.92, 0.95],
  water: [0.45, 0.5, 0.38],
  asphalt: [0.3, 0.3, 0.32],
};

const ROCK = [0.46, 0.41, 0.36];

/**
 * A terrain mesh for a patch of `nc`×`nr` cells starting at (x0, z0), with surface-based
 * vertex colours (steep slopes show bare rock). `h(c, r)` gives the height at a grid
 * point and may be asked for points one cell outside the patch (for slopes).
 */
export function terrainPatch(x0: number, z0: number, nc: number, nr: number, h: (c: number, r: number) => number, withBiomes = false, surf?: (c: number, r: number) => Surface) {
  const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [], biome: number[] = [], extra: number[] = [];
  for (let r = 0; r <= nr; r++)
    for (let c = 0; c <= nc; c++) {
      const x = x0 + c * TERRAIN_CELL, z = z0 + r * TERRAIN_CELL;
      const y = h(c, r);
      pos.push(x, y, z);
      uv.push(x / 24, z / 24);
      const s0 = surf ? surf(c, r) : surfaceAt(x, z);
      const s = s0 === 'asphalt' ? 'concrete' : s0;
      const base = GROUND_COLORS[s];
      const n = 0.88 + 0.24 * valueNoise(x / 40, z / 40);
      // Hills get a little lighter on top.
      const lift = s === 'grass' ? Math.min(0.12, Math.max(0, y) * 0.004) : 0;
      // Steep slopes (cliffs, terrace drop-offs, cuttings) show bare rock.
      const slope = Math.hypot(h(c + 1, r) - h(c - 1, r), h(c, r + 1) - h(c, r - 1)) / (2 * TERRAIN_CELL);
      const rock = s === 'grass' || s === 'dirt' ? Math.min(1, Math.max(0, (slope - 0.45) * 2.5)) : 0;
      const rn = 0.8 + 0.3 * valueNoise(x / 9, y / 6);
      for (let k = 0; k < 3; k++) col.push((base[k] * n + (k < 2 ? lift : lift * 0.5)) * (1 - rock) + ROCK[k] * rn * rock);
      // Regions (photo-textured by groundMaterial): how much of each, how rocky (cliffs
      // and steep slopes: the desert's sandstone shows soonest, grassy hills hold on
      // longest), and how autumnal the forest is.
      if (withBiomes) {
        const b = s0 === 'asphalt' ? null : biomeAt(x, z);
        if (!b) biome.push(0, 0, 0, 0), extra.push(0, 0);
        else {
          biome.push(b.desert, b.forest, b.farm, b.mountain);
          const r = (from: number, k: number) => Math.min(1, Math.max(0, (slope - from) * k));
          const sum = b.desert + b.forest + b.farm + b.mountain || 1;
          extra.push((b.desert * r(0.32, 3.5) + (b.forest + b.farm) * r(0.62, 3) + b.mountain * r(0.95 + Math.max(0, y - 160) * 0.003, 2.2)) / sum, b.autumn);
        }
      }
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
  if (withBiomes) {
    g.setAttribute('aBiome', new THREE.Float32BufferAttribute(biome, 4));
    g.setAttribute('aExtra', new THREE.Float32BufferAttribute(extra, 2));
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Terrain meshes for the middle of the map, one per batch tile. */
export function addTerrainMeshes(batch: StaticBatch, t: Terrain) {
  const per = TILE / TERRAIN_CELL;
  const at = (rr: number, cc: number) => t.heights[Math.min(t.rows - 1, Math.max(0, rr)) * t.cols + Math.min(t.cols - 1, Math.max(0, cc))];
  for (let c0 = 0; c0 < t.cols - 1; c0 += per)
    for (let r0 = 0; r0 < t.rows - 1; r0 += per) {
      const nc = Math.min(per, t.cols - 1 - c0), nr = Math.min(per, t.rows - 1 - r0);
      batch.add('ground', terrainPatch(WORLD.x0 + c0 * TERRAIN_CELL, WORLD.z0 + r0 * TERRAIN_CELL, nc, nr, (c, r) => at(r0 + r, c0 + c)));
    }
}

/** Rapier heightfield over `cols`×`rows` samples (row-major heights) centred on (cx, cz). */
export function heightfieldCollider(physics: Physics, cols: number, rows: number, heights: ArrayLike<number>, cx: number, cz: number) {
  // Rapier wants column-major heights with rows along z and columns along x.
  const h = new Float32Array(rows * cols);
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) h[r + c * rows] = heights[r * cols + c];
  // FIX_INTERNAL_EDGES stops cars 'catching' on the seams between terrain triangles.
  const desc = RAPIER.ColliderDesc.heightfield(rows - 1, cols - 1, h, { x: (cols - 1) * TERRAIN_CELL, y: 1, z: (rows - 1) * TERRAIN_CELL }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES)
    .setTranslation(cx, 0, cz)
    .setFriction(0.8);
  const col = physics.world.createCollider(desc);
  physics.setOwner(col, { kind: 'ground', material: 'ground' });
  return col;
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
  const lake = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r + LAKE.bank * 0.7, 48), mat);
  lake.geometry.rotateX(-Math.PI / 2);
  lake.geometry.translate(LAKE.x, WATER_LEVEL, LAKE.z);
  lake.renderOrder = 2;
  lake.receiveShadow = true;
  return [mk(HARBOR_X + 6, RIVER.x1, RIVER.z - w, RIVER.z + w), mk(HARBOR.x0 + 20, HARBOR_X + 6, -HARBOR.z + 4, HARBOR.z - 4), lake];
}
