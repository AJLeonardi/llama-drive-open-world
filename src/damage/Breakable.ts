import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { PROP_DEFS, PropKind, PropSpawn, propHalfHeight } from '../world/propModels';
import { objectDamage } from './Damage';
import type { Particles } from '../fx/Particles';
import type { Debris } from '../fx/Debris';

export interface Prop {
  kind: PropKind;
  mesh: THREE.InstancedMesh;
  index: number;
  /** Physics body — only exists while the prop is near the player (see `stream`). */
  body: RAPIER.RigidBody | null;
  /** Current pose (kept while the body is streamed out). */
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  cell: string;
  hp: number;
  fixed: boolean;
  removed: boolean;
  /** Seconds of water left (knocked-over hydrants). */
  fountain: number;
  base: THREE.Vector3;
}

const m4 = new THREE.Matrix4();
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);
const zero = new THREE.Matrix4().makeScale(0, 0, 0);
const col = new THREE.Color();

let plankMat: THREE.MeshLambertMaterial | null = null;
const plankMaterial = () => (plankMat ??= new THREE.MeshLambertMaterial({ vertexColors: true }));

export interface HitResult {
  destroyed: boolean;
  toppled: boolean;
}

/** Props are drawn per (kind, map tile), so distant and off-screen tiles get culled. */
const TILE = 400;
/** Small props aren't worth drawing past this distance (fog makes them faint anyway). */
const PROP_VIEW = 520;
/**
 * Physics streaming: props only get a rigid body within LOAD_R of the player and lose
 * it (once at rest) beyond UNLOAD_R. Thousands of idle bodies would otherwise cost
 * several milliseconds per physics step.
 */
const CELL = 50;
const LOAD_R = 150;
const UNLOAD_R = 210;
const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

/** All small world objects, rendered with InstancedMeshes grouped by kind and tile. */
export class Breakable {
  readonly group = new THREE.Group();
  private meshes: { mesh: THREE.InstancedMesh; cx: number; cz: number }[] = [];
  private slots: { mesh: THREE.InstancedMesh; index: number }[] = [];
  private visTimer = 0;
  private props: Prop[] = [];
  private cells = new Map<string, Prop[]>();
  private loaded = new Set<string>();
  private streamTimer = 0;
  private moving = new Set<Prop>();
  private fountains: Prop[] = [];
  private chunkGeo = new Map<PropKind, THREE.BufferGeometry>();
  /** Exploding barrels about to go off (chain reactions ripple outwards). */
  private fuses: { prop: Prop; t: number }[] = [];
  /** Props that fall below this height are gone (off the edge of the space station). */
  killBelow = -Infinity;
  /** Called for every explosion (the game adds the fireball, boom and the push on cars). */
  onBlast: (at: THREE.Vector3) => void = () => {};

  constructor(private readonly physics: Physics, private readonly spawns: PropSpawn[]) {
    const tileKey = (sp: PropSpawn) => `${sp.kind}|${Math.floor(sp.x / TILE)},${Math.floor(sp.z / TILE)}`;
    const groups = new Map<string, PropSpawn[]>();
    for (const sp of spawns) {
      const k = tileKey(sp);
      let l = groups.get(k);
      if (!l) groups.set(k, (l = []));
      l.push(sp);
    }
    const shared = new Map<PropKind, { geo: THREE.BufferGeometry; mat: THREE.Material }>();
    const meshFor = new Map<string, THREE.InstancedMesh>();
    for (const [key, list] of groups) {
      const kind = list[0].kind;
      let sh = shared.get(kind);
      if (!sh) {
        const def = PROP_DEFS[kind];
        sh = { geo: def.geo(), mat: def.material ? def.material() : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 }) };
        shared.set(kind, sh);
      }
      const mesh = new THREE.InstancedMesh(sh.geo, sh.mat, list.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const cx = (Math.floor(list[0].x / TILE) + 0.5) * TILE, cz = (Math.floor(list[0].z / TILE) + 0.5) * TILE;
      // Generous bounds so knocked-over props that roll out of their tile still draw.
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, list[0].y, cz), TILE);
      meshFor.set(key, mesh);
      this.meshes.push({ mesh, cx, cz });
      this.group.add(mesh);
    }
    const next = new Map<THREE.InstancedMesh, number>();
    for (const sp of spawns) {
      const mesh = meshFor.get(tileKey(sp))!;
      const index = next.get(mesh) ?? 0;
      next.set(mesh, index + 1);
      this.slots.push({ mesh, index });
    }
    this.populate();
  }

  /** Put every prop back in its starting place (bodies are created by `stream`). */
  populate() {
    for (const p of this.props) if (p.body) this.physics.removeBody(p.body);
    this.props = [];
    this.cells.clear();
    this.loaded.clear();
    this.moving.clear();
    this.fountains = [];
    this.fuses = [];
    this.streamTimer = 0;
    this.spawns.forEach((s, i) => {
      const def = PROP_DEFS[s.kind];
      const { mesh, index } = this.slots[i];
      const hh = propHalfHeight(def);
      const prop: Prop = {
        kind: s.kind, mesh, index, body: null, hp: 100, fixed: def.fixed, removed: false, fountain: 0,
        base: new THREE.Vector3(s.x, s.y, s.z),
        pos: new THREE.Vector3(s.x, s.y + hh, s.z),
        quat: new THREE.Quaternion(0, Math.sin(s.rot / 2), 0, Math.cos(s.rot / 2)),
        cell: cellKey(s.x, s.z),
      };
      this.props.push(prop);
      let list = this.cells.get(prop.cell);
      if (!list) this.cells.set(prop.cell, (list = []));
      list.push(prop);
      m4.compose(prop.pos, prop.quat, one);
      mesh.setMatrixAt(index, m4);
      if (s.color !== undefined) mesh.setColorAt(index, col.setHex(s.color));
      else if (s.kind === 'tree') mesh.setColorAt(index, col.setHSL(0.25 + Math.sin(i * 12.9) * 0.04, 0.35, 0.82 + Math.sin(i * 7.3) * 0.12));
      else if (mesh.instanceColor) mesh.setColorAt(index, col.setRGB(1, 1, 1));
    });
    for (const { mesh } of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private createBody(prop: Prop) {
    const def = PROP_DEFS[prop.kind];
    const desc = (prop.fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic().setSleeping(true))
      .setTranslation(prop.pos.x, prop.pos.y, prop.pos.z)
      .setRotation(prop.quat);
    const body = this.physics.world.createRigidBody(desc);
    const sh = def.shape;
    const cd = sh.type === 'box' ? RAPIER.ColliderDesc.cuboid(sh.hx, sh.hy, sh.hz) : RAPIER.ColliderDesc.cylinder(sh.hh, sh.r);
    const collider = this.physics.world.createCollider(cd.setMass(def.mass).setFriction(0.7).setRestitution(0.15), body);
    this.physics.setOwner(collider, { kind: 'prop', material: def.material_, ref: prop });
    prop.body = body;
    if (!prop.fixed) this.moving.add(prop);
  }

  private dropBody(prop: Prop) {
    const b = prop.body!;
    const t = b.translation(), r = b.rotation();
    prop.pos.set(t.x, t.y, t.z);
    prop.quat.set(r.x, r.y, r.z, r.w);
    this.physics.removeBody(b);
    prop.body = null;
    this.moving.delete(prop);
  }

  /** Give props near `center` physics bodies and take them away from far, resting ones. */
  stream(center: THREE.Vector3Like, force = false) {
    const cx = Math.floor(center.x / CELL), cz = Math.floor(center.z / CELL);
    const r = Math.ceil(LOAD_R / CELL);
    for (let ix = cx - r; ix <= cx + r; ix++)
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const key = `${ix},${iz}`;
        if (this.loaded.has(key)) continue;
        const dx = (ix + 0.5) * CELL - center.x, dz = (iz + 0.5) * CELL - center.z;
        if (Math.hypot(dx, dz) > LOAD_R + CELL) continue;
        this.loaded.add(key);
        for (const p of this.cells.get(key) ?? []) if (!p.body && !p.removed) this.createBody(p);
      }
    for (const key of this.loaded) {
      const [ix, iz] = key.split(',').map(Number);
      const dx = (ix + 0.5) * CELL - center.x, dz = (iz + 0.5) * CELL - center.z;
      if (Math.hypot(dx, dz) < UNLOAD_R && !force) continue;
      let allResting = true;
      for (const p of this.cells.get(key) ?? []) {
        if (!p.body) continue;
        if (p.fixed || p.body.isSleeping()) this.dropBody(p);
        else allResting = false;
      }
      if (allResting) this.loaded.delete(key);
    }
  }

  /** How many props currently have physics bodies (debug). */
  activeBodies() {
    return this.props.reduce((n, p) => n + (p.body ? 1 : 0), 0);
  }

  /** Snap a bolted-down prop off its base and send it flying along `dir` at roughly `speed`. */
  breakOff(prop: Prop, point: THREE.Vector3Like, dir: THREE.Vector3Like, speed: number, particles: Particles) {
    if (!prop.fixed || !prop.body || prop.removed) return;
    const def = PROP_DEFS[prop.kind];
    prop.fixed = false;
    prop.hp = 0;
    prop.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    const k = def.mass * speed * 0.9;
    prop.body.applyImpulseAtPoint({ x: dir.x * k, y: k * 0.25, z: dir.z * k }, point, true);
    this.moving.add(prop);
    if (prop.kind === 'hydrant' && prop.fountain <= 0) {
      prop.fountain = 8;
      this.fountains.push(prop);
    }
    particles.sparksAt(point, 16);
  }

  /** The car hit a prop. */
  hit(prop: Prop, impulse: number, carMass: number, point: THREE.Vector3Like, normal: THREE.Vector3Like, particles: Particles, debris: Debris): HitResult {
    const def = PROP_DEFS[prop.kind];
    const res: HitResult = { destroyed: false, toppled: false };
    if (prop.removed || !prop.body) return res;
    prop.hp -= objectDamage(impulse, carMass, def.toughness);
    if (prop.hp > 0) return res;

    if (def.style === 'topple' && prop.fixed) {
      prop.fixed = false;
      prop.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      const k = Math.min(impulse * 0.25, def.mass * 12);
      prop.body.applyImpulseAtPoint({ x: normal.x * k, y: k * 0.15, z: normal.z * k }, point, true);
      this.moving.add(prop);
      if (prop.kind === 'hydrant') {
        prop.fountain = 8;
        this.fountains.push(prop);
      }
      if (prop.kind === 'tree') particles.splinters(point, 14, 0x4ca345);
      res.toppled = true;
    } else if (def.style === 'shatter') {
      this.shatter(prop, normal, particles, debris);
      res.destroyed = true;
    }
    return res;
  }

  /** Blow up an exploding barrel: it's gone, nearby things get thrown, nearby barrels go off next. */
  explode(prop: Prop, particles: Particles, debris: Debris) {
    if (prop.removed || !prop.body) return;
    const t = prop.body.translation();
    const center = new THREE.Vector3(t.x, t.y, t.z);
    this.shatter(prop, { x: 0, y: 1, z: 0 }, particles, debris);
    const R = 11;
    for (const p of this.props) {
      if (!p.body || p.removed) continue;
      const b = p.body.translation();
      const dx = b.x - center.x, dy = b.y - center.y, dz = b.z - center.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > R) continue;
      const def = PROP_DEFS[p.kind];
      if (def.explosive) {
        // Ripple outwards: closer barrels go first.
        if (!this.fuses.some((f) => f.prop === p)) this.fuses.push({ prop: p, t: 0.07 + d * 0.05 + Math.random() * 0.05 });
        continue;
      }
      const fall = 1 - d / R;
      if (p.fixed) {
        // Posts, trees and benches close to the blast get knocked flat.
        if (fall < 0.45 || p.kind === 'tree') continue;
        p.fixed = false;
        p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        this.moving.add(p);
      }
      const k = def.mass * 14 * fall;
      const inv = 1 / Math.max(0.5, d);
      p.body.applyImpulse({ x: dx * inv * k, y: k * 0.8, z: dz * inv * k }, true);
      p.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * k * 0.3, y: 0, z: (Math.random() - 0.5) * k * 0.3 }, true);
    }
    this.onBlast(center);
  }

  private shatter(prop: Prop, normal: THREE.Vector3Like, particles: Particles, debris: Debris) {
    const def = PROP_DEFS[prop.kind];
    const body = prop.body!;
    const t = body.translation();
    const r = body.rotation();
    const v = body.linvel();
    prop.removed = true;
    this.physics.removeBody(body);
    prop.body = null;
    this.moving.delete(prop);
    const mesh = prop.mesh;
    mesh.setMatrixAt(prop.index, zero);
    mesh.instanceMatrix.needsUpdate = true;

    // Planks flying apart.
    const glass = def.material_ === 'glass';
    let g = this.chunkGeo.get(prop.kind);
    if (!g) {
      g = glass ? new THREE.BoxGeometry(0.04, 0.5, 0.45) : new THREE.BoxGeometry(0.95, 0.12, 0.3);
      const c = new THREE.Color(def.chunkColor);
      const arr = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      this.chunkGeo.set(prop.kind, g);
    }
    const mat = plankMaterial();
    const center = new THREE.Vector3(t.x, t.y, t.z);
    const rq = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const vel = { x: v.x + normal.x * 6, y: v.y + 2, z: v.z + normal.z * 6 };
    for (let i = 0; i < 6; i++) {
      const plank = new THREE.Mesh(g, mat);
      const off = new THREE.Vector3((i % 2) * 0.4 - 0.2, (i / 6) * 0.9 - 0.4, (i % 3) * 0.3 - 0.3).applyQuaternion(rq);
      plank.position.copy(center).add(off);
      plank.quaternion.copy(rq).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random(), Math.random() * 3, 0)));
      plank.updateMatrixWorld();
      this.group.add(plank);
      debris.release(plank, vel, 5, false, 'wood', 300);
    }
    if (glass) particles.glass(center, 90, vel);
    else particles.splinters(center, 20, def.chunkColor);
  }

  update(dt: number, particles: Particles, debris: Debris, camera: THREE.Vector3, player: THREE.Vector3Like) {
    this.streamTimer -= dt;
    if (this.streamTimer <= 0) {
      this.streamTimer = 0.25;
      this.stream(player);
    }
    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = 0.4;
      for (const m of this.meshes) m.mesh.visible = Math.hypot(m.cx - camera.x, m.cz - camera.z) < PROP_VIEW + TILE * 0.7;
    }
    const touched = new Set<THREE.InstancedMesh>();
    for (const p of this.moving) {
      if (!p.body || p.body.isSleeping()) continue;
      const t = p.body.translation();
      if (t.y < this.killBelow) {
        p.removed = true;
        this.physics.removeBody(p.body);
        p.body = null;
        this.moving.delete(p);
        p.mesh.setMatrixAt(p.index, zero);
        touched.add(p.mesh);
        continue;
      }
      const r = p.body.rotation();
      m4.compose(pos.set(t.x, t.y, t.z), quat.set(r.x, r.y, r.z, r.w), one);
      p.mesh.setMatrixAt(p.index, m4);
      touched.add(p.mesh);
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;

    for (let i = this.fuses.length - 1; i >= 0; i--) {
      const f = this.fuses[i];
      f.t -= dt;
      if (f.t > 0) continue;
      this.fuses.splice(i, 1);
      this.explode(f.prop, particles, debris);
    }

    for (const f of this.fountains) {
      if (f.fountain <= 0) continue;
      f.fountain -= dt;
      particles.spray({ x: f.base.x, y: f.base.y + 0.3, z: f.base.z }, 9);
    }
  }
}
