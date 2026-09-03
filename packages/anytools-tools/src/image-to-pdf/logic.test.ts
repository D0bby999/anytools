// @vitest-environment node
// pdf-lib runs fine under node and the two functions exercised here touch no DOM. The package
// default is happy-dom, where Blob/File differ subtly from node's.
//
// What is NOT covered here, and why: `prepareImages` decodes on a canvas, and happy-dom returns
// null from getContext('2d') and never calls back from toBlob. EXIF orientation, WebP input and
// the downscale re-encode are therefore verified in the browser lane
// (docs/tool-runtime-verification.md), not here. Everything below drives the real exported
// functions against images built in-process.
import { deflateSync } from 'node:zlib';
import zlib from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { EmbeddableImage } from '../shared/embeddable-image';
import {
  FIT_DPI,
  ImageToPdfError,
  type ImageToPdfOptions,
  PAGE_SIZES,
  imagesToPdf,
  layoutPage,
} from './logic';

// --- fixtures -------------------------------------------------------------------------------

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** A real, decodable RGB PNG of the requested size. */
function pngBytes(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) raw[y * stride + 1 + x * 3] = (x * 7 + y * 11) & 0xff;
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return Uint8Array.from(png);
}

/**
 * A JPEG header pdf-lib can read: SOI, JFIF APP0, SOF0 declaring the size, EOI. pdf-lib's
 * embedder parses markers for the dimensions and colour space and copies the bytes through as
 * a DCTDecode stream without decoding them, so this is enough to exercise the embedJpg branch
 * and prove the dimensions reach the XObject. Real photographic JPEGs go through the browser
 * lane; nothing here claims to test a JPEG decoder.
 */
function jpegBytes(width: number, height: number): Uint8Array {
  const be16 = (n: number) => n.toString(16).padStart(4, '0');
  const hex = [
    'ffd8', // SOI
    'ffe0 0010 4a464946 00 0101 00 0001 0001 0000', // APP0 / JFIF
    'ffc0 0011 08', // SOF0, segment length 17, 8 bits per component
    be16(height),
    be16(width),
    '03 011100 021101 031101', // three components, 4:2:0
    'ffd9', // EOI
  ]
    .join('')
    .replace(/\s/g, '');
  return Uint8Array.from((hex.match(/../g) ?? []).map((b) => Number.parseInt(b, 16)));
}

const png = (name: string, width: number, height: number): EmbeddableImage => ({
  name,
  bytes: pngBytes(width, height),
  format: 'png',
  width,
  height,
});

const jpeg = (name: string, width: number, height: number): EmbeddableImage => ({
  name,
  bytes: jpegBytes(width, height),
  format: 'jpeg',
  width,
  height,
});

const opts = (over: Partial<ImageToPdfOptions> = {}): ImageToPdfOptions => ({
  pageSize: 'a4',
  orientation: 'auto',
  margin: 0,
  downscale: true,
  ...over,
});

/** Image XObjects in a saved document, in the order pdf-lib wrote them. */
function imageXObjects(doc: PDFDocument) {
  return doc.context
    .enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter(
      (obj): obj is PDFRawStream =>
        obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Image',
    );
}

const reopen = async (blob: Blob) => PDFDocument.load(await blob.arrayBuffer());

// --- layoutPage -----------------------------------------------------------------------------

describe('layoutPage', () => {
  it('uses exact A4 points, not a rounded approximation', () => {
    const { page } = layoutPage({ width: 100, height: 200 }, opts());
    expect(page.width).toBeCloseTo(595.28, 2);
    expect(page.height).toBeCloseTo(841.89, 2);
  });

  it('auto orientation follows the image, not the page default', () => {
    const wide = layoutPage({ width: 2400, height: 1600 }, opts()).page;
    const tall = layoutPage({ width: 900, height: 1350 }, opts()).page;
    expect(wide.width).toBeGreaterThan(wide.height);
    expect(tall.height).toBeGreaterThan(tall.width);
    // A square image is not "wider than tall", so it stays portrait rather than flapping.
    const square = layoutPage({ width: 800, height: 800 }, opts()).page;
    expect(square.height).toBeGreaterThan(square.width);
  });

  it('forced orientation overrides the image shape', () => {
    const forced = layoutPage({ width: 2400, height: 1600 }, opts({ orientation: 'portrait' }));
    expect(forced.page.width).toBeCloseTo(PAGE_SIZES.a4.width, 2);
    // Still centred, and still letterboxed rather than cropped.
    expect(forced.image.width).toBeLessThanOrEqual(forced.page.width);
    expect(forced.image.height).toBeLessThan(forced.page.height);
  });

  it('preserves aspect ratio and centres', () => {
    const { page, image } = layoutPage(
      { width: 1000, height: 500 },
      opts({ orientation: 'portrait' }),
    );
    expect(image.width / image.height).toBeCloseTo(2, 5);
    expect(image.x + image.width / 2).toBeCloseTo(page.width / 2, 5);
    expect(image.y + image.height / 2).toBeCloseTo(page.height / 2, 5);
  });

  it('enlarges a small image to fill the page — points are not pixels', () => {
    const { image } = layoutPage({ width: 50, height: 50 }, opts({ orientation: 'portrait' }));
    expect(image.width).toBeCloseTo(PAGE_SIZES.a4.width, 2);
  });

  it('margins shrink the drawn image, not the page', () => {
    const bare = layoutPage({ width: 1000, height: 500 }, opts({ orientation: 'portrait' }));
    const inset = layoutPage(
      { width: 1000, height: 500 },
      opts({ orientation: 'portrait', margin: 36 }),
    );
    expect(inset.page.width).toBeCloseTo(bare.page.width, 5);
    expect(inset.image.width).toBeCloseTo(bare.image.width - 72, 5);
    expect(inset.image.x).toBeGreaterThanOrEqual(36);
  });

  it('rejects a margin that leaves no page, naming the limit', () => {
    expect(() => layoutPage({ width: 100, height: 100 }, opts({ margin: 400 }))).toThrow(
      ImageToPdfError,
    );
    expect(() => layoutPage({ width: 100, height: 100 }, opts({ margin: 400 }))).toThrow(/297/);
  });

  it('"fit" sizes the page from the image at 96 dpi and adds the margin around it', () => {
    const { page, image } = layoutPage({ width: 1920, height: 1080 }, opts({ pageSize: 'fit' }));
    expect(image.width).toBeCloseTo((1920 * 72) / FIT_DPI, 5);
    expect(image.height).toBeCloseTo((1080 * 72) / FIT_DPI, 5);
    expect(page.width).toBeCloseTo(image.width, 5);

    const inset = layoutPage({ width: 1920, height: 1080 }, opts({ pageSize: 'fit', margin: 20 }));
    expect(inset.page.width).toBeCloseTo(image.width + 40, 5);
    expect(inset.image.x).toBe(20);
  });

  it('"fit" ignores the orientation control — the image already decided', () => {
    const a = layoutPage({ width: 1920, height: 1080 }, opts({ pageSize: 'fit' })).page;
    const b = layoutPage(
      { width: 1920, height: 1080 },
      opts({ pageSize: 'fit', orientation: 'portrait' }),
    ).page;
    expect(b).toEqual(a);
  });
});

// --- imagesToPdf ----------------------------------------------------------------------------

describe('imagesToPdf', () => {
  it('writes one page per image, in the order given', async () => {
    const r = await imagesToPdf(
      [png('a.png', 40, 20), png('b.png', 20, 40), png('c.png', 30, 30)],
      opts(),
    );
    expect(r.pages).toBe(3);
    expect(r.sources.map((s) => s.name)).toEqual(['a.png', 'b.png', 'c.png']);

    const doc = await reopen(r.blob);
    expect(doc.getPageCount()).toBe(3);
    // a is landscape, b and c are portrait — readable straight off the page boxes.
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight());
    expect(doc.getPage(1).getHeight()).toBeGreaterThan(doc.getPage(1).getWidth());
    expect(doc.getPage(2).getHeight()).toBeGreaterThan(doc.getPage(2).getWidth());
  });

  it('every page actually carries an embedded image', async () => {
    const r = await imagesToPdf([png('a.png', 40, 20), png('b.png', 60, 60)], opts());
    const images = imageXObjects(await reopen(r.blob));
    expect(images).toHaveLength(2);
    expect(images.map((i) => i.dict.get(PDFName.of('Width'))?.toString())).toEqual(['40', '60']);
    expect(images.map((i) => i.dict.get(PDFName.of('Height'))?.toString())).toEqual(['20', '60']);
  });

  it('A4 pages measure 595.28 x 841.89 pt in the saved file', async () => {
    const r = await imagesToPdf([png('tall.png', 400, 800)], opts({ orientation: 'portrait' }));
    const page = (await reopen(r.blob)).getPage(0);
    expect(page.getWidth()).toBeCloseTo(595.28, 2);
    expect(page.getHeight()).toBeCloseTo(841.89, 2);
    expect(r.sources[0]?.page).toBe('595x842 pt');
  });

  it('Letter pages measure 612 x 792 pt', async () => {
    const r = await imagesToPdf(
      [png('tall.png', 400, 800)],
      opts({ pageSize: 'letter', orientation: 'portrait' }),
    );
    const page = (await reopen(r.blob)).getPage(0);
    expect(page.getWidth()).toBeCloseTo(612, 5);
    expect(page.getHeight()).toBeCloseTo(792, 5);
  });

  it('"fit" gives each page its own size', async () => {
    const r = await imagesToPdf(
      [png('a.png', 480, 240), png('b.png', 96, 960)],
      opts({ pageSize: 'fit' }),
    );
    const doc = await reopen(r.blob);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(360, 5); // 480 px / 96 dpi * 72
    expect(doc.getPage(0).getHeight()).toBeCloseTo(180, 5);
    expect(doc.getPage(1).getWidth()).toBeCloseTo(72, 5);
    expect(doc.getPage(1).getHeight()).toBeCloseTo(720, 5);
  });

  it('routes JPEG through embedJpg — the stream stays DCTDecode, never re-encoded', async () => {
    const r = await imagesToPdf([jpeg('photo.jpg', 30, 20)], opts());
    const images = imageXObjects(await reopen(r.blob));
    expect(images).toHaveLength(1);
    expect(images[0]?.dict.get(PDFName.of('Filter'))?.toString()).toBe('/DCTDecode');
    expect(images[0]?.dict.get(PDFName.of('Width'))?.toString()).toBe('30');
  });

  it('mixes PNG and JPEG in one document', async () => {
    const r = await imagesToPdf([png('a.png', 40, 40), jpeg('b.jpg', 40, 40)], opts());
    const filters = imageXObjects(await reopen(r.blob)).map((i) =>
      i.dict.get(PDFName.of('Filter'))?.toString(),
    );
    expect(r.pages).toBe(2);
    expect(filters).toContain('/DCTDecode');
    expect(filters).toContain('/FlateDecode');
  });

  it('survives bytes that do not start at offset 0 of their buffer', async () => {
    // pdf-lib reads `bytes.buffer` and ignores byteOffset, so a pooled Node Buffer or any
    // subarray parses from the wrong place. ownBuffer() is what stops that; without it this
    // throws "SOI not found in JPEG" on a valid JPEG.
    const source = jpegBytes(30, 20);
    const padded = new Uint8Array(source.length + 8);
    padded.set(source, 8);
    const offset = padded.subarray(8);
    expect(offset.byteOffset).toBe(8);
    const r = await imagesToPdf(
      [{ name: 'offset.jpg', bytes: offset, format: 'jpeg', width: 30, height: 20 }],
      opts(),
    );
    expect(imageXObjects(await reopen(r.blob))).toHaveLength(1);
  });

  it('reports the pixel size that went into the document', async () => {
    const r = await imagesToPdf([png('a.png', 40, 20)], opts());
    expect(r.sources[0]?.pixels).toBe('40x20');
    expect(r.blob.type).toBe('application/pdf');
  });

  it('refuses an empty list rather than producing a zero-page PDF', async () => {
    await expect(imagesToPdf([], opts())).rejects.toThrow(ImageToPdfError);
    await expect(imagesToPdf([], opts())).rejects.toThrow(/at least one/i);
  });

  it('names the image that could not be embedded', async () => {
    const broken: EmbeddableImage = {
      name: 'broken.png',
      bytes: Uint8Array.from([1, 2, 3, 4]),
      format: 'png',
      width: 10,
      height: 10,
    };
    await expect(imagesToPdf([png('ok.png', 10, 10), broken], opts())).rejects.toThrow(
      /broken\.png/,
    );
  });

  it('handles a batch without losing pages', async () => {
    const many = Array.from({ length: 25 }, (_, i) => png(`p${i}.png`, 24, 24));
    const r = await imagesToPdf(many, opts());
    expect(r.pages).toBe(25);
    expect((await reopen(r.blob)).getPageCount()).toBe(25);
  });
});
