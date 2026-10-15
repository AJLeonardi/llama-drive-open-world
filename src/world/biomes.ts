// Regions of highway country with their own look. For now: the desert, a wide sector
// south-south-west of the cities (the south highway from Boston runs straight into it).
import { smoothstep, valueNoise } from '../util/math';
import { WORLD } from './bounds';

/** Which way the desert lies from the middle (angle from +z, i.e. south). */
const DESERT_ANGLE = Math.atan2(-0.3, 1);
/** Half-width of the desert sector (radians), before its edges are roughened. */
const DESERT_HALF = 0.9;

/** 0..1: how much a spot is desert (0 in the middle of the map, 1 deep in the desert). */
export function desertWeight(x: number, z: number) {
  const out = Math.max(WORLD.x0 - x, x - WORLD.x1, WORLD.z0 - z, z - WORLD.z1);
  if (out <= 0) return 0;
  let d = Math.atan2(x, z) - DESERT_ANGLE;
  d = Math.abs(((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
  // Ragged edge: the boundary wanders in and out.
  const edge = DESERT_HALF + 0.25 * (valueNoise(x / 900 + 5, z / 900 - 2) - 0.5);
  return (1 - smoothstep(edge - 0.15, edge + 0.15, d)) * smoothstep(0, 450, out);
}
