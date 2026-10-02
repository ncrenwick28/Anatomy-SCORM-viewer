import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { copyDracoDecoder, dracoUrlFix } from './build/vitePlugins.ts';
import { resolve } from 'node:path';

// Builds the student player as a single classic (non-module) script plus one stylesheet.
// A classic script keeps the launch page loadable even when opened from file:// and
// means the package has no runtime dependency on any CDN or module loader.
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [
    react(),
    dracoUrlFix(),
    copyDracoDecoder(),
  ],
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version) },
  build: {
    outDir: 'public/player',
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2500,
    lib: {
      entry: resolve('src/player/main.tsx'),
      name: 'AnatomyPlayer',
      formats: ['iife'],
      fileName: () => 'player.js',
      cssFileName: 'player',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
