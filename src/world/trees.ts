// Trees for highway country, built the way games usually do foliage: see-through
// pictures of needles or leaves on simple shapes, so from any angle you see layers of
// greenery with sky showing through.
//
//  pine       a trunk and stacked skirts of needles (a dusting of snow on them in the
//             mountains)
//  broadleaf  a trunk and a round crown of leafy cards, painted at load time from a
//             photo of real leaves (public/textures/leaves_broad.webp); in autumn the
//             leaves turn red, orange and gold
//
// Each kind is one geometry and one material, drawn as an InstancedMesh per chunk.
// Each picture keeps its bark in a strip along the bottom, so the trunk shares the
// leaves' material (one draw call per kind).
import * as THREE from 'three';
import { mulberry32 } from '../util/math';

const base = import.meta.env.BASE_URL;
const SIZE = 256;
/** The bottom of each picture (v < BARK) is bark, for the trunks. */
const BARK = 0.11;
/** How dark the sun's shadows are on trees (1: as dark as anywhere else). */
const TREE_SHADOW = 0.35;

export type TreeKind = 'pine' | 'pineSnow' | 'broad' | 'autumn';
export const TREE_KINDS: TreeKind[] = ['pine', 'pineSnow', 'broad', 'autumn'];

const materials = new Map<TreeKind, THREE.MeshLambertMaterial>();
const depthMaterials = new Map<TreeKind, THREE.MeshDepthMaterial>();
const geometries = new Map<TreeKind, THREE.BufferGeometry>();

/** Bark along the bottom strip of a picture. */
function paintBark(g: CanvasRenderingContext2D, dark: string, light: string) {
  const h = Math.round(SIZE * BARK);
  g.fillStyle = dark;
  g.fillRect(0, SIZE - h, SIZE, h);
  const rng = mulberry32(5);
  g.strokeStyle = light;
  for (let i = 0; i < 60; i++) {
    g.lineWidth = 1 + rng() * 2;
    const x = rng() * SIZE;
    g.beginPath();
    g.moveTo(x, SIZE - h);
    g.lineTo(x + (rng() - 0.5) * 6, SIZE);
    g.stroke();
  }
}

/**
 * A skirt of pine needles: dense needle strokes, darker underneath, with a ragged
 * lower edge. With `snow`, white clumps lie on the upper part.
 */
function paintPine(canvas: HTMLCanvasElement, snow: boolean) {
  const g = canvas.getContext('2d')!;
  const rng = mulberry32(snow ? 31 : 17);
  g.clearRect(0, 0, SIZE, SIZE);
  const top = 0, bottom = SIZE * (1 - BARK) - 2;
  g.lineCap = 'round';
  // Sprays of needles hanging down and out, layer on layer.
  for (let i = 0; i < 2600; i++) {
    const x = rng() * SIZE;
    // The ragged edge: sprays reach down further in some places than others.
    const reach = bottom - (0.5 + 0.5 * Math.sin(x * 0.11 + 2 * Math.sin(x * 0.037))) * SIZE * 0.12;
    const y = top + rng() ** 0.8 * (reach - top);
    const len = 5 + rng() * 9;
    const shade = 0.55 + 0.45 * (1 - y / bottom) * 0.6 + rng() * 0.25;
    const r = Math.round(28 * shade), gg = Math.round(70 * shade + 10 * rng()), b = Math.round(38 * shade);
    g.strokeStyle = `rgb(${r},${gg},${b})`;
    g.lineWidth = 1.2 + rng() * 0.9;
    const a = Math.PI / 2 + (rng() - 0.5) * 1.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  if (snow)
    for (let i = 0; i < 260; i++) {
      const x = rng() * SIZE, y = rng() ** 1.6 * bottom * 0.85;
      const r = 3 + rng() * 9;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(250,252,255,0.95)');
      grd.addColorStop(0.7, 'rgba(235,240,248,0.85)');
      grd.addColorStop(1, 'rgba(235,240,248,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(x, y, r * 1.6, r * 0.7, 0, 0, Math.PI * 2);
      g.fill();
    }
  paintBark(g, '#3d2a1c', '#5a4330');
}

const AUTUMN = ['#c8361b', '#e0661c', '#f0a02a', '#e8c23a', '#b8261a', '#d9811f'];

/** A round clump of leaves from the leaf photo (6 leaves side by side), on a few twigs. */
function paintCrown(canvas: HTMLCanvasElement, leaves: HTMLImageElement, autumn: boolean) {
  const g = canvas.getContext('2d')!;
  const rng = mulberry32(autumn ? 91 : 57);
  g.clearRect(0, 0, SIZE, SIZE);
  const H = SIZE * (1 - BARK) - 2;
  const cx = SIZE / 2, cy = H * 0.52, R = SIZE * 0.47;
  g.strokeStyle = '#4a3726';
  g.lineCap = 'round';
  for (let i = 0; i < 10; i++) {
    const a = (rng() - 0.5) * 2.6 - Math.PI / 2;
    g.lineWidth = 2 + rng() * 2.5;
    g.beginPath();
    g.moveTo(cx, H);
    g.quadraticCurveTo(cx + Math.cos(a) * R * 0.3, cy + 20, cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8);
    g.stroke();
  }
  const cell = leaves.width / 6;
  const tmp = document.createElement('canvas');
  tmp.width = 48;
  tmp.height = 64;
  const tg = tmp.getContext('2d')!;
  const leaf = (pass: number) => {
    let x = 0, y = 0;
    for (;;) {
      x = rng() * 2 - 1;
      y = rng() * 2 - 1;
      if (x * x + y * y * 1.15 < 1) break;
    }
    const px = cx + x * R, py = cy + y * R * 0.95;
    const k = Math.floor(rng() * 6);
    const len = SIZE * (0.05 + rng() * 0.035);
    let src: CanvasImageSource = leaves;
    let sx = k * cell, sw = cell, sh = leaves.height;
    if (autumn) {
      // Each leaf its own colour: draw it alone, tint it, then place it.
      tg.clearRect(0, 0, 48, 64);
      tg.globalCompositeOperation = 'source-over';
      tg.drawImage(leaves, k * cell, 0, cell, leaves.height, 0, 0, 48, 64);
      tg.globalCompositeOperation = 'source-atop';
      tg.globalAlpha = 0.78;
      tg.fillStyle = rng() < 0.12 ? '#9aa03a' : AUTUMN[Math.floor(rng() * AUTUMN.length)];
      tg.fillRect(0, 0, 48, 64);
      tg.globalAlpha = 1;
      (src = tmp), (sx = 0), (sw = 48), (sh = 64);
    }
    g.save();
    g.translate(px, py);
    g.rotate(Math.atan2(y, x) + Math.PI / 2 + (rng() - 0.5) * 2);
    g.drawImage(src, sx, 0, sw, sh, -len * 0.33, -len / 2, len * 0.66, len);
    g.restore();
    return pass;
  };
  for (let i = 0; i < 420; i++) leaf(0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(15, 25, 8, 0.42)';
  g.fillRect(0, 0, SIZE, SIZE);
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 330; i++) leaf(1);
  paintBark(g, '#4b3a2c', '#6d5a48');
}

/**
 * Texture data whose see-through pixels carry the average colour of the picture (not
 * black), so distant trees don't go dark and blotchy as the GPU shrinks it. Rows are
 * flipped so the picture stands the right way up.
 */
function bleedEdges(canvas: HTMLCanvasElement) {
  const src = canvas.getContext('2d')!.getImageData(0, 0, SIZE, SIZE).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < src.length; i += 4)
    if (src[i + 3] > 200) (r += src[i]), (gg += src[i + 1]), (b += src[i + 2]), n++;
  const avg = [r / n, gg / n, b / n];
  const out = new Uint8Array(src.length);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4, o = ((SIZE - 1 - y) * SIZE + x) * 4;
      const a = src[i + 3];
      for (let k = 0; k < 3; k++) out[o + k] = a > 8 ? Math.min(255, (src[i + k] * 255) / a) : avg[k];
      out[o + 3] = a;
    }
  return out;
}

function toTexture(canvas: HTMLCanvasElement) {
  const tex = new THREE.DataTexture(bleedEdges(canvas), SIZE, SIZE, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

let leafImage: Promise<HTMLImageElement> | null = null;
const leafPhoto = () =>
  (leafImage ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = `${base}textures/leaves_broad.webp`;
  }));

export function treeMaterial(kind: TreeKind) {
  let mat = materials.get(kind);
  if (mat) return mat;
  mat = new THREE.MeshLambertMaterial({ alphaTest: 0.45, alphaToCoverage: true });
  // The leaf cards shade each other, and at full strength a whole crown goes dark as
  // soon as it's inside the shadow box round the car: keep the sun's shadows faint on
  // trees (enough to show which side is in the shade).
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      THREE.ShaderChunk.lights_fragment_begin.replace(/directionalLightShadow\.shadowIntensity/g, `directionalLightShadow.shadowIntensity * ${TREE_SHADOW.toFixed(2)}`),
    );
  };
  mat.customProgramCacheKey = () => 'tree-shadow';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.45 });
  materials.set(kind, mat);
  depthMaterials.set(kind, depth);
  const m = mat;
  const finish = (canvas: HTMLCanvasElement) => {
    const tex = toTexture(canvas);
    m.map = tex;
    m.needsUpdate = true;
    depth.map = tex;
    depth.needsUpdate = true;
  };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  if (kind === 'pine' || kind === 'pineSnow') {
    paintPine(canvas, kind === 'pineSnow');
    finish(canvas);
  } else
    void leafPhoto().then((img) => {
      paintCrown(canvas, img, kind === 'autumn');
      finish(canvas);
    });
  return mat;
}

/** For shadows that show the gaps between the leaves. */
export const treeDepthMaterial = (kind: TreeKind) => (treeMaterial(kind), depthMaterials.get(kind)!);

/** Geometry under construction: positions, normals, uvs and triangles. */
class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
    this.pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nrm.push(nx / l, ny / l, nz / l);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }
  /** A tapering trunk from y0 to y1, with bark from the picture's bottom strip. */
  trunk(r0: number, r1: number, y0: number, y1: number, sides = 6) {
    const first = this.pos.length / 3;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      this.vert(c * r0, y0, s * r0, c, 0, s, i / sides, 0.005);
      this.vert(c * r1, y1, s * r1, c, 0, s, i / sides, BARK - 0.01);
    }
    for (let i = 0; i < sides; i++) {
      const a = first + i * 2;
      this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.userData.shared = true;
    return g;
  }
}

/**
 * A pine 1 unit = 1 m at scale 1 (about 13 m tall): a trunk and four skirts of
 * needles, widest at the bottom. Normals lean up and out so they light softly.
 */
function pineGeometry() {
  const G = new Geo();
  G.trunk(0.32, 0.12, -0.5, 10);
  const layers = 4, SEG = 7;
  for (let l = 0; l < layers; l++) {
    const y0 = 1.8 + l * 2.7, h = 4.6 - l * 0.5, R = 3.4 * (1 - l / (layers + 0.6));
    const first = G.pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2 + l * 0.7, c = Math.cos(a), s = Math.sin(a);
      const u = 0.02 + (i / SEG) * 1.6;
      G.vert(c * R, y0, s * R, c * 0.55, 1, s * 0.55, u, BARK + 0.005);
      G.vert(c * R * 0.08, y0 + h, s * R * 0.08, c * 0.3, 1, s * 0.3, u, 0.995);
    }
    for (let i = 0; i < SEG; i++) {
      const a = first + i * 2;
      G.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  return G.build();
}

/**
 * A broadleaf tree about 11 m tall: a trunk and a crown of four leafy clumps, each
 * three crossed cards drawn from both sides (normals up, so the backs don't go dark).
 */
function broadGeometry() {
  const G = new Geo();
  G.trunk(0.34, 0.16, -0.5, 6.5);
  const clumps: [number, number, number, number][] = [
    [0, 7.6, 0, 3.4],
    [1.6, 6.2, 0.6, 2.8],
    [-1.3, 6.4, 1.2, 2.7],
    [0.2, 6.0, -1.7, 2.8],
  ];
  clumps.forEach(([cx, cy, cz, r], ci) => {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI + ci * 0.5, c = Math.cos(a) * r, s = Math.sin(a) * r;
      const corners = [
        [cx - c, cy - r, cz - s, 0, BARK + 0.01],
        [cx + c, cy - r, cz + s, 1, BARK + 0.01],
        [cx + c, cy + r, cz + s, 1, 1],
        [cx - c, cy + r, cz - s, 0, 1],
      ];
      const ids = corners.map(([x, y, z, u, v]) => G.vert(x, y, z, (x - cx) * 0.3, 1, (z - cz) * 0.3, u, v));
      G.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
      G.idx.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
    }
  });
  return G.build();
}

export function treeGeometry(kind: TreeKind) {
  let g = geometries.get(kind);
  if (!g) geometries.set(kind, (g = kind === 'pine' || kind === 'pineSnow' ? pineGeometry() : broadGeometry()));
  return g;
}

/** Trunk radius (m) at scale 1, for colliders. */
export const TRUNK_RADIUS: Record<TreeKind, number> = { pine: 0.32, pineSnow: 0.32, broad: 0.34, autumn: 0.34 };
