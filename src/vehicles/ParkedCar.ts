// Empty parked cars (and junkers in the demolition park) that dent when hit.
import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { dentDepth, dentRadius, objectDamage } from '../damage/Damage';
import { dentGeometry, scuffGeometry } from '../damage/Deformer';
import { blob, cyl, keyframes, latheX, merge, rbox, sculpt } from './builders/geo';
import { carMaterials } from './CarModel';
import type { Particles } from '../fx/Particles';

export type ParkedStyle = 'sedan' | 'taxi' | 'van' | 'junk';

const DIMS: Record<ParkedStyle, { hx: number; hy: number; hz: number; cy: number; mass: number }> = {
  sedan: { hx: 0.9, hy: 0.62, hz: 2.3, cy: 0.82, mass: 1400 },
  taxi: { hx: 0.9, hy: 0.62, hz: 2.4, cy: 0.82, mass: 1500 },
  van: { hx: 1.0, hy: 1.05, hz: 2.6, cy: 1.25, mass: 2200 },
  // Junkers are stripped-out shells: light, so plowing through them wrecks them, not you.
  junk: { hx: 0.9, hy: 0.62, hz: 2.3, cy: 0.82, mass: 650 },
};
/** Impulse that fully wrecks a parked car (scaled by the hitting car's mass). */
const TOUGHNESS = 32000;
const JUNK_TOUGHNESS = 9000;

const shared = new Map<string, THREE.BufferGeometry>();

function wheelsFor(track: number, wb: number, r: number) {
  const out: THREE.BufferGeometry[] = [];
  for (const x of [track / 2, -track / 2])
    for (const z of [wb / 2, -wb / 2]) {
      const side = Math.sign(x);
      out.push(latheX([[r * 0.62, -0.11], [r * 0.95, -0.11], [r, -0.05], [r, 0.05], [r * 0.95, 0.11], [r * 0.62, 0.11]], 12, [x, r, z], 0x1a1a1a));
      out.push(cyl({ at: [x + side * 0.1, r, z], radius: r * 0.6, length: 0.03, axis: 'x', segments: 10, color: 0xb8bcc2 }));
    }
  return out;
}

const GLASS = 0x46586a;

function geometryFor(style: ParkedStyle, color: number): THREE.BufferGeometry {
  const key = `${style}-${color}`;
  const hit = shared.get(key);
  if (hit) return hit;
  let g: THREE.BufferGeometry;
  if (style === 'van') {
    const body = sculpt({
      z0: -2.6, z1: 2.6, step: 0.3, round: 1, arches: [[1.7, 0.45, 0.38], [-1.7, 0.45, 0.38]],
      at: keyframes([
        { z: -2.6, y0: 0.4, ys: 1.4, y1: 2.25, wB: 0.96, wM: 0.98, wT: 0.92 },
        { z: 1.5, y0: 0.38, ys: 1.4, y1: 2.3, wB: 0.98, wM: 1.0, wT: 0.94 },
        { z: 2.15, y0: 0.38, ys: 1.2, y1: 1.6, wB: 0.98, wM: 0.99, wT: 0.92 },
        { z: 2.6, y0: 0.42, ys: 0.9, y1: 1.15, wB: 0.95, wM: 0.96, wT: 0.9 },
      ]),
      color: (x, y, z) => (z > 1.55 && y > 1.35 && y < 2.2 ? GLASS : Math.abs(x) > 0.9 && y > 1.5 && y < 2.0 && z > 0.6 && z < 1.4 ? GLASS : y < 0.55 ? 0x2a2a2a : color),
    });
    g = merge([body, ...wheelsFor(1.72, 3.4, 0.38)]);
  } else {
    const c = style === 'taxi' ? 0xf6c21c : color;
    const body = sculpt({
      z0: -2.3, z1: 2.32, step: 0.24, round: 1, arches: [[1.4, 0.42, 0.33], [-1.4, 0.42, 0.33]],
      at: keyframes([
        { z: -2.3, y0: 0.42, ys: 0.75, y1: 0.95, wB: 0.82, wM: 0.86, wT: 0.8 },
        { z: -1.9, y0: 0.35, ys: 0.75, y1: 1.0, wB: 0.86, wM: 0.9, wT: 0.82 },
        { z: 1.6, y0: 0.35, ys: 0.72, y1: 0.92, wB: 0.86, wM: 0.9, wT: 0.82 },
        { z: 2.32, y0: 0.4, ys: 0.65, y1: 0.8, wB: 0.8, wM: 0.84, wT: 0.76 },
      ]),
      color: (_x, y) => (y < 0.45 ? 0x2a2a2a : c),
    });
    const cabin = sculpt({
      z0: -1.5, z1: 1.15, step: 0.3, round: 1,
      at: keyframes([
        { z: -1.5, y0: 0.94, ys: 0.96, y1: 0.98, wB: 0.82, wM: 0.82, wT: 0.8 },
        { z: -0.95, y0: 0.94, ys: 1.05, y1: 1.42, wB: 0.82, wM: 0.8, wT: 0.68 },
        { z: 0.45, y0: 0.92, ys: 1.05, y1: 1.43, wB: 0.82, wM: 0.8, wT: 0.68 },
        { z: 1.15, y0: 0.9, ys: 0.92, y1: 0.94, wB: 0.82, wM: 0.82, wT: 0.8 },
      ]),
      color: (_x, y, z) => (y > 1.37 && z > -0.8 && z < 0.35 ? c : GLASS),
    });
    const parts = [
      body, cabin,
      blob([0.6, 0.72, 2.27], [0.18, 0.06, 0.05], 0xfff5d0, 6),
      blob([-0.6, 0.72, 2.27], [0.18, 0.06, 0.05], 0xfff5d0, 6),
      blob([0.62, 0.8, -2.29], [0.16, 0.05, 0.04], 0xcc1111, 6),
      blob([-0.62, 0.8, -2.29], [0.16, 0.05, 0.04], 0xcc1111, 6),
      rbox({ at: [0, 0.48, 2.34], size: [1.7, 0.16, 0.1], radius: 0.04, color: 0x2a2a2a }),
      rbox({ at: [0, 0.5, -2.32], size: [1.66, 0.16, 0.1], radius: 0.04, color: 0x2a2a2a }),
      ...wheelsFor(1.6, 2.8, 0.33),
    ];
    if (style === 'taxi') parts.push(rbox({ at: [0, 1.53, -0.2], size: [0.62, 0.18, 0.22], radius: 0.04, color: 0xfdfbe8 }));
    g = merge(parts);
  }
  shared.set(key, g);
  return g;
}

export class ParkedCar {
  readonly mesh: THREE.Mesh;
  /** Physics body — only while near the player (see World.update). */
  body: RAPIER.RigidBody | null = null;
  private readonly dims: (typeof DIMS)[ParkedStyle];
  hp = 100;
  private original: Float32Array | null = null;
  private ownGeometry = false;
  readonly mass: number;
  readonly junk: boolean;

  constructor(private readonly physics: Physics, style: ParkedStyle, color: number, x: number, y: number, z: number, heading: number, wrecked = false) {
    const d = DIMS[style];
    this.mass = d.mass;
    this.junk = style === 'junk';
    this.mesh = new THREE.Mesh(geometryFor(style, color), carMaterials().paint);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.dims = d;
    this.mesh.position.set(x, y, z);
    this.mesh.quaternion.set(0, Math.sin(heading / 2), 0, Math.cos(heading / 2));
    this.mesh.updateMatrixWorld();
    if (wrecked) {
      // Junkers start out pre-crumpled.
      for (let i = 0; i < 4; i++) {
        const side = i % 2 ? 1 : -1;
        this.dentLocal(new THREE.Vector3(side * d.hx, d.cy + 0.2, (Math.random() - 0.5) * d.hz * 1.6), new THREE.Vector3(-side, -0.2, 0).normalize(), 0.18, 0.9);
      }
      this.hp = 70;
    }
  }

  private dentLocal(p: THREE.Vector3, dir: THREE.Vector3, depth: number, radius: number) {
    if (!this.ownGeometry) {
      this.mesh.geometry = this.mesh.geometry.clone();
      this.ownGeometry = true;
      this.original = (this.mesh.geometry.attributes.position.array as Float32Array).slice();
    }
    if (dentGeometry(this.mesh.geometry, this.original!, p, dir, depth, radius, 0.5)) this.mesh.geometry.computeVertexNormals();
  }

  /** Create the physics body at the car's current pose. */
  activate() {
    if (this.body) return;
    const d = this.dims, p = this.mesh.position, q = this.mesh.quaternion;
    this.body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation(q).setSleeping(true).setAngularDamping(0.5).setLinearDamping(0.3),
    );
    const col = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(d.hx, d.hy, d.hz).setTranslation(0, d.cy, 0).setMass(d.mass).setFriction(0.9).setRestitution(0.1),
      this.body,
    );
    this.physics.setOwner(col, { kind: 'parked', material: 'metal', ref: this });
  }

  /** Remove the body (only when at rest), keeping the mesh where it is. */
  deactivate() {
    if (!this.body || !this.body.isSleeping()) return;
    this.sync(true);
    this.physics.removeBody(this.body);
    this.body = null;
  }

  hit(impulse: number, carMass: number, point: THREE.Vector3Like, normal: THREE.Vector3Like, particles: Particles) {
    this.hp -= objectDamage(impulse, carMass, this.junk ? JUNK_TOUGHNESS : TOUGHNESS);
    const dv = impulse / this.mass;
    if (dv < 1) return;
    // Normal points from the player's car toward this car — push the dent along it.
    this.mesh.updateMatrixWorld();
    const inv = this.mesh.matrixWorld.clone().invert();
    const p = new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(inv);
    const q = this.mesh.quaternion.clone().invert();
    const dir = new THREE.Vector3(normal.x, normal.y, normal.z).applyQuaternion(q).normalize();
    this.dentLocal(p, dir, dentDepth(dv * 1.2), dentRadius(dv));
    scuffGeometry(this.mesh.geometry, this.original!, p, dentRadius(dv) * 1.3, Math.min(1, dv / 10));
    if (dv > 3) particles.sparksAt(point, Math.min(30, Math.round(dv * 2)));
  }

  get wrecked() {
    return this.hp <= 0;
  }

  /** Copy the physics transform to the mesh. Returns false if nothing moved. */
  sync(force = false) {
    if (!this.body || (!force && this.body.isSleeping())) return false;
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    return true;
  }

  smokePoint(out: THREE.Vector3) {
    return out.set(0, 1.0, 1.8).applyMatrix4(this.mesh.matrixWorld);
  }

  dispose() {
    if (this.body) this.physics.removeBody(this.body);
    this.body = null;
    this.mesh.removeFromParent();
    if (this.ownGeometry) this.mesh.geometry.dispose();
  }
}
