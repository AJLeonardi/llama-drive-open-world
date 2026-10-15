// The natural lie of the land, before roads, cities and lakes shape it.
import { lerp, smoothstep, valueNoise } from '../util/math';
import { RING_APOTHEM, hexDistance } from './bounds';
import { desertWeight } from './biomes';

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
  return hills(x, z) + big + edge + desertShapes(x, z);
}

/** The south highway's canyon: red cliffs either side of the road for a stretch. */
export const CANYON = { x: -540, z0: 2300, z1: 3500 };

/**
 * Desert landforms on top of the hills: long soft dunes, flat-topped mesas with cliff
 * sides and a ledge partway up, and the canyon the south highway runs through.
 */
function desertShapes(x: number, z: number) {
  const dw = desertWeight(x, z);
  if (dw <= 0) return 0;
  const dune = 4.5 * Math.abs(Math.sin(x * 0.012 + z * 0.005 + 3 * valueNoise(x / 280, z / 280))) ** 2;
  const m = valueNoise(x / 520 + 40, z / 520 - 13);
  const mesa = 26 * smoothstep(0.56, 0.59, m) + 15 * smoothstep(0.68, 0.705, m);
  const along = smoothstep(CANYON.z0, CANYON.z0 + 250, z) * (1 - smoothstep(CANYON.z1 - 250, CANYON.z1, z));
  const wall = smoothstep(55, 75, Math.abs(x - CANYON.x)) * (1 - smoothstep(260, 340, Math.abs(x - CANYON.x)));
  const canyon = along * wall * (30 + 10 * valueNoise(x / 60, z / 60));
  return dw * (dune + Math.max(mesa, canyon));
}
