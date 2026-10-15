import { describe, expect, it } from 'vitest';
import { CROSSINGS, HIGHWAYS, HW, OUTER_LAKES, RAMPS, RING, TOWERS, highwayCoords, profileAt, OVERPASS_RISE } from '../src/world/outer';
import { RING_APOTHEM, hexDistance } from '../src/world/bounds';

const BRONCO = 47; // m/s

describe('highway country', () => {
  it('has long highways: minutes of straight driving at Bronco speed', () => {
    const longest = Math.max(...HIGHWAYS.map((h) => h.len));
    expect(longest / BRONCO / 60).toBeGreaterThan(3);
  });

  it('crossings come about every 20 seconds along a highway', () => {
    const gaps: number[] = [];
    for (const h of HIGHWAYS) {
      const ss = CROSSINGS.filter((c) => c.upper === h.id || c.lower === h.id).map((c) => (c.upper === h.id ? c.sUpper : c.sLower)).sort((a, b) => a - b);
      for (let k = 1; k < ss.length; k++) gaps.push(ss[k] - ss[k - 1]);
    }
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length / BRONCO;
    expect(avg).toBeGreaterThan(14);
    expect(avg).toBeLessThan(28);
  });

  it('no highway is steeper than 12%', () => {
    for (const h of HIGHWAYS)
      for (let s = 0; s < h.len - 25; s += 25) expect(Math.abs(profileAt(h, s + 25) - profileAt(h, s)) / 25, `${h.name} at ${s}`).toBeLessThan(0.12);
  });

  it('at every crossing the upper highway clears the lower one', () => {
    for (const c of CROSSINGS) {
      const up = profileAt(HIGHWAYS[c.upper], c.sUpper), low = profileAt(HIGHWAYS[c.lower], c.sLower);
      expect(up - low).toBeGreaterThan(OVERPASS_RISE - 0.5);
    }
  });

  it('every highway ends on the Ring (spurs start at a city)', () => {
    for (const h of HIGHWAYS) {
      const ends = h.spur ? [h.len] : [0, h.len];
      for (const s of ends) {
        const x = h.ax + h.ux * s, z = h.az + h.uz * s;
        const toRing = Math.min(...RING.pts.map(([px, pz]) => Math.hypot(px - x, pz - z)));
        expect(toRing, `${h.name} end`).toBeLessThan(30);
      }
    }
    expect(Math.max(...RING.pts.map(([x, z]) => hexDistance(x, z)))).toBeLessThanOrEqual(RING_APOTHEM + 1);
  });

  it('most interchanges have ramps, and no ramp runs into a third highway', () => {
    expect(RAMPS.length).toBeGreaterThan(CROSSINGS.length * 2.5);
    for (const r of RAMPS)
      for (const [x, z] of r.pts.slice(2, -2))
        for (const h of HIGHWAYS) {
          if (h.id === r.from || h.id === r.to) continue;
          const q = highwayCoords(h, x, z);
          expect(Math.abs(q.d) < HW + 6 && q.s > 0 && q.s < h.len).toBe(false);
        }
  });

  it('has lakes and radio towers', () => {
    expect(OUTER_LAKES.length).toBeGreaterThan(6);
    expect(TOWERS.length).toBeGreaterThan(30);
  });
});
