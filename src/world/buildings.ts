import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { AABB2, Rect, Rng, inAABB, rand, rectCorners, rectsOverlap } from '../util/math';
import { Road, nearRoad, roadSegments, waterDepth } from './layout';
import { StaticBatch } from './batch';
import type { WindowStyle } from '../util/textures';

export interface Building {
  rect: Rect;
  h: number;
  style: WindowStyle;
  tint: number;
  /** y of the ground under it */
  y: number;
}

const U_REPEAT = 16; // metres per texture repeat horizontally (4 windows)
const V_REPEAT = 14; // metres per texture repeat vertically (4 floors)

/**
 * A box building with world-scaled window UVs and a plain roof. Walls get a soft
 * ambient-occlusion darkening near the ground.
 */
export function buildingGeometry(rect: Rect, y0: number, h: number, tint: number, uRepeat = U_REPEAT, vRepeat = V_REPEAT, ao = true, roof: number | null = 0x6a6c6f) {
  const c = rectCorners(rect);
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const t = new THREE.Color(tint);
  const y1 = y0 + h;
  const shade = (y: number) => (ao ? 0.62 + 0.38 * Math.min(1, Math.max(0, (y - y0) / 9)) : 1);
  let u0 = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = c[i], [bx, bz] = c[(i + 1) % 4];
    const len = Math.hypot(bx - ax, bz - az);
    const u1 = u0 + len / uRepeat;
    const v1 = h / vRepeat;
    // (a,bottom) (b,top) (b,bottom) / (a,bottom) (a,top) (b,top) — outward facing
    pos.push(ax, y0, az, bx, y1, bz, bx, y0, bz, ax, y0, az, ax, y1, az, bx, y1, bz);
    uv.push(u0, 0, u1, v1, u1, 0, u0, 0, u0, v1, u1, v1);
    for (const y of [y0, y1, y0, y0, y1, y1]) {
      const k = shade(y);
      col.push(t.r * k, t.g * k, t.b * k);
    }
    u0 = Math.round(u1); // keep windows aligned around corners
  }
  if (roof !== null) {
    // Roof: solid colour, sampled from a plain corner of the facade texture.
    const rc = new THREE.Color(roof);
    pos.push(c[0][0], y1, c[0][1], c[2][0], y1, c[2][1], c[1][0], y1, c[1][1]);
    pos.push(c[0][0], y1, c[0][1], c[3][0], y1, c[3][1], c[2][0], y1, c[2][1]);
    for (let k = 0; k < 6; k++) {
      uv.push(0.005, 0.995);
      col.push(rc.r, rc.g, rc.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const grow = (r: Rect, d: number): Rect => ({ ...r, hw: r.hw + d, hd: r.hd + d });

/** Cornice, shopfronts and rooftop clutter that make plain boxes read as buildings. */
function buildingDetails(batch: StaticBatch, b: Building) {
  const top = b.y + b.h;
  const corniceColor = b.style === 'glass' ? 0x8a96a3 : b.style === 'brownstone' || b.style === 'brick' ? 0xd9cfbf : 0xa9a49a;
  // Parapet/cornice ring around a dark roof.
  batch.add('plain', buildingGeometry(grow(b.rect, 0.35), top - 0.25, 0.7, corniceColor, 100, 100, false, null));
  batch.add('plain', buildingGeometry(grow(b.rect, 0.3), top - 0.3, 0.5, 0x5d6064, 100, 100, false, 0x5d6064));
  if (b.style !== 'glass' && b.h > 9) {
    batch.add('store', buildingGeometry(grow(b.rect, 0.12), b.y - 0.4, 4.6, 0xffffff, 8, 4.6, false, null));
    batch.add('plain', buildingGeometry(grow(b.rect, 0.3), b.y + 4.2, 0.35, corniceColor, 100, 100, false, null));
  }
  if (b.h > 18) {
    const r = b.rect;
    const n = 1 + Math.floor((r.hw * r.hd) / 120) % 3;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * Math.min(4, r.hw * 0.6);
      const unit: Rect = { cx: r.cx + Math.cos(r.rot) * off, cz: r.cz - Math.sin(r.rot) * off, hw: 1.3, hd: 1.0, rot: r.rot };
      batch.add('plain', buildingGeometry(unit, top + 0.45, 1.4, 0x9ea3a8, 100, 100, false));
    }
  }
}

export function addBuilding(batch: StaticBatch, physics: Physics, b: Building) {
  batch.add(`win-${b.style}`, buildingGeometry(b.rect, b.y - 0.5, b.h + 0.5, b.tint, U_REPEAT, V_REPEAT, true, null));
  buildingDetails(batch, b);
  addBoxCollider(physics, b.rect, b.y, b.h, b.style);
}

/** What a building collider is made of (used by building damage effects). */
export interface BuildingInfo {
  style: WindowStyle;
}

export function addBoxCollider(physics: Physics, rect: Rect, y: number, h: number, style: WindowStyle = 'concrete') {
  const col = physics.world.createCollider(
    RAPIER.ColliderDesc.cuboid(rect.hw, h / 2, rect.hd)
      .setTranslation(rect.cx, y + h / 2, rect.cz)
      .setRotation({ x: 0, y: Math.sin(rect.rot / 2), z: 0, w: Math.cos(rect.rot / 2) })
      .setFriction(0.6),
  );
  const info: BuildingInfo = { style };
  physics.setOwner(col, { kind: 'building', material: style === 'glass' ? 'glass' : 'concrete', ref: info });
  return col;
}

export interface PlacementConfig {
  roads: Road[];
  bounds: AABB2;
  /** Areas where no buildings go (parks, landmarks…). */
  keepOut: Rect[];
  rng: Rng;
  frontage: [number, number];
  depth: [number, number];
  setback: number;
  gap: [number, number];
  /** Decide height/style for a building at this spot (return null to skip). */
  style: (x: number, z: number, rng: Rng) => { h: number; style: WindowStyle; tint: number } | null;
}

/** Line both sides of every road with buildings, skipping anything that would overlap. */
export function placeBuildings(cfg: PlacementConfig, existing: Building[] = []): Building[] {
  const out: Building[] = [];
  const placed: Rect[] = [...cfg.keepOut, ...existing.map((b) => b.rect)];
  const grid = new Map<string, Rect[]>();
  const cell = 60;
  const gkey = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const addToGrid = (r: Rect) => {
    const ext = Math.hypot(r.hw, r.hd);
    for (let x = r.cx - ext; x <= r.cx + ext + cell; x += cell)
      for (let z = r.cz - ext; z <= r.cz + ext + cell; z += cell) {
        const k = gkey(x, z);
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(r);
      }
  };
  placed.forEach(addToGrid);

  const fits = (r: Rect) => {
    const corners = rectCorners(r);
    for (const [x, z] of corners) if (!inAABB(x, z, cfg.bounds, -4)) return false;
    // Sample the footprint for roads and water.
    const c = Math.cos(r.rot), s = Math.sin(r.rot);
    for (let a = -1; a <= 1; a += 0.25)
      for (let b = -1; b <= 1; b += 0.5) {
        const lx = a * r.hw, lz = b * r.hd;
        const x = r.cx + lx * c + lz * s, z = r.cz - lx * s + lz * c;
        if (nearRoad(x, z, 2.5) || waterDepth(x, z) > 0) return false;
      }
    const near = grid.get(gkey(r.cx, r.cz)) ?? [];
    for (const o of near) if (rectsOverlap(r, o, 1)) return false;
    return true;
  };

  for (const road of cfg.roads) {
    for (const [a, b] of roadSegments(road)) {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      const rot = Math.atan2(ux, uz) - Math.PI / 2; // rect's local x runs along the road
      for (const side of [-1, 1]) {
        let s = rand(cfg.rng, 0, 6);
        while (s < len) {
          const w = rand(cfg.rng, ...cfg.frontage);
          const d = rand(cfg.rng, ...cfg.depth);
          const along = s + w / 2;
          const off = road.width / 2 + cfg.setback + d / 2;
          const px = -uz * side, pz = ux * side;
          const cx = a[0] + ux * along + px * off, cz = a[1] + uz * along + pz * off;
          const rect: Rect = { cx, cz, hw: w / 2, hd: d / 2, rot };
          s += w + rand(cfg.rng, ...cfg.gap);
          if (!fits(rect)) continue;
          const st = cfg.style(cx, cz, cfg.rng);
          if (!st) continue;
          placed.push(rect);
          addToGrid(rect);
          out.push({ rect, y: 0, ...st });
        }
      }
    }
  }
  return out;
}
