import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

let initialized: Promise<void> | null = null;
export function initPhysics() {
  if (!initialized) initialized = RAPIER.init();
  return initialized;
}

export type MaterialKind = 'metal' | 'wood' | 'concrete' | 'plastic' | 'glass' | 'ground';

/** What a collider belongs to, so collisions can be routed to the right damage handler. */
export interface ColliderOwner {
  kind: 'ground' | 'building' | 'static' | 'prop' | 'car' | 'parked' | 'debris';
  material: MaterialKind;
  /** Back-reference (Prop, ParkedCar, Vehicle…). */
  ref?: unknown;
}

export const FIXED_DT = 1 / 60;

/** carGround values: the body may touch any ground piece, or none this step. */
const ANY_GROUND = -1, NO_GROUND = -2;
/** Probe rays start this far above the body's bottom, so a box already sunk in still finds the ground. */
const RAY_LIFT = 2;
let scratchRay: RAPIER.Ray | null = null;

export class Physics {
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  private owners = new Map<number, ColliderOwner>();
  /**
   * Loop-the-loop rules: the car's main body box ignores the loop surface (so low noses
   * don't scrape on the way in; the wheels ride it), while a smaller cabin "core" box
   * collides ONLY with the loop, so a car can never fall through it.
   */
  private loops = new Set<number>();
  private chassis = new Set<number>();
  private cores = new Set<number>();
  /**
   * Ground pieces (terrain heightfields) and the area each one owns. Neighbouring pieces
   * overlap a little, and a car's body only touches the piece it's over: the open edge
   * of the next piece would otherwise act like a kerb (the car's look-ahead for fast
   * contacts sees it), slamming a fast, low car to a stop at every seam.
   */
  private grounds = new Map<number, { x0: number; z0: number; x1: number; z1: number }>();
  /** Per car body box: the ground piece it may touch this step (ANY_GROUND, NO_GROUND or a handle). */
  private carGround = new Map<number, number>();
  private readonly hooks: RAPIER.PhysicsHooks = {
    filterContactPair: (c1, c2) => {
      const core = this.cores.has(c1) || this.cores.has(c2);
      const loop = this.loops.has(c1) || this.loops.has(c2);
      if (core) return loop ? RAPIER.SolverFlags.COMPUTE_IMPULSE : null;
      const car = this.chassis.has(c1) ? c1 : this.chassis.has(c2) ? c2 : -1;
      if (car !== -1) {
        if (loop) return null;
        const other = car === c1 ? c2 : c1;
        if (this.grounds.has(other)) {
          const g = this.carGround.get(car) ?? ANY_GROUND;
          if (g !== ANY_GROUND && g !== other) return null;
        }
      }
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    },
    filterIntersectionPair: () => true,
  };

  /** `gravity`: how strongly things fall (m/s²; the space station's is much lower). */
  constructor(readonly gravity = 9.81) {
    this.world = new RAPIER.World({ x: 0, y: -gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    this.events = new RAPIER.EventQueue(true);
  }

  setOwner(collider: RAPIER.Collider, owner: ColliderOwner) {
    this.owners.set(collider.handle, owner);
  }

  owner(handle: number) {
    return this.owners.get(handle);
  }

  removeCollider(collider: RAPIER.Collider) {
    this.owners.delete(collider.handle);
    this.grounds.delete(collider.handle);
  }

  /** A terrain piece that owns the area x0..x1, z0..z1 (its collider reaches a bit beyond). */
  registerGround(c: RAPIER.Collider, x0: number, z0: number, x1: number, z1: number) {
    this.grounds.set(c.handle, { x0, z0, x1, z1 });
  }

  registerLoop(c: RAPIER.Collider) {
    c.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    this.loops.add(c.handle);
  }

  registerCarColliders(chassis: RAPIER.Collider, core: RAPIER.Collider) {
    chassis.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    core.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    this.chassis.add(chassis.handle);
    this.cores.add(core.handle);
  }

  removeBody(body: RAPIER.RigidBody) {
    for (let i = 0; i < body.numColliders(); i++) {
      const h = body.collider(i).handle;
      this.owners.delete(h);
      this.chassis.delete(h);
      this.carGround.delete(h);
      this.cores.delete(h);
    }
    this.world.removeRigidBody(body);
  }

  step() {
    for (const h of this.chassis) {
      // Looked up by handle: a body removed behind our back must not be touched (freed in WASM).
      const c = this.world.getCollider(h);
      if (!c) {
        this.chassis.delete(h);
        this.carGround.delete(h);
        continue;
      }
      const p = c.translation();
      let g = ANY_GROUND;
      for (const [gh, r] of this.grounds)
        if (p.x >= r.x0 && p.x < r.x1 && p.z >= r.z0 && p.z < r.z1) {
          g = gh;
          break;
        }
      if (g !== ANY_GROUND && this.clearOfGround(c, this.world.getCollider(g))) g = NO_GROUND;
      this.carGround.set(h, g);
    }
    this.world.step(this.events, this.hooks);
  }

  /**
   * Whether an upright car's body box is clearly off the ground, now and one step ahead.
   * Then it skips ground contacts for the step: Rapier's look-ahead contacts (soft CCD) can
   * catch a heightfield vertex with a bad normal well below a car riding on its wheels,
   * stopping it dead at speed. Real touches (landings, bottoming out, rolls) still collide.
   */
  private clearOfGround(body: RAPIER.Collider, ground: RAPIER.Collider | null) {
    if (!ground) return false;
    const q = body.rotation();
    // The box's local up in world space; only upright cars (the bottom face is lowest).
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    if (upY < 0.7) return false;
    const he = body.halfExtents();
    const r = body.roundRadius();
    const hx = he.x + r, hy = he.y + r, hz = he.z + r;
    const p = body.translation();
    const v = body.parent()!.linvel();
    const ahead = FIXED_DT * 1.5;
    // Generous: a falling car must still meet the ground before it would sink in this step.
    const margin = 0.05 + Math.max(0, -v.y) * ahead;
    const ray = (scratchRay ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
    for (const t of [0, ahead])
      for (const fx of [-1, 0, 1])
        for (const fz of [-1, 0, 1]) {
          // Local bottom point rotated into world space (q * v * q^-1).
          const lx = fx * hx, ly = -hy, lz = fz * hz;
          const ix = q.w * lx + q.y * lz - q.z * ly;
          const iy = q.w * ly + q.z * lx - q.x * lz;
          const iz = q.w * lz + q.x * ly - q.y * lx;
          const iw = -q.x * lx - q.y * ly - q.z * lz;
          const wx = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
          const wy = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
          const wz = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
          ray.origin.x = p.x + wx + v.x * t;
          ray.origin.y = p.y + wy + v.y * t + RAY_LIFT;
          ray.origin.z = p.z + wz + v.z * t;
          const toi = ground.castRay(ray, RAY_LIFT + margin, true);
          if (toi >= 0) return false;
        }
    return true;
  }

  dispose() {
    this.events.free();
    this.world.free();
  }
}
