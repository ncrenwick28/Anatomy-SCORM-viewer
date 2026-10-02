import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { copyDracoDecoder, dracoUrlFix } from './build/vitePlugins';

// Authoring application. The student player is built separately (vite.player.config.ts)
// into public/player so that the exporter can fetch it from the same origin.
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  plugins: [react(), dracoUrlFix(), copyDracoDecoder()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  preview: { host: '127.0.0.1', port: 4173 },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 30000,
  },
});
