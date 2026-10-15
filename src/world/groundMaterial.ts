// Ground material for highway country: the usual vertex-coloured ground, blended into
// photo-textured desert where the terrain says so (per-vertex `aDesert`: x = how much
// desert, y = how much of that is bare rock, i.e. cliffs and steep slopes).
//
// Sand is mapped flat from above at two scales and angles (so the tiling doesn't show);
// rock is mapped from three directions (triplanar, so cliffs don't stretch) and gets
// horizontal strata like layered sandstone. Both have normal maps for real relief.
import * as THREE from 'three';

const base = import.meta.env.BASE_URL;

function load(file: string, color: boolean) {
  const t = new THREE.TextureLoader().load(`${base}textures/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

export function groundMaterial(groundMap: THREE.Texture) {
  const mat = new THREE.MeshLambertMaterial({ map: groundMap, vertexColors: true });
  const uniforms = {
    sandMap: { value: load('sand_color.webp', true) },
    sandNormal: { value: load('sand_normal.webp', false) },
    rockMap: { value: load('redrock_color.webp', true) },
    rockNormal: { value: load('redrock_normal.webp', false) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aDesert;
        varying vec2 vDesert;
        varying vec3 vWPos;
        varying vec3 vWNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDesert = aDesert;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D sandMap, sandNormal, rockMap, rockNormal;
        varying vec2 vDesert;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        vec3 triW() { vec3 a = pow(abs(normalize(vWNormal)), vec3(4.0)); return a / (a.x + a.y + a.z); }
        const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vDesert.x > 0.002) {
          vec2 p = vWPos.xz;
          // Sand: two scales, and a slow brightness drift so the repeat doesn't show.
          vec3 s1 = texture2D(sandMap, p / 7.0).rgb;
          vec3 s2 = texture2D(sandMap, ROT * p / 29.0).rgb;
          float drift = texture2D(sandMap, p / 230.0).r;
          vec3 sand = mix(s1, s2, 0.45) * vec3(1.08, 0.9, 0.76) * (0.78 + 0.5 * drift);
          // Rock: triplanar, with sandstone strata.
          vec3 w = triW();
          vec3 rock = texture2D(rockMap, vWPos.zy / 16.0).rgb * w.x
                    + texture2D(rockMap, vWPos.xz / 16.0).rgb * w.y
                    + texture2D(rockMap, vWPos.xy / 16.0).rgb * w.z;
          float strata = 0.8 + 0.16 * sin(vWPos.y * 1.9 + 2.0 * sin(vWPos.x * 0.03 + vWPos.z * 0.02)) + 0.1 * sin(vWPos.y * 0.41);
          rock *= strata * vec3(1.15, 0.92, 0.82);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(sand, rock, vDesert.y), vDesert.x);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vDesert.x > 0.002) {
          vec3 ng = normalize(vWNormal);
          vec3 ts = texture2D(sandNormal, vWPos.xz / 7.0).xyz * 2.0 - 1.0;
          vec3 sandN = normalize(ng + vec3(ts.x, 0.0, -ts.y) * 0.9);
          vec3 w = triW();
          vec3 tx = texture2D(rockNormal, vWPos.zy / 16.0).xyz * 2.0 - 1.0;
          vec3 ty = texture2D(rockNormal, vWPos.xz / 16.0).xyz * 2.0 - 1.0;
          vec3 tz = texture2D(rockNormal, vWPos.xy / 16.0).xyz * 2.0 - 1.0;
          vec3 rockN = normalize(ng + (w.x * vec3(0.0, tx.y, tx.x) + w.y * vec3(ty.x, 0.0, -ty.y) + w.z * vec3(tz.x, tz.y, 0.0)) * 1.2);
          vec3 nW = normalize(mix(sandN, rockN, vDesert.y));
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(nW, 0.0)).xyz), vDesert.x));
        }`);
  };
  // Same shader for every chunk (they all share this material).
  mat.customProgramCacheKey = () => 'ground-desert-v1';
  return mat;
}
