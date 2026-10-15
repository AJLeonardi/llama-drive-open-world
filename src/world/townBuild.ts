// Mariano-ville, built: a little New England town centre in the autumn woods (where it
// sits and its road are in outer.ts:TOWN). Main Street runs in front of the town green,
// with a row of clapboard shops on one side; across it is the green with its gazebo,
// paths and maples, a white church with a tall steeple at its head, the town hall and
// the general store on its corners, and houses down its sides. Carved welcome signs
// stand where the road comes into town.
//
// Everything is given in town coordinates: `a` along the highway, `b` away from it.
import * as THREE from 'three';
import { TOWN, TOWN_HW, MAIN_ST, Solid, townPoint } from './outer';
import { buildingGeometry } from './buildings';
import { box, cyl, paint } from '../vehicles/builders/geo';
import { textPanel, twoSidedSign } from './landmarks';
import { mulberry32 } from '../util/math';
import { sidewalkTexture } from '../util/textures';

/** One piece of the town: what to draw (by material), what's solid, and loose objects (signs). */
export interface TownItem {
  x: number;
  z: number;
  geos: [string, THREE.BufferGeometry][];
  solids: Solid[];
  objects: THREE.Object3D[];
}

const SIDINGS = { white: 0xf3f1ea, red: 0x9e3a2c, mustard: 0xd9a63e, blue: 0x7f93a3, sage: 0x95a585, cream: 0xe9dcb8, grey: 0xb9b8b2 } as const;
type Siding = keyof typeof SIDINGS;
/** Siding texture repeat: one window per 4 m, one storey per 3.4 m. */
const SIDING_U = 4, SIDING_V = 3.4;

/** Clapboard in one colour, with a white-trimmed six-over-six window and black shutters. */
function sidingTexture(color: number) {
  const W = 256, H = 218;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const col = new THREE.Color(color);
  const css = (k: number) => `rgb(${Math.round(Math.min(1, col.r * k) * 255)},${Math.round(Math.min(1, col.g * k) * 255)},${Math.round(Math.min(1, col.b * k) * 255)})`;
  g.fillStyle = css(1);
  g.fillRect(0, 0, W, H);
  // Overlapping boards: a shadow line under each.
  const board = H / 17;
  for (let i = 0; i < 17; i++) {
    const y = i * board;
    g.fillStyle = css(0.78);
    g.fillRect(0, y + board - 2, W, 2);
    g.fillStyle = css(1.06);
    g.fillRect(0, y, W, 1.5);
  }
  // Window (1.0 × 1.6 m, sill 0.85 m up), trim, shutters.
  const px = W / SIDING_U, py = H / SIDING_V;
  const wx = W / 2 - 0.5 * px, wy = H - (0.85 + 1.6) * py, ww = px, wh = 1.6 * py;
  g.fillStyle = '#1d2228';
  for (const sx of [wx - 0.46 * px, wx + ww + 0.06 * px]) {
    g.fillRect(sx, wy, 0.4 * px, wh);
    g.fillStyle = '#2b3138';
    for (let k = 1; k < 8; k++) g.fillRect(sx + 3, wy + (k * wh) / 8, 0.4 * px - 6, 2);
    g.fillStyle = '#1d2228';
  }
  g.fillStyle = '#f7f6f2';
  g.fillRect(wx - 6, wy - 8, ww + 12, wh + 16);
  const glass = g.createLinearGradient(0, wy, 0, wy + wh);
  glass.addColorStop(0, '#5d7286');
  glass.addColorStop(1, '#27323d');
  g.fillStyle = glass;
  g.fillRect(wx, wy, ww, wh);
  g.fillStyle = '#f7f6f2';
  g.fillRect(wx, wy + wh / 2 - 2, ww, 4);
  for (const f of [1 / 3, 2 / 3]) g.fillRect(wx + ww * f - 1.5, wy, 3, wh);
  for (const f of [1 / 3, 2 / 3]) {
    g.fillRect(wx, wy + (wh / 2) * f - 1.5, ww, 3);
    g.fillRect(wx, wy + wh / 2 + (wh / 2) * f - 1.5, ww, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** The welcome sign's board: carved and gilded letters on deep green, with a scalloped top. */
function welcomeTexture() {
  const W = 512, H = 300;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const shape = (inset: number) => {
    g.beginPath();
    g.moveTo(inset, 70 + inset);
    g.quadraticCurveTo(W / 2, -40 + inset * 1.6, W - inset, 70 + inset);
    g.lineTo(W - inset, H - inset);
    g.lineTo(inset, H - inset);
    g.closePath();
  };
  g.fillStyle = '#f4efe2';
  shape(0);
  g.fill();
  g.fillStyle = '#1f4d36';
  shape(14);
  g.fill();
  g.strokeStyle = '#d8b25a';
  g.lineWidth = 5;
  shape(24);
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const gold = (text: string, y: number, size: number, italic = false) => {
    g.font = `${italic ? 'italic ' : ''}bold ${size}px Georgia, 'Times New Roman', serif`;
    g.fillStyle = '#10251a';
    g.fillText(text, W / 2 + 2, y + 3, W - 70);
    const grd = g.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    grd.addColorStop(0, '#fbe7a3');
    grd.addColorStop(0.55, '#d4a443');
    grd.addColorStop(1, '#a87b26');
    g.fillStyle = grd;
    g.fillText(text, W / 2, y, W - 70);
  };
  gold('Welcome to', 98, 40, true);
  gold('Mariano-ville', 168, 70);
  g.fillStyle = '#d8b25a';
  g.fillRect(W / 2 - 110, 212, 220, 3);
  gold('Est. 1789', 248, 32, true);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Extra materials the town needs (merged into the world's materials). */
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
  return out;
}

let cache: TownItem[] | null = null;

/** Every piece of the town (built once; callers get copies of the geometry). */
export function townItems(where: (x: number, z: number) => boolean = () => true): TownItem[] {
  if (!TOWN) return [];
  if (cache) return cache.filter((it) => where(it.x, it.z)).map((it) => ({ ...it, geos: it.geos.map(([k, g]) => [k, g.clone()] as [string, THREE.BufferGeometry]) }));
  const T = TOWN;
  const Y = T.level;
  const items: TownItem[] = [];
  const W = (a: number, b: number) => townPoint(T, a, b);
  // Rotation that lines a box's local x up with the highway (a), its z with b.
  const rotA = Math.atan2(-T.uz, T.ux);
  const item = (a: number, b: number): TownItem => {
    const [x, z] = W(a, b);
    const it: TownItem = { x, z, geos: [], solids: [], objects: [] };
    items.push(it);
    return it;
  };
  /** A box in town coordinates: centre (a, b), bottom at y, sizes along a, up, along b. */
  const tbox = (it: TownItem, a: number, b: number, y: number, sa: number, sy: number, sb: number, color: number, solid = false, key = 'plain') => {
    const [x, z] = W(a, b);
    it.geos.push([key, box({ at: [x, y + sy / 2, z], size: [sa, sy, sb], rot: [0, rotA, 0], color, seg: 100 })]);
    if (solid) it.solids.push({ at: [x, y + sy / 2, z], size: [sa, sy, sb], heading: rotA, kind: 'building', color });
  };
  /** Clapboard walls (windows from the siding texture), solid. */
  const walls = (it: TownItem, a: number, b: number, y: number, sa: number, sb: number, h: number, siding: Siding) => {
    const [x, z] = W(a, b);
    it.geos.push([`siding-${siding}`, buildingGeometry({ cx: x, cz: z, hw: sa / 2, hd: sb / 2, rot: rotA }, y, h, 0xffffff, SIDING_U, SIDING_V, false, null)]);
    it.solids.push({ at: [x, y + h / 2, z], size: [sa, h, sb], heading: rotA, kind: 'building', color: SIDINGS[siding] });
  };
  /** A pitched roof over a box, its ridge running along a (or along b), overhanging a little. */
  const gable = (it: TownItem, a: number, b: number, y: number, sa: number, sb: number, h: number, alongA: boolean, color: number) => {
    const o = 0.5;
    const ha = sa / 2 + o, hb = sb / 2 + o;
    const P = (da: number, db: number, dy: number) => {
      const [x, z] = W(a + da, b + db);
      return new THREE.Vector3(x, y + dy, z);
    };
    const tri: THREE.Vector3[] = [];
    if (alongA) {
      const r0 = P(-ha, 0, h), r1 = P(ha, 0, h);
      for (const s of [-1, 1]) {
        const e0 = P(-ha, s * hb, 0), e1 = P(ha, s * hb, 0);
        tri.push(e0, e1, r1, e0, r1, r0);
      }
      for (const s of [-1, 1]) tri.push(P(s * ha, -hb, 0), P(s * ha, hb, 0), P(s * ha, 0, h));
    } else {
      const r0 = P(0, -hb, h), r1 = P(0, hb, h);
      for (const s of [-1, 1]) {
        const e0 = P(s * ha, -hb, 0), e1 = P(s * ha, hb, 0);
        tri.push(e0, e1, r1, e0, r1, r0);
      }
      for (const s of [-1, 1]) tri.push(P(-ha, s * hb, 0), P(ha, s * hb, 0), P(0, s * hb, h));
    }
    // Both windings (so it's closed from any side, whichever way the town faces).
    const pos: number[] = [];
    for (let i = 0; i < tri.length; i += 3) {
      for (const v of [tri[i], tri[i + 1], tri[i + 2]]) pos.push(v.x, v.y, v.z);
      for (const v of [tri[i], tri[i + 2], tri[i + 1]]) pos.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    it.geos.push(['plain', paint(g, color)]);
  };
  const solidCyl = (it: TownItem, a: number, b: number, y: number, r: number, h: number, color: number, segments = 10, rTop = r) => {
    const [x, z] = W(a, b);
    it.geos.push(['plain', cyl({ at: [x, y + h / 2, z], radius: r, radiusTop: rTop, length: h, axis: 'y', segments, color })]);
  };
  /** Turn an object to face a spot in town (its +z towards it), staying upright. */
  const look = (o: THREE.Object3D, a: number, b: number) => {
    const [x, z] = W(a, b);
    o.lookAt(x, o.position.y, z);
  };
  const flat = (it: TownItem, key: string, a0: number, a1: number, b0: number, b1: number, y: number, uvScale: number) => {
    const c = [W(a0, b0), W(a1, b0), W(a1, b1), W(a0, b1)];
    const pos: number[] = [], uv: number[] = [];
    // Facing up whichever way round the corners go.
    const cross = (c[1][0] - c[0][0]) * (c[2][1] - c[0][1]) - (c[1][1] - c[0][1]) * (c[2][0] - c[0][0]);
    const order = cross < 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const k of order) {
      pos.push(c[k][0], y, c[k][1]);
      uv.push(c[k][0] / uvScale, c[k][1] / uvScale);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    it.geos.push([key, g]);
  };

  // ------------------------------------------------ Main Street: sidewalks and lamps
  const MAIN_HALF = 230;
  const street = item(0, MAIN_ST);
  for (const s of [-1, 1]) flat(street, 'town-walk', -MAIN_HALF, MAIN_HALF, MAIN_ST + s * (TOWN_HW + 0.2), MAIN_ST + s * (TOWN_HW + 4.5), Y + 0.1, 4);
  for (let a = -210; a <= 210; a += 35)
    for (const s of [-1, 1]) {
      const lamp = item(a, MAIN_ST + s * (TOWN_HW + 3.6));
      const b = MAIN_ST + s * (TOWN_HW + 3.6);
      solidCyl(lamp, a, b, Y, 0.09, 4.2, 0x1b1d1f, 6);
      tbox(lamp, a, b, Y + 4.1, 0.55, 0.75, 0.55, 0x1b1d1f);
      tbox(lamp, a, b, Y + 4.2, 0.42, 0.55, 0.42, 0xffe2a6);
      tbox(lamp, a, b, Y + 4.85, 0.7, 0.12, 0.7, 0x1b1d1f);
      lamp.solids.push({ at: [lamp.x, Y + 2.1, lamp.z], size: [0.25, 4.2, 0.25], heading: rotA, kind: 'building', color: 0x1b1d1f });
    }

  // ------------------------------------------------ shops along the highway side of Main Street
  const rng = mulberry32(1789);
  const shopColors: Siding[] = ['white', 'red', 'mustard', 'blue', 'sage', 'cream', 'white', 'grey', 'red', 'cream', 'blue', 'white'];
  const front = MAIN_ST - TOWN_HW - 4.8;
  [-205, -170, -135, -100, -65, -30, 30, 65, 100, 135, 170, 205].forEach((a, i) => {
    const w = 22 + rng() * 6, d = 16, b = front - d / 2;
    const it = item(a, b);
    const h = 3.6 + 3.4 * (rng() < 0.7 ? 1 : 2);
    // Storefront on the ground floor (facing Main Street), clapboard above.
    const [x, z] = W(a, b);
    it.geos.push(['store', buildingGeometry({ cx: x, cz: z, hw: w / 2 + 0.05, hd: d / 2 + 0.05, rot: rotA }, Y - 0.2, 3.8, 0xffffff, 8, 4.6, false, null)]);
    walls(it, a, b, Y + 3.6, w, d, h - 3.6, shopColors[i]);
    it.solids.push({ at: [x, Y + 1.8, z], size: [w, 3.6, d], heading: rotA, kind: 'building', color: 0xffffff });
    tbox(it, a, b, Y + 3.5, w + 0.6, 0.3, d + 0.6, 0xf2efe6);
    gable(it, a, b, Y + h, w, d, 4 + rng() * 1.5, false, rng() < 0.5 ? 0x3f4349 : 0x5b4033);
    // Striped awning over the shop window.
    const awning = [0x2f6b45, 0x9e2f2a, 0x284b74, 0x7a5a2e][i % 4];
    tbox(it, a, front + 1.1, Y + 3.1, w * 0.8, 0.12, 2.2, awning);
    // A chimney.
    tbox(it, a + w * 0.3, b - 2, Y + h + 1, 1.2, 4, 1.2, 0x8a3b2b);
  });

  // ------------------------------------------------ the town green
  const G0 = MAIN_ST + TOWN_HW + 6, G1 = G0 + 100, GA = 115;
  const green = item(0, (G0 + G1) / 2);
  flat(green, 'town-lawn', -GA, GA, G0, G1, Y + 0.06, 6);
  // Paths: across, along, and corner to corner (long thin strips).
  const path = (a0: number, b0: number, a1: number, b1: number, w = 3.4) => {
    const len = Math.hypot(a1 - a0, b1 - b0), na = -(b1 - b0) / len * (w / 2), nb = (a1 - a0) / len * (w / 2);
    const c = [W(a0 + na, b0 + nb), W(a1 + na, b1 + nb), W(a1 - na, b1 - nb), W(a0 - na, b0 - nb)];
    const pos: number[] = [], uv: number[] = [];
    const cross = (c[1][0] - c[0][0]) * (c[2][1] - c[0][1]) - (c[1][1] - c[0][1]) * (c[2][0] - c[0][0]);
    for (const k of cross < 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
      pos.push(c[k][0], Y + 0.09, c[k][1]);
      uv.push(c[k][0] / 4, c[k][1] / 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    green.geos.push(['town-walk', g]);
  };
  const gc = (G0 + G1) / 2;
  path(-GA, gc, GA, gc);
  path(0, G0, 0, G1);
  path(-GA + 4, G0 + 4, GA - 4, G1 - 4);
  path(-GA + 4, G1 - 4, GA - 4, G0 + 4);
  // White picket fence round it (gaps where the paths come out).
  const fence = (a0: number, b0: number, a1: number, b1: number) => {
    const len = Math.hypot(a1 - a0, b1 - b0), n = Math.round(len / 2.4);
    const it = item((a0 + a1) / 2, (b0 + b1) / 2);
    const alongA = Math.abs(a1 - a0) > Math.abs(b1 - b0);
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n, b = b0 + ((b1 - b0) * i) / n;
      if (Math.abs(a) < 4 || Math.abs(b - gc) < 4) continue;
      tbox(it, a, b, Y, 0.14, 1.05, 0.14, 0xffffff);
      if (i < n) {
        // The pickets between posts, as one panel (it reads as pickets from the road).
        const ma = a + (a1 - a0) / n / 2, mb = b + (b1 - b0) / n / 2;
        tbox(it, ma, mb, Y + 0.1, alongA ? 2.3 : 0.06, 0.85, alongA ? 0.06 : 2.3, 0xf6f6f2);
        tbox(it, ma, mb, Y + 0.75, alongA ? 2.4 : 0.1, 0.08, alongA ? 0.1 : 2.4, 0xffffff);
      }
    }
  };
  fence(-GA, G0, GA, G0);
  fence(-GA, G1, GA, G1);
  fence(-GA, G0, -GA, G1);
  fence(GA, G0, GA, G1);
  // The gazebo (bandstand) in the middle: an eight-sided platform, posts and a pointed roof.
  {
    const it = item(0, gc);
    solidCyl(it, 0, gc, Y, 5, 0.9, 0xece9e1, 8);
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const [pa, pb] = [Math.cos(ang) * 4.5, gc + Math.sin(ang) * 4.5];
      solidCyl(it, pa, pb, Y + 0.9, 0.16, 3.2, 0xffffff, 6);
      // Railing between posts.
      const ang2 = ang + Math.PI / 4;
      const [qa, qb] = [Math.cos(ang2) * 4.5, gc + Math.sin(ang2) * 4.5];
      if (k !== 2) {
        const ma = (pa + qa) / 2, mb = (pb + qb) / 2;
        const [x, z] = W(ma, mb), [x0, z0] = W(pa, pb), [x1, z1] = W(qa, qb);
        it.geos.push(['plain', box({ at: [x, Y + 1.8, z], size: [Math.hypot(x1 - x0, z1 - z0), 0.12, 0.12], rot: [0, Math.atan2(-(z1 - z0), x1 - x0), 0], color: 0xffffff, seg: 100 })]);
      }
    }
    solidCyl(it, 0, gc, Y + 4.1, 6, 0.25, 0xffffff, 8);
    solidCyl(it, 0, gc, Y + 4.35, 6, 2.6, 0x7b3a2c, 8, 0.2);
    solidCyl(it, 0, gc, Y + 6.9, 0.08, 1.2, 0xd4a443, 6);
    const [x, z] = W(0, gc);
    it.solids.push({ at: [x, Y + 2.5, z], size: [9.5, 5, 9.5], heading: rotA, kind: 'building', color: 0xffffff });
  }
  // A flagpole by the gazebo, flying a flag.
  {
    const it = item(-14, gc + 14);
    solidCyl(it, -14, gc + 14, Y, 0.12, 11, 0xdddddd, 8, 0.06);
    for (let k = 0; k < 7; k++) tbox(it, -14 + 1.3, gc + 14, Y + 10.2 - k * 0.2, 2.4, 0.2, 0.04, k % 2 ? 0xffffff : 0xb3262e);
    tbox(it, -14 + 0.55, gc + 14, Y + 9.7, 1, 0.7, 0.05, 0x223a6e);
    const [x, z] = W(-14, gc + 14);
    it.solids.push({ at: [x, Y + 5.5, z], size: [0.3, 11, 0.3], heading: rotA, kind: 'building', color: 0xdddddd });
  }
  // Benches along the paths.
  for (const [a, b] of [[-40, gc - 4], [40, gc + 4], [-4, G0 + 25], [4, G1 - 25]]) {
    const it = item(a, b);
    tbox(it, a, b, Y + 0.45, 1.8, 0.08, 0.5, 0x3b5a3a);
    tbox(it, a, b + 0.25, Y + 0.6, 1.8, 0.5, 0.06, 0x3b5a3a);
    for (const s of [-0.75, 0.75]) tbox(it, a + s, b, Y, 0.08, 0.45, 0.45, 0x1d1d1d);
  }

  // ------------------------------------------------ the church at the head of the green
  {
    const cb = G1 + 22, it = item(0, cb);
    const len = 28, wid = 15, h = 9;
    walls(it, 0, cb + 2, Y, wid, len, h, 'white');
    tbox(it, 0, cb + 2, Y - 0.3, wid + 1, 0.6, len + 1, 0xb8b4aa);
    gable(it, 0, cb + 2, Y + h, wid, len, 6.5, false, 0x40454c);
    // Portico: columns and a pediment facing the green.
    const pb = cb + 2 - len / 2 - 3.2;
    for (const a of [-5.2, -1.8, 1.8, 5.2]) solidCyl(it, a, pb - 2, Y, 0.38, 7.5, 0xffffff, 10);
    tbox(it, 0, pb, Y + 7.5, 12.5, 0.8, 6.4, 0xffffff);
    gable(it, 0, pb, Y + 8.3, 12.5, 6.4, 2.4, false, 0xf4f2ec);
    tbox(it, 0, pb, Y - 0.3, 13, 0.6, 7, 0xd8d4ca);
    tbox(it, 0, cb + 2 - len / 2 - 0.05, Y, 2.2, 3.8, 0.2, 0x5a2e22); // the door
    // Steeple: square tower, the belfry with its openings, then the spire.
    const tb = cb + 2 - len / 2 + 2.6;
    walls(it, 0, tb, Y + h, 5.4, 5.4, 8, 'white');
    tbox(it, 0, tb, Y + h + 8, 6, 0.5, 6, 0xffffff);
    tbox(it, 0, tb, Y + h + 8.5, 4.6, 4.2, 4.6, 0xffffff, true);
    for (const [da, db] of [[0, -2.32], [0, 2.32], [-2.32, 0], [2.32, 0]]) tbox(it, da, tb + db, Y + h + 9.2, da ? 0.1 : 1.8, 2.8, da ? 1.8 : 0.1, 0x22262b);
    tbox(it, 0, tb, Y + h + 12.7, 5.2, 0.5, 5.2, 0xffffff);
    solidCyl(it, 0, tb, Y + h + 13.2, 2.3, 15, 0xffffff, 8, 0.08);
    solidCyl(it, 0, tb, Y + h + 28.2, 0.06, 1.6, 0xd4a443, 6);
    const [bx, bz] = W(0, tb);
    it.geos.push(['plain', new THREE.SphereGeometry(0.3, 10, 8).translate(bx, Y + h + 29.9, bz)]);
    paint(it.geos[it.geos.length - 1][1], 0xd4a443);
    it.solids.push({ at: [bx, Y + h + 20, bz], size: [3, 15, 3], heading: rotA, kind: 'building', color: 0xffffff });
    // Clock face on the tower, facing the green.
    const clock = new THREE.Mesh(new THREE.CircleGeometry(1.4, 28), new THREE.MeshBasicMaterial({ map: textPanel([''], '#f6f3ea', '#1b1b1b', 128, 128) }));
    const [cx, cz] = W(0, tb - 2.75 * 1.0);
    clock.position.set(cx, Y + h + 4.6, cz);
    // Face −b (towards the green).
    look(clock, 0, tb - 20);
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
    const a = -GA - 52, b = G0 + 12, it = item(a, b);
    walls(it, a, b, Y, 24, 16, 7.4, 'red');
    tbox(it, a, b, Y + 7.3, 24.6, 0.4, 16.6, 0xffffff);
    gable(it, a, b, Y + 7.7, 24, 16, 4.2, true, 0x3c4046);
    tbox(it, a, b, Y + 11.4, 3.2, 3, 3.2, 0xffffff);
    solidCyl(it, a, b, Y + 14.4, 2.3, 2.6, 0x3c4046, 4, 0.05);
    for (const da of [-4.5, -1.5, 1.5, 4.5]) solidCyl(it, a + da, b - 9.6, Y, 0.3, 6.6, 0xffffff, 8);
    tbox(it, a, b - 9.4, Y + 6.6, 11, 0.6, 3.6, 0xffffff);
    const sign = twoSidedSign(textPanel(['TOWN HALL'], '#f6f1e3', '#5b2a1f', 512, 96), 6, 1.1);
    const [sx, sz] = W(a, b - 11.3);
    sign.position.set(sx, Y + 6.2, sz);
    look(sign, a, b - 40);
    it.objects.push(sign);
  }
  {
    const a = GA + 50, b = G0 + 11, it = item(a, b);
    walls(it, a, b, Y, 20, 14, 5.6, 'mustard');
    gable(it, a, b, Y + 5.6, 20, 14, 4, true, 0x5b4033);
    for (const da of [-9, -4.5, 0, 4.5, 9]) solidCyl(it, a + da, b - 9.4, Y, 0.14, 3.4, 0xffffff, 6);
    tbox(it, a, b - 8.4, Y + 3.4, 20.5, 0.25, 3.4, 0x5b4033);
    tbox(it, a, b - 8.4, Y, 20.5, 0.35, 3.6, 0x7a5a3c);
    const sign = twoSidedSign(textPanel(['GENERAL STORE'], '#f3ead2', '#2b4a2e', 512, 96), 9, 1.4);
    const [sx, sz] = W(a, b - 7.05);
    sign.position.set(sx, Y + 4.8, sz);
    look(sign, a, b - 40);
    it.objects.push(sign);
  }

  // ------------------------------------------------ houses down both sides of the green
  const houseColors: Siding[] = ['white', 'cream', 'blue', 'white', 'sage', 'grey', 'mustard', 'white'];
  let hi = 0;
  for (const s of [-1, 1])
    for (const b of [G0 + 42, G0 + 70, G0 + 98]) {
      const a = s * (GA + 22), it = item(a, b);
      const h = rng() < 0.5 ? 6.8 : 5.6;
      walls(it, a, b, Y, 11, 14, h, houseColors[hi++ % houseColors.length]);
      gable(it, a, b, Y + h, 11, 14, 4.5, false, rng() < 0.5 ? 0x3f4349 : 0x4b3a32);
      tbox(it, a - s * 5.55, b, Y, 0.2, 2.4, 1.2, 0x2a3f5a); // front door (facing the green)
      tbox(it, a + s * 2, b + 3, Y + h + 1.4, 1, 3.5, 1, 0x8a3b2b);
    }

  // ------------------------------------------------ welcome signs where the road comes in
  const welcome = welcomeTexture();
  for (const s of [-1, 1]) {
    const a = s * (MAIN_HALF + 30), b = MAIN_ST + TOWN_HW + 9, it = item(a, b);
    // White post, a crossbar, and the board hanging from it on short chains.
    tbox(it, a, b, Y, 0.3, 3.9, 0.3, 0xf5f3ee, true);
    tbox(it, a - s * 1.3, b, Y + 3.5, 2.9, 0.22, 0.24, 0xf5f3ee);
    solidCyl(it, a, b, Y + 3.9, 0.22, 0.3, 0xd4a443, 8);
    for (const da of [0.25, 2.45]) tbox(it, a - s * da, b, Y + 2.98, 0.04, 0.55, 0.04, 0x333333);
    const board = twoSidedSign(welcome, 2.5, 1.46);
    const [x, z] = W(a - s * 1.35, b);
    board.position.set(x, Y + 2.25, z);
    // Facing the cars coming into town along Main Street.
    look(board, a + s * 30, b);
    it.objects.push(board);
    // Board edge, and a bed of autumn flowers at the foot of the post.
    tbox(it, a - s * 1.35, b, Y + 1.5, 2.6, 0.08, 0.1, 0x1f4d36);
    tbox(it, a, b, Y, 2.6, 0.3, 1.4, 0x3b2a1e);
    for (let k = 0; k < 14; k++) {
      const fa = a + (rng() - 0.5) * 2.3, fb = b + (rng() - 0.5) * 1.1;
      const [fx, fz] = W(fa, fb);
      const g = new THREE.SphereGeometry(0.16 + rng() * 0.08, 6, 5).translate(fx, Y + 0.4, fz);
      it.geos.push(['plain', paint(g, [0xd8452a, 0xf0b63a, 0xe9762b, 0x9b2a5c][k % 4])]);
    }
  }
  cache = items;
  return townItems(where);
}

/** Where the maples go: round the green, along Main Street, and a few behind the shops. */
export function townTreeSpots(): [number, number][] {
  if (!TOWN) return [];
  const out: [number, number][] = [];
  const G0 = MAIN_ST + TOWN_HW + 6, G1 = G0 + 100, GA = 115;
  for (let a = -GA + 8; a <= GA - 8; a += 24) for (const b of [G0 + 6, G1 - 6]) if (Math.abs(a) > 8) out.push(townPoint(TOWN, a, b) as [number, number]);
  for (let b = G0 + 20; b <= G1 - 20; b += 22) for (const s of [-1, 1]) if (Math.abs(b - (G0 + G1) / 2) > 8) out.push(townPoint(TOWN, s * (GA - 7), b) as [number, number]);
  // Behind the shops, and round the church.
  for (let a = -215; a <= 215; a += 26) out.push(townPoint(TOWN, a + 9, MAIN_ST - TOWN_HW - 32 - (a % 3) * 4) as [number, number]);
  for (const [a, b] of [[-26, G1 + 12], [26, G1 + 12], [-24, G1 + 40], [24, G1 + 42], [0, G1 + 55]]) out.push(townPoint(TOWN, a, b) as [number, number]);
  return out;
}
