import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const TILE = 400;

/**
 * Collects static world geometry (already in world space) and merges it into one
 * mesh per (tile, material). Tiles far from the camera are hidden entirely, which
 * keeps draw calls low on older iPads.
 */
export class StaticBatch {
  private buckets = new Map<string, Map<string, THREE.BufferGeometry[]>>();

  add(material: string, geo: THREE.BufferGeometry) {
    normalizeAttributes(geo);
    geo.computeBoundingBox();
    const c = geo.boundingBox!.getCenter(new THREE.Vector3());
    const key = `${Math.floor(c.x / TILE)},${Math.floor(c.z / TILE)}`;
    let tile = this.buckets.get(key);
    if (!tile) this.buckets.set(key, (tile = new Map()));
    let list = tile.get(material);
    if (!list) tile.set(material, (list = []));
    list.push(geo);
  }

  build(materials: Record<string, THREE.Material>): Tile[] {
    const tiles: Tile[] = [];
    for (const [key, mats] of this.buckets) {
      const [tx, tz] = key.split(',').map(Number);
      const group = new THREE.Group();
      for (const [matKey, geos] of mats) {
        const merged = mergeGeometries(geos, false);
        if (!merged) throw new Error(`merge failed for ${matKey}`);
        for (const g of geos) g.dispose();
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, materials[matKey]);
        mesh.matrixAutoUpdate = false;
        if (matKey.startsWith('road')) mesh.renderOrder = 1;
        group.add(mesh);
      }
      group.matrixAutoUpdate = false;
      tiles.push({ group, cx: (tx + 0.5) * TILE, cz: (tz + 0.5) * TILE });
    }
    this.buckets.clear();
    return tiles;
  }
}

export interface Tile {
  group: THREE.Group;
  cx: number;
  cz: number;
}

/** Every merged geometry needs the same attributes: non-indexed, position/normal/uv/color. */
export function normalizeAttributes(geo: THREE.BufferGeometry) {
  if (geo.index) {
    const ni = geo.toNonIndexed();
    geo.copy(ni);
    geo.setIndex(null);
    ni.dispose();
  }
  const n = geo.attributes.position.count;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.attributes.color) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  for (const name of Object.keys(geo.attributes)) {
    if (!['position', 'normal', 'uv', 'color'].includes(name)) geo.deleteAttribute(name);
  }
  geo.morphAttributes = {};
  geo.clearGroups();
}
