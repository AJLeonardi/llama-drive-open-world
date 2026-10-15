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

const BUILD = buildNumber();

export default defineConfig({
  plugins: [
    {
      // version.json lets an installed copy notice a newer deploy and update itself.
      name: 'version-file',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) });
      },
    },
  ],
  // Relative base so the build works from any GitHub Pages sub-path.
  base: './',
  define: { __BUILD_NUMBER__: JSON.stringify(BUILD) },
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
