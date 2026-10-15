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
  CROSSINGS, CURVES, CurveRoad, HIGHWAYS, HW, Highway, OUTER_LAKES, RAMPS, Solid, TOWERS, bridgeSolids, highwayCoords, outerLakeAt, outerRoadAt, profileAt,
} from './outer';
import { heightAt } from './layout';
import { desertWeight } from './biomes';
import { bushGeometry, bushMaterial } from './bushes';
import { mulberry32, smoothstep } from '../util/math';
import { heightfieldCollider, terrainPatch } from './terrain';
import { ROAD_ORDER, normalizeAttributes } from './batch';
import { box } from '../vehicles/builders/geo';
import { textPanel } from './landmarks';

const N = CHUNK / TERRAIN_CELL; // cells per chunk side
/** Distances (m) from the player to a chunk's nearest point. */
const LOAD = 950, UNLOAD = 1350, PHYSICS_ON = 260, PHYSICS_OFF = 420, VIEW = 900;
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
      c = { ix, iz, x0, z0, inner, job: null, group: new THREE.Group(), heights: null, solids: [], colliders: null, geos: new Map(), textures: [] };
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
      for (let r = 0; r < S; r++) {
        for (let k = 0; k < S; k++) h[r * S + k] = heightAt(x0 + (k - 1) * TERRAIN_CELL, z0 + (r - 1) * TERRAIN_CELL);
        if (r % 4 === 3) yield;
      }
      // (Chunks line up with WORLD's edges, so each one is wholly inside or outside it.)
      // The ground keeps its own mesh (its desert attribute doesn't survive merging).
      const ground = terrainPatch(x0, z0, N, N, (k, r) => h[(r + 1) * S + (k + 1)], true);
      ground.computeBoundingSphere();
      const gm = new THREE.Mesh(ground, this.materials['ground-outer']);
      gm.matrixAutoUpdate = false;
      gm.receiveShadow = true;
      c.group.add(gm);
      this.bushes(c, h, S);
      c.heights = new Float32Array((N + 1) * (N + 1));
      for (let r = 0; r <= N; r++) for (let k = 0; k <= N; k++) c.heights[r * (N + 1) + k] = h[(r + 1) * S + (k + 1)];
      const heights = c.heights;
      c.solids.push(() => heightfieldCollider(this.physics, N + 1, N + 1, heights, x0 + CHUNK / 2, z0 + CHUNK / 2));
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
      mesh.castShadow = key === 'plain';
      if (key.startsWith('road')) mesh.renderOrder = ROAD_ORDER[key] ?? 1;
      c.group.add(mesh);
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
      !outerRoadAt(x, z) && !outerRoadAt(x + 3, z) && !outerRoadAt(x - 3, z) && !outerRoadAt(x, z + 3) && !outerRoadAt(x, z - 3) && !outerLakeAt(x, z);
    const spots: [number, number][] = [];
    // Verges of the highways crossing this chunk.
    for (const hw of HIGHWAYS) {
      const q0 = highwayCoords(hw, c.x0 + CHUNK / 2, c.z0 + CHUNK / 2);
      if (Math.abs(q0.d) > CHUNK) continue;
      for (let s = q0.s - CHUNK; s < q0.s + CHUNK; s += 6) {
        if (s < 0 || s > hw.len) continue;
        for (const side of [-1, 1]) {
          if (rng() > 0.5) continue;
          const d = side * (HW + 4 + rng() * rng() * 40);
          spots.push([hw.ax + hw.ux * s - hw.uz * d, hw.az + hw.uz * s + hw.ux * d]);
        }
      }
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

  /** The part of a straight highway inside this chunk. */
  private highwayRibbon(c: Chunk, h: Highway) {
    // Clip the line to the chunk square.
    let t0 = 0, t1 = h.len;
    for (const [p, d, lo, hi] of [[h.ax, h.ux, c.x0, c.x0 + CHUNK], [h.az, h.uz, c.z0, c.z0 + CHUNK]]) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p >= hi) return;
        continue;
      }
      const a = (lo - p) / d, b = (hi - p) / d;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (t1 <= t0) return;
    const pts: { x: number; y: number; z: number }[] = [];
    const n = Math.max(1, Math.ceil((t1 - t0) / 12.5));
    for (let i = 0; i <= n; i++) {
      const s = t0 + ((t1 - t0) * i) / n;
      pts.push({ x: h.ax + h.ux * s, y: profileAt(h, s) + ROAD_LIFT, z: h.az + h.uz * s });
    }
    this.add(c, 'road-highway', ribbon(pts, HW, t0 / V_REPEAT));
  }

  /** The runs of a curved road (ramp or Ring) whose segments start inside this chunk. */
  private curveRibbon(c: Chunk, r: CurveRoad) {
    if (r.x1 < c.x0 - 50 || r.x0 > c.x0 + CHUNK + 50 || r.z1 < c.z0 - 50 || r.z0 > c.z0 + CHUNK + 50) return;
    const n = r.pts.length, segs = r.closed ? n : n - 1;
    const lift = ROAD_LIFT + (r.kind === 'ramp' ? 0.04 : 0.02);
    let run: { x: number; y: number; z: number; w?: number }[] = [];
    // Ramps taper in and out of the highways like real exit/entry lanes (no square ends).
    const taper = (i: number) => (r.kind === 'ramp' ? r.hw * (0.25 + 0.75 * smoothstep(0, 5, Math.min(i, n - 1 - i))) : r.hw);
    const flush = () => {
      if (run.length > 1) this.add(c, r.kind === 'ramp' ? 'road-ramp' : 'road-highway', ribbon(run, r.hw, 0));
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
      const x = h.ax + h.ux * ss - h.uz * side * (HW + 3), z = h.az + h.uz * ss + h.ux * side * (HW + 3);
      if (!inChunk(x, z)) continue;
      const tx = h.ux * dir, tz = h.uz * dir;
      // Which way the exit goes from the driver's point of view.
      const rightX = -tz, rightZ = tx;
      const arrow = (-h.uz * side) * rightX + (h.ux * side) * rightZ > 0 ? '↗' : '↖';
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
        if (o.geometry !== this.signGeo && o.geometry !== bushGeometry()) o.geometry.dispose();
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
