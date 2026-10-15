import * as THREE from 'three';
import { paint } from '../vehicles/builders/geo';
import { particleTexture } from '../util/textures';

const FISH_COLORS = [0xff8c1a, 0xffd21a, 0x3fb6ff, 0xff4fa3, 0x7cff6b, 0xb07cff];

function fishGeometry(color: number) {
  const body = new THREE.SphereGeometry(0.35, 8, 6);
  body.scale(1, 0.75, 1.6);
  const tail = new THREE.ConeGeometry(0.3, 0.5, 4);
  tail.rotateX(-Math.PI / 2);
  tail.scale(0.3, 1.2, 1);
  tail.translate(0, 0, -0.75);
  const eyeL = new THREE.SphereGeometry(0.07, 6, 4);
  eyeL.translate(0.2, 0.08, 0.38);
  const eyeR = eyeL.clone();
  eyeR.translate(-0.4, 0, 0);
  return [paint(body, color), paint(tail, color), paint(eyeL, 0x111111), paint(eyeR, 0x111111)];
}

interface Fish {
  obj: THREE.Group;
  radius: number;
  speed: number;
  phase: number;
  height: number;
}

/**
 * "You drove into the water!" — a little school of fish swims around the sunken car
 * for a few seconds (no people, nothing scary) before the game restarts.
 */
export class Underwater {
  readonly group = new THREE.Group();
  private fish: Fish[] = [];
  private bubbles: THREE.Points;
  private bubblePos: Float32Array;
  private center = new THREE.Vector3();
  private t = 0;
  active = false;

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (let i = 0; i < 14; i++) {
      const obj = new THREE.Group();
      for (const g of fishGeometry(FISH_COLORS[i % FISH_COLORS.length])) obj.add(new THREE.Mesh(g, mat));
      const s = 0.7 + Math.random() * 0.8;
      obj.scale.setScalar(s);
      this.group.add(obj);
      this.fish.push({ obj, radius: 2.5 + Math.random() * 4, speed: (0.5 + Math.random() * 0.7) * (i % 2 ? 1 : -1), phase: Math.random() * 6.28, height: Math.random() * 2.5 });
    }
    this.bubblePos = new Float32Array(60 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.bubblePos, 3));
    this.bubbles = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xddf4ff, size: 0.18, map: particleTexture(), transparent: true, opacity: 0.85, depthWrite: false }));
    this.bubbles.frustumCulled = false;
    this.group.add(this.bubbles);
    this.group.visible = false;
  }

  start(center: THREE.Vector3) {
    this.center.copy(center);
    this.t = 0;
    this.active = true;
    this.group.visible = true;
    for (let i = 0; i < 60; i++) {
      this.bubblePos.set([center.x + (Math.random() - 0.5) * 3, center.y + Math.random() * 3, center.z + (Math.random() - 0.5) * 3], i * 3);
    }
  }

  stop() {
    this.active = false;
    this.group.visible = false;
  }

  update(dt: number) {
    if (!this.active) return;
    this.t += dt;
    for (const f of this.fish) {
      const a = f.phase + this.t * f.speed;
      const x = this.center.x + Math.cos(a) * f.radius, z = this.center.z + Math.sin(a) * f.radius;
      const y = this.center.y + 0.3 + f.height + Math.sin(this.t * 2 + f.phase) * 0.3;
      f.obj.position.set(x, y, z);
      // Face along the direction of travel, with a little wiggle.
      f.obj.rotation.y = -a + (f.speed > 0 ? 0 : Math.PI) + Math.sin(this.t * 10 + f.phase) * 0.2;
    }
    for (let i = 0; i < 60; i++) {
      this.bubblePos[i * 3 + 1] += dt * (0.8 + (i % 5) * 0.2);
      if (this.bubblePos[i * 3 + 1] > this.center.y + 4) this.bubblePos[i * 3 + 1] = this.center.y;
    }
    this.bubbles.geometry.attributes.position.needsUpdate = true;
  }
}
