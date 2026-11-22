import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleSnapshot } from '../../shared/room';
import { Vehicle } from '../game/vehicle';

export class VehicleSync {
  private owner = true;
  private initialized = false;
  private seq = 0;
  private target: VehicleSnapshot | null = null;
  constructor(private vehicle: Vehicle) {}
  setOwner(owner: boolean, snapshot: VehicleSnapshot | null): void {
    if (this.initialized && this.owner === owner) { if (!owner && snapshot && (!this.target || snapshot.seq >= this.target.seq)) this.target = snapshot; return; }
    this.initialized = true;
    this.owner = owner;
    this.vehicle.body.setBodyType(owner ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.KinematicPositionBased, true);
    if (snapshot) {
      this.vehicle.body.setTranslation({ x: snapshot.p[0], y: snapshot.p[1], z: snapshot.p[2] }, true);
      this.vehicle.body.setRotation({ x: snapshot.q[0], y: snapshot.q[1], z: snapshot.q[2], w: snapshot.q[3] }, true);
      if (owner) {
        this.vehicle.body.setLinvel({ x: snapshot.v[0], y: snapshot.v[1], z: snapshot.v[2] }, true);
        this.vehicle.body.setAngvel({ x: snapshot.a[0], y: snapshot.a[1], z: snapshot.a[2] }, true);
      }
      this.vehicle.hull = snapshot.hull; this.vehicle.fuel = snapshot.fuel;
    }
    this.target = snapshot;
    this.seq = snapshot?.seq ?? 0;
  }
  stepRemote(dt: number): void {
    if (this.owner || !this.target) return;
    const p = this.vehicle.body.translation(), r = this.vehicle.body.rotation();
    const alpha = 1 - Math.exp(-8 * dt);
    const destination = new THREE.Vector3(...this.target.p);
    const next = new THREE.Vector3(p.x, p.y, p.z).lerp(destination, alpha);
    const nextQ = new THREE.Quaternion(r.x, r.y, r.z, r.w).slerp(new THREE.Quaternion(...this.target.q), alpha);
    this.vehicle.body.setNextKinematicTranslation(next);
    this.vehicle.body.setNextKinematicRotation(nextQ);
    this.vehicle.input.steer = this.target.steer;
    this.vehicle.speed = Math.hypot(this.target.v[0], this.target.v[2]);
    this.vehicle.hull = this.target.hull; this.vehicle.fuel = this.target.fuel;
  }
  sample(): VehicleSnapshot {
    const p = this.vehicle.body.translation(), q = this.vehicle.body.rotation(), v = this.vehicle.body.linvel(), a = this.vehicle.body.angvel();
    return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], v: [v.x, v.y, v.z], a: [a.x, a.y, a.z],
      steer: this.vehicle.input.steer, hull: this.vehicle.hull, fuel: this.vehicle.fuel, seq: ++this.seq, at: 0 };
  }
}
