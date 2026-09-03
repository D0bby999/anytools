// @vitest-environment node
// pdf-lib runs fine under node and everything exercised here touches no DOM. `renderFirstPage`
// is the exception — it drives pdf.js onto a canvas, which happy-dom cannot do either — so the
// preview is verified in the browser lane (docs/tool-runtime-verification.md), not here.
//
// As with add-page-numbers, the assertions read the bytes back: the drawn text and its angle
// come out of the inflated content stream, and the opacity out of the page's ExtGState.
import zlib, { deflateSync, inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { EmbeddableImage } from '../shared/embeddable-image';
import { PageRangeError } from '../shared/page-range';
import { PdfTextError } from '../shared/pdf-page-stamp';
import {
  WatermarkError,
  type WatermarkOptions,
  centeredAnchor,
  parseHexColor,
  watermarkPdf,
} from './logic';

// --- fixtures -------------------------------------------------------------------------------

async function pdfFile(
  pages: number,
  { name = 'in.pdf', size = [595, 842] as [number, number], rotate = {} as Record<number, number> },
): Promise<File> {
  const { degrees } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(size);
    if (rotate[i]) page.setRotation(degrees(rotate[i] as number));
  }
  const bytes = await doc.save();
  return new File([bytes.slice()], name, { type: 'application/pdf' });
}

/** A real, decodable RGB PNG — the same encoder the image-to-pdf tests use. */
function pngImage(name: string, width: number, height: number): EmbeddableImage {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) raw[y * stride] = 0;
  const bytes = Uint8Array.from(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
  return { name, bytes, format: 'png', width, height };
}

const textOpts = (over: Partial<WatermarkOptions> = {}): WatermarkOptions =>
  ({
    kind: 'text',
    text: 'CONFIDENTIAL',
    fontSize: 48,
    color: '#808080',
    rotation: 45,
    opacity: 0.25,
    range: '',
    ...over,
  }) as WatermarkOptions;

const imageOpts = (over: Partial<WatermarkOptions> = {}): WatermarkOptions =>
  ({
    kind: 'image',
    image: pngImage('logo.png', 200, 100),
    scalePercent: 50,
    rotation: 0,
    opacity: 0.4,
    range: '',
    ...over,
  }) as WatermarkOptions;

const reopen = async (blob: Blob) => PDFDocument.load(await blob.arrayBuffer());

type DrawnText = { text: string; x: number; y: number; angle: number };

function drawnText(doc: PDFDocument, pageIndex: number): DrawnText[] {
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return [];
  const streams = (
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents]
  ).filter((obj): obj is PDFStream => obj instanceof PDFStream);

  const out: DrawnText[] = [];
  for (const stream of streams) {
    let body: string;
    const raw = stream.getContents();
    try {
      body = inflateSync(Buffer.from(raw)).toString('latin1');
    } catch {
      body = Buffer.from(raw).toString('latin1');
    }
    const pattern =
      /(-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) Tm[\s\S]*?<([0-9A-Fa-f]*)> Tj/g;
    for (const m of body.matchAll(pattern)) {
      out.push({
        text: ((m[7] ?? '').match(/../g) ?? [])
          .map((b) => String.fromCharCode(Number.parseInt(b, 16)))
          .join(''),
        x: Number(m[5]),
        y: Number(m[6]),
        angle: Math.round((Math.atan2(Number(m[2]), Number(m[1])) * 180) / Math.PI),
      });
    }
  }
  return out;
}

/** Fill alphas declared in a page's graphics states. */
function fillAlphas(doc: PDFDocument, pageIndex: number): number[] {
  const gs = doc.getPage(pageIndex).node.Resources()?.lookup(PDFName.of('ExtGState'), PDFDict);
  if (!gs) return [];
  return gs
    .entries()
    .map(([, ref]) => doc.context.lookup(ref))
    .filter((obj): obj is PDFDict => obj instanceof PDFDict)
    .map((dict) => Number(dict.get(PDFName.of('ca'))?.toString()))
    .filter((n) => Number.isFinite(n));
}

/**
 * The box an image XObject occupies on a page, in points.
 *
 * pdf-lib emits several `cm` operators in a row — a translate, an identity, the scale, another
 * identity — so reading any single one gives the wrong answer. Compose them the way a PDF
 * renderer does (each `cm` applies inside the space the previous one set up, so fold from the
 * last back to the first) and push the image's unit square through the result.
 */
function drawnImageBox(doc: PDFDocument, pageIndex: number) {
  const contents = doc.getPage(pageIndex).node.Contents();
  const stream = (
    contents instanceof PDFArray ? doc.context.lookup(contents.get(0)) : contents
  ) as PDFStream;
  const body = inflateSync(Buffer.from(stream.getContents())).toString('latin1');
  const mats = [
    ...body.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g),
  ].map((m) => m.slice(1, 7).map(Number) as number[]);

  const map = (p: { x: number; y: number }) =>
    mats.reduceRight(
      (acc, m) => ({
        x: (m[0] as number) * acc.x + (m[2] as number) * acc.y + (m[4] as number),
        y: (m[1] as number) * acc.x + (m[3] as number) * acc.y + (m[5] as number),
      }),
      p,
    );

  const origin = map({ x: 0, y: 0 });
  const far = map({ x: 1, y: 1 });
  return {
    x: origin.x,
    y: origin.y,
    width: far.x - origin.x,
    height: far.y - origin.y,
  };
}

const imageXObjects = (doc: PDFDocument) =>
  doc.context
    .enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter(
      (obj): obj is PDFRawStream =>
        obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Image',
    );

// --- parseHexColor --------------------------------------------------------------------------

describe('parseHexColor', () => {
  it('reads six-digit and three-digit hex, with or without the hash', () => {
    expect(parseHexColor('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseHexColor('000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColor('#fff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseHexColor('#F00')).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseHexColor('#808080').r).toBeCloseTo(0.502, 3);
  });

  it('refuses anything else rather than quietly turning it black', () => {
    // A silent fallback to black gets reported as "the watermark is too dark", which sends
    // the next person looking at the wrong thing entirely.
    for (const bad of ['red', '#12', '#12345', 'rgb(1,2,3)', '', '#gggggg']) {
      expect(() => parseHexColor(bad)).toThrow(WatermarkError);
    }
  });
});

// --- centeredAnchor -------------------------------------------------------------------------

describe('centeredAnchor', () => {
  const center = { x: 300, y: 400 };

  it('is a plain half-box offset when the box is not rotated', () => {
    expect(centeredAnchor(center, 100, 40, 0)).toEqual({ x: 250, y: 380 });
  });

  it('puts the box centre back on the target for any angle', () => {
    // Walk from the anchor along the box's own rotated axes and land on the centre. This is
    // the property that matters; passing the centre straight to drawText fails it at once.
    for (const angle of [0, 30, 45, 90, 135, 180, 270, -45]) {
      const [w, h] = [120, 36];
      const a = (angle * Math.PI) / 180;
      const anchor = centeredAnchor(center, w, h, angle);
      const x = anchor.x + (w / 2) * Math.cos(a) - (h / 2) * Math.sin(a);
      const y = anchor.y + (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a);
      expect(x).toBeCloseTo(center.x, 6);
      expect(y).toBeCloseTo(center.y, 6);
    }
  });

  it('moves the anchor off the centre — a 45 degree mark is not anchored at its middle', () => {
    const anchor = centeredAnchor(center, 200, 50, 45);
    expect(anchor.x).not.toBeCloseTo(center.x, 1);
    expect(anchor.y).toBeLessThan(center.y);
  });
});

// --- watermarkPdf, text ---------------------------------------------------------------------

describe('watermarkPdf with text', () => {
  it('stamps every page, leaving the page count and sizes alone', async () => {
    const r = await watermarkPdf(await pdfFile(4, {}), textOpts());
    expect(r.pages).toBe(4);
    expect(r.stamped).toBe(4);
    const doc = await reopen(r.blob);
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595, 5);
    for (let i = 0; i < 4; i++) {
      expect(drawnText(doc, i).map((t) => t.text)).toEqual(['CONFIDENTIAL']);
    }
  });

  it('draws at the angle asked for', async () => {
    const doc = await reopen((await watermarkPdf(await pdfFile(1, {}), textOpts())).blob);
    expect(drawnText(doc, 0)[0]?.angle).toBe(45);

    const flat = await reopen(
      (await watermarkPdf(await pdfFile(1, {}), textOpts({ rotation: 0 }))).blob,
    );
    expect(drawnText(flat, 0)[0]?.angle).toBe(0);
  });

  it('centres the mark on the page', async () => {
    // Not the anchor — the anchor is offset by half the rotated box. Walk forward from it the
    // way a reader's eye does and check the middle of the text lands on the middle of the page.
    const size = 48;
    const doc = await reopen(
      (await watermarkPdf(await pdfFile(1, {}), textOpts({ rotation: 0, fontSize: size }))).blob,
    );
    const t = drawnText(doc, 0)[0];
    const { StandardFonts } = await import('pdf-lib');
    const probe = await PDFDocument.create();
    const font = await probe.embedFont(StandardFonts.Helvetica);
    const width = font.widthOfTextAtSize('CONFIDENTIAL', size);
    const height = font.heightAtSize(size, { descender: false });
    expect((t?.x ?? 0) + width / 2).toBeCloseTo(595 / 2, 1);
    expect((t?.y ?? 0) + height / 2).toBeCloseTo(842 / 2, 1);
  });

  it('records the opacity as a fill alpha, not by faking a pale colour', async () => {
    const doc = await reopen(
      (await watermarkPdf(await pdfFile(2, {}), textOpts({ opacity: 0.25 }))).blob,
    );
    expect(fillAlphas(doc, 0)).toContain(0.25);
    expect(fillAlphas(doc, 1)).toContain(0.25);
  });

  it('adds the page rotation so the mark is diagonal to the reader, not to the media box', async () => {
    const doc = await reopen(
      (await watermarkPdf(await pdfFile(2, { rotate: { 1: 90 } }), textOpts())).blob,
    );
    expect(drawnText(doc, 0)[0]?.angle).toBe(45);
    expect(drawnText(doc, 1)[0]?.angle).toBe(135); // 45 asked for, + 90 of page rotation
  });

  it('stamps only the pages in the range', async () => {
    const r = await watermarkPdf(await pdfFile(5, {}), textOpts({ range: '2, 4' }));
    expect(r.stamped).toBe(2);
    expect(r.pages).toBe(5);
    const doc = await reopen(r.blob);
    expect([0, 1, 2, 3, 4].map((i) => drawnText(doc, i).length)).toEqual([0, 1, 0, 1, 0]);
  });

  it('says plainly that the built-in font is Latin only', async () => {
    const file = await pdfFile(1, {});
    // Real strings people will try, in the three scripts most likely to be typed here.
    for (const text of ['Tài liệu mật', '机密文件', 'КОНФИДЕНЦИАЛЬНО']) {
      await expect(watermarkPdf(file, textOpts({ text }))).rejects.toThrow(PdfTextError);
      await expect(watermarkPdf(file, textOpts({ text }))).rejects.toThrow(/Latin characters/);
    }
    // And the accented Latin that WinAnsi does cover still works.
    await expect(watermarkPdf(file, textOpts({ text: 'BRÖTCHEN ÉTÉ' }))).resolves.toBeTruthy();
  });

  it('refuses settings that would produce an invisible or empty mark', async () => {
    const file = await pdfFile(1, {});
    await expect(watermarkPdf(file, textOpts({ text: '   ' }))).rejects.toThrow(/Type the text/);
    await expect(watermarkPdf(file, textOpts({ fontSize: 0 }))).rejects.toThrow(/font size/i);
    await expect(watermarkPdf(file, textOpts({ opacity: 0 }))).rejects.toThrow(/Opacity/);
    await expect(watermarkPdf(file, textOpts({ opacity: 1.5 }))).rejects.toThrow(/Opacity/);
    await expect(watermarkPdf(file, textOpts({ color: 'grey' }))).rejects.toThrow(WatermarkError);
  });

  it('passes the range parser message through', async () => {
    await expect(watermarkPdf(await pdfFile(3, {}), textOpts({ range: '7' }))).rejects.toThrow(
      PageRangeError,
    );
  });

  it('names a file it cannot read', async () => {
    const bad = new File([new Uint8Array([9, 9, 9])], 'broken.pdf', { type: 'application/pdf' });
    await expect(watermarkPdf(bad, textOpts())).rejects.toThrow(/broken\.pdf/);
  });
});

// --- watermarkPdf, image --------------------------------------------------------------------

describe('watermarkPdf with an image', () => {
  it('embeds the image once and references it from every page', async () => {
    // The whole reason embedding sits outside the loop: a 200 KB logo on a 50-page document
    // would otherwise add 10 MB.
    const r = await watermarkPdf(await pdfFile(6, {}), imageOpts());
    expect(r.stamped).toBe(6);
    expect(imageXObjects(await reopen(r.blob))).toHaveLength(1);
  });

  it('sizes the image as a percentage of the page width, keeping its aspect ratio', async () => {
    const doc = await reopen(
      (await watermarkPdf(await pdfFile(1, {}), imageOpts({ scalePercent: 50 }))).blob,
    );
    const box = drawnImageBox(doc, 0);
    expect(box.width).toBeCloseTo(595 * 0.5, 1);
    // 200x100 source at half the page width is half as tall as it is wide.
    expect(box.height).toBeCloseTo((595 * 0.5) / 2, 1);

    // And the percentage means what it says at another value.
    const quarter = await reopen(
      (await watermarkPdf(await pdfFile(1, {}), imageOpts({ scalePercent: 25 }))).blob,
    );
    expect(drawnImageBox(quarter, 0).width).toBeCloseTo(595 * 0.25, 1);
  });

  it('centres the image on the page', async () => {
    const box = drawnImageBox(
      await reopen((await watermarkPdf(await pdfFile(1, {}), imageOpts())).blob),
      0,
    );
    expect(box.x + box.width / 2).toBeCloseTo(595 / 2, 1);
    expect(box.y + box.height / 2).toBeCloseTo(842 / 2, 1);
  });

  it('measures the percentage against the page the reader sees, not the media box', async () => {
    // A page with /Rotate 90 is 842 wide to a reader even though its box is 595 wide.
    const doc = await reopen(
      (await watermarkPdf(await pdfFile(1, { rotate: { 0: 90 } }), imageOpts())).blob,
    );
    const box = drawnImageBox(doc, 0);
    // The drawn box is expressed in user space, where the rotation swaps the axes, so the
    // reader's 50%-of-842 shows up as a height of ~421 here.
    expect(Math.max(Math.abs(box.width), Math.abs(box.height))).toBeCloseTo(842 * 0.5, 1);
  });

  it('applies opacity to an image mark too', async () => {
    const doc = await reopen(
      (await watermarkPdf(await pdfFile(1, {}), imageOpts({ opacity: 0.4 }))).blob,
    );
    expect(fillAlphas(doc, 0)).toContain(0.4);
  });

  it('rejects an image that is not a readable PNG or JPEG', async () => {
    const broken: EmbeddableImage = {
      name: 'broken.png',
      bytes: Uint8Array.from([1, 2, 3]),
      format: 'png',
      width: 10,
      height: 10,
    };
    await expect(watermarkPdf(await pdfFile(1, {}), imageOpts({ image: broken }))).rejects.toThrow(
      /broken\.png/,
    );
  });

  it('refuses a zero size', async () => {
    await expect(
      watermarkPdf(await pdfFile(1, {}), imageOpts({ scalePercent: 0 })),
    ).rejects.toThrow(/size above zero/);
  });
});
