/** Local-only Devvit API harness: same Hono routes and real Redis, test identity headers. */
import { createClient } from 'redis';
import { serve } from '@hono/node-server';
import { roomRoutes } from './rooms/routes';
import { RoomService } from './rooms/room-service';
import type { RoomState } from '../shared/room';

const client = createClient({ url: process.env.TOW_REDIS_URL || 'redis://127.0.0.1:6398' });
client.on('error', error => console.error('Local Redis:', error));
await client.connect();
const store = {
  get: (key: string) => client.get(key),
  set: (key: string, value: string, options?: { nx?: boolean; expiration?: Date }) => client.set(key, value, {
    ...(options?.nx ? { NX: true as const } : {}),
    ...(options?.expiration ? { PX: Math.max(1000, options.expiration.getTime() - Date.now()) } : {}),
  }),
  del: (key: string) => client.del(key),
  incrBy: (key: string, amount: number) => client.incrBy(key, amount),
  expire: (key: string, seconds: number) => client.expire(key, seconds),
};
const service = new RoomService(store);
const routes = roomRoutes(service, c => {
  const id = c.req.header('x-local-player');
  return id && /^local-[a-z0-9-]{6,40}$/.test(id) ? { scope: 'local-post', id, name: id.slice(6, 24) } : null;
}, async () => { /* Browser preview polls Redis-backed room state; Devvit uses Realtime. */ });
// Shorten browser physics scenarios without changing production APIs. This file is never bundled for Devvit.
routes.post('/__test/place', async c => {
  const id = c.req.header('x-local-player');
  const data = await c.req.json<{ code: string; kind: 'vehicle' | 'character'; p: [number, number, number] }>();
  if (!id || !/^[A-HJ-NP-Z2-9]{6}$/.test(data.code) || !Array.isArray(data.p) ||
    data.p.length !== 3 || data.p.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 300))
    return c.json({ error: 'Invalid local fixture' }, 400);
  const key = `tow:room:local-post:${data.code}`;
  const raw = await client.get(key);
  if (!raw) return c.json({ error: 'Missing room' }, 404);
  const room = JSON.parse(raw) as RoomState;
  if (!room.players.some(p => p.id === id)) return c.json({ error: 'Not a room member' }, 403);
  if (data.kind === 'vehicle' && room.ownerId === id && room.vehicle) {
    room.vehicle.p = data.p; room.vehicle.v = [0, 0, 0]; room.vehicle.a = [0, 0, 0];
    room.vehicle.seq++; room.vehicle.at = Date.now();
  } else if (data.kind === 'character' && room.characters[id] && !Object.values(room.seats).includes(id)) {
    room.characters[id].p = data.p; room.characters[id].seq++; room.characters[id].at = Date.now();
  } else return c.json({ error: 'Fixture state unavailable' }, 409);
  room.revision++;
  await client.set(key, JSON.stringify(room), { KEEPTTL: true });
  return c.json({ room });
});
serve({ fetch: routes.fetch, port: 5199, hostname: '127.0.0.1' });
console.log('Wrong Turn Together local room API at http://127.0.0.1:5199');
