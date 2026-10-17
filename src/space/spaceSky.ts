// The sky out in space, all in one shader on a dome round the camera: black with stars
// and a faint nebula, the sun, the Moon, and the Earth far below, blue oceans and green
// and sandy land under swirling clouds, lit on its sunny side, with a glowing rim of air.
import * as THREE from 'three';
import { SUN_DIR } from '../fx/Sky';

const vertexShader = `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const fragmentShader = `
uniform vec3 sunDir; uniform float time;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), u.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm(vec3 p) { return noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.1) * 0.15 + noise(p * 8.3) * 0.1; }
// Where a ray from the middle meets a sphere (distance, or -1).
float hitSphere(vec3 d, vec3 c, float r) {
  float b = dot(d, c), q = dot(c, c) - r * r, h = b * b - q;
  if (h < 0.0 || b < 0.0) return -1.0;
  return b - sqrt(h);
}
void main() {
  vec3 d = normalize(vDir);
  // Stars: a few sizes on grids of directions, twinkling a little.
  vec3 col = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float sc = k == 0 ? 160.0 : 420.0;
    vec3 g = d * sc, cell = floor(g);
    float h = hash(cell + float(k) * 17.0);
    if (h > (k == 0 ? 0.985 : 0.965)) {
      vec3 sp = cell + 0.5 + (vec3(hash(cell + 3.1), hash(cell + 5.7), hash(cell + 9.2)) - 0.5) * 0.6;
      float dist = length(g - sp);
      float b = smoothstep(0.42, 0.0, dist) * (0.6 + 0.4 * sin(time * (1.0 + h * 4.0) + h * 40.0));
      col += mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash(cell + 1.3)) * b * (k == 0 ? 1.6 : 0.8);
    }
  }
  // A soft nebula band across the sky.
  float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.55, -0.78))) * 3.2, 2.0));
  float n = fbm(d * 3.0 + 1.7);
  col += band * (vec3(0.16, 0.05, 0.22) * n + vec3(0.02, 0.08, 0.18) * fbm(d * 6.0)) * 1.4;
  // The sun.
  float s = max(dot(d, sunDir), 0.0);
  col += vec3(1.0, 0.95, 0.85) * (pow(s, 900.0) * 30.0 + pow(s, 60.0) * 0.4 + pow(s, 8.0) * 0.05);
  // The Moon, off to one side.
  vec3 mc = normalize(vec3(-0.75, 0.32, -0.58)) * 100.0;
  float mt = hitSphere(d, mc, 4.0);
  if (mt > 0.0) {
    vec3 nrm = normalize(d * mt - mc);
    float crater = fbm(nrm * 6.0);
    float lit = max(dot(nrm, sunDir), 0.0);
    col = vec3(0.78, 0.77, 0.74) * (0.55 + 0.45 * crater) * (0.05 + lit);
  }
  // The Earth, far below.
  vec3 ec = vec3(0.0, -1.0, 0.25) * 1300.0;
  float er = 1000.0;
  float et = hitSphere(d, ec, er);
  // Air glow round its edge.
  float bb = dot(d, ec), h2 = bb * bb - dot(ec, ec) + er * er;
  float rim = bb > 0.0 ? exp(-abs(h2) / 60000.0) : 0.0;
  if (et > 0.0) {
    vec3 nrm = normalize(d * et - ec);
    vec3 q = nrm * 2.2;
    float land = smoothstep(0.52, 0.56, fbm(q + vec3(4.0, 1.0, 2.0)));
    float lat = abs(nrm.z);
    vec3 ground = mix(vec3(0.16, 0.4, 0.14), vec3(0.62, 0.52, 0.32), smoothstep(0.45, 0.7, fbm(q * 2.0 + 7.0)));
    vec3 surf = mix(vec3(0.02, 0.12, 0.38), ground, land);
    surf = mix(surf, vec3(0.92), smoothstep(0.82, 0.9, lat)); // ice caps
    float cloud = smoothstep(0.5, 0.75, fbm(nrm * 5.0 + vec3(time * 0.004, 0.0, time * 0.002)));
    surf = mix(surf, vec3(1.0), cloud * 0.85);
    float lit = dot(nrm, sunDir);
    vec3 c = surf * (0.03 + smoothstep(-0.15, 0.6, lit));
    // The ocean shines where the sun reflects in it.
    vec3 refl = reflect(d, nrm);
    c += vec3(1.0, 0.9, 0.7) * pow(max(dot(refl, sunDir), 0.0), 40.0) * (1.0 - land) * (1.0 - cloud) * 0.6;
    // Hazy blue at the limb.
    float limb = pow(1.0 - max(dot(-d, nrm), 0.0), 3.0);
    c = mix(c, vec3(0.35, 0.6, 1.0) * (0.2 + max(lit, 0.0)), limb * 0.8);
    col = c;
  }
  col += vec3(0.3, 0.55, 1.0) * rim * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The space sky dome (follows the camera, one draw call). */
export function createSpaceSky(radius: number) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { sunDir: { value: SUN_DIR.clone() }, time: { value: 0 } },
    vertexShader,
    fragmentShader,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}
