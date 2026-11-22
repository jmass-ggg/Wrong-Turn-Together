import { randomBytes } from 'node:crypto';
import { initialJourney, initialVehicle, ROOM_TTL_SECONDS, SNAPSHOT_MIN_MS, STALE_PLAYER_MS, validRoomCode } from '../../shared/room';
import type { CharacterSnapshot, RoomState, VehicleSnapshot } from '../../shared/room';
import { ANCHOR_POINT, CABLE_MAX_LENGTH, cableLength } from '../../shared/cable';
import { MUD_END, MUD_START } from '../../shared/cable';
import { BEAR_TERRITORY, CHECKPOINTS, CLIFF, HILL, RIVER, ROAD_WIDTH, ROUTE_LENGTH, roadX, roadY } from '../../shared/route';
import { mudDepth } from '../../shared/mud';
import type { CableEnd } from '../../shared/cable';
import { BRIDGE_END, BRIDGE_START, BRIDGE_SLOTS, BRIDGE_STOCK_POINT, bridgeWorkPoint, initialBridge, plankLanding } from '../../shared/bridge';
import { advanceBear, initialBear } from '../../shared/bear';
import { dragRoadblock, initialRoadblock, roadblockEnd } from '../../shared/roadblock';

export interface RoomStore {
  get(key: string): Promise<string | undefined | null>;
  set(key: string, value: string, options?: { nx?: boolean; expiration?: Date }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incrBy(key: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}
export class RoomError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRoomCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}
export function validSnapshot(value: unknown): value is VehicleSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  const vector = (field: string, n: number, bound: number) => Array.isArray(s[field]) && (s[field] as unknown[]).length === n && (s[field] as unknown[]).every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= bound);
  if (!vector('p', 3, ROUTE_LENGTH + 150) || !vector('q', 4, 1.01) || !vector('v', 3, 80) || !vector('a', 3, 30)) return false;
  const q = s.q as number[];
  const norm = q.reduce((sum, component) => sum + component * component, 0);
  return norm > .8 && norm < 1.2 && typeof s.steer === 'number' && Math.abs(s.steer) <= 1 &&
    typeof s.hull === 'number' && s.hull >= 0 && s.hull <= 100 && typeof s.fuel === 'number' && s.fuel >= 0 && s.fuel <= 100 &&
    Number.isSafeInteger(s.seq) && (s.seq as number) > 0;
}

export class RoomService {
  constructor(private store: RoomStore, private now = () => Date.now(), private code = newRoomCode) {}
  private key(scope: string, code: string): string { return `tow:room:${scope}:${code}`; }
  private async read(scope: string, code: string): Promise<RoomState> {
    if (!validRoomCode(code)) throw new RoomError('Invalid room code', 400);
    const raw = await this.store.get(this.key(scope, code));
    if (!raw) throw new RoomError('Room not found or expired', 404);
    const room = JSON.parse(raw) as RoomState;
    if (room.scope !== scope) throw new RoomError('Room unavailable in this post', 404);
    room.seats ??= { driver: null, passenger: null };
    room.characters ??= {};
    room.cable ??= null;
    if (room.cable) room.cable.payingOut ??= false;
    room.mud ??= { entered: false, winchUsed: false, rescued: false };
    room.checkpoint ??= 0;
    room.recoveries ??= 0;
    room.bridge ??= initialBridge();
    room.bear ??= initialBear(this.now());
    room.roadblock ??= initialRoadblock();
    room.journey ??= initialJourney();
    room.result ??= null;
    room.serverNow = this.now();
    return room;
  }
  private async save(room: RoomState): Promise<void> {
    room.serverNow = this.now();
    await this.store.set(this.key(room.scope, room.code), JSON.stringify(room), { expiration: new Date(this.now() + ROOM_TTL_SECONDS * 1000) });
  }
  private async lock<T>(scope: string, code: string, action: (room: RoomState) => Promise<T>): Promise<T> {
    const key = `${this.key(scope, code)}:lock`, token = randomBytes(12).toString('hex');
    for (let attempt = 0; attempt < 30; attempt++) {
      await this.store.set(key, token, { nx: true, expiration: new Date(this.now() + 5000) });
      if (await this.store.get(key) === token) {
        try { return await action(await this.read(scope, code)); }
        finally { if (await this.store.get(key) === token) await this.store.del(key); }
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new RoomError('Room is busy; try again', 409);
  }
  private refresh(room: RoomState): boolean {
    const now = this.now(); let changed = false;
    for (const player of room.players) {
      if (player.connected && now - player.lastSeen > STALE_PLAYER_MS) { player.connected = false; player.ready = false; changed = true; }
    }
    if (room.cable && room.cable.holderId && !room.players.some(p => p.id === room.cable!.holderId && p.connected)) {
      if (room.cable.stage === 'carried') room.cable = null;
      else {
        room.cable.length = cableLength(room.cable, now);
        room.cable.reeling = false;
        room.cable.payingOut = false;
        room.cable.holderId = '';
        room.cable.changedAt = now;
      }
      changed = true;
    }
    for (const plank of room.bridge.planks) {
      if (plank.stage === 'carried' && !room.players.some(p => p.id === plank.holderId && p.connected)) {
        plank.stage = 'stock'; plank.holderId = ''; changed = true;
      }
    }
    for (let i = 0; i < room.roadblock.grips.length; i++) {
      const id = room.roadblock.grips[i];
      if (id && !room.players.some(p => p.id === id && p.connected)) {
        room.roadblock.grips[i] = null; changed = true;
      }
    }
    if (room.status === 'running' && room.players.some(p => !p.connected)) { room.status = 'paused'; changed = true; }
    if (room.status === 'paused' && room.players.length === 2 && room.players.every(p => p.connected)) { room.status = 'running'; changed = true; }
    if (room.ownerId && !room.players.some(p => p.id === room.ownerId && p.connected)) {
      const replacement = room.players.find(p => p.connected);
      if (replacement) { room.ownerId = replacement.id; room.epoch++; room.vehicle = room.vehicle ? { ...room.vehicle, seq: 0, at: now } : null; changed = true; }
    }
    const driver = room.players.find(p => p.id === room.seats.driver && p.connected);
    if (driver && room.ownerId !== driver.id) {
      room.ownerId = driver.id; room.epoch++;
      if (room.vehicle) room.vehicle = { ...room.vehicle, seq: 0, at: now };
      changed = true;
    }
    if (changed) room.revision++;
    return changed;
  }
  async create(scope: string, user: { id: string; name: string }): Promise<RoomState> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = this.code(), now = this.now();
      const room: RoomState = { code, scope, serverNow: now, players: [{ id: user.id, name: user.name, connected: true, ready: false, lastSeen: now }],
        status: 'waiting', ownerId: user.id, epoch: 1, revision: 1, startedAt: null, vehicle: null,
        seats: { driver: null, passenger: null }, characters: {}, cable: null,
        mud: { entered: false, winchUsed: false, rescued: false }, checkpoint: 0, recoveries: 0,
        bridge: initialBridge(), bear: initialBear(now), roadblock: initialRoadblock(),
        journey: initialJourney(), result: null, createdAt: now };
      const key = this.key(scope, code);
      await this.store.set(key, JSON.stringify(room), { nx: true, expiration: new Date(now + ROOM_TTL_SECONDS * 1000) });
      if (await this.store.get(key) === JSON.stringify(room)) return room;
    }
    throw new RoomError('Could not allocate a room code', 503);
  }
  async get(scope: string, code: string, id: string): Promise<RoomState> {
    const room = await this.read(scope, code);
    if (!room.players.some(p => p.id === id)) throw new RoomError('Join this room first', 403);
    return room;
  }
  async join(scope: string, code: string, user: { id: string; name: string }): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      this.refresh(room);
      const now = this.now(); let player = room.players.find(p => p.id === user.id);
      if (!player) {
        if (room.players.length >= 2 || room.status !== 'waiting') throw new RoomError('Room is full or already running', 409);
        player = { id: user.id, name: user.name, connected: true, ready: false, lastSeen: now }; room.players.push(player);
      } else { player.connected = true; player.lastSeen = now; }
      // Rejoining completes the two-player presence check immediately, including
      // returning vehicle ownership to the seated driver when appropriate.
      this.refresh(room);
      room.revision++; await this.save(room); return room;
    });
  }
  async ready(scope: string, code: string, id: string, ready: boolean): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      this.refresh(room);
      if (room.status !== 'waiting') throw new RoomError('Match already started', 409);
      const player = room.players.find(p => p.id === id);
      if (!player) throw new RoomError('Join this room first', 403);
      player.ready = ready; player.lastSeen = this.now(); player.connected = true;
      room.revision++; await this.save(room); return room;
    });
  }
  async start(scope: string, code: string, id: string): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      this.refresh(room);
      if (room.status !== 'waiting' || room.players[0]?.id !== id || room.players.length !== 2 || !room.players.every(p => p.connected && p.ready))
        throw new RoomError('Both players must be ready; the room creator starts the match', 409);
      const now = this.now();
      room.status = 'running'; room.ownerId = room.players[0].id; room.epoch++; room.startedAt = now; room.vehicle = initialVehicle(now);
      room.seats = { driver: room.players[0].id, passenger: room.players[1].id };
      room.cable = null;
      room.mud = { entered: false, winchUsed: false, rescued: false };
      room.checkpoint = 0;
      room.recoveries = 0;
      room.bridge = initialBridge();
      room.bear = initialBear(now);
      room.roadblock = initialRoadblock();
      room.journey = initialJourney();
      room.result = null;
      room.characters = Object.fromEntries(room.players.map((p, i) => [p.id, { p: [i === 0 ? -1 : 1, 1.3, 1], yaw: 0, moving: false, seq: 0, at: now }]));
      room.revision++; await this.save(room); return room;
    });
  }
  async heartbeat(scope: string, code: string, id: string): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      const player = room.players.find(p => p.id === id);
      if (!player) throw new RoomError('Join this room first', 403);
      player.lastSeen = this.now(); player.connected = true; this.refresh(room);
      if (room.status === 'paused' && room.players.length === 2 && room.players.every(p => p.connected)) room.status = 'running';
      room.revision++; await this.save(room); return room;
    });
  }
  async leave(scope: string, code: string, id: string): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      const player = room.players.find(p => p.id === id);
      if (!player) throw new RoomError('Join this room first', 403);
      if (room.status === 'waiting') {
        room.players = room.players.filter(p => p.id !== id);
        if (room.ownerId === id) { room.ownerId = room.players[0]?.id ?? ''; room.epoch++; }
      } else { player.connected = false; player.ready = false;
        if (room.status !== 'finished') room.status = 'paused';
        if (room.ownerId === id) { room.ownerId = room.players.find(p => p.connected)?.id ?? ''; room.epoch++; } }
      if (room.cable?.holderId === id) {
        if (room.cable.stage === 'carried') room.cable = null;
        else { room.cable.length = cableLength(room.cable, this.now()); room.cable.reeling = false; room.cable.payingOut = false; room.cable.holderId = ''; room.cable.changedAt = this.now(); }
      }
      for (const plank of room.bridge.planks) {
        if (plank.stage === 'carried' && plank.holderId === id) { plank.stage = 'stock'; plank.holderId = ''; }
      }
      for (let i = 0; i < room.roadblock.grips.length; i++)
        if (room.roadblock.grips[i] === id) room.roadblock.grips[i] = null;
      room.revision++; await this.save(room); return room;
    });
  }
  async snapshot(scope: string, code: string, id: string, epoch: number, input: unknown): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      this.refresh(room);
      if (room.status !== 'running' || room.ownerId !== id || room.epoch !== epoch) throw new RoomError('Vehicle ownership changed', 409);
      if (!validSnapshot(input)) throw new RoomError('Invalid vehicle snapshot', 400);
      const previous = room.vehicle, now = this.now();
      if (previous) {
        if (input.seq <= previous.seq || now - previous.at < SNAPSHOT_MIN_MS) throw new RoomError('Snapshot is stale or too frequent', 429);
        const moved = Math.hypot(...input.p.map((v, i) => v - previous.p[i]));
        if (moved > 8 + (now - previous.at) * .045) throw new RoomError('Vehicle moved implausibly far', 400);
      }
      // Realtime's cap is shared across the installation, not per room.
      const budgetKey = `tow:rt-budget:${Math.floor(now / 1000)}`;
      const used = await this.store.incrBy(budgetKey, 1);
      if (used === 1) await this.store.expire(budgetKey, 3);
      if (used > 70) throw new RoomError('Installation snapshot budget exceeded', 429);
      room.vehicle = { ...input, at: now };
      advanceBear(room.bear, now, room.vehicle, room.characters, Object.values(room.seats).filter((seat): seat is string => !!seat));
      const routeDistance = -input.p[2];
      const onRoad = Math.abs(input.p[0] - roadX(routeDistance)) < ROAD_WIDTH / 2 + 1;
      if (routeDistance > MUD_START && routeDistance < MUD_END && mudDepth(input.p[0], input.p[2]) > .2)
        room.mud.entered = true;
      if (room.mud.entered && room.mud.winchUsed && routeDistance > MUD_END + 1 &&
        Math.abs(input.p[0] - roadX(routeDistance)) < 5) room.mud.rescued = true;
      if (room.bridge.complete && routeDistance >= BRIDGE_START && routeDistance <= BRIDGE_END &&
        Math.abs(input.p[0] - roadX(routeDistance)) < 3.5) room.bridge.entered = true;
      if (room.bridge.entered && routeDistance > BRIDGE_END + 2 &&
        Math.abs(input.p[0] - roadX(routeDistance)) < 5) room.bridge.crossed = true;
      if (onRoad && routeDistance >= RIVER.start && routeDistance <= RIVER.end) room.journey.riverEntered = true;
      if (room.journey.riverEntered && onRoad && routeDistance > RIVER.end + 3) room.journey.riverCrossed = true;
      if (onRoad && routeDistance >= HILL.start && routeDistance <= HILL.end) room.journey.hillStarted = true;
      if (room.journey.hillStarted && onRoad && routeDistance > HILL.end + 3) room.journey.hillClimbed = true;
      if (onRoad && routeDistance >= CLIFF.start && routeDistance <= CLIFF.end) room.journey.cliffStarted = true;
      if (room.journey.cliffStarted && onRoad && routeDistance > CLIFF.end + 3) room.journey.cliffCleared = true;
      const next = CHECKPOINTS[room.checkpoint];
      const prerequisites = [
        room.mud.rescued, room.bridge.crossed, room.bear.cleared,
        room.roadblock.cleared, room.journey.riverCrossed,
        room.journey.hillClimbed, room.journey.cliffCleared,
      ];
      if (next !== undefined && Math.abs(routeDistance - next) < 5 &&
        Math.abs(input.p[0] - roadX(next)) < 6 && prerequisites[room.checkpoint])
        room.checkpoint++;
      if (room.checkpoint === CHECKPOINTS.length && routeDistance >= ROUTE_LENGTH - 2 &&
        Math.abs(input.p[0] - roadX(ROUTE_LENGTH)) < 6 && input.hull > 0 && !room.result) {
        room.result = { timeMs: now - (room.startedAt ?? now), hull: input.hull, fuel: input.fuel,
          players: room.players.map(player => player.name), checkpoints: room.checkpoint };
        room.status = 'finished';
      }
      if (room.cable?.stage === 'attached' &&
        Math.hypot(...input.p.map((v, i) => v - ANCHOR_POINT[i])) > CABLE_MAX_LENGTH + 8) room.cable = null;
      room.revision++; await this.save(room); return room;
    });
  }
  async seat(scope: string, code: string, id: string, desired: 'driver' | 'passenger' | null): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      this.refresh(room);
      if (room.status !== 'running' || !room.players.some(p => p.id === id && p.connected) || !room.vehicle) throw new RoomError('Match is not active', 409);
      if (desired !== null && desired !== 'driver' && desired !== 'passenger') throw new RoomError('Invalid seat', 400);
      const occupant = desired ? room.seats[desired] : null;
      if (occupant && occupant !== id) throw new RoomError('Seat already occupied', 409);
      if (desired && Object.values(room.seats).includes(id) && room.seats[desired] !== id)
        throw new RoomError('Exit the RV before changing seats', 409);
      const speed = Math.hypot(...room.vehicle.v);
      if (speed > 3) throw new RoomError('Stop the RV before changing seats', 409);
      const character = room.characters[id];
      if (!character) throw new RoomError('Character unavailable', 409);
      if (desired && !Object.values(room.seats).includes(id) &&
        Math.hypot(...character.p.map((v, i) => v - room.vehicle!.p[i])) > 5) throw new RoomError('Move closer to the RV door', 409);
      if (room.seats.driver === id) room.seats.driver = null;
      if (room.seats.passenger === id) room.seats.passenger = null;
      for (let i = 0; i < room.roadblock.grips.length; i++)
        if (room.roadblock.grips[i] === id) room.roadblock.grips[i] = null;
      if (desired) room.seats[desired] = id;
      else character.p = [room.vehicle.p[0] + (room.players[0].id === id ? -2.5 : 2.5), room.vehicle.p[1], room.vehicle.p[2]];
      character.at = this.now(); character.seq++;
      if (room.seats.driver && room.ownerId !== room.seats.driver) { room.ownerId = room.seats.driver; room.epoch++; room.vehicle.seq = 0; room.vehicle.at = this.now(); }
      room.revision++; await this.save(room); return room;
    });
  }
  async character(scope: string, code: string, id: string, input: unknown): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      this.refresh(room);
      if (room.status !== 'running' || !room.players.some(p => p.id === id && p.connected) || Object.values(room.seats).includes(id))
        throw new RoomError('Character is not walking', 409);
      if (!input || typeof input !== 'object') throw new RoomError('Invalid character movement', 400);
      const next = input as CharacterSnapshot, previous = room.characters[id], now = this.now();
      if (!Array.isArray(next.p) || next.p.length !== 3 || next.p.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > ROUTE_LENGTH + 150) ||
        typeof next.yaw !== 'number' || !Number.isFinite(next.yaw) || Math.abs(next.yaw) > 100 ||
        typeof next.moving !== 'boolean' ||
        (next.motion !== undefined && !['Idle', 'Walk', 'Run', 'Jump', 'Carry', 'CarryWalk', 'Winch'].includes(next.motion)) ||
        !Number.isSafeInteger(next.seq) || next.seq <= (previous?.seq ?? 0)) throw new RoomError('Invalid character movement', 400);
      if (previous && now - previous.at < 160) throw new RoomError('Character update too frequent', 429);
      if (previous && Math.hypot(...next.p.map((v, i) => v - previous.p[i])) > 3 + (now - previous.at) * .009) throw new RoomError('Character moved too far', 400);
      if (room.bear.knockedUntil[id] > now && previous &&
        Math.hypot(...next.p.map((v, i) => v - previous.p[i])) > .5) throw new RoomError('Wait for help or get back up', 409);
      if (room.cable?.stage === 'carried' && room.cable.holderId === id && room.vehicle &&
        Math.hypot(...next.p.map((v, i) => v - room.vehicle!.p[i])) > CABLE_MAX_LENGTH + 3)
        throw new RoomError('Cable reached its maximum length', 409);
      const budgetKey = `tow:rt-budget:${Math.floor(now / 1000)}`;
      const used = await this.store.incrBy(budgetKey, 1);
      if (used === 1) await this.store.expire(budgetKey, 3);
      if (used > 70) throw new RoomError('Installation snapshot budget exceeded', 429);
      if (previous) dragRoadblock(room.roadblock, id, previous.p, next.p);
      room.characters[id] = { p: next.p, yaw: next.yaw, moving: next.moving, motion: next.motion, seq: next.seq, at: now };
      const grip = room.roadblock.grips.indexOf(id);
      if (grip >= 0 && Math.hypot(...next.p.map((v, i) => v - roadblockEnd(room.roadblock, grip)[i])) > 3.7)
        room.roadblock.grips[grip] = null;
      room.revision++; await this.save(room); return room;
    });
  }
  async cableAction(scope: string, code: string, id: string, action: string, end: CableEnd = 'front'): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      this.refresh(room);
      const now = this.now();
      if (room.status !== 'running' || !room.vehicle || !room.players.some(p => p.id === id && p.connected))
        throw new RoomError('Match is not active', 409);
      const character = room.characters[id];
      if (!character || Object.values(room.seats).includes(id)) throw new RoomError('Exit the RV to use the cable', 409);
      const near = (point: number[]) => Math.hypot(...character.p.map((v, i) => v - point[i]));
      const rv = room.vehicle.p;
      const anchorDistance = near(ANCHOR_POINT);
      const rvDistance = near(rv);
      const cable = room.cable;
      if (action === 'pickup') {
        if (cable || (end !== 'front' && end !== 'rear') || rvDistance > 5) throw new RoomError('Cable unavailable at this tow point', 409);
        room.cable = { stage: 'carried', holderId: id, end, length: 7, reeling: false, payingOut: false, changedAt: now };
      } else if (action === 'attach') {
        if (!cable || cable.stage !== 'carried' || cable.holderId !== id || anchorDistance > 4.5 ||
          Math.hypot(...rv.map((v, i) => v - ANCHOR_POINT[i])) > CABLE_MAX_LENGTH)
          throw new RoomError('Carry the cable to the marked anchor', 409);
        cable.stage = 'attached';
        cable.length = Math.min(CABLE_MAX_LENGTH, Math.hypot(...rv.map((v, i) => v - ANCHOR_POINT[i])) + .4);
        cable.changedAt = now;
      } else if (action === 'reel' || action === 'out' || action === 'stop') {
        if (!cable || cable.stage !== 'attached' || (cable.holderId && cable.holderId !== id))
          throw new RoomError('Attach the cable before reeling', 409);
        cable.holderId = id;
        cable.length = cableLength(cable, now);
        cable.reeling = action === 'reel';
        cable.payingOut = action === 'out';
        if (action === 'reel' && room.mud.entered && -rv[2] > MUD_START - 3 && -rv[2] < MUD_END + 2)
          room.mud.winchUsed = true;
        cable.changedAt = now;
      } else if (action === 'detach') {
        if (!cable || (rvDistance > 5 && anchorDistance > 4.5)) throw new RoomError('Walk to the cable end to detach it', 409);
        room.cable = null;
      } else throw new RoomError('Unknown cable action', 400);
      room.revision++; await this.save(room); return room;
    });
  }
  async recover(scope: string, code: string, id: string): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      this.refresh(room);
      if (room.status !== 'running' || room.ownerId !== id || room.seats.driver !== id || !room.vehicle)
        throw new RoomError('Only the current driver can recover the RV', 409);
      if (Math.hypot(...room.vehicle.v) > 5) throw new RoomError('Slow down before recovering the RV', 409);
      const d = room.checkpoint ? CHECKPOINTS[room.checkpoint - 1] : 0;
      const yaw = -Math.atan2(roadX(d + 2) - roadX(d), 2);
      const now = this.now();
      room.vehicle = { ...room.vehicle,
        p: [roadX(d), roadY(d) + 1.38, -d + 2],
        q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
        v: [0, 0, 0], a: [0, 0, 0], hull: Math.max(1, room.vehicle.hull - 10), seq: 0, at: now };
      room.epoch++;
      room.recoveries++;
      room.cable = null;
      if (!room.checkpoint) room.mud = { entered: false, winchUsed: false, rescued: false };
      for (const player of room.players) {
        if (Object.values(room.seats).includes(player.id)) continue;
        const character = room.characters[player.id];
        if (character) { character.p = [roadX(d) + 3, roadY(d) + 1.3, -d + 2]; character.seq++; character.at = now; }
      }
      room.revision++; await this.save(room); return room;
    });
  }
  async bridgeAction(scope: string, code: string, id: string, action: string): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      this.refresh(room);
      if (room.status !== 'running' || !room.players.some(player => player.id === id && player.connected) ||
        Object.values(room.seats).includes(id) || !room.characters[id])
        throw new RoomError('Exit the RV to build the bridge', 409);
      if (room.cable?.stage === 'carried' && room.cable.holderId === id)
        throw new RoomError('Drop the cable before carrying a plank', 409);
      const character = room.characters[id];
      const near = (point: readonly number[]) => Math.hypot(...character.p.map((value, index) => value - point[index])) < 4.5;
      const held = room.bridge.planks.findIndex(plank => plank.stage === 'carried' && plank.holderId === id);
      if (action === 'pickup') {
        if (held >= 0) throw new RoomError('Put down your plank first', 409);
        let index = room.bridge.planks.findIndex(plank => plank.stage === 'thrown' && plank.p && near(plank.p));
        if (index < 0 && near(BRIDGE_STOCK_POINT)) index = room.bridge.planks.findIndex(plank => plank.stage === 'stock');
        if (index < 0) throw new RoomError('Walk to a loose plank or the plank pile', 409);
        room.bridge.planks[index] = { stage: 'carried', holderId: id };
      } else if (action === 'place') {
        if (held < 0 || !near(bridgeWorkPoint(held))) throw new RoomError('Carry the plank to its marked bridge slot', 409);
        room.bridge.planks[held] = { stage: 'placed', holderId: '' };
      } else if (action === 'secure') {
        const index = room.bridge.planks.findIndex((plank, i) => plank.stage === 'placed' && near(bridgeWorkPoint(i)));
        if (index < 0) throw new RoomError('Stand beside a placed plank to secure it', 409);
        room.bridge.planks[index] = { stage: 'secured', holderId: '' };
      } else if (action === 'retrieve') {
        if (held >= 0) throw new RoomError('Put down the plank you are carrying first', 409);
        const index = room.bridge.planks.findIndex((plank, i) => plank.stage === 'placed' && near(bridgeWorkPoint(i)));
        if (index < 0) throw new RoomError('No loose plank is within reach', 409);
        room.bridge.planks[index] = { stage: 'carried', holderId: id };
      } else if (action === 'drop') {
        if (held < 0) throw new RoomError('No plank is being carried', 409);
        room.bridge.planks[held] = { stage: 'stock', holderId: '' };
      } else if (action === 'throw') {
        if (held < 0) throw new RoomError('Pick up a plank before throwing it', 409);
        room.bridge.planks[held] = { stage: 'thrown', holderId: '', p: plankLanding(character.p, character.yaw), from: [...character.p], thrownAt: this.now() };
      } else throw new RoomError('Unknown bridge action', 400);
      room.bridge.complete = room.bridge.planks.every(plank => plank.stage === 'secured');
      room.revision++; await this.save(room); return room;
    });
  }
  async helpPlayer(scope: string, code: string, id: string, targetId: string): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      this.refresh(room);
      const now = this.now();
      const helper = room.characters[id], target = room.characters[targetId];
      if (room.status !== 'running' || id === targetId || !room.players.some(p => p.id === id && p.connected) ||
        !room.players.some(p => p.id === targetId && p.connected) ||
        Object.values(room.seats).includes(id) || Object.values(room.seats).includes(targetId) ||
        !helper || !target || room.bear.knockedUntil[targetId] <= now ||
        Math.hypot(...helper.p.map((v, i) => v - target.p[i])) > 2.8)
        throw new RoomError('Move beside a knocked-down teammate to help', 409);
      room.bear.knockedUntil[targetId] = now;
      room.revision++; await this.save(room); return room;
    });
  }
  async roadblockAction(scope: string, code: string, id: string, action: 'grab' | 'release'): Promise<RoomState> {
    return this.lock(scope, code, async room => {
      this.refresh(room);
      const character = room.characters[id];
      if (room.status !== 'running' || !room.players.some(p => p.id === id && p.connected) ||
        Object.values(room.seats).includes(id) || !character)
        throw new RoomError('Exit the RV to move the fallen tree', 409);
      if (action === 'release') {
        const index = room.roadblock.grips.indexOf(id);
        if (index < 0) throw new RoomError('You are not holding the log', 409);
        room.roadblock.grips[index] = null;
      } else if (action === 'grab') {
        if (room.roadblock.cleared || room.roadblock.grips.includes(id) ||
          room.cable?.holderId === id && room.cable.stage === 'carried' ||
          room.bridge.planks.some(plank => plank.stage === 'carried' && plank.holderId === id))
          throw new RoomError('Hands must be free to move the log', 409);
        const index = room.roadblock.grips.findIndex((holder, i) => !holder &&
          Math.hypot(...character.p.map((v, j) => v - roadblockEnd(room.roadblock, i)[j])) < 3);
        if (index < 0) throw new RoomError('Stand by a free end of the fallen tree', 409);
        room.roadblock.grips[index] = id;
      } else throw new RoomError('Unknown log action', 400);
      room.revision++; await this.save(room); return room;
    });
  }
}
