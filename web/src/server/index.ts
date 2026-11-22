import { Hono } from 'hono';
import { context, reddit, redis, realtime } from '@devvit/web/server';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import { RoomService } from './rooms/room-service';
import { roomRoutes } from './rooms/routes';

const app = new Hono();
const rooms = new RoomService(redis);
app.route('/', roomRoutes(
  rooms,
  () => context.userId && context.postId ? { scope: context.postId, id: context.userId, name: (context.username ?? context.userId).slice(0, 24) } : null,
  (channel, event) => realtime.send(channel, JSON.parse(JSON.stringify(event))),
));

app.post('/internal/menu/create-post', async c => {
  await c.req.json<MenuItemRequest>();
  if (!context.subredditName) return c.json<UiResponse>({ showToast: 'Open this menu in a subreddit to create a road trip.' });
  const post = await reddit.submitCustomPost({ subredditName: context.subredditName, title: 'Wrong Turn Together: Mountain Run', entry: 'default' });
  return c.json<UiResponse>({ showToast: `Road trip post created: ${post.id}` });
});
export default app;
