// Ground material for highway country: the usual vertex-coloured ground, blended into
// photo-textured regions where the terrain says so. Per vertex, `aBiome` holds how much
// of each region a spot is (desert, forest, farmland, mountains) and `aExtra` how rocky
// it is (cliffs, steep slopes) and how autumnal the forest is.
//
//  desert     rippled sand, and layered red sandstone on the cliffs
//  forest     grass and mossy forest floor, strewn with orange and red leaves in autumn
//  farmland   a patchwork of fields (wheat, green crops, ploughed soil, meadow, corn),
//             each with its rows, and hedges along the edges
//  mountains  snow, with bare grey rock on the steep faces
//
// Flat ground is mapped from above at two scales and angles (so the tiling doesn't
// show); rock is mapped from three directions (triplanar, so cliffs don't stretch).
// Sand, sandstone, snow and grey rock have normal maps for real relief.
import * as THREE from 'three';
import { FIELD_GRID } from './biomes';

const base = import.meta.env.BASE_URL;

function load(file: string, color: boolean) {
  const t = new THREE.TextureLoader().load(`${base}textures/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/** GLSL twin of biomes.ts:fieldCell/fieldHash. */
const FIELDS_GLSL = `
  float fieldHash(vec2 c) {
    vec3 p3 = fract(vec3(c.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  // Field cell (xy) and where in it (zw, 0..1).
  vec4 fieldCell(vec2 p) {
    float c = cos(${FIELD_GRID.rot.toFixed(4)}), s = sin(${FIELD_GRID.rot.toFixed(4)});
    float u = p.x * c - p.y * s, v = p.x * s + p.y * c;
    float fv = v / ${FIELD_GRID.d.toFixed(1)};
    float j = floor(fv);
    float fu = u / ${FIELD_GRID.w.toFixed(1)} + mod(j, 2.0) * 0.5;
    float i = floor(fu);
    return vec4(i, j, fract(fu), fract(fv));
  }`;

export function groundMaterial(groundMap: THREE.Texture) {
  const mat = new THREE.MeshLambertMaterial({ map: groundMap, vertexColors: true });
  const uniforms = {
    sandMap: { value: load('sand_color.webp', true) },
    sandNormal: { value: load('sand_normal.webp', false) },
    rockMap: { value: load('redrock_color.webp', true) },
    rockNormal: { value: load('redrock_normal.webp', false) },
    snowMap: { value: load('snow_color.webp', true) },
    snowNormal: { value: load('snow_normal.webp', false) },
    greyMap: { value: load('greyrock_color.webp', true) },
    greyNormal: { value: load('greyrock_normal.webp', false) },
    grassMap: { value: load('grass_color.webp', true) },
    forestMap: { value: load('forestfloor_color.webp', true) },
    soilMap: { value: load('soil_color.webp', true) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aBiome;
        attribute vec2 aExtra;
        varying vec4 vBiome;
        varying vec2 vExtra;
        varying vec3 vWPos;
        varying vec3 vWNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBiome = aBiome;
        vExtra = aExtra;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D sandMap, sandNormal, rockMap, rockNormal, snowMap, snowNormal, greyMap, greyNormal, grassMap, forestMap, soilMap;
        varying vec4 vBiome;
        varying vec2 vExtra;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        vec3 triW() { vec3 a = pow(abs(normalize(vWNormal)), vec3(4.0)); return a / (a.x + a.y + a.z); }
        vec3 tri(sampler2D m, float scale) {
          vec3 w = triW();
          return texture2D(m, vWPos.zy / scale).rgb * w.x + texture2D(m, vWPos.xz / scale).rgb * w.y + texture2D(m, vWPos.xy / scale).rgb * w.z;
        }
        vec3 triN(sampler2D m, float scale, vec3 ng, float k) {
          vec3 w = triW();
          vec3 tx = texture2D(m, vWPos.zy / scale).xyz * 2.0 - 1.0;
          vec3 ty = texture2D(m, vWPos.xz / scale).xyz * 2.0 - 1.0;
          vec3 tz = texture2D(m, vWPos.xy / scale).xyz * 2.0 - 1.0;
          return normalize(ng + (w.x * vec3(0.0, tx.y, tx.x) + w.y * vec3(ty.x, 0.0, -ty.y) + w.z * vec3(tz.x, tz.y, 0.0)) * k);
        }
        const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
        ${FIELDS_GLSL}
        // Grass from above at two scales, with a slow brightness drift.
        vec3 grassAt(vec2 p) {
          vec3 g = mix(texture2D(grassMap, p / 5.0).rgb, texture2D(grassMap, ROT * p / 17.0).rgb, 0.45);
          return g * (0.8 + 0.4 * texture2D(grassMap, p / 260.0).g);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float total = vBiome.x + vBiome.y + vBiome.z + vBiome.w;
        if (total > 0.002) {
          vec2 p = vWPos.xz;
          float rocky = vExtra.x;
          vec3 col = vec3(0.0);
          if (vBiome.x > 0.002) {
            // Desert: sand, and red sandstone with strata.
            vec3 s1 = texture2D(sandMap, p / 7.0).rgb;
            vec3 s2 = texture2D(sandMap, ROT * p / 29.0).rgb;
            float drift = texture2D(sandMap, p / 230.0).r;
            vec3 sand = mix(s1, s2, 0.45) * vec3(1.08, 0.9, 0.76) * (0.78 + 0.5 * drift);
            vec3 rock = tri(rockMap, 16.0);
            float strata = 0.8 + 0.16 * sin(vWPos.y * 1.9 + 2.0 * sin(vWPos.x * 0.03 + vWPos.z * 0.02)) + 0.1 * sin(vWPos.y * 0.41);
            rock *= strata * vec3(1.15, 0.92, 0.82);
            col += mix(sand, rock, rocky) * vBiome.x;
          }
          if (vBiome.y > 0.002) {
            // Forest: grass with patches of mossy forest floor; autumn leaves on top.
            float patchy = smoothstep(0.35, 0.65, texture2D(grassMap, p / 90.0 + 0.3).g * 1.6 - 0.3);
            vec3 duff = texture2D(forestMap, p / 6.0).rgb * vec3(0.9, 0.85, 0.75);
            vec3 g = mix(grassAt(p) * vec3(0.85, 0.95, 0.8), duff, 0.35 + 0.5 * patchy);
            float leaves = smoothstep(0.3, 0.7, texture2D(forestMap, ROT * p / 3.1).r * 1.4 - 0.15 + 0.3 * texture2D(soilMap, p / 40.0).r);
            vec3 litter = mix(vec3(0.72, 0.33, 0.1), vec3(0.85, 0.6, 0.18), texture2D(sandMap, p / 9.0).r);
            g = mix(g, litter * (0.65 + 0.5 * texture2D(forestMap, p / 2.3).g), vExtra.y * (0.12 + 0.6 * leaves));
            vec3 rock = tri(greyMap, 14.0) * vec3(0.92, 0.9, 0.85);
            col += mix(g, rock, rocky) * vBiome.y;
          }
          if (vBiome.z > 0.002) {
            // Farmland: a patchwork of fields with rows, hedges along their edges.
            vec4 fc = fieldCell(p);
            float kind = floor(fieldHash(fc.xy) * 8.0);
            vec3 grass = grassAt(p);
            vec3 soil = texture2D(soilMap, p / 4.0).rgb * vec3(1.05, 0.95, 0.85);
            float across = fc.z * ${FIELD_GRID.w.toFixed(1)};
            float rows = 0.5 + 0.5 * sin(across * 6.2832 / 2.4);
            float lum = dot(grass, vec3(0.3, 0.59, 0.11));
            vec3 f;
            if (kind < 0.5 || (kind > 4.5 && kind < 5.5)) f = vec3(1.5, 1.22, 0.55) * (lum * 1.6 + 0.06) * (0.9 + 0.12 * rows);        // wheat
            else if (kind < 1.5 || (kind > 5.5 && kind < 6.5)) f = mix(soil * 0.85, grass * vec3(0.95, 1.15, 0.7), smoothstep(0.35, 0.6, rows)); // green crop rows
            else if (kind < 2.5) f = soil * (0.82 + 0.25 * rows);                                                                          // ploughed
            else if (kind < 3.5 || kind > 6.5) f = grass * vec3(1.05, 1.08, 0.85);                                                        // meadow
            else f = mix(soil * 0.7, grass * vec3(0.62, 0.85, 0.42), smoothstep(0.25, 0.5, rows));                                     // corn
            // Hedges along the field edges.
            vec2 toEdge = vec2(min(fc.z, 1.0 - fc.z) * ${FIELD_GRID.w.toFixed(1)}, min(fc.w, 1.0 - fc.w) * ${FIELD_GRID.d.toFixed(1)});
            float hedge = 1.0 - smoothstep(1.6, 2.6, min(toEdge.x, toEdge.y));
            f = mix(f, grass * vec3(0.45, 0.62, 0.35), hedge);
            vec3 rock = tri(greyMap, 14.0) * vec3(0.95, 0.9, 0.8);
            col += mix(f, rock, rocky) * vBiome.z;
          }
          if (vBiome.w > 0.002) {
            // Mountains: snow, bare grey rock on the steep faces (a dusting of snow in its cracks).
            vec3 s1 = texture2D(snowMap, p / 6.0).rgb;
            vec3 s2 = texture2D(snowMap, ROT * p / 23.0).rgb;
            vec3 snow = mix(s1, s2, 0.5) * vec3(0.95, 0.97, 1.02) * (0.9 + 0.12 * texture2D(snowMap, p / 300.0).r);
            vec3 rock = tri(greyMap, 18.0) * vec3(1.0, 1.02, 1.08);
            float r = smoothstep(0.15, 0.75, rocky + 0.25 * (tri(greyMap, 5.0).r - 0.5));
            col += mix(snow, rock, r) * vBiome.w;
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, col / total, min(1.0, total));
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float tn = vBiome.x + vBiome.w;
        if (tn > 0.002) {
          vec3 ng = normalize(vWNormal);
          vec3 nW = vec3(0.0);
          if (vBiome.x > 0.002) {
            vec3 ts = texture2D(sandNormal, vWPos.xz / 7.0).xyz * 2.0 - 1.0;
            vec3 sandN = normalize(ng + vec3(ts.x, 0.0, -ts.y) * 0.9);
            nW += normalize(mix(sandN, triN(rockNormal, 16.0, ng, 1.2), vExtra.x)) * vBiome.x;
          }
          if (vBiome.w > 0.002) {
            vec3 ts = texture2D(snowNormal, vWPos.xz / 6.0).xyz * 2.0 - 1.0;
            vec3 snowN = normalize(ng + vec3(ts.x, 0.0, -ts.y) * 0.7);
            nW += normalize(mix(snowN, triN(greyNormal, 18.0, ng, 1.3), smoothstep(0.15, 0.75, vExtra.x))) * vBiome.w;
          }
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(normalize(nW), 0.0)).xyz), min(1.0, tn)));
        }`);
  };
  // Same shader for every chunk (they all share this material).
  mat.customProgramCacheKey = () => 'ground-regions-v2';
  return mat;
}
