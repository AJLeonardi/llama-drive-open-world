// The towns, built (where they sit and their roads are in outer.ts:TOWNS). This file
// has Mariano-ville; Alexander-ville and Washington DC have their own files.
//
// Mariano-ville: a little New England town centre in the autumn woods. Main Street runs
// in front of the town green, with a row of clapboard shops on one side; across it is
// the green with its gazebo, paths and maples, with a street down each side and Church
// Street across the top, where the white church with its tall steeple stands. The town
// hall and the general store are on the corners, houses line the side streets, and
// carved welcome signs stand where the road comes into town. Up a drive from the end of
// Church Street, behind a fieldstone wall in the woods, is Mariano Mansion.
import * as THREE from 'three';
import { CHURCH_ST, MAIN_ST, MANSION, MARIANO_GREEN, TOWNS, TOWN_HW } from './outer';
import { buildingGeometry } from './buildings';
import { box, paint } from '../vehicles/builders/geo';
import { textPanel, twoSidedSign } from './landmarks';
import { mulberry32, type Rng } from '../util/math';
import { sidewalkTexture } from '../util/textures';
import { SIDINGS, Siding, TownItem, TownKit, sidingTexture, welcomeTexture } from './townKit';
import { buildAlexander } from './alexanderBuild';
import { buildDC } from './dcBuild';
import { buildPad } from './padBuild';
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
    else if (t.kind === 'pad') buildPad(kit);
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
  // (None round the green, or up the mansion's drive.)
  k.sidewalks((a, b) => (Math.abs(a) < GA + 2 && b > G0 - 2 && b < G1 + 2) || b > CHURCH_ST + TOWN_HW + 4);
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

  // ------------------------------------------------ Mariano Mansion, up the drive from the end of Church Street
  mansion(k, rng);
}

const CREAM = 0xf2ead8, SLATE = 0x3a3e46, STONE = 0x8a8278, PALE_STONE = 0xc9c2b4, BRICK = 0x8a3b2b, IRON = 0x1e2124, GOLD = 0xd4a443;
const STONES = [0x857d72, 0x7b746b, 0x948b7f, 0x6f6a63, 0x8f8a80];

/**
 * Mariano Mansion: a Queen Anne Victorian in plum clapboard with cream trim, a round
 * corner turret, a wraparound porch and a widow's walk on the roof, at the end of a
 * maple-lined drive. A fieldstone wall runs round the grounds, the drive coming in
 * through iron gates under the name; in front of the house the drive goes round a
 * fountain, the carriage house stands to one side, and behind are a formal garden and
 * an apple orchard. Pumpkins and mums everywhere: it's autumn.
 */
function mansion(k: TownKit, rng: Rng) {
  const Y = k.Y, M = MANSION, A = M.a, F = M.house;
  const HB = F + 8, Y0 = Y + 0.9; // (the middle of the house, and its ground floor)

  // ------------------------------------------------ the lawn, and the fieldstone wall round it
  k.flat('town-lawn', A - M.half, A + M.half, M.gate + 0.5, M.back, Y + 0.06, 6, 64);
  /** A stone wall from (a0, b0) to (a1, b1) (along a or along b), its stones uneven. */
  const wall = (a0: number, b0: number, a1: number, b1: number) => {
    const len = Math.hypot(a1 - a0, b1 - b0), alongA = Math.abs(a1 - a0) > Math.abs(b1 - b0);
    const it = k.item((a0 + a1) / 2, (b0 + b1) / 2), n = Math.round(len / 2.6);
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * (i + 0.5)) / n, b = b0 + ((b1 - b0) * (i + 0.5)) / n, l = len / n + 0.05;
      const w = 0.85 + rng() * 0.2;
      k.box(it, a, b, Y, alongA ? l : w, 0.95 + rng() * 0.3, alongA ? w : l, STONES[Math.floor(rng() * STONES.length)]);
    }
    k.solid(it, (a0 + a1) / 2, (b0 + b1) / 2, Y, alongA ? len : 1, 1.15, alongA ? 1 : len, STONE);
  };
  const G = M.gate, L = A - M.half, R = A + M.half;
  wall(L, G, A - 8.4, G);
  wall(A + 8.4, G, R, G);
  wall(L, G, L, M.back);
  wall(R, G, R, M.back);
  wall(L, M.back, R, M.back);

  // ------------------------------------------------ the gate: stone pillars, an iron arch with the name, the gates swung open
  {
    const it = k.item(A, G);
    for (const s of [-1, 1]) {
      const pa = A + s * 7.6;
      k.box(it, pa, G, Y, 1.5, 3.2, 1.5, STONES[2], true);
      k.box(it, pa, G, Y + 3.2, 1.9, 0.3, 1.9, STONES[3]);
      k.box(it, pa, G, Y + 3.5, 0.5, 0.7, 0.5, 0xffe2a6);
      k.box(it, pa, G, Y + 4.2, 0.75, 0.12, 0.75, IRON);
      k.box(it, pa, G, Y + 4.32, 0.12, 1.5, 0.12, IRON);
      // The gate, open against the inside of the wall: rails top and bottom, and bars.
      const gb = G + 0.9;
      for (const y of [0.15, 2.0]) k.box(it, A + s * 6.7, gb + 1.75, Y + y, 0.08, 0.1, 3.5, IRON);
      for (let j = 0; j <= 12; j++) k.box(it, A + s * 6.7, gb + (3.5 * j) / 12, Y + 0.1, 0.05, 2.25 + (j % 2) * 0.2, 0.05, IRON);
      k.solid(it, A + s * 6.7, gb + 1.75, Y, 0.2, 2.3, 3.5, IRON);
      // Pumpkins and mums at the foot of each pillar.
      pumpkins(k, it, rng, pa + s * 2.2, G - 1.6, 4);
      mums(k, it, rng, pa + s * 1.5, G - 1.2, 8);
    }
    // The arch over the drive, and the name hanging from it.
    k.box(it, A, G, Y + 5.75, 15.4, 0.16, 0.14, IRON);
    k.box(it, A, G, Y + 6.05, 9, 0.12, 0.12, IRON);
    k.box(it, A, G, Y + 6.3, 4, 0.12, 0.12, IRON);
    for (const da of [-4.5, -2, 0, 2, 4.5]) k.box(it, A + da, G, Y + 5.75, 0.08, da ? (Math.abs(da) > 3 ? 0.3 : 0.55) : 0.8, 0.08, IRON);
    k.box(it, A, G, Y + 6.55, 0.5, 0.5, 0.08, GOLD);
    for (const da of [-3.8, 3.8]) k.box(it, A + da, G, Y + 5.35, 0.05, 0.4, 0.05, IRON);
    k.board(it, ['MARIANO MANSION'], '#3b2230', '#e8c66a', A, G, Y + 4.05, 8.4, 1.3);
  }

  // ------------------------------------------------ maples and lamps along the drive
  for (let b = CHURCH_ST + 34; b < M.circle - M.r - 6; b += 17)
    for (const s of [-1, 1]) if (Math.abs(b - G) > 6 && k.clear(A + s * 11, b, 4)) k.tree(A + s * 11, b, 'autumn');
  k.lamps(A, G + 6, A, M.circle - M.r - 2, M.hw + 2.4, 34);

  // ------------------------------------------------ the fountain in the carriage circle
  {
    const C = M.circle, it = k.item(A, C);
    k.cyl(it, A, C, Y, 6.4, 0.7, PALE_STONE, 28, 6.4, true);
    const [x, z] = k.W(A, C);
    it.geos.push(['town-water', new THREE.CircleGeometry(5.9, 28).rotateX(-Math.PI / 2).translate(x, Y + 0.72, z)]);
    k.cyl(it, A, C, Y + 0.7, 0.7, 1.8, PALE_STONE, 12);
    k.cyl(it, A, C, Y + 2.5, 0.6, 0.55, PALE_STONE, 20, 2.4);
    it.geos.push(['town-water', new THREE.CircleGeometry(2.2, 20).rotateX(-Math.PI / 2).translate(x, Y + 3.07, z)]);
    k.cyl(it, A, C, Y + 3.05, 0.32, 1.2, PALE_STONE, 10);
    k.cyl(it, A, C, Y + 4.25, 0.3, 0.35, PALE_STONE, 12, 1.1);
    k.cyl(it, A, C, Y + 4.6, 0.12, 1.1, 0xeaf4fb, 6, 0.04);
    // Clipped box shrubs and mums round it.
    for (let j = 0; j < 12; j++) {
      const ang = (j / 12) * Math.PI * 2, r = j % 2 ? 9.5 : 10.5;
      if (j % 2) mums(k, it, rng, A + Math.cos(ang) * r, C + Math.sin(ang) * r, 7);
      else shrub(k, it, A + Math.cos(ang) * r, C + Math.sin(ang) * r, 1.1);
    }
  }

  // ------------------------------------------------ the house
  {
    const it = k.item(A, HB);
    // Fieldstone foundation, two storeys of clapboard, cream trim, a steep slate roof.
    k.box(it, A, HB, Y, 22.4, 0.9, 16.4, STONE, true);
    k.walls(it, A, HB, Y0, 22, 16, 6.8, 'plum');
    k.box(it, A, HB, Y0 + 3.3, 22.3, 0.22, 16.3, CREAM);
    k.box(it, A, HB, Y0 + 6.5, 22.6, 0.4, 16.6, CREAM);
    for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box(it, A + sa * 11, HB + sb * 8, Y0, 0.4, 6.8, 0.4, CREAM);
    k.gable(it, A, HB, Y0 + 6.8, 22, 16, 6.2, true, SLATE);
    // Cream gable ends, each with an attic window.
    for (const s of [-1, 1]) {
      k.gable(it, A + s * 11.4, HB, Y0 + 6.8, 0.1, 15, 5.5, true, CREAM);
      k.box(it, A + s * 11.98, HB, Y0 + 7.9, 0.08, 1.7, 1.3, 0x27323d);
    }
    // A cross gable over the front door, with a tall arched window.
    const ga = A + 3;
    k.gable(it, ga, F + 3, Y0 + 6.8, 8, 6.2, 4.8, false, SLATE);
    k.gable(it, ga, F - 0.15, Y0 + 6.8, 7, 0.1, 4.2, false, CREAM);
    k.box(it, ga, F - 0.72, Y0 + 7.2, 2.1, 2.5, 0.08, CREAM);
    k.box(it, ga, F - 0.78, Y0 + 7.4, 1.5, 1.9, 0.08, 0x27323d);
    k.box(it, ga, F - 0.8, Y0 + 8.3, 1.5, 0.1, 0.08, CREAM);
    // The front door: a dark red double door with a transom, in a cream frame.
    k.box(it, ga, F - 0.05, Y0, 2.5, 3.4, 0.1, CREAM);
    k.box(it, ga, F - 0.1, Y0, 1.9, 2.6, 0.12, 0x5a1f2c);
    k.box(it, ga, F - 0.11, Y0, 0.06, 2.6, 0.12, 0x3a121b);
    k.box(it, ga, F - 0.1, Y0 + 2.7, 1.9, 0.55, 0.12, 0x27323d);
    // Tall brick chimneys.
    for (const ca of [-6.5, 7.5]) {
      k.box(it, A + ca, HB + 3, Y0 + 6, 1.5, 8.2, 1.1, BRICK);
      k.box(it, A + ca, HB + 3, Y0 + 14.2, 1.8, 0.3, 1.4, 0x5a2a20);
    }
    // The widow's walk on the ridge: a railed lookout (for watching for ships, long ago).
    {
      const wa = A - 1, top = Y0 + 6.8 + 5.95;
      k.box(it, wa, HB, Y0 + 6.8 + 4.9, 6, 1.05, 2.6, SLATE);
      k.box(it, wa, HB, top, 6.2, 0.12, 2.8, CREAM);
      for (const s of [-1, 1]) {
        k.box(it, wa, HB + s * 1.35, top + 0.85, 6.1, 0.1, 0.1, CREAM);
        k.box(it, wa + s * 3.05, HB, top + 0.85, 0.1, 0.1, 2.7, CREAM);
        for (let j = 0; j <= 8; j++) k.box(it, wa - 3 + j * 0.75, HB + s * 1.35, top, 0.08, 0.85, 0.08, CREAM);
        for (let j = 1; j < 4; j++) k.box(it, wa + s * 3.05, HB - 1.35 + j * 0.675, top, 0.08, 0.85, 0.08, CREAM);
      }
    }
    // The turret on the front corner: three storeys, round, with a tall pointed roof.
    {
      const ta = A - 11, tb = F, r = 3.8;
      k.cyl(it, ta, tb, Y, r + 0.2, 0.9, STONE, 8);
      k.tower(it, ta, tb, Y0, r, 10.4, 8, 'plum');
      k.cyl(it, ta, tb, Y0 + 3.3, r + 0.1, 0.22, CREAM, 8);
      k.cyl(it, ta, tb, Y0 + 6.5, r + 0.12, 0.4, CREAM, 8);
      k.cyl(it, ta, tb, Y0 + 10.2, r + 0.35, 0.45, CREAM, 8);
      k.cyl(it, ta, tb, Y0 + 10.65, r + 0.6, 7.8, SLATE, 8, 0.05);
      k.cyl(it, ta, tb, Y0 + 18.4, 0.07, 1.7, GOLD, 6);
      k.cyl(it, ta, tb, Y0 + 18.9, 0.22, 0.4, GOLD, 8, 0.05);
    }
    // The wraparound porch: across the front from the turret, and down the right side.
    {
      const a0 = A - 7.6, a1 = A + 14.2, b0 = F - 3.2, b1 = F + 9, ma = (a0 + a1) / 2;
      k.box(it, ma, (b0 + F) / 2, Y, a1 - a0, 0.9, F - b0, 0xb9b0a2, true);
      k.box(it, a1 - 1.6, (F + b1) / 2, Y, 3.2, 0.9, b1 - F, 0xb9b0a2, true);
      // Its roof, with a cream fascia, and a little pediment over the steps.
      k.box(it, ma, (b0 + F) / 2 - 0.2, Y0 + 2.9, a1 - a0 + 0.4, 0.22, F - b0 + 0.6, SLATE);
      k.box(it, a1 - 1.4, (F + b1) / 2 + 0.2, Y0 + 2.9, 3.6, 0.22, b1 - F + 0.4, SLATE);
      k.box(it, ma, b0 - 0.45, Y0 + 2.6, a1 - a0 + 0.4, 0.38, 0.12, CREAM);
      k.box(it, a1 + 0.25, (b0 + b1) / 2, Y0 + 2.6, 0.12, 0.38, b1 - b0 + 0.6, CREAM);
      k.gable(it, ga, b0 + 0.6, Y0 + 3.1, 3.8, 2.6, 1.3, false, SLATE);
      k.gable(it, ga, b0 - 0.55, Y0 + 3.1, 3.2, 0.1, 1.05, false, CREAM);
      // Turned posts, and railings (a gap at the steps).
      const posts: [number, number][] = [];
      for (let a = a0 + 0.2; a <= a1 - 0.2; a += (a1 - a0 - 0.4) / 8) posts.push([a, b0 + 0.2]);
      for (let b = b0 + 0.2 + 3.05; b <= b1 - 0.2; b += 3.05) posts.push([a1 - 0.2, b]);
      for (const [pa, pb] of posts) {
        k.cyl(it, pa, pb, Y0, 0.13, 2.9, CREAM, 8);
        k.box(it, pa, pb, Y0 + 2.45, 0.34, 0.3, 0.34, CREAM);
      }
      const rail = (pa: number, pb: number, qa: number, qb: number) => {
        const alongA = Math.abs(qa - pa) > Math.abs(qb - pb), l = Math.hypot(qa - pa, qb - pb);
        k.box(it, (pa + qa) / 2, (pb + qb) / 2, Y0 + 0.85, alongA ? l : 0.14, 0.12, alongA ? 0.14 : l, CREAM);
        k.box(it, (pa + qa) / 2, (pb + qb) / 2, Y0 + 0.1, alongA ? l : 0.05, 0.75, alongA ? 0.05 : l, 0xe6dcc6);
      };
      rail(a0 + 0.2, b0 + 0.2, ga - 1.9, b0 + 0.2);
      rail(ga + 1.9, b0 + 0.2, a1 - 0.2, b0 + 0.2);
      rail(a1 - 0.2, b0 + 0.2, a1 - 0.2, b1 - 0.2);
      // Steps down to the drive, pumpkins up them.
      k.box(it, ga, b0 - 0.35, Y, 3.6, 0.6, 0.7, PALE_STONE);
      k.box(it, ga, b0 - 1.0, Y, 3.6, 0.3, 0.6, PALE_STONE);
      for (const s of [-1, 1]) {
        pumpkin(k, it, ga + s * 1.5, b0 - 0.35, Y + 0.6, 0.32);
        pumpkin(k, it, ga + s * 1.5, b0 - 1.0, Y + 0.3, 0.26);
        pumpkin(k, it, ga + s * 1.2, b0 + 0.6, Y0, 0.42);
      }
      // A porch swing at the end, and rocking chairs.
      k.box(it, a1 - 1.5, b1 - 1.8, Y0 + 0.5, 0.6, 0.1, 1.8, 0x7a5a3c);
      k.box(it, a1 - 1.8, b1 - 1.8, Y0 + 0.6, 0.08, 0.55, 1.8, 0x7a5a3c);
      for (const da of [-0.85, 0.85]) k.box(it, a1 - 1.5, b1 - 1.8 + da, Y0 + 1.1, 0.04, 1.8, 0.04, 0x333333);
      for (const ra of [A - 3, A - 1.2]) {
        k.box(it, ra, b0 + 1.3, Y0 + 0.45, 0.6, 0.08, 0.6, 0x2f4a33);
        k.box(it, ra, b0 + 1.6, Y0 + 0.5, 0.6, 0.7, 0.08, 0x2f4a33);
      }
    }
    // Shrubs along the foundation.
    for (let a = A - 6; a <= A + 13; a += 2.4) if (Math.abs(a - ga) > 2.4) shrub(k, it, a, F - 4.1, 0.75);
  }

  // ------------------------------------------------ the carriage house, red with a cupola
  {
    const ca = A + 46, cb = HB + 2, it = k.item(ca, cb);
    k.walls(it, ca, cb, Y, 16, 10, 5.6, 'red');
    k.gable(it, ca, cb, Y + 5.6, 16, 10, 4.6, true, SLATE);
    for (const s of [-1, 1]) {
      const da = ca + s * 3.8;
      k.box(it, da, cb - 5.04, Y, 3.6, 3.7, 0.1, CREAM);
      k.box(it, da, cb - 5.08, Y, 3.1, 3.4, 0.1, 0x6e2a20);
      // White trim across and down the middle of each pair of doors.
      k.box(it, da, cb - 5.14, Y + 1.62, 3.1, 0.16, 0.06, CREAM);
      k.box(it, da, cb - 5.14, Y, 0.16, 3.4, 0.06, CREAM);
    }
    const top = Y + 5.6 + 4.6 - 0.8;
    k.box(it, ca, cb, top, 2, 2, 2, CREAM);
    for (const s of [-1, 1]) k.box(it, ca, cb + s * 1.02, top + 0.7, 1.2, 0.9, 0.05, 0x27323d);
    k.gable(it, ca, cb, top + 2, 2, 2, 1.3, true, SLATE);
    k.cyl(it, ca, cb, top + 3.3, 0.04, 1.4, GOLD, 5);
    k.box(it, ca, cb, top + 4.3, 1.1, 0.2, 0.04, GOLD);
    pumpkins(k, it, rng, ca, cb - 7, 9);
  }

  // ------------------------------------------------ the formal garden behind the house
  {
    const gb0 = HB + 16, gb1 = HB + 46, gw = 24, gm = (gb0 + gb1) / 2, it = k.item(A, gm);
    k.strip(it, 'town-walk', A, gb0 - 6, A, gb1, 2.6, Y + 0.09, 4);
    k.strip(it, 'town-walk', A - gw, gm, A + gw, gm, 2.6, Y + 0.09, 4);
    /** A clipped hedge from (a0, b0) to (a1, b1). */
    const hedge = (a0: number, b0: number, a1: number, b1: number) => {
      const alongA = Math.abs(a1 - a0) > Math.abs(b1 - b0), l = Math.hypot(a1 - a0, b1 - b0);
      k.box(it, (a0 + a1) / 2, (b0 + b1) / 2, Y, alongA ? l : 0.9, 1, alongA ? 0.9 : l, 0x2d4a2a, true);
    };
    // Four beds, each hedged round, with red and gold flowers in it.
    for (const sa of [-1, 1])
      for (const sb of [-1, 1]) {
        const i0 = A + sa * 2.5, i1 = A + sa * gw, j0 = gm + sb * 2.5, j1 = gm + sb * (gw / 2 + 3);
        hedge(i0, j0, i1, j0);
        hedge(i0, j1, i1, j1);
        hedge(i1, j0, i1, j1);
        hedge(i0, j0, i0, j1);
        for (let j = 0; j < 4; j++) mums(k, it, rng, (i0 + i1) / 2 + (j - 1.5) * 4.5, (j0 + j1) / 2 + (j % 2 ? 1.5 : -1.5), 10);
      }
    // A sundial in the middle on a stone pillar.
    k.cyl(it, A, gm, Y, 0.45, 1, PALE_STONE, 10, 0.35);
    k.cyl(it, A, gm, Y + 1, 0.6, 0.12, PALE_STONE, 14);
    k.box(it, A, gm, Y + 1.12, 0.04, 0.3, 0.5, 0x8a6d3b);
    k.solid(it, A, gm, Y, 1.1, 1.2, 1.1);
    for (const [da, db] of [[-gw - 8, gb0 - 2], [gw + 8, gb0 - 2], [-gw - 8, gb1 + 2], [gw + 8, gb1 + 2]]) k.tree(A + da, db, 'autumn');
  }

  // ------------------------------------------------ the apple orchard, and big maples out on the lawn
  for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) k.tree(L + 14 + i * 14 + (j % 2) * 4, HB - 30 + j * 14, 'broad');
  for (const [da, b] of [[-45, G + 30], [52, G + 34], [-30, M.circle - 6], [70, HB + 40], [-62, M.back - 20], [80, G + 70], [35, M.back - 12]]) k.tree(A + da, b, 'autumn');
}

/** A round clipped shrub. */
function shrub(k: TownKit, it: TownItem, a: number, b: number, r: number) {
  const [x, z] = k.W(a, b);
  it.geos.push(['plain', paint(new THREE.SphereGeometry(r, 9, 6).scale(1, 0.85, 1).translate(x, k.Y + r * 0.8, z), 0x34552f)]);
}

/** A clump of mums: autumn flowers, red, gold, orange and plum. */
function mums(k: TownKit, it: TownItem, rng: Rng, a: number, b: number, n: number) {
  const cols = [0xd8452a, 0xf0b63a, 0xe9762b, 0x9b2a5c];
  const col = cols[Math.floor(rng() * cols.length)];
  for (let j = 0; j < n; j++) {
    const [x, z] = k.W(a + (rng() - 0.5) * 1.6, b + (rng() - 0.5) * 1.6);
    it.geos.push(['plain', paint(new THREE.SphereGeometry(0.22 + rng() * 0.1, 6, 5).translate(x, k.Y + 0.3, z), j % 4 ? col : 0x3b5a2c)]);
  }
}

/** A pumpkin sitting at height y. */
function pumpkin(k: TownKit, it: TownItem, a: number, b: number, y: number, r: number) {
  const [x, z] = k.W(a, b);
  const g = new THREE.SphereGeometry(r, 12, 8).scale(1, 0.75, 1).translate(x, y + r * 0.72, z);
  it.geos.push(['plain', paint(g, (px, _py, pz) => {
    // Ridges round it: darker in the grooves.
    const ang = Math.atan2(pz - z, px - x);
    return Math.cos(ang * 6) > 0.6 ? 0xc85f14 : 0xe2781e;
  })]);
  it.geos.push(['plain', paint(new THREE.CylinderGeometry(r * 0.12, r * 0.16, r * 0.4, 5).translate(x, y + r * 1.55, z), 0x4d5a26)]);
}

/** A little heap of pumpkins. */
function pumpkins(k: TownKit, it: TownItem, rng: Rng, a: number, b: number, n: number) {
  for (let j = 0; j < n; j++) pumpkin(k, it, a + (rng() - 0.5) * 2.4, b + (rng() - 0.5) * 1.6, k.Y, 0.3 + rng() * 0.25);
}
