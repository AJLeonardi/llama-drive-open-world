import * as THREE from 'three';
import { Physics, RAPIER } from '../physics/Physics';
import { ALL_ROADS, BOOST_PADS, BOSTON, BRIDGES, CITY_ROADS, NYC, Road, RoadKind, bridgeAt, nearRoad, roadSegments, waterDepth } from './layout';
import { inAABB } from '../util/math';
import { StaticBatch } from './batch';
import { box } from '../vehicles/builders/geo';
import type { PropSpawn } from './propModels';

export const ROAD_Y = 0.06;
const PIECE = 40;
const V_REPEAT = 16;

export const roadMaterialKey = (k: RoadKind) => `road-${k}`;

function quad(ax: number, az: number, bx: number, bz: number, hw: number, y: number, v0: number) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const px = (-dz / len) * hw, pz = (dx / len) * hw;
  const v1 = v0 + len / V_REPEAT;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    ax + px, y, az + pz, bx + px, y, bz + pz, ax - px, y, az - pz,
    bx + px, y, bz + pz, bx - px, y, bz - pz, ax - px, y, az - pz,
  ], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, v0, 0, v1, 1, v0, 0, v1, 1, v1, 1, v0], 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/** Round patch where two segments of a road meet, so corners have no gaps. */
function joint(x: number, z: number, hw: number, y: number) {
  const g = new THREE.CircleGeometry(hw, 12);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.02, 0.5);
  return g;
}

function addRoad(batch: StaticBatch, road: Road) {
  const key = roadMaterialKey(road.kind);
  const hw = road.width / 2;
  // Dirt sits a hair lower so ramps joining it draw on top cleanly.
  const y = road.kind === 'dirt' ? ROAD_Y - 0.01 : ROAD_Y;
  let v = 0;
  for (const [a, b] of roadSegments(road)) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / PIECE));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const ax = a[0] + (b[0] - a[0]) * t0, az = a[1] + (b[1] - a[1]) * t0;
      const bx = a[0] + (b[0] - a[0]) * t1, bz = a[1] + (b[1] - a[1]) * t1;
      batch.add(key, quad(ax, az, bx, bz, hw, y, v));
      v += len / n / V_REPEAT;
    }
  }
  const pts = road.pts;
  const inner = road.closed ? pts : pts.slice(1, -1);
  for (const [x, z] of inner) batch.add(key, joint(x, z, hw, y));
}

export function addRoads(batch: StaticBatch) {
  for (const r of ALL_ROADS) addRoad(batch, r);
}

/**
 * Flat decks over the river. The railings are low breakable segments, so a hard
 * enough hit smashes through and the car can go over the side into the water.
 */
export function addBridges(batch: StaticBatch, physics: Physics): PropSpawn[] {
  const rails: PropSpawn[] = [];
  for (const b of BRIDGES) {
    const len = b.z1 - b.z0, cz = (b.z0 + b.z1) / 2;
    batch.add('plain', box({ at: [b.x, -0.6, cz], size: [b.width, 1.2, len], seg: 100, color: 0xbab6ad }));
    const deck = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(b.width / 2, 0.6, len / 2).setTranslation(b.x, -0.6, cz));
    physics.setOwner(deck, { kind: 'ground', material: 'concrete' });
    // Support piers down into the river
    for (let z = b.z0 + 12; z < b.z1 - 8; z += 20)
      batch.add('plain', box({ at: [b.x, -3.5, z], size: [3, 6, 2], color: 0x9c9890 }));
    for (const side of [-1, 1]) {
      const x = b.x + side * (b.width / 2 - 0.2);
      for (let z = b.z0 + 2; z < b.z1 - 1; z += 4) rails.push({ kind: 'rail', x, y: 0, z, rot: 0 });
    }
  }
  return rails;
}

export function addBoostPads(batch: StaticBatch) {
  for (const p of BOOST_PADS) {
    const g = new THREE.PlaneGeometry(p.width, p.length);
    g.rotateX(-Math.PI / 2);
    // Arrow texture points along +v; turn it to face the pad's heading.
    g.rotateY(p.heading + Math.PI);
    g.translate(p.x, ROAD_Y + 0.03, p.z);
    batch.add('boost', g);
  }
}

/** Raised sidewalk height (m). Street furniture stands on top of it. */
export const SIDEWALK_H = 0.13;
const SIDEWALK_W = 3.4;
const SW_PIECE = 3;

/**
 * Sidewalks with a curb along both sides of every city street. Built in runs that
 * stop at intersections, each run with one collider so the car bumps up the curb.
 */
export function addSidewalks(batch: StaticBatch, physics: Physics) {
  const inCity = (x: number, z: number) => inAABB(x, z, BOSTON, -2) || inAABB(x, z, NYC, -2);
  for (const road of CITY_ROADS) {
    const hw = road.width / 2;
    for (const [a, b] of roadSegments(road)) {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      for (const side of [-1, 1]) {
        const px = -uz * side, pz = ux * side;
        const n = Math.floor(len / SW_PIECE);
        let runStart = -1;
        const flush = (i0: number, i1: number) => {
          if (i1 <= i0) return;
          const s0 = i0 * SW_PIECE, s1 = i1 * SW_PIECE;
          addRun(batch, physics, a[0] + ux * s0, a[1] + uz * s0, a[0] + ux * s1, a[1] + uz * s1, px, pz, hw);
        };
        for (let i = 0; i <= n; i++) {
          let ok = i < n;
          if (ok) {
            const s = (i + 0.5) * SW_PIECE;
            for (const off of [hw + 0.4, hw + SIDEWALK_W / 2, hw + SIDEWALK_W - 0.3]) {
              const x = a[0] + ux * s + px * off, z = a[1] + uz * s + pz * off;
              if (nearRoad(x, z, 0.3) || !inCity(x, z) || waterDepth(x, z) > 0 || bridgeAt(x, z)) ok = false;
            }
          }
          if (ok && runStart < 0) runStart = i;
          if (!ok && runStart >= 0) {
            flush(runStart, i);
            runStart = -1;
          }
        }
      }
    }
  }
}

function addRun(batch: StaticBatch, physics: Physics, ax: number, az: number, bx: number, bz: number, px: number, pz: number, hw: number) {
  const y = SIDEWALK_H;
  const i0 = hw, i1 = hw + SIDEWALK_W;
  const len = Math.hypot(bx - ax, bz - az);
  const P = (x: number, z: number, off: number, h: number) => [x + px * off, h, z + pz * off];
  const v1 = len / 4;
  // Top surface (u = 0 at the curb) and the curb face toward the road.
  const quads: [number[], number[], number[], number[], number[]][] = [
    [P(ax, az, i0, y), P(bx, bz, i0, y), P(ax, az, i1, y), P(bx, bz, i1, y), [0, 0, 0, v1, 1, 0, 1, v1]],
    [P(ax, az, i0, 0.02), P(bx, bz, i0, 0.02), P(ax, az, i0, y), P(bx, bz, i0, y), [0, 0, 0, v1, 0.04, 0, 0.04, v1]],
  ];
  quads.forEach(([A, B, C, D, uvs], qi) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...A, ...C, ...B, ...B, ...C, ...D], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([uvs[0], uvs[1], uvs[4], uvs[5], uvs[2], uvs[3], uvs[2], uvs[3], uvs[4], uvs[5], uvs[6], uvs[7]], 2));
    g.computeVertexNormals();
    // The winding depends on which side of the road we're on: the top must face up,
    // the curb face must face the road (-p).
    const n = g.attributes.normal;
    const wrong = qi === 0 ? n.getY(0) < 0 : n.getX(0) * px + n.getZ(0) * pz > 0;
    if (wrong) {
      const idx = [0, 2, 1, 3, 5, 4]; // swap the 2nd and 3rd vertex of each triangle
      for (const name of ['position', 'uv'] as const) {
        const attr = g.attributes[name];
        const src = (attr.array as Float32Array).slice();
        const k = attr.itemSize;
        idx.forEach((from, to) => (attr.array as Float32Array).set(src.subarray(from * k, from * k + k), to * k));
      }
      g.computeVertexNormals();
    }
    batch.add('sidewalk', g);
  });
  const cx = (ax + bx) / 2 + px * (hw + SIDEWALK_W / 2), cz = (az + bz) / 2 + pz * (hw + SIDEWALK_W / 2);
  const rot = Math.atan2(bx - ax, bz - az);
  const col = physics.world.createCollider(
    RAPIER.ColliderDesc.cuboid(SIDEWALK_W / 2, y / 2, len / 2)
      .setTranslation(cx, y / 2, cz)
      .setRotation({ x: 0, y: Math.sin(rot / 2), z: 0, w: Math.cos(rot / 2) }),
  );
  physics.setOwner(col, { kind: 'ground', material: 'concrete' });
}

// ---------------------------------------------------------------- intersections

interface Arm { ux: number; uz: number; hw: number }
interface Junction { x: number; z: number; arms: Arm[] }

/**
 * Every place where roads meet: crossings (4 arms), T-junctions (a road ending on
 * another) and merges, as a centre point and the directions roads leave it in.
 */
export function findJunctions(all: Road[] = ALL_ROADS): Junction[] {
  const roads = all.filter((r) => r.kind !== 'dirt');
  const found: Junction[] = [];
  /** Arms of `road` leaving point P, which lies `t` of the way along segment `i`. */
  const armsAt = (road: Road, i: number, t: number): Arm[] => {
    const segs = roadSegments(road);
    const [a, b] = segs[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const arms: Arm[] = [];
    const atStart = i === 0 && t * len < 3 && !road.closed;
    const atEnd = i === segs.length - 1 && (1 - t) * len < 3 && !road.closed;
    if (!atEnd) arms.push({ ux, uz, hw: road.width / 2 });
    if (!atStart) {
      // Backwards: along this segment, or the previous one if P is at its start.
      const [pa, pb] = t * len < 0.5 && i > 0 ? segs[i - 1] : [a, b];
      const pl = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      arms.push({ ux: -(pb[0] - pa[0]) / pl, uz: -(pb[1] - pa[1]) / pl, hw: road.width / 2 });
    }
    return arms;
  };
  for (let i = 0; i < roads.length; i++)
    for (let j = i + 1; j < roads.length; j++) {
      const A = roadSegments(roads[i]), B = roadSegments(roads[j]);
      A.forEach(([a, b], si) =>
        B.forEach(([c, d], sj) => {
          // Segment crossing (padded a little so ends that stop on a road count too).
          const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
          const den = r[0] * s[1] - r[1] * s[0];
          if (Math.abs(den) < 1e-9) return;
          const qp = [c[0] - a[0], c[1] - a[1]];
          const t = (qp[0] * s[1] - qp[1] * s[0]) / den, u = (qp[0] * r[1] - qp[1] * r[0]) / den;
          const la = Math.hypot(r[0], r[1]), lb = Math.hypot(s[0], s[1]);
          const padA = (roads[j].width / 2 + 2) / la, padB = (roads[i].width / 2 + 2) / lb;
          if (t < -padA || t > 1 + padA || u < -padB || u > 1 + padB) return;
          const tc = Math.max(0, Math.min(1, t)), uc = Math.max(0, Math.min(1, u));
          found.push({
            x: a[0] + r[0] * t, z: a[1] + r[1] * t,
            arms: [...armsAt(roads[i], si, tc), ...armsAt(roads[j], sj, uc)],
          });
        }),
      );
    }
  // Merge points of the same junction (3+ roads, or a road's bend right at a crossing).
  const out: Junction[] = [];
  for (const f of found) {
    const same = out.find((o) => Math.hypot(o.x - f.x, o.z - f.z) < 6);
    if (!same) {
      out.push({ x: f.x, z: f.z, arms: [] });
      for (const a of f.arms) addArm(out[out.length - 1], a);
    } else for (const a of f.arms) addArm(same, a);
  }
  return out.filter((j) => j.arms.length >= 2);
}

function addArm(j: Junction, a: Arm) {
  const twin = j.arms.find((b) => b.ux * a.ux + b.uz * a.uz > 0.97);
  if (twin) twin.hw = Math.max(twin.hw, a.hw);
  else j.arms.push(a);
}

/** A flat quad (corners in order) at height y with world-planar UVs. */
function flatQuad(pts: [number, number][], y: number, uvScale: number) {
  const g = new THREE.BufferGeometry();
  const [a, b, c, d] = pts;
  const tri = [a, b, c, a, c, d];
  // Wind so the face points up.
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (cross > 0) tri.reverse();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri.flatMap(([x, z]) => [x, y, z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(tri.flatMap(([x, z]) => [x / uvScale, z / uvScale]), 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(tri.flatMap(() => [0, 1, 0]), 3));
  return g;
}

/**
 * Real-looking junctions: a patch of plain asphalt where roads overlap (no lane lines
 * running through it), a white stop line across each lane coming in, and zebra
 * crossings in the cities. Shallow merges (ramps) get none of that: there the bigger
 * road is drawn on top so its lines carry on and the ramp simply joins its edge.
 */
export function addIntersections(batch: StaticBatch) {
  const inCity = (x: number, z: number) => inAABB(x, z, BOSTON, 2) || inAABB(x, z, NYC, 2);
  junctionPatches((key, g) => batch.add(key, g), ALL_ROADS, ROAD_Y, inCity);
}

/** The junction pieces for `roads` at road height `y`, handed to `add` with the junction's spot. */
export function junctionPatches(add: (key: string, g: THREE.BufferGeometry, x: number, z: number) => void, roads: Road[], y: number, city: (x: number, z: number) => boolean) {
  for (const j of findJunctions(roads)) {
    const sinMin = Math.min(...j.arms.flatMap((a) => j.arms.filter((b) => b !== a).map((b) => Math.abs(a.ux * b.uz - a.uz * b.ux))).filter((s) => s > 0.05));
    if (!(sinMin > 0.45)) continue; // a merge: leave it to draw order
    if (!j.arms.some((a) => j.arms.some((b) => Math.abs(a.ux * b.uz - a.uz * b.ux) > 0.3))) continue; // one road running straight on
    const maxHw = Math.max(...j.arms.map((a) => a.hw));
    // How far along each arm the other roads reach.
    const reach = j.arms.map((a) => {
      let L = 0;
      for (const b of j.arms) {
        if (b === a) continue;
        const sin = Math.abs(a.ux * b.uz - a.uz * b.ux);
        if (sin > 0.3) L = Math.max(L, b.hw / sin);
      }
      return Math.min(40, L + 0.8);
    });
    const zebra = city(j.x, j.z);
    j.arms.forEach((a, k) => {
      const L = reach[k];
      const px = -a.uz, pz = a.ux; // across the arm
      const at = (along: number, across: number): [number, number] => [j.x + a.ux * along + px * across, j.z + a.uz * along + pz * across];
      // Plain asphalt over the overlap.
      add('road-plain', flatQuad([at(0, -a.hw), at(L, -a.hw), at(L, a.hw), at(0, a.hw)], y + 0.012, 14), j.x, j.z);
      // Stop line across the lanes coming in (on their right: entering, you travel along -u).
      add('road-marks', flatQuad([at(L + 0.2, 0.3), at(L + 0.7, 0.3), at(L + 0.7, a.hw - 0.8), at(L + 0.2, a.hw - 0.8)], y + 0.02, 1), j.x, j.z);
      if (zebra) {
        // Zebra crossing just beyond the stop line, across the whole road.
        for (let w = -a.hw + 1; w < a.hw - 1; w += 1.3)
          add('road-marks', flatQuad([at(L + 1.4, w), at(L + 4.4, w), at(L + 4.4, w + 0.65), at(L + 1.4, w + 0.65)], y + 0.02, 1), j.x, j.z);
      }
    });
    // Fill the middle.
    const disc = new THREE.CircleGeometry(maxHw, 20);
    disc.rotateX(-Math.PI / 2);
    disc.translate(j.x, y + 0.012, j.z);
    const uv = disc.attributes.uv as THREE.BufferAttribute, pos = disc.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 14, pos.getZ(i) / 14);
    add('road-plain', disc, j.x, j.z);
  }
}
