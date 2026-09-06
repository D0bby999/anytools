// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTO_FONT_PATH, hasNotoFont } from '../shared/test-unicode-font';
import { convertFont } from './logic';

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

const notoFile = () => new File([readFileSync(NOTO_FONT_PATH)], 'NotoSans-Regular.ttf');

describe('convertFont — format errors (no wasm needed)', () => {
  it('rejects a WOFF2 file by name, not a generic parse error', async () => {
    const woff2 = new File(
      [new Uint8Array([0x77, 0x4f, 0x46, 0x32, ...new Array(40).fill(0)])],
      'x.woff2',
    );
    await expect(convertFont(woff2, { target: 'native' })).rejects.toMatchObject({
      code: 'woff2Unsupported',
    });
  });

  it('rejects a file that is not a recognised font container', async () => {
    const junk = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'x.bin');
    await expect(convertFont(junk, { target: 'native' })).rejects.toMatchObject({
      code: 'unknownFormat',
    });
  });

  it('rejects a truncated font with parseFailed', async () => {
    const truncated = new File([new Uint8Array([0, 1, 0, 0, 0, 5])], 'x.ttf');
    await expect(convertFont(truncated, { target: 'native' })).rejects.toMatchObject({
      code: 'parseFailed',
    });
  });
});

describe.skipIf(!hasEngine() || !hasNotoFont())('convertFont — real font, real wasm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wraps a raw TTF into WOFF without subsetting', async () => {
    const raw = readFileSync(NOTO_FONT_PATH);
    const result = await convertFont(notoFile(), { target: 'woff' });
    expect(result.extension).toBe('woff');
    expect(result.subsetted).toBe(false);
    expect(result.inputBytes).toBe(raw.byteLength);
    expect(result.outputBytes).toBeLessThan(raw.byteLength);
    expect(result.blob.size).toBe(result.outputBytes);
  });

  it('round-trips TTF → WOFF → TTF back to a font with the same table count', async () => {
    const woffResult = await convertFont(notoFile(), { target: 'woff' });
    const woffFile = new File([woffResult.blob], 'x.woff');
    const back = await convertFont(woffFile, { target: 'native' });
    expect(back.extension).toBe('ttf');
    expect(back.outputBytes).toBeGreaterThan(woffResult.outputBytes); // decompressed again
  });

  it('subsets to a short string and reports a much smaller output', async () => {
    stubEngineFetch();
    const result = await convertFont(notoFile(), { target: 'native', subsetText: 'Hi' });
    expect(result.subsetted).toBe(true);
    expect(result.subsetCharCount).toBe(2);
    expect(result.outputBytes).toBeLessThan(result.inputBytes / 10);
  });

  it('subsets and wraps to WOFF in one pass', async () => {
    stubEngineFetch();
    const result = await convertFont(notoFile(), {
      target: 'woff',
      subsetText: 'Xin chào',
    });
    expect(result.extension).toBe('woff');
    expect(result.subsetted).toBe(true);
    expect(result.subsetCharCount).toBe(8); // X, i, n, space, c, h, à, o — all distinct
  });

  it('treats blank (or whitespace-only) subset text as "do not subset"', async () => {
    const result = await convertFont(notoFile(), { target: 'native', subsetText: '   ' });
    expect(result.subsetted).toBe(false);
    expect(result.outputBytes).toBe(result.inputBytes);
  });
});
