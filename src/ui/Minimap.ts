// Round mini-map (heading-up, follows the car) + a full-screen world map (north-up).
// The map image is drawn once from the world layout; each frame just transforms it.
import {
  ALL_ROADS, BOSTON, BOSTON_COMMON, CENTRAL_PARK, DEMO_PARK, HARBOR_X, LAKE, LOOP, MOUNTAIN, NYC, RIVER, Road, TRACK, WORLD,
} from '../world/layout';
import { findRoute } from '../world/route';
import type { Vec2 } from '../util/math';

const S = 0.5; // map pixels per metre
const VIEW_METRES = 560; // width of world shown in the mini-map

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
];

const ROAD_STYLE: Record<Road['kind'], [string, number]> = {
  highway: ['#ffd23f', 1],
  avenue: ['#ffffff', 0.9],
  street: ['#f4f4f4', 0.9],
  ramp: ['#ffe48a', 1],
  dirt: ['#a8743f', 1],
};

function drawWorld(): HTMLCanvasElement {
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
  g.fillStyle = '#7fb35d';
  g.fillRect(0, 0, w, h);
  rect(BOSTON, '#c8c3b8');
  rect(NYC, '#c3c3c6');
  rect(BOSTON_COMMON, '#6fae52');
  rect(CENTRAL_PARK, '#6fae52');
  rect(DEMO_PARK, '#c9a674');
  // Water: river and harbour
  g.fillStyle = '#4b93cf';
  const rw = RIVER.halfWidth + RIVER.bank * 0.5;
  g.fillRect(X(HARBOR_X), Z(RIVER.z - rw), (RIVER.x1 - HARBOR_X) * S, rw * 2 * S);
  g.fillRect(0, 0, X(HARBOR_X + 6), h);
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

/** Stroke a route (world points) as a bold blue line with a dark edge, `w` = line width. */
function routeLine(g: CanvasRenderingContext2D, pts: Vec2[], toX: (x: number) => number, toZ: (z: number) => number, w: number) {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  pts.forEach(([x, z], i) => (i ? g.lineTo(toX(x), toZ(z)) : g.moveTo(toX(x), toZ(z))));
  g.strokeStyle = '#0b3d91';
  g.lineWidth = w * 1.6;
  g.stroke();
  g.strokeStyle = '#38a3ff';
  g.lineWidth = w;
  g.stroke();
}

export class Minimap {
  private world = drawWorld();
  private mini: HTMLCanvasElement;
  private big: HTMLCanvasElement;
  private overlay: HTMLElement;
  private hint: HTMLElement;
  private clearBtn: HTMLElement;
  private frame = 0;
  isOpen = false;
  /** Where the player wants to go (picked on the big map), and the way there by road. */
  private dest: Vec2 | null = null;
  private route: Vec2[] | null = null;
  private routeAge = 0;
  /** Car pose when the big map was drawn (for redrawing after a tap). */
  private bigCar = { x: 0, z: 0, fx: 0, fz: 1 };
  private bigScale = 1;

  constructor(root: HTMLElement, private readonly onToggle: (open: boolean) => void, private readonly onArrive: () => void = () => {}) {
    const wrap = document.createElement('div');
    wrap.className = 'minimap interactive';
    this.mini = document.createElement('canvas');
    wrap.appendChild(this.mini);
    root.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
      this.open(true);
    });

    // Big map: tap it to drop a pin (tap again to move it); Go! (or tapping outside) closes it.
    this.overlay = document.createElement('div');
    this.overlay.className = 'bigmap';
    this.big = document.createElement('canvas');
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
    this.overlay.append(this.big, side);
    root.appendChild(this.overlay);
    this.overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      this.open(false);
    });
    side.addEventListener('click', (e) => e.stopPropagation());
    go.addEventListener('click', () => this.open(false));
    this.clearBtn.addEventListener('click', () => {
      this.setDest(null);
      this.redrawBig();
    });
    this.big.addEventListener('click', (e) => {
      e.stopPropagation();
      const s = S * this.bigScale;
      let wx = WORLD.x0 + e.offsetX / s, wz = WORLD.z0 + e.offsetY / s;
      // A tap on (or right next to) a place's icon goes to that place.
      const snap = Math.max(30, 26 / s);
      for (const d of DESTINATIONS) if (Math.hypot(d.x - wx, d.z - wz) < snap) (wx = d.x), (wz = d.z);
      this.setDest([wx, wz]);
      this.redrawBig();
    });
    this.updateHint();
  }

  private setDest(d: Vec2 | null) {
    this.dest = d;
    this.route = d ? findRoute(this.bigCar.x, this.bigCar.z, d[0], d[1]) : null;
    this.routeAge = 0;
    this.updateHint();
  }

  private updateHint() {
    this.hint.textContent = this.dest ? '📍 Tap the map again to move the pin' : '📍 Tap the map to pick where to go';
    this.clearBtn.style.display = this.dest ? '' : 'none';
  }

  private redrawBig() {
    const c = this.bigCar;
    this.drawBig(c.x, c.z, c.fx, c.fz);
  }

  open(on: boolean) {
    if (on === this.isOpen) return;
    this.isOpen = on;
    this.overlay.classList.toggle('on', on);
    this.onToggle(on);
  }

  /** Mini-map: centred on the car, rotated so straight ahead is up. */
  update(x: number, z: number, fx: number, fz: number, dt = 1 / 60) {
    // Directions: re-plan now and then (so a wrong turn gets a new way), and stop on arrival.
    if (this.dest) {
      if (Math.hypot(this.dest[0] - x, this.dest[1] - z) < ARRIVED) {
        this.setDest(null);
        this.onArrive();
      } else if ((this.routeAge += dt) > 0.6) {
        this.routeAge = 0;
        this.route = findRoute(x, z, this.dest[0], this.dest[1]);
      }
    }
    if (this.isOpen || this.frame++ % 2) return;
    const cssSize = this.mini.clientWidth;
    if (!cssSize) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(cssSize * dpr);
    if (this.mini.width !== size) this.mini.width = this.mini.height = size;
    const g = this.mini.getContext('2d')!;
    const r = size / 2;
    const k = size / (VIEW_METRES * S); // canvas px per map px
    const rot = -Math.PI / 2 - Math.atan2(fz, fx);
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#7fb35d';
    g.fillRect(0, 0, size, size);
    g.translate(r, r);
    g.rotate(rot);
    g.scale(k, k);
    g.translate(-(x - WORLD.x0) * S, -(z - WORLD.z0) * S);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.world, 0, 0);
    if (this.route) {
      // From the car itself, then along the planned way.
      const pts: Vec2[] = [[x, z], ...this.route.slice(1)];
      routeLine(g, pts, (wx) => (wx - WORLD.x0) * S, (wz) => (wz - WORLD.z0) * S, (size * 0.045) / k);
    }
    g.restore();

    // Destinations: on the map if close, otherwise pinned to the rim pointing the way.
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const toScreen = (wx: number, wz: number) => {
      const dx = (wx - x) * S * k, dz = (wz - z) * S * k;
      return [r + dx * cos - dz * sin, r + dx * sin + dz * cos] as const;
    };
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const marks = this.dest ? [...DESTINATIONS, { x: this.dest[0], z: this.dest[1], icon: '📍', label: '' }] : DESTINATIONS;
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

  /** Full world map (north up) with labels; drawn when opened. */
  drawBig(x: number, z: number, fx: number, fz: number) {
    this.bigCar = { x, z, fx, fz };
    if (this.dest && !this.route) this.route = findRoute(x, z, this.dest[0], this.dest[1]);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Leave room beside the map (landscape) for the hint and buttons.
    const cw = window.innerWidth * 0.94 - Math.min(300, window.innerWidth * 0.3), ch = window.innerHeight * 0.9;
    const scale = Math.min(cw / this.world.width, ch / this.world.height);
    this.bigScale = scale;
    const w = this.world.width * scale, h = this.world.height * scale;
    this.big.style.width = `${w}px`;
    this.big.style.height = `${h}px`;
    this.big.width = Math.round(w * dpr);
    this.big.height = Math.round(h * dpr);
    const g = this.big.getContext('2d')!;
    g.scale(dpr, dpr);
    g.drawImage(this.world, 0, 0, w, h);
    const X = (wx: number) => (wx - WORLD.x0) * S * scale, Z = (wz: number) => (wz - WORLD.z0) * S * scale;
    if (this.route) routeLine(g, this.route, X, Z, Math.max(3, h * 0.012));
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const d of DESTINATIONS) {
      g.font = `${Math.max(22, h * 0.07)}px sans-serif`;
      g.fillText(d.icon, X(d.x), Z(d.z));
      g.font = `bold ${Math.max(13, h * 0.035)}px -apple-system, Helvetica, sans-serif`;
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      g.fillStyle = '#ffffff';
      // Keep labels inside the map (Thunder Mountain is near the edge).
      const half = g.measureText(d.label).width / 2 + 4;
      const lx = Math.min(w - half, Math.max(half, X(d.x)));
      g.strokeText(d.label, lx, Z(d.z) + Math.max(20, h * 0.065));
      g.fillText(d.label, lx, Z(d.z) + Math.max(20, h * 0.065));
    }
    g.font = `bold ${Math.max(13, h * 0.035)}px -apple-system, Helvetica, sans-serif`;
    g.fillStyle = '#ffffff';
    g.strokeText('YOU', X(x), Z(z) - Math.max(22, h * 0.06));
    g.fillText('YOU', X(x), Z(z) - Math.max(22, h * 0.06));
    arrow(g, X(x), Z(z), Math.max(12, h * 0.04), Math.atan2(fx, -fz), '#1e88ff');
    if (this.dest) {
      // Pin with its point on the spot.
      g.font = `${Math.max(26, h * 0.075)}px sans-serif`;
      g.textBaseline = 'bottom';
      g.fillText('📍', X(this.dest[0]), Z(this.dest[1]) + Math.max(3, h * 0.008));
      g.textBaseline = 'middle';
    }
  }
}
