import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { RoomError, RoomService } from './room-service';
import { roomChannel } from '../../shared/room';
import type { RoomEvent, RoomState } from '../../shared/room';

export interface RequestIdentity { scope: string; id: string; name: string }
export function roomRoutes(service: RoomService, identify: (request: Context) => RequestIdentity | null, publish: (channel: string, event: RoomEvent) => Promise<void>) {
  const routes = new Hono();
  routes.onError((error, c) => c.json({ error: error instanceof RoomError ? error.message : 'Room service unavailable' }, (error instanceof RoomError ? error.status : 500) as ContentfulStatusCode));
  const user = (c: Context) => { const identity = identify(c); if (!identity) throw new RoomError('Sign in to Reddit to play together', 401); return identity; };
  const notify = async (room: RoomState) => { await publish(roomChannel(room.scope, room.code), { type: 'room', room }); };
  routes.post('/api/rooms', async c => {
    const identity = user(c); const room = await service.create(identity.scope, identity);
    return c.json({ room, me: identity.id });
  });
  routes.post('/api/rooms/:code/join', async c => {
    const identity = user(c); const room = await service.join(identity.scope, c.req.param('code').toUpperCase(), identity);
    await notify(room); return c.json({ room, me: identity.id });
  });
  routes.get('/api/rooms/:code', async c => {
    const identity = user(c); const room = await service.get(identity.scope, c.req.param('code').toUpperCase(), identity.id);
    return c.json({ room, me: identity.id });
  });
  routes.post('/api/rooms/:code/ready', async c => {
    const identity = user(c); const data = await c.req.json().catch(() => ({}));
    if (typeof data.ready !== 'boolean') throw new RoomError('Expected ready boolean', 400);
    const room = await service.ready(identity.scope, c.req.param('code').toUpperCase(), identity.id, data.ready);
    await notify(room); return c.json({ room, me: identity.id });
  });
  routes.post('/api/rooms/:code/start', async c => {
    const identity = user(c); const room = await service.start(identity.scope, c.req.param('code').toUpperCase(), identity.id);
    await notify(room); return c.json({ room, me: identity.id });
  });
  routes.post('/api/rooms/:code/heartbeat', async c => {
    const identity = user(c); const room = await service.heartbeat(identity.scope, c.req.param('code').toUpperCase(), identity.id);
    await notify(room); return c.json({ room, me: identity.id });
  });
  routes.post('/api/rooms/:code/leave', async c => {
    const identity = user(c); const room = await service.leave(identity.scope, c.req.param('code').toUpperCase(), identity.id);
    await notify(room); return c.json({ room, me: identity.id });
  });
  routes.post('/api/rooms/:code/snapshot', async c => {
    const identity = user(c); const data = await c.req.json().catch(() => ({}));
    const room = await service.snapshot(identity.scope, c.req.param('code').toUpperCase(), identity.id, data.epoch, data.vehicle);
    // A snapshot can sever an overextended cable. Include that state in the same
    // message so the other client does not keep rendering or pulling a stale rope.
    await publish(roomChannel(room.scope, room.code), { type: 'vehicle', code: room.code, epoch: room.epoch, vehicle: room.vehicle!, cable: room.cable, mud: room.mud, checkpoint: room.checkpoint, bridge: room.bridge, bear: room.bear, roadblock: room.roadblock });
    if (room.status === 'finished') await notify(room);
    return c.json({ epoch: room.epoch, seq: room.vehicle!.seq });
  });
  routes.post('/api/rooms/:code/seat', async c => {
    const identity = user(c); const data = await c.req.json().catch(() => ({}));
    const room = await service.seat(identity.scope, c.req.param('code').toUpperCase(), identity.id, data.seat);
    await notify(room); return c.json({ room, me: identity.id });
  });
  routes.post('/api/rooms/:code/character', async c => {
    const identity = user(c); const data = await c.req.json().catch(() => ({}));
    const room = await service.character(identity.scope, c.req.param('code').toUpperCase(), identity.id, data.character);
    await publish(roomChannel(room.scope, room.code), { type: 'character', code: room.code, playerId: identity.id, character: room.characters[identity.id], roadblock: room.roadblock });
    return c.json({ seq: room.characters[identity.id].seq });
  });
  routes.post('/api/rooms/:code/cable', async c => {
    const identity = user(c); const data = await c.req.json().catch(() => ({}));
    const room = await service.cableAction(identity.scope, c.req.param('code').toUpperCase(), identity.id, data.action, data.end);
    await notify(room); return c.json({ room, me: identity.id });
  });
  routes.post('/api/rooms/:code/recover', async c => {
    const identity = user(c);
    const room = await service.recover(identity.scope, c.req.param('code').toUpperCase(), identity.id);
    await notify(room); return c.json({ room, me: identity.id });
  });
  routes.post('/api/rooms/:code/bridge', async c => {
    const identity = user(c); const data = await c.req.json().catch(() => ({}));
    const room = await service.bridgeAction(identity.scope, c.req.param('code').toUpperCase(), identity.id, data.action);
    await notify(room); return c.json({ room, me: identity.id });
  });
  routes.post('/api/rooms/:code/help', async c => {
    const identity = user(c); const data = await c.req.json().catch(() => ({}));
    if (typeof data.targetId !== 'string') throw new RoomError('Expected teammate ID', 400);
    const room = await service.helpPlayer(identity.scope, c.req.param('code').toUpperCase(), identity.id, data.targetId);
    await notify(room); return c.json({ room, me: identity.id });
  });
  routes.post('/api/rooms/:code/roadblock', async c => {
    const identity = user(c); const data = await c.req.json().catch(() => ({}));
    if (data.action !== 'grab' && data.action !== 'release') throw new RoomError('Unknown log action', 400);
    const room = await service.roadblockAction(identity.scope, c.req.param('code').toUpperCase(), identity.id, data.action);
    await notify(room); return c.json({ room, me: identity.id });
  });
  return routes;
}
