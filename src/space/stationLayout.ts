// The space station stunt park as plain data, plus its colliders (Rapier only: no
// three.js, so the tests drive on it in Node). It floats high above everything else in
// the scene (`SY`), in its own physics world with low gravity.
//
// One big octagonal deck. The rocket lands at the south end; from there the Rocket Ramp
// runs north up the middle, with rings to fly through along its arc. A jump ramp sits in
// the middle of every edge, pointing out into space, with a ring out past each one, and
// low rails run along the edges between them. Kicker ramps, barrel pyramids, crate walls
// and boost pads fill the rest. Below the deck a force-field net catches anything that
// falls off and springs it back up onto the deck.
import { Physics, RAPIER } from '../physics/Physics';
import type { BoostPad } from '../world/layout';
import { PropSpawn, tntPyramid } from '../world/propModels';
import type { WorldQueries } from '../vehicles/VehicleSim';
import { pointInRect } from '../util/math';

/** Height of the deck (well above anything on Earth, which shares the scene). */
export const SY = 2000;
/** Space gravity (m/s²): about a third of Earth's. */
export const SPACE_GRAVITY = 3.3;
/** The deck: a regular octagon, `R` from the middle to the middle of each edge. */
export const DECK = { R: 150, thick: 3 };
/** Octagon corner radius. */
export const DECK_CORNER = DECK.R / Math.cos(Math.PI / 8);
/** The force-field net under the station: how far down, and how wide. */
export const NET = { y: SY - 70, r: 700 };

/** Where the rocket stands, the circle you drive into to fly home, and where your car rolls out. */
export const LANDING = { x: 0, z: 108, r: 14 };
export const BOARD = { x: 0, z: 82, r: 9 };
export const SPAWN = { x: 0, z: 68, heading: Math.PI };

/**
 * A wedge ramp: from (x, z) it climbs `h` over `len` along `heading` (θ: faces (sin θ, cos θ)),
 * `w` wide, ending in a lip with a straight drop behind it.
 */
export interface Wedge { x: number; z: number; heading: number; len: number; w: number; h: number; color: number }
/** A ring to fly through: centre, the way it faces (yaw), radius. */
export interface Hoop { x: number; y: number; z: number; heading: number; r: number }
/** A solid box on the deck: centre (deck-relative y), size, yaw. */
export interface Block { x: number; y: number; z: number; sx: number; sy: number; sz: number; heading: number; color: number }

const dir = (h: number) => [Math.sin(h), Math.cos(h)] as const;
/** The eight edge directions (the middle of each edge), starting north. */
export const EDGE_HEADINGS = Array.from({ length: 8 }, (_, k) => Math.PI + (k * Math.PI) / 4);

export const WEDGES: Wedge[] = [];
export const HOOPS: Hoop[] = [];
export const BLOCKS: Block[] = [];
export const BOOSTS: BoostPad[] = [];
export const PROPS: PropSpawn[] = [];

/** The Rocket Ramp: up the middle, heading north. */
export const MEGA = { x: 0, z: 30, heading: Math.PI, len: 44, w: 18, h: 11 };
{
  WEDGES.push({ ...MEGA, color: 0xe8e8ea });
  BOOSTS.push({ x: 0, z: 50, heading: Math.PI, length: 10, width: 8 });
  // Rings along its arc, the last one out past the edge (any car at full speed sails
  // through them all, on the gas or not; tests/space.test.ts checks).
  for (const [z, y, r] of [[-50, 20, 7], [-86, 24, 8], [-122, 23, 9.5], [-158, 16.5, 13]] as const) HOOPS.push({ x: 0, y: SY + y, z, heading: Math.PI, r });

  // A jump at the middle of every edge, pointing out into space, with a boost pad before it
  // and a ring out past it. (Not the south edge: the rocket is there.)
  for (const h of EDGE_HEADINGS) {
    const [ux, uz] = dir(h);
    if (uz > 0.9) continue;
    const len = 30, start = DECK.R - len - 1;
    WEDGES.push({ x: ux * start, z: uz * start, heading: h, len, w: 14, h: 7.5, color: 0xffb02e });
    BOOSTS.push({ x: ux * (start - 16), z: uz * (start - 16), heading: h, length: 9, width: 7 });
    HOOPS.push({ x: ux * (DECK.R + 46), y: SY + 15, z: uz * (DECK.R + 46), heading: h, r: 8.5 });
  }
  // Low rails along the edges, with gaps for the jumps (and the south edge open by the rocket).
  const C = DECK_CORNER;
  for (let k = 0; k < 8; k++) {
    const a0 = -Math.PI / 2 - Math.PI / 8 + (k * Math.PI) / 4, a1 = a0 + Math.PI / 4;
    const p0 = [Math.cos(a0) * C, Math.sin(a0) * C], p1 = [Math.cos(a1) * C, Math.sin(a1) * C];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const heading = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
    const ux = (p1[0] - p0[0]) / len, uz = (p1[1] - p0[1]) / len;
    const nx = -uz, nz = ux;
    const gap = 9;
    for (const [t0, t1] of [[0, len / 2 - gap], [len / 2 + gap, len]]) {
      const m = (t0 + t1) / 2;
      // (Set in from the edge by its half-thickness.)
      BLOCKS.push({ x: p0[0] + ux * m + nx * 0.6, y: 0.6, z: p0[1] + uz * m + nz * 0.6, sx: 1.2, sy: 1.2, sz: t1 - t0, heading, color: 0x2b3440 });
    }
  }
  // Antenna pylons at the corners.
  for (let k = 0; k < 8; k++) {
    const a = -Math.PI / 2 - Math.PI / 8 + (k * Math.PI) / 4, r = C - 5;
    BLOCKS.push({ x: Math.cos(a) * r, y: 9, z: Math.sin(a) * r, sx: 3, sy: 18, sz: 3, heading: a, color: 0xc9ced6 });
  }

  // Kickers in the open ground east and west, launching sideways over a barrel pyramid.
  for (const s of [-1, 1]) {
    WEDGES.push({ x: s * 36, z: -16, heading: s * Math.PI / 2, len: 16, w: 10, h: 4, color: 0x46e0ff });
    tntPyramid(PROPS, s * 92, -16, 5, Math.PI / 2, SY);
    WEDGES.push({ x: s * 40, z: 75, heading: s * Math.PI / 2 + s * 0.5, len: 14, w: 9, h: 3.5, color: 0x46e0ff });
  }
  // Barrel pyramids to smash, and a high ring over each side for thruster flying.
  for (const [x, z] of [[-58, -100], [58, -100], [-100, 40], [100, 40]] as const) tntPyramid(PROPS, x, z, 4, Math.atan2(x, z), SY);
  for (const s of [-1, 1]) HOOPS.push({ x: s * 70, y: SY + 12, z: -16, heading: s * Math.PI / 2, r: 7 });
  // Crate walls.
  for (const s of [-1, 1])
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 6 - row; i++) PROPS.push({ kind: 'crate', x: s * 50 + (i - (5 - row) / 2) * 1.25, y: SY + row * 1.2, z: 10, rot: 0 });
  // A slalom of cones down the west side.
  for (let i = 0; i < 8; i++) PROPS.push({ kind: 'cone', x: -100 + (i % 2) * 6, y: SY, z: -75 + i * 9, rot: 0 });
}

/** Deck-surface queries for the car (everything is metal deck plate). */
export const STATION_QUERIES: WorldQueries = {
  surfaceAt: () => 'concrete',
  inStickZone: () => false,
  boostAt: (x, z) => BOOSTS.some((p) => pointInRect(x, z, { cx: p.x, cz: p.z, hw: p.width / 2, hd: p.length / 2, rot: p.heading })),
  gravity: SPACE_GRAVITY,
  thrusters: true,
};

/**
 * A ramp's height `s` m along it: easing in from the deck (so fast, low cars roll onto it
 * instead of hopping), then straight up to the lip.
 */
export function wedgeHeight(w: Wedge, s: number) {
  const L0 = w.len * 0.35, m = w.h / (w.len - L0 / 2);
  return s < L0 ? (m * s * s) / (2 * L0) : m * L0 / 2 + m * (s - L0);
}

/** Distances along a ramp where its surface bends (its curved foot in a few flat pieces). */
const wedgeStops = (w: Wedge) => [0, 0.1, 0.2, 0.35, 1].map((f) => f * w.len);

/**
 * A ramp as solid slices (each one convex, for the physics): per slice its 8 corners
 * [x, y, z] (y deck-relative): start left bottom/top, start right bottom/top, then the same at its end.
 */
export function wedgeSlices(w: Wedge): [number, number, number][][] {
  const [ux, uz] = dir(w.heading);
  const px = uz, pz = -ux; // across
  const stops = wedgeStops(w);
  const out: [number, number, number][][] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const pts: [number, number, number][] = [];
    // (Each slice starts a little inside the one before, so no face of it is left showing at the joins.)
    for (const t of [Math.max(0, stops[i] - 0.6), stops[i + 1]])
      for (const sd of [-1, 1]) {
        const x = w.x + ux * t + px * sd * (w.w / 2), z = w.z + uz * t + pz * sd * (w.w / 2);
        pts.push([x, 0, z], [x, wedgeHeight(w, t), z]);
      }
    out.push(pts);
  }
  return out;
}

/** Is a point (deck-relative) over the deck? */
export function overDeck(x: number, z: number) {
  for (let k = 0; k < 8; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 4;
    if (Math.cos(a) * x + Math.sin(a) * z > DECK.R) return false;
  }
  return true;
}

/** Every collider of the station (deck, ramps, rails, pylons, the rocket), in `physics`. */
export function addStationColliders(physics: Physics) {
  const world = physics.world;
  const C = DECK_CORNER;
  const ring: number[] = [];
  for (let k = 0; k < 8; k++) {
    const a = -Math.PI / 2 - Math.PI / 8 + (k * Math.PI) / 4;
    for (const y of [SY, SY - DECK.thick]) ring.push(Math.cos(a) * C, y, Math.sin(a) * C);
  }
  const deck = world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(ring))!.setFriction(0.9));
  physics.setOwner(deck, { kind: 'ground', material: 'metal' });
  for (const w of WEDGES)
    for (const slice of wedgeSlices(w)) {
      // (Down into the deck a little, and the foot's first edge is just a line: the hull still works.)
      const pts = slice.flatMap(([x, y, z]) => [x, SY + (y === 0 ? -0.3 : Math.max(y, 0.02)), z]);
      const c = world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(pts))!.setFriction(0.9));
      physics.setOwner(c, { kind: 'ground', material: 'metal' });
      // Like the loop-the-loop: the wheels ride it and the cabin can't pass through it, but
      // a low nose doesn't scrape on the way up (that bumped a flat-out Lambo off line).
      physics.registerLoop(c);
    }
  for (const b of BLOCKS) {
    const c = world.createCollider(
      RAPIER.ColliderDesc.cuboid(b.sx / 2, b.sy / 2, b.sz / 2)
        .setTranslation(b.x, SY + b.y, b.z)
        .setRotation({ x: 0, y: Math.sin(b.heading / 2), z: 0, w: Math.cos(b.heading / 2) }),
    );
    physics.setOwner(c, { kind: 'static', material: 'metal' });
  }
  // The rocket on its landing pad.
  const rocket = world.createCollider(RAPIER.ColliderDesc.cylinder(22, 3.6).setTranslation(LANDING.x, SY + 22.4, LANDING.z));
  physics.setOwner(rocket, { kind: 'static', material: 'metal' });
  const boosters = world.createCollider(RAPIER.ColliderDesc.cuboid(6.2, 9, 1.5).setTranslation(LANDING.x, SY + 9.4, LANDING.z));
  physics.setOwner(boosters, { kind: 'static', material: 'metal' });
}

/** Where the net's tractor beam aims to set a car down (near the middle of the deck). */
export function bounceTarget(r1: number, r2: number) {
  return { x: (r1 - 0.5) * 80, z: (r2 - 0.5) * 60 - 10 };
}

/**
 * Springing back up off the net: straight up beside the station, high enough to come
 * down onto the deck (anything that fell right under the deck is first pushed out past
 * its edge). Then `homing` steers it in over the deck.
 */
export function netBounce(x: number, y: number, z: number) {
  const from = { x, y: Math.max(y, NET.y), z };
  const r = Math.hypot(x, z), out = DECK_CORNER + 16;
  if (r < out) {
    if (r > 1) (from.x *= out / r), (from.z *= out / r);
    else (from.x = out), (from.z = 0);
  }
  const vy = Math.sqrt(2 * SPACE_GRAVITY * (SY + BOUNCE_TOP - from.y));
  return { from, v: { x: 0, y: vy, z: 0 } };
}
/** How high over the deck the bounce goes. */
const BOUNCE_TOP = 38;

/**
 * The tractor beam, each step of a bounce: the sideways velocity the car should have
 * (none until it's up above the deck, then whatever brings it down on the target).
 */
export function homing(x: number, y: number, z: number, vy: number, target: { x: number; z: number }) {
  if (y < SY + 6) return vy > 0 ? { x: 0, z: 0 } : null;
  const g = SPACE_GRAVITY, h = y - (SY + 0.5);
  const t = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * h))) / g;
  if (t < 0.05) return null;
  return { x: (target.x - x) / t, z: (target.z - z) / t };
}
