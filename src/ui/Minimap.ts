// Round mini-map (heading-up, follows the car) + a full-screen world map (north-up).
// The map image is drawn once from the world layout; each frame just transforms it.
import {
  ALL_ROADS, BOSTON, BOSTON_COMMON, CENTRAL_PARK, DEMO_PARK, HARBOR_X, LOOP, NYC, RIVER, Road, TRACK, WORLD,
} from '../world/layout';

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

export class Minimap {
  private world = drawWorld();
  private mini: HTMLCanvasElement;
  private big: HTMLCanvasElement;
  private overlay: HTMLElement;
  private frame = 0;
  isOpen = false;

  constructor(root: HTMLElement, private readonly onToggle: (open: boolean) => void) {
    const wrap = document.createElement('div');
    wrap.className = 'minimap interactive';
    this.mini = document.createElement('canvas');
    wrap.appendChild(this.mini);
    root.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
      this.open(true);
    });

    this.overlay = document.createElement('div');
    this.overlay.className = 'bigmap';
    this.big = document.createElement('canvas');
    const hint = document.createElement('div');
    hint.className = 'bigmap-hint';
    hint.textContent = 'Tap anywhere to keep driving';
    this.overlay.append(this.big, hint);
    root.appendChild(this.overlay);
    this.overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      this.open(false);
    });
  }

  open(on: boolean) {
    if (on === this.isOpen) return;
    this.isOpen = on;
    this.overlay.classList.toggle('on', on);
    this.onToggle(on);
  }

  /** Mini-map: centred on the car, rotated so straight ahead is up. */
  update(x: number, z: number, fx: number, fz: number) {
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
    g.restore();

    // Destinations: on the map if close, otherwise pinned to the rim pointing the way.
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const toScreen = (wx: number, wz: number) => {
      const dx = (wx - x) * S * k, dz = (wz - z) * S * k;
      return [r + dx * cos - dz * sin, r + dx * sin + dz * cos] as const;
    };
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const d of DESTINATIONS) {
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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = window.innerWidth * 0.94, ch = window.innerHeight * 0.8;
    const scale = Math.min(cw / this.world.width, ch / this.world.height);
    const w = this.world.width * scale, h = this.world.height * scale;
    this.big.style.width = `${w}px`;
    this.big.style.height = `${h}px`;
    this.big.width = Math.round(w * dpr);
    this.big.height = Math.round(h * dpr);
    const g = this.big.getContext('2d')!;
    g.scale(dpr, dpr);
    g.drawImage(this.world, 0, 0, w, h);
    const X = (wx: number) => (wx - WORLD.x0) * S * scale, Z = (wz: number) => (wz - WORLD.z0) * S * scale;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const d of DESTINATIONS) {
      g.font = `${Math.max(22, h * 0.07)}px sans-serif`;
      g.fillText(d.icon, X(d.x), Z(d.z));
      g.font = `bold ${Math.max(13, h * 0.035)}px -apple-system, Helvetica, sans-serif`;
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      g.fillStyle = '#ffffff';
      g.strokeText(d.label, X(d.x), Z(d.z) + Math.max(20, h * 0.065));
      g.fillText(d.label, X(d.x), Z(d.z) + Math.max(20, h * 0.065));
    }
    g.font = `bold ${Math.max(13, h * 0.035)}px -apple-system, Helvetica, sans-serif`;
    g.fillStyle = '#ffffff';
    g.strokeText('YOU', X(x), Z(z) - Math.max(22, h * 0.06));
    g.fillText('YOU', X(x), Z(z) - Math.max(22, h * 0.06));
    arrow(g, X(x), Z(z), Math.max(12, h * 0.04), Math.atan2(fx, -fz), '#1e88ff');
  }
}
