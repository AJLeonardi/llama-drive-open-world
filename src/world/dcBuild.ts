// Washington DC, built: a city of white stone out in the desert (where it is and its
// streets: outer.ts:makeDC; city coordinates `a` east, `b` south). The National Mall
// runs down the middle, a long lawn with rows of elms, from the Lincoln Memorial and its
// reflecting pool past the Washington Monument to the Capitol with its great dome. The
// White House looks out over the Ellipse to the north; the Jefferson Memorial stands on
// the Tidal Basin to the south; the Smithsonian's red castle, the Air and Space Museum
// (with a moon rocket outside), Natural History and the National Gallery line the Mall,
// and stone office blocks fill the streets around, Pennsylvania Avenue cutting across.
import * as THREE from 'three';
import { DC_PLAN, TOWN_HW } from './outer';
import { mulberry32, rectsOverlap, type Rect } from '../util/math';
import { paint } from '../vehicles/builders/geo';
import type { WindowStyle } from '../util/textures';
import { TownKit } from './townKit';

const MARBLE = 0xf4f1ea, MARBLE2 = 0xe9e4d8, STONE = 0xd9d2c4;

export function buildDC(k: TownKit) {
  const Y = k.Y;
  const rng = mulberry32(1790);
  const P = DC_PLAN, M = P.mall;
  const taken: Rect[] = [];
  const take = (a: number, b: number, sa: number, sb: number) => taken.push({ cx: a, cz: b, hw: sa / 2, hd: sb / 2, rot: 0 });

  // ------------------------------------------------ ground: lawns everywhere, sidewalks, crossings, lamps
  const basin = P.basin;
  // Round the Tidal Basin the lawn is laid in small pieces, stopping where its banks
  // slope down to the water. (The big pieces' edges line up 80 m either side of it.)
  const nearBasin = (a: number, b: number) => Math.abs(a - basin.x) < 80 && Math.abs(b - basin.z) < 80;
  k.flat('town-lawn', -500, 500, -360, 360, Y + 0.06, 7, 40, (a, b) => nearBasin(a, b));
  k.flat('town-lawn', basin.x - 80, basin.x + 80, basin.z - 80, basin.z + 80, Y + 0.06, 7, 8, (a, b) => Math.hypot(a - basin.x, b - basin.z) < basin.r + 18);
  k.sidewalks();
  k.junctions(true);
  for (const z of [-M.z, M.z]) k.lamps(M.x0, z, M.x1, z, 7 + 2.4, 40, 'cobra');
  k.lamps(M.x1, P.z0, M.x1, P.z1, 7 + 2.4, 40, 'cobra');
  k.lamps(0, -265, M.x1, -115, 7 + 2.4, 40, 'cobra');

  // ------------------------------------------------ the Mall: gravel walks and rows of elms
  for (const z of [-32, 32]) {
    const it = k.item(-30, z);
    k.strip(it, 'town-walk', M.x0 + 85, z, M.x1 - 10, z, 7, Y + 0.09, 4);
  }
  for (const z of [-46, -20, 20, 46])
    for (let a = -165; a < M.x1 - 12; a += 15) {
      if (Math.abs(a - P.monument[0]) < 62 || Math.abs(a) < 14 || Math.abs(a - 180) < 14) continue;
      k.tree(a, z, 'broad');
    }

  // ------------------------------------------------ the Washington Monument, ringed by flags
  {
    const [ma, mb] = P.monument, it = k.item(ma, mb);
    k.quad(it, 'town-walk', [k.W(ma - 34, mb - 34), k.W(ma + 34, mb - 34), k.W(ma + 34, mb + 34), k.W(ma - 34, mb + 34)], Y + 0.1, 4);
    const [x, z] = k.W(ma, mb);
    const frustum = (y0: number, h: number, w0: number, w1: number, color: number) => {
      const g = new THREE.CylinderGeometry((w1 / 2) * Math.SQRT2, (w0 / 2) * Math.SQRT2, h, 4, 1);
      g.rotateY(Math.PI / 4 + k.rotA);
      g.translate(x, y0 + h / 2, z);
      it.geos.push(['plain', paint(g, color)]);
    };
    // (The stone changes colour a third of the way up, like the real one.)
    frustum(Y, 30, 10.2, 9.0, 0xf6f2ea);
    frustum(Y + 30, 58, 9.0, 6.4, 0xe8e0d0);
    frustum(Y + 88, 7, 6.4, 0.2, 0xe8e0d0);
    k.solid(it, ma, mb, Y, 10.2, 95, 10.2);
    for (const glow of [Y + 86]) k.box(it, ma, mb, glow, 6.5, 0.4, 6.5, 0xd9d1c1);
    // Fifty flags round it.
    const flags = k.item(ma, mb + 1);
    for (let j = 0; j < 50; j++) {
      const ang = (j / 50) * Math.PI * 2, fa = ma + Math.cos(ang) * 27, fb = mb + Math.sin(ang) * 27;
      k.cyl(flags, fa, fb, Y, 0.07, 9, 0xe8e8e8, 5);
      k.solid(flags, fa, fb, Y, 0.2, 9, 0.2);
      const da = -Math.sin(ang) * 0.9, db = Math.cos(ang) * 0.9;
      k.box(flags, fa + da, fb + db, Y + 7.7, 1.8, 1.1, 0.04, 0xb3262e, false, 'plain', Math.atan2(db, da));
      k.box(flags, fa + da * 0.55, fb + db * 0.55, Y + 8.25, 0.8, 0.55, 0.06, 0x223a6e, false, 'plain', Math.atan2(db, da));
      k.box(flags, fa + da, fb + db, Y + 8.02, 1.8, 0.16, 0.06, 0xffffff, false, 'plain', Math.atan2(db, da));
    }
  }

  // ------------------------------------------------ the Lincoln Memorial, the reflecting pool and the round pool
  {
    const [la, lb] = P.lincoln, it = k.item(la, lb);
    k.box(it, la, lb, Y, 46, 2.4, 68, STONE, true);
    k.box(it, la, lb, Y + 2.4, 40, 2.4, 62, MARBLE2, true);
    // Steps up the front (east), wide and shallow.
    for (let j = 0; j < 8; j++) k.box(it, la + 23 + j * 1.2, lb, Y, 1.2, 4.8 - j * 0.6, 34, MARBLE2, true);
    const top = Y + 4.8;
    k.box(it, la, lb, top, 22, 13, 44, 0xcfc8ba, true); // the hall inside the columns
    for (let j = 0; j < 12; j++) {
      const b = lb - 24.2 + j * 4.4;
      for (const a of [la - 15.5, la + 15.5]) k.cyl(it, a, b, top, 0.95, 13, MARBLE, 12, 0.85);
    }
    for (let j = 1; j < 7; j++) for (const b of [lb - 24.2, lb + 24.2]) k.cyl(it, la - 15.5 + j * 4.43, b, top, 0.95, 13, MARBLE, 12, 0.85);
    k.box(it, la, lb, top + 13, 35, 3, 52, MARBLE);
    k.box(it, la, lb, top + 16, 29, 4, 46, MARBLE2);
    k.box(it, la, lb, top + 20, 30, 0.6, 47, MARBLE);
    k.solid(it, la, lb, top, 33, 20, 51);
    take(la, lb, 60, 72);
    // The long reflecting pool, and the round pool beyond it.
    const p0 = la + 40, p1 = P.monument[0] - 110;
    const pool = k.item((p0 + p1) / 2, 0);
    k.quad(pool, 'town-walk', [k.W(p0 - 3, -19), k.W(p1 + 3, -19), k.W(p1 + 3, 19), k.W(p0 - 3, 19)], Y + 0.08, 4);
    k.quad(pool, 'town-water', [k.W(p0, -15), k.W(p1, -15), k.W(p1, 15), k.W(p0, 15)], Y + 0.13, 8);
    for (const s of [-1, 1]) k.box(pool, (p0 + p1) / 2, s * 15.3, Y, p1 - p0, 0.2, 0.6, 0xbab4a6);
    for (const a of [p0, p1]) k.box(pool, a, 0, Y, 0.6, 0.2, 31, 0xbab4a6);
    const ra = p1 + 40, round = k.item(ra, 0);
    const [rx, rz] = k.W(ra, 0);
    const disc = new THREE.CircleGeometry(20, 32).rotateX(-Math.PI / 2).translate(rx, Y + 0.13, rz);
    round.geos.push(['town-water', disc]);
    k.cyl(round, ra, 0, Y, 20.6, 0.25, 0xbab4a6, 32);
    for (let j = 0; j < 12; j++) k.cyl(round, ra + Math.cos(j * 0.52) * 14, Math.sin(j * 0.52) * 14, Y, 0.25, 2.5 + (j % 2), 0xeaf4fb, 6, 0.05);
    k.cyl(round, ra, 0, Y, 0.5, 6, 0xeaf4fb, 8, 0.1);
  }

  // ------------------------------------------------ the Capitol, its great dome over the Mall
  {
    const [ca, cb] = P.capitol, it = k.item(ca, cb);
    const base = Y + 2.6;
    k.box(it, ca + 4, cb, Y, 80, 2.6, 176, STONE, true);
    for (let j = 0; j < 6; j++) k.box(it, ca - 36 - j * 1.3, cb, Y, 1.3, 2.6 - j * 0.42, 50, STONE, true);
    // The middle, and the two long wings.
    k.facade(it, ca + 4, cb, base, 44, 64, 20, 'concrete', 0xfbf8f2, 0, 0xf4f1ea, 1.75);
    for (const s of [-1, 1]) {
      k.facade(it, ca + 4, cb + s * 56, base, 34, 48, 17, 'concrete', 0xfbf8f2, 0, 0xf4f1ea, 1.75);
      k.facade(it, ca + 4, cb + s * 84, base, 40, 12, 17, 'concrete', 0xfbf8f2, 0, 0xf4f1ea, 1.75);
      // The wings' porticos, facing the Mall.
      for (let j = 0; j < 6; j++) k.cyl(it, ca - 16, cb + s * 56 - 10 + j * 4, base, 0.75, 13, MARBLE, 10, 0.68, true);
      k.box(it, ca - 16, cb + s * 56, base + 13, 6, 1.6, 24, MARBLE);
      k.gable(it, ca - 16, cb + s * 56, base + 14.6, 6, 24, 3, true, MARBLE2);
    }
    // The big portico in the middle.
    for (let j = 0; j < 8; j++) k.cyl(it, ca - 24, cb - 15.4 + j * 4.4, base, 0.9, 15, MARBLE, 12, 0.8, true);
    k.box(it, ca - 21, cb, base + 15, 12, 2, 36, MARBLE);
    k.gable(it, ca - 21, cb, base + 17, 12, 36, 4.2, true, MARBLE2);
    // The dome: a ring of columns round the drum, the dome itself, and the lantern on top.
    const d0 = base + 20;
    k.cyl(it, ca + 4, cb, d0, 19, 4, MARBLE2, 32);
    k.cyl(it, ca + 4, cb, d0 + 4, 15.5, 11, 0xe2ddd1, 32);
    for (let j = 0; j < 32; j++) {
      const ang = (j / 32) * Math.PI * 2;
      k.cyl(it, ca + 4 + Math.cos(ang) * 17.8, cb + Math.sin(ang) * 17.8, d0 + 4, 0.55, 10, MARBLE, 8);
    }
    k.cyl(it, ca + 4, cb, d0 + 14, 19.2, 1.6, MARBLE, 32);
    k.cyl(it, ca + 4, cb, d0 + 15.6, 15.8, 4.5, MARBLE2, 32);
    k.dome(it, ca + 4, cb, d0 + 20, 15.6, 0xf7f5f0, 1.2, 32);
    for (let j = 0; j < 16; j++) {
      // Ribs down the dome.
      const ang = (j / 16) * Math.PI * 2;
      for (let t = 0.1; t < 1; t += 0.1) {
        const r = 15.7 * Math.cos(t * Math.PI / 2), y = d0 + 20 + 15.6 * 1.2 * Math.sin(t * Math.PI / 2);
        k.box(it, ca + 4 + Math.cos(ang) * r, cb + Math.sin(ang) * r, y, 0.35, 1.9, 0.35, 0xd8d2c6);
      }
    }
    const l0 = d0 + 20 + 18.7;
    k.cyl(it, ca + 4, cb, l0, 3, 6, MARBLE, 12);
    for (let j = 0; j < 8; j++) k.cyl(it, ca + 4 + Math.cos(j * 0.785) * 3.2, cb + Math.sin(j * 0.785) * 3.2, l0, 0.25, 6, 0xffffff, 6);
    k.dome(it, ca + 4, cb, l0 + 6, 3.4, MARBLE2, 1.3, 12);
    k.cyl(it, ca + 4, cb, l0 + 10.3, 0.5, 4, 0x8a8f94, 8, 0.15);
    k.solid(it, ca + 4, cb, d0, 30, 40, 30);
    // A flag flying over each wing.
    for (const s of [-1, 1]) {
      k.cyl(it, ca + 4, cb + s * 56, base + 17, 0.08, 7, 0xdddddd, 6);
      k.box(it, ca + 4, cb + s * 56 + 1, base + 22.6, 0.04, 1.2, 2, 0xb3262e);
    }
    take(ca + 4, cb, 84, 180);
  }
  // Office buildings either side of the Capitol.
  for (const s of [-1, 1]) {
    const it = k.item(400, s * 240);
    k.facade(it, 400, s * 240, Y, 96, 66, 22, 'concrete', 0xf1ece2, 0, 0xe6e1d6, 1.5);
    take(400, s * 240, 100, 70);
  }

  // ------------------------------------------------ the White House, its grounds and the Ellipse
  {
    const [wa, wb] = P.whiteHouse, it = k.item(wa, wb);
    k.facade(it, wa, wb, Y, 52, 26, 15, 'concrete', 0xffffff, 0, 0xffffff, 1.9);
    k.box(it, wa, wb, Y + 15, 53, 1.2, 27, 0xffffff); // balustrade
    for (const s of [-1, 1]) k.facade(it, wa + s * 40, wb + 3, Y, 28, 14, 7, 'concrete', 0xffffff, 0, 0xffffff, 1.9);
    // South portico: a bow of columns, and the north portico with its pediment.
    for (let j = 0; j < 6; j++) {
      const ang = Math.PI * (0.12 + (0.76 * j) / 5);
      k.cyl(it, wa + Math.cos(ang) * 9, wb + 13 + Math.sin(ang) * 7, Y, 0.6, 12, MARBLE, 10, 0.55, true);
    }
    k.cyl(it, wa, wb + 13, Y + 12, 9.8, 1.4, 0xffffff, 24);
    for (let j = 0; j < 4; j++) k.cyl(it, wa - 6.6 + j * 4.4, wb - 18, Y, 0.6, 12, MARBLE, 10, 0.55, true);
    k.box(it, wa, wb - 15.5, Y + 12, 16, 1.4, 6, 0xffffff);
    k.gable(it, wa, wb - 15.5, Y + 13.4, 16, 6, 2.8, false, 0xf6f4ef);
    // The flag on the roof.
    k.cyl(it, wa, wb, Y + 16.2, 0.08, 6, 0xdddddd, 6);
    k.box(it, wa + 1.1, wb, Y + 20.8, 2, 1.2, 0.04, 0xb3262e);
    k.box(it, wa + 0.5, wb, Y + 21.1, 0.9, 0.6, 0.06, 0x223a6e);
    take(wa, wb, 115, 50);
    // Iron fence round the grounds, with the gate to the south.
    const f0 = -218, f1 = -12, g0 = -318, g1 = -200;
    const fence = (a0: number, b0: number, a1: number, b1: number) => {
      const fi = k.item((a0 + a1) / 2, (b0 + b1) / 2);
      const len = Math.hypot(a1 - a0, b1 - b0), alongA = Math.abs(a1 - a0) > 1;
      for (let s = 0; s <= len; s += 2.5) k.box(fi, a0 + ((a1 - a0) * s) / len, b0 + ((b1 - b0) * s) / len, Y, 0.12, 1.9, 0.12, 0x1c1d1f);
      for (const y of [0.15, 1.7]) k.box(fi, (a0 + a1) / 2, (b0 + b1) / 2, Y + y, alongA ? len : 0.08, 0.08, alongA ? 0.08 : len, 0x1c1d1f);
      k.solid(fi, (a0 + a1) / 2, (b0 + b1) / 2, Y, alongA ? len : 0.3, 1.9, alongA ? 0.3 : len);
    };
    fence(f0, g0, f1, g0);
    fence(f0, g0, f0, g1);
    fence(f1, g0, f1, g1);
    fence(f0, g1, wa - 9, g1);
    fence(wa + 9, g1, f1, g1);
    const drive = k.item(wa, (g1 + wb) / 2);
    k.strip(drive, 'town-walk', wa, g1 - 20, wa, wb + 20, 6, Y + 0.09, 4);
    // The Ellipse: a ring path round a big oval lawn.
    const ec = (g1 - M.z) / 2 - 2, el = k.item(wa, ec);
    for (let j = 0; j < 28; j++) {
      const t0 = (j / 28) * Math.PI * 2, t1 = ((j + 1) / 28) * Math.PI * 2;
      k.strip(el, 'town-walk', wa + Math.cos(t0) * 80, ec + Math.sin(t0) * 46, wa + Math.cos(t1) * 80, ec + Math.sin(t1) * 46, 4, Y + 0.09, 4);
    }
    for (let j = 0; j < 22; j++) {
      const t = (j / 22) * Math.PI * 2;
      k.tree(wa + Math.cos(t) * 92, ec + Math.sin(t) * 55, 'broad');
    }
    for (const [da, db] of [[-60, -40], [60, -40], [-75, 20], [75, 20], [-40, 30], [40, 30]]) k.tree(wa + da, wb + db, 'broad');
    take(wa, (g0 + M.z) / 2, 220, 260);
  }

  // ------------------------------------------------ the Jefferson Memorial on the Tidal Basin, cherry trees round it
  {
    const [ja, jb] = P.jefferson, it = k.item(ja, jb);
    k.cyl(it, ja, jb, Y, 22, 1.4, STONE, 32);
    k.cyl(it, ja, jb, Y + 1.4, 19, 1.6, MARBLE2, 32);
    k.solid(it, ja, jb, Y, 36, 3, 36);
    const top = Y + 3;
    k.cyl(it, ja, jb, top, 11.5, 12, 0xd9d3c6, 24);
    for (let j = 0; j < 22; j++) {
      const ang = (j / 22) * Math.PI * 2;
      k.cyl(it, ja + Math.cos(ang) * 16, jb + Math.sin(ang) * 16, top, 0.75, 12, MARBLE, 10, 0.68);
    }
    k.solid(it, ja, jb, top, 25, 12, 25);
    k.cyl(it, ja, jb, top + 12, 17.2, 2.2, MARBLE, 32);
    k.cyl(it, ja, jb, top + 14.2, 15, 2, MARBLE2, 32);
    k.dome(it, ja, jb, top + 16.2, 15, 0xf7f5f0, 0.7, 28);
    // Its portico faces the water.
    for (let j = 0; j < 6; j++) k.cyl(it, ja - 11 + j * 4.4, jb - 21, top, 0.75, 12, MARBLE, 10, 0.68, true);
    k.box(it, ja, jb - 19, top + 12, 26, 2, 8, MARBLE);
    k.gable(it, ja, jb - 19, top + 14, 26, 8, 4.5, true, MARBLE2);
    for (let j = 0; j < 5; j++) k.box(it, ja, jb - 24 - j * 1.1, Y, 22, 3 - j * 0.6, 1.1, MARBLE2, true);
    take(ja, jb, 48, 52);
    for (let j = 0; j < 30; j++) {
      const ang = (j / 30) * Math.PI * 2, r = basin.r + 16 + (j % 2) * 7;
      const ta = basin.x + Math.cos(ang) * r, tb = basin.z + Math.sin(ang) * r;
      if (Math.hypot(ta - ja, tb - jb) > 30 && k.clear(ta, tb, 3)) k.tree(ta, tb, 'broad');
    }
  }
  // More trees in the park round the basin.
  for (let j = 0; j < 70; j++) {
    const a = -455 + rng() * 440, b = M.z + 20 + rng() * (P.z1 - M.z - 35);
    if (Math.hypot(a - basin.x, b - basin.z) < basin.r + 26 || Math.hypot(a - P.jefferson[0], b - P.jefferson[1]) < 34) continue;
    if (k.clear(a, b, 4)) k.tree(a, b, 'broad');
  }

  // ------------------------------------------------ the museums along the Mall
  // The Smithsonian Castle: red sandstone towers and turrets.
  {
    const a = 92, b = 128, it = k.item(a, b), RED = 0xa65445;
    k.facade(it, a, b, Y, 72, 18, 12, 'brownstone', 0xc0705c, 0, 0x8a3e31);
    k.gable(it, a, b, Y + 12, 72, 18, 5, true, 0x5a4a44);
    const tower = (ta: number, tb: number, w: number, h: number, roof: number) => {
      k.box(it, ta, tb, Y, w, h, w, RED, true);
      for (let j = 0; j < 4; j++) k.box(it, ta + ((j % 2) * 2 - 1) * (w / 2 - 0.4), tb + ((j >> 1) * 2 - 1) * (w / 2 - 0.4), Y + h, 0.9, 1.2, 0.9, RED);
      const [x, z] = k.W(ta, tb);
      const g = new THREE.ConeGeometry((w / 2) * Math.SQRT2 * 0.9, roof, 4);
      g.rotateY(Math.PI / 4 + k.rotA);
      g.translate(x, Y + h + roof / 2, z);
      it.geos.push(['plain', paint(g, 0x4a3e3a)]);
    };
    tower(a - 38, b, 11, 22, 8);
    tower(a + 38, b + 2, 9, 18, 6);
    tower(a - 8, b - 10, 9, 28, 9);
    tower(a + 10, b - 9, 6, 20, 5);
    tower(a + 24, b + 9, 7, 16, 5);
    k.board(it, ['SMITHSONIAN'], '#f2e6d0', '#6b2a20', a, b - 9.4, Y + 6, 16, 2.4, Math.PI);
    take(a, b, 86, 34);
  }
  // The Air and Space Museum: marble blocks and glass halls, a moon rocket standing outside.
  {
    const a = 255, b = 127, it = k.item(a, b);
    for (let j = 0; j < 7; j++) {
      const ja = a - 54 + j * 18;
      if (j % 2) k.facade(it, ja, b, Y, 18, 34, 19, 'glass', 0xdfe8f0, 0, 0xc8ccd0);
      else k.facade(it, ja, b, Y, 18, 40, 22, 'stone', 0xe3d3c2, 0, 0xd6c6b4);
    }
    k.board(it, ['NATIONAL AIR AND SPACE MUSEUM'], '#d6c6b4', '#2b2b2b', a, b - 20.3, Y + 15, 40, 2.6, Math.PI, 'bold {s}px Helvetica, Arial, sans-serif');
    take(a, b, 130, 44);
    rocket(k, 302, 172);
    take(302, 172, 14, 14);
  }
  // Natural History (a dome over its portico) and the National Gallery.
  {
    const a = 90, b = -122, it = k.item(a, b);
    k.facade(it, a, b, Y, 90, 44, 20, 'stone', 0xece6da);
    k.cyl(it, a, b, Y + 20, 11, 6, MARBLE2, 24);
    k.dome(it, a, b, Y + 26, 11, 0xe8e3d8, 0.8, 24);
    for (let j = 0; j < 6; j++) k.cyl(it, a - 11 + j * 4.4, b + 25, Y, 0.8, 16, MARBLE, 10, 0.72, true);
    k.box(it, a, b + 24, Y + 16, 26, 1.6, 6, MARBLE);
    k.gable(it, a, b + 24, Y + 17.6, 26, 6, 3.6, false, MARBLE2);
    k.board(it, ['NATURAL HISTORY'], '#ece6da', '#3a3530', a, b + 22.2, Y + 20.4, 14, 2, 0);
    take(a, b, 94, 56);
  }
  {
    const a = 235, b = -106, it = k.item(a, b);
    k.facade(it, a, b, Y, 80, 30, 16, 'stone', 0xeadfd2);
    k.cyl(it, a, b, Y + 16, 7, 4, MARBLE2, 20);
    k.dome(it, a, b, Y + 20, 7, 0xe2dbcf, 0.75, 20);
    for (let j = 0; j < 4; j++) k.cyl(it, a - 6.6 + j * 4.4, b + 18, Y, 0.7, 13, MARBLE, 10, 0.64, true);
    k.box(it, a, b + 17, Y + 13, 18, 1.4, 5, MARBLE);
    k.gable(it, a, b + 17, Y + 14.4, 18, 5, 3, false, MARBLE2);
    k.board(it, ['NATIONAL GALLERY OF ART'], '#eadfd2', '#3a3530', a, b + 15.2, Y + 16.2, 18, 1.6, 0, 'bold {s}px Georgia, serif');
    take(a, b, 84, 42);
  }

  // ------------------------------------------------ stone office blocks along the other streets
  // Not on the Mall, round the White House, in the park by the basin or on Capitol Hill.
  const parkland = (a: number, b: number) =>
    (b > -M.z - 12 && b < M.z + 12) || (a < -228 && a > -472 && b > M.z) || (a > -232 && a < 2 && b < -M.z) || (a < 2 && b > M.z) || a > M.x1 - 4;
  const styles: [WindowStyle, number, number][] = [['stone', 0xf4efe4, 1.15], ['concrete', 0xf2ede2, 1.5], ['stone', 0xfaf7f0, 1.2], ['concrete', 0xe8e4dc, 1.3], ['stone', 0xd9cfbd, 1], ['brick', 0xd8b8a0, 1]];
  const placed: Rect[] = [];
  for (const r of k.t.roads) {
    if (r.from >= 0) continue; // (not the roads in from the highways)
    for (let i = 0; i < r.pts.length - 1; i++) {
      const p = k.coords(...r.pts[i]), q = k.coords(...r.pts[i + 1]);
      const len = Math.hypot(q.a - p.a, q.b - p.b), ua = (q.a - p.a) / len, ub = (q.b - p.b) / len;
      const phi = Math.atan2(ub, ua);
      for (const side of [-1, 1]) {
        let s = rng() * 4;
        while (s < len) {
          const w = 18 + rng() * 16, d = 16 + rng() * 10;
          const off = r.hw + 3.7 + 1.2 + d / 2;
          const a = p.a + ua * (s + w / 2) - ub * side * off, b = p.b + ub * (s + w / 2) + ua * side * off;
          s += w + 1 + rng() * 3;
          const rect: Rect = { cx: a, cz: b, hw: w / 2, hd: d / 2, rot: -phi };
          let ok = !placed.some((o) => rectsOverlap(rect, o, 1.5)) && !taken.some((o) => rectsOverlap(rect, o, 3));
          if (ok)
            for (const [da, db] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, 1], [0, -1]]) {
              const pa = a + (ua * da * w) / 2 - (ub * db * d) / 2, pb = b + (ub * da * w) / 2 + (ua * db * d) / 2;
              if (parkland(pa, pb) || !k.clear(pa, pb, 2) || pa < P.x0 + 6 || pa > P.x1 - 6 || pb < P.z0 + 6 || pb > P.z1 - 6) ok = false;
            }
          if (!ok) continue;
          placed.push(rect);
          const [style, tint, bright] = styles[Math.floor(rng() * styles.length)];
          const it = k.item(a, b);
          k.facade(it, a, b, Y, w, d, 15 + rng() * 18, style, tint, phi, 0xe6e1d6, bright);
        }
      }
    }
  }

  // ------------------------------------------------ street trees, and welcome signs on the roads in
  for (const r of k.t.roads) {
    if (r.from >= 0 || r.look === 'avenue') continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const p = k.coords(...r.pts[i]), q = k.coords(...r.pts[i + 1]);
      const len = Math.hypot(q.a - p.a, q.b - p.b), ua = (q.a - p.a) / len, ub = (q.b - p.b) / len;
      for (let s = 12; s < len; s += 24)
        for (const side of [-1, 1]) {
          const a = p.a + ua * s - ub * side * (r.hw + 2), b = p.b + ub * s + ua * side * (r.hw + 2);
          if (k.clear(a, b, 1.2) && rng() < 0.6) k.tree(a, b, 'broad');
        }
    }
  }
  for (const r of k.t.roads) {
    if (r.from < 0 || r.pts.length < 3) continue;
    const end = k.coords(...r.pts[r.pts.length - 1]), prev = k.coords(...r.pts[r.pts.length - 4]);
    const da = end.a - prev.a, db = end.b - prev.b, l = Math.hypot(da, db);
    // Outside town, to the right of the road coming in.
    const a = end.a - (da / l) * 40 - (db / l) * (TOWN_HW + 8), b = end.b - (db / l) * 40 + (da / l) * (TOWN_HW + 8);
    if (placed.some((o) => Math.hypot(o.cx - a, o.cz - b) < 12)) continue;
    const it = k.item(a, b);
    k.box(it, a, b, Y, 7, 1.2, 1.2, STONE, true, 'plain', Math.atan2(db, da) + Math.PI / 2);
    k.board(it, ['WASHINGTON', 'D.C.'], '#f4f1ea', '#1f2f4f', a, b, Y + 1.2, 6.4, 2.4, Math.atan2(db, da) + Math.PI / 2, 'bold {s}px Georgia, "Times New Roman", serif');
  }
}

/** A Saturn-V-style moon rocket standing on its tail fins. */
function rocket(k: TownKit, a: number, b: number) {
  const it = k.item(a, b), Y = k.Y;
  k.box(it, a, b, Y, 12, 1, 12, 0x8d9196);
  const stage = (y: number, h: number, r: number, color: number, rTop = r) => k.cyl(it, a, b, y, r, h, color, 20, rTop);
  stage(Y + 1, 26, 3.4, 0xf4f4f2);
  for (const y of [Y + 5, Y + 20]) stage(y, 2.2, 3.45, 0x1b1b1b);
  stage(Y + 27, 2, 3.4, 0x1b1b1b, 2.8);
  stage(Y + 29, 14, 2.8, 0xf4f4f2);
  stage(Y + 43, 1.5, 2.8, 0x1b1b1b, 2.2);
  stage(Y + 44.5, 8, 2.2, 0xf4f4f2);
  stage(Y + 52.5, 4, 2.2, 0xd8d8d8, 0.9);
  stage(Y + 56.5, 4, 0.12, 0xb3261e, 0.08);
  for (let j = 0; j < 4; j++) {
    const ang = (j / 4) * Math.PI * 2 + Math.PI / 4;
    k.box(it, a + Math.cos(ang) * 4, b + Math.sin(ang) * 4, Y + 1, 2.4, 6, 0.3, 0x1b1b1b, false, 'plain', ang);
    k.cyl(it, a + Math.cos(ang) * 1.9, b + Math.sin(ang) * 1.9, Y + 1, 1.0, 1.6, 0x3a3a3a, 10, 0.7);
  }
  k.solid(it, a, b, Y, 7, 60, 7);
}

