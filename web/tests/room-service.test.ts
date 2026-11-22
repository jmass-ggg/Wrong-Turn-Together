import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomService, type RoomStore } from '../src/server/rooms/room-service';
import { initialVehicle, STALE_PLAYER_MS } from '../src/shared/room';
import { ANCHOR_POINT, cableForce, cableLength, MANUAL_FORCE_LIMIT, WINCH_FORCE_LIMIT } from '../src/shared/cable';
import { CHECKPOINTS, ROUTE_LENGTH, groundY, roadX, roadY } from '../src/shared/route';
import { BRIDGE_STOCK_POINT, BRIDGE_SLOTS, bridgeWorkPoint } from '../src/shared/bridge';

function fixture() {
  let now = 100_000;
  const data = new Map<string, { value: string; expiration: number }>();
  const store: RoomStore = {
    async get(key) { const item = data.get(key); if (item && item.expiration > now) return item.value; data.delete(key); return null; },
    async set(key, value, options) {
      const old = await this.get(key);
      if (options?.nx && old !== null) return null;
      data.set(key, { value, expiration: options?.expiration?.getTime() ?? Infinity });
      return 'OK';
    },
    async del(key) { data.delete(key); },
    async incrBy(key, amount) { const value = Number(await this.get(key) ?? 0) + amount; data.set(key, { value: String(value), expiration: Infinity }); return value; },
    async expire(key, seconds) { const item = data.get(key); if (item) item.expiration = now + seconds * 1000; },
  };
  let counter = 0;
  const service = new RoomService(store, () => now, () => `ABC${222 + ++counter}`);
  return { service, advance: (ms: number) => { now += ms; },
    saveRoom: async (room: Awaited<ReturnType<RoomService['get']>>) => {
      await store.set(`tow:room:${room.scope}:${room.code}`, JSON.stringify(room));
    },
    time: () => now };
}
const scope = 'post-1', a = { id: 't2_a', name: 'alpha' }, b = { id: 't2_b', name: 'bravo' }, c = { id: 't2_c', name: 'charlie' };

test('room checkpoints cannot be skipped and a shared result requires all seven ordered objectives', async () => {
  const { service, advance, saveRoom, time } = fixture();
  const created = await service.create(scope, a);
  await service.join(scope, created.code, b);
  await service.ready(scope, created.code, a.id, true);
  await service.ready(scope, created.code, b.id, true);
  await service.start(scope, created.code, a.id);
  const submitAt = async (d: number) => {
    const room = await service.get(scope, created.code, a.id);
    room.vehicle = { ...initialVehicle(time() - 300), p: [roadX(d), roadY(d) + 1.4, -d], at: time() - 300 };
    await saveRoom(room);
    advance(300);
    return service.snapshot(scope, created.code, a.id, room.epoch,
      { ...room.vehicle, seq: 1 });
  };
  let room = await submitAt(CHECKPOINTS[1]);
  assert.equal(room.checkpoint, 0, 'later stop cannot bypass the first');
  room = await submitAt(CHECKPOINTS[0]);
  assert.equal(room.checkpoint, 0, 'mud objective is mandatory');
  room.mud.rescued = true; await saveRoom(room);
  room = await submitAt(CHECKPOINTS[0]);
  assert.equal(room.checkpoint, 1);
  room = await submitAt(CHECKPOINTS[1]);
  assert.equal(room.checkpoint, 1, 'unrepaired bridge cannot grant a checkpoint');
  room.bridge.crossed = true; await saveRoom(room);
  room = await submitAt(CHECKPOINTS[1]);
  assert.equal(room.checkpoint, 2);
  room = await submitAt(ROUTE_LENGTH);
  assert.equal(room.status, 'running');
  assert.equal(room.result, null);
  // Set up the remaining completed physical objectives, then visit each stop
  // in order. These test fixtures do not claim to have played those obstacles.
  room.bear.cleared = true;
  room.roadblock.cleared = true;
  room.journey.riverCrossed = true;
  room.journey.hillClimbed = true;
  room.journey.cliffCleared = true;
  await saveRoom(room);
  for (const distance of CHECKPOINTS.slice(2)) {
    room = await submitAt(distance);
  }
  assert.equal(room.checkpoint, CHECKPOINTS.length);
  room = await submitAt(ROUTE_LENGTH);
  assert.equal(room.status, 'finished');
  assert.equal(room.result?.checkpoints, CHECKPOINTS.length);
  assert.deepEqual(room.result?.players, ['alpha', 'bravo']);
  await assert.rejects(service.snapshot(scope, created.code, a.id, room.epoch,
    { ...room.vehicle, seq: 2 }), { status: 409 });
});

test('bridge planks require a walking builder, proximity, and securing; disconnect returns carried stock', async () => {
  const { service, advance } = fixture();
  const created = await service.create(scope, a);
  await service.join(scope, created.code, b);
  await service.ready(scope, created.code, a.id, true);
  await service.ready(scope, created.code, b.id, true);
  await service.start(scope, created.code, a.id);
  await assert.rejects(service.bridgeAction(scope, created.code, b.id, 'pickup'), { status: 409 });
  await service.seat(scope, created.code, b.id, null);
  let seq = 1;
  const walkTo = async (point: readonly number[]) => {
    const current = (await service.get(scope, created.code, b.id)).characters[b.id].p;
    const distance = Math.hypot(...point.map((v, i) => v - current[i]));
    const steps = Math.ceil(distance / 2.4);
    for (let step = 1; step <= steps; step++) {
      advance(500);
      if (step % 20 === 0) {
        await service.heartbeat(scope, created.code, a.id);
        await service.heartbeat(scope, created.code, b.id);
      }
      const p = point.map((v, i) => current[i] + (v - current[i]) * step / steps) as [number, number, number];
      await service.character(scope, created.code, b.id, { p, yaw: 0, moving: true, seq: ++seq });
    }
  };
  await assert.rejects(service.bridgeAction(scope, created.code, b.id, 'pickup'), { status: 409 });
  await walkTo(BRIDGE_STOCK_POINT);
  let room = await service.bridgeAction(scope, created.code, b.id, 'pickup');
  assert.equal(room.bridge.planks[0].stage, 'carried');
  await assert.rejects(service.bridgeAction(scope, created.code, b.id, 'pickup'), { status: 409 });
  room = await service.leave(scope, created.code, b.id);
  assert.equal(room.bridge.planks[0].stage, 'stock');
  room = await service.join(scope, created.code, b);
  assert.equal(room.status, 'running');
  await service.bridgeAction(scope, created.code, b.id, 'pickup');
  room = await service.bridgeAction(scope, created.code, b.id, 'throw');
  assert.equal(room.bridge.planks[0].stage, 'thrown');
  assert.ok(room.bridge.planks[0].p);
  assert.ok(Math.hypot(...room.bridge.planks[0].p!.map((v, i) => v - BRIDGE_STOCK_POINT[i])) < 4.5);
  await assert.rejects(service.bridgeAction(scope, created.code, b.id, 'throw'), { status: 409 });
  room = await service.bridgeAction(scope, created.code, b.id, 'pickup');
  assert.equal(room.bridge.planks[0].stage, 'carried');
  await assert.rejects(service.bridgeAction(scope, created.code, b.id, 'place'), { status: 409 });
  await walkTo(bridgeWorkPoint(0));
  room = await service.bridgeAction(scope, created.code, b.id, 'place');
  assert.equal(room.bridge.planks[0].stage, 'placed');
  assert.equal(room.bridge.complete, false);
  await assert.rejects(service.bridgeAction(scope, created.code, b.id, 'place'), { status: 409 });
  await service.bridgeAction(scope, created.code, b.id, 'retrieve');
  await service.bridgeAction(scope, created.code, b.id, 'place');
  room = await service.bridgeAction(scope, created.code, b.id, 'secure');
  assert.equal(room.bridge.planks[0].stage, 'secured');
  await assert.rejects(service.bridgeAction(scope, created.code, b.id, 'secure'), { status: 409 });
  await walkTo(BRIDGE_STOCK_POINT);
  await service.bridgeAction(scope, created.code, b.id, 'pickup');
  await walkTo(bridgeWorkPoint(1));
  await service.bridgeAction(scope, created.code, b.id, 'place');
  room = await service.bridgeAction(scope, created.code, b.id, 'secure');
  assert.equal(room.bridge.complete, true);
  assert.deepEqual(room.bridge.planks.map(plank => plank.stage), ['secured', 'secured']);
  assert.equal(BRIDGE_SLOTS.length, 2);
});

test('road remains driveable while terrain rises into hills beyond its shoulder', () => {
  const d = 36;
  assert.ok(Math.abs(groundY(roadX(d), -d) - roadY(d)) < .2);
  assert.ok(groundY(roadX(d) + 22, -d) > roadY(d) + 3);
  assert.ok(groundY(roadX(d) - 22, -d) > roadY(d) + 3);
});

test('room capacity, identity, ready gate, start and reconnect', async () => {
  const { service, advance } = fixture();
  const room = await service.create(scope, a);
  assert.equal(room.players.length, 1);
  await assert.rejects(service.get(scope, room.code, b.id), { status: 403 });
  await service.join(scope, room.code, b);
  await assert.rejects(service.join(scope, room.code, c), { status: 409 });
  await assert.rejects(service.start(scope, room.code, a.id), { status: 409 });
  await service.ready(scope, room.code, a.id, true);
  await service.ready(scope, room.code, b.id, true);
  await assert.rejects(service.start(scope, room.code, b.id), { status: 409 });
  const started = await service.start(scope, room.code, a.id);
  assert.equal(started.status, 'running'); assert.equal(started.ownerId, a.id);
  assert.equal(started.serverNow, started.startedAt);
  advance(STALE_PLAYER_MS + 1);
  const paused = await service.heartbeat(scope, room.code, b.id);
  assert.equal(paused.status, 'paused'); assert.equal(paused.ownerId, b.id);
  assert.ok(paused.epoch > started.epoch);
  const resumed = await service.join(scope, room.code, a);
  assert.equal(resumed.status, 'running'); assert.equal(resumed.ownerId, a.id);
});

test('seats are exclusive, character updates are ordered, and driving ownership follows the claimed driver', async () => {
  const { service, advance } = fixture();
  const room = await service.create(scope, a);
  await service.join(scope, room.code, b);
  await service.ready(scope, room.code, a.id, true);
  await service.ready(scope, room.code, b.id, true);
  const started = await service.start(scope, room.code, a.id);
  assert.deepEqual(started.seats, { driver: a.id, passenger: b.id });
  await assert.rejects(service.seat(scope, room.code, b.id, 'driver'), { status: 409 });
  await assert.rejects(service.character(scope, room.code, b.id, { p: [0, 1, 0], yaw: 0, moving: true, seq: 1 }), { status: 409 });
  const exited = await service.seat(scope, room.code, a.id, null);
  assert.equal(exited.seats.driver, null);
  advance(200);
  const old = exited.characters[a.id];
  const walk = { p: [old.p[0] - .3, old.p[1], old.p[2]], yaw: 0, moving: true, motion: 'Walk', seq: old.seq + 1, at: 0 };
  const moved = await service.character(scope, room.code, a.id, walk);
  assert.equal(moved.characters[a.id].seq, walk.seq);
  assert.equal(moved.characters[a.id].motion, 'Walk');
  advance(200);
  await assert.rejects(service.character(scope, room.code, a.id,
    { ...walk, seq: walk.seq + 1, motion: 'Teleport' }), { status: 400 });
  await assert.rejects(service.character(scope, room.code, a.id, walk), { status: 400 });
  await assert.rejects(service.seat(scope, room.code, b.id, 'driver'), { status: 409 });
  await service.seat(scope, room.code, b.id, null);
  const swapped = await service.seat(scope, room.code, b.id, 'driver');
  assert.equal(swapped.seats.driver, b.id);
  assert.equal(swapped.ownerId, b.id);
  assert.ok(swapped.epoch > started.epoch);
  await assert.rejects(service.seat(scope, room.code, a.id, 'driver'), { status: 409 });
});

test('only current owner and epoch can send bounded, ordered snapshots', async () => {
  const { service, advance } = fixture();
  const room = await service.create(scope, a);
  await service.join(scope, room.code, b);
  await service.ready(scope, room.code, a.id, true); await service.ready(scope, room.code, b.id, true);
  const started = await service.start(scope, room.code, a.id);
  advance(300);
  const snapshot = { ...initialVehicle(0), seq: 1, p: [1, 1.32, -1] as [number, number, number] };
  await assert.rejects(service.snapshot(scope, room.code, b.id, started.epoch, snapshot), { status: 409 });
  await assert.rejects(service.snapshot(scope, room.code, a.id, started.epoch - 1, snapshot), { status: 409 });
  const accepted = await service.snapshot(scope, room.code, a.id, started.epoch, snapshot);
  assert.equal(accepted.vehicle?.seq, 1);
  await assert.rejects(service.snapshot(scope, room.code, a.id, started.epoch, snapshot), { status: 429 });
  advance(300);
  await assert.rejects(service.snapshot(scope, room.code, a.id, started.epoch, { ...snapshot, seq: 2, p: [200, 1, -1] }), { status: 400 });
  await assert.rejects(service.snapshot(scope, room.code, a.id, started.epoch, { ...snapshot, seq: 2, p: [NaN, 1, -1] }), { status: 400 });
});

test('cable attachment is server-validated and reeling shortens a bounded force cable', async () => {
  const { service, advance } = fixture();
  const room = await service.create(scope, a);
  await service.join(scope, room.code, b);
  await service.ready(scope, room.code, a.id, true);
  await service.ready(scope, room.code, b.id, true);
  const started = await service.start(scope, room.code, a.id);
  await assert.rejects(service.cableAction(scope, room.code, b.id, 'pickup'), { status: 409 });
  advance(3000);
  const nearMud = [roadX(63), roadY(63) + 1.32, -63] as [number, number, number];
  await service.snapshot(scope, room.code, a.id, started.epoch, { ...initialVehicle(0), p: nearMud, seq: 1 });
  await service.seat(scope, room.code, b.id, null);
  const carried = await service.cableAction(scope, room.code, b.id, 'pickup');
  assert.equal(carried.cable?.stage, 'carried');
  await service.cableAction(scope, room.code, b.id, 'detach');
  const rear = await service.cableAction(scope, room.code, b.id, 'pickup', 'rear');
  assert.equal(rear.cable?.end, 'rear');
  const left = await service.leave(scope, room.code, b.id);
  assert.equal(left.cable, null, 'leaving while holding a cable releases it');
  assert.equal(left.status, 'paused');
  await service.join(scope, room.code, b);
  await service.heartbeat(scope, room.code, b.id);
  await service.cableAction(scope, room.code, b.id, 'pickup');
  await assert.rejects(service.cableAction(scope, room.code, a.id, 'attach'), { status: 409 });
  await assert.rejects(service.cableAction(scope, room.code, b.id, 'attach'), { status: 409 });
  const from = carried.characters[b.id].p;
  for (let step = 1; step <= 6; step++) {
    advance(500);
    const fraction = step / 6;
    await service.character(scope, room.code, b.id, {
      p: from.map((v, i) => v + (ANCHOR_POINT[i] - v) * fraction),
      yaw: 0, moving: true, seq: step + 1,
    });
  }
  const attached = await service.cableAction(scope, room.code, b.id, 'attach');
  assert.equal(attached.cable?.stage, 'attached');
  const reeling = await service.cableAction(scope, room.code, b.id, 'reel');
  assert.equal(reeling.cable?.reeling, true);
  assert.equal(reeling.mud.entered, true);
  assert.equal(reeling.mud.winchUsed, true);
  advance(1000);
  const shortened = cableLength(reeling.cable!, reeling.cable!.changedAt + 1000);
  assert.ok(shortened < attached.cable!.length);
  assert.ok(cableForce(shortened + 3, shortened, 0) > 0);
  assert.equal(cableForce(shortened + 100, shortened, 100), WINCH_FORCE_LIMIT);
  assert.equal(cableForce(shortened + 100, shortened, 100, true), MANUAL_FORCE_LIMIT);
  assert.equal(cableForce(shortened - 1, shortened, 0), 0);
  const stopped = await service.cableAction(scope, room.code, b.id, 'stop');
  assert.equal(stopped.cable?.reeling, false);
  assert.ok(stopped.cable!.length < attached.cable!.length);
  const payingOut = await service.cableAction(scope, room.code, b.id, 'out');
  advance(1000);
  assert.equal(payingOut.cable?.payingOut, true);
  assert.ok(cableLength(payingOut.cable!, payingOut.cable!.changedAt + 1000) > stopped.cable!.length);
  const disconnected = await service.leave(scope, room.code, b.id);
  assert.equal(disconnected.cable?.stage, 'attached');
  assert.equal(disconnected.cable?.payingOut, false);
  assert.equal(disconnected.cable?.holderId, '');
  await service.join(scope, room.code, b);
  await service.cableAction(scope, room.code, b.id, 'reel');
  await service.cableAction(scope, room.code, b.id, 'stop');
  const detached = await service.cableAction(scope, room.code, b.id, 'detach');
  assert.equal(detached.cable, null);
  advance(1000);
  const farBank = await service.snapshot(scope, room.code, a.id, started.epoch,
    { ...initialVehicle(0), p: [roadX(74), roadY(74) + 1.32, -74], seq: 2 });
  assert.equal(farBank.mud.rescued, true);
  advance(1000);
  const checkpoint = await service.snapshot(scope, room.code, a.id, started.epoch,
    { ...initialVehicle(0), p: [roadX(84), roadY(84) + 1.32, -84], seq: 3 });
  assert.equal(checkpoint.checkpoint, 1);
});

test('carried cable cannot exceed its length and an overextended attachment releases', async () => {
  const { service, advance } = fixture();
  const room = await service.create(scope, a);
  await service.join(scope, room.code, b);
  await service.ready(scope, room.code, a.id, true);
  await service.ready(scope, room.code, b.id, true);
  const started = await service.start(scope, room.code, a.id);
  await service.seat(scope, room.code, b.id, null);
  await service.cableAction(scope, room.code, b.id, 'pickup');
  for (let step = 1; step <= 6; step++) {
    advance(1000);
    await service.character(scope, room.code, b.id,
      { p: [2.5, 1.32, 1 - step * 6], yaw: 0, moving: true, seq: step + 1 });
  }
  advance(1000);
  await assert.rejects(service.character(scope, room.code, b.id,
    { p: [2.5, 1.32, -41], yaw: 0, moving: true, seq: 8 }), { status: 409 });
  await service.leave(scope, room.code, b.id);
  await service.join(scope, room.code, b);
  advance(3000);
  await service.snapshot(scope, room.code, a.id, started.epoch,
    { ...initialVehicle(0), p: [roadX(63), roadY(63) + 1.32, -63], seq: 1 });
  const current = (await service.get(scope, room.code, b.id)).characters[b.id].p;
  const nearRv = [roadX(63) + 2.5, roadY(63) + 1.32, -63];
  for (let step = 1; step <= 6; step++) {
    advance(500);
    await service.character(scope, room.code, b.id,
      { p: current.map((value, i) => value + (nearRv[i] - value) * step / 6),
        yaw: 0, moving: true, seq: step + 7 });
  }
  await service.cableAction(scope, room.code, b.id, 'pickup');
  const from = (await service.get(scope, room.code, b.id)).characters[b.id].p;
  for (let step = 1; step <= 6; step++) {
    advance(500);
    await service.character(scope, room.code, b.id,
      { p: from.map((value, i) => value + (ANCHOR_POINT[i] - value) * step / 6),
        yaw: 0, moving: true, seq: step + 13 });
  }
  await service.cableAction(scope, room.code, b.id, 'attach');
  advance(1000);
  const released = await service.snapshot(scope, room.code, a.id, started.epoch,
    { ...initialVehicle(0), p: [roadX(20), roadY(20) + 1.32, -20], seq: 2 });
  assert.equal(released.cable, null);
});

test('driver recovery resets a stranded RV and walking teammate without accepting stale ownership', async () => {
  const { service, advance } = fixture();
  const room = await service.create(scope, a);
  await service.join(scope, room.code, b);
  await service.ready(scope, room.code, a.id, true);
  await service.ready(scope, room.code, b.id, true);
  const started = await service.start(scope, room.code, a.id);
  await service.seat(scope, room.code, b.id, null);
  advance(3000);
  const muddy = await service.snapshot(scope, room.code, a.id, started.epoch,
    { ...initialVehicle(0), p: [roadX(60), roadY(60) + 1.32, -60], q: [1, 0, 0, 0], seq: 1 });
  assert.equal(muddy.mud.entered, true);
  await assert.rejects(service.recover(scope, room.code, b.id), { status: 409 });
  const recovered = await service.recover(scope, room.code, a.id);
  assert.equal(recovered.recoveries, 1);
  assert.equal(recovered.vehicle?.hull, 90);
  assert.ok(recovered.vehicle!.p[2] > 0);
  assert.equal(recovered.vehicle?.q[0], 0, 'recovery rights an overturned RV');
  assert.ok(recovered.characters[b.id].p[2] > 0);
  assert.equal(recovered.mud.entered, false);
  assert.ok(recovered.epoch > started.epoch);
  await assert.rejects(service.snapshot(scope, room.code, a.id, started.epoch,
    { ...initialVehicle(0), seq: 2 }), { status: 409 });
});
