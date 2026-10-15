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

/**
 * Collision groups (Rapier packs membership in the high 16 bits, filter in the low 16).
 * The car body ignores the loop-the-loop surface: only its wheel raycasts ride it,
 * so low noses (the Lambo) can't scrape on the way in.
 */
const GROUP_CAR = 0x0002;
const GROUP_LOOP = 0x0004;
export const CAR_GROUPS = (GROUP_CAR << 16) | 0xffff;
export const LOOP_GROUPS = (GROUP_LOOP << 16) | (0xffff & ~GROUP_CAR);

export class Physics {
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  private owners = new Map<number, ColliderOwner>();

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

  removeBody(body: RAPIER.RigidBody) {
    for (let i = 0; i < body.numColliders(); i++) this.owners.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  step() {
    this.world.step(this.events);
  }

  dispose() {
    this.events.free();
    this.world.free();
  }
}
