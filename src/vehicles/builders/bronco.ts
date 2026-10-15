// 2025 Ford Bronco Badlands, Sasquatch package: white body, black/carbon-gray molded hardtop,
// black flares and steel bumpers, 35" mud tires, round LED headlights. Car local: +x left, +z forward.
import * as THREE from 'three';
import { ModelBuilder, CarModel } from '../CarModel';
import { SPECS } from '../VehicleSpec';
import { arcPoints, blob, cyl, keyframes, merge, patch, rbox, sculpt, torus, tube } from './geo';
import { engineBay, interior, openCabin, underbody, wheelPieces } from './common';

const WHITE = 0xf3f3f1;
const BLACK = 0x1d1e20;
const CARBON = 0x3a3d42;
const RED = 0xd8261c;

export function buildBronco(): CarModel {
  const s = SPECS.bronco;
  const m = new ModelBuilder();
  const az = s.wheelbase / 2;
  const arches: [number, number, number][] = [[az, 0.57, s.wheelRadius], [-az, 0.57, s.wheelRadius]];

  const doorFront = (x: number, y: number, z: number) => Math.abs(x) > 0.6 && y > 0.66 && y < 1.25 && z > 0.02 && z < 0.92;
  const doorRear = (x: number, y: number, z: number) => Math.abs(x) > 0.6 && y > 0.66 && y < 1.25 && z > -1.0 && z < -0.02;
  const hood = (_x: number, y: number, z: number) => y > 1.17 && z > 0.98 && z < 2.3;

  const shell = sculpt({
    z0: -2.36, z1: 2.4, step: 0.07, round: 2, arches,
    at: keyframes([
      { z: -2.36, y0: 0.56, ys: 1.0, y1: 1.2, wB: 0.9, wM: 0.93, wT: 0.88 },
      { z: -2.22, y0: 0.5, ys: 1.0, y1: 1.27, wB: 0.94, wM: 0.965, wT: 0.93 },
      { z: 0.9, y0: 0.48, ys: 1.0, y1: 1.27, wB: 0.94, wM: 0.965, wT: 0.93 },
      { z: 2.1, y0: 0.5, ys: 1.0, y1: 1.23, wB: 0.93, wM: 0.955, wT: 0.92 },
      { z: 2.3, y0: 0.56, ys: 0.98, y1: 1.2, wB: 0.9, wM: 0.93, wT: 0.88 },
      { z: 2.4, y0: 0.64, ys: 0.95, y1: 1.13, wB: 0.85, wM: 0.87, wT: 0.83 },
    ]),
    // Black lower cladding; dark openings under the doors and hood (seen if they fall off).
    color: (x, y, z) => (doorFront(x, y, z) || doorRear(x, y, z) || hood(x, y, z) ? 0x26272a : y < 0.66 ? BLACK : WHITE),
  });
  // The shell's lid under the hood is cut away so the engine shows when the hood opens.
  m.part('body', 'body', patch(shell, (x, y, z) => !(hood(x, y, z) && Math.abs(x) < 0.86), 0, (x, y, z) => (doorFront(x, y, z) || doorRear(x, y, z) ? 0x26272a : y < 0.66 ? BLACK : WHITE)));
  m.part('hood', 'panel', merge([
    patch(shell, hood, 0.012, WHITE),
    rbox({ at: [0, 1.29, 1.55], size: [0.7, 0.04, 0.9], radius: 0.02, color: WHITE }), // power dome
  ]), { detachable: true, hinge: [0, 1.25, 0.98] });
  engineBay(m, { at: [0, 0.86, 1.62], width: 1.7, cylinders: 6, radiatorZ: 2.22, accent: 0x9aa0a6 });
  const mirror = (x: number) => merge([
    blob([x * 1.13, 1.36, 0.82], [0.05, 0.1, 0.13], BLACK),
    rbox({ at: [x * 1.04, 1.33, 0.8], size: [0.14, 0.04, 0.06], radius: 0.015, color: BLACK }),
  ]);
  for (const side of [1, -1]) {
    const tag = side > 0 ? 'l' : 'r';
    m.part(`door-f${tag}`, 'panel', merge([
      patch(shell, (x, y, z) => x * side > 0 && doorFront(x, y, z), 0.01, WHITE),
      rbox({ at: [side * 0.985, 1.12, 0.62], size: [0.03, 0.035, 0.16], radius: 0.012, color: BLACK }),
      mirror(side),
    ]), { detachable: true, hinge: [side * 0.97, 0.95, 0.92], swing: 'door' });
    m.part(`door-r${tag}`, 'panel', merge([
      patch(shell, (x, y, z) => x * side > 0 && doorRear(x, y, z), 0.01, WHITE),
      rbox({ at: [side * 0.985, 1.12, -0.3], size: [0.03, 0.035, 0.16], radius: 0.012, color: BLACK }),
    ]), { detachable: true, hinge: [side * 0.97, 0.95, -0.02], swing: 'door' });
  }

  // Glass greenhouse (windshield, side and rear windows).
  m.part('glass', 'glass', sculpt({
    z0: -2.27, z1: 1.0, step: 0.12, round: 2,
    at: keyframes([
      { z: -2.27, y0: 1.24, ys: 1.32, y1: 1.79, wB: 0.91, wM: 0.91, wT: 0.86 },
      { z: 0.5, y0: 1.24, ys: 1.32, y1: 1.79, wB: 0.91, wM: 0.91, wT: 0.86 },
      { z: 1.0, y0: 1.24, ys: 1.25, y1: 1.27, wB: 0.91, wM: 0.91, wT: 0.9 },
    ]),
    color: 0xffffff,
  }));
  // Molded-in-colour hardtop
  m.part('roof', 'panel', sculpt({
    z0: -2.33, z1: 0.62, step: 0.15, round: 2,
    at: keyframes([
      { z: -2.33, y0: 1.77, ys: 1.83, y1: 1.94, wB: 0.9, wM: 0.915, wT: 0.85 },
      { z: 0.45, y0: 1.77, ys: 1.83, y1: 1.95, wB: 0.9, wM: 0.915, wT: 0.85 },
      { z: 0.62, y0: 1.76, ys: 1.79, y1: 1.86, wB: 0.89, wM: 0.9, wT: 0.84 },
    ]),
    color: CARBON,
  }), { detachable: true, finish: 'satin' });
  const pillars: THREE.BufferGeometry[] = [];
  for (const x of [0.905, -0.905]) {
    for (const [z, w] of [[-0.03, 0.12], [-1.02, 0.12], [-2.22, 0.2]] as const)
      pillars.push(rbox({ at: [x, 1.51, z], size: [0.06, 0.56, w], radius: 0.02, color: BLACK }));
    pillars.push(tube([[x, 1.26, 0.99], [x * 0.99, 1.55, 0.8], [x * 0.96, 1.79, 0.55]], 0.04, BLACK, 8, 6));
  }
  m.part('pillars', 'trim', merge(pillars), { finish: 'satin' });

  // Front: grille, round LED headlights with C-shaped running lights.
  m.part('grille', 'trim', merge([
    rbox({ at: [0, 0.98, 2.39], size: [1.62, 0.36, 0.06], radius: 0.03, color: BLACK }),
    ...[0.9, 1.0, 1.08].map((y) => rbox({ at: [0, y, 2.425], size: [0.82, 0.03, 0.02], radius: 0.01, color: 0x2e3034 })),
  ]), { finish: 'satin' });
  const bezels: THREE.BufferGeometry[] = [];
  for (const x of [0.64, -0.64]) {
    m.detail(cyl({ at: [x, 0.98, 2.405], radius: 0.115, length: 0.04, axis: 'z', segments: 24, color: 0xffffff }), 'headlight');
    bezels.push(torus([x, 0.98, 2.43], 0.125, 0.018, [0, 0, 0], 0x9aa0a6));
    bezels.push(torus([x, 0.98, 2.44], 0.07, 0.008, [0, 0, 0], 0x6a6e73));
  }
  m.detail(merge(bezels), 'chrome');
  for (const x of [0.88, -0.88]) m.detail(rbox({ at: [x, 1.0, -2.37], size: [0.11, 0.34, 0.04], radius: 0.02, color: 0xffffff }), 'taillight');

  // Steel bumpers (front has red tow hooks and fog lights), rock rails, spare tire.
  m.part('front-bumper', 'panel', merge([
    rbox({ at: [0, 0.57, 2.5], size: [2.02, 0.26, 0.3], radius: 0.05, color: BLACK }),
    rbox({ at: [0, 0.42, 2.38], size: [1.2, 0.08, 0.4], radius: 0.03, color: 0x2a2b2e }),
    ...[0.52, -0.52].map((x) => rbox({ at: [x, 0.6, 2.67], size: [0.07, 0.15, 0.1], radius: 0.025, color: RED })),
  ]), { detachable: true, finish: 'satin' });
  m.detail(merge([0.82, -0.82].map((x) => cyl({ at: [x, 0.58, 2.655], radius: 0.05, length: 0.02, axis: 'z', segments: 12, color: 0xffffff }))), 'headlight');
  m.part('rear-bumper', 'panel', rbox({ at: [0, 0.58, -2.46], size: [1.98, 0.24, 0.24], radius: 0.05, color: BLACK }), { detachable: true, finish: 'satin' });
  const spareTire = wheelPieces({ radius: 0.42, width: 0.3, rimFrac: 0.55, spokes: 6, rimColor: 0x3a3d42, rimFinish: 'satin', caliper: BLACK, tread: 'mud' });
  const spare = merge([spareTire[0][0], spareTire[1][0]].map((g) => g.clone()));
  spare.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  spare.translate(0, 1.0, -2.58);
  m.part('spare', 'panel', spare, { detachable: true, finish: 'rubber', sound: 'plastic' });
  m.part('rails', 'trim', merge([0.97, -0.97].map((x) => rbox({ at: [x, 0.5, -0.05], size: [0.1, 0.08, 1.85], radius: 0.03, color: BLACK }))), { finish: 'satin' });

  // Wide black fender flares around the 35" tires.
  const flares: THREE.BufferGeometry[] = [];
  for (const z of [az, -az])
    for (const x of [1.0, -1.0]) flares.push(tube(arcPoints(x, s.wheelRadius, z, 0.6, -1.45, 1.45, 14), 0.075, BLACK, 20, 8));
  m.part('flares', 'trim', merge(flares), { finish: 'satin' });
  m.detail(merge([1.04, -1.04].map((x) => rbox({ at: [x, 0.9, az + 0.52], size: [0.03, 0.06, 0.12], radius: 0.02, color: 0xffffff }))), 'headlight');

  interior(m, { dashY: 1.16, seatY: 0.8, eye: s.eye, width: 0.88, rearSeats: true, color: 0x232427, seatColor: 0x2f3034 });

  const pieces = wheelPieces({ radius: s.wheelRadius, width: s.wheelWidth, rimFrac: 0.55, spokes: 6, rimColor: 0x3a3d42, rimFinish: 'satin', caliper: 0x1c1c1c, tread: 'mud' });
  for (const [x, z] of [[s.track / 2, az], [-s.track / 2, az], [s.track / 2, -az], [-s.track / 2, -az]])
    m.wheel([x, s.wheelRadius, z], pieces, x < 0);

  m.splitGlass([-1.0, -0.02]); // rear quarter | rear door | front door
  openCabin(m, { z0: -2.2, z1: 0.96, xMax: 0.86, yMin: 1.0 });
  underbody(m, { wheelbase: s.wheelbase, track: s.track, wheelRadius: s.wheelRadius, frameY: 0.56, railX: 0.45, z0: -2.25, z1: 2.25, ladder: true, engineZ: 1.62 });
  return m.build(new THREE.Vector3(0, 1.3, 1.9), { tintedGlass: true });
}

