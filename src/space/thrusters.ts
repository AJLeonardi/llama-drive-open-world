// Space thrusters bolted on the cars up at the station: a white rocket pod on each back
// corner with an orange nose ring and a glowing nozzle, and a blue flame out of each
// that grows with how hard they're firing (VehicleSim.thrust).
import * as THREE from 'three';
import { box, cyl, merge } from '../vehicles/builders/geo';
import type { VehicleSpec } from '../vehicles/VehicleSpec';

let mats: { pod: THREE.Material; glow: THREE.Material; flame: THREE.Material } | null = null;
let flameGeo: THREE.BufferGeometry | null = null;

function materials() {
  return (mats ??= {
    pod: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.4 }),
    glow: new THREE.MeshBasicMaterial({ color: 0x7fe8ff }),
    flame: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  });
}

function flame() {
  if (flameGeo) return flameGeo;
  const g = new THREE.ConeGeometry(0.24, 1.6, 10, 3, true);
  g.rotateX(-Math.PI / 2); // tip towards −z (out the back)
  g.translate(0, 0, -0.8);
  const col: number[] = [];
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, -p.getZ(i) / 1.6);
    const c = new THREE.Color(0xe8fbff).lerp(new THREE.Color(0x2a8cff), t).multiplyScalar(1 - t * 0.85);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return (flameGeo = g);
}

export interface ThrusterKit {
  root: THREE.Group;
  /** 0..1 how hard they fire; `time` makes the flames flicker. */
  set(k: number, time: number): void;
  /** World positions of the nozzles (for the jet particles). */
  nozzles: THREE.Object3D[];
}

export function thrusterKit(spec: VehicleSpec): ThrusterKit {
  const m = materials();
  const root = new THREE.Group();
  const y = spec.chassisY + spec.half.y * 0.35, z = -spec.half.z + 0.55, x = spec.half.x + 0.12;
  const parts: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const flames: THREE.Mesh[] = [];
  const nozzles: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const px = s * x;
    parts.push(cyl({ at: [px, y, z + 0.2], radius: 0.26, length: 1.5, axis: 'z', segments: 14, color: 0xf2f3f5 }));
    parts.push(cyl({ at: [px, y, z + 1.08], radius: 0.26, radiusTop: 0.04, length: 0.42, axis: 'z', segments: 14, color: 0xf06a1c }));
    parts.push(cyl({ at: [px, y, z + 0.78], radius: 0.275, length: 0.1, axis: 'z', segments: 14, color: 0xf06a1c }));
    parts.push(cyl({ at: [px, y, z - 0.68], radius: 0.3, radiusTop: 0.2, length: 0.3, axis: 'z', segments: 14, color: 0x3a3d42 }));
    // A little fin on top, and the bracket down to the body.
    parts.push(box({ at: [px, y + 0.36, z - 0.3], size: [0.05, 0.24, 0.55], color: 0xd22a22, seg: 100 }));
    parts.push(cyl({ at: [px - s * 0.12, y - 0.22, z + 0.2], radius: 0.06, length: 0.5, axis: 'y', segments: 6, color: 0x55585c }));
    glow.push(cyl({ at: [px, y, z - 0.84], radius: 0.18, length: 0.04, axis: 'z', segments: 14, color: 0xffffff }));
    const f = new THREE.Mesh(flame(), m.flame);
    f.position.set(px, y, z - 0.85);
    f.visible = false;
    f.frustumCulled = false;
    root.add(f);
    flames.push(f);
    nozzles.push(f);
  }
  const pod = new THREE.Mesh(merge(parts), m.pod);
  pod.castShadow = true;
  root.add(pod, new THREE.Mesh(merge(glow), m.glow));
  return {
    root,
    nozzles,
    set(k, time) {
      flames.forEach((f, i) => {
        f.visible = k > 0.03;
        if (!f.visible) return;
        const flick = 0.8 + 0.2 * Math.sin(time * 41 + i * 1.7);
        f.scale.set(0.6 + 0.4 * k, 0.6 + 0.4 * k, (0.4 + 1.4 * k) * flick);
      });
    },
  };
}
