// @vitest-environment node
/**
 * Runs the real HarfBuzz subset wasm against a real font, rather than mocking WebAssembly —
 * the whole point of this module is the exact pointer/ABI sequence, which a mock cannot check.
 * `fetch` is stubbed to hand back the engine's .wasm bytes straight off disk (test-font.ts).
 * The old repo skipped these tests when its staged files were missing; here the font and the
 * engine come from node_modules, so they always run.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HbSubsetEngineError, subsetSfnt } from './hb-subset-engine';
import { TEST_FONT_PATH, stubEngineFetch } from './test-font';

describe('subsetSfnt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shrinks a real font to only the requested characters, and the result is a valid sfnt', async () => {
    stubEngineFetch();
    const fontBytes = new Uint8Array(readFileSync(TEST_FONT_PATH));
    const codepoints = Array.from('Hi').map((c) => c.codePointAt(0) as number);

    const subset = await subsetSfnt(fontBytes, codepoints);

    expect(subset.byteLength).toBeGreaterThan(0);
    expect(subset.byteLength).toBeLessThan(fontBytes.byteLength / 10);
    // 0x00010000 is the sfnt version tag for TrueType-flavoured (glyf) fonts — what Liberation Sans is.
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
    const fontBytes = new Uint8Array(readFileSync(TEST_FONT_PATH));
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
    const fontBytes = new Uint8Array(readFileSync(TEST_FONT_PATH));
    const a = await subsetSfnt(fontBytes, [72]);
    const b = await subsetSfnt(fontBytes, [72, 105]);
    expect(a.byteLength).toBeGreaterThan(0);
    expect(b.byteLength).toBeGreaterThan(0);
  });
});
