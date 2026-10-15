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
  /** Hinged parts (the hood) swing open on this pivot when crumpled. */
  pivot?: THREE.Group;
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
  /** Where engine smoke comes out (car local). */
  smokePoint: THREE.Vector3;
}

/** Parts hidden while driving from the cockpit so the roof doesn't block the view. */
export const COCKPIT_HIDDEN = new Set(['roof', 'pillars']);

let shared: (Record<Finish, THREE.Material> & { glassCracked: THREE.Material }) | null = null;

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
      glassCracked: new THREE.MeshStandardMaterial({
        color: 0xe8f0f4, map: crackTexture(), metalness: 0, roughness: 0.3, transparent: true, opacity: 0.88,
        side: THREE.DoubleSide, depthWrite: false,
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

  part(
    name: string,
    kind: PartKind,
    geo: THREE.BufferGeometry,
    opts: { detachable?: boolean; finish?: Finish; sound?: CarPart['sound']; hinge?: [number, number, number] } = {},
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

  build(smokePoint: THREE.Vector3): CarModel {
    return { root: this.root, parts: this.parts, wheels: this.wheels, steeringWheel: this.steeringWheel, smokePoint };
  }
}
