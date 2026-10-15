import * as THREE from 'three';
import { crackTexture } from '../util/textures';

export type PartKind = 'body' | 'panel' | 'glass' | 'trim' | 'interior';

/** Render material for a part. Colours come from vertex colours; these set the finish. */
export type Finish = 'paint' | 'plastic' | 'satin' | 'chrome' | 'glass' | 'headlight' | 'taillight' | 'rubber' | 'interior' | 'brokenLight' | 'engine';

export interface CarPart {
  name: string;
  kind: PartKind;
  mesh: THREE.Mesh;
  /** Falls off after enough local damage. */
  detachable: boolean;
  damage: number;
  detached: boolean;
  cracked: boolean;
  /** Undamaged vertex positions, used to cap how deep dents can go. */
  original: Float32Array;
  /** Bounding sphere centre in car-local space. */
  center: THREE.Vector3;
  radius: number;
  /** What it sounds like when it falls off / gets hit. */
  sound: 'metal' | 'glass' | 'plastic';
  /** Hinged parts (hood, doors) swing open on this pivot when crumpled. */
  pivot?: THREE.Group;
  /** How the hinged part swings: hood up at the front, door out sideways, scissor door up. */
  swing?: 'hood' | 'door' | 'up';
  popped: boolean;
  /** Head/tail lights go dark when smashed. */
  light: boolean;
}

export interface CarModel {
  /** Follows the chassis rigid body. */
  root: THREE.Group;
  parts: CarPart[];
  /** Wheel pivots (positioned each frame from the suspension). The first child spins around local x. */
  wheels: THREE.Group[];
  steeringWheel: THREE.Object3D;
  /** Instrument needles (rotate about their local z) — speedometer and rev counter. */
  gauges?: { speed: THREE.Object3D; rpm: THREE.Object3D };
  /** Where engine smoke comes out (car local). */
  smokePoint: THREE.Vector3;
  /** Outside views show solid tinted windows instead of see-through glass (cockpit view stays clear). */
  tintedGlass?: boolean;
}

/** Parts hidden while driving from the cockpit so the roof doesn't block the view. */
export const COCKPIT_HIDDEN = new Set(['roof', 'pillars']);

let shared: (Record<Finish, THREE.Material> & { glassCracked: THREE.Material; glassCrackedTinted: THREE.Material; glassTinted: THREE.Material }) | null = null;

/** Shared car materials (PBR, so paint and chrome pick up reflections from the sky). */
export function carMaterials() {
  if (!shared) {
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, ...p });
    shared = {
      paint: std({ metalness: 0.35, roughness: 0.22, envMapIntensity: 1.3 }),
      plastic: std({ metalness: 0.0, roughness: 0.6 }),
      satin: std({ metalness: 0.15, roughness: 0.45, envMapIntensity: 0.8 }),
      chrome: std({ metalness: 1.0, roughness: 0.16, envMapIntensity: 1.4 }),
      rubber: std({ metalness: 0.0, roughness: 0.92 }),
      interior: std({ metalness: 0.0, roughness: 0.8 }),
      engine: std({ metalness: 0.6, roughness: 0.45 }),
      brokenLight: new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.35, metalness: 0.3 }),
      headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 1.1, roughness: 0.1, metalness: 0.2 }),
      taillight: new THREE.MeshStandardMaterial({ color: 0x700000, emissive: 0xff1616, emissiveIntensity: 0.9, roughness: 0.2 }),
      glass: new THREE.MeshStandardMaterial({
        // Nearly clear: easy to see through from the cockpit, faint reflections show it's glass.
        color: 0xd4e2ec, metalness: 0.0, roughness: 0.05, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 0.5,
      }),
      glassTinted: new THREE.MeshStandardMaterial({
        // Solid dark tint for outside views: reads as windows without showing the cabin.
        color: 0x1a232c, metalness: 0.1, roughness: 0.06, side: THREE.DoubleSide, envMapIntensity: 1.3,
      }),
      // Cracked glass: still see-through (or still tinted), with bright crack lines.
      // See-through between the cracks (light frosting), bright crack lines.
      glassCracked: new THREE.MeshStandardMaterial({
        color: 0xe4ecf2, map: crackTexture(true), emissive: 0xffffff, emissiveMap: crackTexture(false), emissiveIntensity: 0.35,
        metalness: 0, roughness: 0.2, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      }),
      glassCrackedTinted: new THREE.MeshStandardMaterial({
        color: 0x1a232c, emissive: 0xffffff, emissiveMap: crackTexture(false), emissiveIntensity: 0.45,
        metalness: 0.1, roughness: 0.15, side: THREE.DoubleSide, envMapIntensity: 1.0,
      }),
    };
  }
  return shared;
}

const DEFAULT_FINISH: Record<PartKind, Finish> = { body: 'paint', panel: 'paint', glass: 'glass', trim: 'plastic', interior: 'interior' };

/** Helper used by the builders to register parts on a model. */
export class ModelBuilder {
  readonly root = new THREE.Group();
  readonly parts: CarPart[] = [];
  readonly wheels: THREE.Group[] = [];
  steeringWheel: THREE.Object3D = new THREE.Object3D();
  gauges?: { speed: THREE.Object3D; rpm: THREE.Object3D };

  part(
    name: string,
    kind: PartKind,
    geo: THREE.BufferGeometry,
    opts: { detachable?: boolean; finish?: Finish; sound?: CarPart['sound']; hinge?: [number, number, number]; swing?: CarPart['swing'] } = {},
  ) {
    const finish = opts.finish ?? DEFAULT_FINISH[kind];
    const mesh = new THREE.Mesh(geo, carMaterials()[finish]);
    mesh.name = name;
    mesh.castShadow = kind !== 'glass';
    if (kind === 'glass') mesh.renderOrder = 2;
    let pivot: THREE.Group | undefined;
    if (opts.hinge) {
      // Geometry stays in car space; the pivot sits on the hinge line so the part can swing.
      pivot = new THREE.Group();
      pivot.position.set(...opts.hinge);
      mesh.position.set(-opts.hinge[0], -opts.hinge[1], -opts.hinge[2]);
      pivot.add(mesh);
      this.root.add(pivot);
    } else {
      this.root.add(mesh);
    }
    geo.computeBoundingSphere();
    const bs = geo.boundingSphere!;
    const p: CarPart = {
      name, kind, mesh,
      detachable: opts.detachable ?? false,
      damage: 0, detached: false, cracked: false,
      original: (geo.attributes.position.array as Float32Array).slice(),
      center: bs.center.clone(),
      radius: bs.radius,
      sound: opts.sound ?? (kind === 'glass' ? 'glass' : finish === 'plastic' || finish === 'satin' ? 'plastic' : 'metal'),
      pivot,
      swing: opts.hinge ? opts.swing ?? 'hood' : undefined,
      popped: false,
      light: finish === 'headlight' || finish === 'taillight',
    };
    this.parts.push(p);
    return p;
  }

  /** A non-damageable decorative mesh (lights, badges…). Still detaches with nothing. */
  detail(geo: THREE.BufferGeometry, finish: Finish) {
    return this.part(`detail-${this.parts.length}`, 'trim', geo, { finish });
  }

  /** Wheel at `at`, made of several (geometry, finish) pieces built around the origin with the axle along x. */
  wheel(at: [number, number, number], pieces: [THREE.BufferGeometry, Finish][], mirror: boolean) {
    const g = new THREE.Group();
    g.position.set(...at);
    g.userData.rest = new THREE.Vector3(...at);
    const spin = new THREE.Group();
    // Right-side wheels are mirrored so the rim faces outward on both sides.
    if (mirror) spin.scale.x = -1;
    for (const [geo, finish] of pieces) {
      const m = new THREE.Mesh(geo, carMaterials()[finish]);
      m.castShadow = true;
      spin.add(m);
    }
    g.add(spin);
    this.root.add(g);
    this.wheels.push(g);
    return g;
  }

  /**
   * Split the one-piece 'glass' part into separate windows — windshield, back glass,
   * and side windows divided at the pillars (`cuts`, z positions) — so a hit only
   * cracks or smashes the windows near it.
   */
  splitGlass(cuts: number[]) {
    const i = this.parts.findIndex((p) => p.name === 'glass');
    if (i < 0) return;
    const old = this.parts[i];
    const geo = old.mesh.geometry;
    const pos = geo.attributes.position, index = geo.index!;
    const groups = new Map<string, number[]>();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let t = 0; t < index.count; t += 3) {
      const [ia, ib, ic] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      a.fromBufferAttribute(pos, ia);
      b.fromBufferAttribute(pos, ib);
      c.fromBufferAttribute(pos, ic);
      n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      const cz = (a.z + b.z + c.z) / 3;
      // By the way each bit of glass mostly faces (corner strips go with the sides or top).
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      let key: string;
      if (az > ax && az > ay) key = cz > 0 ? 'front' : 'back';
      else if (ax >= ay) key = `${(a.x + b.x + c.x) / 3 > 0 ? 'l' : 'r'}${cuts.filter((z) => cz < z).length}`;
      else key = 'top';
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(ia, ib, ic);
    }
    old.mesh.removeFromParent();
    this.parts.splice(i, 1);
    for (const [key, idx] of groups) {
      // Own compact geometry, so each window's bounds are its own.
      const sub = geo.clone();
      sub.setIndex(idx);
      const compact = sub.toNonIndexed();
      sub.dispose();
      compact.computeVertexNormals();
      // Flat UVs across each window (about 1.2 m per crack pattern) so cracks show properly.
      const cp = compact.attributes.position;
      const uv = new Float32Array(cp.count * 2);
      for (let k = 0; k < cp.count; k++) {
        const [x, y, z] = [cp.getX(k), cp.getY(k), cp.getZ(k)];
        const [u, v] = key === 'front' || key === 'back' ? [x, y] : key === 'top' ? [x, z] : [z, y];
        uv.set([u / 1.2, v / 1.2], k * 2);
      }
      compact.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      this.part(`glass-${key}`, 'glass', compact);
    }
    geo.dispose();
  }

  build(smokePoint: THREE.Vector3, opts: { tintedGlass?: boolean } = {}): CarModel {
    // Tinted windows are the default look (car picker, chase view); the cockpit view clears them.
    if (opts.tintedGlass) for (const p of this.parts) if (p.kind === 'glass') p.mesh.material = carMaterials().glassTinted;
    return { root: this.root, parts: this.parts, wheels: this.wheels, steeringWheel: this.steeringWheel, gauges: this.gauges, smokePoint, ...opts };
  }
}
