// Pure damage math (no three.js / Rapier) so it can be unit-tested.
//
// Every crash is measured by the total contact impulse J (N·s) Rapier reports
// between the player's car and the thing it hit. J already includes speed and
// both masses: hitting a wall twice as fast doubles J, and a heavier car hitting
// the same wall produces a bigger J.

import type { Handicap } from '../vehicles/VehicleSim';

/** Impulses from the same collision partner within this window count as one crash. */
export const IMPACT_WINDOW = 0.08;
/** Velocity change (m/s) the car can absorb without damage (curbs, nudges, landings). */
export const CAR_DV_THRESHOLD = 2.5;
const CAR_DAMAGE_PER_DV = 2.4;
/** Reference mass for "big car hits harder" scaling. */
const REF_MASS = 2000;

export const MAX_HEALTH = 100;

/** Change in the car's velocity caused by the hit (m/s) — how hard the crash felt to the car. */
export const impactDeltaV = (impulse: number, carMass: number) => impulse / carMass;

/** Health points the car loses from one crash. */
export function carDamage(impulse: number, carMass: number, durability: number) {
  const dv = impactDeltaV(impulse, carMass);
  return (Math.max(0, dv - CAR_DV_THRESHOLD) * CAR_DAMAGE_PER_DV) / durability;
}

/**
 * Damage dealt to the thing the car hit, in % of its health.
 * `toughness` is the impulse that destroys it outright. Heavier cars get an extra
 * multiplier on top of the bigger impulse, so the Bronco smashes things noticeably harder.
 */
export function objectDamage(impulse: number, carMass: number, toughness: number) {
  return (impulse / toughness) * (carMass / REF_MASS) * 100;
}

/** Health only ever goes down during a run. */
export const applyDamage = (health: number, damage: number) => Math.max(0, health - Math.max(0, damage));

/** How far (m) a panel gets pushed in by a crash with this velocity change (big hits crush ~1 m). */
export const dentDepth = (dv: number) => Math.min(1.5, 0.05 * Math.max(0, dv - 1.5));
/** How wide (m) the dent spreads. */
export const dentRadius = (dv: number) => 0.55 + Math.min(1.7, 0.05 * dv);
/** Most a single vertex can be pushed from its original spot, by part kind. */
export const MAX_CRUSH = { body: 1.5, panel: 1.0 };

export type DamageStage = 0 | 1 | 2 | 3 | 4;
/** 0 healthy, 1 >25% damaged, 2 >50%, 3 >75%, 4 wrecked */
export function damageStage(health: number): DamageStage {
  const dmg = MAX_HEALTH - health;
  if (health <= 0) return 4;
  if (dmg > 75) return 3;
  if (dmg > 50) return 2;
  if (dmg > 25) return 1;
  return 0;
}

/**
 * How damage affects driving: not at all until the car is wrecked, then it won't go.
 * (Slowing a battered car down just made it harder to get around and crash more; the
 * damage shows in dents, smoke, lost parts and backfires instead.)
 */
export function handicapFor(health: number): Handicap {
  const wrecked = damageStage(health) === 4;
  return { power: wrecked ? 0 : 1, topSpeed: wrecked ? 0 : 1, steerPull: 0, engineCut: wrecked };
}

export const misfireChancePerSecond = (health: number) => (damageStage(health) === 3 ? 0.35 : 0);

/** Per-part thresholds (accumulated local damage) for visible part failures. */
export const PART_LIMITS = {
  glassCrack: 4,
  glassShatter: 22,
  detach: 14,
  wheelWobble: 20,
};

/** Impulse (N·s, from a 2000 kg car) that wrecks a building's "health" (it never falls down). */
export const BUILDING_TOUGHNESS = 110000;
