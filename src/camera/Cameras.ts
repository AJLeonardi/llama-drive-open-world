import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import type { Vehicle } from '../vehicles/Vehicle';

export type CameraMode = 'cockpit' | 'chase' | 'orbit';
/** Views the camera button cycles through while driving. Orbit is only for looking at a wreck. */
export const CAMERA_MODES: CameraMode[] = ['chase', 'cockpit'];

const v = new THREE.Vector3();
const target = new THREE.Vector3();
const desired = new THREE.Vector3();
// Look backwards-flip (camera looks down -z, car faces +z) plus a slight downward tilt toward the road.
const flip = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.07));

export class Cameras {
  mode: CameraMode = 'chase';
  private orbitAngle = 0;
  /** Extra yaw for the chase camera from swiping; eases back behind the car after a pause. */
  private chaseYaw = 0;
  private sinceDrag = 99;
  private orbitPitch = 0.35;
  private shake = 0;
  private chasePos = new THREE.Vector3();
  private initialized = false;

  /** `physics`: the world the camera keeps out of the walls of (Earth or the space station). */
  constructor(readonly camera: THREE.PerspectiveCamera, public physics: Physics) {}

  next() {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    this.initialized = false;
  }

  reset(mode: CameraMode = 'chase') {
    this.mode = mode;
    this.chaseYaw = 0;
    this.initialized = false;
  }

  /** Swipe on the screen: spins the orbit camera, or swings the chase camera around the car. */
  drag(dx: number, dy: number) {
    this.sinceDrag = 0;
    if (this.mode === 'orbit') {
      this.orbitAngle -= dx * 0.008;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.005, 0.05, 1.2);
    } else if (this.mode === 'chase') {
      this.chaseYaw -= dx * 0.01;
      // keep it in -π..π so easing back takes the short way round
      this.chaseYaw = Math.atan2(Math.sin(this.chaseYaw), Math.cos(this.chaseYaw));
    }
  }

  addShake(amount: number) {
    this.shake = Math.min(1, this.shake + amount);
  }

  update(dt: number, car: Vehicle) {
    const cam = this.camera;
    const root = car.model.root;
    const fwd = car.sim.forward();
    const heading = Math.atan2(fwd.x, fwd.z);
    let fov = 72;
    car.setCockpitView(this.mode === 'cockpit');

    if (this.mode === 'cockpit') {
      const e = car.spec.eye;
      cam.position.copy(v.set(e.x, e.y, e.z)).applyMatrix4(root.matrixWorld);
      cam.quaternion.copy(root.quaternion).multiply(flip);
      fov = 75;
    } else if (this.mode === 'chase') {
      target.copy(root.position).add(v.set(0, 1.3, 0));
      this.sinceDrag += dt;
      if (this.sinceDrag > 1.8) this.chaseYaw *= Math.exp(-dt * 1.5);
      const yaw = heading + this.chaseYaw;
      const back = 7.5 + Math.min(3, Math.abs(car.sim.speed) * 0.05);
      desired.set(target.x - Math.sin(yaw) * back, target.y + 2.4, target.z - Math.cos(yaw) * back);
      if (!this.initialized) this.chasePos.copy(desired);
      this.chasePos.lerp(desired, 1 - Math.exp(-dt * 6));
      cam.position.copy(this.avoidWalls(target, this.chasePos, car));
      // Look a little ahead of the car (less so while swung round, so it stays centred).
      const ahead = 3 * Math.max(0, Math.cos(this.chaseYaw));
      cam.lookAt(target.x + Math.sin(heading) * ahead, target.y, target.z + Math.cos(heading) * ahead);
      fov = 62 + Math.min(16, Math.abs(car.sim.speed) * 0.25);
    } else {
      if (!this.initialized) this.orbitAngle = heading + Math.PI * 0.25; // start at the front corner, where most damage is
      this.orbitAngle += dt * 0.3;
      target.copy(root.position).add(v.set(0, 1.0, 0));
      const r = 7.5;
      desired.set(
        target.x + Math.sin(this.orbitAngle) * Math.cos(this.orbitPitch) * r,
        target.y + Math.sin(this.orbitPitch) * r,
        target.z + Math.cos(this.orbitAngle) * Math.cos(this.orbitPitch) * r,
      );
      if (this.blocked(target, desired, car)) {
        // Swing around to the nearest clear angle rather than squeezing into the car.
        for (let k = 1; k <= 8 && this.blocked(target, desired, car); k++) {
          const a = this.orbitAngle + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
          desired.set(
            target.x + Math.sin(a) * Math.cos(this.orbitPitch) * r,
            target.y + Math.sin(this.orbitPitch) * r,
            target.z + Math.cos(a) * Math.cos(this.orbitPitch) * r,
          );
          if (!this.blocked(target, desired, car)) this.orbitAngle = a;
        }
        // Boxed in on every side: look down from above instead.
        if (this.blocked(target, desired, car)) desired.set(target.x + 1.5, target.y + r, target.z + 1.5);
      }
      cam.position.copy(this.avoidWalls(target, desired, car));
      cam.lookAt(target);
      fov = 60;
    }
    this.initialized = true;

    if (this.shake > 0) {
      const s = this.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
  }

  /** Underwater view: slowly circle the sunken car. */
  updateUnderwater(dt: number, center: THREE.Vector3) {
    this.orbitAngle += dt * 0.4;
    this.camera.position.set(center.x + Math.sin(this.orbitAngle) * 6, center.y + 1.5, center.z + Math.cos(this.orbitAngle) * 6);
    this.camera.lookAt(center.x, center.y + 0.8, center.z);
  }

  /** Distance along from→to before hitting a wall/ground (or the full length if clear). */
  private clearDistance(from: THREE.Vector3, to: THREE.Vector3, car: Vehicle) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.01) return len;
    dir.divideScalar(len);
    const hit = this.physics.world.castRay(new RAPIER.Ray(from, dir), len, true, undefined, undefined, undefined, car.sim.body,
      (c) => {
        const o = this.physics.owner(c.handle);
        return o?.kind === 'building' || o?.kind === 'ground' || o?.kind === 'static';
      });
    return hit ? hit.timeOfImpact : len;
  }

  private blocked(from: THREE.Vector3, to: THREE.Vector3, car: Vehicle) {
    return this.clearDistance(from, to, car) < from.distanceTo(to) - 0.5;
  }

  /** Pull the camera in front of any wall between it and the car. */
  private avoidWalls(from: THREE.Vector3, to: THREE.Vector3, car: Vehicle) {
    const len = from.distanceTo(to);
    const d = this.clearDistance(from, to, car);
    if (d >= len) return to;
    return v.copy(to).sub(from).normalize().multiplyScalar(Math.max(0.5, d - 0.4)).add(from);
  }
}
