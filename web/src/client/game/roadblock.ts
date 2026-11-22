import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { initialRoadblock } from '../../shared/roadblock';
import type { RoomState } from '../../shared/room';

const wood = new THREE.MeshStandardMaterial({ color: 0x725039, roughness: 1, flatShading: true });
const branch = new THREE.MeshStandardMaterial({ color: 0x47714b, roughness: 1, flatShading: true });

export class Roadblock {
  readonly model = new THREE.Group();
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  constructor(scene: THREE.Scene, physics: RAPIER.World) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.55, .72, 9.8, 8), wood);
    trunk.rotation.z = Math.PI / 2; trunk.castShadow = true; trunk.receiveShadow = true;
    this.model.add(trunk);
    for (const side of [-1, 1]) {
      const bough = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.5, 6), branch);
      bough.position.set(side * 3.6, 1, 0);
      bough.rotation.z = side * .65;
      bough.castShadow = true;
      this.model.add(bough);
    }
    this.body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = physics.createCollider(RAPIER.ColliderDesc.cuboid(4.9, .6, .72).setFriction(.9), this.body);
    this.sync(null, 1);
    scene.add(this.model);
  }
  sync(room: RoomState | null, dt: number): void {
    this.model.visible = !!room;
    this.collider.setEnabled(!!room);
    if (!room) return;
    const position = room.roadblock?.p ?? initialRoadblock().p;
    const target = new THREE.Vector3(...position);
    if (this.model.position.lengthSq() < 1) this.model.position.copy(target);
    else this.model.position.lerp(target, 1 - Math.exp(-10 * Math.min(.1, dt)));
    this.body.setNextKinematicTranslation(this.model.position);
  }
}
