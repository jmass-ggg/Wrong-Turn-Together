import * as THREE from 'three';
import type { RoomState } from '../../shared/room';
import { ANCHOR_POINT, CABLE_MAX_LENGTH, cableForce, cableLength } from '../../shared/cable';
import { Vehicle } from './vehicle';

/** One fixed anchor and one force-limited cable; only the current RV owner applies impulses. */
export class Winch {
  readonly line: THREE.Line;
  tension = 0;
  private readonly points = Array.from({ length: 13 }, () => new THREE.Vector3());
  private readonly anchor = new THREE.Vector3(...ANCHOR_POINT);
  constructor(private vehicle: Vehicle, scene: THREE.Scene) {
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.points),
      new THREE.LineBasicMaterial({ color: 0xf3d38e, linewidth: 2 }));
    this.line.visible = false;
    scene.add(this.line);
  }
  private towPoint(end: 'front' | 'rear'): THREE.Vector3 {
    this.vehicle.model.updateMatrixWorld();
    return this.vehicle.model.localToWorld(new THREE.Vector3(0, -.25, end === 'front' ? -2.7 : 2.7));
  }
  step(dt: number, room: RoomState, serverNow: number): void {
    const cable = room.cable;
    if (!cable) { this.tension = 0; return; }
    const start = this.towPoint(cable.end);
    const holder = room.characters[cable.holderId]?.p;
    if (cable.stage === 'carried' && !holder) { this.tension = 0; return; }
    const endpoint = cable.stage === 'attached' ? this.anchor : new THREE.Vector3(...holder);
    const toAnchor = endpoint.clone().sub(start);
    const distance = toAnchor.length();
    if (distance < .01 || distance > CABLE_MAX_LENGTH + 8) { this.tension = 0; return; }
    const direction = toAnchor.multiplyScalar(1 / distance);
    const velocity = this.vehicle.body.velocityAtPoint(start);
    const outward = -(velocity.x * direction.x + velocity.y * direction.y + velocity.z * direction.z);
    // The motor shortens the rest length; a spring/damper applies a bounded force to the chassis.
    const force = cableForce(distance, cableLength(cable, serverNow), outward, cable.stage === 'carried');
    this.tension = force / (cable.stage === 'carried' ? 1100 : 17000);
    if (force > 0) this.vehicle.body.applyImpulseAtPoint(direction.multiplyScalar(force * dt), start, true);
  }
  render(room: RoomState | null, localId: string, serverNow: number, walkerPosition?: THREE.Vector3): void {
    const cable = room?.cable;
    this.line.visible = !!cable;
    if (!cable) { this.tension = 0; return; }
    const start = this.towPoint(cable.end);
    const holder = room?.characters[cable.holderId]?.p;
    const end = cable.stage === 'attached' ? this.anchor : walkerPosition && cable.holderId === localId
      ? walkerPosition : holder ? new THREE.Vector3(...holder).add(new THREE.Vector3(0, .25, 0)) : start;
    const distance = start.distanceTo(end);
    const rest = cableLength(cable, serverNow);
    this.tension = cableForce(distance, rest, 0, cable.stage === 'carried') / (cable.stage === 'carried' ? 1100 : 17000);
    const sag = Math.max(.02, Math.min(1.3, (rest - distance) * .28 + (this.tension > .1 ? .02 : .4)));
    for (let i = 0; i < this.points.length; i++) {
      const fraction = i / (this.points.length - 1);
      this.points[i].lerpVectors(start, end, fraction);
      this.points[i].y -= Math.sin(Math.PI * fraction) * sag;
    }
    this.line.geometry.setFromPoints(this.points);
    (this.line.material as THREE.LineBasicMaterial).color.setHex(this.tension > .7 ? 0xff875c : 0xf3d38e);
  }
}
