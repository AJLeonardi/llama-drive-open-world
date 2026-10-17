import * as THREE from 'three';

export const SKY_HORIZON = 0xd6e6f2;
export const SKY_TOP = 0x3d8ddb;
/** Direction the sunlight comes from (normalized in use). */
export const SUN_DIR = new THREE.Vector3(0.45, 0.8, 0.35).normalize();

const vertexShader = `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Gradient sky with a soft sun glow and drifting procedural clouds. */
function skyFragment(clouds: boolean) {
  return `
  uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float time; uniform float cloudLight;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(horizon, top, pow(h, 0.55));
    // below the horizon: hazy ground colour
    if (d.y < 0.0) col = mix(horizon, vec3(0.55, 0.6, 0.55), clamp(-d.y * 4.0, 0.0, 1.0));
    float sun = max(dot(d, sunDir), 0.0);
    col += vec3(1.0, 0.92, 0.75) * (pow(sun, 600.0) * 4.0 + pow(sun, 18.0) * 0.25);
    ${clouds ? `
    if (d.y > 0.02) {
      vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(time * 0.004, time * 0.002);
      float n = noise(uv) * 0.55 + noise(uv * 2.1) * 0.28 + noise(uv * 4.3) * 0.17;
      float c = smoothstep(0.5, 0.78, n) * smoothstep(0.02, 0.2, d.y);
      col = mix(col, vec3(1.0, 1.0, 1.0) * (0.92 + 0.08 * sun), c * 0.85 * cloudLight);
    }` : ''}
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
}

export function skyMaterial(clouds = true) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(SKY_TOP) },
      horizon: { value: new THREE.Color(SKY_HORIZON) },
      sunDir: { value: SUN_DIR.clone() },
      time: { value: 0 },
      /** 1: clouds; fading to 0 on the way up to space. */
      cloudLight: { value: 1 },
    },
    vertexShader,
    fragmentShader: skyFragment(clouds),
  });
}

/** Sky dome that follows the camera (one draw call). */
export function createSky() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(780, 24, 16), skyMaterial(true));
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

/**
 * Pre-filtered environment map of the sky (plus a ground bounce), so paint,
 * chrome, glass and water get believable reflections without real-time cost.
 */
export function createEnvironment(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial(false)));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(48, 32), new THREE.MeshBasicMaterial({ color: 0x6b7560 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -6;
  scene.add(ground);
  // A couple of soft bright panels give paint those nice long highlights.
  for (const [x, z, ry] of [[30, 10, -1.2], [-25, -20, 0.9]] as const) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(30, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    panel.position.set(x, 8, z);
    panel.rotation.y = ry;
    scene.add(panel);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  return env;
}
