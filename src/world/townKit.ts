// Tools for building the towns out in highway country (outer.ts:TOWNS says where they
// are and where their roads go). Everything is placed in town coordinates (`a` along,
// `b` across) and collected as TownItems: a spot, its geometry by material, what's
// solid, and any loose objects. OuterWorld adds each item to the chunk it stands in.
import * as THREE from 'three';
import { CurveRoad, Solid, Town, nearestCurve, outerLakeAt, townDistance, townPoint } from './outer';
import { buildingGeometry } from './buildings';
import { box, cyl, paint } from '../vehicles/builders/geo';
import { junctionPatches } from './roads';
import type { TreeKind } from './trees';
import type { WindowStyle } from '../util/textures';
import type { Vec2 } from '../util/math';

/** One piece of a town: what to draw (by material), what's solid, and loose objects (signs). */
export interface TownItem {
  x: number;
  z: number;
  geos: [string, THREE.BufferGeometry][];
  solids: Solid[];
  objects: THREE.Object3D[];
}

export const SIDINGS = { white: 0xf3f1ea, red: 0x9e3a2c, mustard: 0xd9a63e, blue: 0x7f93a3, sage: 0x95a585, cream: 0xe9dcb8, grey: 0xb9b8b2, yellow: 0xe8d27a, plum: 0x9c6a86 } as const;
export type Siding = keyof typeof SIDINGS;
/** Siding texture repeat: one window per 4 m, one storey per 3.4 m. */
export const SIDING_U = 4, SIDING_V = 3.4;

/** Clapboard in one colour, with a white-trimmed six-over-six window and black shutters. */
export function sidingTexture(color: number) {
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

/** A welcome sign's board: carved and gilded letters with a scalloped top. */
export function welcomeTexture(name: string, est: string, board = '#1f4d36', edge = '#f4efe2', ink = '#10251a') {
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
  g.fillStyle = edge;
  shape(0);
  g.fill();
  g.fillStyle = board;
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
    g.fillStyle = ink;
    g.fillText(text, W / 2 + 2, y + 3, W - 70);
    const grd = g.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    grd.addColorStop(0, '#fbe7a3');
    grd.addColorStop(0.55, '#d4a443');
    grd.addColorStop(1, '#a87b26');
    g.fillStyle = grd;
    g.fillText(text, W / 2, y, W - 70);
  };
  gold('Welcome to', 98, 40, true);
  gold(name, 168, 70);
  g.fillStyle = '#d8b25a';
  g.fillRect(W / 2 - 110, 212, 220, 3);
  gold(est, 248, 32, true);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Shop and building name boards: one texture per town holding them all (one draw call). */
export class SignAtlas {
  private entries: { lines: string[]; bg: string; fg: string; font: string }[] = [];
  static readonly CW = 512;
  static readonly CH = 128;
  static readonly COLS = 2;
  /** Add a board; returns its cell. */
  add(lines: string[], bg: string, fg: string, font = 'bold {s}px Georgia, "Times New Roman", serif') {
    this.entries.push({ lines, bg, fg, font });
    return this.entries.length - 1;
  }
  get rows() {
    return Math.max(1, Math.ceil(this.entries.length / SignAtlas.COLS));
  }
  /** UV box of a cell (u0, v0, u1, v1). */
  uv(i: number): [number, number, number, number] {
    const rows = 2 ** Math.ceil(Math.log2(this.rows));
    const col = i % SignAtlas.COLS, row = Math.floor(i / SignAtlas.COLS);
    const u0 = col / SignAtlas.COLS, u1 = (col + 1) / SignAtlas.COLS;
    const v1 = 1 - row / rows, v0 = 1 - (row + 1) / rows;
    return [u0 + 0.002, v0 + 0.002, u1 - 0.002, v1 - 0.002];
  }
  texture() {
    const rows = 2 ** Math.ceil(Math.log2(this.rows));
    const c = document.createElement('canvas');
    c.width = SignAtlas.CW * SignAtlas.COLS;
    c.height = SignAtlas.CH * rows;
    const g = c.getContext('2d')!;
    this.entries.forEach((e, i) => {
      const x = (i % SignAtlas.COLS) * SignAtlas.CW, y = Math.floor(i / SignAtlas.COLS) * SignAtlas.CH;
      const W = SignAtlas.CW, H = SignAtlas.CH;
      g.fillStyle = e.bg;
      g.fillRect(x, y, W, H);
      g.strokeStyle = e.fg;
      g.lineWidth = 5;
      g.strokeRect(x + 8, y + 8, W - 16, H - 16);
      g.fillStyle = e.fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const size = Math.min(70, (H - 30) / e.lines.length);
      g.font = e.font.replace('{s}', String(size));
      e.lines.forEach((l, k) => g.fillText(l, x + W / 2, y + H / 2 + (k - (e.lines.length - 1) / 2) * size * 1.05, W - 40));
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
}

/** Streets' sidewalk width and how far they stand off the road edge. */
const WALK = 3.4;

/**
 * Building one town. Places things in town coordinates: `a` along, `b` across, `y`
 * world height (the town's level is `Y`). Boxes are given by their centre (a, b), the
 * height of their bottom, and their size along a, up and along b.
 */
export class TownKit {
  readonly items: TownItem[] = [];
  readonly trees: [number, number, TreeKind][] = [];
  readonly Y: number;
  /** Rotation that lines a box's local x up with `a`, its z with `b`. */
  readonly rotA: number;
  readonly signs = new SignAtlas();
  /** Extra materials this town needs. */
  readonly materials: Record<string, THREE.Material> = {};

  /** Material key of this town's sign atlas. */
  readonly signKey: string;

  constructor(readonly t: Town) {
    this.Y = t.level;
    this.signKey = `signs-${t.kind === 'pad' ? t.name.replace(/\W/g, '') : t.kind}`;
    this.rotA = Math.atan2(-t.uz, t.ux);
  }

  W(a: number, b: number): Vec2 {
    return townPoint(this.t, a, b);
  }

  /** World rotation for a box turned `phi` from `a` towards `b`. */
  rot(phi = 0) {
    return this.rotA - this.t.side * phi;
  }

  item(a: number, b: number): TownItem {
    const [x, z] = this.W(a, b);
    const it: TownItem = { x, z, geos: [], solids: [], objects: [] };
    this.items.push(it);
    return it;
  }

  /** A box, optionally solid. `phi` turns it from `a` towards `b`. */
  box(it: TownItem, a: number, b: number, y: number, sa: number, sy: number, sb: number, color: number, solid = false, key = 'plain', phi = 0) {
    const [x, z] = this.W(a, b);
    it.geos.push([key, box({ at: [x, y + sy / 2, z], size: [sa, sy, sb], rot: [0, this.rot(phi), 0], color, seg: 100 })]);
    if (solid) this.solid(it, a, b, y, sa, sy, sb, color, phi);
  }

  /** Just the collider. */
  solid(it: TownItem, a: number, b: number, y: number, sa: number, sy: number, sb: number, color = 0xffffff, phi = 0) {
    const [x, z] = this.W(a, b);
    it.solids.push({ at: [x, y + sy / 2, z], size: [sa, sy, sb], heading: this.rot(phi), kind: 'building', color });
  }

  /** Clapboard walls (windows from the siding texture), solid. */
  walls(it: TownItem, a: number, b: number, y: number, sa: number, sb: number, h: number, siding: Siding, phi = 0) {
    const [x, z] = this.W(a, b);
    it.geos.push([`siding-${siding}`, buildingGeometry({ cx: x, cz: z, hw: sa / 2, hd: sb / 2, rot: this.rot(phi) }, y, h, 0xffffff, SIDING_U, SIDING_V, false, null)]);
    this.solid(it, a, b, y, sa, h, sb, SIDINGS[siding], phi);
  }

  /** A round tower of clapboard walls (`n` flat faces, a window on each), solid. */
  tower(it: TownItem, a: number, b: number, y: number, r: number, h: number, n: number, siding: Siding) {
    const [x, z] = this.W(a, b);
    const pos: number[] = [], uv: number[] = [];
    for (let i = 0; i < n; i++) {
      // (Faces in the same order as CylinderGeometry's, so a `cyl` with n segments fits on top.)
      const t0 = Math.PI / 2 - (i / n) * Math.PI * 2, t1 = Math.PI / 2 - ((i + 1) / n) * Math.PI * 2;
      const [ax, az, bx, bz] = [x + r * Math.cos(t1), z + r * Math.sin(t1), x + r * Math.cos(t0), z + r * Math.sin(t0)];
      const v = h / SIDING_V;
      pos.push(ax, y, az, bx, y + h, bz, bx, y, bz, ax, y, az, ax, y + h, az, bx, y + h, bz);
      uv.push(0, 0, 1, v, 1, 0, 0, 0, 0, v, 1, v);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(pos.map(() => 1), 3));
    g.computeVertexNormals();
    it.geos.push([`siding-${siding}`, g]);
    this.solid(it, a, b, y, r * 1.7, h, r * 1.7, SIDINGS[siding]);
  }

  /** City walls with window rows (the world's window textures, `bright` times brighter), a cornice and a flat roof; solid. */
  facade(it: TownItem, a: number, b: number, y: number, sa: number, sb: number, h: number, style: WindowStyle, tint: number, phi = 0, cornice = 0xe6e1d6, bright = 1) {
    const [x, z] = this.W(a, b);
    const rect = { cx: x, cz: z, hw: sa / 2, hd: sb / 2, rot: this.rot(phi) };
    const walls = buildingGeometry(rect, y - 0.3, h + 0.3, tint, 16, 14, true, null);
    if (bright !== 1) {
      // (Brighter than the texture itself: white marble from the grey concrete walls.)
      const c = walls.attributes.color.array as Float32Array;
      for (let i = 0; i < c.length; i++) c[i] *= bright;
    }
    it.geos.push([`win-${style}`, walls]);
    it.geos.push(['plain', buildingGeometry({ ...rect, hw: rect.hw + 0.35, hd: rect.hd + 0.35 }, y + h - 0.3, 0.8, cornice, 100, 100, false, null)]);
    it.geos.push(['plain', buildingGeometry({ ...rect, hw: rect.hw + 0.3, hd: rect.hd + 0.3 }, y + h - 0.35, 0.6, 0x77736c, 100, 100, false, 0x77736c)]);
    this.solid(it, a, b, y, sa, h, sb, tint, phi);
  }

  /** A pitched roof over a box, its ridge running along a (or along b), overhanging a little. */
  gable(it: TownItem, a: number, b: number, y: number, sa: number, sb: number, h: number, alongA: boolean, color: number) {
    const o = 0.5;
    const ha = sa / 2 + o, hb = sb / 2 + o;
    const P = (da: number, db: number, dy: number) => {
      const [x, z] = this.W(a + da, b + db);
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
  }

  /** An upright cylinder (or cone, with rTop), optionally solid (as a box round it). */
  cyl(it: TownItem, a: number, b: number, y: number, r: number, h: number, color: number, segments = 10, rTop = r, solid = false) {
    const [x, z] = this.W(a, b);
    it.geos.push(['plain', cyl({ at: [x, y + h / 2, z], radius: r, radiusTop: rTop, length: h, axis: 'y', segments, color })]);
    if (solid) this.solid(it, a, b, y, r * 1.6, h, r * 1.6, color);
  }

  /** A dome (half sphere, squashed or stretched by `k`). */
  dome(it: TownItem, a: number, b: number, y: number, r: number, color: number, k = 1, segments = 20) {
    const [x, z] = this.W(a, b);
    const g = new THREE.SphereGeometry(r, segments, Math.max(5, segments / 2), 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, k, 1);
    g.translate(x, y, z);
    it.geos.push(['plain', paint(g, color)]);
  }

  /** Turn an object to face a spot in town (its +z towards it), staying upright. */
  look(o: THREE.Object3D, a: number, b: number) {
    const [x, z] = this.W(a, b);
    o.lookAt(x, o.position.y, z);
  }

  /** A flat quad lying on the ground (cut into pieces no bigger than `piece`, each its own item). */
  flat(key: string, a0: number, a1: number, b0: number, b1: number, y: number, uvScale: number, piece = 64, skip?: (a: number, b: number) => boolean) {
    const na = Math.max(1, Math.ceil((a1 - a0) / piece)), nb = Math.max(1, Math.ceil((b1 - b0) / piece));
    for (let i = 0; i < na; i++)
      for (let j = 0; j < nb; j++) {
        const pa0 = a0 + ((a1 - a0) * i) / na, pa1 = a0 + ((a1 - a0) * (i + 1)) / na;
        const pb0 = b0 + ((b1 - b0) * j) / nb, pb1 = b0 + ((b1 - b0) * (j + 1)) / nb;
        if (skip?.((pa0 + pa1) / 2, (pb0 + pb1) / 2)) continue;
        this.quad(this.item((pa0 + pa1) / 2, (pb0 + pb1) / 2), key, [this.W(pa0, pb0), this.W(pa1, pb0), this.W(pa1, pb1), this.W(pa0, pb1)], y, uvScale);
      }
  }

  /** A strip from (a0, b0) to (a1, b1), `w` wide, lying on the ground. */
  strip(it: TownItem, key: string, a0: number, b0: number, a1: number, b1: number, w: number, y: number, uvScale: number) {
    const len = Math.hypot(a1 - a0, b1 - b0), na = (-(b1 - b0) / len) * (w / 2), nb = ((a1 - a0) / len) * (w / 2);
    this.quad(it, key, [this.W(a0 + na, b0 + nb), this.W(a1 + na, b1 + nb), this.W(a1 - na, b1 - nb), this.W(a0 - na, b0 - nb)], y, uvScale);
  }

  /** A flat quad (world corners in order) facing up, with world-planar UVs. */
  quad(it: TownItem, key: string, c: Vec2[], y: number, uvScale: number) {
    const pos: number[] = [], uv: number[] = [];
    const cross = (c[1][0] - c[0][0]) * (c[2][1] - c[0][1]) - (c[1][1] - c[0][1]) * (c[2][0] - c[0][0]);
    for (const k of cross < 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
      pos.push(c[k][0], y, c[k][1]);
      uv.push(c[k][0] / uvScale, c[k][1] / uvScale);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    it.geos.push([key, g]);
  }

  /** A name board (from the town's sign atlas), readable from both sides, facing +b (turned by `phi`). */
  board(it: TownItem, text: string[], bg: string, fg: string, a: number, b: number, y: number, w: number, h: number, phi = 0, font?: string) {
    const cell = this.signs.add(text, bg, fg, font);
    const [x, z] = this.W(a, b);
    for (const back of [false, true]) {
      const g = new THREE.PlaneGeometry(w, h);
      // UVs 0..1 for now; finish() points them at the atlas. (The back is the same plane
      // turned round, so it reads the right way from behind too.)
      if (back) g.rotateY(Math.PI);
      g.userData.signCell = cell;
      // The plane faces +z; turn it to face +b.
      g.rotateY(this.rot(phi) + (this.t.side > 0 ? 0 : Math.PI));
      g.translate(x, y + h / 2, z);
      it.geos.push([this.signKey, g]);
    }
  }

  tree(a: number, b: number, kind: TreeKind) {
    const [x, z] = this.W(a, b);
    this.trees.push([x, z, kind]);
  }

  /** Is this spot clear of every road (by `m` metres) and dry? */
  clear(a: number, b: number, m: number) {
    const [x, z] = this.W(a, b);
    return nearestCurve(x, z).edge > m && !outerLakeAt(x, z);
  }

  /** Sidewalks along both sides of every level street in town, stopping at crossings. */
  sidewalks(skip?: (a: number, b: number) => boolean) {
    const Y = this.Y;
    for (const r of this.t.roads) {
      if (r.hs.some((h) => Math.abs(h - Y) > 0.01)) continue; // (not the roads in from the highway)
      this.alongRoad(r, (it, pts) => this.quad(it, 'town-walk', pts, Y + 0.1, 4), skip);
    }
  }

  /** Runs either side of a road, 3 m steps, stopping where they'd touch another road or leave town. */
  private alongRoad(r: CurveRoad, draw: (it: TownItem, corners: Vec2[]) => void, skip?: (a: number, b: number) => boolean) {
    const o0 = r.hw + 0.3, o1 = r.hw + 0.3 + WALK;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      for (const side of [-1, 1]) {
        const px = -uz * side, pz = ux * side;
        const n = Math.max(1, Math.round(len / 3));
        const ok = (k: number) => {
          const s = ((k + 0.5) * len) / n;
          for (const o of [o0 + 0.1, (o0 + o1) / 2, o1 - 0.1]) {
            const x = ax + ux * s + px * o, z = az + uz * s + pz * o;
            if (nearestCurve(x, z).edge < 0.25 || townDistance(this.t, x, z) > 0 || outerLakeAt(x, z)) return false;
            if (skip) {
              const { a, b } = this.coords(x, z);
              if (skip(a, b)) return false;
            }
          }
          return true;
        };
        let start = -1;
        for (let k = 0; k <= n; k++) {
          const good = k < n && ok(k);
          if (good && start < 0) start = k;
          if (!good && start >= 0) {
            const s0 = (start * len) / n, s1 = (k * len) / n;
            const P = (s: number, o: number): Vec2 => [ax + ux * s + px * o, az + uz * s + pz * o];
            const mid = P((s0 + s1) / 2, o0);
            const it: TownItem = { x: mid[0], z: mid[1], geos: [], solids: [], objects: [] };
            this.items.push(it);
            draw(it, [P(s0, o0), P(s1, o0), P(s1, o1), P(s0, o1)]);
            start = -1;
          }
        }
      }
    }
  }

  coords(x: number, z: number) {
    const dx = x - this.t.x, dz = z - this.t.z;
    return { a: dx * this.t.ux + dz * this.t.uz, b: (-dx * this.t.uz + dz * this.t.ux) * this.t.side };
  }

  /** Plain asphalt over every crossing and T-junction, with stop lines (zebra crossings if `zebra`). */
  junctions(zebra: boolean) {
    const Y = this.Y;
    const roads = this.t.roads.map((r) => ({ pts: r.pts.slice(), width: r.hw * 2, kind: 'street' as const }));
    junctionPatches((key, g, x, z) => {
      const it: TownItem = { x, z, geos: [[key, g]], solids: [], objects: [] };
      this.items.push(it);
    }, roads, Y + 0.17, () => zebra);
  }

  /** Street lamps every `every` m along a straight street from (a0, b0) to (a1, b1), both sides. */
  lamps(a0: number, b0: number, a1: number, b1: number, hw: number, every: number, style: 'old' | 'cobra' = 'old') {
    const len = Math.hypot(a1 - a0, b1 - b0), ua = (a1 - a0) / len, ub = (b1 - b0) / len;
    for (let s = every / 2; s < len; s += every)
      for (const side of [-1, 1]) {
        const a = a0 + ua * s - ub * side * (hw + 1.2), b = b0 + ub * s + ua * side * (hw + 1.2);
        if (!this.clear(a, b, 1.5)) continue;
        const it = this.item(a, b), Y = this.Y;
        if (style === 'old') {
          this.cyl(it, a, b, Y, 0.09, 4.2, 0x1b1d1f, 6);
          this.box(it, a, b, Y + 4.1, 0.55, 0.75, 0.55, 0x1b1d1f);
          this.box(it, a, b, Y + 4.2, 0.42, 0.55, 0.42, 0xffe2a6);
          this.box(it, a, b, Y + 4.85, 0.7, 0.12, 0.7, 0x1b1d1f);
        } else {
          this.cyl(it, a, b, Y, 0.12, 7.5, 0x8d9196, 6);
          const ha = a + ub * side * 1.6, hb = b - ua * side * 1.6;
          this.box(it, (a + ha) / 2, (b + hb) / 2, Y + 7.3, Math.abs(ha - a) + 0.2, 0.15, Math.abs(hb - b) + 0.2, 0x8d9196);
          this.box(it, ha, hb, Y + 7.1, 0.8, 0.25, 0.8, 0xfff1c8);
        }
        this.solid(it, a, b, Y, 0.25, 4.2, 0.25, 0x1b1d1f);
      }
  }

  /** Finish: point the signs at their place in the atlas, and make its material. */
  finish() {
    const key = this.signKey;
    for (const it of this.items)
      for (const [k, g] of it.geos) {
        if (k !== key) continue;
        const [u0, v0, u1, v1] = this.signs.uv(g.userData.signCell as number);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
      }
    this.materials[key] = new THREE.MeshBasicMaterial({ map: this.signs.texture() });
  }
}
