import { defineConfig } from 'vite';

// Standalone browser preview. Devvit's Vite plugin deliberately supports builds only.
export default defineConfig({
  root: 'src/client',
  server: { host: '0.0.0.0', proxy: { '/api': 'http://127.0.0.1:5199', '/__test': 'http://127.0.0.1:5199' } },
});
