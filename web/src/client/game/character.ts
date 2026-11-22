import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterMotion, CharacterSnapshot } from '../../shared/room';
import { groundY } from '../../shared/route';

export const JACKET_COLORS = [0x2454d7, 0xd54344, 0x3d9e51, 0xe5ba38] as const;

interface CharacterAsset {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

/** Load once; each avatar gets its own skeleton and animation mixer. */
export async function loadCharacterAsset(): Promise<CharacterAsset> {
  const url = new URL('../assets/player-character.glb', import.meta.url).href;
  const gltf = await new GLTFLoader().loadAsync(url);
  if (!gltf.scene.getObjectByName('TowBoy_Rig') || gltf.animations.length < 15)
    throw new Error('Character GLB is missing its skeleton or animations');
  return { scene: gltf.scene, clips: gltf.animations };
}

export class Avatar {
  readonly model = new THREE.Group();
  private readonly visual: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private motion: CharacterMotion | 'SitDriver' | 'SitPassenger' = 'Idle';
  private oneShotRemaining = 0;
  private knocked = false;
  private jacketColor = -1;
  private readonly contactShadow: THREE.Mesh;
  constructor(scene: THREE.Scene, asset: CharacterAsset, color: number = JACKET_COLORS[0]) {
    this.visual = cloneSkeleton(asset.scene);
    // The Rapier capsule is centred ~0.78 m above the ground; the GLB is
    // authored from its soles upward. Leave controller and collider unchanged.
    this.visual.position.y = -.78;
    this.model.add(this.visual);
    this.contactShadow = new THREE.Mesh(new THREE.CircleGeometry(.42, 18),
      new THREE.MeshBasicMaterial({ color: 0x172522, transparent: true, opacity: .24, depthWrite: false }));
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = -.77;
    this.model.add(this.contactShadow);
    scene.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.visual);
    for (const clip of asset.clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.setJacketColor(color);
    this.play('Idle');
    this.visual.traverse(object => {
      if (object instanceof THREE.SkinnedMesh) {
        object.frustumCulled = false;
        object.castShadow = false;
        if (object.material.name.startsWith('Clear lightly tinted lenses')) {
          object.material.transparent = true;
          object.material.depthWrite = false;
        }
      }
    });
  }
  setJacketColor(color: number): void {
    if (this.jacketColor === color) return;
    this.jacketColor = color;
    const base = new THREE.Color(color);
    const changed = new Map<THREE.Material, THREE.Material>();
    this.visual.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const original = object.material;
      if (!(original instanceof THREE.MeshStandardMaterial)) return;
      if (!original.name.startsWith('Jacket_Main') && !original.name.startsWith('Jacket highlights')) return;
      let material = changed.get(original) as THREE.MeshStandardMaterial | undefined;
      if (!material) {
        material = original.clone();
        material.color.copy(base);
        if (original.name.startsWith('Jacket highlights'))
          material.color.lerp(new THREE.Color(0xffffff), .17);
        changed.set(original, material);
      }
      object.material = material;
    });
  }
  private play(name: string, once = false): void {
    const next = this.actions.get(name) ?? this.actions.get('Idle');
    if (!next || (this.current === next && !once)) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(name === 'Walk' ? 2.1 : name === 'Run' ? 1.85 :
      name === 'CarryWalk' ? 1.7 : 1);
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, .16, true);
    next.play();
    this.current = next;
    this.oneShotRemaining = once ? next.getClip().duration : 0;
  }
  playOnce(name: 'Pickup' | 'Place' | 'Enter' | 'Exit' | 'Stand'): void { this.play(name, true); }
  setMotion(motion: CharacterMotion | 'SitDriver' | 'SitPassenger'): void { this.motion = motion; }
  setSeated(seated: boolean): void { this.contactShadow.visible = !seated; }
  protected positionShadow(x: number, y: number, z: number): void {
    this.contactShadow.position.y = groundY(x, z) - y + .035;
  }
  inspect(): { visible: boolean; jacket: number; animation: string; skinnedMeshes: number; lensOpacity: number } {
    let skinnedMeshes = 0, lensOpacity = -1;
    this.visual.traverse(object => {
      if (object instanceof THREE.SkinnedMesh) {
        skinnedMeshes++;
        if (object.material.name.startsWith('Clear lightly tinted lenses'))
          lensOpacity = object.material.opacity;
      }
    });
    return { visible: this.model.visible, jacket: this.jacketColor,
      animation: this.current?.getClip().name ?? '', skinnedMeshes, lensOpacity };
  }
  setKnocked(knocked: boolean): void {
    if (this.knocked === knocked) return;
    this.knocked = knocked;
    if (knocked) this.play('Knockdown', true);
    else this.playOnce('Stand');
  }
  animate(dt: number): void {
    if (this.oneShotRemaining > 0) this.oneShotRemaining -= dt;
    else if (!this.knocked) this.play(this.motion);
    this.mixer.update(dt);
  }
  follow(snapshot: CharacterSnapshot, dt: number): void {
    const alpha = 1 - Math.exp(-10 * Math.min(dt, .1));
    this.model.position.lerp(new THREE.Vector3(...snapshot.p), alpha);
    this.positionShadow(this.model.position.x, this.model.position.y, this.model.position.z);
    const delta = THREE.MathUtils.euclideanModulo(snapshot.yaw - this.model.rotation.y + Math.PI, 2 * Math.PI) - Math.PI;
    this.model.rotation.y += delta * alpha;
    this.setMotion(snapshot.motion ?? (snapshot.moving ? 'Walk' : 'Idle'));
    this.animate(dt);
  }
}

export class Walker extends Avatar {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private velocityY = 0;
  private seq = 0;
  private walking = false;
  private grounded = false;
  private activity: 'Carry' | 'Winch' | null = null;
  private currentMotion: CharacterMotion = 'Idle';
  constructor(scene: THREE.Scene, physics: RAPIER.World, asset: CharacterAsset, color: number = JACKET_COLORS[0]) {
    super(scene, asset, color);
    this.body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 2, 0));
    this.collider = physics.createCollider(RAPIER.ColliderDesc.capsule(.51, .28).setFriction(.7), this.body);
    this.collider.setEnabled(false);
    this.controller = physics.createCharacterController(.02);
    this.controller.enableSnapToGround(.22);
    this.controller.setMaxSlopeClimbAngle(Math.PI / 4);
    this.model.visible = false;
  }
  setWalking(walking: boolean, snapshot: CharacterSnapshot): void {
    if (this.walking === walking) return;
    this.walking = walking; this.collider.setEnabled(walking); this.model.visible = walking;
    if (walking) {
      this.body.setTranslation({ x: snapshot.p[0], y: snapshot.p[1], z: snapshot.p[2] }, true);
      this.model.position.set(...snapshot.p); this.seq = snapshot.seq; this.velocityY = 0;
      this.playOnce('Exit');
    } else this.playOnce('Enter');
  }
  restore(snapshot: CharacterSnapshot): void {
    this.body.setTranslation({ x: snapshot.p[0], y: snapshot.p[1], z: snapshot.p[2] }, true);
    this.model.position.set(...snapshot.p);
    this.seq = snapshot.seq;
    this.velocityY = 0;
  }
  setActivity(activity: 'Carry' | 'Winch' | null): void { this.activity = activity; }
  step(dt: number, pressed: Set<string>, camera: THREE.Camera, speedFactor = 1): void {
    if (!this.walking) return;
    const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const forwardInput = Number(pressed.has('KeyW') || pressed.has('ArrowUp') || pressed.has('throttle')) - Number(pressed.has('KeyS') || pressed.has('ArrowDown') || pressed.has('brake'));
    const rightInput = Number(pressed.has('KeyD') || pressed.has('ArrowRight') || pressed.has('right')) - Number(pressed.has('KeyA') || pressed.has('ArrowLeft') || pressed.has('left'));
    const direction = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(rightInput));
    if (direction.lengthSq() > 0) direction.normalize();
    if (pressed.has('Space') && this.grounded) { this.velocityY = 5.4; this.grounded = false; }
    this.velocityY = Math.max(-18, this.velocityY - 15 * dt);
    const running = pressed.has('ShiftLeft') || pressed.has('ShiftRight');
    const speed = (running ? 5.3 : 3.4) * speedFactor;
    const desired = direction.clone().multiplyScalar(speed * dt); desired.y = this.velocityY * dt;
    this.controller.computeColliderMovement(this.collider, desired);
    const corrected = this.controller.computedMovement();
    const p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + corrected.x, y: p.y + corrected.y, z: p.z + corrected.z });
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocityY < 0) this.velocityY = 0;
    if (direction.lengthSq() > 0) this.model.rotation.y = Math.atan2(-direction.x, -direction.z);
    this.currentMotion = !this.grounded ? 'Jump'
      : this.activity === 'Winch' ? 'Winch'
      : this.activity === 'Carry' ? direction.lengthSq() > 0 ? 'CarryWalk' : 'Carry'
      : direction.lengthSq() > 0 ? running ? 'Run' : 'Walk' : 'Idle';
    this.setMotion(this.currentMotion);
    this.animate(dt);
  }
  sync(): void {
    const p = this.body.translation();
    this.model.position.set(p.x, p.y, p.z);
    this.positionShadow(p.x, p.y, p.z);
  }
  sample(moving: boolean): CharacterSnapshot {
    const p = this.body.translation();
    return { p: [p.x, p.y, p.z], yaw: this.model.rotation.y, moving, motion: this.currentMotion,
      seq: ++this.seq, at: 0 };
  }
}
