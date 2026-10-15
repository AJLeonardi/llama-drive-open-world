import * as THREE from 'three';
import { Finish, ModelBuilder } from '../CarModel';
import { blob, box, cyl, latheX, merge, rbox, torus } from './geo';

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
  const gauges = merge([
    cyl({ at: [o.eye.x - 0.09, o.dashY + 0.1, dashZ - 0.27], radius: 0.055, length: 0.01, axis: 'z', segments: 16, color: 0x8fd3ff }),
    cyl({ at: [o.eye.x + 0.09, o.dashY + 0.1, dashZ - 0.27], radius: 0.055, length: 0.01, axis: 'z', segments: 16, color: 0x8fd3ff }),
  ]);
  m.detail(gauges, 'headlight');

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
