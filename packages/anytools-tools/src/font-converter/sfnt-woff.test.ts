// @vitest-environment node
// CompressionStream/DecompressionStream are real Web Streams globals in Node 22, not something
// happy-dom implements — the whole point of these tests is exercising the real zlib codec.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOTO_FONT_PATH, hasNotoFont } from '../shared/test-unicode-font';
import {
  type Sfnt,
  SfntFormatError,
  buildSfnt,
  detectFontFlavor,
  extensionForFlavor,
  parseSfnt,
  unwrapWoff,
  wrapWoff,
} from './sfnt-woff';

const tag = (s: string) =>
  (s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3);

/** A tiny but structurally real sfnt: three tables of different, non-multiple-of-4 lengths. */
function sampleSfnt(flavor = 0x00010000): Sfnt {
  return {
    flavor,
    tables: [
      { tag: tag('head'), checksum: 0x11111111, data: new Uint8Array([1, 2, 3, 4, 5]) },
      {
        tag: tag('cmap'),
        checksum: 0x22222222,
        data: new Uint8Array(Array.from({ length: 40 }, (_, i) => i)),
      },
      { tag: tag('name'), checksum: 0x33333333, data: new Uint8Array([9, 9]) },
    ],
  };
}

describe('detectFontFlavor', () => {
  it('recognises every container by its magic bytes', () => {
    expect(detectFontFlavor(new Uint8Array([0x00, 0x01, 0x00, 0x00]))).toBe('ttf');
    expect(detectFontFlavor(new Uint8Array([0x74, 0x72, 0x75, 0x65]))).toBe('ttf'); // 'true'
    expect(detectFontFlavor(new Uint8Array([0x4f, 0x54, 0x54, 0x4f]))).toBe('otf'); // 'OTTO'
    expect(detectFontFlavor(new Uint8Array([0x77, 0x4f, 0x46, 0x46]))).toBe('woff'); // 'wOFF'
    expect(detectFontFlavor(new Uint8Array([0x77, 0x4f, 0x46, 0x32]))).toBe('woff2'); // 'wOF2'
    expect(detectFontFlavor(new Uint8Array([0, 0, 0, 0]))).toBe('unknown');
    expect(detectFontFlavor(new Uint8Array([1, 2]))).toBe('unknown');
  });
});

describe('extensionForFlavor', () => {
  it('labels CFF-flavored fonts .otf and everything else .ttf', () => {
    expect(extensionForFlavor(0x4f54544f)).toBe('otf');
    expect(extensionForFlavor(0x00010000)).toBe('ttf');
    expect(extensionForFlavor(0x74727565)).toBe('ttf');
  });
});

describe('buildSfnt / parseSfnt', () => {
  it('round-trips tags, checksums and table bytes exactly', () => {
    const original = sampleSfnt();
    const bytes = buildSfnt(original);
    const parsed = parseSfnt(bytes);

    expect(parsed.flavor).toBe(original.flavor);
    expect(parsed.tables).toHaveLength(3);
    parsed.tables.forEach((t, i) => {
      const expected = original.tables[i] as (typeof original.tables)[number];
      expect(t.tag).toBe(expected.tag);
      expect(t.checksum).toBe(expected.checksum);
      expect(Array.from(t.data)).toEqual(Array.from(expected.data));
    });
  });

  it('pads every table to a 4-byte boundary in the written file', () => {
    const bytes = buildSfnt(sampleSfnt());
    // header(12) + 3*16 directory entries = 60; first table (5 bytes) starts there.
    expect(bytes.byteLength).toBe(
      12 + 3 * 16 + 8 /* 5→8 */ + 40 /* already 4-aligned */ + 4 /* 2→4 */,
    );
  });

  it('rejects a font with no tables', () => {
    expect(() => buildSfnt({ flavor: 0x00010000, tables: [] })).toThrow(SfntFormatError);
  });

  it('rejects bytes with an unrecognised sfnt version', () => {
    expect(() => parseSfnt(new Uint8Array([0, 0, 0, 0, 0, 0]))).toThrow(SfntFormatError);
  });

  it('rejects a truncated table directory', () => {
    const bytes = buildSfnt(sampleSfnt()).slice(0, 20);
    expect(() => parseSfnt(bytes)).toThrow(SfntFormatError);
  });
});

describe('wrapWoff / unwrapWoff', () => {
  it('round-trips a CFF-flavored sfnt through WOFF with every table intact', async () => {
    const original = sampleSfnt(0x4f54544f);
    const woff = await wrapWoff(original);
    expect(detectFontFlavor(woff)).toBe('woff');

    const unwrapped = await unwrapWoff(woff);
    expect(unwrapped.flavor).toBe(original.flavor);
    unwrapped.tables.forEach((t, i) => {
      const expected = original.tables[i] as (typeof original.tables)[number];
      expect(t.tag).toBe(expected.tag);
      expect(t.checksum).toBe(expected.checksum);
      expect(Array.from(t.data)).toEqual(Array.from(expected.data));
    });
  });

  it('stores a table uncompressed when deflating it would not shrink it', async () => {
    // Random-looking bytes deflate poorly; a run of identical bytes compresses well. Mixing
    // both in one font exercises the "keep raw if compression does not help" branch for real.
    const incompressible = new Uint8Array(64);
    crypto.getRandomValues(incompressible);
    const compressible = new Uint8Array(2000).fill(7);
    const sfnt: Sfnt = {
      flavor: 0x00010000,
      tables: [
        { tag: tag('rand'), checksum: 1, data: incompressible },
        { tag: tag('flat'), checksum: 2, data: compressible },
      ],
    };
    const woff = await wrapWoff(sfnt);
    const back = await unwrapWoff(woff);
    expect(Array.from(back.tables[0]?.data ?? [])).toEqual(Array.from(incompressible));
    expect(Array.from(back.tables[1]?.data ?? [])).toEqual(Array.from(compressible));
  });

  it('rebuilds a valid raw sfnt after a WOFF round trip', async () => {
    const original = sampleSfnt();
    const woff = await wrapWoff(original);
    const unwrapped = await unwrapWoff(woff);
    const rebuilt = buildSfnt(unwrapped);
    expect(detectFontFlavor(rebuilt)).toBe('ttf');
    expect(parseSfnt(rebuilt).tables).toHaveLength(3);
  });

  it('rejects a non-WOFF file, naming WOFF2 specifically when that is what it sees', async () => {
    await expect(unwrapWoff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toBeInstanceOf(
      SfntFormatError,
    );
    await expect(
      unwrapWoff(
        new Uint8Array([
          0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]),
      ),
    ).rejects.toThrow(/WOFF2/);
  });
});

describe.skipIf(!hasNotoFont())('with a real installed font (NotoSans-Regular.ttf)', () => {
  it('parses, wraps to WOFF, unwraps and rebuilds byte-identical tables', async () => {
    const raw = new Uint8Array(readFileSync(NOTO_FONT_PATH));
    const original = parseSfnt(raw);
    expect(original.tables.length).toBeGreaterThan(5); // a real font has GSUB/GPOS/cmap/glyf/…

    const woff = await wrapWoff(original);
    expect(detectFontFlavor(woff)).toBe('woff');
    expect(woff.byteLength).toBeLessThan(raw.byteLength); // deflate wins on real glyph outlines

    const unwrapped = await unwrapWoff(woff);
    expect(unwrapped.tables).toHaveLength(original.tables.length);
    unwrapped.tables.forEach((t, i) => {
      const expected = original.tables[i] as (typeof original.tables)[number];
      expect(t.tag).toBe(expected.tag);
      expect(Array.from(t.data)).toEqual(Array.from(expected.data));
    });

    expect(parseSfnt(buildSfnt(unwrapped)).tables).toHaveLength(original.tables.length);
  });
});
