import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { groundY, roadX, roadY } from './route';
import { mudDepth } from '../../shared/mud';

export interface DriveInput { throttle: number; reverse: number; steer: number; handbrake: boolean }
const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xf4e3b9, roughness: .62, metalness: .12 });
const accent = new THREE.MeshStandardMaterial({ color: 0xd66d45, roughness: .65 });
const dark = new THREE.MeshStandardMaterial({ color: 0x243c42, roughness: .2, metalness: .1 });
const tire = new THREE.MeshStandardMaterial({ color: 0x242827, roughness: .95 });
const metal = new THREE.MeshStandardMaterial({ color: 0x87918d, roughness: .4, metalness: .7 });
const glass = new THREE.MeshStandardMaterial({ color: 0x83c4ce, roughness: .14, metalness: .17, transparent: true, opacity: .42, depthWrite: false });
const lamp = new THREE.MeshStandardMaterial({ color: 0xffe3a1, emissive: 0xc8983a, emissiveIntensity: .5 });
function part(parent: THREE.Object3D, mat: THREE.Material, size: [number, number, number], position: [number, number, number]): THREE.Mesh {
  const result = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  result.position.set(...position); result.castShadow = true; result.receiveShadow = true; parent.add(result); return result;
}
export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly model = new THREE.Group();
  readonly input: DriveInput = { throttle: 0, reverse: 0, steer: 0, handbrake: false };
  readonly wheels: THREE.Group[] = [];
  readonly suspension: number[] = [0, 0, 0, 0];
  readonly wheelSpin: number[] = [0, 0, 0, 0];
  hull = 100;
  fuel = 100;
  speed = 0;
  grounded = 0;
  mudLevel = 0;
  mudRuts = 0;
  wheelSlip = 0;
  private lastSpeed = 0;
  private checkpoint = 0;
  private readonly offsets = [new THREE.Vector3(-.96, -.47, -1.45), new THREE.Vector3(.96, -.47, -1.45), new THREE.Vector3(-.96, -.47, 1.48), new THREE.Vector3(.96, -.47, 1.48)];
  constructor(private scene: THREE.Scene, private physics: RAPIER.World) {
    const yaw = -Math.atan2(roadX(2) - roadX(0), 2);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(roadX(0), roadY(0) + 1.32, 1)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(.15).setAngularDamping(1.5).setCanSleep(false));
    physics.createCollider(RAPIER.ColliderDesc.cuboid(1.15, .54, 2.3).setTranslation(0, .08, 0).setDensity(100).setFriction(.7).setRestitution(.02), this.body);
    // The body mass also includes luggage and the interior; tires contact via four rays below.
    this.body.setAdditionalMass(1150, true);
    this.makeModel(); scene.add(this.model);
  }
  private makeModel(): void {
    // Leave the cab open above its doors so seated players can be seen through the windows.
    part(this.model, bodyMaterial, [2.45, 1.65, 2.7], [0, .18, 1.13]);
    part(this.model, bodyMaterial, [2.45, .63, 2.25], [0, -.33, -1.35]);
    part(this.model, bodyMaterial, [2.45, .27, .12], [0, .78, -2.43]);
    part(this.model, accent, [2.5, .2, 4.98], [0, -.42, 0]);
    part(this.model, bodyMaterial, [2.38, .15, 2.65], [0, 1.08, 1.05]);
    part(this.model, bodyMaterial, [2.38, .15, 2.2], [0, 1.08, -1.38]);
    part(this.model, glass, [2.22, .72, .05], [0, .49, -2.48]);
    for (const side of [-1, 1]) {
      part(this.model, glass, [.045, .68, 1.35], [side * 1.245, .58, -.92]);
      part(this.model, glass, [.045, .68, .85], [side * 1.245, .58, .95]);
      part(this.model, accent, [.065, 1.45, .07], [side * 1.25, .02, .26]);
      part(this.model, metal, [.35, .32, .11], [side * 1.25, .04, .28]);
      part(this.model, lamp, [.47, .27, .08], [side * .82, -.35, -2.52]);
      part(this.model, accent, [.42, .2, .07], [side * .82, -.27, 2.52]);
    }
    part(this.model, metal, [2.55, .27, .3], [0, -.64, -2.5]);
    part(this.model, metal, [2.55, .27, .3], [0, -.64, 2.5]);
    for (const x of [-.93, .93]) {
      part(this.model, metal, [.07, .22, 3.1], [x, 1.31, 0]);
    }
    part(this.model, barkMaterial, [1.55, .48, .75], [0, 1.53, .7]);
    part(this.model, dark, [.11, .11, .11], [0, -.26, -2.71]);
    part(this.model, dark, [.11, .11, .11], [0, -.26, 2.71]);
    const spare = new THREE.Mesh(new THREE.TorusGeometry(.42, .14, 8, 12), tire);
    spare.position.set(0, .28, 2.56); this.model.add(spare);
    for (const o of this.offsets) {
      const group = new THREE.Group();
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .25, 12), tire);
      wheel.rotation.z = Math.PI / 2; wheel.castShadow = true; group.add(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .265, 10), metal);
      hub.rotation.z = Math.PI / 2; group.add(hub);
      group.position.copy(o); group.position.y -= .6;
      this.model.add(group); this.wheels.push(group);
    }
  }
  setCheckpoint(distance: number): void { this.checkpoint = distance; }
  reset(): void {
    const d = this.checkpoint;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(roadX(d + 2) - roadX(d), 2));
    this.body.setTranslation({ x: roadX(d), y: roadY(d) + 1.38, z: -d + 2 }, true);
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.mudRuts = 0;
    this.hull = Math.max(25, this.hull - 10);
  }
  step(dt: number): void {
    const t = this.body.translation(), r = this.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const basisX = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const basisZ = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const down = new THREE.Vector3(0, -1, 0);
    const velocity = this.body.linvel();
    this.speed = Math.hypot(velocity.x, velocity.z);
    this.grounded = 0;
    const engine = this.fuel > 0 && this.hull > 0 ? this.input.throttle - this.input.reverse * .6 : 0;
    this.mudLevel = mudDepth(t.x, t.z);
    const digging = this.mudLevel > .5 && Math.abs(engine) > .5 && this.speed < 1.2;
    this.mudRuts = THREE.MathUtils.clamp(this.mudRuts + (digging ? .16 : -this.mudLevel * .035 - .12 * (1 - this.mudLevel)) * dt, 0, 1);
    this.wheelSlip = 0;
    for (let i = 0; i < 4; i++) {
      const offset = this.offsets[i].clone().applyQuaternion(q);
      const origin = new THREE.Vector3(t.x, t.y, t.z).add(offset);
      const hit = this.physics.castRayAndGetNormal(new RAPIER.Ray(origin, down), 1.35, true, undefined, undefined, undefined, this.body);
      this.suspension[i] = hit ? hit.timeOfImpact : 1.1;
      // Local forward is -Z: negative yaw points the front wheels to the RV's right (+X).
      const steering = i < 2 ? -this.input.steer * Math.max(.15, 1 - this.speed / 35) * .46 : 0;
      this.wheels[i].rotation.y = steering;
      if (!hit || hit.timeOfImpact > 1.05) continue;
      this.grounded++;
      const contact = origin.clone().addScaledVector(down, hit.timeOfImpact);
      const pointVelocity = this.body.velocityAtPoint(contact);
      const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
      // A ray spring presses at the wheel mount; damping suppresses bounce without teleporting the chassis.
      const compression = Math.max(0, .87 - hit.timeOfImpact);
      const suspensionForce = Math.max(0, 24000 * compression - 2850 * (pointVelocity.x * normal.x + pointVelocity.y * normal.y + pointVelocity.z * normal.z));
      this.body.applyImpulseAtPoint(normal.multiplyScalar(suspensionForce * dt), contact, true);
      const forward = basisZ.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), steering);
      const sideways = basisX.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), steering);
      const longitudinal = pointVelocity.x * forward.x + pointVelocity.z * forward.z;
      const lateral = pointVelocity.x * sideways.x + pointVelocity.z * sideways.z;
      const onRoad = Math.abs(t.x - roadX(Math.max(0, -t.z))) < 4.1;
      const depth = mudDepth(contact.x, contact.z);
      const grip = (onRoad ? 1 : .52) * (1 - .91 * depth) * (1 - .7 * depth * this.mudRuts);
      const lateralForce = THREE.MathUtils.clamp(-lateral * 3700, -6500 * grip, 6500 * grip);
      const braking = (this.input.handbrake ? 8500 : 0) + (this.input.reverse > 0 && longitudinal > .5 ? this.input.reverse * 8000 : 0);
      const drive = i > 1 ? engine * 5900 : 0;
      const traction = THREE.MathUtils.clamp(drive - Math.sign(longitudinal) * braking - longitudinal * 55, -7500 * grip, 7500 * grip);
      this.wheelSlip = Math.max(this.wheelSlip, depth * Math.min(1, Math.abs(drive - traction) / 5500));
      const impulse = forward.multiplyScalar(traction * dt).add(sideways.multiplyScalar(lateralForce * dt));
      this.body.applyImpulseAtPoint(impulse, contact, true);
      this.wheelSpin[i] += (longitudinal + Math.abs(engine) * depth * 8) * dt / .42;
    }
    // Forward resistance makes coasting and off-road mistakes meaningful.
    if (this.grounded > 0) {
      const resistance = 25 + this.mudLevel * (1600 + 4600 * this.mudRuts);
      this.body.applyImpulse({ x: -velocity.x * resistance * dt, y: 0, z: -velocity.z * resistance * dt }, true);
    }
    this.fuel = Math.max(0, this.fuel - Math.abs(engine) * dt * .045);
    if (this.lastSpeed - this.speed > 7 && this.speed < this.lastSpeed * .5) this.hull = Math.max(0, this.hull - (this.lastSpeed - this.speed) * .7);
    this.lastSpeed = this.speed;
    if (t.y < groundY(t.x, t.z) - 12) this.reset();
  }
  syncVisual(): void {
    const p = this.body.translation(), r = this.body.rotation();
    this.model.position.set(p.x, p.y, p.z); this.model.quaternion.set(r.x, r.y, r.z, r.w);
    for (let i = 0; i < 4; i++) {
      this.wheels[i].position.y = this.offsets[i].y - Math.min(1, this.suspension[i]) + .42;
      this.wheels[i].children[0].rotation.x = this.wheelSpin[i];
      this.wheels[i].children[1].rotation.x = this.wheelSpin[i];
    }
  }
}
const barkMaterial = new THREE.MeshStandardMaterial({ color: 0x725136, roughness: .95 });
