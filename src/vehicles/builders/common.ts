import * as THREE from 'three';
import { Finish, ModelBuilder } from '../CarModel';
import { blob, box, cyl, latheX, merge, rbox, torus, tube } from './geo';

export interface WheelDesign {
  radius: number;
  width: number;
  /** Rim radius as a fraction of the tire radius (low-profile supercar ≈ 0.75, off-road ≈ 0.55). */
  rimFrac: number;
  spokes: number;
  rimColor: number;
  rimFinish: Finish;
  caliper: number;
  tread: 'road' | 'mud';
}

/**
 * Tire + rim + brake, built around the origin with the axle along x and the
 * outer face toward +x (left side). Right-side wheels are mirrored by the builder.
 */
export function wheelPieces(d: WheelDesign): [THREE.BufferGeometry, Finish][] {
  const R = d.radius, w = d.width, rr = R * d.rimFrac;
  const tire = latheX(
    [
      [rr, -w / 2], [R * 0.9, -w / 2], [R * 0.97, -w * 0.46], [R, -w * 0.36],
      [R, w * 0.36], [R * 0.97, w * 0.46], [R * 0.9, w / 2], [rr, w / 2],
    ],
    28, [0, 0, 0], 0x1b1b1c,
  );
  const tireParts = [tire];
  if (d.tread === 'mud') {
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      for (const side of [-1, 1]) {
        const off = (i % 2 ? 0.18 : 0.26) * side * w;
        const g = box({ at: [off, 0, 0], size: [w * 0.34, 0.05, R * 0.2], seg: 1, color: 0x202021 });
        g.translate(0, R + 0.012, 0);
        g.applyMatrix4(new THREE.Matrix4().makeRotationX(a));
        tireParts.push(g);
      }
    }
  } else {
    // Simple tread grooves
    for (const x of [-w * 0.18, w * 0.18]) tireParts.push(latheX([[R + 0.003, x - 0.012], [R + 0.003, x + 0.012]], 28, [0, 0, 0], 0x111111));
  }

  const face = w * 0.36;
  const rimParts: THREE.BufferGeometry[] = [
    // Barrel and outer lip
    latheX([[rr * 0.98, -w * 0.42], [rr, face], [rr * 1.04, face + 0.012], [rr * 0.93, face + 0.02]], 28, [0, 0, 0], d.rimColor),
    // Hub
    cyl({ at: [face - 0.01, 0, 0], radius: rr * 0.24, length: 0.06, axis: 'x', segments: 16, color: d.rimColor }),
  ];
  for (let i = 0; i < d.spokes; i++) {
    const a = (i / d.spokes) * Math.PI * 2;
    const g = rbox({ at: [face - 0.015, rr * 0.58, 0], size: [0.035, rr * 0.78, rr * (d.spokes > 6 ? 0.12 : 0.2)], radius: 0.01, color: d.rimColor });
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(a));
    rimParts.push(g);
  }
  // Lug nuts
  const nuts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    nuts.push(cyl({ at: [face + 0.02, Math.cos(a) * rr * 0.14, Math.sin(a) * rr * 0.14], radius: 0.012, length: 0.03, axis: 'x', segments: 6, color: 0xcfd2d6 }));
  }
  const brake = cyl({ at: [-0.02, 0, 0], radius: rr * 0.82, length: 0.03, axis: 'x', segments: 20, color: 0x55585c });
  const caliper = rbox({ at: [0.02, rr * 0.55, -rr * 0.25], size: [0.07, rr * 0.38, rr * 0.3], radius: 0.015, color: d.caliper });

  return [
    [merge(tireParts), 'rubber'],
    [merge(rimParts), d.rimFinish],
    [merge(nuts), 'chrome'],
    [brake, 'satin'],
    [caliper, 'paint'],
  ];
}

export interface InteriorOpts {
  dashY: number;
  seatY: number;
  eye: { x: number; y: number; z: number };
  width: number;
  rearSeats: boolean;
  color: number;
  seatColor: number;
}

/** Dashboard, seats and a steering wheel that turns. No people. */
export function interior(m: ModelBuilder, o: InteriorOpts) {
  const dashZ = o.eye.z + 0.78;
  const geos: THREE.BufferGeometry[] = [
    rbox({ at: [0, o.dashY, dashZ], size: [o.width * 2 - 0.08, 0.26, 0.5], radius: 0.08, color: o.color }),
    // Centre console
    rbox({ at: [0, o.seatY + 0.12, o.eye.z - 0.05], size: [0.22, 0.25, 1.0], radius: 0.05, color: o.color }),
  ];
  const seat = (x: number, z: number, wide = 0.5) => {
    geos.push(rbox({ at: [x, o.seatY, z], size: [wide, 0.16, 0.52], radius: 0.06, color: o.seatColor }));
    geos.push(rbox({ at: [x, o.seatY + 0.36, z - 0.27], size: [wide, 0.62, 0.14], rot: [-0.18, 0, 0], radius: 0.06, color: o.seatColor }));
    geos.push(rbox({ at: [x, o.seatY + 0.76, z - 0.36], size: [Math.min(wide, 0.28), 0.18, 0.1], rot: [-0.18, 0, 0], radius: 0.04, color: o.seatColor }));
  };
  seat(o.eye.x, o.eye.z - 0.35);
  seat(-o.eye.x, o.eye.z - 0.35);
  if (o.rearSeats) seat(0, o.eye.z - 1.35, o.width * 2 - 0.3);
  m.part('interior', 'interior', merge(geos), { finish: 'interior', sound: 'plastic' });

  // Glowing gauges in front of the driver.
  // Small dials set into the dash face, below the steering wheel's line of sight.
  const gauges = merge([
    cyl({ at: [o.eye.x - 0.07, o.dashY + 0.02, dashZ - 0.255], radius: 0.035, length: 0.01, axis: 'z', segments: 14, color: 0x2a6f9a }),
    cyl({ at: [o.eye.x + 0.07, o.dashY + 0.02, dashZ - 0.255], radius: 0.035, length: 0.01, axis: 'z', segments: 14, color: 0x2a6f9a }),
  ]);
  m.detail(gauges, 'interior');

  // Steering wheel on a pivot so it can turn with the front wheels.
  const pivot = new THREE.Group();
  pivot.position.set(o.eye.x, o.eye.y - 0.44, o.eye.z + 0.6);
  pivot.rotation.x = -0.45;
  const wheel = new THREE.Mesh(
    merge([
      torus([0, 0, 0], 0.17, 0.022, [0, 0, 0], 0x1d1d1f),
      rbox({ at: [0, -0.02, 0], size: [0.3, 0.05, 0.03], radius: 0.012, color: 0x1d1d1f }),
      rbox({ at: [0, -0.09, 0], size: [0.05, 0.14, 0.03], radius: 0.012, color: 0x1d1d1f }),
      blob([0, -0.02, 0.01], [0.06, 0.05, 0.03], 0x2a2a2d),
    ]),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
  );
  pivot.add(wheel);
  m.root.add(pivot);
  m.steeringWheel = wheel;
}

export interface EngineOpts {
  /** Centre of the engine block (car local). */
  at: [number, number, number];
  /** Bay width (m) — sizes the block and radiator. */
  width: number;
  cylinders: 6 | 12;
  /** Radiator sits in front of the engine (front-engined cars). */
  radiatorZ?: number;
  accent: number;
}

/**
 * The engine you see when the hood is popped open or torn off: block, cylinder
 * banks, intake, air box, radiator, battery, coolant tank and hoses. It dents and
 * scuffs like any other part.
 */
export function engineBay(m: ModelBuilder, o: EngineOpts) {
  const [x, y, z] = o.at;
  const w = o.width;
  const len = o.cylinders === 12 ? 0.95 : 0.7;
  const g: THREE.BufferGeometry[] = [
    rbox({ at: [x, y, z], size: [w * 0.45, 0.32, len], radius: 0.04, color: 0x4b4e53 }), // block
    rbox({ at: [x, y + 0.22, z], size: [w * 0.22, 0.14, len * 0.9], radius: 0.03, color: 0x6d7076 }), // intake plenum
  ];
  // Cylinder banks with valve covers
  for (const side of [-1, 1]) {
    g.push(rbox({ at: [x + side * w * 0.2, y + 0.16, z], size: [w * 0.14, 0.12, len * 0.95], rot: [0, 0, side * -0.45], radius: 0.03, color: 0x2a2c30 }));
    g.push(rbox({ at: [x + side * w * 0.21, y + 0.21, z], size: [w * 0.1, 0.03, len * 0.8], rot: [0, 0, side * -0.45], radius: 0.01, color: o.accent }));
  }
  // Intake runners
  const runners = o.cylinders === 12 ? 6 : 3;
  for (let i = 0; i < runners; i++) {
    const rz = z - len * 0.4 + (i / (runners - 1)) * len * 0.8;
    for (const side of [-1, 1]) g.push(tube([[x, y + 0.27, rz], [x + side * w * 0.1, y + 0.3, rz], [x + side * w * 0.17, y + 0.2, rz]], 0.025, 0x8a8d92, 6, 5));
  }
  // Air box, oil cap, battery (with red/black terminals), coolant tank, hoses
  g.push(rbox({ at: [x + w * 0.32, y + 0.2, z + len * 0.25], size: [w * 0.22, 0.16, 0.3], radius: 0.04, color: 0x1d1e20 }));
  g.push(cyl({ at: [x - w * 0.18, y + 0.27, z + len * 0.3], radius: 0.03, length: 0.03, axis: 'y', segments: 8, color: 0xe0c020 }));
  g.push(rbox({ at: [x - w * 0.34, y + 0.12, z - len * 0.25], size: [0.18, 0.18, 0.26], radius: 0.02, color: 0x18191b }));
  g.push(cyl({ at: [x - w * 0.37, y + 0.23, z - len * 0.33], radius: 0.022, length: 0.04, axis: 'y', segments: 6, color: 0xd62020 }));
  g.push(cyl({ at: [x - w * 0.31, y + 0.23, z - len * 0.33], radius: 0.022, length: 0.04, axis: 'y', segments: 6, color: 0x111111 }));
  g.push(rbox({ at: [x + w * 0.34, y + 0.14, z - len * 0.3], size: [0.12, 0.16, 0.16], radius: 0.03, color: 0xe6e3d8 }));
  g.push(tube([[x + w * 0.1, y + 0.05, z + len * 0.5], [x + w * 0.05, y + 0.02, z + len * 0.7], [x, y, z + len * 0.85]], 0.03, 0x111214, 8, 5));
  g.push(tube([[x - w * 0.1, y + 0.2, z + len * 0.45], [x - w * 0.08, y + 0.15, z + len * 0.7], [x, y + 0.1, z + len * 0.85]], 0.03, 0x111214, 8, 5));
  if (o.radiatorZ !== undefined) {
    g.push(rbox({ at: [x, y + 0.05, o.radiatorZ], size: [w * 0.85, 0.42, 0.06], radius: 0.01, color: 0x1a1b1d }));
    for (let i = 0; i < 6; i++) g.push(box({ at: [x, y - 0.12 + i * 0.07, o.radiatorZ + 0.035], size: [w * 0.8, 0.012, 0.01], color: 0x44474c }));
  }
  m.part('engine', 'trim', merge(g), { finish: 'engine', sound: 'metal' });
}
