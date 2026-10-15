import * as THREE from 'three';
import { particleTexture } from '../util/textures';

/** One pooled point-sprite system (CPU-updated; a few hundred particles max). */
class Pool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private baseAlpha: Float32Array;
  private next = 0;

  constructor(private readonly max: number, additive: boolean, private readonly gravity: number, private readonly drag: number) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: particleTexture() }, scale: { value: 600 } },
      vertexShader: `
        attribute vec4 aColor; attribute float aSize; uniform float scale; varying vec4 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * scale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec4 vColor;
        void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  setScale(s: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = s;
  }

  emit(p: THREE.Vector3Like, v: THREE.Vector3Like, color: THREE.Color, size: number, life: number, grow = 0, alpha = 1) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b, alpha], i * 4);
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = grow;
    this.baseAlpha[i] = alpha;
  }

  update(dt: number) {
    const { pos, vel, life, col, size } = this;
    const damp = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) {
        col[i * 4 + 3] = 0;
        continue;
      }
      life[i] -= dt;
      const o = i * 3;
      vel[o + 1] -= this.gravity * dt;
      vel[o] *= damp; vel[o + 1] *= damp; vel[o + 2] *= damp;
      pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
      size[i] += this.grow[i] * dt;
      const t = Math.max(0, life[i] / this.maxLife[i]);
      col[i * 4 + 3] = this.baseAlpha[i] * Math.min(1, t * 2);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
}

const c = new THREE.Color();
const v = new THREE.Vector3();
const rnd = (a: number) => (Math.random() - 0.5) * 2 * a;

export class Particles {
  readonly group = new THREE.Group();
  private smoke = new Pool(260, false, -1.2, 0.8);
  private sparks = new Pool(220, true, 9.8, 0.3);
  private bits = new Pool(260, false, 9.8, 0.2); // glass, splinters, dust chunks
  private puffs = new Pool(260, false, 1.5, 2.5); // dust, spray

  constructor() {
    for (const p of [this.smoke, this.sparks, this.bits, this.puffs]) this.group.add(p.points);
  }

  setViewportHeight(px: number) {
    for (const p of [this.smoke, this.sparks, this.bits, this.puffs]) p.setScale(px * 0.9);
  }

  /** Engine smoke: grey, gets darker as damage gets worse. */
  smokePuff(at: THREE.Vector3, darkness: number) {
    const g = 0.75 - darkness * 0.45;
    this.smoke.emit(at, v.set(rnd(0.4), 1.2 + Math.random(), rnd(0.4)), c.setRGB(g, g, g), 0.5, 2.2, 0.9, 0.55);
  }

  sparksAt(at: THREE.Vector3Like, n: number, base: THREE.Vector3Like = { x: 0, y: 0, z: 0 }) {
    for (let i = 0; i < n; i++)
      this.sparks.emit(at, v.set(base.x + rnd(5), base.y + Math.random() * 5, base.z + rnd(5)), c.setRGB(1, 0.75 + Math.random() * 0.25, 0.3), 0.09, 0.4 + Math.random() * 0.4);
  }

  glass(at: THREE.Vector3Like, n: number, base: THREE.Vector3Like) {
    for (let i = 0; i < n; i++)
      this.bits.emit(at, v.set(base.x + rnd(3), base.y + Math.random() * 3, base.z + rnd(3)), c.setRGB(0.75, 0.9, 1), 0.07, 1.2, 0, 0.9);
  }

  splinters(at: THREE.Vector3Like, n: number, color: number) {
    c.setHex(color);
    for (let i = 0; i < n; i++) this.bits.emit(at, v.set(rnd(4), Math.random() * 5, rnd(4)), c, 0.12, 1.4);
  }

  dust(at: THREE.Vector3Like, color: number, size = 0.9) {
    c.setHex(color);
    this.puffs.emit(at, v.set(rnd(0.8), 0.6 + Math.random() * 0.6, rnd(0.8)), c, size * 0.7, 0.9, 1.0, 0.32);
  }

  spray(at: THREE.Vector3Like, up = 4) {
    for (let i = 0; i < 2; i++)
      this.puffs.emit(at, v.set(rnd(1.5), up + Math.random() * 2, rnd(1.5)), c.setRGB(0.85, 0.93, 1), 0.5, 1.0, 0.8, 0.6);
  }

  update(dt: number) {
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.bits.update(dt);
    this.puffs.update(dt);
  }
}
