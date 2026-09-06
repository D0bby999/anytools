// @vitest-environment node
/**
 * Runs the real HarfBuzz subset wasm against a real font, rather than mocking WebAssembly —
 * the whole point of this module is the exact pointer/ABI sequence, which a mock cannot check.
 * `fetch` is stubbed to hand back the vendored .wasm bytes straight off disk (same trick as
 * shared/test-unicode-font.ts uses for the Noto font); both are build outputs under
 * apps/anytools-web/public/, gitignored, so a checkout that has never run
 * `pnpm --filter @anytools/web vendor:assets` skips these tests instead of failing on a missing
 * file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTO_FONT_PATH, hasNotoFont } from '../shared/test-unicode-font';
import { HbSubsetEngineError, subsetSfnt } from './hb-subset-engine';

const HARFBUZZ_WASM_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/anytools-web/public/third-party/harfbuzz/harfbuzz-subset.wasm',
);
const hasEngine = () => existsSync(HARFBUZZ_WASM_PATH);

function stubEngineFetch(): void {
  const wasmBytes = readFileSync(HARFBUZZ_WASM_PATH);
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (!href.endsWith('/third-party/harfbuzz/harfbuzz-subset.wasm')) {
      throw new Error(`unexpected fetch in test: ${href}`);
    }
    return new Response(wasmBytes, { status: 200 });
  });
}

describe.skipIf(!hasEngine() || !hasNotoFont())('subsetSfnt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shrinks a real font to only the requested characters, and the result is a valid sfnt', async () => {
    stubEngineFetch();
    const fontBytes = new Uint8Array(readFileSync(NOTO_FONT_PATH));
    const codepoints = Array.from('Hi').map((c) => c.codePointAt(0) as number);

    const subset = await subsetSfnt(fontBytes, codepoints);

    expect(subset.byteLength).toBeGreaterThan(0);
    expect(subset.byteLength).toBeLessThan(fontBytes.byteLength / 10);
    // 0x00010000 is the sfnt version tag for TrueType-flavoured (glyf) fonts — what Noto Sans is.
    expect(Array.from(subset.slice(0, 4))).toEqual([0, 1, 0, 0]);
    // A well-formed table directory: numTables at bytes 4-5, each entry's offset+length in
    // bounds. Catches a subset that is merely non-empty but garbled.
    const numTables = (subset[4] as number) * 256 + (subset[5] as number);
    expect(numTables).toBeGreaterThan(0);
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      const readU32 = (o: number) =>
        (subset[o] as number) * 2 ** 24 +
        (subset[o + 1] as number) * 2 ** 16 +
        (subset[o + 2] as number) * 2 ** 8 +
        (subset[o + 3] as number);
      const offset = readU32(rec + 8);
      const length = readU32(rec + 12);
      expect(offset + length).toBeLessThanOrEqual(subset.byteLength);
    }
  });

  it('rejects an empty character set instead of returning an unusable font', async () => {
    stubEngineFetch();
    const fontBytes = new Uint8Array(readFileSync(NOTO_FONT_PATH));
    await expect(subsetSfnt(fontBytes, [])).rejects.toBeInstanceOf(HbSubsetEngineError);
  });

  it('rejects bytes that are not a font HarfBuzz can parse', async () => {
    stubEngineFetch();
    await expect(subsetSfnt(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), [72])).rejects.toBeInstanceOf(
      HbSubsetEngineError,
    );
  });

  it('reuses one wasm instance across calls', async () => {
    stubEngineFetch();
    const fontBytes = new Uint8Array(readFileSync(NOTO_FONT_PATH));
    const a = await subsetSfnt(fontBytes, [72]);
    const b = await subsetSfnt(fontBytes, [72, 105]);
    expect(a.byteLength).toBeGreaterThan(0);
    expect(b.byteLength).toBeGreaterThan(0);
  });
});
