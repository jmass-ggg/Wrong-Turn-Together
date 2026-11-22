import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from '../src/client/game/vehicle';
import { Winch } from '../src/client/game/winch';
import { ANCHOR_POINT } from '../src/shared/cable';
import { roadX, roadY } from '../src/shared/route';
import type { RoomState } from '../src/shared/room';

test('attached cable impulses move the real Rapier RV toward the anchor', async () => {
  await RAPIER.init();
  const physics = new RAPIER.World({ x: 0, y: 0, z: 0 });
  physics.timestep = 1 / 60;
  const scene = new THREE.Scene();
  const vehicle = new Vehicle(scene, physics);
  vehicle.body.setTranslation({ x: ANCHOR_POINT[0], y: ANCHOR_POINT[1], z: ANCHOR_POINT[2] + 18 }, true);
  vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  vehicle.syncVisual();
  const winch = new Winch(vehicle, scene);
  const room = {
    cable: { stage: 'attached', holderId: 'mechanic', end: 'front', length: 8, reeling: false, changedAt: Date.now() },
    characters: {},
  } as RoomState;
  const before = vehicle.body.translation().z;
  for (let i = 0; i < 60; i++) {
    winch.step(1 / 60, room, Date.now());
    physics.step();
    vehicle.syncVisual();
  }
  assert.ok(vehicle.body.translation().z < before - 1, `RV did not move: ${before} -> ${vehicle.body.translation().z}`);
  assert.ok(Number.isFinite(vehicle.body.translation().z));
  physics.free();
});

test('cable tension follows server time rather than the device wall clock', async () => {
  await RAPIER.init();
  const physics = new RAPIER.World({ x: 0, y: 0, z: 0 });
  physics.timestep = 1 / 60;
  const scene = new THREE.Scene();
  const vehicle = new Vehicle(scene, physics);
  vehicle.body.setTranslation({ x: ANCHOR_POINT[0], y: ANCHOR_POINT[1], z: ANCHOR_POINT[2] + 18 }, true);
  vehicle.syncVisual();
  const winch = new Winch(vehicle, scene);
  const room = {
    cable: { stage: 'attached', holderId: 'mechanic', end: 'front', length: 20, reeling: true, changedAt: 100_000 },
    characters: {},
  } as RoomState;
  winch.step(1 / 60, room, 100_050);
  assert.equal(winch.tension, 0, 'a slack cable must not pull because a device clock runs ahead');
  physics.free();
});

test('deep mud traps throttle-only RV and a loaded winch recovers it', async () => {
  await RAPIER.init();
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  physics.timestep = 1 / 60;
  physics.createCollider(RAPIER.ColliderDesc.cuboid(40, .2, 40).setTranslation(roadX(60), roadY(60) - .2, -60));
  const vehicle = new Vehicle(new THREE.Scene(), physics);
  vehicle.body.setTranslation({ x: roadX(59), y: roadY(59) + 1.3, z: -59 }, true);
  vehicle.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0),
    -Math.atan2(roadX(61) - roadX(59), 2)), true);
  vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  vehicle.input.throttle = 1;
  for (let i = 0; i < 1200; i++) { vehicle.step(1 / 60); physics.step(); }
  const stuckAt = vehicle.body.translation().z;
  assert.ok(vehicle.mudRuts > .4, `throttle did not dig ruts: ${vehicle.mudRuts}`);
  assert.ok(stuckAt > -66, `throttle alone escaped the deep mud: ${stuckAt}`);
  const winch = new Winch(vehicle, new THREE.Scene());
  const room = { cable: { stage: 'attached', holderId: 'mechanic', end: 'front', length: 9, reeling: true, changedAt: 100_000 },
    characters: {} } as RoomState;
  for (let i = 0; i < 900; i++) {
    vehicle.step(1 / 60); vehicle.syncVisual();
    winch.step(1 / 60, room, 100_000 + i * 1000 / 60);
    physics.step();
  }
  const escapedAt = vehicle.body.translation().z;
  assert.ok(escapedAt < stuckAt - 5, `winch did not overcome mud: ${stuckAt} -> ${escapedAt}`);
  assert.ok(Number.isFinite(escapedAt));
  physics.free();
});
