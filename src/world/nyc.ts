// NYC-ish: a street grid with avenues, a diagonal "Broadway", tall towers in midtown,
// an Empire-State-style skyscraper, a big rectangular park, water towers, bright billboards.
import * as THREE from 'three';
import { Physics } from '../physics/Physics';
import { Rect, mulberry32, pick, rand } from '../util/math';
import { CENTRAL_PARK, CITY_ROADS, NYC, Road, nycX } from './layout';
import { StaticBatch } from './batch';
import { addBuilding, placeBuildings } from './buildings';
import { block, waterTower } from './landmarks';
import { parkTrees, placeStreetLife } from './streetLife';
import { stuntKeepOut } from './cityStunts';
import { tntPyramid } from './propModels';
import { cyl } from '../vehicles/builders/geo';
import type { PropSpawn } from './propModels';
import { billboardTexture } from '../util/textures';

const aabbRect = (b: { x0: number; z0: number; x1: number; z1: number }): Rect => ({
  cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2, hw: (b.x1 - b.x0) / 2, hd: (b.z1 - b.z0) / 2, rot: 0,
});

export function buildNYC(batch: StaticBatch, physics: Physics, scene: THREE.Object3D) {
  const rng = mulberry32(1624);
  const roads: Road[] = CITY_ROADS.filter((r) => r.pts.every(([x]) => x >= NYC.x0 - 1));
  const keepOut: Rect[] = [aabbRect(CENTRAL_PARK), ...stuntKeepOut()];

  // Empire-State-style tower: stacked setbacks and a spire.
  const ex = nycX(1940), ez = 105;
  keepOut.push(block(batch, physics, ex, ez, 50, 40, 0, 25, 'stone', 0xfff4e0));
  block(batch, physics, ex, ez, 38, 30, 25, 110, 'stone', 0xfff4e0);
  block(batch, physics, ex, ez, 28, 22, 135, 95, 'stone', 0xfff4e0);
  block(batch, physics, ex, ez, 16, 13, 230, 14, 'stone', 0xfff4e0);
  block(batch, physics, ex, ez, 9, 8, 244, 10, 'stone', 0xf0e8d8);
  batch.add('plain', cyl({ at: [ex, 266, ez], radius: 1.6, radiusTop: 0.3, length: 34, axis: 'y', segments: 8, color: 0xd8d8d0 }));

  const midtown = (z: number) => z > -200 && z < 230;
  const buildings = placeBuildings({
    roads, bounds: NYC, keepOut, rng,
    frontage: [14, 30], depth: [16, 26], setback: 4, gap: [0.5, 2],
    style: (x, z, r) => {
      const nearEmpire = Math.hypot(x - ex, z - ez) < 260;
      if (midtown(z)) {
        const tall = nearEmpire ? rand(r, 60, 160) : rand(r, 40, 120);
        return { h: tall, style: pick(r, ['glass', 'concrete', 'stone', 'glass'] as const), tint: pick(r, [0xffffff, 0xe6f0ff, 0xf4f0e8]) };
      }
      return { h: rand(r, 18, 60), style: pick(r, ['brick', 'stone', 'concrete', 'brick'] as const), tint: pick(r, [0xffffff, 0xf0e0d4, 0xe4e4e4]) };
    },
  });
  for (const b of buildings) addBuilding(batch, physics, b);

  // Rooftop water towers on the shorter brick buildings.
  for (const b of buildings) if (b.style === 'brick' && b.h < 60 && rng() < 0.35) waterTower(batch, b.rect.cx, b.h, b.rect.cz);

  // Billboards around the Broadway/0-street crossing ("Times Square").
  const bbMats = [1, 2, 3, 4, 5, 6].map((s) => new THREE.MeshBasicMaterial({ map: billboardTexture(s) }));
  let bbCount = 0;
  for (const b of buildings) {
    if (Math.hypot(b.rect.cx - nycX(1890), b.rect.cz + 50) > 170 || bbCount > 26) continue;
    const { cx, cz, hw, hd, rot } = b.rect;
    for (const side of [-1, 1]) {
      const w = hw * 1.4, h = w / 2;
      const geo = new THREE.PlaneGeometry(w, h);
      if (side < 0) geo.rotateY(Math.PI);
      const m = new THREE.Mesh(geo, pick(rng, bbMats));
      const nx = Math.sin(rot) * side, nz = Math.cos(rot) * side; // local +z/-z face normal
      m.position.set(cx + nx * (hd + 0.15), Math.min(b.h - h / 2 - 1, 12 + rng() * 8), cz + nz * (hd + 0.15));
      m.rotation.y = rot;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      scene.add(m);
      bbCount++;
    }
  }

  const life = placeStreetLife({
    roads, bounds: NYC, rng,
    furniture: [{ kind: 'pole', every: 46 }, { kind: 'hydrant', every: 150 }, { kind: 'mailbox', every: 240 }, { kind: 'tree', every: 70 }],
    parkedEvery: 12, parkedChance: 0.25, taxiChance: 0.45,
  });
  const props: PropSpawn[] = [...life.props, ...parkTrees(CENTRAL_PARK, 90, rng)];
  for (let i = 0; i < 14; i++) props.push({ kind: 'bench', x: rand(rng, CENTRAL_PARK.x0 + 8, CENTRAL_PARK.x1 - 8), y: 0, z: rand(rng, CENTRAL_PARK.z0 + 8, CENTRAL_PARK.z1 - 8), rot: rand(rng, 0, 6.28) });
  // Exploding barrels in the park.
  tntPyramid(props, (CENTRAL_PARK.x0 + CENTRAL_PARK.x1) / 2, CENTRAL_PARK.z1 - 20, 4, 0);
  tntPyramid(props, CENTRAL_PARK.x0 + 40, (CENTRAL_PARK.z0 + CENTRAL_PARK.z1) / 2, 3, Math.PI / 2);
  const clear = (x: number, z: number) => !stuntKeepOut().some((r) => Math.abs(x - r.cx) < r.hw && Math.abs(z - r.cz) < r.hd);
  return { props: props.filter((p) => clear(p.x, p.z)), parked: life.parked.filter((p) => clear(p.x, p.z)) };
}
