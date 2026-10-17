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
  private fire = new Pool(240, true, -3, 2.2); // explosions: glowing, rising, slowing fast
  private pools = [this.smoke, this.sparks, this.bits, this.puffs, this.fire];

  constructor() {
    for (const p of this.pools) this.group.add(p.points);
  }

  setViewportHeight(px: number) {
    for (const p of this.pools) p.setScale(px * 0.9);
  }

  /** Big cartoon fireball: a flash, rolling flames, sparks, flying bits and a smoke column. */
  explosion(at: THREE.Vector3Like) {
    this.fire.emit(at, v.set(0, 1, 0), c.setRGB(1, 0.95, 0.75), 7, 0.25, 10, 1);
    for (let i = 0; i < 26; i++) {
      const s = 7 + Math.random() * 7;
      const hot = Math.random();
      this.fire.emit(
        { x: at.x + rnd(0.8), y: at.y + Math.random() * 0.8, z: at.z + rnd(0.8) },
        v.set(rnd(1), 0.3 + Math.random(), rnd(1)).normalize().multiplyScalar(s),
        c.setRGB(1, 0.35 + hot * 0.5, 0.05 + hot * 0.15), 1.6 + Math.random() * 1.6, 0.55 + Math.random() * 0.5, 2.5, 0.9,
      );
    }
    for (let i = 0; i < 40; i++)
      this.sparks.emit(at, v.set(rnd(14), 4 + Math.random() * 14, rnd(14)), c.setRGB(1, 0.7 + Math.random() * 0.3, 0.25), 0.12, 0.6 + Math.random() * 0.8);
    for (let i = 0; i < 18; i++)
      this.bits.emit(at, v.set(rnd(9), 5 + Math.random() * 9, rnd(9)), c.setRGB(0.25, 0.08, 0.06), 0.16, 1.6);
    for (let i = 0; i < 14; i++) {
      const g = 0.18 + Math.random() * 0.15;
      this.smoke.emit({ x: at.x + rnd(1.5), y: at.y + 1 + Math.random() * 2, z: at.z + rnd(1.5) }, v.set(rnd(1.5), 2 + Math.random() * 3, rnd(1.5)), c.setRGB(g, g, g), 1.8, 3 + Math.random() * 1.5, 1.6, 0.7);
    }
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

  /** Rocket exhaust at the nozzle (`k` 0..1 thrust): hot flame shooting down and out. */
  rocketExhaust(at: THREE.Vector3Like, k: number) {
    for (let i = 0; i < 3; i++) {
      const hot = Math.random();
      this.fire.emit({ x: at.x + rnd(1.2), y: at.y, z: at.z + rnd(1.2) }, v.set(rnd(3), -14 - Math.random() * 10, rnd(3)).multiplyScalar(k),
        c.setRGB(1, 0.5 + hot * 0.4, 0.15 + hot * 0.2), 2.2 + Math.random() * 1.5, 0.45 + Math.random() * 0.3, 2, 0.9);
    }
  }

  /** Billowing smoke rolling out across the ground from under a launching rocket. */
  launchCloud(at: THREE.Vector3Like, n = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 6 + Math.random() * 12, g = 0.78 + Math.random() * 0.17;
      this.smoke.emit({ x: at.x + Math.cos(a) * 3, y: at.y + 1 + Math.random() * 2, z: at.z + Math.sin(a) * 3 },
        v.set(Math.cos(a) * sp, 0.5 + Math.random() * 2, Math.sin(a) * sp), c.setRGB(g, g, g), 4 + Math.random() * 3, 3 + Math.random() * 2.5, 2.4, 0.75);
    }
  }

  /** A space thruster's jet: a little blue-white flame going out along `dir` (m/s). */
  jet(at: THREE.Vector3Like, dir: THREE.Vector3Like) {
    this.fire.emit(at, v.set(dir.x + rnd(0.6), dir.y + rnd(0.6), dir.z + rnd(0.6)), c.setRGB(0.45, 0.8, 1), 0.45, 0.22, 1.2, 0.85);
  }

  /** A burst of glitter (flying through a ring, bouncing off the net). */
  sparkle(at: THREE.Vector3Like, n: number, color = 0xffd23a) {
    for (let i = 0; i < n; i++) {
      c.setHex(color).offsetHSL(rnd(0.05), 0, rnd(0.1));
      this.sparks.emit(at, v.set(rnd(9), rnd(9), rnd(9)), c, 0.18, 0.6 + Math.random() * 0.6);
    }
  }

  update(dt: number) {
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.bits.update(dt);
    this.puffs.update(dt);
    this.fire.update(dt);
  }
}
