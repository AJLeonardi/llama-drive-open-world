// Round mini-map (heading-up, follows the car) + a full-screen world map (north-up) you
// can swipe around and pinch to zoom, and tap to drop a pin for directions.
//
// The middle of the map (cities etc.) is a picture drawn once; highway country (long
// highways, ramps, the Ring, lakes) is drawn as vector paths at any zoom.
import {
  ALL_ROADS, BOSTON, BOSTON_COMMON, CENTRAL_PARK, DEMO_PARK, HARBOR, HARBOR_X, LAKE, LOOP, MOUNTAIN, NYC, OUTER, RIVER, Road, TRACK, WORLD,
} from '../world/layout';
import { ALEX, DC, DC_PLAN, HIGHWAYS, MAIN_ST, OUTER_LAKES, RAMPS, RING, TOWNS, pointAt, profileAt, townPoint } from '../world/outer';
import { RING_APOTHEM, HEX, hexDistance } from '../world/bounds';
import { findRoute, routeSeconds, type Route } from '../world/route';
import { FieldKind, biomeAt, fieldKind, mountainWeight } from '../world/biomes';
import { CANYON, terrainBase } from '../world/hills';
import type { Vec2 } from '../util/math';

const S = 0.5; // pixels per metre in the picture of the middle
const VIEW_METRES = 560; // width of world shown in the mini-map
const GRASS = '#7fb35d';

export interface Destination {
  x: number;
  z: number;
  icon: string;
  label: string;
}

export const DESTINATIONS: Destination[] = [
  { x: (BOSTON.x0 + BOSTON.x1) / 2, z: 0, icon: '🏙️', label: 'Boston' },
  { x: (NYC.x0 + NYC.x1) / 2, z: 0, icon: '🌃', label: 'New York' },
  { x: TRACK.cx, z: TRACK.cz, icon: '🏁', label: 'Dirt Track' },
  { x: LOOP.x, z: LOOP.z - 30, icon: '🎢', label: 'Loop' },
  { x: (DEMO_PARK.x0 + DEMO_PARK.x1) / 2, z: (DEMO_PARK.z0 + DEMO_PARK.z1) / 2, icon: '💥', label: 'Demolition Park' },
  { x: MOUNTAIN.x, z: MOUNTAIN.z, icon: '⛰️', label: 'Thunder Mountain' },
  { x: CANYON.x, z: (CANYON.z0 + CANYON.z1) / 2, icon: '🏜️', label: 'Red Canyon' },
  ...countryDestinations(),
];

/** Places out in highway country: the towns, the highest mountain pass, the farms. */
function countryDestinations(): Destination[] {
  const out: Destination[] = [];
  for (const t of TOWNS) {
    const [x, z] = t.kind === 'mariano' ? townPoint(t, 0, MAIN_ST + 55) : t.kind === 'alexander' ? townPoint(t, 0, ALEX.avenues[0]) : t.kind === 'pad' ? [t.x, t.z] : townPoint(t, ...DC_PLAN.monument);
    out.push({ x, z, icon: t.kind === 'mariano' ? '🍁' : t.kind === 'alexander' ? '🌾' : t.kind === 'pad' ? '🚀' : '🏛️', label: t.name });
  }
  // The top of the highest pass, and the middle of farm country.
  let pass: Destination | null = null, top = -Infinity, farm: Destination | null = null, farmBest = 0;
  for (const h of HIGHWAYS)
    for (let s = 300; s < h.len - 300; s += 100) {
      const p = pointAt(h, s);
      const b = biomeAt(p.x, p.z);
      const y = profileAt(h, s);
      if (b.mountain > 0.8 && y > top) (top = y), (pass = { x: p.x, z: p.z, icon: '🏔️', label: 'Snowy Pass' });
      const f = b.farm - Math.abs(Math.hypot(p.x, p.z) - 3800) / 8000;
      if (b.farm > 0.9 && f > farmBest) (farmBest = f), (farm = { x: p.x, z: p.z, icon: '🚜', label: 'Farm Country' });
    }
  if (pass) out.push(pass);
  if (farm) out.push(farm);
  return out;
}

const ROAD_STYLE: Record<Road['kind'], [string, number]> = {
  highway: ['#ffd23f', 1],
  avenue: ['#ffffff', 0.9],
  street: ['#f4f4f4', 0.9],
  ramp: ['#ffe48a', 1],
  dirt: ['#a8743f', 1],
};

/** Picture of the middle of the map (WORLD), S pixels per metre. */
function drawMiddle(): HTMLCanvasElement {
  const w = Math.round((WORLD.x1 - WORLD.x0) * S), h = Math.round((WORLD.z1 - WORLD.z0) * S);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const X = (x: number) => (x - WORLD.x0) * S, Z = (z: number) => (z - WORLD.z0) * S;
  const rect = (b: { x0: number; z0: number; x1: number; z1: number }, color: string) => {
    g.fillStyle = color;
    g.fillRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S);
  };
  g.fillStyle = GRASS;
  g.fillRect(0, 0, w, h);
  rect(BOSTON, '#c8c3b8');
  rect(NYC, '#c3c3c6');
  rect(BOSTON_COMMON, '#6fae52');
  rect(CENTRAL_PARK, '#6fae52');
  rect(DEMO_PARK, '#c9a674');
  // Water: river, harbour bay, the lake under Thunder Mountain
  g.fillStyle = '#4b93cf';
  const rw = RIVER.halfWidth + RIVER.bank * 0.5;
  g.fillRect(X(HARBOR_X), Z(RIVER.z - rw), (RIVER.x1 - HARBOR_X) * S, rw * 2 * S);
  rect({ x0: HARBOR.x0 + 20, x1: HARBOR_X + 6, z0: -HARBOR.z + 6, z1: HARBOR.z - 6 }, '#4b93cf');
  g.beginPath();
  g.arc(X(LAKE.x), Z(LAKE.z), (LAKE.r + LAKE.bank * 0.6) * S, 0, Math.PI * 2);
  g.fill();
  // Thunder Mountain: rocky ring (the spiral road) around a grassy top.
  g.fillStyle = '#8c7a68';
  g.beginPath();
  g.arc(X(MOUNTAIN.x), Z(MOUNTAIN.z), (MOUNTAIN.r + MOUNTAIN.road + 4) * S, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#5f9a45';
  g.beginPath();
  g.arc(X(MOUNTAIN.x), Z(MOUNTAIN.z), MOUNTAIN.r * S, 0, Math.PI * 2);
  g.fill();
  // Roads (outline first so they read on light city ground)
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const pass of [0, 1])
    for (const r of ALL_ROADS) {
      const [color, k] = ROAD_STYLE[r.kind];
      g.strokeStyle = pass === 0 ? 'rgba(40,40,40,0.55)' : color;
      g.lineWidth = Math.max(2.5, r.width * S * k) + (pass === 0 ? 3 : 0);
      g.beginPath();
      r.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
      if (r.closed) g.closePath();
      g.stroke();
    }
  return c;
}

/**
 * The land itself, coloured by region (green country, sandy desert…), one pixel per
 * 40 m over the whole map; drawn smoothed, under everything else.
 */
function drawLand(): HTMLCanvasElement {
  const M = 48;
  const w = Math.round((OUTER.x1 - OUTER.x0) / M), h = Math.round((OUTER.z1 - OUTER.z0) / M);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const at = (i: number, j: number) => [OUTER.x0 + (i + 0.5) * M, OUTER.z0 + (j + 0.5) * M] as const;
  // Heights only where the land is steep enough to need shading (mountains, the edge).
  const hs = new Float32Array(w * h);
  const shaded = new Uint8Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const [x, z] = at(i, j);
      if (mountainWeight(x, z) > 0.02 || hexDistance(x, z) > RING_APOTHEM + 150) {
        hs[j * w + i] = terrainBase(x, z);
        shaded[j * w + i] = 1;
      }
    }
  const FIELD: Record<FieldKind, number[]> = { wheat: [0xe6, 0xcd, 0x6c], crop: [0x8f, 0xc2, 0x5a], soil: [0xa0, 0x7a, 0x56], meadow: [0x86, 0xb9, 0x60], corn: [0x5f, 0x9a, 0x42] };
  const grass = [0x7f, 0xb3, 0x5d], sand = [0xe0, 0xb4, 0x78], forest = [0x4a, 0x8a, 0x3c], autumn = [0xd3, 0x8b, 0x3a], snow = [0xf3, 0xf6, 0xf9], rock = [0x8d, 0x91, 0x96];
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const [x, z] = at(i, j);
      const b = biomeAt(x, z);
      const col = grass.slice();
      const mix = (to: number[], k: number) => {
        for (let ch = 0; ch < 3; ch++) col[ch] += (to[ch] - col[ch]) * k;
      };
      mix(sand, b.desert);
      mix(forest, b.forest);
      mix(autumn, b.forest * b.autumn * 0.85);
      mix(FIELD[fieldKind(x, z)], b.farm * 0.65);
      let shade = 1;
      const k = j * w + i;
      if (shaded[k] && i > 0 && j > 0 && i < w - 1 && j < h - 1) {
        const gx = (hs[k + 1] - hs[k - 1]) / (2 * M), gz = (hs[k + w] - hs[k - w]) / (2 * M);
        // Lit from the north-west, like a relief map.
        shade = Math.max(0.55, Math.min(1.25, 1 + (gx + gz) * -0.9));
        mix(snow, b.mountain);
        mix(rock, b.mountain * Math.min(1, Math.max(0, (Math.hypot(gx, gz) - 0.8) * 2)));
      }
      for (let ch = 0; ch < 3; ch++) img.data[k * 4 + ch] = Math.min(255, col[ch] * shade);
      img.data[k * 4 + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** Highway country as paths in world metres (drawn under a transform at any zoom). */
function countryPaths() {
  const highways = new Path2D();
  for (const h of HIGHWAYS) h.pts.forEach(([x, z], i) => (i ? highways.lineTo(x, z) : highways.moveTo(x, z)));
  RING.pts.forEach(([x, z], i) => (i ? highways.lineTo(x, z) : highways.moveTo(x, z)));
  highways.closePath();
  const ramps = new Path2D();
  for (const r of [...RAMPS, ...TOWNS.flatMap((t) => t.roads)]) r.pts.forEach(([x, z], i) => (i ? ramps.lineTo(x, z) : ramps.moveTo(x, z)));
  // Washington DC: the city's ground, with the Mall's lawn down the middle.
  const city = new Path2D(), lawn = new Path2D();
  const rect = (p: Path2D, a0: number, b0: number, a1: number, b1: number) => {
    const c = [townPoint(DC, a0, b0), townPoint(DC, a1, b0), townPoint(DC, a1, b1), townPoint(DC, a0, b1)];
    c.forEach(([x, z], i) => (i ? p.lineTo(x, z) : p.moveTo(x, z)));
    p.closePath();
  };
  rect(city, DC_PLAN.x0 - 10, DC_PLAN.z0 - 10, DC_PLAN.x1 + 10, DC_PLAN.z1 + 10);
  rect(lawn, DC_PLAN.mall.x0, -DC_PLAN.mall.z, DC_PLAN.mall.x1, DC_PLAN.mall.z);
  rect(lawn, -230, DC_PLAN.z0, 0, -DC_PLAN.mall.z);
  rect(lawn, DC_PLAN.x0, DC_PLAN.mall.z, 0, DC_PLAN.z1);
  const lakes = new Path2D();
  for (const l of OUTER_LAKES) {
    lakes.moveTo(l.x + l.r, l.z);
    lakes.arc(l.x, l.z, l.r, 0, Math.PI * 2);
  }
  // Mountains beyond the Ring: everything outside a hexagon a little bigger than it.
  const hills = new Path2D();
  hills.rect(OUTER.x0 - 2000, OUTER.z0 - 2000, OUTER.x1 - OUTER.x0 + 4000, OUTER.z1 - OUTER.z0 + 4000);
  const angles = HEX.map(([nx, nz]) => Math.atan2(nz, nx)).sort((a, b) => b - a);
  const R = (RING_APOTHEM + 450) / Math.cos(Math.PI / 6);
  angles.forEach((a, i) => {
    const b = i + 1 < angles.length ? angles[i + 1] : angles[0] - 2 * Math.PI;
    const m = (a + b) / 2;
    if (i === 0) hills.moveTo(Math.cos(m) * R, Math.sin(m) * R);
    else hills.lineTo(Math.cos(m) * R, Math.sin(m) * R);
  });
  hills.closePath();
  return { highways, ramps, lakes, hills, city, lawn };
}

function arrow(g: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, fill: string) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.beginPath();
  g.moveTo(0, -size);
  g.lineTo(size * 0.7, size * 0.75);
  g.lineTo(0, size * 0.35);
  g.lineTo(-size * 0.7, size * 0.75);
  g.closePath();
  g.fillStyle = fill;
  g.strokeStyle = '#ffffff';
  g.lineWidth = Math.max(2, size * 0.18);
  g.fill();
  g.stroke();
  g.restore();
}

/** Pins closer than this to the car count as "you're there". */
const ARRIVED = 25;
/** Re-plan the way when the car is this far off it (a wrong turn)… */
const OFF_ROUTE = 35;
/** …or every so often anyway. */
const REPLAN_SECONDS = 5;

/** Distance from a point to a polyline. */
function distToPath(x: number, z: number, pts: Vec2[]) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return best;
}

/** Paint the map in world metres: the caller has set a transform (metres → screen). */
function paintWorld(g: CanvasRenderingContext2D, middle: HTMLCanvasElement, land: HTMLCanvasElement, paths: ReturnType<typeof countryPaths>, pxPerM: number) {
  g.fillStyle = GRASS;
  g.fillRect(OUTER.x0 - 2000, OUTER.z0 - 2000, OUTER.x1 - OUTER.x0 + 4000, OUTER.z1 - OUTER.z0 + 4000);
  g.imageSmoothingEnabled = true;
  g.drawImage(land, OUTER.x0, OUTER.z0, OUTER.x1 - OUTER.x0, OUTER.z1 - OUTER.z0);
  // The hills beyond the Ring (the land picture shades the mountains among them).
  g.fillStyle = 'rgba(110, 125, 90, 0.35)';
  g.fill(paths.hills, 'evenodd');
  g.drawImage(middle, WORLD.x0, WORLD.z0, WORLD.x1 - WORLD.x0, WORLD.z1 - WORLD.z0);
  g.fillStyle = '#d9d4c8';
  g.fill(paths.city);
  g.fillStyle = '#6fae52';
  g.fill(paths.lawn);
  g.fillStyle = '#4b93cf';
  g.fill(paths.lakes);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Roads at their real width, but never thinner than a few pixels.
  const w = (metres: number, minPx: number) => Math.max(metres, minPx / pxPerM);
  g.strokeStyle = 'rgba(40,40,40,0.55)';
  g.lineWidth = w(12, 3.5) + 3 / pxPerM;
  g.stroke(paths.ramps);
  g.lineWidth = w(30, 5) + 3 / pxPerM;
  g.stroke(paths.highways);
  g.strokeStyle = '#ffe48a';
  g.lineWidth = w(12, 3.5);
  g.stroke(paths.ramps);
  g.strokeStyle = '#ffd23f';
  g.lineWidth = w(30, 5);
  g.stroke(paths.highways);
}

/** The way as a bold blue line (world metres; caller's transform). */
function routeLine(g: CanvasRenderingContext2D, pts: Vec2[], widthM: number) {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
  g.strokeStyle = '#0b3d91';
  g.lineWidth = widthM * 1.6;
  g.stroke();
  g.strokeStyle = '#38a3ff';
  g.lineWidth = widthM;
  g.stroke();
}

export class Minimap {
  private middle = drawMiddle();
  private land = drawLand();
  private paths = countryPaths();
  private mini: HTMLCanvasElement;
  private big: HTMLCanvasElement;
  private overlay: HTMLElement;
  private hint: HTMLElement;
  private clearBtn: HTMLElement;
  private frame = 0;
  isOpen = false;
  /** Where the player wants to go (picked on the big map), and the way there by road. */
  private dest: Vec2 | null = null;
  private route: Route | null = null;
  private routeAge = 0;
  /** Time to get there, counting down under the mini-map (seconds shown, smoothed). */
  private eta: HTMLElement;
  private etaShown = -1;
  private etaText = '';
  /** The friend's car when playing together (shown like a destination, so you can drive to it). */
  private friend: Destination | null = null;
  /** Car pose (for the big map). */
  private car = { x: 0, z: 0, fx: 0, fz: 1 };
  /** Big map view: centre (world metres) and zoom (CSS px per metre). */
  private view = { x: 0, z: 0, zoom: 0.25 };
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { moved: number; start: number; pinch: number; zoom: number } | null = null;
  private drawQueued = false;

  constructor(root: HTMLElement, private readonly onToggle: (open: boolean) => void, private readonly onArrive: () => void = () => {}) {
    const wrap = document.createElement('div');
    wrap.className = 'minimap interactive';
    this.mini = document.createElement('canvas');
    wrap.appendChild(this.mini);
    root.appendChild(wrap);
    this.eta = document.createElement('div');
    this.eta.className = 'eta';
    root.appendChild(this.eta);
    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
      this.open(true);
    });

    // Big map: swipe to move, pinch (or ＋/−) to zoom, tap to drop a pin (tap again to
    // move it); Go! (or tapping outside the map) closes it.
    this.overlay = document.createElement('div');
    this.overlay.className = 'bigmap';
    const mapBox = document.createElement('div');
    mapBox.className = 'bigmap-box';
    this.big = document.createElement('canvas');
    const zoomBar = document.createElement('div');
    zoomBar.className = 'bigmap-zoom';
    const zoomBtn = (label: string, f: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        f();
      });
      zoomBar.appendChild(b);
    };
    zoomBtn('＋', () => this.zoomBy(1.6));
    zoomBtn('−', () => this.zoomBy(1 / 1.6));
    zoomBtn('📍 Me', () => {
      this.view.x = this.car.x;
      this.view.z = this.car.z;
      this.redraw();
    });
    mapBox.append(this.big, zoomBar);
    const side = document.createElement('div');
    side.className = 'bigmap-side';
    this.hint = document.createElement('div');
    this.hint.className = 'bigmap-hint';
    const go = document.createElement('button');
    go.className = 'big';
    go.textContent = '🚗 Go!';
    this.clearBtn = document.createElement('button');
    this.clearBtn.className = 'big gray';
    this.clearBtn.textContent = '✖ Clear';
    side.append(this.hint, go, this.clearBtn);
    this.overlay.append(mapBox, side);
    root.appendChild(this.overlay);
    this.overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      this.open(false);
    });
    mapBox.addEventListener('click', (e) => e.stopPropagation());
    side.addEventListener('click', (e) => e.stopPropagation());
    go.addEventListener('click', () => this.open(false));
    this.clearBtn.addEventListener('click', () => {
      this.setDest(null);
      this.redraw();
    });
    this.setupGestures();
    this.updateHint();
  }

  private setupGestures() {
    const c = this.big;
    c.style.touchAction = 'none';
    const local = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const spread = () => {
      const [a, b] = [...this.pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    c.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, local(e));
      if (this.pointers.size === 1) this.gesture = { moved: 0, start: performance.now(), pinch: 0, zoom: this.view.zoom };
      else if (this.pointers.size === 2 && this.gesture) (this.gesture.pinch = spread()), (this.gesture.zoom = this.view.zoom), (this.gesture.moved += 100);
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev || !this.gesture) return;
      const p = local(e);
      if (this.pointers.size === 1) {
        // Swipe: move the map with the finger.
        this.view.x -= (p.x - prev.x) / this.view.zoom;
        this.view.z -= (p.y - prev.y) / this.view.zoom;
        this.gesture.moved += Math.hypot(p.x - prev.x, p.y - prev.y);
      }
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2 && this.gesture.pinch > 0) {
        // Pinch: zoom about the middle of the two fingers.
        const [a, b] = [...this.pointers.values()];
        this.zoomAbout(this.gesture.zoom * (spread() / this.gesture.pinch) / this.view.zoom, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      this.redraw();
    });
    const end = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!p || !this.gesture || this.pointers.size > 0) return;
      // A quick tap that barely moved drops the pin.
      if (this.gesture.moved < 10 && performance.now() - this.gesture.start < 600) this.tapAt(p.x, p.y);
      this.gesture = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = { x: e.offsetX, y: e.offsetY };
      this.zoomAbout(Math.exp(-e.deltaY * 0.002), p.x, p.y);
      this.redraw();
    }, { passive: false });
  }

  /** The big map's size in CSS pixels. */
  private bigSize() {
    return { w: this.big.clientWidth || 300, h: this.big.clientHeight || 300 };
  }

  private toWorld(px: number, py: number) {
    const { w, h } = this.bigSize();
    return { x: this.view.x + (px - w / 2) / this.view.zoom, z: this.view.z + (py - h / 2) / this.view.zoom };
  }

  private clampView() {
    const { w, h } = this.bigSize();
    // From the whole map down to street level.
    const minZoom = Math.min(w / (OUTER.x1 - OUTER.x0), h / (OUTER.z1 - OUTER.z0));
    this.view.zoom = Math.max(minZoom, Math.min(2, this.view.zoom));
    this.view.x = Math.max(OUTER.x0, Math.min(OUTER.x1, this.view.x));
    this.view.z = Math.max(OUTER.z0, Math.min(OUTER.z1, this.view.z));
  }

  private zoomAbout(k: number, px: number, py: number) {
    const before = this.toWorld(px, py);
    this.view.zoom *= k;
    this.clampView();
    const after = this.toWorld(px, py);
    this.view.x += before.x - after.x;
    this.view.z += before.z - after.z;
    this.clampView();
  }

  private zoomBy(k: number) {
    const { w, h } = this.bigSize();
    this.zoomAbout(k, w / 2, h / 2);
    this.redraw();
  }

  private tapAt(px: number, py: number) {
    let { x, z } = this.toWorld(px, py);
    // A tap on (or right next to) a place's icon goes to that place.
    const snap = 26 / this.view.zoom;
    for (const d of this.places()) if (Math.hypot(d.x - x, d.z - z) < snap) (x = d.x), (z = d.z);
    this.setDest([x, z]);
    this.redraw();
  }

  private setDest(d: Vec2 | null) {
    this.dest = d;
    this.route = d ? findRoute(this.car.x, this.car.z, d[0], d[1]) : null;
    this.routeAge = 0;
    this.etaShown = -1;
    this.updateHint();
  }

  private updateHint() {
    this.hint.textContent = this.dest
      ? '📍 Tap again to move the pin. Swipe to look around, pinch to zoom.'
      : '📍 Tap the map to pick where to go. Swipe to look around, pinch to zoom.';
    this.clearBtn.style.display = this.dest ? '' : 'none';
  }

  open(on: boolean) {
    if (on === this.isOpen) return;
    this.isOpen = on;
    this.overlay.classList.toggle('on', on);
    this.onToggle(on);
  }

  /** Called with the car's pose when the big map opens: start centred on the car. */
  /** Where the friend's car is (null: not playing together, or their car isn't out). */
  setFriend(at: { x: number; z: number } | null) {
    if (!at) this.friend = null;
    else if (this.friend) (this.friend.x = at.x), (this.friend.z = at.z);
    else this.friend = { x: at.x, z: at.z, icon: '🚙', label: 'Friend' };
  }

  private places() {
    return this.friend ? [...DESTINATIONS, this.friend] : DESTINATIONS;
  }

  drawBig(x: number, z: number, fx: number, fz: number) {
    this.car = { x, z, fx, fz };
    this.view = { x, z, zoom: 0.3 };
    if (this.dest && !this.route) this.route = findRoute(x, z, this.dest[0], this.dest[1]);
    requestAnimationFrame(() => {
      this.clampView();
      this.paintBig();
    });
  }

  private redraw() {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.paintBig();
    });
  }

  private paintBig() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { w, h } = this.bigSize();
    if (this.big.width !== Math.round(w * dpr) || this.big.height !== Math.round(h * dpr)) {
      this.big.width = Math.round(w * dpr);
      this.big.height = Math.round(h * dpr);
    }
    const g = this.big.getContext('2d')!;
    const { x: cx, z: cz, zoom } = this.view;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(zoom, zoom);
    g.translate(-cx, -cz);
    paintWorld(g, this.middle, this.land, this.paths, zoom);
    if (this.route) routeLine(g, this.route, Math.max(8, 5 / zoom));
    g.restore();
    const X = (wx: number) => w / 2 + (wx - cx) * zoom, Z = (wz: number) => h / 2 + (wz - cz) * zoom;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const small = Math.min(w, h);
    // Highway names when zoomed in enough to read them.
    if (zoom > 0.12) {
      g.font = `bold ${Math.max(11, small * 0.026)}px -apple-system, Helvetica, sans-serif`;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.fillStyle = '#ffe9a0';
      for (const hw of HIGHWAYS)
        for (const t of [0.25, 0.5, 0.75]) {
          const p = pointAt(hw, hw.len * t);
          const lx = X(p.x), ly = Z(p.z);
          if (lx < 0 || lx > w || ly < 0 || ly > h) continue;
          g.strokeText(hw.name, lx, ly);
          g.fillText(hw.name, lx, ly);
        }
    }
    // Icons first, then the names: each tries below its icon, then above, right and left,
    // and is left off (until you zoom in) if it would cover another name or icon.
    const iconPx = Math.max(22, small * 0.07), textPx = Math.max(13, small * 0.035);
    const shown = this.places().filter((d) => {
      const dx = X(d.x), dy = Z(d.z);
      return dx > -60 && dx < w + 60 && dy > -60 && dy < h + 60;
    });
    g.font = `${iconPx}px sans-serif`;
    for (const d of shown) g.fillText(d.icon, X(d.x), Z(d.z));
    type Box = { x0: number; y0: number; x1: number; y1: number };
    const used: Box[] = shown.map((d) => ({ x0: X(d.x) - iconPx * 0.45, y0: Z(d.z) - iconPx * 0.45, x1: X(d.x) + iconPx * 0.45, y1: Z(d.z) + iconPx * 0.45 }));
    const hits = (b: Box) => used.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
    g.font = `bold ${textPx}px -apple-system, Helvetica, sans-serif`;
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.fillStyle = '#ffffff';
    // YOU (always shown, so it goes first) over the car.
    {
      const cx = X(this.car.x), cy = Z(this.car.z), yy = cy - Math.max(22, small * 0.06), tw = g.measureText('YOU').width + 6;
      g.strokeText('YOU', cx, yy);
      g.fillText('YOU', cx, yy);
      used.push({ x0: cx - tw / 2, y0: yy - textPx * 0.6, x1: cx + tw / 2, y1: yy + textPx * 0.6 }, { x0: cx - 14, y0: cy - 14, x1: cx + 14, y1: cy + 14 });
    }
    for (const d of shown) {
      const dx = X(d.x), dy = Z(d.z);
      const tw = g.measureText(d.label).width + 6, th = textPx * 1.15;
      const gap = iconPx * 0.55 + th / 2;
      const spots: [number, number][] = [[dx, dy + gap], [dx, dy - gap], [dx + iconPx * 0.55 + tw / 2, dy], [dx - iconPx * 0.55 - tw / 2, dy]];
      for (const [cx, cy] of spots) {
        const lx = Math.min(w - tw / 2, Math.max(tw / 2, cx));
        const box = { x0: lx - tw / 2, y0: cy - th / 2, x1: lx + tw / 2, y1: cy + th / 2 };
        if (hits(box)) continue;
        used.push(box);
        g.strokeText(d.label, lx, cy);
        g.fillText(d.label, lx, cy);
        break;
      }
    }
    const { x, z, fx, fz } = this.car;
    arrow(g, X(x), Z(z), Math.max(12, small * 0.04), Math.atan2(fx, -fz), '#1e88ff');
    if (this.dest) {
      // Pin with its point on the spot.
      g.font = `${Math.max(26, small * 0.075)}px sans-serif`;
      g.textBaseline = 'bottom';
      g.fillText('📍', X(this.dest[0]), Z(this.dest[1]) + Math.max(3, small * 0.008));
      g.textBaseline = 'middle';
    }
  }

  /**
   * The countdown: eases towards the estimate, so it ticks down smoothly while driving and
   * holds still when the car stops; a big change (a new pin, a new way) jumps straight there.
   */
  private updateEta(x: number, z: number, dt: number, topSpeed: number) {
    let text = '';
    if (this.dest && this.route) {
      const est = routeSeconds(this.route, x, z, topSpeed);
      if (this.etaShown < 0 || Math.abs(est - this.etaShown) > Math.max(15, est * 0.4)) this.etaShown = est;
      else this.etaShown += (est - this.etaShown) * Math.min(1, dt * 1.5);
      const secs = Math.max(1, Math.ceil(this.etaShown));
      text = `⏱ ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    }
    if (text === this.etaText) return;
    this.etaText = text;
    this.eta.textContent = text;
    this.eta.classList.toggle('on', !!text);
  }

  /** Mini-map: centred on the car, rotated so straight ahead is up. */
  update(x: number, z: number, fx: number, fz: number, dt = 1 / 60, topSpeed = 47) {
    this.car = { x, z, fx, fz };
    // Directions: re-plan after a wrong turn (or now and then), and stop on arrival.
    if (this.dest) {
      this.routeAge += dt;
      if (Math.hypot(this.dest[0] - x, this.dest[1] - z) < ARRIVED) {
        this.setDest(null);
        this.onArrive();
      } else if (!this.route || this.routeAge > REPLAN_SECONDS || (this.routeAge > 0.5 && distToPath(x, z, this.route.slice(1)) > OFF_ROUTE)) {
        this.routeAge = 0;
        this.route = findRoute(x, z, this.dest[0], this.dest[1]);
      }
    }
    this.updateEta(x, z, dt, topSpeed);
    if (this.isOpen || this.frame++ % 2) return;
    const cssSize = this.mini.clientWidth;
    if (!cssSize) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(cssSize * dpr);
    if (this.mini.width !== size) this.mini.width = this.mini.height = size;
    const g = this.mini.getContext('2d')!;
    const r = size / 2;
    const k = size / VIEW_METRES; // canvas px per metre
    const rot = -Math.PI / 2 - Math.atan2(fz, fx);
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.clip();
    g.translate(r, r);
    g.rotate(rot);
    g.scale(k, k);
    g.translate(-x, -z);
    g.imageSmoothingEnabled = true;
    paintWorld(g, this.middle, this.land, this.paths, k / dpr);
    if (this.route) {
      // From the car itself, then along the planned way.
      routeLine(g, [[x, z], ...this.route.slice(1)], (size * 0.045) / k);
    }
    g.restore();

    // Destinations: on the map if close, otherwise pinned to the rim pointing the way.
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const toScreen = (wx: number, wz: number) => {
      const dx = (wx - x) * k, dz = (wz - z) * k;
      return [r + dx * cos - dz * sin, r + dx * sin + dz * cos] as const;
    };
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const marks = this.dest ? [...this.places(), { x: this.dest[0], z: this.dest[1], icon: '📍', label: '' }] : this.places();
    for (const d of marks) {
      const [sx, sy] = toScreen(d.x, d.z);
      const vx = sx - r, vy = sy - r, dist = Math.hypot(vx, vy);
      const iconSize = size * 0.13;
      g.font = `${iconSize}px sans-serif`;
      if (dist < r - iconSize * 0.6) {
        g.fillText(d.icon, sx, sy);
      } else {
        const e = (r - iconSize * 0.62) / dist;
        const ex = r + vx * e, ey = r + vy * e;
        g.beginPath();
        g.arc(ex, ey, iconSize * 0.62, 0, Math.PI * 2);
        g.fillStyle = 'rgba(20,28,40,0.75)';
        g.fill();
        g.fillText(d.icon, ex, ey);
      }
    }
    // North marker on the rim (world north = -z)
    const nr = r - size * 0.07;
    const px = r + nr * Math.sin(rot), py = r - nr * Math.cos(rot);
    g.font = `bold ${size * 0.09}px sans-serif`;
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = size * 0.02;
    g.strokeText('N', px, py);
    g.fillText('N', px, py);
    // The car
    arrow(g, r, r, size * 0.07, 0, '#1e88ff');
  }
}
