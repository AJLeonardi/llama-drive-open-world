import type * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import { Link, NetEvent, PROTOCOL } from '../net/Link';
import { CarState, StateBuffer, emptyState, packState, unpackState } from '../net/carState';
import { RemoteCar } from '../vehicles/RemoteCar';
import { CAR_IDS, CarId } from '../vehicles/VehicleSpec';
import type { Vehicle } from '../vehicles/Vehicle';
import { MAX_HEALTH } from '../damage/Damage';
import { ThrusterKit, thrusterKit } from '../space/thrusters';

/** Where a car is: on Earth, or up at the space station. */
export type Realm = 'earth' | 'space';
const REALMS: Realm[] = ['earth', 'space'];

/** How often our car's state goes out (ms). */
const SEND_EVERY = 50;
/** Without news for this long the friend's car is hidden (they may be in a menu, or out of range). */
const QUIET = 3000;

/**
 * Playing together: our car's state goes out ~20 times a second; the friend's comes in
 * and drives a RemoteCar. Each device runs its own world and its own car.
 */
export class Multiplayer {
  private buffer = new StateBuffer();
  private shown = emptyState();
  private remote: RemoteCar | null = null;
  private kit: ThrusterKit | null = null;
  /** Where we are: the friend's car only shows when they're in the same place. */
  private realm: Realm = 'earth';
  private lastSent = -Infinity;
  private out = emptyState();
  /** Called once when the friend leaves or the connection drops. */
  onLeave: (() => void) | null = null;

  constructor(readonly link: Link, readonly isHost: boolean, private physics: Physics, private readonly scene: THREE.Scene) {
    link.onState = (data) => {
      const s = unpackState(data);
      if (s) this.buffer.push(s, performance.now());
    };
    link.onEvent = (e: NetEvent) => {
      if (e.t === 'bye') link.close();
      else if (e.t === 'hello' && e.v !== PROTOCOL) link.close(); // different versions: don't try
    };
    link.onClose = () => {
      this.dispose();
      this.onLeave?.();
    };
    link.send({ t: 'hello', v: PROTOCOL, car: null });
  }

  /** We've gone to Earth or to space: the friend's car moves to that physics world. */
  setRealm(realm: Realm, physics: Physics) {
    if (realm === this.realm) return;
    this.realm = realm;
    this.physics = physics;
    this.remote?.dispose();
    this.remote = null;
    this.kit = null;
  }

  /** The friend's car's state to show now (null if they have none out, or are somewhere else). */
  private current(now: number): CarState | null {
    if (now - this.buffer.lastHeard > QUIET) return null;
    const s = this.buffer.sample(now, this.shown);
    if (!s || s.car < 0 || s.car >= CAR_IDS.length) return null;
    if (REALMS[s.realm] !== this.realm) return null;
    return s;
  }

  /** Before each physics step (`now`: the time that step stands for). */
  fixedStep(now: number) {
    const s = this.current(now);
    if (!s) {
      this.remote?.hide();
      return;
    }
    const id = CAR_IDS[s.car];
    if (this.remote?.id !== id) {
      this.remote?.dispose();
      this.remote = new RemoteCar(this.physics, this.scene, id);
      // Up in space their car has thrusters too.
      this.kit = this.realm === 'space' ? thrusterKit(this.remote.spec) : null;
      if (this.kit) this.remote.model.root.add(this.kit.root);
    }
    this.remote.follow(s);
  }

  /** Each frame: show the friend's car and send ours (null: we have no car out). */
  update(now: number, dt: number, car: Vehicle | null) {
    const s = this.current(now);
    if (s && this.remote?.id === CAR_IDS[s.car]) {
      this.remote.render(s, dt);
      this.kit?.set(s.thrust, now / 1000);
    } else this.remote?.hide();

    if (now - this.lastSent < SEND_EVERY) return;
    this.lastSent = now;
    const o = this.out;
    o.time = now;
    if (car) {
      const t = car.sim.body.translation(), r = car.sim.body.rotation(), v = car.sim.body.linvel();
      o.car = CAR_IDS.indexOf(car.spec.id);
      o.x = t.x; o.y = t.y; o.z = t.z;
      o.qx = r.x; o.qy = r.y; o.qz = r.z; o.qw = r.w;
      o.vx = v.x; o.vy = v.y; o.vz = v.z;
      o.steer = car.sim.steerAngle;
      o.speed = car.sim.speed;
      o.damage = 1 - car.health / MAX_HEALTH;
      o.realm = REALMS.indexOf(this.realm);
      o.thrust = car.sim.thrust;
    } else {
      o.car = -1;
    }
    this.link.sendState(packState(o));
  }

  /** Where the friend's car is (for the map), if it's out. */
  get friend(): { x: number; z: number; car: CarId } | null {
    if (!this.remote?.visible) return null;
    const p = this.remote.model.root.position;
    return { x: p.x, z: p.z, car: this.remote.id };
  }

  /** The friend's car, for smoke and the like. */
  get remoteCar() {
    return this.remote?.visible ? this.remote : null;
  }

  leave() {
    this.link.close();
  }

  private dispose() {
    this.remote?.dispose();
    this.remote = null;
    this.buffer.clear();
  }
}
