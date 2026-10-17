import { describe, expect, it } from 'vitest';
import { CarState, INTERP_DELAY, StateBuffer, emptyState, packState, unpackState } from '../src/net/carState';

const at = (time: number, x: number, vx = 10): CarState => ({ ...emptyState(), time, car: 1, x, vx, qw: 1 });

describe("friend's car state", () => {
  it('packs and unpacks', () => {
    const s: CarState = { time: 123456789.25, car: 2, x: -4321.5, y: 87.25, z: 9876.125, qx: 0, qy: 0.6, qz: 0, qw: 0.8, vx: 30, vy: -1, vz: 2, steer: -0.3, speed: 31, damage: 0.5, realm: 1, thrust: 0.4 };
    const u = unpackState(packState(s))!;
    expect(u.time).toBe(s.time);
    expect(u.car).toBe(2);
    expect(u.realm).toBe(1);
    expect(u.thrust).toBeCloseTo(0.4, 3);
    for (const k of ['x', 'y', 'z', 'qy', 'qw', 'vx', 'steer', 'speed', 'damage'] as const) expect(u[k]).toBeCloseTo(s[k], 2);
  });

  it('rejects junk', () => {
    expect(unpackState(new ArrayBuffer(10))).toBeNull();
    const bad = packState({ ...emptyState(), x: NaN });
    expect(unpackState(bad)).toBeNull();
  });

  it('shows the car smoothly a little behind the newest packet, whatever the clock offset', () => {
    const b = new StateBuffer();
    const offset = 5_000_000; // the friend's clock is way ahead of ours
    for (let i = 0; i <= 10; i++) b.push(at(offset + i * 50, i * 5), i * 50 + 20); // 20 ms on the wire
    const out = emptyState();
    // Newest packet sent at our time 500-20; shown INTERP_DELAY behind it.
    const s = b.sample(520, out)!;
    expect(s.x).toBeCloseTo(((500 - INTERP_DELAY) / 50) * 5, 3);
  });

  it('ignores late and duplicate packets', () => {
    const b = new StateBuffer();
    b.push(at(100, 1), 100);
    b.push(at(200, 2), 200);
    b.push(at(150, 99), 210);
    b.push(at(200, 99), 220);
    expect(b.latest!.x).toBe(2);
  });

  it('keeps going for a moment when packets stop, then holds', () => {
    const b = new StateBuffer();
    b.push(at(0, 0), 0);
    b.push(at(50, 0.5), 50);
    const out = emptyState();
    expect(b.sample(50 + INTERP_DELAY + 100, out)!.x).toBeCloseTo(0.5 + 1, 3);
    expect(b.sample(50 + INTERP_DELAY + 5000, out)!.x).toBeCloseTo(0.5 + 3, 3);
  });
});
