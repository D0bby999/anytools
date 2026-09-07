/// <reference types="@testing-library/jest-dom" />

// jest-dom augments vitest's `Assertion` at runtime via the `/vitest` entry imported in
// vitest.setup.ts, but TypeScript needs the reference to see `toBeChecked`, `toHaveValue`
// and friends. Without this, `pnpm typecheck` fails on every component test while the tests
// themselves pass — a split that would quietly discourage writing more of them.
export {};
