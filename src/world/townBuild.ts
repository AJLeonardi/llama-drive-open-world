// The towns, built (where they sit and their roads are in outer.ts:TOWNS). This file
// has Mariano-ville; Alexander-ville and Washington DC have their own files.
//
// Mariano-ville: a little New England town centre in the autumn woods. Main Street runs
// in front of the town green, with a row of clapboard shops on one side; across it is
// the green with its gazebo, paths and maples, with a street down each side and Church
// Street across the top, where the white church with its tall steeple stands. The town
// hall and the general store are on the corners, houses line the side streets, and
// carved welcome signs stand where the road comes into town.
import * as THREE from 'three';
import { CHURCH_ST, MAIN_ST, MARIANO_GREEN, TOWNS, TOWN_HW } from './outer';
import { buildingGeometry } from './buildings';
import { box, paint } from '../vehicles/builders/geo';
import { textPanel, twoSidedSign } from './landmarks';
import { mulberry32 } from '../util/math';
import { sidewalkTexture } from '../util/textures';
import { SIDINGS, Siding, TownItem, TownKit, sidingTexture, welcomeTexture } from './townKit';
import { buildAlexander } from './alexanderBuild';
import { buildDC } from './dcBuild';
import type { TreeKind } from './trees';

export type { TownItem } from './townKit';

let built: { items: TownItem[]; trees: [number, number, TreeKind][]; materials: Record<string, THREE.Material> } | null = null;

/** Build every town once (at load time, so nothing stutters mid-drive). */
function build() {
  if (built) return built;
  const items: TownItem[] = [], trees: [number, number, TreeKind][] = [];
  const materials: Record<string, THREE.Material> = {};
  for (const t of TOWNS) {
    const kit = new TownKit(t);
    if (t.kind === 'mariano') buildMariano(kit);
    else if (t.kind === 'alexander') buildAlexander(kit);
    else buildDC(kit);
    kit.finish();
    items.push(...kit.items);
    trees.push(...kit.trees);
    Object.assign(materials, kit.materials);
  }
  return (built = { items, trees, materials });
}

/** Extra materials the towns need (merged into the world's materials). */
export function townMaterials(): Record<string, THREE.Material> {
  const out: Record<string, THREE.Material> = {};
  for (const [k, v] of Object.entries(SIDINGS)) {
    out[`siding-${k}`] = new THREE.MeshStandardMaterial({ map: sidingTexture(v), roughness: 0.8, metalness: 0 });
    out[`siding-${k}`].userData.castShadow = true;
  }
  const lawn = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/grass_color.webp`);
  lawn.wrapS = lawn.wrapT = THREE.RepeatWrapping;
  lawn.colorSpace = THREE.SRGBColorSpace;
  lawn.anisotropy = 4;
  out['town-lawn'] = new THREE.MeshLambertMaterial({ map: lawn, color: 0xd8e4c4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  out['town-walk'] = new THREE.MeshLambertMaterial({ map: sidewalkTexture(), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  out['town-water'] = new THREE.MeshStandardMaterial({ color: 0x3f7fa6, metalness: 0.2, roughness: 0.05, envMapIntensity: 1.3, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  Object.assign(out, build().materials);
  return out;
}

/** The pieces of every town standing where `where` says (callers get copies of the geometry). */
export function townItems(where: (x: number, z: number) => boolean = () => true): TownItem[] {
  return build().items.filter((it) => where(it.x, it.z)).map((it) => ({ ...it, geos: it.geos.map(([k, g]) => [k, g.clone()] as [string, THREE.BufferGeometry]) }));
}

/** The towns' own trees: maples round the green, shade trees along the streets… */
export function townTreeSpots(): readonly [number, number, TreeKind][] {
  return build().trees;
}

// ---------------------------------------------------------------- Mariano-ville

function buildMariano(k: TownKit) {
  const Y = k.Y;
  const rng = mulberry32(1789);
  const { a: GA, b0: G0, b1: G1 } = MARIANO_GREEN;
  const MAIN_HALF = 230;

  // ------------------------------------------------ sidewalks, junctions and lamps
  k.sidewalks((a, b) => Math.abs(a) < GA + 2 && b > G0 - 2 && b < G1 + 2);
  k.junctions(false);
  k.lamps(-MAIN_HALF, MAIN_ST, MAIN_HALF, MAIN_ST, TOWN_HW + 2.4, 35);

  // ------------------------------------------------ shops along the highway side of Main Street
  const shopColors: Siding[] = ['white', 'red', 'mustard', 'blue', 'sage', 'cream', 'white', 'grey', 'red', 'cream', 'blue', 'white'];
  const front = MAIN_ST - TOWN_HW - 4.8;
  [-205, -170, -135, -100, -65, -30, 30, 65, 100, 135, 170, 205].forEach((a, i) => {
    const w = 22 + rng() * 6, d = 16, b = front - d / 2;
    const it = k.item(a, b);
    const h = 3.6 + 3.4 * (rng() < 0.7 ? 1 : 2);
    // Storefront on the ground floor (facing Main Street), clapboard above.
    const [x, z] = k.W(a, b);
    it.geos.push(['store', buildingGeometry({ cx: x, cz: z, hw: w / 2 + 0.05, hd: d / 2 + 0.05, rot: k.rotA }, Y - 0.2, 3.8, 0xffffff, 8, 4.6, false, null)]);
    k.walls(it, a, b, Y + 3.6, w, d, h - 3.6, shopColors[i]);
    k.solid(it, a, b, Y, w, 3.6, d);
    k.box(it, a, b, Y + 3.5, w + 0.6, 0.3, d + 0.6, 0xf2efe6);
    k.gable(it, a, b, Y + h, w, d, 4 + rng() * 1.5, false, rng() < 0.5 ? 0x3f4349 : 0x5b4033);
    // Striped awning over the shop window.
    const awning = [0x2f6b45, 0x9e2f2a, 0x284b74, 0x7a5a2e][i % 4];
    k.box(it, a, front + 1.1, Y + 3.1, w * 0.8, 0.12, 2.2, awning);
    // A chimney.
    k.box(it, a + w * 0.3, b - 2, Y + h + 1, 1.2, 4, 1.2, 0x8a3b2b);
  });

  // ------------------------------------------------ the town green
  const green = k.item(0, (G0 + G1) / 2);
  k.flat('town-lawn', -GA, GA, G0, G1, Y + 0.06, 6, 120);
  // Paths: across, along, and corner to corner.
  const gc = (G0 + G1) / 2;
  k.strip(green, 'town-walk', -GA, gc, GA, gc, 3.4, Y + 0.09, 4);
  k.strip(green, 'town-walk', 0, G0, 0, G1, 3.4, Y + 0.09, 4);
  k.strip(green, 'town-walk', -GA + 4, G0 + 4, GA - 4, G1 - 4, 3.4, Y + 0.09, 4);
  k.strip(green, 'town-walk', -GA + 4, G1 - 4, GA - 4, G0 + 4, 3.4, Y + 0.09, 4);
  // White picket fence round it (gaps where the paths come out).
  const fence = (a0: number, b0: number, a1: number, b1: number) => {
    const len = Math.hypot(a1 - a0, b1 - b0), n = Math.round(len / 2.4);
    const it = k.item((a0 + a1) / 2, (b0 + b1) / 2);
    const alongA = Math.abs(a1 - a0) > Math.abs(b1 - b0);
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n, b = b0 + ((b1 - b0) * i) / n;
      if (Math.abs(a) < 4 || Math.abs(b - gc) < 4) continue;
      k.box(it, a, b, Y, 0.14, 1.05, 0.14, 0xffffff);
      if (i < n) {
        // The pickets between posts, as one panel (it reads as pickets from the road).
        const ma = a + (a1 - a0) / n / 2, mb = b + (b1 - b0) / n / 2;
        k.box(it, ma, mb, Y + 0.1, alongA ? 2.3 : 0.06, 0.85, alongA ? 0.06 : 2.3, 0xf6f6f2);
        k.box(it, ma, mb, Y + 0.75, alongA ? 2.4 : 0.1, 0.08, alongA ? 0.1 : 2.4, 0xffffff);
      }
    }
  };
  fence(-GA, G0, GA, G0);
  fence(-GA, G1, GA, G1);
  fence(-GA, G0, -GA, G1);
  fence(GA, G0, GA, G1);
  // The gazebo (bandstand) in the middle: an eight-sided platform, posts and a pointed roof.
  {
    const it = k.item(0, gc);
    k.cyl(it, 0, gc, Y, 5, 0.9, 0xece9e1, 8);
    for (let j = 0; j < 8; j++) {
      const ang = (j / 8) * Math.PI * 2 + Math.PI / 8;
      const [pa, pb] = [Math.cos(ang) * 4.5, gc + Math.sin(ang) * 4.5];
      k.cyl(it, pa, pb, Y + 0.9, 0.16, 3.2, 0xffffff, 6);
      // Railing between posts.
      const ang2 = ang + Math.PI / 4;
      const [qa, qb] = [Math.cos(ang2) * 4.5, gc + Math.sin(ang2) * 4.5];
      if (j !== 2) {
        const ma = (pa + qa) / 2, mb = (pb + qb) / 2;
        const [x, z] = k.W(ma, mb), [x0, z0] = k.W(pa, pb), [x1, z1] = k.W(qa, qb);
        it.geos.push(['plain', box({ at: [x, Y + 1.8, z], size: [Math.hypot(x1 - x0, z1 - z0), 0.12, 0.12], rot: [0, Math.atan2(-(z1 - z0), x1 - x0), 0], color: 0xffffff, seg: 100 })]);
      }
    }
    k.cyl(it, 0, gc, Y + 4.1, 6, 0.25, 0xffffff, 8);
    k.cyl(it, 0, gc, Y + 4.35, 6, 2.6, 0x7b3a2c, 8, 0.2);
    k.cyl(it, 0, gc, Y + 6.9, 0.08, 1.2, 0xd4a443, 6);
    k.solid(it, 0, gc, Y, 9.5, 5, 9.5);
  }
  // A flagpole by the gazebo, flying a flag.
  {
    const it = k.item(-14, gc + 14);
    k.cyl(it, -14, gc + 14, Y, 0.12, 11, 0xdddddd, 8, 0.06);
    for (let j = 0; j < 7; j++) k.box(it, -14 + 1.3, gc + 14, Y + 10.2 - j * 0.2, 2.4, 0.2, 0.04, j % 2 ? 0xffffff : 0xb3262e);
    k.box(it, -14 + 0.55, gc + 14, Y + 9.7, 1, 0.7, 0.05, 0x223a6e);
    k.solid(it, -14, gc + 14, Y, 0.3, 11, 0.3);
  }
  // Benches along the paths.
  for (const [a, b] of [[-40, gc - 4], [40, gc + 4], [-4, G0 + 25], [4, G1 - 25]]) {
    const it = k.item(a, b);
    k.box(it, a, b, Y + 0.45, 1.8, 0.08, 0.5, 0x3b5a3a);
    k.box(it, a, b + 0.25, Y + 0.6, 1.8, 0.5, 0.06, 0x3b5a3a);
    for (const s of [-0.75, 0.75]) k.box(it, a + s, b, Y, 0.08, 0.45, 0.45, 0x1d1d1d);
  }

  // ------------------------------------------------ the church on Church Street, facing down the green
  {
    const cb = CHURCH_ST + 32, it = k.item(0, cb);
    const len = 28, wid = 15, h = 9;
    k.walls(it, 0, cb + 2, Y, wid, len, h, 'white');
    k.box(it, 0, cb + 2, Y - 0.3, wid + 1, 0.6, len + 1, 0xb8b4aa);
    k.gable(it, 0, cb + 2, Y + h, wid, len, 6.5, false, 0x40454c);
    // Portico: columns and a pediment facing the green.
    const pb = cb + 2 - len / 2 - 3.2;
    for (const a of [-5.2, -1.8, 1.8, 5.2]) k.cyl(it, a, pb - 2, Y, 0.38, 7.5, 0xffffff, 10, 0.38, true);
    k.box(it, 0, pb, Y + 7.5, 12.5, 0.8, 6.4, 0xffffff);
    k.gable(it, 0, pb, Y + 8.3, 12.5, 6.4, 2.4, false, 0xf4f2ec);
    k.box(it, 0, pb, Y - 0.3, 13, 0.6, 7, 0xd8d4ca);
    k.box(it, 0, cb + 2 - len / 2 - 0.05, Y, 2.2, 3.8, 0.2, 0x5a2e22); // the door
    // Steeple: square tower, the belfry with its openings, then the spire.
    const tb = cb + 2 - len / 2 + 2.6;
    k.walls(it, 0, tb, Y + h, 5.4, 5.4, 8, 'white');
    k.box(it, 0, tb, Y + h + 8, 6, 0.5, 6, 0xffffff);
    k.box(it, 0, tb, Y + h + 8.5, 4.6, 4.2, 4.6, 0xffffff, true);
    for (const [da, db] of [[0, -2.32], [0, 2.32], [-2.32, 0], [2.32, 0]]) k.box(it, da, tb + db, Y + h + 9.2, da ? 0.1 : 1.8, 2.8, da ? 1.8 : 0.1, 0x22262b);
    k.box(it, 0, tb, Y + h + 12.7, 5.2, 0.5, 5.2, 0xffffff);
    k.cyl(it, 0, tb, Y + h + 13.2, 2.3, 15, 0xffffff, 8, 0.08);
    k.cyl(it, 0, tb, Y + h + 28.2, 0.06, 1.6, 0xd4a443, 6);
    k.solid(it, 0, tb, Y + h + 13, 3, 15, 3);
    // Clock face on the tower, facing the green.
    const clock = new THREE.Mesh(new THREE.CircleGeometry(1.4, 28), new THREE.MeshBasicMaterial({ map: textPanel([''], '#f6f3ea', '#1b1b1b', 128, 128) }));
    const [cx, cz] = k.W(0, tb - 2.75);
    clock.position.set(cx, Y + h + 4.6, cz);
    k.look(clock, 0, tb - 20);
    const hands = new THREE.Group();
    for (const [len2, ang] of [[1.0, 0.3], [0.7, -1.9]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.1, len2).translate(0, len2 / 2, 0.02), new THREE.MeshBasicMaterial({ color: 0x1b1b1b }));
      m.rotation.z = ang;
      hands.add(m);
    }
    clock.add(hands);
    it.objects.push(clock);
  }

  // ------------------------------------------------ town hall and general store on the corners
  {
    const a = -GA - 52, b = G0 + 12, it = k.item(a, b);
    k.walls(it, a, b, Y, 24, 16, 7.4, 'red');
    k.box(it, a, b, Y + 7.3, 24.6, 0.4, 16.6, 0xffffff);
    k.gable(it, a, b, Y + 7.7, 24, 16, 4.2, true, 0x3c4046);
    k.box(it, a, b, Y + 11.4, 3.2, 3, 3.2, 0xffffff);
    k.cyl(it, a, b, Y + 14.4, 2.3, 2.6, 0x3c4046, 4, 0.05);
    for (const da of [-4.5, -1.5, 1.5, 4.5]) k.cyl(it, a + da, b - 9.6, Y, 0.3, 6.6, 0xffffff, 8, 0.3, true);
    k.box(it, a, b - 9.4, Y + 6.6, 11, 0.6, 3.6, 0xffffff);
    const sign = twoSidedSign(textPanel(['TOWN HALL'], '#f6f1e3', '#5b2a1f', 512, 96), 6, 1.1);
    const [sx, sz] = k.W(a, b - 11.3);
    sign.position.set(sx, Y + 6.2, sz);
    k.look(sign, a, b - 40);
    it.objects.push(sign);
  }
  {
    const a = GA + 50, b = G0 + 11, it = k.item(a, b);
    k.walls(it, a, b, Y, 20, 14, 5.6, 'mustard');
    k.gable(it, a, b, Y + 5.6, 20, 14, 4, true, 0x5b4033);
    for (const da of [-9, -4.5, 0, 4.5, 9]) k.cyl(it, a + da, b - 9.4, Y, 0.14, 3.4, 0xffffff, 6, 0.14, true);
    k.box(it, a, b - 8.4, Y + 3.4, 20.5, 0.25, 3.4, 0x5b4033);
    k.box(it, a, b - 8.4, Y, 20.5, 0.35, 3.6, 0x7a5a3c);
    const sign = twoSidedSign(textPanel(['GENERAL STORE'], '#f3ead2', '#2b4a2e', 512, 96), 9, 1.4);
    const [sx, sz] = k.W(a, b - 7.05);
    sign.position.set(sx, Y + 4.8, sz);
    k.look(sign, a, b - 40);
    it.objects.push(sign);
  }

  // ------------------------------------------------ houses: down both sides of the green and along the side streets
  const houseColors: Siding[] = ['white', 'cream', 'blue', 'white', 'sage', 'grey', 'mustard', 'white', 'yellow', 'red'];
  let hi = 0;
  /** A clapboard house at (a, b), its front door facing `fa`/`fb` (one of them ±1). */
  const house = (a: number, b: number, fa: number, fb: number) => {
    const it = k.item(a, b);
    const h = rng() < 0.5 ? 6.8 : 5.6;
    const sa = fa ? 14 : 11, sb = fa ? 11 : 14; // (gable end to the street)
    k.walls(it, a, b, Y, sa, sb, h, houseColors[hi++ % houseColors.length]);
    k.gable(it, a, b, Y + h, sa, sb, 4.5, !!fb, rng() < 0.5 ? 0x3f4349 : 0x4b3a32);
    k.box(it, a + fa * (sa / 2), b + fb * (sb / 2), Y, fa ? 0.2 : 1.2, 2.4, fa ? 1.2 : 0.2, 0x2a3f5a); // front door
    k.box(it, a - fa * 2 + fb * 3, b - fb * 2 + fa * 3, Y + h + 1.4, 1, 3.5, 1, 0x8a3b2b); // chimney
  };
  for (const s of [-1, 1]) for (const b of [G0 + 42, G0 + 70, G0 + 98]) house(s * (GA + 25), b, -s, 0);
  // Along Church Street (north side), clear of the church.
  for (let a = -212; a <= 212; a += 30) if (Math.abs(a) > 30) house(a, CHURCH_ST + TOWN_HW + 13, 0, -1);
  // Along Maple and Oak Streets, both sides (where nothing else stands).
  for (const s of [-1, 1])
    for (const b of [236, 264]) {
      house(s * (230 + TOWN_HW + 12), b, -s, 0);
      house(s * (230 - TOWN_HW - 12), b, s, 0);
    }

  // ------------------------------------------------ welcome signs where the road comes in
  const welcome = welcomeTexture('Mariano-ville', 'Est. 1789');
  for (const s of [-1, 1]) {
    const a = s * (MAIN_HALF + 30), b = MAIN_ST + TOWN_HW + 9, it = k.item(a, b);
    // White post, a crossbar, and the board hanging from it on short chains.
    k.box(it, a, b, Y, 0.3, 3.9, 0.3, 0xf5f3ee, true);
    k.box(it, a - s * 1.3, b, Y + 3.5, 2.9, 0.22, 0.24, 0xf5f3ee);
    k.cyl(it, a, b, Y + 3.9, 0.22, 0.3, 0xd4a443, 8);
    for (const da of [0.25, 2.45]) k.box(it, a - s * da, b, Y + 2.98, 0.04, 0.55, 0.04, 0x333333);
    const board = twoSidedSign(welcome, 2.5, 1.46);
    const [x, z] = k.W(a - s * 1.35, b);
    board.position.set(x, Y + 2.25, z);
    // Facing the cars coming into town along Main Street.
    k.look(board, a + s * 30, b);
    it.objects.push(board);
    // Board edge, and a bed of autumn flowers at the foot of the post.
    k.box(it, a - s * 1.35, b, Y + 1.5, 2.6, 0.08, 0.1, 0x1f4d36);
    k.box(it, a, b, Y, 2.6, 0.3, 1.4, 0x3b2a1e);
    for (let j = 0; j < 14; j++) {
      const fa = a + (rng() - 0.5) * 2.3, fb = b + (rng() - 0.5) * 1.1;
      const [fx, fz] = k.W(fa, fb);
      const g = new THREE.SphereGeometry(0.16 + rng() * 0.08, 6, 5).translate(fx, Y + 0.4, fz);
      it.geos.push(['plain', paint(g, [0xd8452a, 0xf0b63a, 0xe9762b, 0x9b2a5c][j % 4])]);
    }
  }

  // ------------------------------------------------ maples: round the green, along the streets, behind the shops
  const maple = (a: number, b: number) => {
    if (k.clear(a, b, 2.5)) k.tree(a, b, 'autumn');
  };
  for (let a = -GA + 8; a <= GA - 8; a += 24) for (const b of [G0 + 6, G1 - 6]) if (Math.abs(a) > 8) maple(a, b);
  for (let b = G0 + 20; b <= G1 - 20; b += 22) for (const s of [-1, 1]) if (Math.abs(b - gc) > 8) maple(s * (GA - 7), b);
  for (let a = -215; a <= 215; a += 26) maple(a + 9, MAIN_ST - TOWN_HW - 32 - (a % 3) * 4);
  for (let a = -220; a <= 220; a += 22) if (Math.abs(a) > 30) maple(a, CHURCH_ST - TOWN_HW - 4);
  for (const [a, b] of [[-26, CHURCH_ST + 22], [26, CHURCH_ST + 22], [-24, CHURCH_ST + 62], [24, CHURCH_ST + 64], [0, CHURCH_ST + 76]]) maple(a, b);
}
