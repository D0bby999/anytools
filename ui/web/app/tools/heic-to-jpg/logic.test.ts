// @vitest-environment node
/**
 * Runs in node rather than happy-dom because the interesting half of this file is the real
 * libheif WASM: a WebAssembly module instantiates perfectly well under node, so the engine that
 * ships to the browser is the engine these tests load. What node cannot give is a canvas, so
 * `convertHeicFile` stops at the decode step here and the canvas half is verified in the browser
 * lane instead — see docs/tool-runtime-verification.md.
 *
 * The fixtures in `__fixtures__/` are real HEIC and AVIF files, encoded by macOS `sips` from a
 * PNG written by ../shared/test-png.ts, and small enough to commit (about 1 KB each):
 *
 *   tiny.heic          64 × 48, brands `heic` + `mif1 MiPr miaf MiHB heic`
 *   tiny-rotated.heic  the same picture turned 90°, which Apple's encoder stores as a 64 × 48
 *                      coded image plus an `irot` property — so a decoder that ignores `irot`
 *                      reports 64 × 48 and one that applies it reports 48 × 64
 *   tiny.avif          64 × 48 AV1, major brand `avif`, compatible brands `MiPr avif miaf mif1`
 *
 * Until 2026-09-03 there was no such fixture and the suite could not see that every valid HEIC
 * was being rejected: the shipped build returns `{ code: <embind enum>, message: 'Success' }`,
 * and `code !== 0` is true for an object, so a perfect decode failed with
 * "This file could not be read as HEIC: Success".
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_CANVAS_PIXELS } from '../shared/canvas-image';
import { isAvifBrand, isHeifBrand, readFtypBrand } from '../shared/ftyp';
import {
  type HeifImage,
  type LibheifFactory,
  type LibheifModule,
  instantiateLibheif,
} from '../shared/libheif-loader';
import { HeicDecodeError, MAX_DECODE_PIXELS, decodeHeif } from './decode';
import {
  convertHeicFile,
  convertHeicFiles,
  looksLikeHeic,
  outputName,
  outputSize,
  uniqueName,
  validateOptions,
} from './logic';

/** Build an `ftyp` box: size, 'ftyp', major brand, minor version, compatible brands. */
function ftyp(major: string, compatible: string[] = [], declaredSize?: number): Uint8Array {
  const size = 16 + compatible.length * 4;
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, declaredSize ?? size);
  const write = (text: string, at: number) => {
    for (let i = 0; i < 4; i++) bytes[at + i] = text.charCodeAt(i);
  };
  write('ftyp', 4);
  write(major, 8);
  new DataView(bytes.buffer).setUint32(12, 0);
  compatible.forEach((brand, i) => write(brand, 16 + i * 4));
  return bytes;
}

const file = (name: string, type = '') => ({ name, type });

const FIXTURES = join(__dirname, '__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

describe('brand detection', () => {
  it('reads the major brand and the compatible list', () => {
    const box = readFtypBrand(ftyp('heic', ['mif1', 'heic']));
    expect(box).toEqual({ majorBrand: 'heic', compatibleBrands: ['mif1', 'heic'] });
  });

  it.each(['heic', 'heix', 'mif1', 'msf1'])('accepts %s', (brand) => {
    const box = readFtypBrand(ftyp(brand));
    expect(box && isHeifBrand(box)).toBe(true);
  });

  it('accepts a file whose major brand is unknown but lists a HEIF brand as compatible', () => {
    // Canon .hif writes major `heix` with `mif1` alongside; other cameras invert that.
    const box = readFtypBrand(ftyp('CANO', ['mif1']));
    expect(box && isHeifBrand(box)).toBe(true);
  });

  it('reads a real HEIC as HEIF and a real AVIF as AVIF', () => {
    const heic = readFtypBrand(fixture('tiny.heic'));
    expect(heic?.majorBrand).toBe('heic');
    expect(heic && isHeifBrand(heic)).toBe(true);

    // The file that used to slip through: `mif1` really is in AVIF's compatible list, so a check
    // that looked for a HEIF brand anywhere sent an AV1 file to a decoder with no AV1 in it.
    const avif = readFtypBrand(fixture('tiny.avif'));
    expect(avif?.majorBrand).toBe('avif');
    expect(avif?.compatibleBrands).toContain('mif1');
    expect(avif && isAvifBrand(avif)).toBe(true);
    expect(avif && isHeifBrand(avif)).toBe(false);
  });

  it('stops reading brands instead of scanning a whole file', () => {
    // A `ftyp` box that declares size 0 used to mean "read to the end of the buffer": on a 20 MB
    // photo that is five million four-character strings built before the file is rejected.
    const bytes = new Uint8Array(1_000_000);
    bytes.set(ftyp('heic', ['mif1'], 0).subarray(0, 20));
    const box = readFtypBrand(bytes);
    expect(box?.majorBrand).toBe('heic');
    expect(box?.compatibleBrands.length).toBeLessThanOrEqual(32);
  });

  it('returns null for a JPEG and for a truncated file', () => {
    expect(
      readFtypBrand(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toBeNull();
    expect(readFtypBrand(new Uint8Array([0, 0, 0, 12]))).toBeNull();
  });

  it('matches by extension or MIME type before the bytes are read', () => {
    expect(looksLikeHeic(file('IMG_0001.HEIC'))).toBe(true);
    expect(looksLikeHeic(file('shot.heif'))).toBe(true);
    expect(looksLikeHeic(file('canon.hif'))).toBe(true);
    expect(looksLikeHeic(file('no-extension', 'image/heic'))).toBe(true);
    expect(looksLikeHeic(file('photo.jpg', 'image/jpeg'))).toBe(false);
  });
});

describe('options and naming', () => {
  it('accepts a valid pair', () => {
    expect(validateOptions({ format: 'jpeg', quality: 0.85 })).toEqual({
      format: 'jpeg',
      quality: 0.85,
    });
  });

  it.each([0, -0.5, 1.5, Number.NaN])('rejects quality %s', (quality) => {
    expect(() => validateOptions({ format: 'jpeg', quality })).toThrow(HeicDecodeError);
  });

  it('rejects a format the canvas cannot encode here', async () => {
    expect(() => validateOptions({ format: 'webp' as unknown as 'jpeg', quality: 0.8 })).toThrow(
      HeicDecodeError,
    );
    // …and it fails before any file is touched, which is why the batch entry point validates too.
    await expect(
      convertHeicFiles([], { format: 'gif' as unknown as 'png', quality: 1 }),
    ).rejects.toBeInstanceOf(HeicDecodeError);
  });

  it('swaps the extension, whatever its case', () => {
    expect(outputName('IMG_0042.HEIC', 'jpeg')).toBe('IMG_0042.jpg');
    expect(outputName('holiday.heif', 'png')).toBe('holiday.png');
    expect(outputName('canon.hif', 'jpeg')).toBe('canon.jpg');
    // A file dropped without an extension still gets a usable download name.
    expect(outputName('scan', 'jpeg')).toBe('scan.jpg');
    expect(outputName('.heic', 'jpeg')).toBe('image.jpg');
  });

  it('keeps two photos with the same name from becoming one file in the zip', () => {
    const taken = new Set<string>();
    expect(uniqueName('IMG_0001.jpg', taken)).toBe('IMG_0001.jpg');
    expect(uniqueName('IMG_0001.jpg', taken)).toBe('IMG_0001 (2).jpg');
    expect(uniqueName('IMG_0001.jpg', taken)).toBe('IMG_0001 (3).jpg');
    // Different case is the same file once the zip is extracted on Windows or macOS.
    expect(uniqueName('img_0001.JPG', taken)).toBe('img_0001 (4).JPG');
    expect(uniqueName('no-extension', taken)).toBe('no-extension');
    expect(uniqueName('no-extension', taken)).toBe('no-extension (2)');
  });
});

describe('fitting the canvas ceiling', () => {
  it('leaves an image that already fits alone', () => {
    expect(outputSize(4032, 3024)).toEqual({ width: 4032, height: 3024 });
  });

  it('scales a 24 MP iPhone photo down instead of refusing it', () => {
    // 5712 × 4284 is the default on iPhone 15 and later — 24.5 MP, over Safari's ~16.7 MP canvas
    // ceiling. Refusing it (what this did until 2026-09-03) turns away the most likely file.
    const out = outputSize(5712, 4284);
    expect(out).toEqual({ width: 4729, height: 3547 });
    expect(out.width * out.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(out.width / out.height).toBeCloseTo(5712 / 4284, 2);
  });

  it('scales a panorama on its long side', () => {
    const out = outputSize(16_000, 2_000);
    expect(out.width * out.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(out.width / out.height).toBeCloseTo(8, 1);
  });
});

const require = createRequire(import.meta.url);
const LIBHEIF_DIR = dirname(require.resolve('libheif-js/package.json'));

/**
 * The browser downloads the glue and the .wasm from /third-party/libheif/; node reads both off
 * disk and hands them to the same `instantiateLibheif`. Where the bytes came from is the only
 * difference — the readiness handshake under test is the one the browser runs.
 */
async function loadForNode(): Promise<LibheifModule> {
  const glue = await import('libheif-js/libheif-wasm/libheif.js');
  const factory = (glue as { default?: unknown }).default as LibheifFactory;
  return instantiateLibheif(
    factory,
    readFileSync(join(LIBHEIF_DIR, 'libheif-wasm', 'libheif.wasm')),
  );
}

describe('libheif WASM', () => {
  it('instantiates and reports a version', async () => {
    const lib = await loadForNode();
    expect(lib.heif_get_version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reports a container with no image as a HeicDecodeError', async () => {
    const lib = await loadForNode();
    await expect(decodeHeif(ftyp('heic', ['mif1']), lib)).rejects.toBeInstanceOf(HeicDecodeError);
  });

  it('decodes a real HEIC to its declared size and to pixels that are not blank', async () => {
    const lib = await loadForNode();
    const decoded = await decodeHeif(fixture('tiny.heic'), lib);
    expect([decoded.width, decoded.height]).toEqual([64, 48]);
    expect(decoded.imageCount).toBe(1);
    expect(decoded.pixels.data.length).toBe(64 * 48 * 4);
    // An all-zero buffer is what a decode that silently did nothing leaves behind.
    expect(decoded.pixels.data.some((v) => v !== 0)).toBe(true);
  });

  it('applies the container rotation, so a turned photo comes out turned', async () => {
    const lib = await loadForNode();
    const decoded = await decodeHeif(fixture('tiny-rotated.heic'), lib);
    // The coded image inside is 64 × 48 with an `irot` property; these are the display
    // dimensions, which is the whole orientation claim the FAQ makes.
    expect([decoded.width, decoded.height]).toEqual([48, 64]);
    expect(decoded.pixels.data.length).toBe(48 * 64 * 4);
    expect(decoded.pixels.data.some((v) => v !== 0)).toBe(true);
  });
});

/**
 * A stand-in module for the failure modes real files will not produce on demand. Only the calls
 * `decodeHeif` makes are implemented.
 */
function fakeLib(overrides: Partial<LibheifModule> = {}): LibheifModule {
  const image: HeifImage = {
    get_width: () => 8,
    get_height: () => 8,
    display: (target, done) => done(target),
    free: () => {},
  };
  return {
    heif_context_alloc: () => ({}),
    heif_context_free: () => {},
    // The shape the shipped build really returns: an embind enum, not an integer.
    heif_context_read_from_memory: () => ({
      code: { value: 0 },
      subcode: { value: 0 },
      message: 'Success',
    }),
    heif_js_context_get_list_of_top_level_image_IDs: () => [1],
    heif_js_context_get_primary_image_handle: () => ({}),
    heif_js_context_get_image_handle: () => ({}),
    heif_get_version: () => '1.19.8',
    HeifImage: function HeifImageStub() {
      return image;
    } as unknown as LibheifModule['HeifImage'],
    ...overrides,
  };
}

describe('decode failures', () => {
  it('accepts the embind success object rather than reading it as an error', async () => {
    const decoded = await decodeHeif(ftyp('heic'), fakeLib());
    expect(decoded.width).toBe(8);
  });

  it('surfaces the message from a read that failed', async () => {
    const lib = fakeLib({
      heif_context_read_from_memory: () => ({
        code: { value: 2 },
        message: 'Invalid input: Unspecified: File size too small.',
      }),
    });
    await expect(decodeHeif(ftyp('heic'), lib)).rejects.toThrow(
      'This file could not be read as HEIC: Invalid input: Unspecified: File size too small.',
    );
  });

  it('treats an error from the primary-handle call as an error, not as a handle', async () => {
    // Both handle calls fail; before 2026-09-03 the error object was handed to `new HeifImage`
    // because its `code` is an object rather than a number, and the user was told the image
    // "reports a size of zero".
    const failure = { code: { value: 5 }, message: 'Usage error' };
    const lib = fakeLib({
      heif_js_context_get_primary_image_handle: () => failure,
      heif_js_context_get_image_handle: () => failure,
    });
    await expect(decodeHeif(ftyp('heic'), lib)).rejects.toThrow(
      'This HEIC file has no image that could be opened.',
    );
  });

  it('falls back to the first image when there is no primary item', async () => {
    const lib = fakeLib({
      heif_js_context_get_primary_image_handle: () => ({ code: { value: 5 }, message: 'no pitm' }),
    });
    await expect(decodeHeif(ftyp('heic'), lib)).resolves.toMatchObject({ width: 8, height: 8 });
  });

  it('rejects an image too large to hold in memory', async () => {
    const side = Math.ceil(Math.sqrt(MAX_DECODE_PIXELS)) + 1000;
    const lib = fakeLib({
      HeifImage: function HeifImageStub() {
        return {
          get_width: () => side,
          get_height: () => side,
          display: (_t: ImageData, done: (r: ImageData | null) => void) => done(null),
          free: () => {},
        };
      } as unknown as LibheifModule['HeifImage'],
    });
    await expect(decodeHeif(ftyp('heic'), lib)).rejects.toThrow(/too large to decode/);
  });

  it('rejects rather than hanging when the decoder throws inside display', async () => {
    const lib = fakeLib({
      HeifImage: function HeifImageStub() {
        return {
          get_width: () => 8,
          get_height: () => 8,
          display: () => {
            throw new Error('bad memory access');
          },
          free: () => {},
        };
      } as unknown as LibheifModule['HeifImage'],
    });
    await expect(decodeHeif(ftyp('heic'), lib)).rejects.toThrow(
      'The HEIC image could not be decoded: bad memory access',
    );
  });

  it('rejects when display hands back nothing', async () => {
    const lib = fakeLib({
      HeifImage: function HeifImageStub() {
        return {
          get_width: () => 8,
          get_height: () => 8,
          display: (_t: ImageData, done: (r: ImageData | null) => void) => done(null),
          free: () => {},
        };
      } as unknown as LibheifModule['HeifImage'],
    });
    await expect(decodeHeif(ftyp('heic'), lib)).rejects.toThrow(
      'The HEIC image could not be decoded.',
    );
  });
});

describe('an AVIF file', () => {
  it('is turned away before the decoder is fetched', async () => {
    // The rejection has to happen on the bytes: reaching `loadLibheif` means a 1 MB download and
    // then a generic libheif failure, because this build has no AV1 decoder in it.
    const avif = new File([fixture('tiny.avif')], 'holiday.avif', { type: 'image/avif' });
    await expect(convertHeicFile(avif, { format: 'jpeg', quality: 0.9 })).rejects.toThrow(
      /AVIF is not supported here/,
    );
  });

  it('carries a code and params so the widget can localize the message', async () => {
    const avif = new File([fixture('tiny.avif')], 'holiday.avif', { type: 'image/avif' });
    await expect(convertHeicFile(avif, { format: 'jpeg', quality: 0.9 })).rejects.toMatchObject({
      code: 'heicIsAvif',
      params: { name: 'holiday.avif' },
    });
    // The batch keeps going and records the same code on the failure row.
    const { failures } = await convertHeicFiles([avif], { format: 'jpeg', quality: 0.9 });
    expect(failures).toMatchObject([
      { name: 'holiday.avif', code: 'heicIsAvif', params: { name: 'holiday.avif' } },
    ]);
    const thrown = (() => {
      try {
        validateOptions({ format: 'jpeg', quality: 0 });
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(thrown).toMatchObject({ code: 'heicBadQuality' });
  });
});

const REAL_PHOTO = resolve(__dirname, '..', '..', 'fixtures', 'manual', 'photo.heic');
const havePhoto = existsSync(REAL_PHOTO);
if (!havePhoto) {
  console.log(
    `SKIPPED: no ${REAL_PHOTO} — the full-size decode test needs a camera-sized photo. Drop one there and re-run.`,
  );
}

describe('a full-size photo', () => {
  it.skipIf(!havePhoto)(
    'decodes to non-empty pixels',
    async () => {
      const lib = await loadForNode();
      const decoded = await decodeHeif(new Uint8Array(readFileSync(REAL_PHOTO)), lib);
      expect(decoded.width).toBeGreaterThan(1000);
      expect(decoded.height).toBeGreaterThan(1000);
      expect(decoded.imageCount).toBeGreaterThan(0);
      expect(decoded.pixels.data.length).toBe(decoded.width * decoded.height * 4);
      expect(decoded.pixels.data.some((v) => v !== 0)).toBe(true);
    },
    30_000,
  );
});
