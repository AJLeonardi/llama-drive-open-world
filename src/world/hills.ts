// The natural lie of the land, before roads, cities and lakes shape it.
import { lerp, smoothstep, valueNoise } from '../util/math';
import { RING_APOTHEM, hexDistance } from './bounds';

/** Hills with flat terraces and steep drop-offs between them in places. */
export function hills(x: number, z: number) {
  let h = 34 * (valueNoise(x / 300 + 11, z / 300 - 4) - 0.38) + 9 * (valueNoise(x / 110 + 7, z / 110 + 3) - 0.5);
  const terraced = smoothstep(0.42, 0.58, valueNoise(x / 240 - 3, z / 240 + 9));
  if (terraced > 0 && h > 0) {
    const STEP = 6.5;
    const t = h / STEP, f = t - Math.floor(t);
    h = lerp(h, STEP * (Math.floor(t) + smoothstep(0.82, 1, f)), terraced);
  }
  return Math.max(h, -2);
}

/**
 * Hills everywhere, growing into big rolling country and valleys away from the middle,
 * with mountains beyond the Ring highway at the edge of the map.
 */
export function terrainBase(x: number, z: number) {
  const k = smoothstep(1400, 3200, Math.hypot(x, z));
  const big = k > 0 ? k * (80 * (valueNoise(x / 1100 + 3.3, z / 1100 - 7.1) - 0.45) + 24 * (valueNoise(x / 380 - 2.2, z / 380 + 5.4) - 0.5)) : 0;
  const edge = smoothstep(RING_APOTHEM + 250, RING_APOTHEM + 900, hexDistance(x, z)) * 170;
  return hills(x, z) + big + edge;
}
