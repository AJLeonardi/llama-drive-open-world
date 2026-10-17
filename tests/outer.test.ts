import { describe, expect, it } from 'vitest';
import { ALEXANDER, CROSSINGS, DC, PADS, HIGHWAYS, HW, OUTER_LAKES, RAMPS, RING, TOWERS, TOWN, TOWNS, forNearHighways, highwayCoords, nearestCurve, outerRoadAt, pointAt, profileAt, tightestRadius, townDistance, townPoint, OVERPASS_RISE } from '../src/world/outer';
import { RING_APOTHEM, hexDistance } from '../src/world/bounds';
import { biomeAt, mountainWeight } from '../src/world/biomes';
import { CANYON } from '../src/world/hills';
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

  it('has three towns: Mariano-ville, Alexander-ville and Washington DC', () => {
    const towns = TOWNS.filter((t) => t.kind !== 'pad');
    expect(towns.map((t) => t.name).sort()).toEqual(['Alexander-ville', 'Mariano-ville', 'Washington DC']);
    for (const a of towns) for (const b of towns) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2500);
  });

  it('has two launch pads, each with a road in from a highway that joins it both ways', () => {
    expect(PADS.map((t) => t.name).sort()).toEqual(['Alexander Mix', 'Launch Pad 39A']);
    for (const p of PADS) {
      expect(p.exits.length, p.name).toBe(2);
      expect(new Set(p.exits.map((e) => e.dir)).size, p.name).toBe(2);
      for (const t of TOWNS) if (t !== p) expect(townDistance(t, p.x, p.z), `${p.name} near ${t.name}`).toBeGreaterThan(400);
    }
    // Alexander Mix is north-west of Alexander-ville; 39A is in the desert east of Red Canyon, north of RT 5.
    const mix = PADS.find((p) => p.name === 'Alexander Mix')!, a = ALEXANDER!;
    const [ax, az] = townPoint(a, 0, 300);
    expect(mix.x).toBeLessThan(ax);
    expect(mix.z).toBeLessThan(az);
    const pad = PADS.find((p) => p.name === 'Launch Pad 39A')!;
    expect(pad.x).toBeGreaterThan(CANYON.x + 340);
    expect(pad.z).toBeGreaterThan(CANYON.z0);
    expect(pad.z).toBeLessThan(CANYON.z1);
    expect(biomeAt(pad.x, pad.z).desert).toBeGreaterThan(0.8);
    const rt5 = HIGHWAYS.find((h) => h.name === 'RT 5')!;
    expect(Math.abs(Math.abs(highwayCoords(rt5, pad.x, pad.z).d) - Math.abs(pad.x - CANYON.x))).toBeLessThan(80);
  });

  it('Alexander-ville is out in farm country, close under the mountains but not in them', () => {
    const t = ALEXANDER!;
    let near = 0;
    for (let a = t.area.a0; a <= t.area.a1; a += 50)
      for (let b = t.area.b0; b <= t.area.b1; b += 50) {
        const [x, z] = townPoint(t, a, b);
        expect(biomeAt(x, z).farm, `${a},${b}`).toBeGreaterThan(0.8);
        expect(mountainWeight(x, z)).toBeLessThan(0.02);
      }
    const [cx, cz] = townPoint(t, 0, (t.area.b0 + t.area.b1) / 2);
    for (let k = 0; k < 36; k++) near = Math.max(near, mountainWeight(cx + Math.cos(k / 5.73) * 1400, cz + Math.sin(k / 5.73) * 1400));
    expect(near).toBeGreaterThan(0.5);
  });

  it('Washington DC sits in the triangle between RT 4, RT 6 and RT 8, with roads in from three highways', () => {
    expect(Math.hypot(DC.x + 3450, DC.z - 2850)).toBeLessThan(300);
    const named = (n: string) => HIGHWAYS.find((h) => h.name === n)!;
    // South of RT 4, east of RT 6, west of RT 8 (each passes by on that side of it).
    expect(highwayCoords(named('RT 4'), DC.x, DC.z).d * Math.sign(highwayCoords(named('RT 4'), -3200, 1200).d)).toBeLessThan(0);
    for (const n of ['RT 6', 'RT 8']) expect(Math.abs(highwayCoords(named(n), DC.x, DC.z).d)).toBeLessThan(1200);
    expect(new Set(DC.exits.map((e) => e.hw)).size).toBe(3);
    expect(DC.exits.length).toBe(6); // each road in splits to join its highway both ways
  });

  it('every town street ends on another road, and the roads in end on a highway', () => {
    for (const t of TOWNS)
      for (const r of t.roads)
        for (const end of [r.pts[0], r.pts[r.pts.length - 1]]) {
          let onHighway = false;
          forNearHighways(end[0], end[1], (h, s, d) => {
            if (Math.abs(d) < HW && s > 0 && s < h.len) onHighway = true;
          });
          const onStreet = t.roads.some((o) => o !== r && o.pts.some(([x, z], i) => i < o.pts.length - 1 && segDist(end, [x, z], o.pts[i + 1]) < o.hw + 1));
          expect(onHighway || onStreet, `${t.name}: road end at ${end.map(Math.round)}`).toBe(true);
        }
  });

  it('the roads into town are gentle, and run into nothing on the way', () => {
    for (const t of TOWNS)
      for (const r of t.roads) {
        if (r.from < 0) continue;
        expect(tightestRadius(r.pts), t.name).toBeGreaterThan(45);
        for (let i = 1; i < r.pts.length; i++) {
          const run = Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
          expect(Math.abs(r.hs[i] - r.hs[i - 1]) / run, t.name).toBeLessThan(0.085);
        }
        for (const [x, z] of r.pts.slice(3, -1)) {
          forNearHighways(x, z, (h, s, d) => {
            if (h.id !== r.from) expect(Math.abs(d) < HW + 8 && s > 0 && s < h.len, `${t.name} road in crosses ${h.name}`).toBe(false);
          });
          for (const ramp of RAMPS) expect(ramp.pts.some(([px, pz]) => Math.hypot(px - x, pz - z) < 20), `${t.name} road in runs into a ramp`).toBe(false);
        }
      }
  });

  it('the towns are on level ground, clear of highways, ramps and radio towers', () => {
    for (const t of TOWNS) {
      for (const area of [t.area, ...(t.annex ? [t.annex] : [])])
      for (let a = area.a0; a <= area.a1; a += 20)
        for (let b = area.b0; b <= area.b1; b += 20) {
          const [x, z] = townPoint(t, a, b);
          if (OUTER_LAKES.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + 14)) continue;
          // Level, or on one of the town's own roads (the roads in slope down to it).
          const c = nearestCurve(x, z);
          if (c.edge > 30) expect(Math.abs(heightAt(x, z) - t.level), `${t.name} ${a},${b}`).toBeLessThan(0.05);
          forNearHighways(x, z, (h, s, d) => expect(Math.abs(d) < HW + 10 && s > 0 && s < h.len, `${t.name}: ${h.name} at ${a},${b}`).toBe(false));
        }
      for (const r of RAMPS) for (const [x, z] of r.pts) expect(townDistance(t, x, z)).toBeGreaterThan(40);
      for (const tw of TOWERS) expect(townDistance(t, tw.x, tw.z)).toBeGreaterThan(100);
      // Streets are asphalt, the rest is lawn.
      const [sx, sz] = t.road.pts[Math.floor(t.road.pts.length / 2)];
      expect(surfaceAt(sx, sz)).toBe('asphalt');
    }
  });
});

function segDist(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}
