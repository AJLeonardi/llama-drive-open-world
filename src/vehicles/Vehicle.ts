import * as THREE from 'three';
import { Physics } from '../physics/Physics';
import type { Impact } from '../physics/Impacts';
import {
  MAX_CRUSH, MAX_HEALTH, PART_LIMITS, applyDamage, carDamage, damageStage, dentDepth, dentRadius,
  handicapFor, impactDeltaV, misfireChancePerSecond,
} from '../damage/Damage';
import { dentGeometry, scuffGeometry } from '../damage/Deformer';
import type { Debris } from '../fx/Debris';
import type { Particles } from '../fx/Particles';
import { COCKPIT_HIDDEN, CarModel, CarPart, carMaterials } from './CarModel';
import { buildCar } from './builders';
import { Gearbox } from './Gearbox';
import { DriveInput, VehicleSim, WorldQueries } from './VehicleSim';
import { CarId, SPECS, VehicleSpec } from './VehicleSpec';

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
  private sideHits = { left: 0, right: 0 };
  private wheelDamage = [0, 0, 0, 0];
  private misfire = 0;
  /** Set during the step a misfire starts (audio plays a backfire). */
  misfiredThisStep = false;
  private time = 0;

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
    const pull = this.sideHits.left > this.sideHits.right ? 1 : -1;
    const hc = handicapFor(this.health, pull);
    if (this.misfire > 0) hc.engineCut = true;
    // Wobbly front wheels make the steering twitch a bit.
    const wobble = Math.max(this.wheelDamage[0], this.wheelDamage[1]) > PART_LIMITS.wheelWobble ? Math.sin(this.time * 9) * 0.04 : 0;
    hc.steerPull += wobble;
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
    for (const p of this.model.parts) {
      if (!p.pivot || !p.popped || p.detached) continue;
      const t = p.pivot.userData.target as number;
      p.pivot.rotation.x += (t - p.pivot.rotation.x) * 0.25;
      p.pivot.rotation.z += ((p.pivot.userData.twist as number) - p.pivot.rotation.z) * 0.25;
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

    if (pLocal.x > 0.2) this.sideHits.left += dv;
    else if (pLocal.x < -0.2) this.sideHits.right += dv;

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
      // A crumpled hood buckles and pops open on its hinge, showing the engine.
      if (part.pivot && !part.popped && frontHit && part.damage > 5 && !part.detached) {
        part.popped = true;
        part.pivot.userData.target = -(0.3 + Math.min(0.6, dv * 0.02) + Math.random() * 0.15);
        part.pivot.userData.twist = (Math.random() - 0.5) * 0.25;
      }
      this.updatePartState(part, particles, debris, vel, result);
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
        part.mesh.material = carMaterials().glassCracked;
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
    if (part.detachable && part.damage > PART_LIMITS.detach * (part.pivot ? 2.5 : 1)) {
      part.detached = true;
      result.partsLost.push(part.name);
      this.model.root.updateMatrixWorld(true);
      debris.release(part.mesh, vel, 4, true, part.sound === 'plastic' ? 'plastic' : 'metal');
    }
  }

  /** Cockpit view hides the roof and pillars to show more of the world. */
  setCockpitView(on: boolean) {
    for (const p of this.model.parts) if (COCKPIT_HIDDEN.has(p.name) && !p.detached) p.mesh.visible = !on;
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
