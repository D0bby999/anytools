/**
 * The real font and the real engine the font-converter tests run against.
 *
 * The old repo read both from files its dev server staged under public/third-party, and skipped
 * the tests when they were missing. Here both come from node_modules, so the tests always run:
 *  - Liberation Sans (pdfjs-dist's standard fonts) stands in for Noto Sans: TrueType-flavoured
 *    too, with Latin and Vietnamese;
 *  - the engine is harfbuzzjs's own wasm, the file hb-subset-engine.ts imports with `?url`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';

export const TEST_FONT_PATH = resolve(
  process.cwd(),
  'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf',
);

export const HARFBUZZ_WASM_PATH = resolve(process.cwd(), 'node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm');

/** Answer the engine's fetch with the wasm on disk; any other URL fails the test. */
export function stubEngineFetch(): void {
  const wasmBytes = readFileSync(HARFBUZZ_WASM_PATH);
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (!href.endsWith('harfbuzz-subset.wasm')) {
      throw new Error(`unexpected fetch in test: ${href}`);
    }
    return new Response(wasmBytes, { status: 200 });
  });
}
