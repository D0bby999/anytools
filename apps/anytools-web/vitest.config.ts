import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  // Component tests import .tsx — use the automatic JSX runtime (no React global).
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
