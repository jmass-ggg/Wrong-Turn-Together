import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BRIDGE_SLOTS, BRIDGE_STOCK_POINT, bridgeWorkPoint } from '../../shared/bridge';
import type { BridgePlank } from '../../shared/bridge';
import type { RoomState } from '../../shared/room';
import { roadX, roadY } from './route';

const timber = new THREE.MeshStandardMaterial({ color: 0xa87747, roughness: .9, flatShading: true });
const placedTimber = new THREE.MeshStandardMaterial({ color: 0xd49a59, roughness: .8, flatShading: true });
const brace = new THREE.MeshStandardMaterial({ color: 0x674b35, roughness: .92 });

/** Planks become load-bearing only after the server marks each one secured. */
export class Bridge {
  private readonly planks: THREE.Mesh[] = [];
  private readonly support: RAPIER.Collider[] = [];
  private readonly enabled: boolean[] = [];
  constructor(scene: THREE.Scene, physics: RAPIER.World) {
    for (const [index, d] of BRIDGE_SLOTS.entries()) {
      const yaw = -Math.atan2(roadX(d + 1) - roadX(d - 1), 2);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(3.8, .22, 5.5), timber);
      plank.castShadow = true; plank.receiveShadow = true;
      plank.position.set(roadX(d), roadY(d) + .12, -d);
      plank.quaternion.copy(q);
      scene.add(plank); this.planks.push(plank);
      const collider = physics.createCollider(RAPIER.ColliderDesc.cuboid(1.9, .11, 2.75)
        .setTranslation(roadX(d), roadY(d) + .12, -d)
        .setRotation(q));
      this.support.push(collider); this.enabled.push(true);
      const guide = new THREE.Mesh(new THREE.TorusGeometry(.55, .08, 5, 12),
        new THREE.MeshBasicMaterial({ color: 0xf2c879 }));
      guide.position.set(...bridgeWorkPoint(index)); guide.rotation.x = Math.PI / 2;
      scene.add(guide);
    }
    // A separate maintenance catwalk lets the mechanic shuttle planks across the
    // missing road span. It cannot support the RV on the road's center line.
    const sideX = roadX(119) + 7;
    const sideY = roadY(119) + .08;
    const walkway = new THREE.Mesh(new THREE.BoxGeometry(5.4, .24, 30), timber);
    walkway.position.set(sideX, sideY, -118);
    walkway.receiveShadow = true;
    scene.add(walkway);
    physics.createCollider(RAPIER.ColliderDesc.cuboid(2.7, .12, 15)
      .setTranslation(sideX, sideY, -118).setFriction(.85));
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(.12, .7, 30), brace);
      rail.position.set(sideX + side * 2.6, sideY + .48, -118);
      rail.castShadow = true;
      scene.add(rail);
    }
    for (const d of [113, 125]) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(.3, .42, 2.4, 6), brace);
        post.position.set(roadX(d) + side * 3.7, roadY(d) + 1.1, -d);
        post.castShadow = true; scene.add(post);
      }
    }
  }
  sync(room: RoomState | null, now = Date.now()): void {
    for (const [index, plank] of this.planks.entries()) {
      const state: BridgePlank = room?.bridge.planks[index] ?? { stage: 'secured', holderId: '' };
      const loadBearing = state.stage === 'secured';
      if (this.enabled[index] !== loadBearing) {
        this.support[index].setEnabled(loadBearing);
        this.enabled[index] = loadBearing;
      }
      plank.material = state.stage === 'placed' ? placedTimber : timber;
      if (state.stage === 'stock') {
        plank.position.set(BRIDGE_STOCK_POINT[0], BRIDGE_STOCK_POINT[1] - .6 + index * .28, BRIDGE_STOCK_POINT[2]);
        plank.rotation.set(0, 0, 0);
      } else if (state.stage === 'carried') {
        const carrier = room?.characters[state.holderId];
        const yaw = carrier?.yaw ?? 0;
        plank.position.set((carrier?.p[0] ?? BRIDGE_STOCK_POINT[0]) - Math.sin(yaw) * .55,
          (carrier?.p[1] ?? BRIDGE_STOCK_POINT[1]) - .12,
          (carrier?.p[2] ?? BRIDGE_STOCK_POINT[2]) - Math.cos(yaw) * .55);
        plank.rotation.set(0, carrier?.yaw ?? 0, 0);
      } else if (state.stage === 'thrown' && state.p) {
        const progress = Math.min(1, Math.max(0, (now - (state.thrownAt ?? 0)) / 450));
        const from = state.from ?? state.p;
        plank.position.set(
          THREE.MathUtils.lerp(from[0], state.p[0], progress),
          THREE.MathUtils.lerp(from[1] + .6, state.p[1], progress) + Math.sin(progress * Math.PI) * 1.1,
          THREE.MathUtils.lerp(from[2], state.p[2], progress),
        );
        plank.rotation.set(0, Math.atan2(state.p[0] - from[0], from[2] - state.p[2]), progress * Math.PI * 1.5);
      } else {
        const d = BRIDGE_SLOTS[index];
        plank.position.set(roadX(d), roadY(d) + .12, -d);
        plank.rotation.set(0, -Math.atan2(roadX(d + 1) - roadX(d - 1), 2), 0);
      }
    }
  }
}
