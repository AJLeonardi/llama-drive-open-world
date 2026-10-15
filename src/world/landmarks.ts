import * as THREE from 'three';
import { Physics } from '../physics/Physics';
import { Rect } from '../util/math';
import { StaticBatch } from './batch';
import { addBoxCollider, buildingGeometry } from './buildings';
import { box, cyl, paint } from '../vehicles/builders/geo';
import type { WindowStyle } from '../util/textures';

/** A plain box building at an exact spot (for landmarks). Returns its footprint. */
export function block(batch: StaticBatch, physics: Physics, cx: number, cz: number, w: number, d: number, y: number, h: number, style: WindowStyle, tint = 0xffffff, rot = 0): Rect {
  const rect: Rect = { cx, cz, hw: w / 2, hd: d / 2, rot };
  batch.add(`win-${style}`, buildingGeometry(rect, y, h, tint, undefined, undefined, y < 1));
  batch.add('plain', buildingGeometry({ ...rect, hw: rect.hw + 0.3, hd: rect.hd + 0.3 }, y + h - 0.2, 0.6, 0xd9d2c4, 100, 100, false));
  addBoxCollider(physics, rect, y, h, style);
  return rect;
}

export function dome(batch: StaticBatch, x: number, y: number, z: number, r: number, color: number) {
  const g = new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  g.translate(x, y, z);
  batch.add('plain', paint(g, color));
  batch.add('plain', cyl({ at: [x, y + r + 1.2, z], radius: 0.6, radiusTop: 0.2, length: 2.4, axis: 'y', segments: 8, color }));
}

export function columns(batch: StaticBatch, x0: number, x1: number, z: number, y: number, h: number, n: number) {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    batch.add('plain', cyl({ at: [x, y + h / 2, z], radius: 0.6, length: h, axis: 'y', segments: 8, color: 0xf2efe6 }));
  }
  batch.add('plain', box({ at: [(x0 + x1) / 2, y + h + 0.6, z], size: [Math.abs(x1 - x0) + 3, 1.2, 3], color: 0xf2efe6 }));
}

/** Glowing roof sign (homage to Boston's famous one): square panel with a big red triangle. */
export function neonSign(batch: StaticBatch, x: number, y: number, z: number, rot: number) {
  const s = 16;
  const g = new THREE.PlaneGeometry(s, s, 16, 16);
  const pos = g.attributes.position;
  const col: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i) / s + 0.5, py = pos.getY(i) / s + 0.5;
    const inTri = py > 0.18 && py < 0.82 && Math.abs(px - 0.5) < (0.82 - py) * 0.6;
    const c = inTri ? [1, 0.12, 0.1] : py < 0.12 || py > 0.92 ? [0.15, 0.2, 0.7] : [0.95, 0.97, 1];
    col.push(...c);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const back = g.clone();
  back.rotateY(Math.PI);
  for (const gg of [g, back]) {
    gg.rotateY(rot);
    gg.translate(x, y + s / 2 + 2, z);
    batch.add('glow', gg);
  }
  batch.add('plain', box({ at: [x, y + 1, z], size: [s * 0.8, 2, 0.6], rot: [0, rot, 0], color: 0x444444 }));
}

/** Classic NYC rooftop water tower. */
export function waterTower(batch: StaticBatch, x: number, y: number, z: number) {
  batch.add('plain', cyl({ at: [x, y + 3.6, z], radius: 1.8, length: 3.2, axis: 'y', segments: 10, color: 0x8a6440 }));
  const cone = new THREE.ConeGeometry(2.0, 1.4, 10);
  cone.translate(x, y + 5.9, z);
  batch.add('plain', paint(cone, 0x5a4a3a));
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]])
    batch.add('plain', box({ at: [x + dx * 1.1, y + 1, z + dz * 1.1], size: [0.2, 2, 0.2], color: 0x3a3a3a }));
}

/** Text sign texture (green highway style or custom colors). */
export function textPanel(lines: string[], bg = '#0f6b3a', fg = '#ffffff', w = 512, h = 256) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 8;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const size = Math.min(90, (h - 40) / lines.length);
  g.font = `bold ${size}px -apple-system, Helvetica, Arial, sans-serif`;
  lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.1, w - 40));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A sign readable from both sides (two one-sided planes, so the back isn't mirrored). */
export function twoSidedSign(tex: THREE.Texture, w: number, h: number) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  back.rotation.y = Math.PI;
  g.add(front, back);
  return g;
}

/** Flat slab (ledges, caps) — a short box with its own roof. */
function slab(batch: StaticBatch, cx: number, cz: number, w: number, d: number, y: number, h: number, color: number) {
  batch.add('plain', buildingGeometry({ cx, cz, hw: w / 2, hd: d / 2, rot: 0 }, y, h, color, 100, 100, false, color));
}

/**
 * Boston's Prudential Tower, from the skyline: a tall dark slab with a dense grid of
 * small pale windows and faint service bands, topped by a pale overhanging glass
 * observation crown with a thin roof cap, and a tall red-and-white antenna mast.
 */
export function prudentialTower(batch: StaticBatch, physics: Physics, cx: number, cz: number): Rect {
  const W = 46, D = 34, top = 178;
  const footprint: Rect = { cx, cz, hw: W / 2 + 4, hd: D / 2 + 4, rot: 0 };
  // Low podium (shopping centre) around the base
  block(batch, physics, cx, cz, W + 8, D + 8, 0, 7, 'stone', 0xe9e1d0);
  // The shaft
  batch.add('win-pru', buildingGeometry({ cx, cz, hw: W / 2, hd: D / 2, rot: 0 }, 0, top, 0xffffff, 16, 14, false, null));
  addBoxCollider(physics, { cx, cz, hw: W / 2, hd: D / 2, rot: 0 }, 0, top + 14, 'pru');
  // Faint mechanical bands
  for (const y of [52, 104, 150]) slab(batch, cx, cz, W + 0.25, D + 0.25, y, 2.2, 0x2a2928);
  // Observation crown: pale frame, glass all round, overhanging the shaft
  const crownH = 11;
  slab(batch, cx, cz, W + 2.6, D + 2.6, top, 1.2, 0xe4e2dc);
  batch.add('win-glass', buildingGeometry({ cx, cz, hw: W / 2 + 1.0, hd: D / 2 + 1.0, rot: 0 }, top + 1.2, crownH - 1.2, 0x7d93a6, 4, 3.5, false, null));
  // Pale mullions + corner posts around the observation glass
  for (let x = -W / 2; x <= W / 2; x += 4)
    for (const side of [-1, 1]) slab(batch, cx + x, cz + side * (D / 2 + 1.05), 0.35, 0.2, top + 1.2, crownH - 1.2, 0xe4e2dc);
  for (let z = -D / 2; z <= D / 2; z += 4)
    for (const side of [-1, 1]) slab(batch, cx + side * (W / 2 + 1.05), cz + z, 0.2, 0.35, top + 1.2, crownH - 1.2, 0xe4e2dc);
  slab(batch, cx, cz, W + 4.2, D + 4.2, top + crownH, 1.4, 0xeeece6); // overhanging roof cap
  // Rooftop clutter
  slab(batch, cx - 8, cz + 4, 10, 8, top + crownH + 1.4, 3, 0x8d8e90);
  slab(batch, cx + 9, cz - 5, 6, 6, top + crownH + 1.4, 2, 0x8d8e90);
  // Red-and-white lattice mast, plus a couple of small antennas
  const mastH = 58, base = top + crownH + 1.4;
  // Stripe bands: duplicate rings at each colour change so the stripes stay crisp.
  const mast = cyl({ at: [cx + 4, base + mastH / 2, cz], radius: 1.1, radiusTop: 0.2, length: mastH, axis: 'y', segments: 6, heightSegments: Math.round(mastH / 2.5), color: (_x, y) => (Math.floor((y - base + 0.01) / 5) % 2 ? 0xd6322a : 0xf2f2f2) });
  batch.add('plain', mast);
  for (const y of [base + 12, base + 26, base + 38]) batch.add('plain', box({ at: [cx + 4, y, cz], size: [4.5 - (y - base) * 0.07, 0.35, 0.35], color: 0xd6322a }));
  batch.add('plain', cyl({ at: [cx - 10, base + 9, cz - 6], radius: 0.25, length: 18, axis: 'y', segments: 5, color: 0xdddddd }));
  batch.add('plain', cyl({ at: [cx - 6, base + 6, cz + 8], radius: 0.25, length: 12, axis: 'y', segments: 5, color: 0xdddddd }));
  batch.add('glow', box({ at: [cx + 4, base + mastH + 0.5, cz], size: [0.9, 0.9, 0.9], color: 0xff2020 }));
  return footprint;
}

/** 111 Huntington (the "R2-D2 building"): glass tower, stepped glass top, lattice dome crown. */
export function huntingtonTower(batch: StaticBatch, physics: Physics, cx: number, cz: number): Rect {
  const rect = block(batch, physics, cx, cz, 30, 30, 0, 96, 'glass', 0xe8f2ff);
  block(batch, physics, cx, cz, 26, 26, 96, 9, 'glass', 0xe8f2ff);
  block(batch, physics, cx, cz, 20, 20, 105, 7, 'glass', 0xe8f2ff);
  // Vertical fins on the stepped crown
  for (let i = -2; i <= 2; i++)
    for (const side of [-1, 1]) {
      batch.add('plain', box({ at: [cx + i * 5, 100, cz + side * 13.3], size: [0.5, 9, 0.6], color: 0xc8ccd0 }));
      batch.add('plain', box({ at: [cx + side * 13.3, 100, cz + i * 5], size: [0.6, 9, 0.5], color: 0xc8ccd0 }));
    }
  // Lattice dome: crossing arches
  const dome: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const t = new THREE.TorusGeometry(8, 0.3, 5, 20, Math.PI);
    t.rotateY((k * Math.PI) / 4);
    t.translate(cx, 112, cz);
    dome.push(paint(t, 0xd8dade));
  }
  const ring = new THREE.TorusGeometry(8, 0.35, 5, 28);
  ring.rotateX(Math.PI / 2);
  ring.translate(cx, 112, cz);
  dome.push(paint(ring, 0xd8dade));
  for (const g of dome) batch.add('plain', g);
  return rect;
}
