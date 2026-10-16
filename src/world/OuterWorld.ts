// Highway country, streamed: the map beyond the middle is built in CHUNK-sized pieces
// around the player and thrown away again behind them. Each piece has its ground, the
// highway/ramp/Ring road surfaces, and whatever stands in it (bridges, radio towers,
// lakes, exit signs). Physics only exists for pieces right around the player.
// Building is spread over frames (a few ms each) so driving never stutters.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Physics, RAPIER } from '../physics/Physics';
import { CHUNK, OUTER, TERRAIN_CELL, WORLD } from './bounds';
import {
  CROSSINGS, CURVES, CurveRoad, HIGHWAYS, HW, Highway, OUTER_LAKES, PROFILE_STEP, RAMPS, Solid, TOWERS, besideHighway, bridgeSolids, forNearHighways, highwayCoords, outerLakeAt, outerRoadAt,
  TOWNS, nearestCurve, pointAt, profileAt, townAt, townDistance,
} from './outer';
import { heightAt, surfaceAt } from './layout';
import type { Surface } from '../physics/surfaces';
import { biomeAt, desertWeight, fieldEdgeDistance } from './biomes';
import { TREE_KINDS, TRUNK_RADIUS, TreeKind, treeDepthMaterial, treeGeometry, treeMaterial } from './trees';
import { townItems, townMaterials, townTreeSpots } from './townBuild';
import { bushGeometry, bushMaterial } from './bushes';
import { mulberry32, smoothstep } from '../util/math';
import { groundPiece, terrainPatch } from './terrain';
import { ROAD_ORDER, normalizeAttributes } from './batch';
import { box, cyl, paint } from '../vehicles/builders/geo';
import { textPanel } from './landmarks';

const N = CHUNK / TERRAIN_CELL; // cells per chunk side
/** Distances (m) from the player to a chunk's nearest point. */
const LOAD = 950, UNLOAD = 1350, PHYSICS_ON = 260, PHYSICS_OFF = 420, VIEW = 900;
/** Ground closer than this to the car must be built, with physics, whatever the frame budget. */
const NEAR_GROUND = 90;
const FRAME_BUDGET_MS = 3;
const ROAD_LIFT = 0.15;
const V_REPEAT = 16;

interface Chunk {
  ix: number;
  iz: number;
  x0: number;
  z0: number;
  /** Inside the middle of the map (its ground is built elsewhere). */
  inner: boolean;
  job: Generator<void, void> | null;
  group: THREE.Group;
  heights: Float32Array | null;
  /** Static colliders to create while the player is near. */
  solids: (() => RAPIER.Collider)[];
  colliders: RAPIER.Collider[] | null;
  geos: Map<string, THREE.BufferGeometry[]>;
  textures: THREE.Texture[];
  /** Tree meshes and how many trees each has (fewer are drawn far away). */
  trees: { mesh: THREE.InstancedMesh; full: number }[];
  /** Spots kept clear of trees (farmyards): x, z, radius. */
  clearings: [number, number, number][];
}

const chunkKey = (ix: number, iz: number) => `${ix},${iz}`;
const distToRect = (x: number, z: number, x0: number, z0: number, size: number) =>
  Math.hypot(Math.max(x0 - x, 0, x - (x0 + size)), Math.max(z0 - z, 0, z - (z0 + size)));

/** The physics collider for a solid box (also used by tests). */
export function addSolid(physics: Physics, b: Solid) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.heading);
  const col = physics.world.createCollider(
    RAPIER.ColliderDesc.cuboid(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2).setTranslation(...b.at).setRotation(q).setFriction(0.9),
  );
  physics.setOwner(col, { kind: b.kind, material: 'concrete' });
  return col;
}

/** A road surface strip along points (x, y, z), `hw` (or per point `w`) either side, with lengthwise UVs. */
function ribbon(pts: { x: number; y: number; z: number; w?: number }[], hw: number, v0: number) {
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [];
  let v = v0;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * (p.w ?? hw), pz = (dx / len) * (p.w ?? hw);
    if (i > 0) v += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) / V_REPEAT;
    pos.push(p.x + px, p.y, p.z + pz, p.x - px, p.y, p.z - pz);
    uv.push(0, v, 1, v);
    nrm.push(0, 1, 0, 0, 1, 0);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** Thin box between two points (tower legs and braces). */
function strut(a: THREE.Vector3, b: THREE.Vector3, w: number, color: number) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, w, len);
  g.applyMatrix4(new THREE.Matrix4().lookAt(a, b, Math.abs(b.y - a.y) > len * 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  const col = new Float32Array(g.attributes.position.count * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class OuterWorld {
  readonly group = new THREE.Group();
  private chunks = new Map<string, Chunk>();
  private building: Chunk | null = null;
  private timer = 0;
  private blink = 0;
  private readonly glow = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  private readonly water = new THREE.MeshStandardMaterial({ color: 0x2a6b96, metalness: 0.1, roughness: 0.06, transparent: true, opacity: 0.86, depthWrite: false, envMapIntensity: 1.2 });
  private readonly signTextures = new Map<string, THREE.Texture>();
  private readonly signGeo = new THREE.PlaneGeometry(7.5, 3.2);

  constructor(private readonly physics: Physics, private readonly materials: Record<string, THREE.Material>) {
    Object.assign(materials, townMaterials());
    // Paint the tree pictures and build the town now, while the game loads, rather than
    // the first time one comes into view (that would be a stutter mid-drive).
    for (const k of TREE_KINDS) treeMaterial(k), treeGeometry(k);
    townItems(() => false);
    // Invisible walls round the edge of the map (the Ring and the mountains come first).
    const W = OUTER;
    for (const [cx, cz, hx, hz] of [
      [(W.x0 + W.x1) / 2, W.z0, (W.x1 - W.x0) / 2, 2], [(W.x0 + W.x1) / 2, W.z1, (W.x1 - W.x0) / 2, 2],
      [W.x0, (W.z0 + W.z1) / 2, 2, (W.z1 - W.z0) / 2], [W.x1, (W.z0 + W.z1) / 2, 2, (W.z1 - W.z0) / 2],
    ]) {
      const col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 400, hz).setTranslation(cx, 100, cz));
      physics.setOwner(col, { kind: 'static', material: 'concrete' });
    }
  }

  /** Stream chunks round the player, finish building a bit of one, blink the tower lights. */
  update(dt: number, camera: THREE.Vector3Like, player: THREE.Vector3Like) {
    this.blink = (this.blink + dt) % 1.6;
    this.glow.color.setHex(this.blink < 0.5 ? 0xff2a1a : 0x3a0806);

    // If the building has fallen behind (a slow device, a fast car) and the car is about
    // to reach ground that isn't built yet, finish it now: a stutter beats falling
    // through the world.
    for (let ix = Math.floor((player.x - NEAR_GROUND) / CHUNK); ix <= Math.floor((player.x + NEAR_GROUND) / CHUNK); ix++)
      for (let iz = Math.floor((player.z - NEAR_GROUND) / CHUNK); iz <= Math.floor((player.z + NEAR_GROUND) / CHUNK); iz++) {
        const c = this.chunks.get(chunkKey(ix, iz)) ?? this.chunkAt(ix, iz);
        if (!c || c.colliders) continue;
        if (c.job) {
          const t = performance.now();
          while (!this.step(c));
          if (this.building === c) this.building = null;
          c.group.visible = true;
          console.log(`[perf] ground ahead not built in time: finished it now (${(performance.now() - t).toFixed(0)} ms)`);
        }
        this.physicsOn(c);
      }

    // Keep building whatever is in progress, within this frame's budget.
    const t0 = performance.now();
    while (performance.now() - t0 < FRAME_BUDGET_MS) {
      if (!this.building) this.building = this.nextToBuild(player);
      if (!this.building) break;
      if (this.step(this.building)) this.building = null;
    }

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.3;
    for (const c of this.chunks.values()) {
      const dp = distToRect(player.x, player.z, c.x0, c.z0, CHUNK);
      const dc = distToRect(camera.x, camera.z, c.x0, c.z0, CHUNK);
      if (dp > UNLOAD && c !== this.building) {
        this.dispose(c);
        continue;
      }
      c.group.visible = !c.job && dc < VIEW;
      // Far away (and in the fog) a forest needs fewer trees to look like one.
      const keep = dc < 260 ? 1 : dc < 500 ? 0.5 : 0.25;
      for (const t of c.trees) t.mesh.count = Math.ceil(t.full * keep);
      if (dp < PHYSICS_ON) this.physicsOn(c);
      else if (dp > PHYSICS_OFF) this.physicsOff(c);
    }
  }

  /** Make sure the ground (with physics) exists right round a spot — before putting a car there. */
  ensureAround(p: THREE.Vector3Like) {
    for (let ix = Math.floor((p.x - PHYSICS_ON) / CHUNK); ix <= Math.floor((p.x + PHYSICS_ON) / CHUNK); ix++)
      for (let iz = Math.floor((p.z - PHYSICS_ON) / CHUNK); iz <= Math.floor((p.z + PHYSICS_ON) / CHUNK); iz++) {
        const c = this.chunkAt(ix, iz);
        if (!c) continue;
        while (!this.step(c));
        if (this.building === c) this.building = null;
        this.physicsOn(c);
        c.group.visible = true;
      }
  }

  private chunkAt(ix: number, iz: number) {
    const x0 = ix * CHUNK, z0 = iz * CHUNK;
    if (x0 < OUTER.x0 || x0 + CHUNK > OUTER.x1 || z0 < OUTER.z0 || z0 + CHUNK > OUTER.z1) return null;
    const key = chunkKey(ix, iz);
    let c = this.chunks.get(key);
    if (!c) {
      const inner = x0 >= WORLD.x0 && x0 + CHUNK <= WORLD.x1 && z0 >= WORLD.z0 && z0 + CHUNK <= WORLD.z1;
      c = { ix, iz, x0, z0, inner, job: null, group: new THREE.Group(), heights: null, solids: [], colliders: null, geos: new Map(), textures: [], trees: [], clearings: [] };
      c.job = this.build(c);
      c.group.visible = false;
      this.group.add(c.group);
      this.chunks.set(key, c);
    }
    return c;
  }

  /** The nearest chunk within reach that isn't built yet. */
  private nextToBuild(p: THREE.Vector3Like): Chunk | null {
    let best: Chunk | null = null, bestD = LOAD;
    const r = Math.ceil(LOAD / CHUNK) + 1;
    const cx = Math.floor(p.x / CHUNK), cz = Math.floor(p.z / CHUNK);
    for (let ix = cx - r; ix <= cx + r; ix++)
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const d = distToRect(p.x, p.z, ix * CHUNK, iz * CHUNK, CHUNK);
        if (d >= bestD) continue;
        const existing = this.chunks.get(chunkKey(ix, iz));
        if (existing && !existing.job) continue;
        const c = existing ?? this.chunkAt(ix, iz);
        if (c && c.job) (best = c), (bestD = d);
      }
    return best;
  }

  /** Run one slice of a chunk's build. True when it's finished. */
  private step(c: Chunk) {
    if (!c.job) return true;
    if (c.job.next().done) {
      c.job = null;
      return true;
    }
    return false;
  }

  private add(c: Chunk, material: string, g: THREE.BufferGeometry) {
    normalizeAttributes(g);
    let l = c.geos.get(material);
    if (!l) c.geos.set(material, (l = []));
    l.push(g);
  }

  private *build(c: Chunk): Generator<void, void> {
    const { x0, z0 } = c;
    // --- ground (the middle of the map has its own)
    if (!c.inner) {
      const S = N + 3; // one extra sample all round, for slopes
      const h = new Float32Array(S * S);
      const surf: Surface[] = new Array((N + 1) * (N + 1));
      for (let r = 0; r < S; r++) {
        for (let k = 0; k < S; k++) {
          const x = x0 + (k - 1) * TERRAIN_CELL, z = z0 + (r - 1) * TERRAIN_CELL;
          h[r * S + k] = heightAt(x, z);
          if (r >= 1 && r <= N + 1 && k >= 1 && k <= N + 1) surf[(r - 1) * (N + 1) + (k - 1)] = surfaceAt(x, z);
        }
        if (r % 2 === 1) yield;
      }
      // (Chunks line up with WORLD's edges, so each one is wholly inside or outside it.)
      // The ground keeps its own mesh (its desert attribute doesn't survive merging).
      const ground = terrainPatch(x0, z0, N, N, (k, r) => h[(r + 1) * S + (k + 1)], true, (k, r) => surf[r * (N + 1) + k]);
      ground.computeBoundingSphere();
      const gm = new THREE.Mesh(ground, this.materials['ground-outer']);
      gm.matrixAutoUpdate = false;
      gm.receiveShadow = true;
      c.group.add(gm);
      this.bushes(c, h, S);
      yield;
      this.farms(c, h, S);
      this.trees(c, h, S);
      c.heights = new Float32Array((N + 1) * (N + 1));
      for (let r = 0; r <= N; r++) for (let k = 0; k <= N; k++) c.heights[r * (N + 1) + k] = h[(r + 1) * S + (k + 1)];
      const heights = c.heights;
      c.solids.push(() => groundPiece(this.physics, x0, z0, N + 1, N + 1, (k, r) => heights[r * (N + 1) + k]));
      yield;
    }
    // --- road surfaces
    for (const hw of HIGHWAYS) this.highwayRibbon(c, hw);
    for (const curve of CURVES) this.curveRibbon(c, curve);
    yield;
    // --- bridges, towers, lakes, signs
    const inChunk = (x: number, z: number) => x >= x0 && x < x0 + CHUNK && z >= z0 && z < z0 + CHUNK;
    for (const cr of CROSSINGS) if (inChunk(cr.x, cr.z)) this.bridge(c, cr);
    for (const t of TOWERS) if (inChunk(t.x, t.z)) this.tower(c, t.x, t.z, t.h);
    for (const l of OUTER_LAKES)
      if (inChunk(l.x, l.z)) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(l.r + 3, 40), this.water);
        m.geometry.rotateX(-Math.PI / 2);
        m.geometry.translate(l.x, l.level, l.z);
        m.renderOrder = 2;
        m.receiveShadow = true;
        c.group.add(m);
      }
    for (const r of RAMPS) this.exitSigns(c, r, inChunk);
    this.townSigns(c, inChunk);
    // The towns: their pieces that stand in this chunk.
    if (TOWNS.some((t) => townDistance(t, x0 + CHUNK / 2, z0 + CHUNK / 2) < CHUNK))
      for (const it of townItems(inChunk)) {
        for (const [k, g] of it.geos) this.add(c, k, g);
        for (const b of it.solids) c.solids.push(() => addSolid(this.physics, b));
        for (const o of it.objects) c.group.add(o);
        yield;
      }
    yield;
    // --- merge everything per material
    for (const [key, geos] of c.geos) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, key === 'glow' ? this.glow : this.materials[key]);
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = true;
      mesh.castShadow = key === 'plain' || !!this.materials[key]?.userData.castShadow;
      if (key.startsWith('road')) mesh.renderOrder = ROAD_ORDER[key] ?? 1;
      c.group.add(mesh);
      yield;
    }
    c.geos.clear();
  }

  /**
   * Desert scrub: thick along the highway verges, scattered across the open desert,
   * never on a road, a rock face or in water. (No physics: you can drive through.)
   */
  private bushes(c: Chunk, h: Float32Array, S: number) {
    const rng = mulberry32(c.ix * 7919 + c.iz * 104729 + 3);
    const ground = (x: number, z: number) => {
      const fx = (x - c.x0) / TERRAIN_CELL + 1, fz = (z - c.z0) / TERRAIN_CELL + 1;
      const k = Math.min(S - 2, Math.max(0, Math.floor(fx))), r = Math.min(S - 2, Math.max(0, Math.floor(fz)));
      const u = fx - k, v = fz - r;
      const at = (rr: number, kk: number) => h[rr * S + kk];
      const y = (at(r, k) * (1 - u) + at(r, k + 1) * u) * (1 - v) + (at(r + 1, k) * (1 - u) + at(r + 1, k + 1) * u) * v;
      const slope = Math.hypot(at(r, k + 1) - at(r, k), at(r + 1, k) - at(r, k)) / TERRAIN_CELL;
      return { y, slope };
    };
    const inChunk = (x: number, z: number) => x >= c.x0 && x < c.x0 + CHUNK && z >= c.z0 && z < c.z0 + CHUNK;
    const clear = (x: number, z: number) =>
      !outerRoadAt(x, z) && !outerRoadAt(x + 3, z) && !outerRoadAt(x - 3, z) && !outerRoadAt(x, z + 3) && !outerRoadAt(x, z - 3) && !outerLakeAt(x, z) && !townAt(x, z, 10);
    const spots: [number, number][] = [];
    // Verges of the highways crossing this chunk.
    for (const hw of HIGHWAYS) {
      if (hw.x1 < c.x0 - 60 || hw.x0 > c.x0 + CHUNK + 60 || hw.z1 < c.z0 - 60 || hw.z0 > c.z0 + CHUNK + 60) continue;
      hw.pts.forEach(([px, pz], k) => {
        if (px < c.x0 - 60 || px > c.x0 + CHUNK + 60 || pz < c.z0 - 60 || pz > c.z0 + CHUNK + 60) return;
        for (let s = k * PROFILE_STEP; s < (k + 1) * PROFILE_STEP && s <= hw.len; s += 6)
          for (const side of [-1, 1]) {
            if (rng() > 0.5) continue;
            const [bx, bz] = besideHighway(hw, s, side * (HW + 4 + rng() * rng() * 40));
            spots.push([bx, bz]);
          }
      });
    }
    // And dotted about everywhere else.
    for (let i = 0; i < 90; i++) spots.push([c.x0 + rng() * CHUNK, c.z0 + rng() * CHUNK]);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const mats: THREE.Matrix4[] = [];
    for (const [x, z] of spots) {
      if (!inChunk(x, z) || desertWeight(x, z) < 0.35 + rng() * 0.3 || !clear(x, z)) continue;
      const g = ground(x, z);
      if (g.slope > 0.35) continue;
      const size = 1.1 + rng() * rng() * 2.4; // mostly small-to-medium, some big ones
      q.setFromAxisAngle(up, rng() * Math.PI);
      mats.push(m4.compose(new THREE.Vector3(x, g.y - 0.12, z), q, new THREE.Vector3(size, size * (0.8 + rng() * 0.5), size)).clone());
    }
    if (!mats.length) return;
    const mesh = new THREE.InstancedMesh(bushGeometry(), bushMaterial(), mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    c.group.add(mesh);
  }

  /** Ground height and steepness at a spot in this chunk, from its height samples. */
  private groundAt(c: Chunk, h: Float32Array, S: number, x: number, z: number) {
    const fx = (x - c.x0) / TERRAIN_CELL + 1, fz = (z - c.z0) / TERRAIN_CELL + 1;
    const k = Math.min(S - 2, Math.max(0, Math.floor(fx))), r = Math.min(S - 2, Math.max(0, Math.floor(fz)));
    const u = fx - k, v = fz - r;
    const at = (rr: number, kk: number) => h[rr * S + kk];
    const y = (at(r, k) * (1 - u) + at(r, k + 1) * u) * (1 - v) + (at(r + 1, k) * (1 - u) + at(r + 1, k + 1) * u) * v;
    const slope = Math.hypot(at(r, k + 1) - at(r, k), at(r + 1, k) - at(r, k)) / TERRAIN_CELL;
    return { y, slope };
  }

  /**
   * Trees: thick forest in the forest (red and gold in its autumn part), snowy pines on
   * the lower mountain slopes, a few along the farm hedges, and the towns' own (maples in
   * Mariano-ville, shade trees elsewhere). They crowd the verges of the roads (that's
   * what you see) and thin out further off. Never on a road, in water, on a cliff, in a
   * farmyard or in a town (other than its own). Solid trunks.
   */
  private trees(c: Chunk, h: Float32Array, S: number) {
    const rng = mulberry32(c.ix * 92821 + c.iz * 68917 + 11);
    const mid = biomeAt(c.x0 + CHUNK / 2, c.z0 + CHUNK / 2);
    const corners = [[0, 0], [CHUNK, 0], [0, CHUNK], [CHUNK, CHUNK]].map(([dx, dz]) => biomeAt(c.x0 + dx, c.z0 + dz));
    const wooded = Math.max(...[mid, ...corners].map((b) => b.forest + b.mountain + b.farm * 0.2));
    const nearTown = TOWNS.some((t) => townDistance(t, c.x0 + CHUNK / 2, c.z0 + CHUNK / 2) < CHUNK);
    if (wooded < 0.05 && !nearTown) return;
    const inChunk = (x: number, z: number) => x >= c.x0 && x < c.x0 + CHUNK && z >= c.z0 && z < c.z0 + CHUNK;
    const roadFree = (x: number, z: number, m: number) => {
      if (outerLakeAt(x, z) || nearestCurve(x, z).edge < m) return false;
      let ok = true;
      forNearHighways(x, z, (hw, s, d) => {
        if (Math.abs(d) < HW + m && s > -m && s < hw.len + m) ok = false;
      });
      return ok;
    };
    const list = new Map<TreeKind, THREE.Matrix4[]>(TREE_KINDS.map((k) => [k, []]));
    const colors = new Map<TreeKind, THREE.Color[]>(TREE_KINDS.map((k) => [k, []]));
    const trunks: [number, number, number, number][] = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const plant = (x: number, z: number, kind: TreeKind, size: number) => {
      const g = this.groundAt(c, h, S, x, z);
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      list.get(kind)!.push(m4.compose(new THREE.Vector3(x, g.y - 0.2, z), q, new THREE.Vector3(size, size * (0.85 + rng() * 0.3), size)).clone());
      const tint = new THREE.Color(1, 1, 1).multiplyScalar(0.82 + rng() * 0.3);
      if (kind === 'autumn') tint.offsetHSL((rng() - 0.5) * 0.06, 0, 0);
      colors.get(kind)!.push(tint);
      trunks.push([x, g.y, z, TRUNK_RADIUS[kind] * size]);
    };
    /** Try a tree at a spot: how likely depends on the region; `verge` spots are by a road. */
    const tryAt = (x: number, z: number, verge: boolean) => {
      if (!inChunk(x, z)) return;
      const b = biomeAt(x, z);
      const g = this.groundAt(c, h, S, x, z);
      const hedge = b.farm > 0.3 && fieldEdgeDistance(x, z) < 2.5;
      let p = b.forest * (verge ? 0.95 : 0.8) + b.mountain * (g.y < 260 ? 0.7 : 0.15) + (hedge ? b.farm * 0.5 : b.farm * 0.02);
      if (g.slope > (b.mountain > 0.5 ? 0.85 : 0.6)) p = 0;
      if (rng() > p) return;
      if (townAt(x, z, 15)) return;
      if (c.clearings.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) return;
      if (TOWERS.some((t) => Math.abs(t.x - x) < 8 && Math.abs(t.z - z) < 8)) return;
      if (!roadFree(x, z, 7)) return;
      let kind: TreeKind;
      if (b.mountain > 0.5) kind = 'pineSnow';
      else if (b.forest > 0.4) kind = b.autumn > 0.5 ? (rng() < 0.72 ? 'autumn' : 'pine') : rng() < 0.55 ? 'pine' : 'broad';
      else kind = b.desert > 0.4 ? 'broad' : rng() < 0.2 ? 'pine' : 'broad';
      plant(x, z, kind, 0.75 + rng() * 0.6);
    };
    // Along the roads first (if the far trees get thinned, these stay).
    const along = (pts: readonly (readonly [number, number])[], hw: number) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        if (Math.max(ax, bx) < c.x0 - 90 || Math.min(ax, bx) > c.x0 + CHUNK + 90 || Math.max(az, bz) < c.z0 - 90 || Math.min(az, bz) > c.z0 + CHUNK + 90) continue;
        const len = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / len, nz = (bx - ax) / len;
        for (let k = 0; k < len / 6; k++) {
          const t = rng();
          const side = rng() < 0.5 ? -1 : 1, d = hw + 10 + rng() * rng() * 70;
          tryAt(ax + (bx - ax) * t + nx * side * d, az + (bz - az) * t + nz * side * d, true);
        }
      }
    };
    for (const hw of HIGHWAYS) if (!(hw.x1 < c.x0 - 100 || hw.x0 > c.x0 + CHUNK + 100 || hw.z1 < c.z0 - 100 || hw.z0 > c.z0 + CHUNK + 100)) along(hw.pts, HW);
    for (const r of CURVES) if (!(r.x1 < c.x0 - 100 || r.x0 > c.x0 + CHUNK + 100 || r.z1 < c.z0 - 100 || r.z0 > c.z0 + CHUNK + 100)) along(r.pts, r.hw);
    // Then dotted about everywhere else.
    for (let i = 0; i < 200 + 300 * Math.min(1, wooded); i++) tryAt(c.x0 + rng() * CHUNK, c.z0 + rng() * CHUNK, false);
    // The towns' trees.
    if (nearTown) for (const [x, z, kind] of townTreeSpots()) if (inChunk(x, z)) plant(x, z, kind, 0.85 + rng() * 0.35);
    for (const kind of TREE_KINDS) {
      const mats = list.get(kind)!;
      if (!mats.length) continue;
      const mesh = new THREE.InstancedMesh(treeGeometry(kind), treeMaterial(kind), mats.length);
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      colors.get(kind)!.forEach((col, i) => mesh.setColorAt(i, col));
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = treeDepthMaterial(kind);
      c.group.add(mesh);
      c.trees.push({ mesh, full: mats.length });
    }
    // Solid trunks (static: they cost almost nothing while the car isn't touching them).
    for (const [x, y, z, r] of trunks)
      c.solids.push(() => {
        const col = this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(3, Math.max(0.25, r * 1.15)).setTranslation(x, y + 2.6, z).setFriction(0.6));
        this.physics.setOwner(col, { kind: 'static', material: 'wood' });
        return col;
      });
  }

  /**
   * Farmyards in farmland, set back from the highways: a red barn with a silo, a white
   * farmhouse with a porch, and round hay bales in the field next to them.
   */
  private farms(c: Chunk, h: Float32Array, S: number) {
    if (biomeAt(c.x0 + CHUNK / 2, c.z0 + CHUNK / 2).farm < 0.6) return;
    const rng = mulberry32(c.ix * 7331 + c.iz * 3571 + 5);
    const spots: [number, number, number][] = [];
    for (const hw of HIGHWAYS) {
      if (hw.x1 < c.x0 || hw.x0 > c.x0 + CHUNK || hw.z1 < c.z0 || hw.z0 > c.z0 + CHUNK) continue;
      hw.pts.forEach(([px, pz], k) => {
        if (k % 4 || px < c.x0 || px > c.x0 + CHUNK || pz < c.z0 || pz > c.z0 + CHUNK) return;
        const side = rng() < 0.5 ? -1 : 1, d = side * (HW + 70 + rng() * 110);
        const [x, z] = besideHighway(hw, k * PROFILE_STEP, d);
        const u = pointAt(hw, k * PROFILE_STEP);
        // Facing the highway.
        spots.push([x, z, Math.atan2(-u.ux * side, -u.uz * side) + Math.PI / 2]);
      });
    }
    if (!spots.length) for (let i = 0; i < 3; i++) spots.push([c.x0 + 80 + rng() * (CHUNK - 160), c.z0 + 80 + rng() * (CHUNK - 160), rng() * Math.PI * 2]);
    let built = 0;
    for (const [x, z, face] of spots.sort(() => rng() - 0.5)) {
      if (built >= 2 || rng() < 0.35) continue;
      if (x < c.x0 + 40 || x > c.x0 + CHUNK - 40 || z < c.z0 + 40 || z > c.z0 + CHUNK - 40) continue;
      if (c.clearings.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 160) || townAt(x, z, 120)) continue;
      // Flat, dry and clear of every road.
      let lo = Infinity, hi = -Infinity, clear = true;
      for (let dx = -30; dx <= 30 && clear; dx += 15)
        for (let dz = -30; dz <= 30 && clear; dz += 15) {
          const y = this.groundAt(c, h, S, x + dx, z + dz).y;
          (lo = Math.min(lo, y)), (hi = Math.max(hi, y));
          if (outerRoadAt(x + dx, z + dz) || outerLakeAt(x + dx, z + dz) || nearestCurve(x + dx, z + dz).edge < 15) clear = false;
        }
      if (!clear || hi - lo > 4) continue;
      built++;
      c.clearings.push([x, z, 48]);
      this.farmyard(c, x, lo - 0.3, z, face, rng);
    }
  }

  private farmyard(c: Chunk, x: number, y: number, z: number, face: number, rng: () => number) {
    const cs = Math.cos(face), sn = Math.sin(face);
    // Local (along, across) → world, local x along `face`.
    const P = (a: number, b: number): [number, number] => [x + a * cs + b * sn, z - a * sn + b * cs];
    const solid = (a: number, b: number, yy: number, sa: number, sy: number, sb: number, color: number, draw = true) => {
      const [px, pz] = P(a, b);
      const s: Solid = { at: [px, yy + sy / 2, pz], size: [sa, sy, sb], heading: face, kind: 'building', color };
      if (draw) this.add(c, 'plain', box({ at: s.at, size: s.size, rot: [0, face, 0], color, seg: 100 }));
      c.solids.push(() => addSolid(this.physics, s));
    };
    const deco = (a: number, b: number, yy: number, sa: number, sy: number, sb: number, color: number) => {
      const [px, pz] = P(a, b);
      this.add(c, 'plain', box({ at: [px, yy + sy / 2, pz], size: [sa, sy, sb], rot: [0, face, 0], color, seg: 100 }));
    };
    const roof = (a: number, b: number, yy: number, sa: number, sb: number, rh: number, color: number, ridgeAlongB: boolean) => {
      // A pitched roof as a stretched, rotated triangular prism.
      const g = new THREE.CylinderGeometry(1, 1, 1, 3, 1);
      g.rotateZ(Math.PI / 2);
      g.rotateX(Math.PI / 6 + Math.PI);
      // Now a prism along x with its point up: scale to size.
      g.scale(ridgeAlongB ? sb + 1 : sa + 1, rh / 1.5, (ridgeAlongB ? sa : sb) / 1.732 + 0.6);
      g.translate(0, rh / 3, 0);
      if (ridgeAlongB) g.rotateY(Math.PI / 2);
      g.rotateY(face);
      const [px, pz] = P(a, b);
      g.translate(px, yy, pz);
      this.add(c, 'plain', paint(g, color));
    };
    // Barn: red, white-trimmed doors, a dark roof and a hay-loft door in the gable.
    solid(0, 0, y, 13, 7, 21, 0xa3302a);
    roof(0, 0, y + 7, 13, 21, 5.5, 0x45403c, true);
    for (const s of [-1, 1]) {
      deco(0, s * 10.55, y, 5.2, 4.6, 0.12, 0xa3302a);
      deco(0, s * 10.6, y + 4.4, 5.6, 0.25, 0.1, 0xffffff);
      for (const e of [-2.6, 2.6]) deco(e, s * 10.6, y, 0.25, 4.6, 0.1, 0xffffff);
      deco(0, s * 10.6, y + 2.3, 5.2, 0.22, 0.1, 0xffffff);
      deco(0, s * 10.6, y + 7.6, 2.2, 2, 0.12, 0xffffff);
    }
    // Silo: tall and round, with a dome.
    {
      const [sx, sz] = P(10, -5);
      this.add(c, 'plain', cyl({ at: [sx, y + 8, sz], radius: 3, length: 16, axis: 'y', segments: 16, color: 0xb7bfc4 }));
      const dome = new THREE.SphereGeometry(3.05, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(sx, y + 16, sz);
      this.add(c, 'plain', paint(dome, 0x8c969c));
      for (let k = 1; k < 8; k++) this.add(c, 'plain', cyl({ at: [sx, y + k * 2, sz], radius: 3.06, length: 0.15, axis: 'y', segments: 16, color: 0x8e979c }));
      solid(10, -5, y, 5.6, 17, 5.6, 0, false);
    }
    // Farmhouse: white, a grey roof, a porch along the front.
    solid(-6, -26, y, 10, 6.2, 12, 0xf0eee7);
    roof(-6, -26, y + 6.2, 10, 12, 4, 0x4c5157, false);
    for (const e of [-4.5, 0, 4.5]) deco(-6 + e, -26 + 7.2, y, 0.2, 3, 0.2, 0xffffff);
    deco(-6, -26 + 7.2, y + 3, 10.4, 0.2, 2.6, 0x4c5157);
    for (const [wa, wy] of [[-8.5, 1.4], [-3.5, 1.4], [-8.5, 4.2], [-3.5, 4.2]]) deco(wa, -26 + 6.05, y + wy, 1.1, 1.5, 0.1, 0x2b3540);
    deco(-6, -26 + 6.05, y, 1.1, 2.3, 0.1, 0x5a2e22);
    // Round hay bales in the field behind.
    for (let i = 0; i < 7; i++) {
      const a = 30 + rng() * 40, b = -20 + rng() * 40;
      const [hx, hz] = P(a, b);
      const g = new THREE.CylinderGeometry(0.85, 0.85, 1.3, 12);
      g.rotateZ(Math.PI / 2);
      g.rotateY(rng() * Math.PI);
      g.translate(hx, y + 1.15, hz);
      this.add(c, 'plain', paint(g, 0xd6b25e));
      solid(a, b, y + 0.3, 1.5, 1.7, 1.5, 0, false);
    }
  }

  /** Green signs on the highway before each road into a town: NEXT EXIT, then EXIT and the town's name. */
  private townSigns(c: Chunk, inChunk: (x: number, z: number) => boolean) {
    for (const t of TOWNS)
      for (const e of t.exits) {
        const h = HIGHWAYS[e.hw];
        for (const back of [80, 400]) {
          const ss = e.s - e.dir * back;
          const [x, z] = besideHighway(h, ss, e.side * (HW + 3));
          if (!inChunk(x, z)) continue;
          const u = pointAt(h, ss);
          const tx = u.ux * e.dir, tz = u.uz * e.dir;
          const rightX = -tz, rightZ = tx;
          const arrow = (-u.uz * e.side) * rightX + (u.ux * e.side) * rightZ > 0 ? '↗' : '↖';
          const lines = back > 200 ? [t.name, 'NEXT EXIT'] : ['EXIT ' + arrow, t.name];
          const key = lines.join('|');
          let tex = this.signTextures.get(key);
          if (!tex) this.signTextures.set(key, (tex = textPanel(lines)));
          const y = profileAt(h, ss);
          const sign = new THREE.Mesh(this.signGeo, new THREE.MeshBasicMaterial({ map: tex }));
          sign.position.set(x, y + 5.4, z);
          sign.rotation.y = Math.atan2(-tx, -tz);
          sign.updateMatrix();
          sign.matrixAutoUpdate = false;
          c.group.add(sign);
          for (const o of [-2.8, 2.8]) this.add(c, 'plain', box({ at: [x + tz * o, y + 2, z - tx * o], size: [0.25, 4, 0.25], color: 0x7d8288 }));
        }
      }
  }

  /** The runs of a highway whose segments start inside this chunk (every 12.5 m). */
  private highwayRibbon(c: Chunk, h: Highway) {
    if (h.x1 < c.x0 - 50 || h.x0 > c.x0 + CHUNK + 50 || h.z1 < c.z0 - 50 || h.z0 > c.z0 + CHUNK + 50) return;
    const inside = (p: readonly [number, number]) => p[0] >= c.x0 && p[0] < c.x0 + CHUNK && p[1] >= c.z0 && p[1] < c.z0 + CHUNK;
    let run: { x: number; y: number; z: number }[] = [], s0 = 0;
    const flush = () => {
      if (run.length > 1) this.add(c, 'road-highway', ribbon(run, HW, s0 / V_REPEAT));
      run = [];
    };
    const at = (s: number) => {
      const p = pointAt(h, s);
      return { x: p.x, y: profileAt(h, s) + ROAD_LIFT, z: p.z };
    };
    for (let k = 0; k < h.pts.length - 1; k++) {
      if (!inside(h.pts[k])) {
        flush();
        continue;
      }
      const s = k * PROFILE_STEP, e = Math.min(h.len, s + PROFILE_STEP);
      if (!run.length) (s0 = s), run.push(at(s));
      run.push(at((s + e) / 2), at(e));
    }
    flush();
  }

  /** The runs of a curved road (ramp, town road or Ring) whose segments start inside this chunk. */
  private curveRibbon(c: Chunk, r: CurveRoad) {
    if (r.x1 < c.x0 - 50 || r.x0 > c.x0 + CHUNK + 50 || r.z1 < c.z0 - 50 || r.z0 > c.z0 + CHUNK + 50) return;
    const n = r.pts.length, segs = r.closed ? n : n - 1;
    const lift = ROAD_LIFT + (r.kind === 'ramp' ? 0.04 : 0.02);
    let run: { x: number; y: number; z: number; w?: number }[] = [];
    // Ramps taper in and out of the highways like real exit/entry lanes (no square ends).
    const taper = (i: number) => (r.kind === 'ramp' ? r.hw * (0.25 + 0.75 * smoothstep(0, 5, Math.min(i, n - 1 - i))) : r.hw);
    const flush = () => {
      if (run.length > 1) this.add(c, r.kind === 'ramp' ? 'road-ramp' : r.kind === 'town' ? `road-${r.look ?? 'street'}` : 'road-highway', ribbon(run, r.hw, 0));
      run = [];
    };
    for (let i = 0; i < segs; i++) {
      const [a, b] = [r.pts[i], r.pts[(i + 1) % n]];
      if (a[0] >= c.x0 && a[0] < c.x0 + CHUNK && a[1] >= c.z0 && a[1] < c.z0 + CHUNK) {
        if (!run.length) run.push({ x: a[0], y: r.hs[i] + lift, z: a[1], w: taper(i) });
        run.push({ x: b[0], y: r.hs[(i + 1) % n] + lift, z: b[1], w: taper((i + 1) % n) });
      } else flush();
    }
    flush();
  }

  /** Bridge where the upper highway crosses the lower one (see bridgeSolids). */
  private bridge(c: Chunk, cr: (typeof CROSSINGS)[number]) {
    for (const b of bridgeSolids(cr)) {
      this.add(c, 'plain', box({ at: b.at, size: b.size, rot: [0, b.heading, 0], color: b.color }));
      c.solids.push(() => addSolid(this.physics, b));
    }
  }

  /** Lattice radio tower with blinking red lights. */
  private tower(c: Chunk, x: number, z: number, h: number) {
    const y0 = heightAt(x, z) - 0.5;
    const b = 3.2, t = 0.7;
    const corner = (k: number, y: number) => {
      const w = b + (t - b) * (y / h);
      return new THREE.Vector3(x + (k & 1 ? w : -w), y0 + y, z + (k & 2 ? w : -w));
    };
    const band = (y: number) => (Math.floor(y / 10) % 2 ? 0xf2f2f2 : 0xd23a2a);
    const order = [0, 1, 3, 2];
    for (const k of order) this.add(c, 'plain', strut(corner(k, 0), corner(k, h), 0.3, 0xb8b8b8));
    for (let y = 0; y < h; y += 7) {
      for (let i = 0; i < 4; i++) {
        const a = order[i], bb = order[(i + 1) % 4];
        this.add(c, 'plain', strut(corner(a, y), corner(bb, y), 0.16, band(y)));
        this.add(c, 'plain', strut(corner(a, y), corner(bb, Math.min(h, y + 7)), 0.12, band(y)));
      }
    }
    for (const y of [h * 0.5, h]) this.add(c, 'glow', box({ at: [x, y0 + y + 0.5, z], size: [1.1, 1.1, 1.1], color: 0xffffff }));
    c.solids.push(() => {
      const col = this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(b, h / 2, b).setTranslation(x, y0 + h / 2, z));
      this.physics.setOwner(col, { kind: 'building', material: 'metal' });
      return col;
    });
  }

  /** Green EXIT signs before each end of a ramp, naming the highway it leads to. */
  private exitSigns(c: Chunk, r: CurveRoad, inChunk: (x: number, z: number) => boolean) {
    for (const [end, hwId, otherId] of [[0, r.from, r.to], [r.pts.length - 1, r.to, r.from]] as const) {
      const h = HIGHWAYS[hwId], other = HIGHWAYS[otherId];
      const [px, pz] = r.pts[end];
      const { s, d } = highwayCoords(h, px, pz);
      // Traffic that can take this ramp is heading towards the crossing.
      const cr = CROSSINGS.find((k) => (k.upper === hwId && k.lower === otherId) || (k.lower === hwId && k.upper === otherId))!;
      const sc = cr.upper === hwId ? cr.sUpper : cr.sLower;
      const dir = Math.sign(sc - s); // direction of travel along the highway
      const ss = s - dir * 70;
      const side = Math.sign(d);
      const [x, z] = besideHighway(h, ss, side * (HW + 3));
      if (!inChunk(x, z)) continue;
      const u = pointAt(h, ss);
      const tx = u.ux * dir, tz = u.uz * dir;
      // Which way the exit goes from the driver's point of view.
      const rightX = -tz, rightZ = tx;
      const arrow = (-u.uz * side) * rightX + (u.ux * side) * rightZ > 0 ? '↗' : '↖';
      const text = `EXIT ${arrow}|${other.name}`;
      let tex = this.signTextures.get(text);
      if (!tex) this.signTextures.set(text, (tex = textPanel(['EXIT ' + arrow, other.name])));
      const y = profileAt(h, ss);
      const sign = new THREE.Mesh(this.signGeo, new THREE.MeshBasicMaterial({ map: tex }));
      sign.position.set(x, y + 5.4, z);
      sign.rotation.y = Math.atan2(-tx, -tz);
      sign.updateMatrix();
      sign.matrixAutoUpdate = false;
      c.group.add(sign);
      for (const o of [-2.8, 2.8]) this.add(c, 'plain', box({ at: [x + tz * o, y + 2, z - tx * o], size: [0.25, 4, 0.25], color: 0x7d8288 }));
    }
  }

  private physicsOn(c: Chunk) {
    if (c.colliders || c.job) return;
    c.colliders = c.solids.map((f) => f());
  }

  private physicsOff(c: Chunk) {
    if (!c.colliders) return;
    for (const col of c.colliders) {
      this.physics.removeCollider(col);
      this.physics.world.removeCollider(col, false);
    }
    c.colliders = null;
  }

  private dispose(c: Chunk) {
    this.physicsOff(c);
    c.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (o.geometry !== this.signGeo && !o.geometry.userData.shared) o.geometry.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose();
        if (o.material instanceof THREE.MeshBasicMaterial && o.material !== this.glow && o.material.map) o.material.dispose();
      }
    });
    this.group.remove(c.group);
    this.chunks.delete(chunkKey(c.ix, c.iz));
  }

  stats() {
    let built = 0, physics = 0;
    for (const c of this.chunks.values()) (built += c.job ? 0 : 1), (physics += c.colliders ? 1 : 0);
    return { chunks: this.chunks.size, built, physics };
  }
}
