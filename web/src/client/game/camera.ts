import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from './vehicle';

export class FollowCamera {
  private yaw = 0;
  private pitch = .26;
  private zoom = 1;
  private look = new THREE.Vector3();
  constructor(private camera: THREE.PerspectiveCamera, private physics: RAPIER.World) {}
  rotate(dx: number, dy: number): void {
    this.yaw += dx * .004;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * .003, -.12, .75);
  }
  zoomBy(delta: number): void { this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(delta * .001), .55, 2.1); }
  get zoomLevel(): number { return this.zoom; }
  reset(): void { this.yaw = 0; this.pitch = .26; this.zoom = 1; }
  update(vehicle: Vehicle, dt: number): void {
    const target = vehicle.model.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const front = new THREE.Vector3(0, 0, -1).applyQuaternion(vehicle.model.quaternion);
    const heading = Math.atan2(front.x, -front.z) + this.yaw;
    const distance = (8.4 + Math.min(4, vehicle.speed * .11)) * this.zoom;
    const offset = new THREE.Vector3(-Math.sin(heading) * distance * Math.cos(this.pitch), 2 + (1.2 + Math.sin(this.pitch) * distance) * this.zoom, Math.cos(heading) * distance * Math.cos(this.pitch));
    let desired = target.clone().add(offset);
    const ray = new RAPIER.Ray(target, offset.clone().normalize());
    const hit = this.physics.castRay(ray, offset.length(), true, undefined, undefined, undefined, vehicle.body);
    if (hit) desired = target.clone().addScaledVector(offset.clone().normalize(), Math.max(2.8, hit.timeOfImpact - .45));
    const alpha = 1 - Math.exp(-5 * Math.min(dt, .1));
    this.camera.position.lerp(desired, alpha);
    this.look.lerp(target, alpha);
    this.camera.lookAt(this.look);
  }
  updateWalker(position: THREE.Vector3, facing: number, dt: number, body?: RAPIER.RigidBody): void {
    const target = position.clone().add(new THREE.Vector3(0, .45, 0));
    const heading = facing + this.yaw;
    const distance = 4.8 * this.zoom;
    const offset = new THREE.Vector3(-Math.sin(heading) * distance * Math.cos(this.pitch), 1 + (1.1 + Math.sin(this.pitch) * distance) * this.zoom, Math.cos(heading) * distance * Math.cos(this.pitch));
    let desired = target.clone().add(offset);
    const hit = this.physics.castRay(new RAPIER.Ray(target, offset.clone().normalize()), offset.length(), true, undefined, undefined, undefined, body);
    if (hit) desired = target.clone().addScaledVector(offset.normalize(), Math.max(1.3, hit.timeOfImpact - .3));
    const alpha = 1 - Math.exp(-7 * Math.min(dt, .1));
    this.camera.position.lerp(desired, alpha);
    this.look.lerp(target, alpha);
    this.camera.lookAt(this.look);
  }
}
