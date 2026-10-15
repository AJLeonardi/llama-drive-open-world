// Regions of highway country with their own look. Each is a wide sector round the middle,
// with ragged edges that blend over a few hundred metres:
//   desert    south-south-west (the south highway from Boston runs straight into it)
//   forest    east, turning to autumn colours in its northern part
//   mountains north: snowy peaks with the highways winding along the valleys
//   farmland  west: flat fields and farms
// The middle of the map (WORLD) belongs to none of them.
import { smoothstep, valueNoise } from '../util/math';
import { WORLD } from './bounds';

/** How much a spot is each region (they add up to at most 1). */
export interface Biome {
  desert: number;
  forest: number;
  /** Mountains (snowy). */
  mountain: number;
  farm: number;
  /** 0..1: how autumnal the forest is here (multiply by `forest`). */
  autumn: number;
}

/**
 * Boundary angles between the regions, measured from +z (south) towards +x (east),
 * starting in the middle of the desert and going round once.
 */
const START = -0.29;
const B_DESERT_FOREST = 0.61;
const B_FOREST_MOUNTAIN = 2.0;
const B_MOUNTAIN_FARM = 3.85;
const B_FARM_DESERT = 5.09;
/** Where the forest turns autumnal (just short of the mountains). */
const B_AUTUMN = 1.12;
const BLEND = 0.15;

const outsideWorld = (x: number, z: number) => Math.max(WORLD.x0 - x, x - WORLD.x1, WORLD.z0 - z, z - WORLD.z1);

/** The angle of a spot round the middle, in [START, START + 2π). */
function angleOf(x: number, z: number) {
  let a = Math.atan2(x, z) - START;
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return a + START;
}

/** A boundary's angle at a spot: it wanders in and out (each boundary differently). */
const edge = (b: number, k: number, x: number, z: number) => b + 0.25 * (valueNoise(x / 900 + 5 + k * 17, z / 900 - 2 - k * 11) - 0.5);
const past = (a: number, b: number) => smoothstep(b - BLEND, b + BLEND, a);

export function biomeAt(x: number, z: number): Biome {
  const out = outsideWorld(x, z);
  if (out <= 0) return { desert: 0, forest: 0, mountain: 0, farm: 0, autumn: 0 };
  const k = smoothstep(0, 450, out);
  const a = angleOf(x, z);
  const s0 = past(a, edge(B_DESERT_FOREST, 0, x, z));
  const s1 = past(a, edge(B_FOREST_MOUNTAIN, 1, x, z));
  const s2 = past(a, edge(B_MOUNTAIN_FARM, 2, x, z));
  const s3 = past(a, edge(B_FARM_DESERT, 3, x, z));
  return {
    desert: k * (1 - s0 + s3),
    forest: k * (s0 - s1),
    mountain: k * (s1 - s2),
    farm: k * (s2 - s3),
    autumn: past(a, edge(B_AUTUMN, 4, x, z)),
  };
}

/** 0..1: how much a spot is desert (0 in the middle of the map, 1 deep in the desert). */
export function desertWeight(x: number, z: number) {
  const out = outsideWorld(x, z);
  if (out <= 0) return 0;
  const a = angleOf(x, z);
  return smoothstep(0, 450, out) * (1 - past(a, edge(B_DESERT_FOREST, 0, x, z)) + past(a, edge(B_FARM_DESERT, 3, x, z)));
}

/** 0..1: how much a spot is mountains. */
export function mountainWeight(x: number, z: number) {
  const out = outsideWorld(x, z);
  if (out <= 0) return 0;
  const a = angleOf(x, z);
  if (a < B_FOREST_MOUNTAIN - 0.5 || a > B_MOUNTAIN_FARM + 0.5) return 0;
  return smoothstep(0, 450, out) * (past(a, edge(B_FOREST_MOUNTAIN, 1, x, z)) - past(a, edge(B_MOUNTAIN_FARM, 2, x, z)));
}

// ---------------------------------------------------------------- farm fields

/** The field grid's turn (fields line up with it, not with north). */
const FIELD_ROT = 0.35;
const FIELD_W = 150, FIELD_D = 105;
export type FieldKind = 'wheat' | 'crop' | 'soil' | 'meadow' | 'corn';
const KINDS: FieldKind[] = ['wheat', 'crop', 'soil', 'meadow', 'corn', 'wheat', 'crop', 'meadow'];

/** Field cell coordinates (rotated grid; every other row shifted, like real fields). Mirrored in groundMaterial. */
export function fieldCell(x: number, z: number) {
  const c = Math.cos(FIELD_ROT), s = Math.sin(FIELD_ROT);
  const u = x * c - z * s, v = x * s + z * c;
  const j = Math.floor(v / FIELD_D);
  const i = Math.floor(u / FIELD_W + (j & 1) * 0.5);
  return { i, j };
}

/** How far a spot is from the nearest field edge (m) — where the hedges grow. */
export function fieldEdgeDistance(x: number, z: number) {
  const c = Math.cos(FIELD_ROT), s = Math.sin(FIELD_ROT);
  const u = x * c - z * s, v = x * s + z * c;
  const fv = v / FIELD_D, j = Math.floor(fv);
  const fu = u / FIELD_W + (j & 1) * 0.5;
  const du = (fu - Math.floor(fu)) * FIELD_W, dv = (fv - j) * FIELD_D;
  return Math.min(du, FIELD_W - du, dv, FIELD_D - dv);
}

/** Same hash as the shader's (no big numbers, so the GPU gets the same answer). */
export function fieldHash(i: number, j: number) {
  const fr = (v: number) => v - Math.floor(v);
  let a = fr(i * 0.1031), b = fr(j * 0.1031), c = fr(i * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  (a += d), (b += d), (c += d);
  return fr((a + b) * c);
}

export function fieldKind(x: number, z: number): FieldKind {
  const { i, j } = fieldCell(x, z);
  return KINDS[Math.floor(fieldHash(i, j) * KINDS.length)];
}
export const FIELD_GRID = { rot: FIELD_ROT, w: FIELD_W, d: FIELD_D, kinds: KINDS };
