import { describe, expect, it } from 'vitest';
import { patch, sculpt } from '../src/vehicles/builders/geo';

describe('sculpt modelling', () => {
  const body = sculpt({
    z0: -2, z1: 2, step: 0.2, round: 2, color: 0xffffff,
    at: () => ({ y0: 0.3, ys: 0.8, y1: 1.2, wB: 0.8, wM: 0.9, wT: 0.7 }),
    arches: [[1.3, 0.4, 0.35]],
  });

  it('normals point outward', () => {
    const pos = body.attributes.position, nor = body.attributes.normal;
    let checked = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (Math.abs(z) > 1.5 || Math.abs(z - 1.3) < 0.45) continue; // skip ends and the arch underside
      if (x > 0.85) { expect(nor.getX(i)).toBeGreaterThan(0.5); checked++; }
      if (y > 1.19 && Math.abs(x) < 0.2) { expect(nor.getY(i)).toBeGreaterThan(0.5); checked++; }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('wheel arches lift the underside over the wheel', () => {
    const pos = body.attributes.position;
    let minYAtArch = Infinity;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - 1.3) < 0.05) minYAtArch = Math.min(minYAtArch, pos.getY(i));
    expect(minYAtArch).toBeGreaterThan(0.7);
  });

  it('patches sit just outside the surface', () => {
    const door = patch(body, (x, y, z) => x > 0.5 && y > 0.4 && y < 1.0 && z > -0.5 && z < 0.5, 0.01, 0xff0000);
    expect(door.index!.count).toBeGreaterThan(6);
    const p = door.attributes.position;
    for (let i = 0; i < p.count; i++) expect(p.getX(i)).toBeGreaterThan(0.5);
  });
});

describe('sculpt caps', () => {
  it('end caps face outward', () => {
    const b = sculpt({ z0: -1, z1: 1, step: 0.5, round: 1, color: 0xffffff, at: () => ({ y0: 0, ys: 0.5, y1: 1, wB: 0.5, wM: 0.5, wT: 0.5 }) });
    const pos = b.attributes.position, nor = b.attributes.normal;
    const last = pos.count - 1; // centre of the front cap
    expect(pos.getZ(last)).toBeCloseTo(1);
    expect(nor.getZ(last)).toBeGreaterThan(0.9);
  });
});
