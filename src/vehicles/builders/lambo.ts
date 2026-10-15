// Lamborghini Aventador-style supercar in bright green: low sharp wedge, raked glass canopy,
// big side intakes, Y-shaped lights, engine-cover louvres, rear wing. Car local: +x left, +z forward.
import * as THREE from 'three';
import { ModelBuilder, CarModel } from '../CarModel';
import { SPECS } from '../VehicleSpec';
import { blob, cyl, keyframes, merge, patch, rbox, sculpt, tube } from './geo';
import { engineBay, interior, openCabin, underbody, wheelPieces } from './common';

const GREEN = 0x6fd418;
const CARBON = 0x18191b;

export function buildLambo(): CarModel {
  const s = SPECS.lambo;
  const m = new ModelBuilder();
  const az = s.wheelbase / 2;
  const arches: [number, number, number][] = [[az, 0.4, s.wheelRadius], [-az, 0.42, s.wheelRadius]];

  const door = (x: number, y: number, z: number) => Math.abs(x) > 0.72 && y > 0.3 && y < 0.76 && z > -0.45 && z < 0.95;
  const frunk = (x: number, y: number, z: number) => Math.abs(x) < 0.7 && y > 0.52 && z > 1.05 && z < 2.25;
  const intake = (x: number, y: number, z: number) => Math.abs(x) > 0.9 && y > 0.36 && y < 0.68 && z > -1.2 && z < -0.5;

  const shell = sculpt({
    z0: -2.39, z1: 2.4, step: 0.06, round: 1, arches,
    at: keyframes([
      { z: -2.39, y0: 0.3, ys: 0.55, y1: 0.84, wB: 0.92, wM: 0.95, wT: 0.86 },
      { z: -2.1, y0: 0.22, ys: 0.55, y1: 0.88, wB: 0.97, wM: 1.0, wT: 0.9 },
      { z: -1.4, y0: 0.17, ys: 0.52, y1: 0.88, wB: 0.99, wM: 1.02, wT: 0.9 },
      { z: -0.8, y0: 0.16, ys: 0.48, y1: 0.82, wB: 0.96, wM: 1.0, wT: 0.88 },
      { z: 0.2, y0: 0.16, ys: 0.44, y1: 0.8, wB: 0.95, wM: 0.99, wT: 0.84 },
      { z: 0.95, y0: 0.15, ys: 0.44, y1: 0.8, wB: 0.97, wM: 1.01, wT: 0.84 },
      { z: 1.6, y0: 0.15, ys: 0.42, y1: 0.76, wB: 0.96, wM: 1.0, wT: 0.84 },
      { z: 2.1, y0: 0.15, ys: 0.36, y1: 0.58, wB: 0.9, wM: 0.96, wT: 0.76 },
      { z: 2.4, y0: 0.18, ys: 0.3, y1: 0.4, wB: 0.66, wM: 0.74, wT: 0.58 },
    ]),
    color: (x, y, z) => (door(x, y, z) || frunk(x, y, z) ? 0x202022 : y < 0.24 || intake(x, y, z) ? CARBON : GREEN),
  });
  m.part('body', 'body', patch(shell, (x, y, z) => !frunk(x, y, z), 0, (x, y, z) => (door(x, y, z) ? 0x202022 : y < 0.24 || intake(x, y, z) ? CARBON : GREEN)));
  m.part('hood', 'panel', patch(shell, frunk, 0.01, GREEN), { detachable: true, hinge: [0, 0.78, 1.05] });
  // Front: radiators and a small luggage tub. Back: the V12, visible under the glass.
  m.part('frunk', 'trim', merge([
    rbox({ at: [0, 0.4, 1.65], size: [1.0, 0.25, 0.8], radius: 0.05, color: 0x1a1a1c }),
    rbox({ at: [0.62, 0.38, 2.05], size: [0.3, 0.3, 0.05], rot: [0, 0.4, 0], radius: 0.01, color: 0x2b2c2f }),
    rbox({ at: [-0.62, 0.38, 2.05], size: [0.3, 0.3, 0.05], rot: [0, -0.4, 0], radius: 0.01, color: 0x2b2c2f }),
  ]), { finish: 'engine' });
  engineBay(m, { at: [0, 0.5, -1.3], width: 1.25, cylinders: 12, accent: 0xd8261c });
  for (const side of [1, -1]) {
    m.part(side > 0 ? 'door-l' : 'door-r', 'panel', merge([
      patch(shell, (x, y, z) => x * side > 0 && door(x, y, z), 0.01, GREEN),
      blob([side * 1.08, 0.82, 0.7], [0.05, 0.06, 0.12], GREEN),
      rbox({ at: [side * 1.0, 0.8, 0.68], size: [0.12, 0.03, 0.05], radius: 0.01, color: CARBON }),
    ]), { detachable: true, hinge: [side * 1.0, 0.55, 0.95], swing: 'up' }); // scissor doors pop upwards
  }

  const canopy = sculpt({
    z0: -1.75, z1: 1.06, step: 0.08, round: 2,
    at: keyframes([
      { z: -1.75, y0: 0.86, ys: 0.87, y1: 0.89, wB: 0.86, wM: 0.86, wT: 0.82 },
      { z: -1.2, y0: 0.84, ys: 0.88, y1: 1.0, wB: 0.86, wM: 0.84, wT: 0.66 },
      { z: -0.6, y0: 0.8, ys: 0.88, y1: 1.13, wB: 0.84, wM: 0.8, wT: 0.58 },
      { z: 0.0, y0: 0.77, ys: 0.85, y1: 1.13, wB: 0.83, wM: 0.8, wT: 0.58 },
      { z: 0.6, y0: 0.74, ys: 0.8, y1: 0.98, wB: 0.84, wM: 0.82, wT: 0.68 },
      { z: 1.06, y0: 0.7, ys: 0.72, y1: 0.74, wB: 0.84, wM: 0.84, wT: 0.82 },
    ]),
    color: 0xffffff,
  });
  m.part('glass', 'glass', canopy);
  m.part('roof', 'panel', patch(canopy, (x, y, z) => y > 1.06 && z > -0.8 && z < 0.2 && Math.abs(x) < 0.6, 0.008, GREEN));
  // Body-coloured pillars framing the glass: A-pillars up the windshield edges, rails
  // along the roof, sloping C-pillars down the back, and the frame behind the door
  // window. (Hidden in the cockpit view, like the Bronco's, so they don't block it.)
  const pillars: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    pillars.push(tube([[sx * 0.85, 0.72, 1.02], [sx * 0.72, 0.95, 0.62], [sx * 0.62, 1.1, 0.2], [sx * 0.6, 1.14, -0.3], [sx * 0.62, 1.12, -0.75], [sx * 0.7, 1.0, -1.2], [sx * 0.84, 0.89, -1.72]], 0.035, GREEN, 40, 8));
    pillars.push(tube([[sx * 0.86, 0.84, -0.45], [sx * 0.74, 1.0, -0.47], [sx * 0.62, 1.12, -0.5]], 0.03, GREEN, 8, 6));
    pillars.push(tube([[sx * 0.88, 0.8, 0.95], [sx * 0.9, 0.84, 0.2], [sx * 0.88, 0.86, -0.6], [sx * 0.86, 0.88, -1.4]], 0.025, CARBON, 20, 6));
  }
  m.part('pillars', 'trim', merge(pillars), { finish: 'paint' });
  // Engine-cover louvres
  m.part('louvres', 'trim', merge(
    [-1.15, -1.3, -1.45, -1.6].map((z) => rbox({ at: [0, 0.915 - (z + 1.15) * 0.05, z], size: [0.8, 0.012, 0.05], radius: 0.005, color: CARBON })),
  ), { finish: 'satin' });

  // Lights: Y-shaped running lights, dark headlight housings, slim taillights.
  const housings: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    housings.push(rbox({ at: [side * 0.6, 0.47, 2.17], size: [0.42, 0.08, 0.16], rot: [0, side * 0.35, side * -0.12], radius: 0.02, color: 0x0e0f10 }));
    m.detail(merge([
      rbox({ at: [side * 0.6, 0.5, 2.24], size: [0.36, 0.02, 0.02], rot: [0, side * 0.35, side * -0.12], radius: 0.008, color: 0xffffff }),
      rbox({ at: [side * 0.72, 0.45, 2.2], size: [0.14, 0.02, 0.02], rot: [0, side * 0.35, side * 0.6], radius: 0.008, color: 0xffffff }),
    ]), 'headlight');
    m.detail(merge([
      rbox({ at: [side * 0.62, 0.66, -2.37], size: [0.5, 0.035, 0.03], radius: 0.01, color: 0xffffff }),
      rbox({ at: [side * 0.42, 0.6, -2.36], size: [0.16, 0.03, 0.03], rot: [0, 0, side * 0.7], radius: 0.01, color: 0xffffff }),
    ]), 'taillight');
  }
  m.detail(merge(housings), 'satin');

  m.part('front-bumper', 'panel', merge([
    rbox({ at: [0, 0.18, 2.3], size: [1.4, 0.04, 0.16], radius: 0.015, color: CARBON }), // splitter
    rbox({ at: [0.55, 0.3, 2.28], size: [0.5, 0.14, 0.12], rot: [0, 0.25, 0], radius: 0.03, color: 0x0c0c0d }),
    rbox({ at: [-0.55, 0.3, 2.28], size: [0.5, 0.14, 0.12], rot: [0, -0.25, 0], radius: 0.03, color: 0x0c0c0d }),
  ]), { detachable: true, finish: 'satin', sound: 'plastic' });
  m.part('rear-bumper', 'panel', merge([
    rbox({ at: [0, 0.3, -2.4], size: [1.72, 0.2, 0.1], radius: 0.03, color: CARBON }),
    ...[-0.5, -0.25, 0.25, 0.5].map((x) => rbox({ at: [x, 0.24, -2.36], size: [0.03, 0.14, 0.22], radius: 0.01, color: 0x0c0c0d })),
  ]), { detachable: true, finish: 'satin', sound: 'plastic' });
  m.detail(cyl({ at: [0, 0.44, -2.42], radius: 0.09, length: 0.14, axis: 'z', segments: 6, color: 0xc0c4c8 }), 'chrome');
  m.part('wing', 'panel', merge([
    rbox({ at: [0, 0.99, -2.2], size: [1.4, 0.03, 0.26], rot: [0.12, 0, 0], radius: 0.012, color: CARBON }),
    rbox({ at: [0.4, 0.93, -2.18], size: [0.03, 0.1, 0.12], radius: 0.01, color: CARBON }),
    rbox({ at: [-0.4, 0.93, -2.18], size: [0.03, 0.1, 0.12], radius: 0.01, color: CARBON }),
  ]), { detachable: true, finish: 'satin', sound: 'plastic' });

  interior(m, { dashY: 0.66, seatY: 0.32, eye: s.eye, width: 0.78, rearSeats: false, color: 0x1a1a1c, seatColor: 0x222225, seatBack: 0.75 });

  const pieces = wheelPieces({ radius: s.wheelRadius, width: s.wheelWidth, rimFrac: 0.74, spokes: 10, rimColor: 0x3a3c40, rimFinish: 'chrome', caliper: 0xf2c200, tread: 'road' });
  for (const [x, z] of [[s.track / 2, az], [-s.track / 2, az], [s.track / 2, -az], [-s.track / 2, -az]])
    m.wheel([x, s.wheelRadius, z], pieces, x < 0);

  m.splitGlass([-0.45]);
  openCabin(m, { z0: -1.15, z1: 0.98, xMax: 0.82, yMin: 0.6 });
  underbody(m, { wheelbase: s.wheelbase, track: s.track, wheelRadius: s.wheelRadius, frameY: 0.2, railX: 0.55, z0: -2.25, z1: 2.15, ladder: false, engineZ: -1.3 });
  return m.build(new THREE.Vector3(0, 0.95, -1.6), { tintedGlass: true });
}
