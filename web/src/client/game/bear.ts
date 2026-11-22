import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { BearState } from '../../shared/bear';

const fur = new THREE.MeshStandardMaterial({ color: 0x654631, roughness: 1, flatShading: true });
const muzzle = new THREE.MeshStandardMaterial({ color: 0x9d7851, roughness: 1 });
const dark = new THREE.MeshStandardMaterial({ color: 0x211d19, roughness: 1 });
const alert = new THREE.MeshStandardMaterial({ color: 0xe2a35b, emissive: 0xb34a16, emissiveIntensity: .7 });

/** Original procedural bear: a single kinematic collider, animated limbs and server-driven motion. */
export class Bear {
  readonly model = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly eyes: THREE.Mesh[] = [];
  private readonly body: RAPIER.RigidBody;
  private phase = 0;
  constructor(scene: THREE.Scene, physics: RAPIER.World, initial: BearState) {
    const part = (parent: THREE.Object3D, shape: THREE.BufferGeometry, material: THREE.Material,
      x: number, y: number, z: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(shape, material);
      mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
      parent.add(mesh); return mesh;
    };
    const torso = part(this.model, new THREE.SphereGeometry(1.35, 12, 9), fur, 0, .55, .25);
    torso.scale.set(1, .86, 1.5);
    const shoulder = part(this.model, new THREE.SphereGeometry(1.05, 10, 8), fur, 0, .7, -1);
    shoulder.scale.set(1.1, 1, .85);
    part(this.model, new THREE.SphereGeometry(.68, 10, 8), fur, 0, .88, -1.9);
    part(this.model, new THREE.SphereGeometry(.36, 8, 7), muzzle, 0, .67, -2.38);
    part(this.model, new THREE.SphereGeometry(.14, 7, 6), dark, 0, .68, -2.72);
    for (const side of [-1, 1]) {
      const ear = part(this.model, new THREE.SphereGeometry(.21, 7, 6), fur, side * .47, 1.45, -1.94);
      ear.scale.set(1, 1.2, .5);
      this.eyes.push(part(this.model, new THREE.SphereGeometry(.1, 6, 5), dark, side * .31, 1.02, -2.46));
      for (const z of [-1, 1.25]) {
        const leg = new THREE.Group(); leg.position.set(side * .88, -.08, z);
        part(leg, new THREE.CapsuleGeometry(.34, .75, 4, 7), fur, 0, -.48, 0);
        this.model.add(leg); this.legs.push(leg);
      }
    }
    this.body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(initial.p[0], initial.p[1], initial.p[2]));
    physics.createCollider(RAPIER.ColliderDesc.capsule(.8, 1.25).setFriction(.8), this.body);
    this.model.position.set(...initial.p);
    scene.add(this.model);
  }
  sync(state: BearState, dt: number): void {
    const alpha = 1 - Math.exp(-8 * Math.min(.1, dt));
    this.model.position.lerp(new THREE.Vector3(...state.p), alpha);
    const turn = THREE.MathUtils.euclideanModulo(state.yaw - this.model.rotation.y + Math.PI, 2 * Math.PI) - Math.PI;
    this.model.rotation.y += turn * alpha;
    this.body.setNextKinematicTranslation(this.model.position);
    this.body.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(this.model.rotation));
    const moving = state.mode === 'patrol' || state.mode === 'investigate' || state.mode === 'chase' || state.mode === 'return';
    this.phase += dt * (state.mode === 'chase' ? 11 : moving ? 5 : 1.2);
    for (let i = 0; i < this.legs.length; i++)
      this.legs[i].rotation.x = moving ? Math.sin(this.phase + (i % 3 ? Math.PI : 0)) * .28 : 0;
    this.model.children[2].rotation.x = state.mode === 'alert' ? Math.sin(this.phase * 2) * .12 : 0;
    for (const eye of this.eyes) eye.material = state.mode === 'alert' || state.mode === 'chase' ? alert : dark;
  }
}
