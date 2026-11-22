import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceBear, initialBear } from '../src/shared/bear';
import { dragRoadblock, initialRoadblock, roadblockEnd } from '../src/shared/roadblock';
import { validSnapshot } from '../src/server/rooms/room-service';
import { initialVehicle } from '../src/shared/room';
import { LOG_DISTANCE, ROUTE_LENGTH, groundY, roadX } from '../src/shared/route';

test('expanded route accepts finite vehicle snapshots through the finish, but rejects out-of-world values', () => {
  const snapshot = initialVehicle(0);
  snapshot.seq = 1;
  snapshot.p = [roadX(ROUTE_LENGTH), groundY(roadX(ROUTE_LENGTH), -ROUTE_LENGTH) + 1.3, -ROUTE_LENGTH];
  assert.equal(validSnapshot(snapshot), true);
  assert.equal(validSnapshot({ ...snapshot, p: [0, 1, -ROUTE_LENGTH - 200] }), false);
  assert.equal(validSnapshot({ ...snapshot, p: [0, Number.NaN, -700] }), false);
});

test('bear gives warning before chasing and a caught walker can recover without repeated knockdown', () => {
  let now = 100_000;
  const bear = initialBear(now);
  const walker = { p: [...bear.p] as [number, number, number], yaw: 0, moving: false, seq: 1, at: now };
  const characters = { scout: walker };
  advanceBear(bear, now += 500, null, characters, []);
  assert.equal(bear.mode, 'investigate');
  assert.equal(bear.knockedUntil.scout, undefined);
  for (let i = 0; i < 5; i++) advanceBear(bear, now += 500, null, characters, []);
  assert.equal(bear.mode, 'alert');
  assert.equal(bear.knockedUntil.scout, undefined);
  for (let i = 0; i < 5; i++) advanceBear(bear, now += 500, null, characters, []);
  assert.ok(bear.knockedUntil.scout > now);
  const knocked = bear.knockedUntil.scout;
  for (let i = 0; i < 8; i++) advanceBear(bear, now += 500, null, characters, []);
  assert.ok(bear.cooldownUntil > now);
  assert.ok(bear.knockedUntil.scout === knocked || bear.knockedUntil.scout === undefined);
  advanceBear(bear, now += 20_000, null, characters, ['scout']);
  assert.equal(bear.knockedUntil.scout, undefined);
});

test('fallen tree cannot be cleared by one walker; both grips move its collision position', () => {
  const log = initialRoadblock();
  const initial = log.p[0];
  log.grips[0] = 'scout';
  dragRoadblock(log, 'scout', roadblockEnd(log, 0), [roadblockEnd(log, 0)[0] + 1, log.p[1], -LOG_DISTANCE]);
  assert.equal(log.p[0], initial);
  log.grips[1] = 'driver';
  for (let step = 0; step < 19; step++)
    dragRoadblock(log, 'scout', [0, 0, 0], [1, 0, 0]);
  assert.equal(log.cleared, true);
  assert.ok(log.p[0] >= initial + 8.5);
  assert.deepEqual(log.grips, [null, null]);
});
