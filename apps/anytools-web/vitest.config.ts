import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  // Component tests import .tsx — use the automatic JSX runtime (no React global).
  esbuild: { jsx: 'automatic' },
  test: {
    // scripts/**/*.test.mjs: the release-gate route enumerator (scripts/lib/
    // route-inventory.mjs) is a plain-JS module invoked by `node` directly (no TS
    // runtime, no build step) — its test can't live under src/**/*.test.ts because
    // tsconfig.json sets `allowJs: false`, so a .ts test importing a .mjs module
    // would fail `pnpm typecheck`. Kept as a separate glob instead of relaxing
    // allowJs project-wide.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
