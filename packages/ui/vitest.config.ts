import { defineConfig } from 'vitest/config';

/**
 * Component tests for the design-system primitives.
 *
 * This package had no test script at all until now, which meant `pnpm test` could not go red
 * for any UI defect anywhere in the repo — the tool packages only ever ran pure-function
 * `logic.test.ts`. Mirrors `packages/anytools-tools/vitest.config.ts` (same runner, same
 * happy-dom environment) so there is one testing story, not two.
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
