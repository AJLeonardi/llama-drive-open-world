// Road surfaces: a CC0 photo of asphalt (with its normal map, for real grit), laid in
// world space at two scales so the repeat doesn't show, under the code-drawn lane
// markings and tyre wear (a see-through texture following the road's own UVs).
import * as THREE from 'three';

const base = import.meta.env.BASE_URL;
let shared: { color: THREE.Texture; normal: THREE.Texture } | null = null;

function asphalt() {
  if (shared) return shared;
  const load = (file: string, color: boolean) => {
    const t = new THREE.TextureLoader().load(`${base}textures/${file}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return (shared = { color: load('asphalt_color.webp', true), normal: load('asphalt_normal.webp', false) });
}

/** A road material. `markings` (see-through, road UVs) go on top of the asphalt photo; null = plain asphalt. */
export function roadMaterial(markings: THREE.Texture | null) {
  const a = asphalt();
  const mat = new THREE.MeshLambertMaterial({
    map: markings ?? undefined,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.asphaltMap = { value: a.color };
    shader.uniforms.asphaltNormal = { value: a.normal };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoadPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoadPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D asphaltMap, asphaltNormal;
        varying vec3 vRoadPos;
        const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);`)
      .replace('#include <map_fragment>', `
        vec2 rp = vRoadPos.xz;
        vec3 asph = mix(texture2D(asphaltMap, rp / 6.0).rgb, texture2D(asphaltMap, ROT * rp / 23.0).rgb, 0.4);
        // Brought up to the roads' usual grey (the photo is a dark asphalt), with a slow
        // light/dark drift so long roads don't look uniform.
        asph *= vec3(1.75, 1.78, 1.86) * (0.88 + 0.3 * texture2D(asphaltMap, rp / 170.0).g);
        #ifdef USE_MAP
          vec4 mk = texture2D(map, vMapUv);
          diffuseColor.rgb *= mix(asph, mk.rgb, mk.a);
        #else
          diffuseColor.rgb *= asph;
        #endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 tn = texture2D(asphaltNormal, rp / 6.0).xyz * 2.0 - 1.0;
          vec3 nW = normalize(vec3(tn.x * 0.8, 1.0, -tn.y * 0.8));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`);
  };
  mat.customProgramCacheKey = () => `road-asphalt-${markings ? 'marked' : 'plain'}`;
  return mat;
}
