import * as THREE from 'three';
import { mudDepth } from '../../shared/mud';
import { roadY } from './route';
import { Vehicle } from './vehicle';

type Splash = { p: THREE.Vector3; v: THREE.Vector3; life: number };

/** Instanced, short-lived mud marks and splashes; no extra rigid bodies or draw calls per particle. */
export class MudEffects {
  private readonly tracks: THREE.InstancedMesh;
  private readonly droplets: THREE.InstancedMesh;
  private readonly splashes: Splash[] = Array.from({ length: 24 }, () => ({
    p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0,
  }));
  private readonly dummy = new THREE.Object3D();
  private nextTrack = 0;
  private nextSplash = 0;
  private lastTrack = new THREE.Vector3(0, -100, 0);
  private splashTime = 0;
  constructor(scene: THREE.Scene) {
    this.tracks = new THREE.InstancedMesh(new THREE.PlaneGeometry(.27, .66),
      new THREE.MeshBasicMaterial({ color: 0x392c25, transparent: true, opacity: .56, side: THREE.DoubleSide }), 96);
    this.tracks.count = 0;
    this.tracks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.tracks);
    this.droplets = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.13, 0),
      new THREE.MeshStandardMaterial({ color: 0x695139, roughness: 1 }), 24);
    this.droplets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.droplets.count = 24;
    scene.add(this.droplets);
  }
  update(dt: number, vehicle: Vehicle): void {
    const position = vehicle.model.position;
    const depth = mudDepth(position.x, position.z);
    if (depth > .35 && vehicle.speed > .45 && position.distanceTo(this.lastTrack) > .42) {
      this.lastTrack.copy(position);
      const yaw = vehicle.model.rotation.y;
      for (const side of [-1, 1]) {
        const wheel = vehicle.model.localToWorld(new THREE.Vector3(side * .96, 0, 1.5));
        this.dummy.position.set(wheel.x, roadY(-wheel.z) + .16, wheel.z);
        this.dummy.rotation.set(-Math.PI / 2, 0, yaw);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.tracks.setMatrixAt(this.nextTrack, this.dummy.matrix);
        this.nextTrack = (this.nextTrack + 1) % 96;
        this.tracks.count = Math.min(96, this.tracks.count + 1);
      }
      this.tracks.instanceMatrix.needsUpdate = true;
    }
    this.splashTime -= dt;
    if (depth > .4 && vehicle.speed > .25 && this.splashTime <= 0) {
      this.splashTime = .1;
      const particle = this.splashes[this.nextSplash++ % this.splashes.length];
      const rear = vehicle.model.localToWorld(new THREE.Vector3((this.nextSplash % 2 ? -1 : 1) * .95, -.45, 1.5));
      particle.p.copy(rear);
      particle.v.set((Math.random() - .5) * 2, 1.5 + Math.random() * 1.2, 1 + Math.random());
      particle.life = .55;
    }
    for (let i = 0; i < this.splashes.length; i++) {
      const particle = this.splashes[i];
      particle.life = Math.max(0, particle.life - dt);
      if (particle.life) {
        particle.p.addScaledVector(particle.v, dt);
        particle.v.y -= 9 * dt;
      }
      this.dummy.position.copy(particle.p);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(particle.life ? Math.max(.1, particle.life) : 0);
      this.dummy.updateMatrix();
      this.droplets.setMatrixAt(i, this.dummy.matrix);
    }
    this.droplets.instanceMatrix.needsUpdate = true;
  }
}
