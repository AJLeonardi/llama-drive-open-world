// Alexander-ville, built: a farm town out on the plains with the snowy mountains rising
// close behind it (where it is and its streets: outer.ts:makeAlexander). Front Street
// runs along the highway with the gas station; Main Street runs straight back from it,
// lined with brick shop fronts under big painted signs, past the town park to the white
// church at its head. Houses with porches line the avenues, the water tower with the
// town's name stands over the rooftops, and behind it all the grain elevator towers
// over the railroad, with hopper cars waiting on the siding. Out past West Street is
// Alexander Acres: a red barn, a silo, the farmhouse, and cows in a fenced pasture.
import * as THREE from 'three';
import { ALEX, TOWN_HW } from './outer';
import { Rng } from '../util/math';
import { buildingGeometry } from './buildings';
import { mulberry32, rectsOverlap, type Rect } from '../util/math';
import { paint } from '../vehicles/builders/geo';
import { twoSidedSign } from './landmarks';
import { Siding, TownItem, TownKit, welcomeTexture } from './townKit';

/** The water tower's tank: white with the town's name round it in big red letters. */
function tankTexture() {
  const W = 1024, H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#eef1f2';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#c9d0d4';
  g.fillRect(0, 0, W, 6);
  g.fillRect(0, H - 6, W, 6);
  g.fillStyle = '#b3261e';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 78px Impact, "Arial Black", Helvetica, sans-serif';
  // Twice round, so it reads from every side.
  for (const x of [W / 4, (3 * W) / 4]) g.fillText('ALEXANDER-VILLE', x, H / 2 + 4, W / 2 - 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildAlexander(k: TownKit) {
  const Y = k.Y;
  const rng = mulberry32(1871);
  const F = ALEX.front, [B1, B2, B3] = ALEX.avenues, E = ALEX.edge, RAIL = ALEX.rail;
  const HW = TOWN_HW, WALK = HW + 3.7;
  /** Spots taken (town coordinates, a along / b across), so nothing overlaps. */
  const taken: Rect[] = [];
  const take = (a: number, b: number, sa: number, sb: number) => taken.push({ cx: a, cz: b, hw: sa / 2, hd: sb / 2, rot: 0 });
  const free = (a: number, b: number, sa: number, sb: number) => {
    const r: Rect = { cx: a, cz: b, hw: sa / 2, hd: sb / 2, rot: 0 };
    if (taken.some((o) => rectsOverlap(r, o, 1))) return false;
    for (const [da, db] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]])
      if (!k.clear(a + (da * sa) / 2, b + (db * sb) / 2, 1.5)) return false;
    return true;
  };

  // ------------------------------------------------ ground: a lawn under the town, sidewalks, junctions
  k.flat('town-lawn', -240, 240, F - 5, RAIL + 40, Y + 0.06, 6, 64);
  k.sidewalks((a) => a < -ALEX.edge - TOWN_HW - 2); // (none out on the farm lane)
  k.junctions(false);
  k.lamps(0, F, 0, B2, HW + 2.4, 30);

  // ------------------------------------------------ Main Street: brick shop fronts with painted signs
  const shops: [string, number, number, Siding | null][] = [
    // name, side (−1 west, +1 east), along Main Street (b), siding (null: brick)
    ['DINER', -1, 172, null], ['FEED & SEED', -1, 195, 'red'], ['HARDWARE', -1, 218, null], ['BARBER', -1, 240, 'white'],
    ['FIRST BANK', 1, 172, null], ['BAKERY', 1, 195, 'cream'], ['PHARMACY', 1, 218, null], ['CAFE', 1, 240, 'yellow'],
    ['POST OFFICE', 1, 282, null], ['ANTIQUES', 1, 305, 'sage'], ['TOYS & GAMES', 1, 328, null], ['THEATER', 1, 352, null],
  ];
  const bricks = [0xb5533c, 0xa8492f, 0xc96f4f, 0xd2b48c, 0x9c5a3c];
  const boardColors: [string, string][] = [['#f4ecd8', '#7a1f16'], ['#1f3b5a', '#f6e7b5'], ['#2f5a33', '#f3ead2'], ['#f2d36b', '#3a2416'], ['#7a1f16', '#f7f0de']];
  shops.forEach(([name, s, b, siding], i) => {
    const w = 21, d = 18, a = s * (WALK + 0.6 + d / 2), it = k.item(a, b);
    const h = rng() < 0.6 ? 7.6 : 4.4;
    const [x, z] = k.W(a, b);
    // Storefront on the ground floor, then brick (or clapboard) above, and a tall false
    // front with a cornice standing up over the street.
    it.geos.push(['store', buildingGeometry({ cx: x, cz: z, hw: d / 2 + 0.05, hd: w / 2 + 0.05, rot: k.rotA }, Y - 0.2, 3.8, 0xffffff, 8, 4.6, false, null)]);
    if (siding) k.walls(it, a, b, Y + 3.6, d, w, h - 3.6, siding);
    else {
      it.geos.push(['win-brick', buildingGeometry({ cx: x, cz: z, hw: d / 2, hd: w / 2, rot: k.rotA }, Y + 3.6, h - 3.6, bricks[i % bricks.length], 16, 14, false, null)]);
    }
    k.solid(it, a, b, Y, d, h, w);
    k.box(it, a, b, Y + h - 0.05, d + 0.3, 0.3, w + 0.3, 0x55504a);
    const fa = a - s * (d / 2 - 0.25);
    k.box(it, fa, b, Y + 3.6, 0.5, h - 3.6 + 2.2, w + 0.4, siding ? 0xf2efe6 : bricks[(i + 2) % bricks.length]);
    k.box(it, fa - s * 0.15, b, Y + h + 2, 0.9, 0.4, w + 1, 0xf2efe6);
    // Awning over the window, and the sign board on the false front.
    k.box(it, a - s * (d / 2 + 1.1), b, Y + 3.1, 2.2, 0.12, w * 0.85, [0x2f6b45, 0x9e2f2a, 0x284b74, 0x7a5a2e, 0xc9a13b][i % 5]);
    const [bg, fg] = boardColors[i % boardColors.length];
    k.board(it, [name], bg, fg, fa - s * 0.3, b, Y + h - 1.4, w * 0.85, 2.4, s > 0 ? Math.PI / 2 : -Math.PI / 2);
    if (name === 'THEATER') {
      // Marquee: a lit box sticking out over the sidewalk.
      k.box(it, a - s * (d / 2 + 2), b, Y + 3.6, 4, 1.6, 8, 0xf5e6a8);
      k.box(it, a - s * (d / 2 + 2), b, Y + 5.2, 4.2, 0.25, 8.2, 0xb3261e);
    }
    take(a, b, d + 2, w + 2);
  });

  // ------------------------------------------------ the town park, with a bandstand and a flagpole
  {
    const a0 = -E + WALK + 2, a1 = -WALK - 2, b0 = B1 + WALK + 2, b1 = B2 - WALK - 2;
    const ac = (a0 + a1) / 2, bc = (b0 + b1) / 2, it = k.item(ac, bc);
    take(ac, bc, a1 - a0, b1 - b0);
    k.strip(it, 'town-walk', a0, bc, a1, bc, 3, Y + 0.09, 4);
    k.strip(it, 'town-walk', ac, b0, ac, b1, 3, Y + 0.09, 4);
    k.cyl(it, ac, bc, Y, 6, 0.8, 0xece9e1, 8);
    for (let j = 0; j < 8; j++) {
      const ang = (j / 8) * Math.PI * 2;
      k.cyl(it, ac + Math.cos(ang) * 5.4, bc + Math.sin(ang) * 5.4, Y + 0.8, 0.16, 3, 0xffffff, 6);
    }
    k.cyl(it, ac, bc, Y + 3.8, 6.8, 0.3, 0xffffff, 8);
    k.cyl(it, ac, bc, Y + 4.1, 6.8, 2.4, 0x2f5a33, 8, 0.2);
    k.solid(it, ac, bc, Y, 11, 4.5, 11);
    k.cyl(it, ac + 22, bc - 18, Y, 0.12, 12, 0xdddddd, 8, 0.06);
    for (let j = 0; j < 7; j++) k.box(it, ac + 23.3, bc - 18, Y + 11.2 - j * 0.2, 2.4, 0.2, 0.04, j % 2 ? 0xffffff : 0xb3262e);
    k.box(it, ac + 22.55, bc - 18, Y + 10.7, 1, 0.7, 0.05, 0x223a6e);
    k.solid(it, ac + 22, bc - 18, Y, 0.3, 12, 0.3);
    for (const [da, db] of [[-30, -20], [-30, 20], [30, 20], [-55, 0], [55, -5], [10, 30], [-10, -30], [45, -28]]) k.tree(ac + da, bc + db, 'broad');
  }

  // ------------------------------------------------ the church at the head of Main Street
  {
    const cb = B3 + WALK + 25, it = k.item(0, cb);
    const len = 26, wid = 14, h = 8.5;
    k.walls(it, 0, cb + 2, Y, wid, len, h, 'white');
    k.gable(it, 0, cb + 2, Y + h, wid, len, 6, false, 0x3c4046);
    const front = cb + 2 - len / 2;
    k.box(it, 0, front - 0.05, Y, 2.2, 3.6, 0.2, 0x8a2a20); // red doors
    k.box(it, 0, front - 1.5, Y - 0.3, 6, 0.6, 3, 0xd8d4ca);
    const tb = front + 2.6;
    k.walls(it, 0, tb, Y + h, 5, 5, 7, 'white');
    k.box(it, 0, tb, Y + h + 7, 5.6, 0.5, 5.6, 0xffffff);
    k.box(it, 0, tb, Y + h + 7.5, 4.2, 3.6, 4.2, 0xffffff, true);
    for (const [da, db] of [[0, -2.12], [0, 2.12], [-2.12, 0], [2.12, 0]]) k.box(it, da, tb + db, Y + h + 8.1, da ? 0.1 : 1.6, 2.4, da ? 1.6 : 0.1, 0x22262b);
    k.cyl(it, 0, tb, Y + h + 11.1, 2.1, 12, 0xffffff, 8, 0.08);
    k.cyl(it, 0, tb, Y + h + 23.1, 0.06, 1.4, 0xd4a443, 6);
    k.solid(it, 0, tb, Y + h + 11, 2.6, 12, 2.6);
    take(0, cb + 2, wid + 4, len + 8);
    for (const [da, db] of [[-20, -6], [20, -6], [-18, 20], [18, 22]]) k.tree(da, cb + db, 'broad');
  }

  // ------------------------------------------------ the water tower, with the town's name on it
  {
    const a = 120, b = (B2 + B3) / 2, it = k.item(a, b);
    const top = 30, r = 7.5;
    for (const [da, db] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      k.cyl(it, a + da * 5.2, b + db * 5.2, Y, 0.45, top, 0x9aa3a8, 6, 0.35);
      k.solid(it, a + da * 5.2, b + db * 5.2, Y, 0.9, top, 0.9);
    }
    for (const y of [8, 17, 25]) {
      k.box(it, a, b - 5.2, Y + y, 10.4, 0.25, 0.25, 0x9aa3a8);
      k.box(it, a, b + 5.2, Y + y, 10.4, 0.25, 0.25, 0x9aa3a8);
      k.box(it, a - 5.2, b, Y + y, 0.25, 0.25, 10.4, 0x9aa3a8);
      k.box(it, a + 5.2, b, Y + y, 0.25, 0.25, 10.4, 0x9aa3a8);
    }
    k.cyl(it, a, b, Y + top - 2, 1.2, 3, 0x9aa3a8, 8);
    // The tank (its own textured material), a bowl under it and a cone roof on top.
    const [x, z] = k.W(a, b);
    const tank = new THREE.CylinderGeometry(r, r, 8, 32, 1, true);
    tank.translate(x, Y + top + 4, z);
    it.geos.push(['alex-tank', tank]);
    const bowl = new THREE.SphereGeometry(r, 24, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    bowl.scale(1, 0.4, 1);
    bowl.translate(x, Y + top, z);
    it.geos.push(['plain', paint(bowl, 0xe3e7e9)]);
    k.cyl(it, a, b, Y + top + 8, r + 0.3, 3.4, 0xe3e7e9, 24, 0.6);
    k.cyl(it, a, b, Y + top + 11.4, 0.1, 2, 0xb3261e, 6);
    k.box(it, a, b, Y + top - 0.4, 2 * r + 2, 0.15, 2 * r + 2, 0x8d969b); // catwalk
    take(a, b, 16, 16);
    k.materials['alex-tank'] = new THREE.MeshStandardMaterial({ map: tankTexture(), roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
    k.materials['alex-tank'].userData.castShadow = true;
  }

  // ------------------------------------------------ the schoolhouse, red brick with a bell tower
  {
    const a = -110, b = (B2 + B3) / 2 - 8, it = k.item(a, b);
    const [x, z] = k.W(a, b);
    it.geos.push(['win-brick', buildingGeometry({ cx: x, cz: z, hw: 21, hd: 9, rot: k.rotA }, Y - 0.3, 6.8, 0xb5533c, 16, 14, true, null)]);
    k.solid(it, a, b, Y, 42, 6.5, 18);
    k.gable(it, a, b, Y + 6.5, 42, 18, 4, true, 0x3f4349);
    k.box(it, a, b - 9.1, Y, 2.4, 3, 0.3, 0xf2efe6);
    k.box(it, a, b, Y + 9.5, 3, 3, 3, 0xffffff);
    k.cyl(it, a, b, Y + 12.5, 2.3, 3, 0x3f4349, 4, 0.05);
    k.board(it, ['SCHOOL'], '#f4ecd8', '#7a1f16', a, b - 9.3, Y + 3.4, 7, 1.3);
    take(a, b, 46, 24);
    // Playground: a swing frame.
    k.box(it, a + 10, b + 22, Y, 0.2, 3, 0.2, 0xc9302c);
    k.box(it, a + 16, b + 22, Y, 0.2, 3, 0.2, 0xc9302c);
    k.box(it, a + 13, b + 22, Y + 3, 6.4, 0.2, 0.2, 0xc9302c);
  }

  // ------------------------------------------------ the gas station on Front Street
  {
    const a = 78, b = F - WALK - 22, it = k.item(a, b);
    k.quad(it, 'town-walk', [k.W(a - 30, b - 18), k.W(a + 30, b - 18), k.W(a + 30, b + 16), k.W(a - 30, b + 16)], Y + 0.08, 4);
    for (const [da, db] of [[-7, -4], [7, -4], [-7, 4], [7, 4]]) k.box(it, a + da, b + db, Y, 0.4, 5, 0.4, 0xf2efe6, true);
    k.box(it, a, b, Y + 5, 18, 0.9, 12, 0xd23a2a);
    k.box(it, a, b, Y + 5.9, 17, 0.2, 11, 0xf2efe6);
    for (const da of [-4, 4]) {
      k.box(it, a + da, b, Y, 1.2, 0.25, 4, 0xc8c3b8);
      k.box(it, a + da, b, Y + 0.25, 0.8, 1.6, 1.1, 0xd23a2a, true);
      k.box(it, a + da, b, Y + 1.85, 0.9, 0.3, 1.2, 0xf2efe6);
    }
    // The shop, and a tall sign by the road.
    k.box(it, a + 22, b - 6, Y, 12, 4, 8, 0xf2efe6, true);
    k.box(it, a + 22, b - 6, Y + 4, 12.4, 0.5, 8.4, 0xd23a2a);
    k.box(it, a - 22, b + 12, Y, 0.3, 7, 0.3, 0x8d9196, true);
    k.board(it, ['GAS'], '#d23a2a', '#ffffff', a - 22, b + 12, Y + 7, 3.6, 1.8, Math.PI / 2, 'bold {s}px Impact, "Arial Black", sans-serif');
    // A red tractor parked by the pumps.
    tractor(k, it, a - 14, b - 6);
    take(a, b, 62, 36);
  }

  // ------------------------------------------------ the grain elevator and the railroad behind town
  {
    const b = RAIL - 32, it = k.item(-150, b);
    // A row of tall concrete silos with the head house along the top.
    for (let j = 0; j < 6; j++) {
      const a = -205 + j * 9.4;
      k.cyl(it, a, b, Y, 4.7, 32, 0xd6d1c4, 16);
    }
    k.solid(it, -205 + 2.5 * 9.4, b, Y, 6 * 9.4, 32, 9.4);
    k.box(it, -205 + 2.5 * 9.4, b, Y + 32, 6 * 9.4 + 2, 9, 10, 0xcfc9bb);
    k.box(it, -205 + 2.5 * 9.4, b, Y + 41, 6 * 9.4 + 2.6, 0.6, 10.6, 0x8a847a);
    // The tall leg tower at the end, and a spout down to the track.
    k.box(it, -153, b, Y, 6, 48, 6, 0xcfc9bb, true);
    k.box(it, -153, b, Y + 48, 7, 4, 7, 0xb9b2a4);
    k.board(it, ['ALEXANDER-VILLE CO-OP'], '#2f5a33', '#f3ead2', -205 + 2.5 * 9.4, b - 5.15, Y + 33.5, 30, 3.6);
    // Corrugated steel bins with cone roofs.
    for (const [a, r] of [[-128, 7], [-110, 7], [-93, 5.5]] as const) {
      k.cyl(it, a, b + 2, Y, r, 12, 0xbfc6cb, 24, r, true);
      for (let y = 1.5; y < 12; y += 1.5) k.cyl(it, a, b + 2, Y + y, r + 0.06, 0.12, 0x9ea6ab, 24);
      k.cyl(it, a, b + 2, Y + 12, r + 0.2, r * 0.55, 0xc9d0d4, 24, 0.5);
    }
    take(-150, b, 140, 26);
    // Round hay bales stacked by the bins.
    for (let j = 0; j < 8; j++) {
      const a = -70 + (j % 4) * 2.2, bb = b + 8 + Math.floor(j / 4) * 2.4;
      bale(k, it, a, bb);
    }
  }
  {
    const it = k.item(0, RAIL);
    // Two rails on ties, the whole width of town.
    for (let a = -290; a <= 290; a += 1.6) k.box(it, a, RAIL, Y + 0.05, 0.3, 0.16, 2.8, 0x5b4636);
    for (const s of [-0.72, 0.72]) k.box(it, 0, RAIL + s, Y + 0.2, 580, 0.14, 0.09, 0x6d6e70);
    k.flat('town-walk', -290, 290, RAIL - 2.2, RAIL + 2.2, Y + 0.04, 3, 120);
    // Hopper cars under the spout, and a boxcar further along.
    for (const a of [-192, -175, -158]) railcar(k, a, RAIL, 0xc0a14a, true);
    railcar(k, 60, RAIL, 0x8a3b2b, false);
  }

  // ------------------------------------------------ Alexander Acres, the farm out past West Street
  farm(k, rng, take);

  // ------------------------------------------------ houses with porches along the avenues and side streets
  const colors: Siding[] = ['white', 'yellow', 'blue', 'white', 'sage', 'cream', 'red', 'white', 'grey', 'mustard'];
  let hi = 0;
  const house = (a: number, b: number, fa: number, fb: number) => {
    const sa = fa ? 10 : 12, sb = fa ? 12 : 10;
    if (!free(a, b, sa + 4, sb + 4)) return;
    take(a, b, sa + 2, sb + 2);
    const it = k.item(a, b);
    const h = rng() < 0.5 ? 6.2 : 3.6;
    k.walls(it, a, b, Y, sa, sb, h, colors[hi++ % colors.length]);
    k.gable(it, a, b, Y + h, sa, sb, 3.8, !!fb, [0x3f4349, 0x4b3a32, 0x5b2e25][hi % 3]);
    // Front porch: a deck, posts and a little roof, the door behind.
    const pa = a + fa * (sa / 2 + 1.4), pb = b + fb * (sb / 2 + 1.4);
    const ps = fa ? [0.4, 2.8, sb - 1] : [sa - 1, 2.8, 0.4];
    k.box(it, pa, pb, Y, fa ? 2.8 : sa - 1, 0.4, fa ? sb - 1 : 2.8, 0xd9d2c4);
    for (const o of [-1, 1]) k.box(it, pa + fa * 1.1 + (fb ? (o * (sa - 2)) / 2 : 0), pb + fb * 1.1 + (fa ? (o * (sb - 2)) / 2 : 0), Y + 0.4, 0.2, 2.4, 0.2, 0xffffff);
    k.box(it, pa, pb, Y + 2.8, ps[0] + (fa ? 2.6 : 0.4), 0.18, ps[2] + (fb ? 2.6 : 0.4), 0x5b5550);
    k.box(it, a + fa * (sa / 2), b + fb * (sb / 2), Y, fa ? 0.2 : 1.1, 2.3, fa ? 1.1 : 0.2, 0x2a3f5a);
    if (rng() < 0.7) k.tree(a - fa * (sa / 2 + 6) + (fb ? 7 : 0), b - fb * (sb / 2 + 6) + (fa ? 7 : 0), 'broad');
  };
  const set = WALK + 9;
  for (const bAve of [B1, B2, B3])
    for (const s of [-1, 1])
      for (let a = -E + 22; a <= E - 22; a += 25) {
        if (Math.abs(a) < 30) continue;
        house(a, bAve + s * set, 0, -s);
      }
  for (const s of [-1, 1])
    for (let b = F + 30; b <= B3 + 30; b += 25) {
      house(s * (E + set), b, -s, 0);
      house(s * (E - set), b, s, 0);
    }
  // Shade trees along Main Street past the shops.
  for (let b = B2 + 20; b < B3; b += 22) for (const s of [-1, 1]) if (k.clear(s * (WALK + 2), b, 1)) k.tree(s * (WALK + 2), b, 'broad');
  // A windbreak of trees along the far side of the railroad.
  for (let a = -280; a <= 280; a += 14) k.tree(a + (rng() - 0.5) * 6, RAIL + 22 + rng() * 8, rng() < 0.3 ? 'pine' : 'broad');

  // ------------------------------------------------ welcome signs where Front Street comes into town
  const welcome = welcomeTexture('Alexander-ville', 'Est. 1871', '#7a2a1e', '#f4efe2', '#2a0d08');
  for (const s of [-1, 1]) {
    const a = s * (E + 40), b = F + HW + 9, it = k.item(a, b);
    // Two wooden posts and the board between them, with hay bales at its feet.
    for (const o of [-1.6, 1.6]) k.box(it, a + o, b, Y, 0.3, 3.4, 0.3, 0x6b4a2e, true);
    const board = twoSidedSign(welcome, 3, 1.75);
    const [x, z] = k.W(a, b);
    board.position.set(x, Y + 2.3, z);
    k.look(board, a, b - 30);
    it.objects.push(board);
    bale(k, it, a - 2.6, b + 1.4);
    bale(k, it, a + 2.6, b + 1.4);
  }
}

/** A round hay bale lying on its side (axis along b). */
function bale(k: TownKit, it: TownItem, a: number, b: number) {
  const [x, z] = k.W(a, b);
  const g = new THREE.CylinderGeometry(0.85, 0.85, 1.3, 14);
  g.rotateX(Math.PI / 2);
  g.rotateY(k.rotA);
  g.translate(x, k.Y + 0.85, z);
  it.geos.push(['plain', paint(g, 0xd6b25e)]);
  k.solid(it, a, b, k.Y, 1.6, 1.7, 1.4);
}

/** A wheel at (a, b), its axle along b. */
function wheel(kit: TownKit, it: TownItem, a: number, b: number, y: number, r: number, w: number, color: number) {
  const [x, z] = kit.W(a, b);
  const g = new THREE.CylinderGeometry(r, r, w, 16);
  g.rotateX(Math.PI / 2);
  g.rotateY(kit.rotA);
  g.translate(x, y, z);
  it.geos.push(['plain', paint(g, color)]);
}

/** A red farm tractor (pointing along a). */
function tractor(k: TownKit, it: TownItem, a: number, b: number) {
  const Y = k.Y;
  k.box(it, a + 0.6, b, Y + 0.9, 2.6, 1.1, 1.1, 0xc0201a);
  k.box(it, a - 0.9, b, Y + 0.8, 1.6, 0.9, 1.6, 0xc0201a);
  k.box(it, a - 1.1, b, Y + 1.7, 1.3, 1.3, 1.4, 0x2b2b2b);
  k.box(it, a - 1.1, b, Y + 3.0, 1.6, 0.12, 1.7, 0xc0201a);
  k.cyl(it, a + 1.4, b, Y + 2, 0.08, 0.9, 0x333333, 6);
  for (const s of [-1, 1]) {
    wheel(k, it, a - 1.0, b + s * 1.1, Y + 0.85, 0.85, 0.45, 0x1c1c1c);
    wheel(k, it, a - 1.0, b + s * 1.1, Y + 0.85, 0.5, 0.48, 0xe0b11e);
    wheel(k, it, a + 1.6, b + s * 0.75, Y + 0.45, 0.45, 0.3, 0x1c1c1c);
  }
  k.solid(it, a, b, Y, 4.2, 2.4, 2.4);
}

/** A railroad car on the track: an open-topped hopper or a boxcar (along a). */
function railcar(k: TownKit, a: number, b: number, color: number, hopper: boolean) {
  const it = k.item(a, b), Y = k.Y;
  const L = 15;
  k.box(it, a, b, Y + 0.9, L, 0.4, 2.8, 0x2b2b2b);
  for (const e of [-1, 1]) for (const s of [-1, 1]) for (const o of [-0.9, 0.9]) wheel(k, it, a + e * (L / 2 - 2) + o, b + s * 0.72, Y + 0.6, 0.45, 0.15, 0x333333);
  if (hopper) {
    k.box(it, a, b, Y + 1.3, L - 1, 2.6, 3, color);
    for (const o of [-4, 0, 4]) k.box(it, a + o, b, Y + 0.5, 2.4, 0.8, 2, color);
  } else {
    k.box(it, a, b, Y + 1.3, L, 3.4, 3, color);
    k.box(it, a, b - 1.52, Y + 1.5, 3, 2.8, 0.05, 0x6e2e22);
  }
  k.solid(it, a, b, Y, L, 4.5, 3);
}

/**
 * Alexander Acres, out past West Street: a gravel drive under an arched sign, a big red
 * barn with a silo, the white farmhouse with its porch, hay bales, and a white-fenced
 * pasture with cows. (Laid out with `d` the distance west of Main Street: a = −d.)
 */
function farm(k: TownKit, rng: Rng, take: (a: number, b: number, sa: number, sb: number) => void) {
  const Y = k.Y, F = ALEX.farm, E = ALEX.edge;
  const drive = F.drive;
  // The farm lane in from West Street (a road: outer.ts), and the arched sign over it.
  {
    const it = k.item(-((E + F.d0) / 2 + 30), drive);
    take(-(E + F.yard) / 2, drive, F.yard - E, 12);
    take(-F.yard, drive, 2 * F.r + 12, 2 * F.r + 12);
    const sd = F.d0 + 6;
    for (const s of [-1, 1]) k.box(it, -sd, drive + s * 6, Y, 0.45, 5.4, 0.45, 0x6b4a2e, true);
    k.box(it, -sd, drive, Y + 5.2, 0.4, 0.4, 12.8, 0x6b4a2e);
    k.board(it, ['ALEXANDER ACRES'], '#7a2a1e', '#f4ecd8', -sd, drive, Y + 3.9, 8.6, 1.3, -Math.PI / 2);
    // A big shade tree in the middle of the farmyard's turning circle, hay bales round it.
    k.tree(-F.yard, drive, 'broad');
    for (let j = 0; j < 5; j++) bale(k, it, -F.yard + Math.cos(j * 1.26) * 5.5, drive + Math.sin(j * 1.26) * 5.5);
  }
  // The barn, red with white trim, its doors facing the yard, and the silo beside it.
  {
    const a = -420, b = 365, it = k.item(a, b);
    k.box(it, a, b, Y, 24, 9, 16, 0xa3302a, true);
    k.gable(it, a, b, Y + 9, 24, 16, 6.5, true, 0x45403c);
    for (const s of [-1, 1]) k.box(it, a + s * 12.05, b, Y + 9, 0.1, 0.25, 16.4, 0xffffff);
    k.box(it, a, b + 8.05, Y, 7, 6, 0.12, 0x8c2620); // big doors (towards the drive)
    k.box(it, a, b + 8.1, Y + 6, 7.4, 0.25, 0.1, 0xffffff);
    for (const o of [-3.5, 0, 3.5]) k.box(it, a + o, b + 8.1, Y, 0.25, 6, 0.1, 0xffffff);
    k.box(it, a, b + 8.1, Y + 3, 7, 0.22, 0.1, 0xffffff);
    k.box(it, a, b + 8.1, Y + 10.5, 2.6, 2.4, 0.12, 0xffffff); // hay-loft door
    k.box(it, a, b + 8.12, Y + 10.7, 2.2, 2, 0.1, 0x8c2620);
    // Silo with a dome, banded.
    const sa = a - 18, sb = b - 2;
    k.cyl(it, sa, sb, Y, 3.6, 20, 0xb7bfc4, 18, 3.6, true);
    for (let y = 2.5; y < 20; y += 2.5) k.cyl(it, sa, sb, Y + y, 3.66, 0.18, 0x8e979c, 18);
    k.dome(it, sa, sb, Y + 20, 3.65, 0x8c969c, 1, 18);
    take(a - 4, b, 40, 24);
  }
  // The farmhouse: white, two storeys, a grey roof, a porch along the front.
  {
    const a = -345, b = 432, it = k.item(a, b);
    k.walls(it, a, b, Y, 14, 10, 6.6, 'white');
    k.gable(it, a, b, Y + 6.6, 14, 10, 4, true, 0x4c5157);
    k.box(it, a, b - 6.5, Y, 14, 0.45, 3, 0xd9d2c4);
    for (const o of [-6.5, -2.2, 2.2, 6.5]) k.box(it, a + o, b - 7.8, Y + 0.45, 0.2, 2.5, 0.2, 0xffffff);
    k.box(it, a, b - 6.6, Y + 2.95, 14.4, 0.2, 3.4, 0x4c5157);
    k.box(it, a, b - 5.05, Y, 1.1, 2.3, 0.12, 0x5a2e22);
    k.box(it, a - 4, b + 2, Y + 8.5, 1, 3.5, 1, 0x8a3b2b);
    take(a, b, 18, 18);
    k.tree(a + 14, b + 6, 'broad');
    k.tree(a - 12, b + 12, 'broad');
  }
  // Hay bales by the barn.
  {
    const it = k.item(-450, 395);
    for (let j = 0; j < 9; j++) bale(k, it, -442 - (j % 3) * 2.2, 392 + Math.floor(j / 3) * 2.6);
  }
  // The pasture: white rail fence (a gate by the barn), a water trough and cows.
  {
    const d0 = F.d0 + 70, d1 = F.d1 - 4, b0 = 450, b1 = F.b1 - 4;
    const fence = (pd: number, pb: number, qd: number, qb: number) => {
      const it = k.item(-(pd + qd) / 2, (pb + qb) / 2);
      const len = Math.hypot(qd - pd, qb - pb), alongA = Math.abs(qd - pd) > 1;
      for (let s = 0; s <= len; s += 3) k.box(it, -(pd + ((qd - pd) * s) / len), pb + ((qb - pb) * s) / len, Y, 0.18, 1.4, 0.18, 0xffffff);
      for (const y of [0.55, 1.15]) k.box(it, -(pd + qd) / 2, (pb + qb) / 2, Y + y, alongA ? len : 0.1, 0.14, alongA ? 0.1 : len, 0xffffff);
      k.solid(it, -(pd + qd) / 2, (pb + qb) / 2, Y, alongA ? len : 0.3, 1.4, alongA ? 0.3 : len);
    };
    fence(d0, b0, 410, b0);
    fence(420, b0, d1, b0);
    fence(d0, b1, d1, b1);
    fence(d0, b0, d0, b1);
    fence(d1, b0, d1, b1);
    take(-(d0 + d1) / 2, (b0 + b1) / 2, d1 - d0, b1 - b0);
    const tr = k.item(-(d0 + 20), b0 + 15);
    k.box(tr, -(d0 + 20), b0 + 15, Y, 4, 0.8, 1.2, 0x7d8288, true);
    k.box(tr, -(d0 + 20), b0 + 15, Y + 0.8, 3.8, 0.02, 1, 0x3f7fa6);
    for (let j = 0; j < 6; j++) {
      const cd = d0 + 25 + rng() * (d1 - d0 - 50), cb = b0 + 20 + rng() * (b1 - b0 - 40);
      cow(k, -cd, cb, rng() * Math.PI * 2, rng() < 0.5);
    }
    for (const [td, tb] of [[d1 - 20, b1 - 18], [d0 + 60, b1 - 25]]) k.tree(-td, tb, 'broad');
  }
}

/** A cow (black-and-white or brown) standing in the pasture, turned `phi`. */
function cow(k: TownKit, a: number, b: number, phi: number, spotted: boolean) {
  const it = k.item(a, b), Y = k.Y;
  const body = spotted ? 0xf2f0ea : 0x7a4a2c, patch = spotted ? 0x1d1d1d : 0x5c3520;
  const ca = Math.cos(phi), cb = Math.sin(phi);
  const at = (f: number, s: number): [number, number] => [a + ca * f - cb * s, b + cb * f + ca * s];
  const part = (f: number, s: number, y: number, l: number, h: number, w: number, color: number) => {
    const [pa, pb] = at(f, s);
    k.box(it, pa, pb, Y + y, l, h, w, color, false, 'plain', phi);
  };
  part(0, 0, 0.75, 2.2, 0.9, 0.95, body);
  part(0.3, 0.2, 0.95, 0.8, 0.5, 1.0, patch);
  part(-0.6, -0.15, 0.85, 0.6, 0.6, 1.0, patch);
  part(1.35, 0, 1.25, 0.6, 0.55, 0.5, body);
  part(1.67, 0, 1.25, 0.12, 0.3, 0.42, 0xd9a0a0); // nose
  for (const s of [-1, 1]) part(1.25, s * 0.32, 1.6, 0.12, 0.12, 0.16, 0xe8e2d0); // horns
  for (const f of [-0.85, 0.75]) for (const s of [-0.3, 0.3]) part(f, s, 0, 0.18, 0.75, 0.18, body);
  part(-1.12, 0, 0.9, 0.08, 0.7, 0.08, patch); // tail
  k.solid(it, a, b, Y, 2.6, 1.6, 2.6);
}
