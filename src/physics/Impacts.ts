import { IMPACT_WINDOW } from '../damage/Damage';
import { ColliderOwner, FIXED_DT, Physics, RAPIER } from './Physics';

export interface Impact {
  otherHandle: number;
  other: ColliderOwner | undefined;
  /** Total impulse over the crash (N·s). */
  impulse: number;
  /** World-space contact point (impulse-weighted average). */
  point: { x: number; y: number; z: number };
  /** World-space unit normal pointing from the car toward the other object. */
  normal: { x: number; y: number; z: number };
  /** Closing speed into the other object just before the crash (m/s). */
  closing: number;
  /** The car's velocity just before the crash. */
  preVel: { x: number; y: number; z: number };
}

interface Pending {
  impulse: number;
  /** Car velocity just before the crash started, and the other object's velocity + mass. */
  vx: number; vy: number; vz: number;
  ox: number; oy: number; oz: number;
  otherMass: number;
  px: number; py: number; pz: number;
  nx: number; ny: number; nz: number;
  w: number;
  age: number;
}

/**
 * Collects Rapier contact-force events involving the player's car and groups
 * consecutive ones with the same partner into a single crash.
 */
export class ImpactTracker {
  private pending = new Map<number, Pending>();
  private pre = { x: 0, y: 0, z: 0 };

  constructor(private readonly physics: Physics, private carCollider: RAPIER.Collider) {}

  setCar(collider: RAPIER.Collider) {
    this.carCollider = collider;
    this.pending.clear();
  }

  /** Call right before each physics step: remembers the car's pre-crash velocity. */
  beforeStep() {
    const v = this.carCollider.parent()!.linvel();
    this.pre.x = v.x; this.pre.y = v.y; this.pre.z = v.z;
  }

  /** Call once after each physics step. Returns crashes that just finished. */
  collect(): Impact[] {
    const { physics } = this;
    const carHandle = this.carCollider.handle;
    physics.events.drainContactForceEvents((e) => {
      const h1 = e.collider1(), h2 = e.collider2();
      if (h1 !== carHandle && h2 !== carHandle) return;
      const otherHandle = h1 === carHandle ? h2 : h1;
      const owner = physics.owner(otherHandle);
      if (owner?.kind === 'debris') return;
      const impulse = e.totalForceMagnitude() * FIXED_DT;
      if (impulse <= 0) return;
      const other = physics.world.getCollider(otherHandle);
      if (!other) return;
      let px = 0, py = 0, pz = 0, n = 0, nx = 0, ny = 0, nz = 0;
      physics.world.contactPair(this.carCollider, other, (manifold, flipped) => {
        const nm = manifold.normal();
        const s = flipped ? -1 : 1;
        nx += nm.x * s; ny += nm.y * s; nz += nm.z * s;
        for (let i = 0; i < manifold.numSolverContacts(); i++) {
          const p = manifold.solverContactPoint(i);
          px += p.x; py += p.y; pz += p.z;
          n++;
        }
      });
      if (n === 0) {
        // Very hard hits can resolve within one step, leaving no contacts to query.
        // Estimate from the force direction instead: point on the car's surface facing the other object.
        const d = e.maxForceDirection();
        const c = this.carCollider.translation();
        const o = other.translation();
        const sign = (o.x - c.x) * d.x + (o.y - c.y) * d.y + (o.z - c.z) * d.z >= 0 ? 1 : -1;
        nx = d.x * sign; ny = d.y * sign; nz = d.z * sign;
        // Distance from the box centre to its surface along n (ray/box exit in car-local space).
        const he = this.carCollider.halfExtents();
        const q = this.carCollider.rotation();
        const local = rotateInv(q, nx, ny, nz);
        const reach = Math.min(
          he.x / Math.max(1e-3, Math.abs(local.x)),
          he.y / Math.max(1e-3, Math.abs(local.y)),
          he.z / Math.max(1e-3, Math.abs(local.z)),
        );
        px = c.x + nx * reach; py = c.y + ny * reach; pz = c.z + nz * reach;
        n = 1;
      }
      let p = this.pending.get(otherHandle);
      if (!p) {
        const ob = other.parent();
        const dyn = ob && ob.isDynamic();
        // Kinematic bodies (a friend's car) move too: their speed counts toward the closing speed.
        const ov = ob && !ob.isFixed() ? ob.linvel() : { x: 0, y: 0, z: 0 };
        p = {
          impulse: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, w: 0, age: 0,
          vx: this.pre.x, vy: this.pre.y, vz: this.pre.z, ox: ov.x, oy: ov.y, oz: ov.z,
          otherMass: dyn ? ob.mass() : Infinity,
        };
        this.pending.set(otherHandle, p);
      }
      p.impulse += impulse;
      p.px += (px / n) * impulse; p.py += (py / n) * impulse; p.pz += (pz / n) * impulse;
      p.nx += nx * impulse; p.ny += ny * impulse; p.nz += nz * impulse;
      p.w += impulse;
    });

    const done: Impact[] = [];
    for (const [handle, p] of this.pending) {
      p.age += FIXED_DT;
      if (p.age < IMPACT_WINDOW) continue;
      this.pending.delete(handle);
      const nl = Math.hypot(p.nx, p.ny, p.nz) || 1;
      let nx = p.nx / nl, ny = p.ny / nl, nz = p.nz / nl;
      const px = p.px / p.w, py = p.py / p.w, pz = p.pz / p.w;
      // Make sure the normal points from the car toward the contact (manifold order varies).
      const c = this.carCollider.translation();
      if ((px - c.x) * nx + (py - c.y) * ny + (pz - c.z) * nz < 0) {
        nx = -nx; ny = -ny; nz = -nz;
      }
      // The solver's force total also includes penetration corrections, which can be
      // huge for fast or wedged contacts. Cap it at what physics allows: the reduced
      // mass times the closing speed (plus a little bounce).
      const closing = Math.max(0, (p.vx - p.ox) * nx + (p.vy - p.oy) * ny + (p.vz - p.oz) * nz);
      const m1 = this.carCollider.parent()!.mass();
      const mu = Number.isFinite(p.otherMass) ? (m1 * p.otherMass) / (m1 + p.otherMass) : m1;
      done.push({
        otherHandle: handle,
        other: this.physics.owner(handle),
        impulse: Math.min(p.impulse, mu * closing * 1.25),
        closing,
        preVel: { x: p.vx, y: p.vy, z: p.vz },
        point: { x: px, y: py, z: pz },
        normal: { x: nx, y: ny, z: nz },
      });
    }
    return done;
  }
}

/** Rotate a vector by the inverse of quaternion q. */
function rotateInv(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number) {
  // v' = q* v q  (conjugate rotation)
  const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
}
