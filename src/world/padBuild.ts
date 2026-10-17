// The rocket launch pads, built (where they are and their roads: outer.ts:makePad): a
// concrete apron with the launch mount in the middle, the red service tower beside it
// with its swing arm reaching to the rocket, lightning masts, the round fuel tanks, the
// water tower, the launch control bunker, floodlights, and in front of the rocket the
// glowing boarding circle where you drive in to fly to space. The rocket itself is
// added by the game (it flies off), standing on the mount at (0, 0).
import { PAD } from './outer';
import * as THREE from 'three';
import { paint } from '../vehicles/builders/geo';
import type { TownKit } from './townKit';

/** Height of the launch mount the rocket stands on. */
export const MOUNT_H = 4;

export function buildPad(k: TownKit) {
  const Y = k.Y, H = PAD.half;
  // ------------------------------------------------ ground: concrete everywhere, junctions
  k.flat('town-walk', -H, H, -H, H, Y + 0.06, 5, 60);
  k.junctions(false);

  // ------------------------------------------------ the launch mount, with the flame trench under it
  const mount = k.item(0, 0);
  k.box(mount, 0, 0, Y, 18, MOUNT_H, 18, 0x9c9a94, true);
  k.box(mount, 0, 0, Y + MOUNT_H, 12, 0.3, 12, 0x6e6c68);
  for (const s of [-1, 1]) {
    // The trench mouths, scorched black, either side (along a).
    k.box(mount, s * 9.2, 0, Y, 0.4, MOUNT_H - 0.6, 10, 0x1c1b1a);
    k.box(mount, s * 16, 0, Y + 0.05, 14, 0.12, 12, 0x34312d);
  }
  // Hold-down posts round the rocket.
  for (let i = 0; i < 4; i++) {
    const ang = i * 1.5708 + 0.785;
    k.box(mount, Math.cos(ang) * 5.4, Math.sin(ang) * 5.4, Y + MOUNT_H, 1.1, 1.6, 1.1, 0x55585c);
  }
  // The rocket's own collider (it stands on the mount; boosters either side along a).
  k.solid(mount, 0, 0, Y + MOUNT_H, 7, 44, 7);
  k.solid(mount, 0, 0, Y + MOUNT_H, 12.4, 22, 3);

  // ------------------------------------------------ the service tower, with its swing arm to the rocket
  const TA = 17, TH = 54;
  const tower = k.item(TA, 0);
  for (const [da, db] of [[-2.6, -2.6], [2.6, -2.6], [2.6, 2.6], [-2.6, 2.6]]) k.box(tower, TA + da, db, Y, 0.7, TH, 0.7, 0xc0392b);
  for (let y = 4; y < TH; y += 4.5) {
    for (const db of [-2.6, 2.6]) k.box(tower, TA, db, Y + y, 5.9, 0.35, 0.35, 0xc0392b);
    for (const da of [-2.6, 2.6]) k.box(tower, TA + da, 0, Y + y, 0.35, 0.35, 5.9, 0xc0392b);
  }
  for (const y of [14, 28, 42]) k.box(tower, TA, 0, Y + y - 0.2, 6.4, 0.3, 6.4, 0x8a8e94);
  k.box(tower, TA, 0, Y + TH, 7, 0.6, 7, 0x8a8e94);
  // The crane on top, and the lightning rod.
  k.box(tower, TA + 3, 0, Y + TH + 0.6, 14, 0.8, 0.8, 0xe2b13c);
  k.cyl(tower, TA, 0, Y + TH + 0.6, 0.15, 12, 0xd0d4d8, 6);
  // Swing arms: the crew arm near the top, a fuel arm lower down.
  for (const [y, w] of [[34.5, 1.8], [22, 1.1]] as const) {
    k.box(tower, (TA + 3.4) / 2 + 0.8, 0, Y + MOUNT_H + y, TA - 3.4 - 1.6, w, w, 0x8a8e94);
    k.box(tower, 4.6, 0, Y + MOUNT_H + y, 1.4, w + 0.6, w + 0.6, 0xe9e9e4);
  }
  k.solid(tower, TA, 0, Y, 6.4, TH, 6.4);

  // ------------------------------------------------ lightning masts round the pad
  for (const [a, b] of [[-62, 40], [62, 40], [-50, -70], [50, -70]] as const) {
    const it = k.item(a, b);
    k.cyl(it, a, b, Y, 0.6, 62, 0xd9d6cf, 8, 0.35, true);
    k.cyl(it, a, b, Y + 62, 0.12, 8, 0x8a8e94, 5);
    for (const y of [20, 40]) k.box(it, a, b, Y + y, 0.2, 0.6, 0.2, 0xd22a22);
  }

  // ------------------------------------------------ fuel tanks: big white balls on legs
  for (const [a, b, color] of [[-78, 70, 0xf4f4f0], [78, 70, 0xf4f4f0], [-95, 30, 0xd8e6f0]] as const) {
    const it = k.item(a, b);
    const r = 8;
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      k.cyl(it, a + Math.cos(ang) * r * 0.8, b + Math.sin(ang) * r * 0.8, Y, 0.35, r + 2, 0x8a8e94, 6);
    }
    const [x, z] = k.W(a, b);
    const g = new THREE.SphereGeometry(r, 20, 14);
    g.translate(x, Y + r + 4, z);
    it.geos.push(['plain', paint(g, (_x, y) => (Math.abs(y - (Y + r + 4)) < 0.4 ? 0x2e64b4 : color))]);
    k.solid(it, a, b, Y, r * 1.6, r * 2 + 4, r * 1.6);
  }

  // ------------------------------------------------ the water tower (water floods the pad at liftoff)
  {
    const a = -96, b = -40, it = k.item(a, b);
    for (const [da, db] of [[-3.5, -3.5], [3.5, -3.5], [3.5, 3.5], [-3.5, 3.5]]) k.cyl(it, a + da, b + db, Y, 0.35, 34, 0x8a8e94, 6);
    k.cyl(it, a, b, Y + 33, 6, 9, 0xeef1f2, 18, 6, true);
    k.cyl(it, a, b, Y + 42, 6, 3, 0xeef1f2, 18, 0.5);
    k.solid(it, a, b, Y, 8, 34, 8);
  }

  // ------------------------------------------------ launch control: a low bunker with a sign
  {
    const a = 88, b = -78, it = k.item(a, b);
    k.box(it, a, b, Y, 26, 6, 14, 0xb9b6ae, true);
    k.box(it, a, b, Y + 6, 27, 0.6, 15, 0x8d8a83);
    k.box(it, a, b - 7.05, Y + 2, 18, 1.6, 0.1, 0x1e3448);
    for (const da of [-8, 8]) k.cyl(it, a + da, b, Y + 6.6, 0.12, 5, 0xd0d4d8, 5);
    k.cyl(it, a + 6, b + 2, Y + 6.6, 1.6, 0.4, 0xeeeeee, 14, 1.6);
    k.board(it, ['LAUNCH CONTROL'], '#1e3448', '#f2f4f6', a, b - 7.2, Y + 6.9, 12, 2.2, 0, 'bold {s}px Helvetica, Arial, sans-serif');
  }

  // ------------------------------------------------ floodlights at the corners of the apron
  for (const [a, b] of [[-108, -108], [108, -108], [-108, 108], [108, 108]] as const) {
    const it = k.item(a, b);
    k.cyl(it, a, b, Y, 0.3, 24, 0x8d9196, 6, 0.2, true);
    k.box(it, a, b, Y + 24, 4, 2.2, 0.6, 0x55585c);
    k.box(it, a, b - Math.sign(b) * 0.35, Y + 24.1, 3.6, 1.8, 0.1, 0xfff6d8, false, 'neon');
  }

  // ------------------------------------------------ the boarding circle in front of the rocket
  {
    const { a, b, r } = PAD.board, it = k.item(a, b);
    const [x, z] = k.W(a, b);
    const ring = new THREE.RingGeometry(r - 0.8, r, 40);
    ring.rotateX(-Math.PI / 2);
    ring.translate(x, Y + 0.14, z);
    it.geos.push(['neon', paint(ring, 0x46e0ff)]);
    const inner = new THREE.RingGeometry(r - 2.4, r - 2.0, 40);
    inner.rotateX(-Math.PI / 2);
    inner.translate(x, Y + 0.14, z);
    it.geos.push(['neon', paint(inner, 0x2a9fd0)]);
    // Chevrons leading in from the road, pointing at the rocket.
    for (const db of [-15, -12.5, -10]) {
      for (const s of [-1, 1]) k.box(it, a + s * 1.3, b + db, Y + 0.08, 2.8, 0.08, 0.6, 0xffd23a, false, 'neon', s * 0.6);
    }
    // A sign beside it, readable from the road in.
    for (const s of [-1, 1]) k.cyl(it, a + s * 13 - 3, b - 4, Y, 0.12, 4.2, 0x2a2d31, 6);
    k.board(it, ['🚀 FLY TO SPACE!', 'drive in here'], '#14233a', '#ffd23a', a - 13, b - 4, Y + 3.2, 7.5, 2.6, 0, 'bold {s}px Helvetica, Arial, sans-serif');
  }

  // ------------------------------------------------ the name, big, at the road in
  {
    const it = k.item(0, -H + 12);
    for (const s of [-1, 1]) {
      const a = s * 17;
      k.box(it, a, -H + 12, Y, 0.5, 5.5, 0.5, 0x2a2d31);
      k.box(it, a + s * 6.6, -H + 12, Y, 0.5, 5.5, 0.5, 0x2a2d31);
      k.board(it, [k.t.name.toUpperCase()], '#ffffff', '#123a7a', a + s * 3.3, -H + 12, Y + 3, 8.4, 2.6, 0, 'bold {s}px Helvetica, Arial, sans-serif');
    }
  }
}
