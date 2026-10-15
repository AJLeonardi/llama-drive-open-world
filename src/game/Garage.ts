import * as THREE from 'three';
import { buildCar } from '../vehicles/builders';
import { CAR_IDS } from '../vehicles/VehicleSpec';

/** The car-select backdrop: the three cars spinning on turntables above their cards. */
export class Garage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private turntables: THREE.Group[] = [];

  constructor() {
    this.scene.background = new THREE.Color(0x1f2a40);
    this.scene.fog = new THREE.Fog(0x1f2a40, 22, 48);
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x2a2a35, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 10, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -12;
    key.shadow.camera.right = key.shadow.camera.top = 12;
    key.shadow.normalBias = 0.03;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ec8ff, 1.2);
    rim.position.set(-6, 4, -8);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x2c3650, roughness: 0.6, metalness: 0.1, envMapIntensity: 0.25 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    CAR_IDS.forEach((id, i) => {
      const t = new THREE.Group();
      t.position.set((i - 1) * 6.4, 0, 0);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.15, 48), new THREE.MeshStandardMaterial({ color: 0x4a5778, roughness: 0.25, metalness: 0.5 }));
      pad.receiveShadow = true;
      pad.position.y = 0.07;
      t.add(pad);
      const car = buildCar(id).root;
      car.position.y = 0.15;
      t.add(car);
      t.rotation.y = 0.6 + i;
      this.scene.add(t);
      this.turntables.push(t);
    });
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    // Fit all three cars horizontally, sitting in the upper part of the screen.
    const dist = Math.max(17, 26 / Math.min(1.9, this.camera.aspect));
    this.camera.position.set(0, dist * 0.42, dist);
    this.camera.lookAt(0, -1.2, 0);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number) {
    for (const t of this.turntables) t.rotation.y += dt * 0.6;
  }
}
