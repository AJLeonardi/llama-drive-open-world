import * as THREE from 'three';
import { blob, box, cyl, merge, paint, tube } from '../vehicles/builders/geo';
import type { MaterialKind } from '../physics/Physics';
import { crateTexture } from '../util/textures';

export type PropKind =
  | 'cone' | 'barrel' | 'crate' | 'block' | 'pin' | 'tire' | 'barrier'
  | 'pole' | 'hydrant' | 'mailbox' | 'bench' | 'tree' | 'rail' | 'domino' | 'pane' | 'tnt';

/**
 * - loose:   ordinary physics object, just gets knocked around
 * - shatter: breaks into pieces when its health runs out
 * - topple:  bolted down until hit hard enough, then falls over
 */
export type BreakStyle = 'loose' | 'shatter' | 'topple';

export interface PropDef {
  /** Geometry centred on the collider centre. */
  geo: () => THREE.BufferGeometry;
  material?: () => THREE.Material;
  shape: { type: 'box'; hx: number; hy: number; hz: number } | { type: 'cyl'; hh: number; r: number };
  mass: number;
  /** Impulse (N·s, from a 2000 kg car) that destroys/topples it in one hit. */
  toughness: number;
  style: BreakStyle;
  fixed: boolean;
  material_: MaterialKind;
  chunkColor: number;
  /**
   * Breakaway posts: hit faster than this (m/s) and the prop snaps off and flies,
   * while the car barely slows and takes only light damage. Slower = it holds.
   */
  breakaway?: number;
  /** Blows up when the car hits it (and sets off others nearby). */
  explosive?: boolean;
}

const halfHeight = (d: PropDef) => (d.shape.type === 'box' ? d.shape.hy : d.shape.hh);
export const propHalfHeight = halfHeight;

function pinGeo() {
  const pts: THREE.Vector2[] = [];
  const prof = [[0.0, -1.2], [0.3, -1.2], [0.45, -0.75], [0.42, -0.2], [0.24, 0.35], [0.2, 0.55], [0.28, 0.85], [0.24, 1.1], [0.0, 1.2]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 10);
  return paint(g, (_x, y) => (y > 0.38 && y < 0.5 ? 0xd21f1f : y > 0.58 && y < 0.66 ? 0xd21f1f : 0xf5f5f0));
}

function treeGeo() {
  // Trunk from the ground (y = -2.1, the collider bottom) up into a cluster of leafy blobs.
  const parts = [cyl({ at: [0, -0.8, 0], radius: 0.22, radiusTop: 0.13, length: 2.8, axis: 'y', segments: 8, color: 0x6b4a2b })];
  const blobs: [number, number, number, number][] = [
    [0, 1.4, 0, 1.9], [0.9, 1.0, 0.5, 1.3], [-0.8, 1.1, -0.4, 1.35], [0.2, 2.5, -0.2, 1.4], [-0.4, 0.9, 0.9, 1.1],
  ];
  blobs.forEach(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, i === 0 ? 1 : 0);
    g.translate(x, y, z);
    // darker underneath, lighter on top
    parts.push(paint(g, (_x, yy) => {
      const t = Math.min(1, Math.max(0, (yy - 0.2) / 3));
      const c = new THREE.Color(0x2f6b2a).lerp(new THREE.Color(0x5aa244), t);
      return [c.r, c.g, c.b];
    }));
  });
  return merge(parts);
}

function poleGeo() {
  return merge([
    cyl({ at: [0, 0, 0], radius: 0.11, radiusTop: 0.07, length: 7, axis: 'y', segments: 6, color: 0x4a4f55 }),
    cyl({ at: [0, -3.3, 0], radius: 0.2, radiusTop: 0.14, length: 0.5, axis: 'y', segments: 6, color: 0x3c4046 }),
    tube([[0, 3.0, 0], [0, 3.55, 0.35], [0, 3.62, 1.0], [0, 3.55, 1.5]], 0.05, 0x4a4f55, 6, 5),
    box({ at: [0, 3.45, 1.55], size: [0.3, 0.12, 0.55], seg: 1, color: 0x3c4046 }),
    box({ at: [0, 3.38, 1.55], size: [0.22, 0.04, 0.42], seg: 1, color: 0xfff6d8 }),
  ]);
}

function hydrantGeo() {
  return merge([
    cyl({ at: [0, -0.37, 0], radius: 0.2, length: 0.06, axis: 'y', segments: 12, color: 0xc9a316 }),
    cyl({ at: [0, -0.05, 0], radius: 0.15, length: 0.6, axis: 'y', segments: 12, color: 0xe2b81c }),
    blob([0, 0.26, 0], [0.16, 0.12, 0.16], 0xe2b81c, 10),
    cyl({ at: [0, 0.38, 0], radius: 0.04, length: 0.08, axis: 'y', segments: 6, color: 0xc9a316 }),
    cyl({ at: [0, 0.05, 0], radius: 0.06, length: 0.44, axis: 'x', segments: 8, color: 0xd0d0d0 }),
    cyl({ at: [0, 0.05, 0.1], radius: 0.07, length: 0.1, axis: 'z', segments: 8, color: 0xd0d0d0 }),
  ]);
}

export const PROP_DEFS: Record<PropKind, PropDef> = {
  cone: {
    geo: () => merge([
      cyl({ at: [0, 0, 0], radius: 0.22, radiusTop: 0.04, length: 0.7, axis: 'y', segments: 8, color: (_x, y) => (y > 0.0 && y < 0.12 ? 0xffffff : 0xff6a00) }),
      box({ at: [0, -0.33, 0], size: [0.5, 0.04, 0.5], color: 0xff6a00 }),
    ]),
    shape: { type: 'cyl', hh: 0.35, r: 0.24 }, mass: 4, toughness: 60, style: 'loose', fixed: false, material_: 'plastic', chunkColor: 0xff6a00,
  },
  barrel: {
    geo: () => cyl({ at: [0, 0, 0], radius: 0.3, length: 0.9, axis: 'y', segments: 10, color: (_x, y) => (Math.abs(y) > 0.15 && Math.abs(y) < 0.2 ? 0x333333 : 0xffffff) }),
    shape: { type: 'cyl', hh: 0.45, r: 0.3 }, mass: 25, toughness: 600, style: 'loose', fixed: false, material_: 'metal', chunkColor: 0x2266cc,
  },
  crate: {
    geo: () => {
      const g = new THREE.BoxGeometry(1, 1, 1);
      const col = new Float32Array(g.attributes.position.count * 3).fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    },
    material: () => new THREE.MeshLambertMaterial({ map: crateTexture(), vertexColors: true }),
    shape: { type: 'box', hx: 0.5, hy: 0.5, hz: 0.5 }, mass: 40, toughness: 700, style: 'shatter', fixed: false, material_: 'wood', chunkColor: 0xb5824a,
  },
  block: {
    geo: () => box({ at: [0, 0, 0], size: [0.9, 0.45, 0.45], color: 0xffffff }),
    shape: { type: 'box', hx: 0.45, hy: 0.225, hz: 0.225 }, mass: 30, toughness: 2000, style: 'loose', fixed: false, material_: 'concrete', chunkColor: 0xa04a35,
  },
  pin: {
    geo: pinGeo,
    shape: { type: 'cyl', hh: 1.2, r: 0.42 }, mass: 45, toughness: 1500, style: 'loose', fixed: false, material_: 'plastic', chunkColor: 0xffffff,
  },
  tire: {
    geo: () => merge([
      cyl({ at: [0, 0, 0], radius: 0.42, length: 0.28, axis: 'y', segments: 12, color: 0x1e1e1e }),
      cyl({ at: [0, 0, 0], radius: 0.2, length: 0.3, axis: 'y', segments: 8, color: 0x555555 }),
    ]),
    shape: { type: 'cyl', hh: 0.14, r: 0.42 }, mass: 12, toughness: 400, style: 'loose', fixed: false, material_: 'plastic', chunkColor: 0x1e1e1e,
  },
  barrier: {
    geo: () => merge([
      box({ at: [0, -0.2, 0], size: [2.0, 0.4, 0.6], color: 0xd9d6cf }),
      box({ at: [0, 0.2, 0], size: [2.0, 0.4, 0.3], color: (x) => (Math.floor((x + 1) * 2) % 2 ? 0xd9d6cf : 0xd23c2a) }),
    ]),
    shape: { type: 'box', hx: 1.0, hy: 0.4, hz: 0.3 }, mass: 500, toughness: 9000, style: 'loose', fixed: false, material_: 'concrete', chunkColor: 0xd9d6cf,
  },
  pole: {
    geo: poleGeo,
    shape: { type: 'cyl', hh: 3.5, r: 0.14 }, mass: 150, toughness: 9000, style: 'topple', breakaway: 12, fixed: true, material_: 'metal', chunkColor: 0x55595e,
  },
  hydrant: {
    geo: hydrantGeo,
    shape: { type: 'cyl', hh: 0.4, r: 0.2 }, mass: 80, toughness: 6000, style: 'topple', breakaway: 5, fixed: true, material_: 'metal', chunkColor: 0xd8b31a,
  },
  mailbox: {
    geo: () => merge([
      box({ at: [0, 0.15, 0], size: [0.5, 0.75, 0.45], color: 0x1f4fa8 }),
      cyl({ at: [0, 0.52, 0], radius: 0.25, length: 0.45, axis: 'z', segments: 10, color: 0x1f4fa8 }),
      box({ at: [0, -0.4, 0], size: [0.4, 0.35, 0.35], color: 0x1f4fa8 }),
    ]),
    shape: { type: 'box', hx: 0.27, hy: 0.6, hz: 0.25 }, mass: 60, toughness: 2500, style: 'topple', breakaway: 3, fixed: true, material_: 'metal', chunkColor: 0x1f4fa8,
  },
  bench: {
    geo: () => merge([
      box({ at: [0, -0.05, 0], size: [1.8, 0.08, 0.5], color: 0x7a5230 }),
      box({ at: [0, 0.3, -0.22], size: [1.8, 0.4, 0.06], color: 0x7a5230 }),
      box({ at: [0.8, -0.3, 0], size: [0.08, 0.45, 0.5], color: 0x2f2f2f }),
      box({ at: [-0.8, -0.3, 0], size: [0.08, 0.45, 0.5], color: 0x2f2f2f }),
    ]),
    shape: { type: 'box', hx: 0.9, hy: 0.5, hz: 0.28 }, mass: 70, toughness: 3000, style: 'topple', breakaway: 2, fixed: true, material_: 'wood', chunkColor: 0x7a5230,
  },
  rail: {
    // Low bridge railing segment: bolted down, but breaks loose in a hard hit.
    geo: () => merge([
      box({ at: [0, 0.12, 0], size: [0.18, 0.14, 3.9], color: 0xe8e8e8 }),
      box({ at: [0, -0.12, 1.6], size: [0.14, 0.36, 0.14], color: 0x9a9a9a }),
      box({ at: [0, -0.12, -1.6], size: [0.14, 0.36, 0.14], color: 0x9a9a9a }),
    ]),
    shape: { type: 'box', hx: 0.12, hy: 0.25, hz: 1.95 }, mass: 60, toughness: 3500, style: 'topple', breakaway: 9, fixed: true, material_: 'metal', chunkColor: 0xe8e8e8,
  },
  // Giant dominoes: knock one and the whole line goes.
  domino: {
    geo: () => merge([
      box({ at: [0, 0, 0], size: [0.45, 3.2, 1.6], color: 0xf5f3ee }),
      box({ at: [0.23, 0, 0], size: [0.02, 0.06, 1.5], color: 0x222222 }),
      box({ at: [-0.23, 0, 0], size: [0.02, 0.06, 1.5], color: 0x222222 }),
      ...[-0.7, 0.7].flatMap((y) => [-0.45, 0.45].map((z) => cyl({ at: [0.235, y, z], radius: 0.12, length: 0.02, axis: 'x', segments: 10, color: 0x222222 }))),
      ...[-0.7, 0.7].flatMap((y) => [-0.45, 0.45].map((z) => cyl({ at: [-0.235, y, z], radius: 0.12, length: 0.02, axis: 'x', segments: 10, color: 0x222222 }))),
    ]),
    shape: { type: 'box', hx: 0.225, hy: 1.6, hz: 0.8 }, mass: 90, toughness: 2500, style: 'loose', fixed: false, material_: 'wood', chunkColor: 0xf5f3ee,
  },
  // Free-standing glass panes in frames: they shatter spectacularly.
  pane: {
    geo: () => merge([
      box({ at: [0, 0, 0], size: [0.06, 2.4, 2.4], color: 0xbfe3f5 }),
      box({ at: [0, 1.22, 0], size: [0.12, 0.08, 2.5], color: 0x3a3d42 }),
      box({ at: [0, -1.22, 0], size: [0.12, 0.08, 2.5], color: 0x3a3d42 }),
      box({ at: [0, 0, 1.22], size: [0.12, 2.5, 0.08], color: 0x3a3d42 }),
      box({ at: [0, 0, -1.22], size: [0.12, 2.5, 0.08], color: 0x3a3d42 }),
    ]),
    shape: { type: 'box', hx: 0.08, hy: 1.25, hz: 1.25 }, mass: 40, toughness: 250, style: 'shatter', fixed: false, material_: 'glass', chunkColor: 0xbfe3f5,
  },
  // Exploding barrel: bright red with a yellow-and-black hazard band. Bump it and BOOM.
  tnt: {
    geo: () => merge([
      cyl({
        at: [0, 0, 0], radius: 0.34, length: 1.0, axis: 'y', segments: 16, heightSegments: 10,
        color: (_x, y) => (Math.abs(y) < 0.13 ? 0xffc400 : Math.abs(y) < 0.17 || Math.abs(y) > 0.44 ? 0x1a1a1a : 0xd61f1f),
      }),
      cyl({ at: [0, 0.505, 0], radius: 0.3, length: 0.02, axis: 'y', segments: 16, color: 0xf2f2f2 }),
      cyl({ at: [0.14, 0.53, 0.08], radius: 0.05, length: 0.06, axis: 'y', segments: 8, color: 0x1a1a1a }),
    ]),
    material: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2, emissive: 0x3a0000 }),
    shape: { type: 'cyl', hh: 0.5, r: 0.34 }, mass: 30, toughness: 300, style: 'shatter', fixed: false, material_: 'metal', chunkColor: 0xd61f1f,
    explosive: true,
  },
  tree: {
    geo: treeGeo,
    shape: { type: 'cyl', hh: 2.1, r: 0.3 }, mass: 400, toughness: 16000, style: 'topple', fixed: true, material_: 'wood', chunkColor: 0x3f8f3a,
  },
};

export interface PropSpawn {
  kind: PropKind;
  x: number;
  /** ground height at the prop's base */
  y: number;
  z: number;
  rot: number;
  color?: number;
}

/**
 * Exploding barrels stacked into a pyramid (a triangle wall, `base` barrels wide),
 * running along heading `rot` from (x, z), standing on ground height `y`.
 */
export function tntPyramid(props: PropSpawn[], x: number, z: number, base: number, rot: number, y = 0) {
  const ux = Math.cos(rot), uz = -Math.sin(rot);
  for (let row = 0; row < base; row++)
    for (let i = 0; i < base - row; i++) {
      const o = (i - (base - row - 1) / 2) * 0.72;
      props.push({ kind: 'tnt', x: x + ux * o, y: y + row * 1.0, z: z + uz * o, rot: 0 });
    }
}
