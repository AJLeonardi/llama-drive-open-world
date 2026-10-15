import * as THREE from 'three';
import { FIXED_DT, Physics, initPhysics } from '../physics/Physics';
import { Impact, ImpactTracker } from '../physics/Impacts';
import { World } from '../world/World';
import { SPAWN, WATER_LEVEL, isDeepWater } from '../world/layout';
import { Vehicle } from '../vehicles/Vehicle';
import { CarId } from '../vehicles/VehicleSpec';
import { NO_INPUT } from '../vehicles/VehicleSim';
import { Particles } from '../fx/Particles';
import { Debris } from '../fx/Debris';
import { BuildingDamage } from '../fx/BuildingDamage';
import type { BuildingInfo } from '../world/buildings';
import { Underwater } from '../fx/Underwater';
import { SKY_HORIZON, SUN_DIR, createEnvironment, createSky } from '../fx/Sky';
import { Cameras } from '../camera/Cameras';
import { Controls } from '../input/Controls';
import { GameAudio } from '../audio/Audio';
import { Hud } from '../ui/Hud';
import { Garage } from './Garage';
import { Minimap } from '../ui/Minimap';
import type { Prop } from '../damage/Breakable';
import type { ParkedCar } from '../vehicles/ParkedCar';
import { SURFACES } from '../physics/surfaces';
import { MAX_HEALTH } from '../damage/Damage';

type State = 'loading' | 'title' | 'select' | 'drive' | 'paused' | 'wrecked' | 'sinking';

const DUST_COLORS = { dust: 0xb8946a, grass: 0x8a7a50, spray: 0xd8eeff, none: 0 } as const;
const UNDERWATER_COLOR = 0x0d5a86;
const SINK_SECONDS = 3.5;

const tmpV = new THREE.Vector3();

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(72, 1, 0.08, 900);
  private physics!: Physics;
  private world!: World;
  private particles = new Particles();
  private debris!: Debris;
  private buildingDamage = new BuildingDamage();
  private underwater = new Underwater();
  private sky = createSky();
  private garage!: Garage;
  private hud: Hud;
  private controls = new Controls();
  private audio = new GameAudio();
  private cameras!: Cameras;
  private tracker!: ImpactTracker;
  private minimap!: Minimap;

  private car: Vehicle | null = null;
  private carId: CarId = 'bronco';
  private state: State = 'loading';
  private acc = 0;
  private last = 0;
  private stateTimer = 0;
  private upsideTimer = 0;
  private smokeAcc = 0;
  private titleAngle = 0;
  private pixelRatio: number;
  private maxPixelRatio: number;
  private perf = { frames: 0, time: 0, lastRaise: 0 };
  private sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  /** 2 = sharp shadows, 1 = softer/smaller shadow map, 0 = no shadows (slow devices). */
  private shadowTier = 1;
  // Debug overlay is ON by default while we test on different devices; add ?debug=0 to hide it.
  private readonly debug = new URLSearchParams(location.search).get('debug') !== '0';

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.pixelRatio = Math.min(this.maxPixelRatio, 1.25);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const env = createEnvironment(this.renderer);
    this.scene.environment = env;
    this.scene.fog = new THREE.Fog(SKY_HORIZON, 160, 680);
    this.scene.add(new THREE.HemisphereLight(0xdcecff, 0x59633f, 0.9));
    // The sun casts shadows in a box that follows the player's car.
    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -45;
    sun.shadow.camera.right = sun.shadow.camera.top = 45;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.applyShadowTier();
    this.scene.add(sun, sun.target);
    this.scene.add(this.sky, this.particles.group, this.buildingDamage.group, this.underwater.group);

    this.hud = new Hud({
      play: () => this.onPlay(),
      pickCar: (id) => this.startDrive(id),
      openMenu: () => this.pause(true),
      resume: () => this.pause(false),
      newCar: () => this.showSelect(),
      startOver: () => this.startDrive(this.carId),
      toggleSound: () => {
        this.audio.setMuted(!this.audio.muted);
        return !this.audio.muted;
      },
      nextCamera: () => this.cameras.next(),
      flip: () => {
        this.car?.sim.flipUpright();
        this.hud.setFlip(false);
        this.upsideTimer = 0;
      },
      peekDamage: () => this.cameras.reset('orbit'),
    });
    this.hud.show('loading');
    // Tapping the mini-map opens the big map and pauses the game while it's open.
    this.minimap = new Minimap(document.getElementById('ui')!, (open) => {
      if (open && this.car) {
        const p = this.car.model.root.position, f = this.car.sim.forward();
        this.minimap.drawBig(p.x, p.z, f.x, f.z);
      }
      this.audio.suspend(open);
      this.last = performance.now();
    });

    this.controls.onKey = (k) => {
      if (k === 'c' && this.state === 'drive') this.cameras.next();
      if (k === 'escape') this.pause(this.state === 'drive');
      if (k === 'f' && this.car) this.car.sim.flipUpright();
    };
    this.setupOrbitDrag();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'drive') this.pause(true);
      if (document.hidden) this.audio.suspend(true);
      else if (this.state !== 'paused') this.audio.suspend(false);
    });
  }

  async init() {
    await initPhysics();
    // Let the loading text paint before the heavy world build.
    await new Promise((r) => setTimeout(r, 30));
    this.physics = new Physics();
    const t0 = performance.now();
    this.world = new World(this.physics);
    if (this.debug) console.log(`[perf] world built in ${(performance.now() - t0).toFixed(0)} ms`);
    this.scene.add(this.world.group);
    this.debris = new Debris(this.physics, this.scene);
    this.cameras = new Cameras(this.camera, this.physics);
    this.garage = new Garage();
    this.garage.scene.environment = this.scene.environment;
    this.resize();
    this.state = 'title';
    this.hud.show('title');
    this.renderer.compile(this.scene, this.camera);
    requestAnimationFrame((t) => this.frame(t));
    if (this.debug) (window as unknown as { __game: Game }).__game = this;
  }

  // ---------------------------------------------------------------- flow
  private onPlay() {
    this.audio.unlock();
    this.audio.click();
    this.showSelect();
  }

  private showSelect() {
    this.audio.suspend(false);
    this.audio.stopEngine();
    this.state = 'select';
    this.hud.show('select');
  }

  /** Fresh start: the whole world resets, new car at the spawn point. */
  private startDrive(id: CarId) {
    this.audio.unlock();
    this.audio.suspend(false);
    this.carId = id;
    this.car?.dispose();
    this.debris.clear();
    this.buildingDamage.clear();
    this.world.reset({ x: SPAWN.x, y: 0, z: SPAWN.z });
    this.endUnderwater();
    this.car = new Vehicle(this.physics, this.scene, id, SPAWN.x, 0.4, SPAWN.z, SPAWN.heading);
    if (this.tracker) this.tracker.setCar(this.car.sim.collider);
    else this.tracker = new ImpactTracker(this.physics, this.car.sim.collider);
    this.audio.setCar(this.car.spec.engine);
    this.audio.chime();
    this.cameras.reset('cockpit');
    this.controls.reset();
    this.acc = 0;
    this.upsideTimer = 0;
    this.state = 'drive';
    this.hud.show('driving');
  }

  private pause(on: boolean) {
    if (this.minimap.isOpen) this.minimap.open(false);
    if (on && this.state === 'drive') {
      this.state = 'paused';
      this.hud.show('paused');
      this.audio.suspend(true);
    } else if (!on && this.state === 'paused') {
      this.state = 'drive';
      this.hud.show('driving');
      this.audio.suspend(false);
      this.last = performance.now();
    }
  }

  private startSinking() {
    this.state = 'sinking';
    this.stateTimer = 0;
    this.audio.stopEngine();
    this.audio.splash();
    this.hud.show('underwater');
    const p = this.car!.model.root.position;
    this.underwater.start(tmpV.set(p.x, Math.max(p.y, WATER_LEVEL - 4), p.z));
    this.car!.sim.body.setLinearDamping(2.5);
    this.car!.sim.body.setAngularDamping(2);
    this.sky.visible = false;
    this.scene.background = new THREE.Color(UNDERWATER_COLOR);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(UNDERWATER_COLOR);
    fog.near = 1;
    fog.far = 28;
  }

  private endUnderwater() {
    this.underwater.stop();
    this.sky.visible = true;
    this.scene.background = null;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(SKY_HORIZON);
    fog.near = 160;
    fog.far = 680;
  }

  // ---------------------------------------------------------------- loop
  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, Math.max(0, (now - (this.last || now)) / 1000));
    this.last = now;
    (this.sky.material as THREE.ShaderMaterial).uniforms.time.value = now / 1000;
    const focus = this.car && this.state !== 'title' ? this.car.model.root.position : this.camera.position;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(SUN_DIR, 200);

    switch (this.state) {
      case 'title':
        this.titleCamera(dt);
        this.world.update(dt, this.camera.position, this.particles);
        this.renderer.render(this.scene, this.camera);
        break;
      case 'select':
        this.garage.update(dt);
        this.renderer.render(this.garage.scene, this.garage.camera);
        break;
      case 'paused':
        this.renderer.render(this.scene, this.camera);
        break;
      case 'drive':
      case 'wrecked':
      case 'sinking':
        if (this.minimap.isOpen) break;
        this.simulate(dt);
        this.renderer.render(this.scene, this.camera);
        this.adaptQuality(dt);
        break;
    }
    if (this.debug) {
      const info = this.renderer.info.render;
      this.hud.setFps(`${Math.round(1 / Math.max(dt, 1e-3))} fps  pr ${this.pixelRatio.toFixed(2)} shadows ${this.shadowTier}\ncalls ${info.calls} tris ${info.triangles}`);
    }
  }

  private titleCamera(dt: number) {
    this.titleAngle += dt * 0.05;
    const a = this.titleAngle;
    this.camera.position.set(-1500 + Math.sin(a) * 120, 45, 40 + Math.cos(a) * 120);
    this.camera.lookAt(-1800, 25, -40);
    this.sky.position.copy(this.camera.position);
  }

  private simulate(dt: number) {
    const car = this.car!;
    const input = this.state === 'drive' ? this.controls.read(dt) : NO_INPUT;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 4) {
      car.fixedUpdate(FIXED_DT, input, this.world.queries);
      this.tracker.beforeStep();
      this.physics.step();
      car.snapshot();
      for (const imp of this.tracker.collect()) this.handleImpact(imp);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === 4) this.acc = 0;
    car.render(this.acc / FIXED_DT);
    car.model.root.updateMatrixWorld(true);

    // A restart replaces the car: stop here so nothing touches the old (freed) one.
    if (this.checkState(dt)) return;
    this.effects(dt);

    const sim = car.sim;
    this.audio.update(dt, {
      rpm: car.gearbox.rpm,
      throttle: input.throttle || input.reverse,
      speed: sim.speed,
      skid: sim.skid,
      boosting: sim.boostTimer > 0,
      running: !car.wrecked && this.state !== 'sinking',
      shifted: car.gearbox.justShifted,
      misfire: car.misfiredThisStep,
      damage: 1 - car.health / MAX_HEALTH,
    });
    if (sim.landingSpeed > 0) {
      this.audio.landing(sim.landingSpeed);
      this.cameras.addShake(Math.min(0.5, sim.landingSpeed / 25));
      sim.landingSpeed = 0;
    }

    if (this.state === 'sinking') this.cameras.updateUnderwater(dt, car.model.root.position);
    else this.cameras.update(dt, car);
    this.sky.position.copy(this.camera.position);
    this.world.update(dt, this.camera.position, this.particles, car.model.root.position);
    this.buildingDamage.update(dt, this.particles);
    this.particles.update(dt);
    this.debris.update();
    this.underwater.update(dt);
    const f = sim.forward();
    this.minimap.update(car.model.root.position.x, car.model.root.position.z, f.x, f.z);
    this.hud.setSpeed(sim.speed);
    this.hud.setHealth(car.health);
    this.hud.setBoost(sim.boostTimer > 1.6);
  }

  private handleImpact(imp: Impact) {
    const car = this.car!;
    const r = car.applyImpact(imp, this.particles, this.debris);
    const o = imp.other;
    if (this.debug) console.log(`[crash] ${o?.kind ?? '?'} J=${imp.impulse.toFixed(0)} dv=${r.dv.toFixed(1)} dmg=${r.damage.toFixed(1)} health=${car.health.toFixed(0)}`);
    let material = o?.material;
    if (o?.kind === 'prop') {
      const res = this.world.props.hit(o.ref as Prop, imp.impulse, car.spec.mass, imp.point, imp.normal, this.particles, this.debris);
      if (res.destroyed) this.audio.crash(Math.max(r.dv, 8), 'wood');
      if (res.toppled) this.audio.crash(Math.max(r.dv, 6), o.material);
    } else if (o?.kind === 'parked') {
      (o.ref as ParkedCar).hit(imp.impulse, car.spec.mass, imp.point, imp.normal, this.particles);
      material = 'metal';
    } else if (o?.kind === 'building') {
      this.buildingDamage.hit(imp.otherHandle, o.ref as BuildingInfo | undefined, imp.point, imp.normal, imp.impulse, r.dv, car.spec.mass, this.particles, this.debris);
      if (r.dv > 6 && (o.ref as BuildingInfo | undefined)?.style === 'glass') this.audio.glass(Math.min(1.2, r.dv / 20));
    }
    // Scraping or bumping the ground isn't a crash: only real slams make noise.
    if (o?.kind !== 'ground' || r.dv > 4) this.audio.crash(r.dv, material);
    if (r.glassBroke) this.audio.glass();
    if (r.partsLost.length) this.audio.partFall();
    if (o?.kind !== 'ground' || r.dv > 4) this.cameras.addShake(Math.min(1, r.dv / 18));
  }

  /** Returns true if the car was replaced (restart), so the caller must stop using it. */
  private checkState(dt: number): boolean {
    const car = this.car!;
    const p = car.model.root.position;
    if (this.state === 'drive') {
      if (car.wrecked) {
        this.state = 'wrecked';
        this.stateTimer = 0;
      } else if (isDeepWater(p.x, p.z) && p.y < WATER_LEVEL - 0.3) {
        this.startSinking();
        return false;
      } else if (p.y < -60) {
        this.startDrive(this.carId); // fell out of the world somehow
        return true;
      }
      // Stuck on its roof or side → offer the flip button.
      const up = car.sim.up();
      if ((up.y < 0.45 || car.sim.isUpsideDown()) && Math.abs(car.sim.speed) < 2) this.upsideTimer += dt;
      else this.upsideTimer = 0;
      this.hud.setFlip(this.upsideTimer > 1.5);
    } else if (this.state === 'wrecked') {
      this.stateTimer += dt;
      // Let the car finish tumbling before showing the message.
      if (this.stateTimer > 1.4 && this.hud.current !== 'wrecked') this.hud.show('wrecked');
      if (isDeepWater(p.x, p.z) && p.y < WATER_LEVEL - 0.3) this.startSinking();
    } else if (this.state === 'sinking') {
      this.stateTimer += dt;
      if (this.stateTimer > SINK_SECONDS) {
        // Wrecked + sank → pick a new car; otherwise jump straight back in the same one.
        if (car.wrecked) this.showSelect();
        else this.startDrive(this.carId);
        return true;
      }
    }
    return false;
  }

  private effects(dt: number) {
    const car = this.car!;
    if (this.state === 'sinking') return;
    // Engine smoke grows with damage.
    const dmg = 1 - car.health / MAX_HEALTH;
    if (dmg > 0.25) {
      this.smokeAcc += dt * (car.wrecked ? 20 : 2 + (dmg - 0.25) * 24);
      while (this.smokeAcc > 1) {
        this.smokeAcc -= 1;
        this.particles.smokePuff(car.smokeOrigin(tmpV), dmg);
      }
    }
    // Dust, grass bits and splashes kicked up by the wheels; tire smoke when skidding.
    const sim = car.sim;
    const speed = Math.abs(sim.speed);
    for (let i = 0; i < 4; i++) {
      if (!sim.ctrl.wheelIsInContact(i)) continue;
      const kind = SURFACES[sim.wheelSurface[i]].dust;
      const cp = sim.ctrl.wheelContactPoint(i);
      if (!cp) continue;
      if (kind !== 'none' && speed > 7 && Math.random() < Math.min(0.6, speed / 60)) {
        if (kind === 'spray') this.particles.spray(cp, 3);
        else this.particles.dust(cp, DUST_COLORS[kind], 0.8 + speed * 0.02);
      } else if (kind === 'none' && sim.skid > 0.45 && i >= 2 && Math.random() < sim.skid * 0.5) {
        this.particles.dust(cp, 0xdddddd, 1.1);
      }
    }
  }

  // ---------------------------------------------------------------- misc
  /** Swipes on the 3D view (not on the buttons) turn the chase/orbit camera. */
  private setupOrbitDrag() {
    let id = -1, lx = 0, ly = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (id !== -1) return;
      id = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === id) id = -1;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id || !this.cameras) return;
      this.cameras.drag(e.clientX - lx, e.clientY - ly);
      lx = e.clientX;
      ly = e.clientY;
    });
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.garage?.resize(w, h);
    this.particles.setViewportHeight(h * this.pixelRatio);
  }

  private applyShadowTier() {
    const sun = this.sun;
    sun.castShadow = this.shadowTier > 0;
    const size = this.shadowTier === 2 ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  }

  /** Drop render resolution if the device can't hold ~50 fps; raise it again if there's headroom. */
  private adaptQuality(dt: number) {
    const p = this.perf;
    p.frames++;
    p.time += dt;
    if (p.time < 2) return;
    const fps = p.frames / p.time;
    p.frames = 0;
    p.time = 0;
    const now = performance.now();
    let next = this.pixelRatio;
    if (fps < 48 && this.shadowTier > 0 && this.pixelRatio <= 1.0) {
      // Below ~1x resolution it's cheaper to give up shadow detail than more pixels.
      this.shadowTier--;
      this.applyShadowTier();
      return;
    }
    if (fps < 48 && this.pixelRatio > 0.7) next = Math.max(0.7, this.pixelRatio - 0.15);
    else if (fps > 58.5 && this.pixelRatio < this.maxPixelRatio && now - p.lastRaise > 8000) {
      next = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
      p.lastRaise = now;
    }
    if (next !== this.pixelRatio) {
      this.pixelRatio = next;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }
}
