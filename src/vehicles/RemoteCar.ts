import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import type { CarState } from '../net/carState';
import { CarModel, carMaterials } from './CarModel';
import { buildCar } from './builders';
import { CarId, SPECS, VehicleSpec } from './VehicleSpec';

/** A jump this far between steps is a respawn, not driving: teleport instead of sweeping through things. */
const TELEPORT = 25;

/**
 * The friend's car: their device drives it, this one only shows it. A kinematic body
 * follows the received state, so it shoves props and parked cars and you can bump into
 * it (each device works out its own car's damage).
 */
export class RemoteCar {
  readonly id: CarId;
  readonly spec: VehicleSpec;
  readonly model: CarModel;
  readonly body: RAPIER.RigidBody;
  private spin = 0;
  private placed = false;
  damage = 0;

  constructor(private readonly physics: Physics, scene: THREE.Scene, id: CarId) {
    this.id = id;
    this.spec = SPECS[id];
    this.model = buildCar(id);
    // Seen from outside: tinted windows, like the player's car in the chase view.
    if (this.model.tintedGlass) for (const p of this.model.parts) if (p.kind === 'glass') p.mesh.material = carMaterials().glassTinted;
    scene.add(this.model.root);
    this.model.root.visible = false;
    const { half, chassisY } = this.spec;
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1000, 0));
    const col = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(0, chassisY, 0).setFriction(0.45),
      this.body,
    );
    physics.setOwner(col, { kind: 'car', material: 'metal', ref: this });
  }

  /** Before each physics step: move the body to where the car should be. */
  follow(s: CarState) {
    const b = this.body;
    const t = b.translation();
    if (!this.placed || Math.hypot(s.x - t.x, s.y - t.y, s.z - t.z) > TELEPORT) {
      b.setTranslation({ x: s.x, y: s.y, z: s.z }, true);
      b.setRotation({ x: s.qx, y: s.qy, z: s.qz, w: s.qw }, true);
      this.placed = true;
    }
    b.setNextKinematicTranslation({ x: s.x, y: s.y, z: s.z });
    b.setNextKinematicRotation({ x: s.qx, y: s.qy, z: s.qz, w: s.qw });
  }

  /** Each frame: the model, wheels turning and steering. */
  render(s: CarState, dt: number) {
    const root = this.model.root;
    root.visible = true;
    root.position.set(s.x, s.y, s.z);
    root.quaternion.set(s.qx, s.qy, s.qz, s.qw);
    this.spin += (s.speed / this.spec.wheelRadius) * dt;
    for (let i = 0; i < 4; i++) {
      const w = this.model.wheels[i];
      w.rotation.y = i < 2 ? s.steer : 0;
      w.children[0].rotation.x = this.spin;
    }
    this.model.steeringWheel.rotation.z = -s.steer * 6;
    this.damage = s.damage;
  }

  /** Out of the way (the friend is in a menu or picking a car). */
  hide() {
    this.model.root.visible = false;
    this.body.setTranslation({ x: 0, y: -1000, z: 0 }, false);
    this.placed = false;
  }

  get visible() {
    return this.model.root.visible;
  }

  dispose() {
    this.physics.removeBody(this.body);
    this.model.root.removeFromParent();
    this.model.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }
}
