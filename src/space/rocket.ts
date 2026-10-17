// The space ship: a tall white rocket with an orange nose, red fins, two strap-on
// boosters and a big round window, standing on its engine bells. Built in code like
// the cars. Its flames are separate meshes, scaled by `setThrust`.
import * as THREE from 'three';
import { blob, box, cyl, merge, paint } from '../vehicles/builders/geo';

/** How tall the rocket stands, from the bottom of its engine bells (m). */
export const ROCKET_HEIGHT = 44;
/** Body radius (m). */
export const ROCKET_R = 3.4;

let mats: { body: THREE.Material; glass: THREE.Material; flame: THREE.Material } | null = null;
let shared: { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; flame: THREE.BufferGeometry } | null = null;

function materials() {
  return (mats ??= {
    body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.15 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fe3ff, emissive: 0x2a7fb0, emissiveIntensity: 0.9, roughness: 0.05, metalness: 0.4 }),
    flame: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  });
}

/** Body profile: [radius, height]. */
const PROFILE: [number, number][] = [
  [2.2, 3.2], [ROCKET_R, 3.6], [ROCKET_R, 27], [ROCKET_R * 0.97, 29], [ROCKET_R * 0.88, 32], [ROCKET_R * 0.72, 35],
  [ROCKET_R * 0.5, 38], [ROCKET_R * 0.26, 41], [0.4, 43.3], [0, 44],
];

function geometries() {
  if (shared) return shared;
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 28);
  parts.push(paint(body, (_x, y) => {
    if (y > 33.5) return 0xf06a1c; // orange nose
    if (y > 32.6) return 0x1c1f24;
    if ((y > 24 && y < 25.2) || (y > 8 && y < 9.2)) return 0xf06a1c; // bands
    if (y > 15.5 && y < 16.1) return 0x1c1f24;
    return 0xf4f4f0;
  }));
  // Engine bells: one big one in the middle, four smaller round it.
  const bell = (x: number, z: number, r: number, h: number) =>
    parts.push(cyl({ at: [x, 3.4 - h / 2, z], radius: r, radiusTop: r * 0.45, length: h, axis: 'y', segments: 16, color: 0x3a3d42 }));
  bell(0, 0, 1.7, 3);
  for (let k = 0; k < 4; k++) bell(Math.cos(k * 1.5708 + 0.785) * 2.1, Math.sin(k * 1.5708 + 0.785) * 2.1, 0.75, 2);
  // Fins: four swept red fins at the base.
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(3.6, -2.2);
    shape.lineTo(3.8, 1.4);
    shape.lineTo(0, 9);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
    g.translate(ROCKET_R - 0.2, 2.6, -0.175);
    g.rotateY(a);
    parts.push(paint(g, 0xd22a22));
  }
  // Two boosters strapped on the sides.
  for (const s of [-1, 1]) {
    const x = s * (ROCKET_R + 1.35);
    parts.push(cyl({ at: [x, 12, 0], radius: 1.35, length: 17, axis: 'y', segments: 16, color: 0xe8e8e2 }));
    parts.push(cyl({ at: [x, 22.5, 0], radius: 1.35, radiusTop: 0.05, length: 4, axis: 'y', segments: 16, color: 0xf06a1c }));
    parts.push(cyl({ at: [x, 2.6, 0], radius: 0.9, radiusTop: 0.6, length: 1.6, axis: 'y', segments: 12, color: 0x3a3d42 }));
    for (const y of [6, 19]) parts.push(box({ at: [s * (ROCKET_R + 0.4), y, 0], size: [1.4, 0.5, 0.8], color: 0x8a8e94, seg: 100 }));
  }
  // Window frame and a ladder of portholes down the front (+z), and an antenna on top.
  parts.push(cyl({ at: [0, 30.5, ROCKET_R * 0.92], radius: 1.55, length: 0.5, axis: 'z', segments: 24, color: 0xb7bcc2 }));
  for (const y of [21, 18.5]) parts.push(cyl({ at: [0, y, ROCKET_R - 0.05], radius: 0.55, length: 0.3, axis: 'z', segments: 16, color: 0xb7bcc2 }));
  parts.push(cyl({ at: [0, 44.8, 0], radius: 0.06, length: 1.8, axis: 'y', segments: 6, color: 0xd0d4d8 }));
  const glassParts = [blob([0, 30.5, ROCKET_R * 0.92 + 0.22], [1.25, 1.25, 0.25], 0xffffff, 16)];
  for (const y of [21, 18.5]) glassParts.push(blob([0, y, ROCKET_R + 0.1], [0.42, 0.42, 0.12], 0xffffff, 10));
  // Flame: a cone pointing down, white-hot at the nozzle, orange, then fading out.
  const flame = new THREE.ConeGeometry(1.5, 14, 14, 6, true);
  flame.rotateX(Math.PI);
  flame.translate(0, -7, 0);
  paint(flame, (_x, y) => {
    const t = Math.min(1, -y / 14);
    const c = new THREE.Color(0xfff4d6).lerp(new THREE.Color(0xff8a1e), Math.min(1, t * 1.8)).lerp(new THREE.Color(0x000000), Math.max(0, t * 1.4 - 0.4));
    return [c.r, c.g, c.b];
  });
  return (shared = { body: merge(parts), glass: merge(glassParts), flame });
}

export interface Rocket {
  root: THREE.Group;
  /** 0 = engines off, 1 = full thrust (flames flicker). */
  setThrust(k: number, time: number): void;
}

/** A rocket, its base (bottom of the engine bells) at the group's origin. */
export function makeRocket(): Rocket {
  const m = materials(), g = geometries();
  const root = new THREE.Group();
  const body = new THREE.Mesh(g.body, m.body);
  body.castShadow = true;
  body.receiveShadow = true;
  const glass = new THREE.Mesh(g.glass, m.glass);
  // (The bells hang 3 m below the body's base; lift everything so the bells sit at 0.)
  const lift = new THREE.Group();
  lift.position.y = 3;
  lift.add(body, glass);
  root.add(lift);
  const flames: THREE.Mesh[] = [];
  const addFlame = (x: number, z: number, y: number, s: number) => {
    const f = new THREE.Mesh(g.flame, m.flame);
    f.position.set(x, y, z);
    f.scale.setScalar(s);
    f.userData.s = s;
    f.visible = false;
    f.frustumCulled = false;
    lift.add(f);
    flames.push(f);
  };
  addFlame(0, 0, 0.4, 1.1);
  for (const s of [-1, 1]) addFlame(s * (ROCKET_R + 1.35), 0, 1.8, 0.6);
  return {
    root,
    setThrust(k, time) {
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i];
        f.visible = k > 0.02;
        if (!f.visible) continue;
        const flick = 0.85 + 0.15 * Math.sin(time * 37 + i * 2.1) * Math.sin(time * 23 + i);
        const s = f.userData.s as number;
        f.scale.set(s * (0.7 + 0.3 * k), s * k * flick * 1.3, s * (0.7 + 0.3 * k));
      }
    },
  };
}
