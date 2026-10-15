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
  private readonly hooks: RAPIER.PhysicsHooks = {
    filterContactPair: (c1, c2) => {
      const core = this.cores.has(c1) || this.cores.has(c2);
      const loop = this.loops.has(c1) || this.loops.has(c2);
      if (core) return loop ? RAPIER.SolverFlags.COMPUTE_IMPULSE : null;
      if (loop && (this.chassis.has(c1) || this.chassis.has(c2))) return null;
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    },
    filterIntersectionPair: () => true,
  };

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
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
      this.cores.delete(h);
    }
    this.world.removeRigidBody(body);
  }

  step() {
    this.world.step(this.events, this.hooks);
  }

  dispose() {
    this.events.free();
    this.world.free();
  }
}
