import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Bridge } from '../src/client/game/bridge';
import { Vehicle } from '../src/client/game/vehicle';
import { BRIDGE_SLOTS, initialBridge } from '../src/shared/bridge';
import { roadX, roadY } from '../src/shared/route';
import type { RoomState } from '../src/shared/room';

test('unsecured bridge has no support; secured Rapier planks hold the RV', async () => {
  await RAPIER.init();
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  physics.timestep = 1 / 60;
  const scene = new THREE.Scene();
  const bridge = new Bridge(scene, physics);
  const d = BRIDGE_SLOTS[0];
  const origin = { x: roadX(d), y: roadY(d) + 3, z: -d };
  const ray = new RAPIER.Ray(origin, { x: 0, y: -1, z: 0 });
  const state = { bridge: initialBridge(), characters: {} } as RoomState;
  bridge.sync(state);
  physics.step();
  const sideRay = new RAPIER.Ray(
    { x: roadX(119) + 7, y: roadY(119) + 3, z: -119 }, { x: 0, y: -1, z: 0 });
  assert.ok(physics.castRay(sideRay, 5, true), 'mechanic needs a physical catwalk across the gap');
  assert.equal(physics.castRay(ray, 5, true), null, 'empty slot must not support a vehicle');
  state.bridge.planks[0].stage = 'placed';
  bridge.sync(state);
  assert.equal(physics.castRay(ray, 5, true), null, 'loose plank is not load-bearing');
  state.bridge.planks[0].stage = 'secured';
  bridge.sync(state);
  physics.step(); // Rapier refreshes the query pipeline after enabled colliders change.
  assert.ok(physics.castRay(ray, 5, true), 'secured plank needs a real collider');
  const vehicle = new Vehicle(scene, physics);
  vehicle.body.setTranslation({ x: roadX(d), y: roadY(d) + 1.5, z: -d }, true);
  vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  for (let i = 0; i < 90; i++) { vehicle.step(1 / 60); physics.step(); }
  assert.ok(vehicle.body.translation().y > roadY(d) + .7, 'RV fell through the secured bridge');
  physics.free();
});
