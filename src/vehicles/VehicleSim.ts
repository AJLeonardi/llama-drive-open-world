import { CAR_GROUPS, RAPIER, Physics } from '../physics/Physics';
import { SURFACES, Surface } from '../physics/surfaces';
import { clamp } from '../util/math';
import type { VehicleSpec } from './VehicleSpec';

export interface DriveInput {
  /** -1 = full left, +1 = full right */
  steer: number;
  throttle: number;
  reverse: number;
}

export const NO_INPUT: DriveInput = { steer: 0, throttle: 0, reverse: 0 };

/** How damage is currently hurting the car's driving (1 = healthy). */
export interface Handicap {
  power: number;
  topSpeed: number;
  /** Constant steering offset (rad) toward the damaged side. */
  steerPull: number;
  /** Engine cut out entirely (wrecked or momentary misfire). */
  engineCut: boolean;
}

export const HEALTHY: Handicap = { power: 1, topSpeed: 1, steerPull: 0, engineCut: false };

export interface WorldQueries {
  surfaceAt(x: number, z: number): Surface;
  /** Extra stick-to-the-track force zone (the loop). */
  inStickZone(x: number, z: number): boolean;
  /** Where (world z) the loop's surface is centred after `progress` (0..1) of the way round. */
  loopLaneZ?(progress: number): number;
  boostAt(x: number, z: number): boolean;
}

const G = 9.81;
const tmpUp = { x: 0, y: 0, z: 0 };

/** Wheel order: 0 front-left, 1 front-right, 2 rear-left, 3 rear-right. Car local: +x left, +z forward. */
export class VehicleSim {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly ctrl: RAPIER.DynamicRayCastVehicleController;
  steerAngle = 0;
  /** Signed forward speed (m/s). */
  speed = 0;
  boostTimer = 0;
  airTime = 0;
  wheelsInContact = 0;
  readonly wheelSurface: Surface[] = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
  /** Lateral slip 0..1 for skid sounds/marks. */
  skid = 0;
  /** Vertical speed when the wheels last touched down after a jump (for the landing thud). */
  landingSpeed = 0;
  private onLoop = false;
  /** How far round the loop we are, in radians of pitch (0 entering, 2π leaving). */
  private loopPhase = 0;
  private loopLastAngle = 0;
  private loopAssist = false;

  constructor(private readonly physics: Physics, readonly spec: VehicleSpec, x: number, y: number, z: number, heading: number) {
    const world = physics.world;
    const { mass, half, comY } = spec;
    // Box inertia, with extra roll/pitch inertia to make the car less tippy.
    const w = half.x * 2, h = half.y * 2 + 0.4, l = half.z * 2;
    const inertia = {
      x: (mass / 12) * (h * h + l * l) * 1.4,
      y: (mass / 12) * (w * w + l * l),
      z: (mass / 12) * (w * w + h * h) * 1.8,
    };
    const q = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) };
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation(q)
        .setAdditionalMassProperties(mass, { x: 0, y: comY, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        // Soft CCD: predicts contacts ahead so a fast car can't tunnel through thin walls, at a fraction of full CCD's cost.
        .setSoftCcdPrediction(1.5)
        .setAngularDamping(0.4)
        .setLinearDamping(0.02),
    );
    const r = 0.1;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(half.x - r, half.y - r, half.z - r, r)
        .setTranslation(0, spec.chassisY, 0)
        .setDensity(0)
        .setFriction(0.45)
        .setRestitution(0.12)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(mass * 1.2)
        .setCollisionGroups(CAR_GROUPS),
      this.body,
    );

    this.ctrl = world.createVehicleController(this.body);
    this.ctrl.indexUpAxis = 1;
    this.ctrl.setIndexForwardAxis = 2;
    const { track, wheelbase, wheelRadius, suspensionRest } = spec;
    const cy = wheelRadius + suspensionRest;
    const positions = [
      { x: track / 2, y: cy, z: wheelbase / 2 },
      { x: -track / 2, y: cy, z: wheelbase / 2 },
      { x: track / 2, y: cy, z: -wheelbase / 2 },
      { x: -track / 2, y: cy, z: -wheelbase / 2 },
    ];
    for (const p of positions) {
      this.ctrl.addWheel(p, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, suspensionRest, wheelRadius);
    }
    for (let i = 0; i < 4; i++) {
      this.ctrl.setWheelSuspensionStiffness(i, spec.suspensionStiffness);
      this.ctrl.setWheelSuspensionCompression(i, 2.4);
      this.ctrl.setWheelSuspensionRelaxation(i, 2.8);
      this.ctrl.setWheelMaxSuspensionTravel(i, suspensionRest * 1.5);
      this.ctrl.setWheelMaxSuspensionForce(i, mass * G * 6);
      this.ctrl.setWheelFrictionSlip(i, 2.2);
      this.ctrl.setWheelSideFrictionStiffness(i, 1.0);
    }
  }

  get position() {
    return this.body.translation();
  }

  /** Car's up vector in world space. */
  up() {
    const q = this.body.rotation();
    // Rotate (0,1,0) by q.
    tmpUp.x = 2 * (q.x * q.y - q.w * q.z);
    tmpUp.y = 1 - 2 * (q.x * q.x + q.z * q.z);
    tmpUp.z = 2 * (q.y * q.z + q.w * q.x);
    return tmpUp;
  }

  forward() {
    const q = this.body.rotation();
    return {
      x: 2 * (q.x * q.z + q.w * q.y),
      y: 2 * (q.y * q.z - q.w * q.x),
      z: 1 - 2 * (q.x * q.x + q.y * q.y),
    };
  }

  isUpsideDown() {
    return this.up().y < 0.35;
  }

  update(dt: number, input: DriveInput, hc: Handicap, q: WorldQueries) {
    const { spec, ctrl, body } = this;
    const mass = spec.mass;
    const v = ctrl.currentVehicleSpeed();
    this.speed = v;
    const pos = body.translation();

    // --- wheels: surface + contact
    let contact = 0;
    let gripSum = 0, rollingSum = 0, dragSum = 0;
    for (let i = 0; i < 4; i++) {
      if (ctrl.wheelIsInContact(i)) {
        contact++;
        const p = ctrl.wheelContactPoint(i);
        const s = p ? q.surfaceAt(p.x, p.z) : 'asphalt';
        this.wheelSurface[i] = s;
        const sp = SURFACES[s];
        ctrl.setWheelFrictionSlip(i, sp.grip * spec.grip);
        gripSum += sp.grip;
        rollingSum += sp.rolling;
        dragSum += sp.drag;
      }
    }
    const wasAir = this.wheelsInContact === 0;
    if (contact > 0 && wasAir && this.airTime > 0.25) this.landingSpeed = Math.abs(body.linvel().y);
    this.wheelsInContact = contact;
    this.airTime = contact === 0 ? this.airTime + dt : 0;
    const groundFrac = contact / 4;

    // --- loop-the-loop: several g of load, so stiffen the springs to stop the body scraping
    const onLoop = q.inStickZone(pos.x, pos.z);
    if (onLoop !== this.onLoop) {
      this.onLoop = onLoop;
      // Only guide cars entering the right way (heading west, the direction of the loop).
      const f = this.forward();
      this.loopAssist = onLoop && f.x < -0.7;
      this.loopPhase = 0;
      this.loopLastAngle = 0;
      for (let i = 0; i < 4; i++) {
        ctrl.setWheelSuspensionStiffness(i, spec.suspensionStiffness * (onLoop ? 5 : 1));
        ctrl.setWheelMaxSuspensionForce(i, mass * G * (onLoop ? 20 : 6));
      }
    }

    // Track progress round the loop from the car's pitch, and gently steer to follow
    // the surface (the loop drifts sideways so the exit misses the entry). Steering
    // instead of pushing sideways means the tyres don't scrub off speed.
    let loopSteer = 0;
    if (this.loopAssist && q.loopLaneZ) {
      const f = this.forward();
      const ang = Math.atan2(f.y, -f.x);
      let d = ang - this.loopLastAngle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      this.loopLastAngle = ang;
      this.loopPhase = Math.min(2 * Math.PI, Math.max(0, this.loopPhase + d));
      const t = this.loopPhase / (2 * Math.PI);
      const targetZ = q.loopLaneZ(t);
      const laneRate = (q.loopLaneZ(Math.min(1, t + 0.01)) - targetZ) / 0.01 * (d / dt) / (2 * Math.PI);
      // For a west-bound car the loop lies in the x-y plane, so "left" is always +z.
      const wantVz = clamp((targetZ - pos.z) * 2.5 + laneRate, -6, 6);
      const vz = body.linvel().z;
      loopSteer = clamp(((wantVz - vz) / Math.max(5, Math.abs(v))) * 1.5, -0.2, 0.2);
    }

    // --- boost pads
    if (q.boostAt(pos.x, pos.z) && contact > 0) this.boostTimer = 2.5;
    this.boostTimer = Math.max(0, this.boostTimer - dt);
    const boost = this.boostTimer > 0 ? 1.4 : 1;

    // --- steering: limited at speed so it stays controllable
    const maxSteer = spec.maxSteer / (1 + Math.abs(v) / 14);
    const target = clamp(-input.steer * maxSteer + hc.steerPull + loopSteer, -spec.maxSteer, spec.maxSteer);
    const rate = (Math.abs(target) < Math.abs(this.steerAngle) ? 4 : 2.6) * dt;
    this.steerAngle += clamp(target - this.steerAngle, -rate, rate);
    ctrl.setWheelSteering(0, this.steerAngle);
    ctrl.setWheelSteering(1, this.steerAngle);

    // --- drive force
    // Taper toward a slightly higher figure because air drag also eats into top speed.
    const top = spec.topSpeed * 1.12 * hc.topSpeed * boost;
    let force = 0;
    const throttle = hc.engineCut ? 0 : input.throttle;
    const reverse = hc.engineCut ? 0 : input.reverse;
    if (throttle > 0) {
      const taper = v <= 0 ? 1 : Math.max(0, 1 - (v / top) ** 2);
      force += mass * spec.accel * hc.power * boost * throttle * taper;
      // Loop assist: extra push on the way up if the car is a bit slow (kid-friendly physics).
      if (this.onLoop) force += mass * G * throttle * clamp((24 - v) / 6, 0, 1);
    }
    if (reverse > 0) {
      if (v > 1) {
        force -= mass * 7 * reverse; // acts as a brake while still rolling forward
      } else {
        const rTop = spec.reverseSpeed;
        const taper = v >= 0 ? 1 : Math.max(0, 1 - (v / rTop) ** 2);
        force -= mass * spec.accel * 0.7 * hc.power * reverse * taper;
      }
    }

    // --- coasting: rolling resistance + surface drag + engine braking (when off the gas)
    const avgRolling = contact > 0 ? rollingSum / contact : 0;
    const avgDrag = contact > 0 ? dragSum / contact : 0;
    let resist = mass * G * avgRolling * groundFrac + mass * avgDrag * Math.abs(v) * groundFrac;
    if (throttle === 0 && reverse === 0) resist += mass * 0.35 * groundFrac;
    // Never let resistance push the car backwards.
    resist = Math.min(resist, (mass * Math.abs(v)) / dt * 0.5);
    force -= Math.sign(v) * resist;

    const perWheel = force / Math.max(1, contact);
    const hold = contact > 0 && throttle === 0 && reverse === 0 && Math.abs(v) < 0.5;
    for (let i = 0; i < 4; i++) {
      ctrl.setWheelEngineForce(i, ctrl.wheelIsInContact(i) ? perWheel : 0);
      ctrl.setWheelBrake(i, hold ? mass * 0.5 : 0);
    }

    ctrl.updateVehicle(dt);

    // --- body forces (cleared each step)
    body.resetForces(true);
    body.resetTorques(true);
    const lv = body.linvel();
    const sp = Math.hypot(lv.x, lv.y, lv.z);
    const up = this.up();
    // Air drag: what really limits top speed and slows coasting at high speed.
    const dragK = 0.42;
    body.addForce({ x: -lv.x * sp * dragK, y: -lv.y * sp * dragK, z: -lv.z * sp * dragK }, true);

    if (contact >= 2) {
      // Downforce, plus a strong "stick" inside the loop so it's possible at kid-friendly speeds.
      let down = spec.downforce * v * v;
      // Grows smoothly as the car tilts up the loop (no jolt at the entry).
      if (this.onLoop) down += mass * G * 1.8 * Math.min(1, Math.max(0, (1 - up.y) * 2));
      body.addForce({ x: -up.x * down, y: -up.y * down, z: -up.z * down }, true);
      // Gentle anti-roll: resist tipping in hard turns (not on the loop — upside down is the point there).
      const k = this.onLoop ? 0 : mass * 9;
      const fwd = this.forward();
      // torque = (up × worldUp) projected onto forward axis (roll only)
      const cx = -up.z, cz = up.x; // up × (0,1,0) = (-up.z, 0, up.x)
      const roll = cx * fwd.x + cz * fwd.z;
      body.addTorque({ x: fwd.x * roll * k, y: 0, z: fwd.z * roll * k }, true);
    } else if (contact === 0 && this.airTime > 0.15 && !this.onLoop) {
      // In the air: slowly level out so jumps usually land on the wheels.
      const k = mass * 3;
      const av = body.angvel();
      body.addTorque({ x: -up.z * k - av.x * mass * 0.6, y: -av.y * mass * 0.2, z: up.x * k - av.z * mass * 0.6 }, true);
    }

    // Lateral slip estimate for skid effects.
    if (contact > 0 && sp > 3) {
      const fwd = this.forward();
      const along = (lv.x * fwd.x + lv.y * fwd.y + lv.z * fwd.z) / sp;
      this.skid = clamp((1 - Math.abs(along)) * 3 - 0.15, 0, 1) * (gripSum / contact > 2 ? 1 : 0.6);
    } else {
      this.skid = 0;
    }
  }

  /** Put the car back on its wheels (used by the flip-over button). */
  flipUpright() {
    const p = this.body.translation();
    const f = this.forward();
    const heading = Math.atan2(f.x, f.z);
    this.body.setTranslation({ x: p.x, y: p.y + 2.2, z: p.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  dispose() {
    this.physics.world.removeVehicleController(this.ctrl);
    this.physics.removeBody(this.body);
  }
}
