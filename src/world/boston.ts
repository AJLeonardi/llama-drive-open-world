// Boston-ish: brownstone rows, crooked streets, the river with bridges, a gold-dome
// state house by the Common, a famous-style neon sign, two tall towers, harbor piers.
import { Physics, RAPIER } from '../physics/Physics';
import { Rect, mulberry32, pick, rand } from '../util/math';
import { BOSTON, BOSTON_COMMON, CITY_ROADS, HARBOR_X, Road, bostonX } from './layout';
import { StaticBatch } from './batch';
import { Building, addBuilding, placeBuildings } from './buildings';
import { block, columns, dome, huntingtonTower, neonSign, prudentialTower } from './landmarks';
import { parkTrees, placeStreetLife } from './streetLife';
import { stuntKeepOut } from './cityStunts';
import { tntPyramid } from './propModels';
import { box } from '../vehicles/builders/geo';
import type { PropSpawn } from './propModels';
import { inAABB } from '../util/math';

const aabbRect = (b: { x0: number; z0: number; x1: number; z1: number }): Rect => ({
  cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2, hw: (b.x1 - b.x0) / 2, hd: (b.z1 - b.z0) / 2, rot: 0,
});

export function buildBoston(batch: StaticBatch, physics: Physics) {
  const rng = mulberry32(1630);
  const roads: Road[] = CITY_ROADS.filter((r) => r.pts.every(([x, z]) => x <= BOSTON.x1 + 1 && z >= BOSTON.z0 - 1 && z <= BOSTON.z1 + 1));
  const keepOut: Rect[] = [aabbRect(BOSTON_COMMON), ...stuntKeepOut()];

  // --- Landmarks
  // State house: brick with white columns and a gold dome, facing the Common.
  keepOut.push(block(batch, physics, bostonX(-1760), 178, 40, 22, 0, 14, 'brick', 0xffe0d0));
  dome(batch, bostonX(-1760), 14, 178, 8, 0xe8b923);
  columns(batch, bostonX(-1772), bostonX(-1748), 165.5, 0, 12, 6);
  // Tall towers
  keepOut.push(prudentialTower(batch, physics, bostonX(-1640), -60));
  keepOut.push(huntingtonTower(batch, physics, bostonX(-1585), -95));
  keepOut.push(block(batch, physics, bostonX(-1612), 50, 22, 40, 0, 120, 'glass', 0xd8e8ff, 0.5));
  // Building with the big neon sign on top
  keepOut.push(block(batch, physics, bostonX(-1610), -150, 30, 26, 0, 22, 'brick', 0xf0d8c8));
  neonSign(batch, bostonX(-1610), 22, -150, Math.PI / 2);

  // Harbor piers you can drive off into the water.
  for (const z of [-120, 140, 300]) {
    const x0 = HARBOR_X + 14, x1 = HARBOR_X - 100;
    const cx = (x0 + x1) / 2, len = x0 - x1;
    batch.add('plain', box({ at: [cx, -0.3, z], size: [len, 0.6, 10], seg: 100, color: 0x8a6a48 }));
    for (let x = x1 + 4; x < x0; x += 12)
      for (const dz of [-4.5, 4.5]) batch.add('plain', box({ at: [x, -1.6, z + dz], size: [0.6, 2.6, 0.6], color: 0x5c4630 }));
    const col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2, 0.3, 5).setTranslation(cx, -0.3, z));
    physics.setOwner(col, { kind: 'ground', material: 'wood' });
    keepOut.push({ cx, cz: z, hw: len / 2, hd: 5, rot: 0 });
  }

  // --- Buildings
  const downtown = (x: number, z: number) => x > bostonX(-1780) && z > -240 && z < 170;
  const buildings: Building[] = placeBuildings({
    roads, bounds: BOSTON, keepOut, rng,
    frontage: [9, 18], depth: [12, 22], setback: 4, gap: [0.5, 3],
    style: (x, z, r) => {
      if (z < -340) return { h: rand(r, 10, 22), style: pick(r, ['brick', 'concrete'] as const), tint: 0xffffff };
      if (downtown(x, z) && r() < 0.35)
        return { h: rand(r, 28, 75), style: pick(r, ['glass', 'concrete'] as const), tint: pick(r, [0xffffff, 0xe0ecff, 0xf2efe8]) };
      if (r() < 0.65) return { h: rand(r, 10, 17), style: 'brownstone', tint: pick(r, [0xffffff, 0xf0dcd0, 0xe8d2c4, 0xffe8dc]) };
      return { h: rand(r, 12, 22), style: 'brick', tint: pick(r, [0xffffff, 0xf4d6c6, 0xe8c8b8]) };
    },
  });
  for (const b of buildings) addBuilding(batch, physics, b);

  // --- Street life
  const life = placeStreetLife({
    roads, bounds: BOSTON, rng,
    furniture: [{ kind: 'pole', every: 48 }, { kind: 'tree', every: 36 }, { kind: 'hydrant', every: 160 }, { kind: 'mailbox', every: 260 }, { kind: 'bench', every: 200 }],
    parkedEvery: 14, parkedChance: 0.22, taxiChance: 0.05,
  });
  const props: PropSpawn[] = [
    ...life.props.filter((p) => !buildings.some((b) => Math.hypot(b.rect.cx - p.x, b.rect.cz - p.z) < Math.min(b.rect.hw, b.rect.hd))),
    ...parkTrees(BOSTON_COMMON, 40, rng),
  ];
  // Benches in the Common
  for (let i = 0; i < 8; i++) props.push({ kind: 'bench', x: rand(rng, bostonX(-1810), bostonX(-1710)), y: 0, z: rand(rng, 45, 140), rot: rand(rng, 0, 6.28) });
  // Exploding barrels on the Common.
  tntPyramid(props, bostonX(-1790), 120, 4, 0.4);
  // Street furniture and parked cars stay clear of the stunt buildings.
  const clear = (x: number, z: number) => !stuntKeepOut().some((r) => Math.abs(x - r.cx) < r.hw && Math.abs(z - r.cz) < r.hd);
  return { props: props.filter((p) => inAABB(p.x, p.z, BOSTON) && clear(p.x, p.z)), parked: life.parked.filter((p) => clear(p.x, p.z)) };
}
