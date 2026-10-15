export type CarId = 'bronco' | 'lambo' | 'wrangler';

/** How the synthesized engine sounds. Based loosely on each real engine. */
export interface EngineSound {
  cylinders: number;
  idleRpm: number;
  redlineRpm: number;
  gears: number;
  /** Seconds the RPM takes to drop and recover during a shift. */
  shiftTime: number;
  turbo: boolean;
  /** Chance per lift-off of exhaust pops/crackles (0..1). */
  popChance: number;
  /** Base low-pass cutoff (Hz): lower = deeper, more muffled. */
  tone: number;
  /** Firing-pulse irregularity: 0 = silky (V12), higher = burbly/gravelly. */
  roughness: number;
  /** How loud wind noise gets at speed (open-top Jeep is loudest). */
  wind: number;
  /** Overall loudness trim. */
  volume: number;
  /** Pitch multiplier on the synthesized engine (1 = true firing frequency). */
  pitch: number;
  /** Low-octave weight (0..1): more = deeper, fuller engine. */
  body: number;
}

export interface VehicleSpec {
  id: CarId;
  name: string;
  blurb: string;
  mass: number; // kg
  /** Chassis collider half extents and center height (m). Body origin is at ground level. */
  half: { x: number; y: number; z: number };
  chassisY: number;
  /** Center of mass height — kept low so the car doesn't tip over too easily. */
  comY: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  wheelWidth: number;
  suspensionRest: number;
  suspensionStiffness: number;
  /** Launch acceleration (m/s²) and top speed (m/s). */
  accel: number;
  topSpeed: number;
  reverseSpeed: number;
  /** Max front-wheel steering angle at low speed (rad). */
  maxSteer: number;
  /** Tire grip multiplier. */
  grip: number;
  /** Aero downforce coefficient (N per (m/s)²). */
  downforce: number;
  /** Higher = takes less damage from the same hit. */
  durability: number;
  /** Driver eye position (car local: +x left, +y up, +z forward). */
  eye: { x: number; y: number; z: number };
  engine: EngineSound;
}

export const SPECS: Record<CarId, VehicleSpec> = {
  bronco: {
    id: 'bronco',
    name: 'Ford Bronco Badlands',
    blurb: 'Big, tough, huge tires',
    mass: 2500,
    half: { x: 0.98, y: 0.7, z: 2.38 },
    chassisY: 1.2,
    comY: 0.72,
    wheelbase: 2.95,
    track: 1.76,
    wheelRadius: 0.445, // 35" Sasquatch tires
    wheelWidth: 0.32,
    suspensionRest: 0.34,
    suspensionStiffness: 26,
    accel: 6.5,
    topSpeed: 47, // ~105 mph
    reverseSpeed: 14,
    maxSteer: 0.6,
    grip: 1.0,
    downforce: 1.0,
    durability: 1.45,
    eye: { x: 0.4, y: 1.56, z: 0.3 },
    engine: {
      cylinders: 6, idleRpm: 700, redlineRpm: 6000, gears: 10, shiftTime: 0.12,
      turbo: true, popChance: 0.05, tone: 700, roughness: 0.1, wind: 0.6, volume: 1.0, pitch: 1, body: 0.55,
    },
  },
  lambo: {
    id: 'lambo',
    name: 'Lamborghini Aventador',
    blurb: 'Super fast, not very tough',
    mass: 1600,
    // Collision box sits higher than the visual body's underside: the real car's
    // tiny ground clearance made the box scrape the road at speed (phantom crashes).
    half: { x: 0.98, y: 0.39, z: 2.36 },
    chassisY: 0.71,
    comY: 0.38,
    wheelbase: 2.7,
    track: 1.72,
    wheelRadius: 0.36,
    wheelWidth: 0.34,
    suspensionRest: 0.18,
    suspensionStiffness: 55,
    accel: 9.5,
    topSpeed: 72, // ~160 mph
    reverseSpeed: 14,
    maxSteer: 0.55,
    grip: 1.12,
    downforce: 1.4,
    durability: 0.85,
    eye: { x: 0.36, y: 1.04, z: -0.05 },
    engine: {
      cylinders: 12, idleRpm: 1000, redlineRpm: 8500, gears: 7, shiftTime: 0.08,
      turbo: false, popChance: 0.7, tone: 1400, roughness: 0.04, wind: 0.4, volume: 1.0, pitch: 0.62, body: 0.6,
    },
  },
  wrangler: {
    id: 'wrangler',
    name: 'Jeep Wrangler',
    blurb: '2-door, open top, goes anywhere',
    mass: 1900,
    half: { x: 0.92, y: 0.66, z: 2.17 }, // 2-door
    chassisY: 1.16,
    comY: 0.68,
    wheelbase: 2.46,
    track: 1.62,
    wheelRadius: 0.42, // 33" Rubicon tires
    wheelWidth: 0.3,
    suspensionRest: 0.3,
    suspensionStiffness: 28,
    accel: 6.0,
    topSpeed: 44, // ~98 mph
    reverseSpeed: 14,
    maxSteer: 0.62,
    grip: 1.05,
    downforce: 1.0,
    durability: 1.15,
    eye: { x: 0.38, y: 1.5, z: -0.15 },
    engine: {
      cylinders: 6, idleRpm: 700, redlineRpm: 6400, gears: 8, shiftTime: 0.14,
      turbo: false, popChance: 0.12, tone: 1050, roughness: 0.2, wind: 1.0, volume: 1.0, pitch: 1, body: 0.55,
    },
  },
};

export const CAR_IDS: CarId[] = ['bronco', 'lambo', 'wrangler'];

export const MPH_PER_MS = 2.23694;
