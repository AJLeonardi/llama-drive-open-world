/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

/** Build number shown on the title screen: the total number of commits. */
function buildNumber() {
  try {
    return execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  // Relative base so the build works from any GitHub Pages sub-path.
  base: './',
  define: { __BUILD_NUMBER__: JSON.stringify(buildNumber()) },
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
