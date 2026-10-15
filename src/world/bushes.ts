// Desert scrub: soft, leafy bushes made the way games usually do foliage — a few crossed
// "cards", each showing a clump of leaves with see-through gaps between them, so from
// any angle you see layers of leaves. The clump picture is painted at load time from a
// photo of real leaves (public/textures/leaves_scrub.webp): hundreds of small leaves,
// darker inside, lighter and sun-touched at the tips, on a few twigs.
import * as THREE from 'three';
import { mulberry32 } from '../util/math';

const base = import.meta.env.BASE_URL;
const SIZE = 256;

let material: THREE.MeshLambertMaterial | null = null;
let geometry: THREE.BufferGeometry | null = null;

/** Paint the leaf-clump picture from the leaf photo (6 leaves side by side). */
function paintClump(canvas: HTMLCanvasElement, leaves: HTMLImageElement) {
  const g = canvas.getContext('2d')!;
  const rng = mulberry32(77);
  g.clearRect(0, 0, SIZE, SIZE);
  // Twigs from the base outwards.
  g.strokeStyle = '#5a4630';
  g.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI / 2 + (rng() - 0.5) * 2.4;
    const len = SIZE * (0.25 + rng() * 0.25);
    g.lineWidth = 1.5 + rng() * 2;
    g.beginPath();
    g.moveTo(SIZE / 2 + (rng() - 0.5) * 20, SIZE * 0.97);
    g.quadraticCurveTo(SIZE / 2 + Math.cos(a) * len * 0.4, SIZE * 0.97 + Math.sin(a) * len * 0.5, SIZE / 2 + Math.cos(a) * len, SIZE * 0.97 + Math.sin(a) * len);
    g.stroke();
  }
  const cell = leaves.width / 6;
  const leaf = (pass: number) => {
    // A dome: points inside a half-ellipse, denser towards the middle.
    let x = 0, y = 0;
    for (;;) {
      x = rng() * 2 - 1;
      y = rng();
      if (x * x + y * y < 1) break;
    }
    const px = SIZE / 2 + x * SIZE * 0.47, py = SIZE * 0.98 - y * SIZE * 0.88;
    const k = Math.floor(rng() * 6);
    const len = SIZE * (0.06 + rng() * 0.07) * (pass ? 1 : 1.15);
    g.save();
    g.translate(px, py);
    // Leaves point outwards from the middle of the bush, with some scatter.
    g.rotate(Math.atan2(y, x) * -1 + Math.PI / 2 + (rng() - 0.5) * 1.6);
    g.drawImage(leaves, k * cell, 0, cell, leaves.height, -len * 0.18, -len / 2, len * 0.36, len);
    g.restore();
  };
  // Inner, shaded leaves first; then darken everything so far.
  for (let i = 0; i < 380; i++) leaf(0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(20, 28, 10, 0.45)';
  g.fillRect(0, 0, SIZE, SIZE);
  g.globalCompositeOperation = 'source-over';
  // Outer leaves in the light.
  for (let i = 0; i < 300; i++) leaf(1);
  // Dusty sage tint, like desert scrub.
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(150, 150, 105, 0.28)';
  g.fillRect(0, 0, SIZE, SIZE);
  g.globalCompositeOperation = 'source-over';
}

/**
 * Turn the painted canvas into texture data whose see-through pixels carry the leaves'
 * average colour (not black). Otherwise, as the GPU shrinks the picture for distant
 * bushes, black bleeds into the leaf edges and bushes go dark and blotchy. Rows are
 * flipped so the bush stands the right way up.
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
      // Canvas pixels are stored premultiplied: un-premultiply what's partly see-through.
      for (let k = 0; k < 3; k++) out[o + k] = a > 8 ? Math.min(255, (src[i + k] * 255) / a) : avg[k];
      out[o + 3] = a;
    }
  return out;
}

export function bushMaterial() {
  if (material) return material;
  material = new THREE.MeshLambertMaterial({ alphaTest: 0.4, alphaToCoverage: true });
  const mat = material;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    paintClump(canvas, img);
    const tex = new THREE.DataTexture(bleedEdges(canvas), SIZE, SIZE, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    mat.map = tex;
    mat.needsUpdate = true;
  };
  img.src = `${base}textures/leaves_scrub.webp`;
  return material;
}

/** Five crossed cards round a vertical axis, 1 unit tall. Normals point up, so they light softly from any side. */
export function bushGeometry() {
  if (geometry) return geometry;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.PlaneGeometry(1.5, 1);
    g.translate(0, 0.5, 0);
    g.rotateY((i * Math.PI) / 5);
    parts.push(g);
  }
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const g of parts) {
    const o = pos.length / 3;
    pos.push(...(g.attributes.position.array as Float32Array));
    uv.push(...(g.attributes.uv.array as Float32Array));
    const tris = Array.from(g.index!.array as Uint16Array, (v) => v + o);
    // Each card twice, front and back, both lit from above. (Drawing one side as
    // double-sided would flip the back's normal downwards and turn it nearly black.)
    idx.push(...tris);
    for (let t = 0; t < tris.length; t += 3) idx.push(tris[t], tris[t + 2], tris[t + 1]);
  }
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(idx);
  geometry.userData.shared = true;
  return geometry;
}
