// Where the highways run through the mountains, so the land can make valleys for them.
// outer.ts lays the roads out (flat lines on the map, before any heights) and registers
// them here; hills.ts asks how far a spot is from the nearest one. Kept apart from both
// so neither has to import the other.
import type { Vec2 } from '../util/math';
import { OUTER } from './bounds';
import { mountainWeight } from './biomes';

const CELL = 32;
/** Farther than this counts as "far from any road". */
export const CORRIDOR_FAR = 600;
const cols = Math.ceil((OUTER.x1 - OUTER.x0) / CELL) + 1;
const rows = Math.ceil((OUTER.z1 - OUTER.z0) / CELL) + 1;
let grid: Float32Array | null = null;

/** Register the roads (polylines; `closed` ones join up at the end). */
export function setCorridors(lines: { pts: readonly Vec2[]; closed: boolean }[]) {
  const g = new Float32Array(cols * rows).fill(CORRIDOR_FAR);
  // Only the mountains need it.
  const need = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) need[r * cols + c] = mountainWeight(OUTER.x0 + c * CELL, OUTER.z0 + r * CELL) > 0 ? 1 : 0;
  const R = CORRIDOR_FAR;
  // Cells within reach of the mountains (a coarse dilation of `need`).
  const nearMask = new Uint8Array(cols * rows);
  const reach = Math.ceil((R + 60) / CELL);
  for (let r = 0; r < rows; r += 4)
    for (let c = 0; c < cols; c += 4) {
      if (!need[r * cols + c]) continue;
      for (let rr = Math.max(0, r - reach - 4); rr <= Math.min(rows - 1, r + reach + 4); rr++)
        for (let cc = Math.max(0, c - reach - 4); cc <= Math.min(cols - 1, c + reach + 4); cc++) nearMask[rr * cols + cc] = 1;
    }
  for (const l of lines) {
    const n = l.pts.length;
    for (let i = 0; i < n - (l.closed ? 0 : 1); i++) {
      const [ax, az] = l.pts[i], [bx, bz] = l.pts[(i + 1) % n];
      // Skip roads nowhere near the mountains.
      const mc = Math.round((ax - OUTER.x0) / CELL), mr = Math.round((az - OUTER.z0) / CELL);
      if (!nearMask[Math.max(0, Math.min(rows - 1, mr)) * cols + Math.max(0, Math.min(cols - 1, mc))]) continue;
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - OUTER.x0) / CELL)), c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + R - OUTER.x0) / CELL));
      const r0 = Math.max(0, Math.floor((Math.min(az, bz) - R - OUTER.z0) / CELL)), r1 = Math.min(rows - 1, Math.ceil((Math.max(az, bz) + R - OUTER.z0) / CELL));
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
      for (let r = r0; r <= r1; r++) {
        const z = OUTER.z0 + r * CELL;
        for (let c = c0; c <= c1; c++) {
          const k = r * cols + c;
          if (!need[k]) continue;
          const x = OUTER.x0 + c * CELL;
          let t = ((x - ax) * dx + (z - az) * dz) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
          if (d < g[k]) g[k] = d;
        }
      }
    }
  }
  grid = g;
}

/** Distance (m) from a spot to the nearest registered road, up to CORRIDOR_FAR. */
export function corridorDistance(x: number, z: number) {
  if (!grid) return CORRIDOR_FAR;
  const fx = (x - OUTER.x0) / CELL, fz = (z - OUTER.z0) / CELL;
  const c = Math.max(0, Math.min(cols - 2, Math.floor(fx))), r = Math.max(0, Math.min(rows - 2, Math.floor(fz)));
  const u = Math.min(1, Math.max(0, fx - c)), v = Math.min(1, Math.max(0, fz - r));
  const k = r * cols + c;
  return (grid[k] * (1 - u) + grid[k + 1] * u) * (1 - v) + (grid[k + cols] * (1 - u) + grid[k + cols + 1] * u) * v;
}
