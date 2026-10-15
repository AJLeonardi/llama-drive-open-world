import * as THREE from 'three';
import { BUILDING_TOUGHNESS, objectDamage } from '../damage/Damage';
import type { BuildingInfo } from '../world/buildings';
import { wallDamageTexture } from '../util/textures';
import type { Debris } from './Debris';
import type { Particles } from './Particles';

/** Damage marks on one building, so repeated hits near the same spot make it worse. */
interface Spot {
  pos: THREE.Vector3;
  stage: 0 | 1 | 2;
  size: number;
  mesh: THREE.Mesh;
}

interface BuildingState {
  hp: number;
  spots: Spot[];
}

interface Smoker {
  pos: THREE.Vector3;
  time: number;
  rate: number;
  acc: number;
}

const MAX_DECALS = 70;
const MAX_SMOKERS = 10;
const CHUNK_COLORS: Record<string, number[]> = {
  brick: [0x9a4a36, 0x7f3b2b, 0xb4a89a],
  brownstone: [0x7b4c3a, 0x5e3a2c, 0xa49a8e],
  glass: [0x9fb6c9, 0x6f8aa3, 0xd8e4ee],
  concrete: [0xb9b5ac, 0x99958d, 0x807c75],
  stone: [0xcdbf9c, 0xb0a283, 0x8f8470],
  pru: [0x3c3b39, 0x55524e, 0xa9afb5],
};

/**
 * Buildings don't fall down, but they show it: cracks that grow into smashed holes
 * when hit repeatedly in the same place, chunks and dust (or a burst of glass) flying
 * out, and smoke once a building has taken a real beating.
 */
export class BuildingDamage {
  readonly group = new THREE.Group();
  private buildings = new Map<number, BuildingState>();
  private decals: THREE.Mesh[] = [];
  private nextDecal = 0;
  private smokers: Smoker[] = [];
  private chunkGeo = new THREE.BoxGeometry(1, 1, 1);
  private chunkMats = new Map<number, THREE.Material>();
  private materials = new Map<string, THREE.MeshBasicMaterial>();

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.Mesh(geo, this.material(0, false));
      m.visible = false;
      m.renderOrder = 1;
      this.decals.push(m);
      this.group.add(m);
    }
  }

  private material(stage: 0 | 1 | 2, glass: boolean) {
    const key = `${stage}-${glass}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        map: wallDamageTexture(stage, glass), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        color: glass ? 0xffffff : 0xd8d8d8,
      });
      this.materials.set(key, m);
    }
    return m;
  }

  /**
   * The car hit a building. `normal` points from the car toward the wall.
   * Returns the building's remaining health (0..100) for sound/effects decisions.
   */
  hit(handle: number, info: BuildingInfo | undefined, point: THREE.Vector3Like, normal: THREE.Vector3Like,
    impulse: number, dv: number, carMass: number, particles: Particles, debris: Debris) {
    if (dv < 4) return 100;
    let b = this.buildings.get(handle);
    if (!b) this.buildings.set(handle, (b = { hp: 100, spots: [] }));
    b.hp = Math.max(0, b.hp - objectDamage(impulse, carMass, BUILDING_TOUGHNESS));
    const glass = info?.style === 'glass';
    const p = new THREE.Vector3(point.x, point.y, point.z);
    const n = new THREE.Vector3(-normal.x, -normal.y, -normal.z).normalize(); // out of the wall

    // Grow an existing mark nearby, or start a new one.
    const bump = dv > 22 ? 2 : dv > 10 ? 1 : 0;
    let spot = b.spots.find((s) => s.pos.distanceTo(p) < s.size * 0.6 + 1.5);
    if (spot) {
      spot.stage = Math.min(2, spot.stage + Math.max(1, bump)) as 0 | 1 | 2;
      spot.size = Math.min(9, spot.size + 0.6 + dv * 0.05);
    } else {
      spot = { pos: p.clone(), stage: bump as 0 | 1 | 2, size: 1.6 + dv * 0.09, mesh: this.decals[this.nextDecal] };
      this.nextDecal = (this.nextDecal + 1) % MAX_DECALS;
      // Steal the decal from whatever spot used it before.
      for (const other of this.buildings.values()) other.spots = other.spots.filter((s) => s.mesh !== spot!.mesh);
      b.spots.push(spot);
      const m = spot.mesh;
      m.position.copy(p).addScaledVector(n, 0.04);
      m.lookAt(m.position.clone().add(n));
      m.rotateZ(Math.random() * Math.PI * 2);
    }
    spot.mesh.material = this.material(spot.stage, glass);
    spot.mesh.scale.setScalar(spot.size);
    spot.mesh.visible = true;

    // Bits flying out of the wall.
    const colors = CHUNK_COLORS[info?.style ?? 'concrete'] ?? CHUNK_COLORS.concrete;
    const chunks = Math.min(12, Math.floor(dv / (glass ? 6 : 3)));
    for (let i = 0; i < chunks; i++) {
      const color = colors[i % colors.length];
      let mat = this.chunkMats.get(color);
      if (!mat) this.chunkMats.set(color, (mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 })));
      const mesh = new THREE.Mesh(this.chunkGeo, mat);
      const sz = 0.15 + Math.random() * (0.25 + dv * 0.01);
      mesh.scale.set(sz, sz * (0.5 + Math.random()), sz * (0.6 + Math.random() * 0.8));
      // Debris fits its collider to the geometry, so bake the scale into a private copy.
      mesh.geometry = this.chunkGeo.clone().scale(mesh.scale.x, mesh.scale.y, mesh.scale.z);
      mesh.scale.set(1, 1, 1);
      mesh.position.copy(p).addScaledVector(n, 0.3).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2));
      mesh.castShadow = true;
      this.group.add(mesh);
      mesh.updateMatrixWorld();
      const speed = 2 + dv * 0.12;
      debris.release(mesh, { x: n.x * speed, y: 1.5 + Math.random() * 2, z: n.z * speed }, 3, true, glass ? 'glass' : 'concrete', 900);
    }
    if (glass) particles.glass(p, Math.min(120, 20 + dv * 3), { x: n.x * 3, y: 1, z: n.z * 3 });
    for (let i = 0; i < Math.min(14, dv / 2); i++)
      particles.dust({ x: p.x + n.x * 0.5, y: p.y, z: p.z + n.z * 0.5 }, glass ? 0xdfe8ef : 0xb7b0a6, 1.2 + dv * 0.04);
    if (dv > 8) particles.sparksAt(p, Math.min(30, dv));

    // A building that's taken a beating starts smoking from the worst spot.
    if (b.hp < 55 && this.smokers.length < MAX_SMOKERS && !this.smokers.some((s) => s.pos.distanceTo(p) < 4)) {
      this.smokers.push({ pos: p.clone().addScaledVector(n, 0.5), time: 25, rate: b.hp < 20 ? 14 : 7, acc: 0 });
    }
    return b.hp;
  }

  update(dt: number, particles: Particles) {
    for (const s of this.smokers) {
      s.time -= dt;
      s.acc += dt * s.rate * Math.min(1, s.time / 5);
      while (s.acc > 1) {
        s.acc -= 1;
        particles.smokePuff(s.pos, 0.7);
      }
    }
    this.smokers = this.smokers.filter((s) => s.time > 0);
  }

  clear() {
    this.buildings.clear();
    this.smokers = [];
    for (const d of this.decals) d.visible = false;
  }
}
