import * as THREE from 'three';
import { Finish, ModelBuilder, carMaterials } from '../CarModel';
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
  /** Seat-back height scale (low supercar seats < 1, so headrests fit under the roof). */
  seatBack?: number;
  eye: { x: number; y: number; z: number };
  width: number;
  rearSeats: boolean;
  color: number;
  seatColor: number;
}

/** A round gauge face (speedometer or rev counter), drawn once and shared. */
const gaugeFaces = new Map<string, THREE.Texture>();
function gaugeFace(kind: 'speed' | 'rpm') {
  let t = gaugeFaces.get(kind);
  if (t) return t;
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const cx = S / 2, cy = S / 2, R = S * 0.47;
  g.fillStyle = '#0d0f12';
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#9aa3ad';
  g.lineWidth = 5;
  g.stroke();
  const max = kind === 'speed' ? 160 : 8, major = kind === 'speed' ? 20 : 1;
  // Dial runs from bottom-left (-135°) clockwise to bottom-right (+135°).
  const ang = (v: number) => (-135 + (270 * v) / max) * (Math.PI / 180) - Math.PI / 2;
  if (kind === 'rpm') {
    g.strokeStyle = '#d6322a';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(cx, cy, R * 0.82, ang(6.5), ang(8));
    g.stroke();
  }
  g.fillStyle = '#ffffff';
  g.font = `bold ${S * 0.085}px -apple-system, Helvetica, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let v = 0; v <= max + 1e-6; v += major / 2) {
    const a = ang(v), big = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    g.strokeStyle = '#ffffff';
    g.lineWidth = big ? 4 : 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * R * (big ? 0.72 : 0.78), cy + Math.sin(a) * R * (big ? 0.72 : 0.78));
    g.lineTo(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86);
    g.stroke();
    if (big) g.fillText(String(v), cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55);
  }
  g.fillStyle = '#8fd0ff';
  g.font = `bold ${S * 0.07}px -apple-system, Helvetica, sans-serif`;
  g.fillText(kind === 'speed' ? 'MPH' : 'x1000 RPM', cx, cy + R * 0.42);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  gaugeFaces.set(kind, t);
  return t;
}

/** Centre-console screen: a glowing navigation display. */
function screenFace() {
  const W = 256, H = 160, c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b1a2b';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2f6ea8';
  g.lineWidth = 6;
  for (const [x0, y0, x1, y1] of [[0, 110, 256, 70], [90, 0, 140, 160], [0, 30, 256, 45], [180, 0, 210, 160]]) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
  g.strokeStyle = '#38a3ff';
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(115, 160);
  g.lineTo(122, 92);
  g.lineTo(256, 64);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(118, 112);
  g.lineTo(108, 132);
  g.lineTo(128, 132);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The cabin: seats, a shaped dashboard set back from the driver, a hooded instrument
 * cluster with a speedometer and rev counter (their needles move: see `gauges`), a
 * glowing centre screen, air vents, and a proper steering wheel in front of it all
 * that turns with the front wheels. No people.
 */
export function interior(m: ModelBuilder, o: InteriorOpts) {
  const ex = o.eye.x, ez = o.eye.z;
  const face = ez + 0.6; // the dash's face, towards the driver
  const depth = 0.55;
  const geos: THREE.BufferGeometry[] = [
    // Dash: lower body, a padded top that runs forward under the windshield, a lip over the face
    rbox({ at: [0, o.dashY - 0.08, face + depth / 2], size: [o.width * 2 - 0.08, 0.3, depth], radius: 0.06, color: o.color }),
    rbox({ at: [0, o.dashY + 0.08, face + depth / 2 + 0.05], size: [o.width * 2 - 0.12, 0.09, depth], radius: 0.04, color: 0x2c2d31 }),
    // Centre stack down to the console, and the console between the seats
    rbox({ at: [0, o.dashY - 0.22, face + 0.08], size: [0.34, 0.3, 0.2], radius: 0.04, color: o.color }),
    rbox({ at: [0, o.seatY + 0.12, ez - 0.05], size: [0.22, 0.25, 1.0], radius: 0.05, color: o.color }),
    // Instrument binnacle with a visor, in front of the driver
    rbox({ at: [ex, o.dashY + 0.1, face + 0.06], size: [0.42, 0.16, 0.14], radius: 0.04, color: 0x1a1b1e }),
    rbox({ at: [ex, o.dashY + 0.19, face + 0.03], size: [0.46, 0.035, 0.18], rot: [-0.25, 0, 0], radius: 0.015, color: 0x1a1b1e }),
  ];
  // Air vents (dark slatted rectangles) and a couple of knobs
  for (const vx of [o.width - 0.18, -(o.width - 0.18), 0.08, -0.08]) {
    geos.push(rbox({ at: [vx, o.dashY + 0.0, face - 0.005], size: [vx === 0.08 || vx === -0.08 ? 0.12 : 0.16, 0.07, 0.02], radius: 0.01, color: 0x0e0f11 }));
    for (const dy of [-0.02, 0, 0.02]) geos.push(box({ at: [vx, o.dashY + dy, face - 0.018], size: [0.13, 0.006, 0.01], color: 0x3a3c40 }));
  }
  for (const kx of [-0.06, 0.06]) geos.push(cyl({ at: [kx, o.dashY - 0.26, face - 0.03], radius: 0.022, length: 0.03, axis: 'z', segments: 12, color: 0x8a8d92 }));

  const k = o.seatBack ?? 1;
  const seat = (x: number, z: number, wide = 0.5) => {
    geos.push(rbox({ at: [x, o.seatY, z], size: [wide, 0.16, 0.52], radius: 0.06, color: o.seatColor }));
    geos.push(rbox({ at: [x, o.seatY + 0.36 * k, z - 0.27], size: [wide, 0.62 * k, 0.14], rot: [-0.18, 0, 0], radius: 0.06, color: o.seatColor }));
    geos.push(rbox({ at: [x, o.seatY + 0.76 * k, z - 0.36], size: [Math.min(wide, 0.28), 0.18, 0.1], rot: [-0.18, 0, 0], radius: 0.04, color: o.seatColor }));
  };
  seat(ex, ez - 0.35);
  seat(-ex, ez - 0.35);
  if (o.rearSeats) seat(0, ez - 1.35, o.width * 2 - 0.3);
  m.part('interior', 'interior', merge(geos), { finish: 'interior', sound: 'plastic' });

  // Gauge faces (self-lit) and their needles, set into the binnacle's face.
  const gy = o.dashY + 0.1, gz = face - 0.012;
  const needles: THREE.Object3D[] = [];
  for (const [kind, dx] of [['rpm', -0.1], ['speed', 0.1]] as const) {
    // (+x is the car's left, so from the driver's seat the speedometer is on the right.)
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.068, 32), new THREE.MeshBasicMaterial({ map: gaugeFace(kind) }));
    dial.rotation.y = Math.PI; // face the driver
    dial.position.set(ex - dx, gy, gz);
    m.root.add(dial);
    const pivot = new THREE.Group();
    pivot.position.set(ex - dx, gy, gz - 0.004);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.058, 0.003), new THREE.MeshBasicMaterial({ color: 0xff3b2e }));
    needle.geometry.translate(0, 0.024, 0);
    pivot.add(needle);
    pivot.rotation.y = Math.PI;
    m.root.add(pivot);
    needles.push(pivot);
  }
  m.gauges = { rpm: needles[0], speed: needles[1] };
  // Centre screen
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.15), new THREE.MeshBasicMaterial({ map: screenFace() }));
  screen.rotation.y = Math.PI;
  screen.position.set(0, o.dashY - 0.03, face - 0.012);
  m.root.add(screen);

  // Steering wheel on a column, well in front of the dash, turning with the front wheels.
  const pivot = new THREE.Group();
  pivot.position.set(ex, o.eye.y - 0.38, ez + 0.4);
  // Tilted like a real wheel: top leaning away from the driver, column running forward
  // and down into the dash. (Local +z is forward; +x rotation tips +y forward.)
  pivot.rotation.x = 0.42;
  const R = 0.19;
  const spoke = (a: number) => {
    const g = rbox({ at: [0, -R * 0.5, 0], size: [0.045, R, 0.025], radius: 0.01, color: 0x26272a });
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(a));
    return g;
  };
  const wheel = new THREE.Mesh(
    merge([
      torus([0, 0, 0], R, 0.026, [0, 0, 0], 0x1d1d1f), // the rim
      spoke(0), spoke(Math.PI / 2 + 0.25), spoke(-Math.PI / 2 - 0.25),
      cyl({ at: [0, 0, 0.012], radius: 0.06, length: 0.05, axis: 'z', segments: 20, color: 0x2a2b2e }), // hub
      cyl({ at: [0, 0, -0.016], radius: 0.022, length: 0.01, axis: 'z', segments: 16, color: 0xb8bcc2 }), // badge
    ]),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
  );
  pivot.add(wheel);
  // Column from the hub into the dash
  const column = new THREE.Mesh(cyl({ at: [0, 0, 0.17], radius: 0.035, length: 0.3, axis: 'z', segments: 10, color: 0x1a1b1e }), carMaterials().interior);
  pivot.add(column);
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

export interface UnderbodyOpts {
  wheelbase: number;
  track: number;
  wheelRadius: number;
  /** Height of the frame rails (car local). */
  frameY: number;
  /** Half-spacing of the frame rails. */
  railX: number;
  /** Front and back of the frame. */
  z0: number;
  z1: number;
  /** Trucks: ladder frame and solid axles. Supercars: a carbon tub floor and wishbones. */
  ladder: boolean;
  /** Where the engine sits (exhaust starts there); front- or mid-engined. */
  engineZ: number;
}

/**
 * What's under the body: frame rails and cross-members (or a carbon tub floor), a
 * floor pan, suspension arms and coil-overs at every wheel, axles or half-shafts, the
 * driveshaft, fuel tank and exhaust. It shows from below (the body shell's flat
 * bottom is opened up, like a real car's) and through holes torn in the bodywork.
 */
export function underbody(m: ModelBuilder, o: UnderbodyOpts) {
  const STEEL = 0x3a3c40, DARK = 0x222326, SPRING = 0xc0392b, PIPE = 0x6f6a64;
  const g: THREE.BufferGeometry[] = [];
  const zm = (o.z0 + o.z1) / 2, len = o.z1 - o.z0;
  const az = o.wheelbase / 2, hx = o.track / 2;
  // Floor pan
  g.push(box({ at: [0, o.frameY + 0.1, zm], size: [o.railX * 2 + 0.55, 0.03, len * 0.82], color: o.ladder ? 0x1e1f21 : 0x161718 }));
  if (o.ladder) {
    for (const side of [-1, 1]) g.push(rbox({ at: [side * o.railX, o.frameY, zm], size: [0.1, 0.17, len], radius: 0.02, color: STEEL }));
    for (let z = o.z0 + 0.15; z <= o.z1; z += len / 5) g.push(rbox({ at: [0, o.frameY, z], size: [o.railX * 2, 0.1, 0.08], radius: 0.015, color: STEEL }));
  } else {
    // Carbon tub: wide side sills and a centre tunnel.
    for (const side of [-1, 1]) g.push(rbox({ at: [side * (o.railX + 0.12), o.frameY + 0.06, zm], size: [0.26, 0.18, len * 0.62], radius: 0.04, color: 0x1a1b1e }));
    g.push(rbox({ at: [0, o.frameY + 0.12, zm + 0.2], size: [0.3, 0.2, len * 0.55], radius: 0.05, color: 0x1a1b1e }));
  }
  for (const wz of [az, -az]) {
    // Axle or half-shafts
    if (o.ladder) {
      g.push(cyl({ at: [0, o.wheelRadius, wz], radius: 0.06, length: o.track - 0.3, axis: 'x', segments: 10, color: DARK }));
      g.push(blob([0, o.wheelRadius, wz], [0.2, 0.17, 0.18], DARK, 10)); // differential
    } else {
      for (const side of [-1, 1]) g.push(cyl({ at: [side * hx * 0.5, o.wheelRadius, wz], radius: 0.035, length: hx - 0.15, axis: 'x', segments: 8, color: PIPE }));
    }
    for (const side of [-1, 1]) {
      const hubX = side * (hx - 0.2);
      // Lower arms (an A shape from the frame to the hub)
      for (const dz of [-0.28, 0.28]) g.push(tube([[side * o.railX, o.frameY - 0.04, wz + dz], [hubX, o.wheelRadius - 0.08, wz]], 0.03, STEEL, 2, 6));
      // Coil-over: spring round a damper, from the hub up to the frame
      const top: [number, number, number] = [side * (o.railX + 0.08), o.frameY + 0.38, wz - 0.05];
      const bot: [number, number, number] = [hubX * 0.92, o.wheelRadius + 0.02, wz];
      g.push(tube([bot, top], 0.035, 0x1b1b1d, 2, 8));
      const coil: [number, number, number][] = [];
      for (let i = 0; i <= 48; i++) {
        const t = i / 48, a = t * Math.PI * 2 * 6;
        const cx = bot[0] + (top[0] - bot[0]) * t, cy = bot[1] + (top[1] - bot[1]) * t, cz = bot[2] + (top[2] - bot[2]) * t;
        coil.push([cx + Math.cos(a) * 0.085, cy + Math.sin(a) * 0.02, cz + Math.sin(a) * 0.085]);
      }
      g.push(tube(coil, 0.014, SPRING, 96, 5));
    }
  }
  // Driveshaft from the gearbox to the back (or front) axle
  const gearZ = o.engineZ > 0 ? o.engineZ - 0.7 : o.engineZ + 0.7;
  g.push(cyl({ at: [0, o.frameY - 0.02, (gearZ - az * Math.sign(o.engineZ)) / 2], radius: 0.045, length: Math.abs(gearZ + az * Math.sign(o.engineZ)), axis: 'z', segments: 10, color: PIPE }));
  // Fuel tank (between the rear wheels' front and the cabin)
  g.push(rbox({ at: [o.railX * 0.4, o.frameY - 0.02, -az + 0.75], size: [0.62, 0.22, 0.55], radius: 0.05, color: 0x2a2b2e }));
  // Exhaust: from the engine along one side to a muffler and out the back
  const ex = -o.railX * 0.65, ey = o.frameY - 0.08;
  g.push(tube([[0, ey + 0.1, o.engineZ], [ex, ey, gearZ], [ex, ey, -az + 0.2], [ex, ey + 0.05, o.z0 - 0.05]], 0.04, PIPE, 30, 8));
  g.push(rbox({ at: [ex, ey, -az + 0.9], size: [0.26, 0.2, 0.6], radius: 0.06, color: PIPE }));
  m.part('chassis', 'trim', merge(g), { finish: 'engine', sound: 'metal' });

  // Open up the body shell's flat bottom so all this shows from below.
  const body = m.parts.find((p) => p.name === 'body');
  if (body) {
    const geo = body.mesh.geometry;
    const pos = geo.attributes.position, index = geo.index!;
    const keep: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      const [ia, ib, ic] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      a.fromBufferAttribute(pos, ia);
      b.fromBufferAttribute(pos, ib);
      c.fromBufferAttribute(pos, ic);
      n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
      const low = Math.max(a.y, b.y, c.y) < o.frameY + 0.12;
      if (!(low && Math.abs(n.y) > 0.8)) keep.push(ia, ib, ic);
    }
    geo.setIndex(keep);
  }
}

/**
 * The body shell is one closed shape, so it has a "lid" across the cabin at waist
 * height that would hide the seats and dashboard. Cut it out (the upward-facing skin
 * inside the cabin area) so the interior shows through the windows.
 */
export function openCabin(m: ModelBuilder, o: { z0: number; z1: number; xMax: number; yMin: number }) {
  const body = m.parts.find((p) => p.name === 'body');
  if (!body) return;
  const geo = body.mesh.geometry;
  const pos = geo.attributes.position, index = geo.index!;
  const keep: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const inside = (v: THREE.Vector3) => v.z > o.z0 && v.z < o.z1 && Math.abs(v.x) < o.xMax && v.y > o.yMin;
  for (let i = 0; i < index.count; i += 3) {
    const [ia, ib, ic] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    if (!(inside(a) && inside(b) && inside(c) && Math.abs(n.y) > 0.6)) keep.push(ia, ib, ic);
  }
  geo.setIndex(keep);
}
