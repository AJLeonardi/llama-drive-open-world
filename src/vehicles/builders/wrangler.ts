// Jeep Wrangler 2-door with the top off: flat hood, 7-slot grille, round headlights,
// upright windshield, black sport bars, open cabin, mud tires. Car local: +x left, +z forward.
import * as THREE from 'three';
import { ModelBuilder, CarModel } from '../CarModel';
import { SPECS } from '../VehicleSpec';
import { arcPoints, blob, cyl, keyframes, merge, patch, rbox, sculpt, torus, tube } from './geo';
import { engineBay, interior, underbody, wheelPieces } from './common';

const RED = 0xc4122f;
const BLACK = 0x1c1d1f;

export function buildWrangler(): CarModel {
  const s = SPECS.wrangler;
  const m = new ModelBuilder();
  const az = s.wheelbase / 2;
  const R = s.wheelRadius;
  const arches: [number, number, number][] = [[az, 0.52, R], [-az, 0.52, R]];

  const cabinTop = (x: number, y: number, z: number) => y > 1.12 && Math.abs(x) < 0.8 && z > -2.07 && z < 0.61;
  // One long door per side (2-door)
  const door = (x: number, y: number, z: number) => Math.abs(x) > 0.6 && y > 0.66 && y < 1.17 && z > -0.82 && z < 0.59;
  const hood = (_x: number, y: number, z: number) => y > 1.12 && z > 0.65 && z < 2.11;
  const gate = (x: number, y: number, z: number) => z < -2.12 && Math.abs(x) < 0.78 && y > 0.66 && y < 1.15;

  // Full boxy shell, then the top over the cabin is cut away (it's a convertible with the top off).
  const shell = sculpt({
    z0: -2.17, z1: 2.17, step: 0.07, round: 1, arches,
    at: keyframes([
      { z: -2.17, y0: 0.6, ys: 0.95, y1: 1.16, wB: 0.84, wM: 0.86, wT: 0.84 },
      { z: -2.05, y0: 0.58, ys: 0.95, y1: 1.18, wB: 0.86, wM: 0.87, wT: 0.85 },
      { z: 2.0, y0: 0.6, ys: 0.95, y1: 1.18, wB: 0.85, wM: 0.86, wT: 0.84 },
      { z: 2.17, y0: 0.66, ys: 0.95, y1: 1.12, wB: 0.82, wM: 0.83, wT: 0.8 },
    ]),
    color: (x, y, z) => (door(x, y, z) || hood(x, y, z) || gate(x, y, z) ? 0x2a2a2c : y < 0.68 ? BLACK : Math.abs(x) < 0.82 && y < 0.7 ? 0x2a2a2c : RED),
  });
  const tub = patch(shell, (x, y, z) => !cabinTop(x, y, z) && !(hood(x, y, z) && Math.abs(x) < 0.8), 0, (x, y, z) => (door(x, y, z) || hood(x, y, z) || gate(x, y, z) ? 0x2a2a2c : y < 0.68 ? BLACK : RED));
  m.part('body', 'body', tub);
  m.part('hood', 'panel', merge([
    patch(shell, hood, 0.012, RED),
    rbox({ at: [0.42, 1.205, 1.25], size: [0.28, 0.02, 0.5], radius: 0.01, color: BLACK }),
    rbox({ at: [-0.42, 1.205, 1.25], size: [0.28, 0.02, 0.5], radius: 0.01, color: BLACK }),
  ]), { detachable: true, hinge: [0, 1.17, 0.65] });
  engineBay(m, { at: [0, 0.82, 1.27], width: 1.6, cylinders: 6, radiatorZ: 1.88, accent: 0x2a2a2a });
  for (const side of [1, -1]) {
    const t = side > 0 ? 'l' : 'r';
    m.part(`door-${t}`, 'panel', merge([
      patch(shell, (x, y, z) => x * side > 0 && door(x, y, z), 0.01, RED),
      rbox({ at: [side * 0.885, 1.05, 0.3], size: [0.03, 0.035, 0.14], radius: 0.012, color: BLACK }),
      blob([side * 1.0, 1.3, 0.53], [0.04, 0.09, 0.12], BLACK),
      rbox({ at: [side * 0.92, 1.22, 0.53], size: [0.12, 0.12, 0.03], radius: 0.01, color: BLACK }),
    ]), { detachable: true, hinge: [side * 0.88, 0.92, 0.59], swing: 'door' });
  }
  m.part('tailgate', 'panel', patch(shell, gate, 0.012, RED), { detachable: true });

  // Seven-slot grille in body colour + round headlights.
  const slots: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) slots.push(rbox({ at: [(i - 3) * 0.13, 0.9, 2.18], size: [0.075, 0.34, 0.03], radius: 0.03, color: 0x0d0d0e }));
  m.part('grille', 'trim', merge(slots), { finish: 'satin' });
  for (const x of [0.63, -0.63]) m.detail(cyl({ at: [x, 0.92, 2.175], radius: 0.11, length: 0.03, axis: 'z', segments: 24, color: 0xffffff }), 'headlight');
  m.detail(merge([0.63, -0.63].map((x) => torus([x, 0.92, 2.19], 0.12, 0.018, [0, 0, 0], 0xa5aab0))), 'chrome');
  for (const x of [0.86, -0.86]) m.detail(rbox({ at: [x, 0.98, -2.18], size: [0.1, 0.3, 0.03], radius: 0.02, color: 0xffffff }), 'taillight');

  // Windshield in a black frame, folded-up and upright.
  const wsTilt = -0.16;
  m.part('glass', 'glass', rbox({ at: [0, 1.46, 0.65], size: [1.58, 0.5, 0.02], rot: [wsTilt, 0, 0], radius: 0.008, color: 0xffffff }));
  m.part('frame', 'trim', merge([
    rbox({ at: [0, 1.73, 0.61], size: [1.72, 0.07, 0.08], rot: [wsTilt, 0, 0], radius: 0.02, color: BLACK }),
    rbox({ at: [0.83, 1.46, 0.65], size: [0.07, 0.6, 0.08], rot: [wsTilt, 0, 0], radius: 0.02, color: BLACK }),
    rbox({ at: [-0.83, 1.46, 0.65], size: [0.07, 0.6, 0.08], rot: [wsTilt, 0, 0], radius: 0.02, color: BLACK }),
  ]), { finish: 'satin' });

  // Sport bars
  const bars: THREE.BufferGeometry[] = [];
  for (const z of [-0.85, -1.75]) bars.push(tube([[0.8, 1.16, z], [0.8, 1.72, z], [0.72, 1.84, z], [-0.72, 1.84, z], [-0.8, 1.72, z], [-0.8, 1.16, z]], 0.045, BLACK, 32, 8));
  for (const x of [0.8, -0.8]) {
    bars.push(tube([[x, 1.82, -0.85], [x, 1.83, -1.3], [x, 1.82, -1.75]], 0.04, BLACK, 12, 8));
    bars.push(tube([[x * 1.03, 1.75, 0.6], [x * 1.01, 1.8, -0.1], [x, 1.82, -0.85]], 0.035, BLACK, 12, 8));
  }
  m.part('rollbar', 'trim', merge(bars), { finish: 'satin' });

  // Steel bumpers, flat fender flares, rock rails, spare tire on the tailgate.
  m.part('front-bumper', 'panel', merge([
    rbox({ at: [0, 0.56, 2.27], size: [1.96, 0.24, 0.24], radius: 0.04, color: BLACK }),
    ...[0.55, -0.55].map((x) => rbox({ at: [x, 0.58, 2.41], size: [0.07, 0.14, 0.09], radius: 0.025, color: 0xd8261c })),
  ]), { detachable: true, finish: 'satin' });
  m.part('rear-bumper', 'panel', rbox({ at: [0, 0.56, -2.25], size: [1.86, 0.22, 0.18], radius: 0.04, color: BLACK }), { detachable: true, finish: 'satin' });
  const flares: THREE.BufferGeometry[] = [];
  for (const z of [az, -az])
    for (const x of [0.91, -0.91]) flares.push(tube(arcPoints(x, R, z, 0.56, -1.5, 1.5, 14), 0.07, BLACK, 20, 6));
  m.part('flares', 'trim', merge(flares), { finish: 'satin' });
  m.part('rails', 'trim', merge([0.88, -0.88].map((x) => rbox({ at: [x, 0.52, -0.1], size: [0.1, 0.08, 1.15], radius: 0.03, color: BLACK }))), { finish: 'satin' });
  const spareP = wheelPieces({ radius: 0.4, width: 0.28, rimFrac: 0.52, spokes: 5, rimColor: 0x8d9298, rimFinish: 'satin', caliper: BLACK, tread: 'mud' });
  const spare = merge([spareP[0][0], spareP[1][0]].map((g) => g.clone()));
  spare.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  spare.translate(0, 1.0, -2.35);
  m.part('spare', 'panel', spare, { detachable: true, finish: 'rubber', sound: 'plastic' });

  interior(m, { dashY: 1.1, seatY: 0.8, eye: s.eye, width: 0.8, rearSeats: true, color: 0x222326, seatColor: 0x2b2c2f });

  const pieces = wheelPieces({ radius: R, width: s.wheelWidth, rimFrac: 0.52, spokes: 5, rimColor: 0x8d9298, rimFinish: 'satin', caliper: 0x2a2a2a, tread: 'mud' });
  for (const [x, z] of [[s.track / 2, az], [-s.track / 2, az], [s.track / 2, -az], [-s.track / 2, -az]])
    m.wheel([x, R, z], pieces, x < 0);

  underbody(m, { wheelbase: s.wheelbase, track: s.track, wheelRadius: R, frameY: 0.6, railX: 0.42, z0: -2.05, z1: 2.05, ladder: true, engineZ: 1.27 });
  return m.build(new THREE.Vector3(0, 1.25, 1.45));
}
