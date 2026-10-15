// All textures are drawn at startup on small canvases — nothing to download or license.
import * as THREE from 'three';
import { mulberry32 } from './math';

const cache = new Map<string, THREE.Texture>();

function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = true, h = size) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

function speckle(g: CanvasRenderingContext2D, s: number, seed: number, colors: string[], n: number, size: [number, number]) {
  const r = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    const w = size[0] + r() * (size[1] - size[0]);
    g.fillRect(r() * s, r() * s, w, w);
  }
}

/** Spider-web cracks. `frosted` adds a faint white haze (for cracked glass). */
export const crackTexture = (frosted = true) =>
  canvasTex(`crack-${frosted}`, 256, (g, s) => {
    g.clearRect(0, 0, s, s);
    if (frosted) {
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(0, 0, s, s);
    }
    const r = mulberry32(7);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      const cx = s * (0.25 + r() * 0.5), cy = s * (0.25 + r() * 0.5);
      for (let i = 0; i < 11; i++) {
        let x = cx, y = cy;
        const a = (i / 11) * Math.PI * 2 + r() * 0.4;
        g.beginPath();
        g.moveTo(x, y);
        for (let j = 0; j < 6; j++) {
          x += Math.cos(a + (r() - 0.5) * 0.8) * s * 0.07;
          y += Math.sin(a + (r() - 0.5) * 0.8) * s * 0.07;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      for (let ring = 1; ring <= 3; ring++) {
        g.beginPath();
        g.arc(cx, cy, ring * s * 0.08 + r() * 6, 0, Math.PI * 2);
        g.stroke();
      }
    }
  });

export const grassTexture = () =>
  canvasTex('grass', 256, (g, s) => {
    g.fillStyle = '#6aa84f';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 1, ['#5e9b45', '#76b85a', '#629f48', '#80c060'], 2500, [2, 5]);
  });

export const dirtTexture = () =>
  canvasTex('dirt', 256, (g, s) => {
    g.fillStyle = '#a07850';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 2, ['#936c46', '#ad845a', '#8a6340', '#b8916a'], 3000, [2, 6]);
  });

export const sandTexture = () =>
  canvasTex('sand', 128, (g, s) => {
    g.fillStyle = '#d8c48f';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 3, ['#cdb983', '#e2cf9c', '#c7b27a'], 900, [1, 3]);
  });

export const concreteTexture = () =>
  canvasTex('concrete', 256, (g, s) => {
    g.fillStyle = '#b4b4ae';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 4, ['#aaa9a3', '#bdbcb6', '#a3a29c'], 1800, [1, 4]);
    g.strokeStyle = '#9c9b95';
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(0, (i * s) / 4); g.lineTo(s, (i * s) / 4); g.stroke();
      g.beginPath(); g.moveTo((i * s) / 4, 0); g.lineTo((i * s) / 4, s); g.stroke();
    }
  });

/**
 * Road texture: u runs across the road (0..1), v along it (repeats every 16 m).
 * Lane markings are drawn for `lanes` lanes (0 = none, e.g. dirt).
 */
/**
 * Lane markings and tyre wear for a road. With `overlay`, only those on a see-through
 * background (the asphalt itself comes from a photo, see roadMaterial.ts).
 */
export const roadTexture = (lanes: number, highway = false, overlay = false) =>
  canvasTex(`road-${lanes}-${highway}-${overlay}`, 512, (g, s) => {
    if (!overlay) {
      g.fillStyle = '#4a4c51';
      g.fillRect(0, 0, s, s);
      speckle(g, s, 5, ['#45474b', '#54565b', '#3e4044', '#5c5e63'], 9000, [1, 3]);
    }
    // tire wear in each lane + a few patch repairs
    const r = mulberry32(lanes * 31);
    for (let i = 0; i < Math.max(lanes, 2); i++) {
      const cx = ((i + 0.5) / Math.max(lanes, 2)) * s;
      g.fillStyle = 'rgba(25,25,28,0.18)';
      g.fillRect(cx - s * 0.06, 0, s * 0.025, s);
      g.fillRect(cx + s * 0.035, 0, s * 0.025, s);
    }
    for (let i = 0; i < 3; i++) {
      g.fillStyle = 'rgba(30,30,33,0.35)';
      g.fillRect(r() * s * 0.8, r() * s * 0.8, 20 + r() * 50, 20 + r() * 60);
    }
    if (lanes === 0) return;
    const edge = highway ? 0.07 : 0.04;
    g.fillStyle = '#ececec';
    g.fillRect(s * edge, 0, 7, s);
    g.fillRect(s * (1 - edge) - 7, 0, 7, s);
    for (let i = 1; i < lanes; i++) {
      const x = s * (edge + ((1 - 2 * edge) * i) / lanes);
      if (i === lanes / 2) {
        g.fillStyle = '#e8b923';
        g.fillRect(x - 8, 0, 6, s);
        g.fillRect(x + 2, 0, 6, s);
      } else {
        g.fillStyle = '#ececec';
        g.fillRect(x - 3, 0, 6, s * 0.45);
      }
    }
  });

export const dirtRoadTexture = () =>
  canvasTex('dirt-road', 256, (g, s) => {
    g.fillStyle = '#8f6a45';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 6, ['#805d3b', '#9c7650', '#74522f', '#a98260'], 3500, [2, 7]);
    g.fillStyle = 'rgba(60,40,20,0.25)';
    g.fillRect(s * 0.25, 0, s * 0.1, s);
    g.fillRect(s * 0.65, 0, s * 0.1, s);
  });

export type WindowStyle = 'brick' | 'brownstone' | 'glass' | 'concrete' | 'stone' | 'pru';

const WALLS: Record<WindowStyle, string> = {
  brick: '#9a4a36', brownstone: '#7b4c3a', glass: '#4f6f8f', concrete: '#bdb8ae', stone: '#cdbf9c', pru: '#2d2c2a',
};

/** Building facade: one repeat = 4 windows × 4 floors (16 m × 14 m). */
export const windowTexture = (style: WindowStyle) =>
  canvasTex(`win-${style}`, 512, (g, s) => {
    const wall = WALLS[style];
    g.fillStyle = wall;
    g.fillRect(0, 0, s, s);
    const r = mulberry32(style.length * 13 + 7);
    if (style === 'brick' || style === 'brownstone') {
      // Brick courses
      for (let y = 0; y < s; y += 6) {
        g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.05})`;
        g.fillRect(0, y, s, 1);
        for (let x = (y / 6) % 2 ? 0 : 7; x < s; x += 14) g.fillRect(x, y, 1, 6);
      }
      speckle(g, s, 8, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.05)', 'rgba(120,40,20,0.12)'], 2500, [2, 5]);
    } else if (style !== 'glass') {
      speckle(g, s, 8, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.06)'], 1800, [2, 6]);
    }
    if (style === 'pru') {
      // Prudential Tower: dark curtain of small, evenly spaced pale windows.
      const cw = s / 8, ch = s / 4;
      for (let fy = 0; fy < 4; fy++)
        for (let fx = 0; fx < 8; fx++) {
          const lit = r() < 0.12;
          g.fillStyle = lit ? '#ddd6bd' : '#a9afb5';
          g.fillRect(fx * cw + cw * 0.32, fy * ch + ch * 0.32, cw * 0.36, ch * 0.38);
          g.fillStyle = 'rgba(255,255,255,0.25)';
          g.fillRect(fx * cw + cw * 0.3, fy * ch + ch * 0.3, cw * 0.4, ch * 0.08);
        }
      g.fillStyle = wall;
      g.fillRect(0, 0, 8, 8);
      return;
    }
    const cell = s / 4;
    for (let fy = 0; fy < 4; fy++) {
      // Floor ledge
      if (style !== 'glass') {
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(0, fy * cell + cell - 6, s, 4);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(0, fy * cell + cell - 2, s, 2);
      }
      for (let fx = 0; fx < 4; fx++) {
        const lit = r() < 0.25;
        const x0 = fx * cell, y0 = fy * cell;
        if (style === 'glass') {
          // Curtain wall: mostly uniform panes with a subtle sky gradient and dark spandrels.
          const grd = g.createLinearGradient(x0, y0, x0, y0 + cell);
          grd.addColorStop(0, '#7f9fbd');
          grd.addColorStop(1, '#4a6987');
          g.fillStyle = grd;
          g.fillRect(x0 + 2, y0 + 2, cell - 4, cell - 18);
          if (lit && r() < 0.3) {
            g.fillStyle = 'rgba(255,235,190,0.25)';
            g.fillRect(x0 + 2, y0 + 2, cell - 4, cell - 18);
          }
          g.fillStyle = '#2c3d4f';
          g.fillRect(x0, y0 + cell - 16, cell, 16);
          g.fillStyle = '#9fb0c0';
          g.fillRect(x0, y0, 2, cell);
        } else {
          const wx = cell * 0.24, wy = cell * 0.2, ww = cell - 2 * wx, wh = cell - 2 * wy - 6;
          // frame + sill
          g.fillStyle = style === 'concrete' ? '#8d8a84' : '#efe9dd';
          g.fillRect(x0 + wx - 4, y0 + wy - 4, ww + 8, wh + 8);
          g.fillRect(x0 + wx - 7, y0 + wy + wh + 3, ww + 14, 5);
          const grd = g.createLinearGradient(x0, y0 + wy, x0, y0 + wy + wh);
          grd.addColorStop(0, lit ? '#fbe9b0' : '#3f5466');
          grd.addColorStop(1, lit ? '#e9c77a' : '#1e2a36');
          g.fillStyle = grd;
          g.fillRect(x0 + wx, y0 + wy, ww, wh);
          // mullions + reflection
          g.fillStyle = style === 'concrete' ? '#8d8a84' : '#efe9dd';
          g.fillRect(x0 + wx + ww / 2 - 1.5, y0 + wy, 3, wh);
          g.fillRect(x0 + wx, y0 + wy + wh * 0.45, ww, 3);
          g.fillStyle = 'rgba(255,255,255,0.18)';
          g.beginPath();
          g.moveTo(x0 + wx, y0 + wy + wh * 0.4);
          g.lineTo(x0 + wx + ww * 0.4, y0 + wy);
          g.lineTo(x0 + wx + ww * 0.6, y0 + wy);
          g.lineTo(x0 + wx, y0 + wy + wh * 0.65);
          g.fill();
        }
      }
    }
    // Keep the top-left corner plain wall colour (roofs sample it).
    g.fillStyle = wall;
    g.fillRect(0, 0, 8, 8);
  });

/** Ground-floor shopfronts with coloured awnings (u repeats every 8 m, v = 0..1 over 4.2 m). */
export const storefrontTexture = () =>
  canvasTex('store', 512, (g, s) => {
    const r = mulberry32(42);
    g.fillStyle = '#3b3430';
    g.fillRect(0, 0, s, s);
    const awnings = ['#c0392b', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400'];
    for (let i = 0; i < 2; i++) {
      const x0 = (i * s) / 2;
      // window
      const grd = g.createLinearGradient(0, s * 0.35, 0, s);
      grd.addColorStop(0, '#9fc1d6');
      grd.addColorStop(1, '#41596b');
      g.fillStyle = grd;
      g.fillRect(x0 + 18, s * 0.38, s / 2 - 36, s * 0.52);
      g.fillStyle = 'rgba(255,240,200,0.35)';
      g.fillRect(x0 + 30, s * 0.55, s / 2 - 60, s * 0.3);
      // awning stripes
      const c = awnings[Math.floor(r() * awnings.length)];
      for (let k = 0; k < 8; k++) {
        g.fillStyle = k % 2 ? c : '#f4f1ea';
        g.fillRect(x0 + 10 + (k * (s / 2 - 20)) / 8, s * 0.12, (s / 2 - 20) / 8, s * 0.18);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x0 + 10, s * 0.3, s / 2 - 20, 6);
      // sign band
      g.fillStyle = '#222';
      g.fillRect(x0 + 10, s * 0.02, s / 2 - 20, s * 0.08);
    }
  });

export const particleTexture = () =>
  canvasTex(
    'particle',
    64,
    (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.6)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
    },
    false,
  );

export const boostTexture = () =>
  canvasTex('boost', 128, (g, s) => {
    g.fillStyle = '#ff7a00';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#ffe14d';
    for (let i = 0; i < 3; i++) {
      const y = (i * s) / 3;
      g.beginPath();
      g.moveTo(s * 0.15, y + s * 0.3);
      g.lineTo(s * 0.5, y + s * 0.05);
      g.lineTo(s * 0.85, y + s * 0.3);
      g.lineTo(s * 0.85, y + s * 0.18);
      g.lineTo(s * 0.5, y - s * 0.07);
      g.lineTo(s * 0.15, y + s * 0.18);
      g.fill();
    }
  });

export const crateTexture = () =>
  canvasTex('crate', 128, (g, s) => {
    g.fillStyle = '#b5824a';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#7d5428';
    g.lineWidth = 10;
    g.strokeRect(5, 5, s - 10, s - 10);
    g.beginPath(); g.moveTo(5, 5); g.lineTo(s - 5, s - 5); g.stroke();
    g.lineWidth = 2;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, (i * s) / 4); g.lineTo(s, (i * s) / 4); g.stroke(); }
  });

/** Big bright billboard panels (NYC "Times Square"). */
export const billboardTexture = (seed: number) =>
  canvasTex(
    `bill-${seed}`,
    128,
    (g, s) => {
      const r = mulberry32(seed);
      const hues = [0, 30, 50, 120, 190, 280, 320];
      g.fillStyle = `hsl(${hues[Math.floor(r() * hues.length)]},90%,55%)`;
      g.fillRect(0, 0, s, s / 2);
      g.fillStyle = `hsl(${hues[Math.floor(r() * hues.length)]},95%,70%)`;
      for (let i = 0; i < 4; i++) g.fillRect(r() * s * 0.7, r() * s * 0.35, s * 0.3, s * 0.08);
      g.beginPath();
      g.arc(s * (0.2 + r() * 0.6), s * 0.25, s * 0.1, 0, Math.PI * 2);
      g.fill();
    },
    false,
    64,
  );

/** Neutral light speckle; terrain vertex colours provide the actual hue. */
export const groundTexture = () =>
  canvasTex('ground', 512, (g, s) => {
    g.fillStyle = '#e6e6e6';
    g.fillRect(0, 0, s, s);
    // soft blotches + fine blades
    const r = mulberry32(9);
    for (let i = 0; i < 60; i++) {
      const x = r() * s, y = r() * s, rad = 20 + r() * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      const v = r() < 0.5 ? '255,255,255' : '190,190,190';
      grd.addColorStop(0, `rgba(${v},0.25)`);
      grd.addColorStop(1, `rgba(${v},0)`);
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    speckle(g, s, 9, ['#cfcfcf', '#f6f6f6', '#c4c4c4', '#ffffff', '#d9d9d9'], 14000, [1, 3]);
  });

export const sidewalkTexture = () =>
  canvasTex('sidewalk', 256, (g, s) => {
    g.fillStyle = '#c4c1ba';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 12, ['#bbb8b1', '#ccc9c2', '#b3b0a9'], 2500, [1, 3]);
    g.strokeStyle = '#a5a29b';
    g.lineWidth = 3;
    for (let i = 0; i <= 2; i++) {
      g.beginPath(); g.moveTo(0, (i * s) / 2); g.lineTo(s, (i * s) / 2); g.stroke();
    }
    // curb edge (u = 0 side)
    g.fillStyle = '#d8d5ce';
    g.fillRect(0, 0, 14, s);
  });

/**
 * Wall damage decals, 512px, transparent background.
 * stage 0 = cracks, 1 = heavy cracks + chipped chunks, 2 = smashed hole.
 * `glass` draws a shattered-pane look instead.
 */
export const wallDamageTexture = (stage: 0 | 1 | 2, glass: boolean) =>
  canvasTex(
    `wall-dmg-${stage}-${glass}`,
    512,
    (g, s) => {
      g.clearRect(0, 0, s, s);
      const r = mulberry32(31 + stage * 7 + (glass ? 100 : 0));
      const c = s / 2;
      const crack = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(x, y);
        let a = ang;
        for (let d = 0; d < len; d += 10) {
          a += (r() - 0.5) * 0.6;
          x += Math.cos(a) * 10;
          y += Math.sin(a) * 10;
          g.lineTo(x, y);
          if (depth > 0 && r() < 0.12) {
            g.stroke();
            crack(x, y, a + (r() < 0.5 ? 0.8 : -0.8), len * 0.4, Math.max(1, w * 0.6), depth - 1);
            g.lineWidth = w;
            g.beginPath();
            g.moveTo(x, y);
          }
        }
        g.stroke();
      };
      const holeR = stage === 2 ? s * 0.2 : stage === 1 ? s * 0.07 : 0;
      if (glass) {
        // Shattered pane: frosted area, radial + ring cracks, a hole in the middle when smashed.
        const grd = g.createRadialGradient(c, c, 0, c, c, s / 2);
        grd.addColorStop(0, 'rgba(235,245,255,0.75)');
        grd.addColorStop(0.6, 'rgba(220,235,250,0.35)');
        grd.addColorStop(1, 'rgba(220,235,250,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, s, s);
        g.strokeStyle = 'rgba(255,255,255,0.95)';
        const spokes = 14 + stage * 6;
        for (let i = 0; i < spokes; i++) crack(c, c, (i / spokes) * Math.PI * 2, s * (0.3 + stage * 0.08), 2.5, 1);
        for (let k = 1; k <= 3 + stage; k++) {
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(c, c, k * s * 0.06 + r() * 8, 0, Math.PI * 2);
          g.stroke();
        }
      } else {
        g.strokeStyle = 'rgba(25,22,20,0.95)';
        const n = 7 + stage * 5;
        for (let i = 0; i < n; i++) crack(c, c, (i / n) * Math.PI * 2 + r() * 0.4, s * (0.22 + stage * 0.1), 4 + stage, 2);
        if (stage >= 1) {
          // Chipped-off chunks showing darker material underneath
          for (let i = 0; i < 10 + stage * 8; i++) {
            const a = r() * Math.PI * 2, d = holeR + r() * s * 0.18;
            g.fillStyle = `rgba(${60 + r() * 40},${55 + r() * 35},${50 + r() * 30},0.9)`;
            g.beginPath();
            const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d, k = 6 + r() * 16;
            g.moveTo(x, y);
            for (let j = 0; j < 5; j++) g.lineTo(x + (r() - 0.5) * k * 2, y + (r() - 0.5) * k * 2);
            g.fill();
          }
        }
      }
      if (holeR > 0) {
        // Jagged hole: dark interior with a lighter broken rim.
        g.beginPath();
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2, rr = holeR * (0.75 + r() * 0.45);
          const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.closePath();
        g.fillStyle = glass ? 'rgba(20,28,38,0.95)' : 'rgba(18,16,15,0.97)';
        g.fill();
        g.lineWidth = 6;
        g.strokeStyle = glass ? 'rgba(255,255,255,0.9)' : 'rgba(150,140,130,0.9)';
        g.stroke();
      }
    },
    false,
  );
