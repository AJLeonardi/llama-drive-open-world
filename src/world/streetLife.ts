import { AABB2, Rng, inAABB, pick, rand } from '../util/math';
import { Road, nearRoad, roadSegments, waterDepth, bridgeAt } from './layout';
import type { PropKind, PropSpawn } from './propModels';
import type { ParkedStyle } from '../vehicles/ParkedCar';
import { SIDEWALK_H } from './roads';

export interface ParkedSpawn {
  style: ParkedStyle;
  color: number;
  x: number;
  z: number;
  heading: number;
  wrecked?: boolean;
  /** Height of the floor it's parked on (garage decks); ground if left out. */
  y?: number;
}

export const CAR_COLORS = [0xc0392b, 0x2e86de, 0x27ae60, 0xf5f6fa, 0x2d3436, 0x8e44ad, 0xe67e22, 0x7f8c8d, 0x16a085, 0xb33771];

export interface StreetConfig {
  roads: Road[];
  bounds: AABB2;
  rng: Rng;
  /** Sidewalk furniture, chosen in rotation with some randomness. */
  furniture: { kind: PropKind; every: number }[];
  parkedEvery: number;
  parkedChance: number;
  taxiChance: number;
}

/** Lamp posts, hydrants, benches, trees along sidewalks, and empty cars parked at the curb. */
export function placeStreetLife(cfg: StreetConfig) {
  const props: PropSpawn[] = [];
  const parked: ParkedSpawn[] = [];
  const ok = (x: number, z: number) => inAABB(x, z, cfg.bounds, -3) && waterDepth(x, z) === 0 && !bridgeAt(x, z);

  for (const road of cfg.roads) {
    if (road.kind === 'highway' || road.kind === 'dirt') continue;
    const hw = road.width / 2;
    for (const [a, b] of roadSegments(road)) {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      const heading = Math.atan2(ux, uz);
      for (const side of [-1, 1]) {
        const px = -uz * side, pz = ux * side;
        // Sidewalk furniture
        for (const f of cfg.furniture) {
          for (let s = rand(cfg.rng, 2, f.every); s < len - 2; s += f.every * rand(cfg.rng, 0.8, 1.2)) {
            const off = hw + 1.6;
            const x = a[0] + ux * s + px * off, z = a[1] + uz * s + pz * off;
            if (!ok(x, z) || nearRoad(x, z, 0.6)) continue;
            props.push({ kind: f.kind, x, y: SIDEWALK_H, z, rot: heading + (side > 0 ? Math.PI : 0) });
          }
        }
        // Parked cars in the curb lane
        if (road.kind === 'avenue' && road.width > 16) continue;
        for (let s = rand(cfg.rng, 4, cfg.parkedEvery); s < len - 4; s += cfg.parkedEvery * rand(cfg.rng, 0.8, 1.3)) {
          if (cfg.rng() > cfg.parkedChance) continue;
          const off = hw - 1.4;
          const x = a[0] + ux * s + px * off, z = a[1] + uz * s + pz * off;
          // Skip intersections: there would be another road just beyond this one's curb.
          const bx = a[0] + ux * s + px * (hw + 5), bz = a[1] + uz * s + pz * (hw + 5);
          const cx = a[0] + ux * s - px * (hw + 5), cz = a[1] + uz * s - pz * (hw + 5);
          if (!ok(x, z) || nearRoad(bx, bz, 0) || nearRoad(cx, cz, 0)) continue;
          const taxi = cfg.rng() < cfg.taxiChance;
          parked.push({
            style: taxi ? 'taxi' : cfg.rng() < 0.15 ? 'van' : 'sedan',
            color: pick(cfg.rng, CAR_COLORS),
            x, z,
            heading: side > 0 ? heading : heading + Math.PI,
          });
        }
      }
    }
  }
  return { props, parked };
}

/** Scatter trees over a park, keeping off roads. */
export function parkTrees(area: AABB2, count: number, rng: Rng, avoid: (x: number, z: number) => boolean = () => false): PropSpawn[] {
  const out: PropSpawn[] = [];
  for (let i = 0; i < count * 3 && out.length < count; i++) {
    const x = rand(rng, area.x0 + 4, area.x1 - 4), z = rand(rng, area.z0 + 4, area.z1 - 4);
    if (nearRoad(x, z, 2) || avoid(x, z)) continue;
    if (out.some((t) => Math.hypot(t.x - x, t.z - z) < 7)) continue;
    out.push({ kind: 'tree', x, y: 0, z, rot: rng() * 6.28 });
  }
  return out;
}
