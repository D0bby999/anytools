// @vitest-environment node
/**
 * Runs in node rather than happy-dom because the interesting half of this file is the real
 * libheif WASM: a WebAssembly module instantiates perfectly well under node, so the engine that
 * ships to the browser is the engine these tests load. What node cannot give is a canvas, so
 * `convertHeicFile` (decode → createImageBitmap → drawToBlob) stops at the decode step here and
 * is verified in the browser lane instead — see docs/tool-runtime-verification.md.
 *
 * The WASM test below feeds libheif a valid `ftyp` header with no image data. That is the same
 * code path a real photo takes right up to the point where there is something to decode, so it
 * proves the module started, the exports are the ones this repository expects, and the error
 * surfaces as a HeicDecodeError rather than an emscripten abort.
 *
 * A real photo cannot be synthesised: encoding HEIC needs an HEVC encoder, and the shipped
 * build is decode-only. Drop one at fixtures/manual/photo.heic and the last test stops skipping.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type LibheifFactory,
  type LibheifModule,
  instantiateLibheif,
} from '../shared/libheif-loader';
import {
  HeicDecodeError,
  convertHeicFiles,
  decodeHeif,
  isAvifBrand,
  isHeifBrand,
  looksLikeHeic,
  outputName,
  readFtypBrand,
  validateOptions,
} from './logic';

/** Build an `ftyp` box: size, 'ftyp', major brand, minor version, compatible brands. */
function ftyp(major: string, compatible: string[] = []): Uint8Array {
  const size = 16 + compatible.length * 4;
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
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

  it('tells AVIF apart from HEIC', () => {
    const box = readFtypBrand(ftyp('avif', ['mif1', 'miaf']));
    expect(box && isAvifBrand(box)).toBe(true);
    // `mif1` is in AVIF's compatible list too, so major brand has to win for the message to
    // say "this is AVIF" rather than sending it to a decoder that cannot read AV1.
    expect(box?.majorBrand).toBe('avif');
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
});

const REAL_PHOTO = resolve(__dirname, '..', '..', 'fixtures', 'manual', 'photo.heic');
const havePhoto = existsSync(REAL_PHOTO);
if (!havePhoto) {
  console.log(
    `SKIPPED: no ${REAL_PHOTO} — the real-HEIC decode test needs a photo from a phone. Drop one there and re-run.`,
  );
}

describe('a real photo', () => {
  it.skipIf(!havePhoto)(
    'decodes to non-empty pixels',
    async () => {
      const lib = await loadForNode();
      const decoded = await decodeHeif(new Uint8Array(readFileSync(REAL_PHOTO)), lib);
      expect(decoded.width).toBeGreaterThan(0);
      expect(decoded.height).toBeGreaterThan(0);
      expect(decoded.imageCount).toBeGreaterThan(0);
      expect(decoded.pixels.data.length).toBe(decoded.width * decoded.height * 4);
      // An all-zero buffer is what a decode that silently did nothing leaves behind.
      expect(decoded.pixels.data.some((v) => v !== 0)).toBe(true);
    },
    30_000,
  );
});
