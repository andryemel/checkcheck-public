import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'client/src') } },
  server: { port: 5199, proxy: { '/api': 'http://localhost:8787' } },
  // Built into ./public: Vercel serves that directory from its CDN (express.static is ignored there),
  // and the local server serves the same folder.
  build: { outDir: '../public', emptyOutDir: true },
});
