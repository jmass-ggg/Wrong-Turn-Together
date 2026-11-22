import { defineConfig } from 'vite';
import { devvit } from '@devvit/start/vite';
export default defineConfig({
  plugins: [devvit({
    client: { build: { sourcemap: false } },
    server: { build: { sourcemap: false } },
  })],
});
