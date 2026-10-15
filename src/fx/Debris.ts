import * as THREE from 'three';
import { MaterialKind, Physics, RAPIER } from '../physics/Physics';

interface Piece {
  mesh: THREE.Object3D;
  body: RAPIER.RigidBody;
  ownsGeometry: boolean;
}

const MAX_PIECES = 110;
const box = new THREE.Box3();
const size = new THREE.Vector3();
const center = new THREE.Vector3();
const q = new THREE.Quaternion();

/** Loose physics pieces: fallen car parts, crate planks, bricks of broken props. */
export class Debris {
  private pieces: Piece[] = [];

  constructor(private readonly physics: Physics, private readonly scene: THREE.Scene) {}

  /**
   * Turn a mesh into a loose physics piece. The mesh is moved into the scene
   * (keeping its world transform) and a box collider is fitted to it.
   */
  release(mesh: THREE.Mesh, velocity: THREE.Vector3Like, kick: number, ownsGeometry: boolean, material: MaterialKind = 'metal', density = 400) {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    box.copy(geo.boundingBox!);
    box.getSize(size);
    box.getCenter(center);

    // Re-centre the geometry on its bounding box so the body origin is its centre.
    const wrapper = new THREE.Group();
    mesh.getWorldQuaternion(q);
    const worldCenter = center.clone().applyMatrix4(mesh.matrixWorld);
    wrapper.position.copy(worldCenter);
    wrapper.quaternion.copy(q);
    mesh.removeFromParent();
    mesh.position.copy(center).multiplyScalar(-1);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    wrapper.add(mesh);
    this.scene.add(wrapper);

    const hx = Math.max(0.03, size.x / 2), hy = Math.max(0.03, size.y / 2), hz = Math.max(0.03, size.z / 2);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(worldCenter.x, worldCenter.y, worldCenter.z)
        .setRotation(q)
        .setLinvel(
          velocity.x + (Math.random() - 0.5) * kick,
          velocity.y + Math.random() * kick * 0.6,
          velocity.z + (Math.random() - 0.5) * kick,
        )
        .setAngvel({ x: (Math.random() - 0.5) * kick, y: (Math.random() - 0.5) * kick, z: (Math.random() - 0.5) * kick })
        .setLinearDamping(0.1)
        .setAngularDamping(0.3),
    );
    const col = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setDensity(density).setFriction(0.8).setRestitution(0.2),
      body,
    );
    this.physics.setOwner(col, { kind: 'debris', material });
    this.pieces.push({ mesh: wrapper, body, ownsGeometry });
    while (this.pieces.length > MAX_PIECES) this.removePiece(this.pieces.shift()!);
  }

  private removePiece(p: Piece) {
    this.physics.removeBody(p.body);
    p.mesh.removeFromParent();
    if (p.ownsGeometry) p.mesh.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }

  update() {
    for (const p of this.pieces) {
      if (p.body.isSleeping()) continue;
      const t = p.body.translation();
      const r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  clear() {
    for (const p of this.pieces) this.removePiece(p);
    this.pieces = [];
  }
}
