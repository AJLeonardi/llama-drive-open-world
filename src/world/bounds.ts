// World extents (plain data, shared by everything without import cycles).

/**
 * The detailed middle of the map (cities, track, park, mountain): its terrain and
 * physics are built once at start-up on an 8 m grid. (It reaches further east, where NYC is.)
 */
export const WORLD = { x0: -1536, x1: 2048, z0: -1536, z1: 1536 };
/** The whole drivable map: the highway country beyond WORLD is streamed in chunks. */
export const OUTER = { x0: -6144, x1: 6144, z0: -6144, z1: 6144 };
/** Streamed chunk size (m); WORLD's edges sit on chunk boundaries. */
export const CHUNK = 512;
/** Terrain sample spacing (m). Physics heightfields and terrain meshes share it. */
export const TERRAIN_CELL = 8;

/**
 * Highway directions: line normals 120° apart (they sum to zero, which the spacing
 * trick in outer.ts relies on). The Ring highway is the hexagon with these six normals.
 */
export const FAMILY_NORMALS = [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6];
/** The Ring highway runs this far from the middle (hexagon apothem). */
export const RING_APOTHEM = 5200;
const HEX_NORMALS = [0, 1, 2, 3, 4, 5].map((k) => FAMILY_NORMALS[k % 3] + (k >= 3 ? Math.PI : 0)).map((a) => [Math.cos(a), Math.sin(a)] as const);
export const HEX = HEX_NORMALS;
/** "Hexagon distance" from the middle: RING_APOTHEM means on the Ring. */
export const hexDistance = (x: number, z: number) => {
  let m = -Infinity;
  for (const [nx, nz] of HEX_NORMALS) m = Math.max(m, nx * x + nz * z);
  return m;
};
