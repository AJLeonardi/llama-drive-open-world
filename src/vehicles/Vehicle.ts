import * as THREE from 'three';
import { Physics } from '../physics/Physics';
import type { Impact } from '../physics/Impacts';
import {
  MAX_CRUSH, MAX_HEALTH, PART_LIMITS, applyDamage, carDamage, damageStage, dentDepth, dentRadius,
  handicapFor, impactDeltaV, misfireChancePerSecond,
} from '../damage/Damage';
import { dentGeometry, scuffGeometry, tearGeometry } from '../damage/Deformer';
import type { Debris } from '../fx/Debris';
import type { Particles } from '../fx/Particles';
import { COCKPIT_HIDDEN, CarModel, CarPart, carMaterials } from './CarModel';
import { buildCar } from './builders';
import { Gearbox } from './Gearbox';
import { DriveInput, VehicleSim, WorldQueries } from './VehicleSim';
import { CarId, SPECS, VehicleSpec } from './VehicleSpec';

/** Hits harder than this (velocity change, m/s; ~27 mph) can tear crushed bodywork open. */
const TEAR_DV = 12;
const m4 = new THREE.Matrix4();
const inv = new THREE.Matrix4();
const pLocal = new THREE.Vector3();
const dLocal = new THREE.Vector3();
const qTmp = new THREE.Quaternion();
const vTmp = new THREE.Vector3();
const boxTmp = new THREE.Box3();
const partInv = new THREE.Matrix4();
const partPoint = new THREE.Vector3();
const partDir = new THREE.Vector3();
const partQuat = new THREE.Quaternion();

export interface CrashResult {
  damage: number;
  dv: number;
  partsLost: string[];
  glassBroke: boolean;
}

export class Vehicle {
  readonly spec: VehicleSpec;
  readonly sim: VehicleSim;
  readonly model: CarModel;
  readonly gearbox: Gearbox;
  health = MAX_HEALTH;
  /** Accumulated hits on the left (+x) and right (-x) sides; steering pulls toward the worse side. */
  private wheelDamage = [0, 0, 0, 0];
  private misfire = 0;
  /** Set during the step a misfire starts (audio plays a backfire). */
  misfiredThisStep = false;
  private time = 0;
  /** How much the front and back have been shortened by head-on hits (m). */
  private crushed = { front: 0, back: 0 };
  /** Car-local z of the very front and back (for crumple zones). */
  private extent = { front: 2, back: -2 };

  // Interpolation between fixed physics steps.
  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private currQuat = new THREE.Quaternion();

  constructor(physics: Physics, scene: THREE.Scene, id: CarId, x: number, y: number, z: number, heading: number) {
    this.spec = SPECS[id];
    this.sim = new VehicleSim(physics, this.spec, x, y, z, heading);
    this.model = buildCar(id);
    this.gearbox = new Gearbox(this.spec.engine, this.spec.topSpeed);
    const box = new THREE.Box3().setFromObject(this.model.root);
    this.extent = { front: box.max.z, back: box.min.z };
    for (const p of this.model.parts) {
      p.mesh.geometry.computeBoundingBox();
    }
    scene.add(this.model.root);
    this.snapshot();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  get wrecked() {
    return this.health <= 0;
  }

  get stage() {
    return damageStage(this.health);
  }

  fixedUpdate(dt: number, input: DriveInput, q: WorldQueries) {
    this.time += dt;
    this.misfiredThisStep = false;
    if (this.misfire > 0) this.misfire -= dt;
    else if (Math.random() < misfireChancePerSecond(this.health) * dt) {
      this.misfire = 0.3;
      this.misfiredThisStep = true;
    }
    // Misfires are just for show (a backfire bang); damage never slows the car down.
    const hc = handicapFor(this.health);
    this.sim.update(dt, input, hc, q);
    this.gearbox.update(dt, this.sim.speed, hc.engineCut ? 0 : input.throttle);
  }

  /** Call after each physics step. */
  snapshot() {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    const t = this.sim.body.translation();
    const r = this.sim.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
  }

  /** Put the visual model where the car is (interpolated) and animate wheels. */
  render(alpha: number) {
    const root = this.model.root;
    root.position.lerpVectors(this.prevPos, this.currPos, alpha);
    root.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    const ctrl = this.sim.ctrl;
    const { suspensionRest } = this.spec;
    for (let i = 0; i < 4; i++) {
      const w = this.model.wheels[i];
      const rest = w.userData.rest as THREE.Vector3;
      const susp = ctrl.wheelSuspensionLength(i) ?? suspensionRest;
      w.position.y = rest.y + suspensionRest - susp;
      w.rotation.y = i < 2 ? this.sim.steerAngle : 0;
      const wob = this.wheelDamage[i] > PART_LIMITS.wheelWobble ? 0.12 * Math.min(1, this.wheelDamage[i] / 60) : 0;
      w.rotation.z = wob * Math.sin(this.time * 3 + i) * (i % 2 ? 1 : -1);
      w.children[0].rotation.x = ctrl.wheelRotation(i) ?? 0;
    }
    this.model.steeringWheel.rotation.z = -this.sim.steerAngle * 6;
    // Gauge needles sweep from bottom-left (0) clockwise to bottom-right (full scale).
    const g = this.model.gauges;
    if (g) {
      const sweep = (f: number) => (135 - 270 * Math.min(1, Math.max(0, f))) * (Math.PI / 180);
      g.speed.rotation.z = sweep(Math.abs(this.sim.speed) * 2.237 / 160);
      g.rpm.rotation.z = sweep(this.gearbox.rpm / 8000);
    }
    // Unlatched doors flap with the car's movement.
    const flap = Math.min(1, Math.abs(this.sim.speed) / 12);
    for (const p of this.model.parts) {
      if (!p.pivot || !p.popped || p.detached) continue;
      const t = p.pivot.userData.target as number;
      if (p.swing === 'door') {
        const wobble = Math.sin(this.time * 7 + p.center.z * 3) * 0.14 * flap;
        p.pivot.rotation.y += (t + wobble - p.pivot.rotation.y) * 0.2;
      } else {
        const wobble = p.swing === 'up' ? Math.sin(this.time * 6) * 0.08 * flap : 0;
        p.pivot.rotation.x += (t + wobble - p.pivot.rotation.x) * 0.25;
        p.pivot.rotation.z += ((p.pivot.userData.twist as number) - p.pivot.rotation.z) * 0.25;
      }
    }
  }

  /** Apply a crash to the car: health, dents, parts falling off, glass. */
  applyImpact(impact: Impact, particles: Particles, debris: Debris): CrashResult {
    const { mass, durability } = this.spec;
    const dv = impactDeltaV(impact.impulse, mass);
    const damage = carDamage(impact.impulse, mass, durability);
    this.health = applyDamage(this.health, damage);
    const result: CrashResult = { damage, dv, partsLost: [], glassBroke: false };
    if (dv < 1.5) return result;

    // World → car-local, using the current physics transform.
    m4.compose(this.currPos, this.currQuat, vTmp.set(1, 1, 1));
    inv.copy(m4).invert();
    pLocal.set(impact.point.x, impact.point.y, impact.point.z).applyMatrix4(inv);
    qTmp.copy(this.currQuat).invert();
    dLocal.set(-impact.normal.x, -impact.normal.y, -impact.normal.z).applyQuaternion(qTmp).normalize();


    const depth = dentDepth(dv);
    const radius = dentRadius(dv);
    const vel = this.sim.body.linvel();
    const frontHit = pLocal.z > this.spec.wheelbase / 2 - 0.2;
    const worldPoint = new THREE.Vector3(impact.point.x, impact.point.y, impact.point.z);
    const worldDir = new THREE.Vector3(-impact.normal.x, -impact.normal.y, -impact.normal.z);
    this.model.root.updateMatrixWorld(true);
    for (const part of this.model.parts) {
      if (part.detached || part.kind === 'interior') continue;
      // Work in the part's own space (hinged parts like the hood can be swung open).
      partInv.copy(part.mesh.matrixWorld).invert();
      partPoint.copy(worldPoint).applyMatrix4(partInv);
      part.mesh.getWorldQuaternion(partQuat).invert();
      partDir.copy(worldDir).applyQuaternion(partQuat).normalize();
      const geo = part.mesh.geometry;
      boxTmp.copy(geo.boundingBox!);
      const dist = boxTmp.distanceToPoint(partPoint);
      if (dist > radius * 1.25) continue;
      if (part.kind !== 'glass' && !part.light) {
        // Paint scraped down to bare metal around the hit (wider than the dent itself).
        scuffGeometry(geo, part.original, partPoint, radius * 1.15, Math.min(0.9, dv / 20));
      }
      if (dist > radius) continue;
      const near = 1 - dist / radius;
      part.damage += dv * near;
      if (part.kind !== 'glass') {
        const body = part.kind === 'body';
        if (dentGeometry(geo, part.original, partPoint, partDir, depth * (body ? 1 : 1.2), radius, body ? MAX_CRUSH.body : MAX_CRUSH.panel)) {
          geo.computeVertexNormals(); // keep the smooth shading following the crumpled shape
          geo.computeBoundingBox();
        }
      }
      // A crumpled hood buckles and pops open on its hinge, showing the engine; a battered
      // door comes unlatched and swings open (it flaps about as you drive, until a harder
      // hit tears it off).
      if (part.pivot && !part.popped && !part.detached) {
        if (part.swing === 'hood' && frontHit && part.damage > 5) {
          part.popped = true;
          part.pivot.userData.target = -(0.3 + Math.min(0.6, dv * 0.02) + Math.random() * 0.15);
          part.pivot.userData.twist = (Math.random() - 0.5) * 0.25;
        } else if (part.swing !== 'hood' && part.damage > PART_LIMITS.detach * 0.45) {
          part.popped = true;
          const side = part.center.x > 0 ? 1 : -1;
          part.pivot.userData.target = part.swing === 'door' ? -side * (0.45 + Math.random() * 0.6) : 0.6 + Math.random() * 0.4;
          part.pivot.userData.twist = 0;
        }
      }
      // Really hard hits rip holes in crushed bodywork, throwing out bits of sheet metal.
      if ((part.kind === 'body' || part.kind === 'panel') && dv > TEAR_DV) {
        const t = tearGeometry(geo, part.original, partPoint, radius * 0.8, Math.min(0.85, (dv - TEAR_DV) / 18));
        if (t.torn > 0) this.shards(part, t.center, Math.min(5, 1 + Math.floor(t.torn / 8)), vel, debris);
      }
      this.updatePartState(part, particles, debris, vel, result);
    }

    // Head-on hits shorten the front (or back) of the car: a crumple zone.
    if (dv > 7 && Math.abs(dLocal.z) > 0.65) {
      const end = pLocal.z > 0 ? 1 : -1;
      if (dLocal.z * end < 0) this.crumple(end, (dv - 6) * 0.032);
    }

    // Wheels near the hit get bent.
    for (let i = 0; i < 4; i++) {
      const w = this.model.wheels[i].userData.rest as THREE.Vector3;
      const d = w.distanceTo(pLocal);
      if (d < radius + 0.6) this.wheelDamage[i] += dv * (1 - d / (radius + 0.6));
    }

    if (dv > 3 && impact.other?.material !== 'wood') {
      particles.sparksAt(impact.point, Math.min(40, Math.round(dv * 2)));
    }
    return result;
  }

  private updatePartState(part: CarPart, particles: Particles, debris: Debris, vel: THREE.Vector3Like, result: CrashResult) {
    if (part.light) {
      if (!part.cracked && part.damage > 3) {
        part.cracked = true;
        part.mesh.material = carMaterials().brokenLight;
        particles.glass(part.center.clone().applyMatrix4(this.model.root.matrixWorld), 12, vel);
        result.glassBroke = true;
      }
      return;
    }
    if (part.kind === 'glass') {
      if (!part.cracked && part.damage > PART_LIMITS.glassCrack) {
        part.cracked = true;
        // (In the cockpit view setCockpitView swaps this for the see-through cracked glass.)
        part.mesh.material = this.model.tintedGlass ? carMaterials().glassCrackedTinted : carMaterials().glassCracked;
        result.glassBroke = true;
      }
      if (part.damage > PART_LIMITS.glassShatter && part.mesh.visible) {
        // Shattered: the glass is gone, tiny pieces fly out (no sharp detail, just sparkles).
        part.mesh.visible = false;
        part.detached = true;
        const c = part.center.clone().applyMatrix4(this.model.root.matrixWorld);
        particles.glass(c, 40, vel);
        result.glassBroke = true;
      }
      return;
    }
    // Hinged parts hang on longer: a hood stays (open) through a lot, a door swings
    // open first and only tears off with more punishment.
    const toughness = part.swing === 'hood' ? 2.5 : part.swing ? 1.7 : 1;
    if (part.detachable && part.damage > PART_LIMITS.detach * toughness) {
      part.detached = true;
      result.partsLost.push(part.name);
      this.model.root.updateMatrixWorld(true);
      debris.release(part.mesh, vel, 4, true, part.sound === 'plastic' ? 'plastic' : 'metal');
    }
  }

  /**
   * Crumple zone: shorten the front (end = 1) or back (-1) of the car by `amount` more
   * metres (up to a limit). Everything in the last ~1.3 m moves back — the very end
   * most — and the squashed metal bunches into folds. Works in car space for every
   * part (bumpers, lights, grille, hood, engine, frame), however they're hinged.
   */
  private crumple(end: 1 | -1, amount: number) {
    const key = end > 0 ? 'front' : 'back';
    const prev = this.crushed[key];
    const next = Math.min(0.85, prev + amount);
    const d = next - prev;
    if (d < 0.01) return;
    this.crushed[key] = next;
    const zEnd = end > 0 ? this.extent.front : this.extent.back;
    const L = 1.3;
    const root = this.model.root;
    root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const toCar = new THREE.Matrix4(), toPart = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const part of this.model.parts) {
      if (part.detached || part.kind === 'interior' || part.kind === 'glass') continue;
      toCar.multiplyMatrices(rootInv, part.mesh.matrixWorld);
      toPart.copy(toCar).invert();
      const geo = part.mesh.geometry;
      const pos = geo.attributes.position as THREE.BufferAttribute;
      let moved = false;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(toCar);
        const t = (v.z * end - (zEnd * end - L)) / L;
        if (t <= 0) continue;
        const k = Math.min(1, t);
        v.z -= end * d * k ** 1.3;
        // Bunched-up folds: the squashed metal buckles up and out a little.
        const w = Math.sin(k * Math.PI * 5 + v.x * 4) * d * 0.13 * (1 - k * 0.3);
        v.y += w;
        v.x += Math.sign(v.x) * Math.abs(w) * 0.6;
        v.applyMatrix4(toPart);
        pos.setXYZ(i, v.x, v.y, v.z);
        moved = true;
      }
      if (moved) {
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
      }
    }
  }

  /** Bits of torn sheet metal flying off, in the part's paint colour. */
  private shards(part: CarPart, at: THREE.Vector3, n: number, vel: THREE.Vector3Like, debris: Debris) {
    const col = part.mesh.geometry.attributes.color as THREE.BufferAttribute | undefined;
    const c = new THREE.Color(col ? col.getX(0) : 0.8, col ? col.getY(0) : 0.8, col ? col.getZ(0) : 0.8);
    // Prefer the colour of the metal right where it tore.
    if (col) {
      const pos = part.mesh.geometry.attributes.position;
      let best = Infinity;
      for (let i = 0; i < pos.count; i += 7) {
        const d = (pos.getX(i) - at.x) ** 2 + (pos.getY(i) - at.y) ** 2 + (pos.getZ(i) - at.z) ** 2;
        if (d < best) (best = d), c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      }
    }
    part.mesh.updateWorldMatrix(true, false);
    const world = at.clone().applyMatrix4(part.mesh.matrixWorld);
    for (let i = 0; i < n; i++) {
      const w = 0.2 + Math.random() * 0.35, h = 0.15 + Math.random() * 0.3;
      const g = new THREE.PlaneGeometry(w, h, 2, 2);
      // A little bent, like torn sheet metal.
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) p.setZ(k, (Math.random() - 0.5) * 0.06 + p.getX(k) * p.getY(k) * 0.6);
      g.computeVertexNormals();
      const cols = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) cols.set([c.r, c.g, c.b], k * 3);
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const mesh = new THREE.Mesh(g, carMaterials().paint);
      mesh.position.copy(world).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.4, (Math.random() - 0.5) * 0.6));
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.model.root.parent?.add(mesh);
      debris.release(mesh, vel, 5, true, 'metal', 150);
    }
  }

  /** Cockpit view hides the roof and pillars to show more of the world (and clears tinted windows). */
  setCockpitView(on: boolean) {
    const mats = carMaterials();
    for (const p of this.model.parts) {
      if (COCKPIT_HIDDEN.has(p.name) && !p.detached) p.mesh.visible = !on;
      // Tinted from outside; see-through from the driver's seat (cracked or not).
      if (this.model.tintedGlass && p.kind === 'glass' && !p.detached) {
        p.mesh.material = p.cracked ? (on ? mats.glassCracked : mats.glassCrackedTinted) : on ? mats.glass : mats.glassTinted;
      }
    }
  }

  /** World position of the smoke outlet. */
  smokeOrigin(out: THREE.Vector3) {
    return out.copy(this.model.smokePoint).applyMatrix4(this.model.root.matrixWorld);
  }

  dispose() {
    this.sim.dispose();
    this.model.root.removeFromParent();
    this.model.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }
}
