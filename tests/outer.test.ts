import { describe, expect, it } from 'vitest';
import { CROSSINGS, HIGHWAYS, HW, OUTER_LAKES, RAMPS, RING, TOWERS, TOWN, highwayCoords, outerRoadAt, pointAt, profileAt, tightestRadius, OVERPASS_RISE } from '../src/world/outer';
import { RING_APOTHEM, hexDistance } from '../src/world/bounds';
import { biomeAt } from '../src/world/biomes';
import { heightAt, surfaceAt } from '../src/world/layout';

const BRONCO = 47; // m/s

describe('highway country', () => {
  it('has long highways: minutes of straight driving at Bronco speed', () => {
    const longest = Math.max(...HIGHWAYS.map((h) => h.len));
    expect(longest / BRONCO / 60).toBeGreaterThan(3);
  });

  it('interchanges are spread out, with long stretches between them', () => {
    const gaps: number[] = [];
    for (const h of HIGHWAYS) {
      const ss = CROSSINGS.filter((c) => c.upper === h.id || c.lower === h.id).map((c) => (c.upper === h.id ? c.sUpper : c.sLower)).sort((a, b) => a - b);
      for (let k = 1; k < ss.length; k++) gaps.push(ss[k] - ss[k - 1]);
    }
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length / BRONCO;
    expect(avg).toBeGreaterThan(14);
    expect(avg).toBeLessThan(70);
    let closest = Infinity;
    for (const a of CROSSINGS) for (const b of CROSSINGS) if (a !== b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
    expect(closest).toBeGreaterThan(600);
  });

  it('highways curve, but never tighter than a gentle highway bend', () => {
    let curvy = 0;
    for (const h of HIGHWAYS) {
      expect(tightestRadius(h.pts), h.name).toBeGreaterThan(220);
      // How far it strays from the straight line between its ends.
      const [a, b] = [h.pts[0], h.pts[h.pts.length - 1]];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const off = Math.max(...h.pts.map(([x, z]) => Math.abs(((x - a[0]) * (b[1] - a[1]) - (z - a[1]) * (b[0] - a[0])) / L)));
      if (off > 150) curvy++;
    }
    expect(curvy).toBeGreaterThan(HIGHWAYS.filter((h) => !h.spur).length / 2); // (spurs run straight out of the cities)
  });

  it('has a town off one highway, with its own road', () => {
    expect(TOWN).not.toBeNull();
    const r = TOWN!.road;
    const h = HIGHWAYS[TOWN!.hw];
    // Both ends of the town road sit on the highway's edge.
    for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) expect(Math.abs(Math.abs(highwayCoords(h, p[0], p[1]).d) - (HW - 3))).toBeLessThan(2);
    expect(tightestRadius(r.pts)).toBeGreaterThan(40);
    for (let i = 1; i < r.pts.length; i++) {
      const run = Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
      expect(Math.abs(r.hs[i] - r.hs[i - 1]) / run).toBeLessThan(0.12);
    }
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
        const { x, z } = pointAt(h, s);
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

  it('has every region, and highways through each of them', () => {
    const seen = { desert: 0, forest: 0, mountain: 0, farm: 0, autumn: 0 };
    for (const h of HIGHWAYS)
      for (let s = 0; s < h.len; s += 200) {
        const p = pointAt(h, s);
        const b = biomeAt(p.x, p.z);
        expect(b.desert + b.forest + b.mountain + b.farm).toBeLessThan(1.0001);
        for (const k of ['desert', 'forest', 'mountain', 'farm'] as const) if (b[k] > 0.9) seen[k]++;
        if (b.forest * b.autumn > 0.9) seen.autumn++;
      }
    // At least ~2 km of highway in each.
    for (const [k, n] of Object.entries(seen)) expect(n, k).toBeGreaterThan(10);
  });

  it('in the mountains the highways run along valleys between high, snowy peaks', () => {
    let n = 0, rise = 0;
    for (const h of HIGHWAYS)
      for (let s = 800; s < h.len - 800; s += 250) {
        const p = pointAt(h, s);
        if (biomeAt(p.x, p.z).mountain < 0.95) continue;
        const road = profileAt(h, s);
        // The land right by the road is near road level…
        for (const d of [-HW - 4, HW + 4]) expect(Math.abs(heightAt(p.x - p.uz * d, p.z + p.ux * d) - road), `${h.name} at ${s}`).toBeLessThan(4);
        // …and the mountainsides rise high above it a few hundred metres off.
        for (const d of [-500, 500]) rise += heightAt(p.x - p.uz * d, p.z + p.ux * d) - road;
        n += 2;
        const [sx, sz] = [p.x - p.uz * 60, p.z + p.ux * 60];
        if (!outerRoadAt(sx, sz)) expect(surfaceAt(sx, sz)).toBe('snow');
      }
    expect(n).toBeGreaterThan(20);
    expect(rise / n).toBeGreaterThan(120);
  });
});
