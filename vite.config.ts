/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any GitHub Pages sub-path.
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
  },
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
