import * as THREE from 'three';
import { Physics } from '../physics/Physics';
import { Breakable } from '../damage/Breakable';
import { ParkedCar } from '../vehicles/ParkedCar';
import type { WorldQueries } from '../vehicles/VehicleSim';
import { StaticBatch, Tile } from './batch';
import { BOOST_PADS, LOOP, surfaceAt } from './layout';
import { addTerrainCollider, addTerrainMeshes, sampleTerrain, Terrain, waterMeshes } from './terrain';
import { addBoostPads, addBridges, addIntersections, addRoads, addSidewalks, roadMaterialKey } from './roads';
import { buildBoston } from './boston';
import { buildNYC } from './nyc';
import { buildHighway } from './highway';
import { buildDirtTrack } from './dirtTrack';
import { buildDemoPark } from './demoPark';
import { buildMountain } from './mountain';
import { buildCityStunts } from './cityStunts';
import { OuterWorld } from './OuterWorld';
import { nearOuterRoad } from './outer';
import { groundMaterial } from './groundMaterial';
import { roadMaterial } from './roadMaterial';
import type { PropSpawn } from './propModels';
import type { ParkedSpawn } from './streetLife';
import { boostTexture, dirtRoadTexture, groundTexture, roadTexture, sidewalkTexture, storefrontTexture, windowTexture, WindowStyle } from '../util/textures';
import type { RoadKind } from './layout';
import { pointInRect } from '../util/math';

/** View distance for whole tiles (fog hides the cut-off). */
export const VIEW_DISTANCE = 700;

function materials(): Record<string, THREE.Material> {
  const road = (map: THREE.Texture) =>
    new THREE.MeshLambertMaterial({ map, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const lanes: Record<RoadKind, THREE.Texture> = {
    highway: roadTexture(6, true, true),
    avenue: roadTexture(4, false, true),
    street: roadTexture(2, false, true),
    ramp: roadTexture(1, false, true), // like a real exit ramp: white edge lines, no centre line
    dirt: dirtRoadTexture(),
  };
  const out: Record<string, THREE.Material> = {
    ground: new THREE.MeshLambertMaterial({ map: groundTexture(), vertexColors: true }),
    'ground-outer': groundMaterial(groundTexture()),
    plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 }),
    loop: new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.3 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    // (Highway country's 'glow' is its blinking tower lights: this one is plain lit-up colour.)
    neon: new THREE.MeshBasicMaterial({ vertexColors: true }),
    sidewalk: new THREE.MeshLambertMaterial({ map: sidewalkTexture() }),
    store: new THREE.MeshStandardMaterial({ map: storefrontTexture(), roughness: 0.5, metalness: 0.1 }),
    boost: new THREE.MeshBasicMaterial({ map: boostTexture(), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false }),
  };
  // Asphalt roads: the photo asphalt with their markings on top (dirt stays as it was).
  for (const k of Object.keys(lanes) as RoadKind[]) out[roadMaterialKey(k)] = k === 'dirt' ? road(lanes[k]) : roadMaterial(lanes[k]);
  // Junctions: plain asphalt patches and white markings, drawn over the roads.
  out['road-plain'] = roadMaterial(null);
  out['road-marks'] = new THREE.MeshLambertMaterial({ color: 0xeeeeee, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  // Buildings and objects cast shadows; ground, roads and sidewalks only receive them.
  for (const k of ['plain', 'loop', 'store']) out[k].userData.castShadow = true;
  for (const s of ['brick', 'brownstone', 'glass', 'concrete', 'stone', 'pru'] as WindowStyle[])
    out[`win-${s}`] = s === 'glass'
      // Glass towers reflect the sky.
      ? new THREE.MeshStandardMaterial({ map: windowTexture(s), vertexColors: true, metalness: 0.55, roughness: 0.12, envMapIntensity: 1.4 })
      : new THREE.MeshStandardMaterial({ map: windowTexture(s), vertexColors: true, metalness: 0.05, roughness: 0.82 });
  for (const s of ['brick', 'brownstone', 'glass', 'concrete', 'stone', 'pru']) out[`win-${s}`].userData.castShadow = true;
  return out;
}

export class World {
  readonly group = new THREE.Group();
  readonly terrain: Terrain;
  readonly props: Breakable;
  /** Highway country beyond the middle of the map (streamed). */
  readonly outer: OuterWorld;
  parked: ParkedCar[] = [];
  private tiles: Tile[];
  private parkedSpawns: ParkedSpawn[];
  private tileTimer = 0;

  readonly queries: WorldQueries = {
    surfaceAt,
    inStickZone: (x, z) => Math.abs(x - LOOP.x) < LOOP.radius + 12 && Math.abs(z - LOOP.z) < LOOP.lateral + LOOP.width / 2 + 1,
    loopLaneZ: (t) => LOOP.z - LOOP.lateral + 2 * LOOP.lateral * t,
    boostAt: (x, z) => BOOST_PADS.some((p) => pointInRect(x, z, { cx: p.x, cz: p.z, hw: p.width / 2, hd: p.length / 2, rot: p.heading })),
  };

  constructor(private readonly physics: Physics) {
    const batch = new StaticBatch();
    this.terrain = sampleTerrain();
    addTerrainCollider(physics, this.terrain);
    addTerrainMeshes(batch, this.terrain);
    addRoads(batch);
    addIntersections(batch);
    const railProps = addBridges(batch, physics);
    addSidewalks(batch, physics);
    addBoostPads(batch);

    const boston = buildBoston(batch, physics);
    const nyc = buildNYC(batch, physics, this.group);
    const highway = buildHighway(batch, physics, this.group, this.terrain);
    const track = buildDirtTrack(batch, physics, this.group);
    const park = buildDemoPark(batch, physics, this.group);
    const mountain = buildMountain(batch, physics, this.group, this.terrain);
    const stunts = buildCityStunts(batch, physics, this.group);

    const mats = materials();
    this.tiles = batch.build(mats);
    this.outer = new OuterWorld(physics, mats);
    this.group.add(this.outer.group);
    for (const t of this.tiles) {
      this.group.add(t.group);
      for (const m of t.group.children as THREE.Mesh[]) {
        m.receiveShadow = true;
        m.castShadow = !!(m.material as THREE.Material).userData.castShadow;
      }
    }
    for (const w of waterMeshes()) this.group.add(w);

    // (Nothing left standing on the highways out of town, where they start in the middle.)
    const spawns: PropSpawn[] = [...railProps, ...boston.props, ...nyc.props, ...highway.props, ...track.props, ...park.props, ...mountain.props, ...stunts.props]
      .filter((p) => !nearOuterRoad(p.x, p.z, 2));
    this.props = new Breakable(physics, spawns);
    this.group.add(this.props.group);

    this.parkedSpawns = [...boston.parked, ...nyc.parked, ...park.parked, ...stunts.parked].filter((p) => !nearOuterRoad(p.x, p.z, 2));
    this.spawnParked();
  }

  private spawnParked() {
    for (const p of this.parked) p.dispose();
    this.parked = this.parkedSpawns.map((s) => {
      const car = new ParkedCar(this.physics, s.style, s.color, s.x, (s.y ?? 0) + 0.02, s.z, s.heading, s.wrecked);
      this.group.add(car.mesh);
      return car;
    });
  }

  /** Put every smashed thing back, with physics ready around `around`. */
  reset(around?: THREE.Vector3Like) {
    this.props.populate();
    this.spawnParked();
    if (around) {
      this.props.stream(around);
      for (const p of this.parked) if (p.mesh.position.distanceToSquared(new THREE.Vector3(around.x, around.y, around.z)) < 150 * 150) p.activate();
    }
  }

  stats() {
    return { tiles: this.tiles.length, parked: this.parked.length, ...this.outer.stats() };
  }

  update(dt: number, camera: THREE.Vector3, particles: import('../fx/Particles').Particles, debris: import('../fx/Debris').Debris, player: THREE.Vector3 = camera) {
    this.tileTimer -= dt;
    if (this.tileTimer <= 0) {
      this.tileTimer = 0.4;
      for (const t of this.tiles) t.group.visible = Math.hypot(t.cx - camera.x, t.cz - camera.z) < VIEW_DISTANCE;
      for (const p of this.parked) {
        p.mesh.visible = p.mesh.position.distanceToSquared(camera) < 200 * 200;
        // Physics streaming, like the props: bodies only near the player.
        const d2 = p.mesh.position.distanceToSquared(player);
        if (d2 < 150 * 150) p.activate();
        else if (d2 > 210 * 210) p.deactivate();
      }
    }
    this.props.update(dt, particles, debris, camera, player);
    this.outer.update(dt, camera, player);
    for (const p of this.parked) p.sync();
  }
}
