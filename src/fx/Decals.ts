import * as THREE from 'three';
import { crackTexture } from '../util/textures';

const MAX = 40;

/** Crack marks left on walls the car slams into (buildings themselves don't break). */
export class Decals {
  readonly group = new THREE.Group();
  private pool: THREE.Mesh[] = [];
  private next = 0;

  constructor() {
    const mat = new THREE.MeshBasicMaterial({
      map: crackTexture(false), color: 0x222222, transparent: true, opacity: 0.9, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < MAX; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.pool.push(m);
      this.group.add(m);
    }
  }

  /** `normal` points from the car toward the wall. */
  crack(point: THREE.Vector3Like, normal: THREE.Vector3Like, size: number) {
    const m = this.pool[this.next];
    this.next = (this.next + 1) % MAX;
    const n = new THREE.Vector3(-normal.x, -normal.y, -normal.z).normalize();
    m.position.set(point.x, point.y, point.z).addScaledVector(n, 0.03);
    m.lookAt(m.position.clone().add(n));
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(size);
    m.visible = true;
  }

  clear() {
    for (const m of this.pool) m.visible = false;
  }
}
