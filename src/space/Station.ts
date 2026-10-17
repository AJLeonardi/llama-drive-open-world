// The space station stunt park, built (the layout and colliders: stationLayout.ts). It
// is only built the first time someone flies up (a few milliseconds a frame during the
// launch, `build()` is a generator), then kept for later trips.
//
// The deck is steel plate with glowing edges; the ramps are painted bright with lit
// lips; rings to fly through float along the jumps; antenna pylons stand at the corners
// with struts up to the huge habitat ring that turns slowly overhead, its hub hanging
// over the middle with solar wings either side. Under the deck hang tanks and the
// station's own big engines, and far below them the force-field net glows. Asteroids
// drift past, and the sky (spaceSky.ts) has the Earth in it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Physics } from '../physics/Physics';
import { Breakable } from '../damage/Breakable';
import { Debris } from '../fx/Debris';
import { normalizeAttributes } from '../world/batch';
import { box, cyl, paint } from '../vehicles/builders/geo';
import { boostTexture } from '../util/textures';
import { mulberry32 } from '../util/math';
import { makeRocket, Rocket } from './rocket';
import {
  BLOCKS, BOARD, BOOSTS, DECK, DECK_CORNER, HOOPS, LANDING, NET, PROPS, SPACE_GRAVITY, STATION_QUERIES, SY, WEDGES,
  addStationColliders, bounceTarget, homing, netBounce, wedgeHeight, wedgeSlices,
} from './stationLayout';

/** What happened this frame (the game turns these into sounds, boosts and messages). */
export interface StationEvents {
  /** Index of a ring just flown through (−1: none). */
  hoop: number;
  /** The car hit the net and is being sprung back up (the velocity to give it), from here. */
  bounce: THREE.Vector3 | null;
  from: THREE.Vector3 | null;
  /** On the way back from a bounce: the sideways velocity the tractor beam gives it. */
  steer: { x: number; z: number } | null;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const qInv = new THREE.Quaternion();

/** Steel deck plate: square panels with seams, rivets and a few scuffs (repeats every 8 m). */
function deckTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8a9099';
  g.fillRect(0, 0, S, S);
  const rng = mulberry32(77);
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      const v = 128 + Math.floor(rng() * 24);
      g.fillStyle = `rgb(${v - 6},${v},${v + 8})`;
      g.fillRect(i * 128 + 3, j * 128 + 3, 122, 122);
      // Diamond tread on alternate panels.
      if ((i + j) % 2 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.10)';
        for (let y = 8; y < 124; y += 10) for (let x = 8 + ((y / 10) % 2) * 5; x < 124; x += 10) g.fillRect(i * 128 + x, j * 128 + y, 5, 2);
      }
      g.fillStyle = '#5d636b';
      for (const [x, y] of [[10, 10], [118, 10], [10, 118], [118, 118]]) {
        g.beginPath();
        g.arc(i * 128 + x, j * 128 + y, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  for (let k = 0; k < 30; k++) {
    g.fillStyle = `rgba(40,44,50,${0.05 + rng() * 0.08})`;
    g.fillRect(rng() * S, rng() * S, 6 + rng() * 30, 1 + rng() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Solar panel cells: deep blue with a silver grid. */
function solarTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8ccd2';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const grd = g.createLinearGradient(0, j * 32, 0, j * 32 + 32);
      grd.addColorStop(0, '#1f3f86');
      grd.addColorStop(1, '#0d1f4a');
      g.fillStyle = grd;
      g.fillRect(i * 32 + 1.5, j * 32 + 1.5, 29, 29);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The habitat ring's skin: panels with rows of lit windows. */
function habitatTexture() {
  const W = 256, H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9dde2';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#aab0b8';
  for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 2, H);
  g.fillRect(0, 20, W, 2);
  g.fillRect(0, 42, W, 2);
  for (let x = 4; x < W; x += 16) {
    g.fillStyle = Math.random() < 0.8 ? '#ffe9a8' : '#3a4250';
    g.fillRect(x, 27, 9, 10);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The net's shader: a glowing hexagon grid that fades out towards its rim, with ripples where things land. */
function netMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { time: { value: 0 }, hit: { value: new THREE.Vector3(0, 0, -100) }, radius: { value: NET.r } },
    vertexShader: `varying vec2 vXZ; void main() { vXZ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float time; uniform vec3 hit; uniform float radius; varying vec2 vXZ;
      float hexDist(vec2 p) {
        p = abs(p);
        return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
      }
      void main() {
        vec2 p = vXZ / 14.0;
        vec2 r = vec2(1.0, 1.7320508), h = r * 0.5;
        vec2 a = mod(p, r) - h, b = mod(p - h, r) - h;
        vec2 g = dot(a, a) < dot(b, b) ? a : b;
        float edge = smoothstep(0.42, 0.5, hexDist(g));
        float d = length(vXZ);
        float fade = 1.0 - smoothstep(radius * 0.55, radius, d);
        float pulse = 0.55 + 0.45 * sin(time * 1.5 - d * 0.02);
        // Ripples spreading from the last landing (hit.z: seconds since).
        float since = hit.z;
        float rd = length(vXZ - hit.xy);
        float ripple = since < 3.0 ? smoothstep(10.0, 0.0, abs(rd - since * 90.0)) * (1.0 - since / 3.0) : 0.0;
        vec3 col = vec3(0.15, 0.75, 1.0) * (edge * 0.55 * pulse + 0.05) + vec3(0.6, 0.95, 1.0) * ripple * 1.5;
        gl_FragColor = vec4(col * fade, 1.0);
      }`,
  });
}

class Collector {
  private byKey = new Map<string, THREE.BufferGeometry[]>();
  add(key: string, g: THREE.BufferGeometry) {
    normalizeAttributes(g);
    let l = this.byKey.get(key);
    if (!l) this.byKey.set(key, (l = []));
    l.push(g);
  }
  build(group: THREE.Group, mats: Record<string, THREE.Material>) {
    for (const [key, geos] of this.byKey) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, mats[key]);
      m.castShadow = key === 'plain' || key === 'ramp';
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      if (key === 'boost') m.renderOrder = 1;
      group.add(m);
    }
    this.byKey.clear();
  }
}

/** A closed convex solid from corner points, each face shaded flat and facing out. */
function hullGeometry(pts: [number, number, number][], faces: number[][]) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length, cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
  const pos: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (const f of faces)
    for (let i = 1; i < f.length - 1; i++) {
      let [i0, i1, i2] = [f[0], f[i], f[i + 1]];
      a.set(...pts[i0]);
      b.set(...pts[i1]);
      c.set(...pts[i2]);
      n.subVectors(b, a).cross(c.clone().sub(a));
      const out = (a.x + b.x + c.x) / 3 - cx, outY = (a.y + b.y + c.y) / 3 - cy, outZ = (a.z + b.z + c.z) / 3 - cz;
      if (n.x * out + n.y * outY + n.z * outZ < 0) [i1, i2] = [i2, i1];
      for (const k of [i0, i1, i2]) pos.push(...pts[k]);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A flat quad on the deck: centre, heading, length along it and width across, height. */
function deckQuad(x: number, z: number, heading: number, length: number, width: number, y: number) {
  const g = new THREE.PlaneGeometry(width, length);
  g.rotateX(-Math.PI / 2);
  g.rotateY(heading);
  g.translate(x, y, z);
  return g;
}

export class Station {
  readonly group = new THREE.Group();
  readonly physics = new Physics(SPACE_GRAVITY);
  readonly queries = STATION_QUERIES;
  readonly debris: Debris;
  props!: Breakable;
  /** The rocket standing on the landing pad. */
  readonly rocket: Rocket;
  built = false;
  private hoops!: THREE.InstancedMesh;
  private hoopFlash: number[] = HOOPS.map(() => 0);
  private hoopDone: boolean[] = HOOPS.map(() => false);
  private hoopSide: number[] = HOOPS.map(() => 0);
  private hoopQuat = HOOPS.map((h) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.heading));
  private net!: THREE.Mesh;
  private netHit = { x: 0, z: 0, since: 99 };
  private habitat = new THREE.Group();
  private asteroids!: THREE.InstancedMesh;
  private asteroidSpin: { axis: THREE.Vector3; speed: number; pos: THREE.Vector3; scale: number }[] = [];
  private blinkers: THREE.MeshBasicMaterial;
  private events: StationEvents = { hoop: -1, bounce: null, from: null, steer: null };
  private bounceV = new THREE.Vector3();
  private bounceFrom = new THREE.Vector3();
  private bounceCool = 0;
  /** Where the tractor beam is taking the car after a bounce (null: not bouncing). */
  private target: { x: number; z: number } | null = null;

  constructor(scene: THREE.Scene) {
    this.debris = new Debris(this.physics, scene);
    this.rocket = makeRocket();
    this.rocket.root.position.set(LANDING.x, SY + 0.4, LANDING.z);
    this.rocket.root.rotation.y = Math.PI; // its window faces north, up the deck
    this.blinkers = new THREE.MeshBasicMaterial({ color: 0xff3020 });
    this.group.visible = false;
  }

  /** How many rings there are, and how many flown through so far. */
  get rings() {
    return { total: HOOPS.length, done: this.hoopDone.filter(Boolean).length };
  }

  /** Builds everything, a piece per step (the launch keeps going in between). */
  *build(): Generator<void> {
    const mats: Record<string, THREE.Material> = {
      plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }),
      ramp: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2 }),
      deck: new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.6, metalness: 0.45, vertexColors: true }),
      neon: new THREE.MeshBasicMaterial({ vertexColors: true }),
      blink: this.blinkers,
      boost: new THREE.MeshBasicMaterial({ map: boostTexture(), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false }),
      solar: new THREE.MeshStandardMaterial({ map: solarTexture(), roughness: 0.25, metalness: 0.6, side: THREE.DoubleSide }),
      habitat: new THREE.MeshStandardMaterial({ map: habitatTexture(), roughness: 0.5, metalness: 0.3, emissive: 0x332a10, emissiveMap: habitatTexture() }),
    };
    const col = new Collector();
    addStationColliders(this.physics);
    yield;

    // ------------------------------------------------ the deck
    const C = DECK_CORNER;
    const corners: [number, number][] = [];
    for (let k = 0; k < 8; k++) {
      const a = -Math.PI / 2 - Math.PI / 8 + (k * Math.PI) / 4;
      corners.push([Math.cos(a) * C, Math.sin(a) * C]);
    }
    {
      const shape = new THREE.Shape(corners.map(([x, z]) => new THREE.Vector2(x, -z)));
      const top = new THREE.ShapeGeometry(shape);
      top.rotateX(-Math.PI / 2);
      top.translate(0, SY, 0);
      const uv = top.attributes.uv as THREE.BufferAttribute, p = top.attributes.position;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 8, p.getZ(i) / 8);
      // Darker plates in rings, lighter round the middle.
      paint(top, (x, _y, z) => (Math.hypot(x, z) < 60 ? 0xffffff : 0xdfe3ea));
      top.setAttribute('uv', uv);
      col.add('deck', top);
      // The edge: a dark band all round, glowing strips along the top and bottom of it.
      const pts: [number, number, number][] = [];
      for (const [x, z] of corners) pts.push([x, SY, z], [x * 0.94, SY - DECK.thick - 4, z * 0.94]);
      const faces: number[][] = [];
      for (let k = 0; k < 8; k++) faces.push([k * 2, ((k + 1) % 8) * 2, ((k + 1) % 8) * 2 + 1, k * 2 + 1]);
      faces.push(Array.from({ length: 8 }, (_, k) => k * 2 + 1));
      col.add('plain', paint(hullGeometry(pts, faces), 0x3a4048));
      for (let k = 0; k < 8; k++) {
        const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 8];
        const len = Math.hypot(bx - ax, bz - az), h = Math.atan2(bx - ax, bz - az);
        for (const [y, s, color] of [[SY - 0.6, 1, 0x46e0ff], [SY - DECK.thick - 3.6, 0.95, 0xff8a2a]] as const)
          col.add('neon', box({ at: [((ax + bx) / 2) * s, y, ((az + bz) / 2) * s], size: [0.3, 0.35, len * s], rot: [0, h, 0], color, seg: 100 }));
      }
      // Lane markings: a big glowing circle round the middle and spokes out to the ramps.
      const ring = new THREE.RingGeometry(58, 59.2, 64);
      ring.rotateX(-Math.PI / 2);
      ring.translate(0, SY + 0.04, 0);
      col.add('neon', paint(ring, 0x2a9fd0));
      for (let k = 0; k < 8; k++) {
        if (k === 0 || k === 4) continue;
        const h = Math.PI + (k * Math.PI) / 4, ux = Math.sin(h), uz = Math.cos(h);
        for (let r = 66; r < DECK.R - 50; r += 9) col.add('neon', deckQuad(ux * r, uz * r, h, 4, 0.5, SY + 0.04));
      }
    }
    yield;

    // ------------------------------------------------ ramps: painted, with lit lips and chevrons
    for (const w of WEDGES) {
      for (const slice of wedgeSlices(w)) {
        const p = slice.map(([x, y, z]): [number, number, number] => [x, SY + y, z]);
        // (Corners: start L bottom/top, start R bottom/top, end L bottom/top, end R bottom/top.)
        const g = hullGeometry(p, [[1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [4, 5, 7, 6], [0, 4, 6, 2]]);
        col.add('ramp', paint(g, w.color));
      }
      const ux = Math.sin(w.heading), uz = Math.cos(w.heading);
      const slope = Math.atan(w.h / (w.len * 0.825)); // (the straight part, past the curved foot)
      // The lip glows.
      col.add('neon', box({ at: [w.x + ux * (w.len - 0.25), SY + w.h + 0.06, w.z + uz * (w.len - 0.25)], size: [w.w, 0.14, 0.5], rot: [0, w.heading, 0], color: 0x46e0ff, seg: 100 }));
      // Chevrons up the slope.
      for (let t = 0.42; t < 0.95; t += 0.17) {
        const along = w.len * t, y = SY + wedgeHeight(w, along) + 0.07;
        for (const s of [-1, 1]) {
          const g2 = new THREE.PlaneGeometry(w.w * 0.3, 0.8);
          g2.rotateX(-Math.PI / 2);
          g2.rotateY(s * 0.7);
          g2.translate(s * w.w * 0.12, 0, 0);
          g2.rotateX(-slope);
          g2.rotateY(w.heading);
          g2.translate(w.x + ux * along, y, w.z + uz * along);
          col.add('neon', paint(g2, 0xffe14d));
        }
      }
      // Struts under the high end.
      for (const s of [-0.4, 0.4]) {
        const ex = w.x + ux * (w.len - 1) + uz * s * w.w, ez = w.z + uz * (w.len - 1) - ux * s * w.w;
        col.add('plain', cyl({ at: [ex, SY + w.h / 2, ez], radius: 0.3, length: w.h, axis: 'y', segments: 8, color: 0x5a616b }));
      }
    }
    yield;

    // ------------------------------------------------ rails and pylons
    for (const b of BLOCKS) {
      if (b.sy < 2) {
        col.add('plain', box({ at: [b.x, SY + b.y, b.z], size: [b.sx, b.sy, b.sz], rot: [0, b.heading, 0], color: b.color, seg: 100 }));
        col.add('neon', box({ at: [b.x, SY + b.y + b.sy / 2 + 0.03, b.z], size: [b.sx * 0.5, 0.06, b.sz], rot: [0, b.heading, 0], color: 0x46e0ff, seg: 100 }));
      } else {
        // An antenna pylon: a lattice mast with a dish and a blinking light, a strut running up to the habitat ring.
        col.add('plain', box({ at: [b.x, SY + b.y, b.z], size: [b.sx, b.sy, b.sz], rot: [0, b.heading, 0], color: b.color, seg: 100 }));
        for (let y = 3; y < b.sy; y += 3) col.add('neon', box({ at: [b.x, SY + y, b.z], size: [b.sx + 0.1, 0.12, b.sz + 0.1], rot: [0, b.heading, 0], color: 0x3a6c88, seg: 100 }));
        col.add('blink', box({ at: [b.x, SY + b.sy + 0.6, b.z], size: [0.9, 0.9, 0.9], color: 0xffffff }));
        const dish = new THREE.SphereGeometry(2.4, 14, 6, 0, Math.PI * 2, 0, 1.0);
        dish.rotateX(Math.PI / 2 + 0.4);
        dish.rotateY(Math.atan2(b.x, b.z));
        dish.translate(b.x, SY + b.sy - 2, b.z);
        col.add('plain', paint(dish, 0xe8eaee));
        const r = Math.hypot(b.x, b.z), ux = b.x / r, uz = b.z / r;
        const from = new THREE.Vector3(b.x, SY + b.sy, b.z), to = new THREE.Vector3(ux * 16, SY + 108, uz * 16);
        const strut = new THREE.CylinderGeometry(0.9, 0.9, from.distanceTo(to), 8);
        strut.translate(0, from.distanceTo(to) / 2, 0);
        strut.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
        strut.translate(from.x, from.y, from.z);
        col.add('plain', paint(strut, 0xa9b0b9));
      }
    }
    yield;

    // ------------------------------------------------ the landing pad, the boarding circle, boost pads
    {
      const ring = new THREE.RingGeometry(LANDING.r - 1, LANDING.r, 48);
      ring.rotateX(-Math.PI / 2);
      ring.translate(LANDING.x, SY + 0.05, LANDING.z);
      col.add('neon', paint(ring, 0xffd23a));
      const disc = new THREE.CircleGeometry(LANDING.r - 1, 48);
      disc.rotateX(-Math.PI / 2);
      disc.translate(LANDING.x, SY + 0.03, LANDING.z);
      col.add('plain', paint(disc, 0x2d3239));
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        col.add('blink', box({ at: [LANDING.x + Math.cos(a) * (LANDING.r + 1.2), SY + 0.15, LANDING.z + Math.sin(a) * (LANDING.r + 1.2)], size: [0.6, 0.3, 0.6], color: 0xffffff }));
      }
      for (const [r0, r1, color] of [[BOARD.r - 0.8, BOARD.r, 0x46e0ff], [BOARD.r - 2.4, BOARD.r - 2.0, 0x2a9fd0]] as const) {
        const b = new THREE.RingGeometry(r0, r1, 40);
        b.rotateX(-Math.PI / 2);
        b.translate(BOARD.x, SY + 0.05, BOARD.z);
        col.add('neon', paint(b, color));
      }
      // A sign by the boarding circle, facing up the deck (where you come back from).
      {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 160;
        const g = c.getContext('2d')!;
        g.fillStyle = '#14233a';
        g.fillRect(0, 0, 512, 160);
        g.strokeStyle = '#46e0ff';
        g.lineWidth = 8;
        g.strokeRect(8, 8, 496, 144);
        g.fillStyle = '#ffd23a';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = 'bold 54px Helvetica, Arial, sans-serif';
        g.fillText('🌍 BACK TO EARTH', 256, 62, 470);
        g.font = 'bold 34px Helvetica, Arial, sans-serif';
        g.fillText('drive in here', 256, 118);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.8), new THREE.MeshBasicMaterial({ map: tex }));
        sign.position.set(BOARD.x - BOARD.r - 5, SY + 3.6, BOARD.z);
        sign.rotation.y = Math.PI;
        this.group.add(sign);
        for (const dx of [-3.6, 3.6]) col.add('plain', cyl({ at: [sign.position.x + dx, SY + 1.6, BOARD.z], radius: 0.12, length: 3.2, axis: 'y', segments: 6, color: 0x2a2d31 }));
      }
      for (const p of BOOSTS) {
        const q = deckQuad(p.x, p.z, p.heading + Math.PI, p.length, p.width, SY + 0.05);
        col.add('boost', q);
      }
    }
    yield;

    // ------------------------------------------------ under the deck: a truss, tanks and the station's engines
    {
      for (let k = 0; k < 8; k++) {
        const [x, z] = corners[k];
        col.add('plain', cyl({ at: [x * 0.45, SY - 14, z * 0.45], radius: 6, length: 16, axis: 'y', segments: 14, color: 0xd8dce2 }));
        col.add('neon', cyl({ at: [x * 0.45, SY - 22.2, z * 0.45], radius: 4.5, radiusTop: 4.5, length: 0.4, axis: 'y', segments: 14, color: 0xff9a3a }));
      }
      col.add('plain', cyl({ at: [0, SY - 24, 0], radius: 22, radiusTop: 34, length: 18, axis: 'y', segments: 24, color: 0x6b727c }));
      col.add('plain', cyl({ at: [0, SY - 40, 0], radius: 14, radiusTop: 22, length: 14, axis: 'y', segments: 24, color: 0x4a5059 }));
      col.add('neon', cyl({ at: [0, SY - 47.3, 0], radius: 13, length: 0.5, axis: 'y', segments: 24, color: 0x7fe8ff }));
    }
    yield;

    // ------------------------------------------------ the habitat ring overhead, its hub and solar wings
    {
      const torus = new THREE.TorusGeometry(330, 16, 16, 96);
      torus.rotateX(Math.PI / 2);
      const uv = torus.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 60, uv.getY(i));
      const ringMesh = new THREE.Mesh(torus, mats.habitat);
      this.habitat.add(ringMesh);
      const hub = new THREE.Mesh(paint(new THREE.CylinderGeometry(26, 26, 40, 24), 0xd5d9de), mats.plain);
      const hubCap = new THREE.Mesh(paint(new THREE.SphereGeometry(26, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xe8eaee), mats.plain);
      hubCap.position.y = 20;
      const hubBottom = new THREE.Mesh(paint(new THREE.ConeGeometry(26, 26, 24), 0xb9c0c8), mats.plain);
      hubBottom.rotation.x = Math.PI;
      hubBottom.position.y = -33;
      this.habitat.add(hub, hubCap, hubBottom);
      const spokes: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 6; k++) {
        const g = new THREE.CylinderGeometry(4, 4, 304, 10);
        g.rotateZ(Math.PI / 2);
        g.translate(178, 0, 0);
        g.rotateY((k * Math.PI) / 3);
        spokes.push(paint(g, 0xb9c0c8));
      }
      this.habitat.add(new THREE.Mesh(mergeGeometries(spokes), mats.plain));
      // Solar wings out either side of the hub, past the ring.
      for (const s of [-1, 1]) {
        const wing = new THREE.PlaneGeometry(260, 70);
        wing.rotateX(-Math.PI / 2);
        const wuv = wing.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) * 26, wuv.getY(i) * 7);
        wing.translate(s * 520, 30, 0);
        this.habitat.add(new THREE.Mesh(wing, mats.solar));
        this.habitat.add(new THREE.Mesh(paint(new THREE.CylinderGeometry(2, 2, 400, 8).rotateZ(Math.PI / 2).translate(s * 400, 30, 0), 0x9aa1aa), mats.plain));
      }
      this.habitat.position.set(0, SY + 150, 0);
      for (const o of this.habitat.children) o.castShadow = false;
      this.group.add(this.habitat);
    }
    yield;

    // ------------------------------------------------ rings to fly through (one instanced mesh; gold, green once done)
    {
      const g = new THREE.TorusGeometry(1, 0.07, 10, 40);
      this.hoops = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), HOOPS.length);
      this.hoops.frustumCulled = false;
      HOOPS.forEach((_, i) => this.setHoop(i, 1));
      this.group.add(this.hoops);
    }
    // ------------------------------------------------ the force-field net
    {
      const g = new THREE.CircleGeometry(NET.r, 64);
      g.rotateX(-Math.PI / 2);
      this.net = new THREE.Mesh(g, netMaterial());
      this.net.position.y = NET.y;
      this.net.renderOrder = 2;
      this.net.frustumCulled = false;
      this.group.add(this.net);
    }
    // ------------------------------------------------ asteroids drifting round
    {
      const rng = mulberry32(2024);
      const g = paint(new THREE.IcosahedronGeometry(1, 1), (x, y, z) => {
        const k = 0.55 + 0.25 * Math.sin(x * 5 + y * 3) * Math.cos(z * 4);
        return [0.11 * k, 0.095 * k, 0.085 * k];
      });
      // Lumpy: push the corners in and out.
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 0.75 + 0.5 * Math.abs(Math.sin(p.getX(i) * 7.1 + p.getY(i) * 3.3 + p.getZ(i) * 5.7));
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
      }
      g.computeVertexNormals();
      const N = 46;
      this.asteroids = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), N);
      for (let i = 0; i < N; i++) {
        const a = rng() * Math.PI * 2, r = 520 + rng() * 700, y = SY - 200 + rng() * 520;
        this.asteroidSpin.push({
          axis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
          speed: 0.05 + rng() * 0.3,
          pos: new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r),
          scale: 6 + rng() * rng() * 40,
        });
      }
      this.asteroids.frustumCulled = false;
      this.group.add(this.asteroids);
    }
    yield;

    // ------------------------------------------------ props (barrels, crates, cones), and everything merged
    this.props = new Breakable(this.physics, PROPS);
    this.props.killBelow = NET.y;
    this.group.add(this.props.group);
    col.build(this.group, mats);
    this.group.add(this.rocket.root);
    this.built = true;
  }

  /** Builds whatever is left right now. */
  finishBuild(gen: Generator<void>) {
    for (let r = gen.next(); !r.done; r = gen.next());
  }

  private setHoop(i: number, flash: number) {
    const h = HOOPS[i];
    const m = new THREE.Matrix4().compose(tmp.set(h.x, h.y, h.z), this.hoopQuat[i], tmp2.setScalar(h.r * (1 + 0.25 * (flash > 0 && flash < 1 ? flash : 0))));
    this.hoops.setMatrixAt(i, m);
    this.hoops.setColorAt(i, new THREE.Color(this.hoopDone[i] ? 0x5dff8a : 0xffd23a).multiplyScalar(1 + flash * 1.5));
    this.hoops.instanceMatrix.needsUpdate = true;
    this.hoops.instanceColor!.needsUpdate = true;
  }

  /** Put everything back as it was (props, rings). */
  reset(around: THREE.Vector3Like) {
    this.props.populate();
    this.props.stream(around);
    this.debris.clear();
    this.hoopDone.fill(false);
    HOOPS.forEach((_, i) => this.setHoop(i, 0));
  }

  /**
   * Each frame: animate, check the rings and the net against the car (`pos`, `vel`; null
   * while it isn't out), and run the props.
   */
  update(dt: number, time: number, pos: THREE.Vector3 | null, vel: THREE.Vector3Like | null, camera: THREE.Vector3, particles: import('../fx/Particles').Particles): StationEvents {
    const ev = this.events;
    ev.hoop = -1;
    ev.bounce = null;
    ev.from = null;
    ev.steer = null;
    this.habitat.children[0].rotation.y += dt * 0.02; // (the ring turns; the hub and wings hold still)
    this.blinkers.color.setHex(time % 1.2 < 0.6 ? 0xff3020 : 0x3a0806);
    (this.net.material as THREE.ShaderMaterial).uniforms.time.value = time;
    this.netHit.since += dt;
    (this.net.material as THREE.ShaderMaterial).uniforms.hit.value.set(this.netHit.x, this.netHit.z, this.netHit.since);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    this.asteroidSpin.forEach((a, i) => {
      q.setFromAxisAngle(a.axis, time * a.speed);
      this.asteroids.setMatrixAt(i, m.compose(a.pos, q, tmp.setScalar(a.scale)));
    });
    this.asteroids.instanceMatrix.needsUpdate = true;

    if (pos && vel) {
      // Rings: crossing a ring's plane inside it counts.
      HOOPS.forEach((h, i) => {
        qInv.copy(this.hoopQuat[i]).invert();
        tmp.set(pos.x - h.x, pos.y + 0.8 - h.y, pos.z - h.z).applyQuaternion(qInv);
        const side = Math.sign(tmp.z);
        const prev = this.hoopSide[i];
        this.hoopSide[i] = side;
        if (prev !== 0 && side !== prev && Math.hypot(tmp.x, tmp.y) < h.r + 0.5 && Math.abs(tmp.z) < 6) {
          this.hoopFlash[i] = 1;
          if (!this.hoopDone[i]) this.hoopDone[i] = true;
          ev.hoop = i;
          particles.sparkle({ x: h.x, y: h.y, z: h.z }, 40);
        }
      });
      // On the way back from the net: the tractor beam steers it in.
      if (this.target) {
        ev.steer = homing(pos.x, pos.y, pos.z, vel.y, this.target);
        if (!ev.steer) this.target = null;
      }
      // The net: spring the car back up onto the deck, near the middle.
      this.bounceCool -= dt;
      if ((pos.y < NET.y + 1.5 || pos.y < SY - 250) && this.bounceCool <= 0) {
        this.bounceCool = 1;
        const b = netBounce(pos.x, pos.y, pos.z);
        ev.from = this.bounceFrom.set(b.from.x, b.from.y, b.from.z);
        this.bounceV.set(b.v.x, b.v.y, b.v.z);
        this.target = bounceTarget(Math.random(), Math.random());
        ev.bounce = this.bounceV;
        this.netHit.x = pos.x;
        this.netHit.z = pos.z;
        this.netHit.since = 0;
        particles.sparkle({ x: pos.x, y: NET.y + 0.5, z: pos.z }, 50, 0x7fe8ff);
      }
    }
    for (let i = 0; i < HOOPS.length; i++) {
      if (this.hoopFlash[i] <= 0) continue;
      this.hoopFlash[i] = Math.max(0, this.hoopFlash[i] - dt * 1.5);
      this.setHoop(i, this.hoopFlash[i]);
    }
    this.props.update(dt, particles, this.debris, camera, pos ?? camera);
    this.debris.update();
    return ev;
  }
}
