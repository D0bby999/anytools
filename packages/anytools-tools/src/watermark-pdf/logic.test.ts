// @vitest-environment node
// pdf-lib runs fine under node and everything exercised here touches no DOM. `renderFirstPage`
// is the exception — it drives pdf.js onto a canvas, which happy-dom cannot do either — so the
// preview is verified in the browser lane (docs/tool-runtime-verification.md), not here.
//
// As with add-page-numbers, the assertions read the bytes back: the drawn text and its angle
// come out of the inflated content stream, and the opacity out of the page's ExtGState.
import { inflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  StandardFonts,
} from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EmbeddableImage } from '../shared/embeddable-image';
import { PageRangeError } from '../shared/page-range';
import { PdfTextError } from '../shared/pdf-page-stamp';
import { encodeRgbPng } from '../shared/test-png';
import { hasNotoFont, stubNotoFetch } from '../shared/test-unicode-font';
import {
  WatermarkError,
  type WatermarkOptions,
  centeredAnchor,
  parseHexColor,
  watermarkPdf,
} from './logic';

// --- fixtures -------------------------------------------------------------------------------

/** A rectangle as pdf-lib's setters take it: lower-left corner plus extent. */
type Box = [x: number, y: number, width: number, height: number];

async function pdfFile(
  pages: number,
  {
    name = 'in.pdf',
    size = [595, 842] as [number, number],
    rotate = {} as Record<number, number>,
    mediaBox,
    cropBox,
  }: {
    name?: string;
    size?: [number, number];
    rotate?: Record<number, number>;
    mediaBox?: Box;
    cropBox?: Box;
  },
): Promise<File> {
  const { degrees } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(size);
    if (mediaBox) page.setMediaBox(...mediaBox);
    if (cropBox) page.setCropBox(...cropBox);
    if (rotate[i]) page.setRotation(degrees(rotate[i] as number));
  }
  const bytes = await doc.save();
  return new File([bytes.slice()], name, { type: 'application/pdf' });
}

/** A real, decodable RGB PNG — the same encoder the image-to-pdf tests use (shared/test-png.ts). */
function pngImage(name: string, width: number, height: number): EmbeddableImage {
  return { name, bytes: encodeRgbPng(width, height, () => 0), format: 'png', width, height };
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

/**
 * Walk from a drawn box's anchor along the box's own rotated axes to its centre — the inverse of
 * `centeredAnchor`. Where the mark ENDED UP is the only thing worth asserting; the anchor on its
 * own is meaningless once an angle is involved.
 */
function boxCenter(
  anchor: { x: number; y: number },
  width: number,
  height: number,
  angleDegrees: number,
): { x: number; y: number } {
  const a = (angleDegrees * Math.PI) / 180;
  return {
    x: anchor.x + (width / 2) * Math.cos(a) - (height / 2) * Math.sin(a),
    y: anchor.y + (width / 2) * Math.sin(a) + (height / 2) * Math.cos(a),
  };
}

/** Helvetica metrics for a string, from a throwaway document. */
async function helveticaBox(text: string, size: number) {
  const probe = await PDFDocument.create();
  const font = await probe.embedFont(StandardFonts.Helvetica);
  return {
    width: font.widthOfTextAtSize(text, size),
    height: font.heightAtSize(size, { descender: false }),
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

beforeAll(() => {
  if (hasNotoFont()) stubNotoFetch();
});
afterAll(() => vi.unstubAllGlobals());

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
    const { width, height } = await helveticaBox('CONFIDENTIAL', size);
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

  it('refuses text no available font can draw, naming the characters', async () => {
    const file = await pdfFile(1, {});
    for (const text of ['机密文件', '🙂']) {
      await expect(watermarkPdf(file, textOpts({ text }))).rejects.toThrow(PdfTextError);
      await expect(watermarkPdf(file, textOpts({ text }))).rejects.toThrow(/can draw/);
    }
    // And the accented Latin that WinAnsi does cover still goes through Helvetica.
    await expect(watermarkPdf(file, textOpts({ text: 'BRÖTCHEN ÉTÉ' }))).resolves.toBeTruthy();
  });

  // Review 2026-09-05: a Vietnamese watermark was refused outright. Noto Sans is embedded as a
  // subset when Helvetica cannot spell the text.
  it.skipIf(!hasNotoFont())('stamps Vietnamese and Cyrillic text through Noto Sans', async () => {
    const file = await pdfFile(2, {});
    for (const text of ['BẢN NHÁP — Tài liệu mật', 'КОНФИДЕНЦИАЛЬНО']) {
      const r = await watermarkPdf(file, textOpts({ text }));
      expect(r.stamped).toBe(2);
      const doc = await reopen(r.blob);
      expect(drawnText(doc, 0).length).toBeGreaterThan(0);
      // The subset is embedded, not the whole 421 KB file.
      expect(r.blob.size).toBeLessThan(200_000);
    }
  });

  it('refuses settings that would produce an invisible or empty mark', async () => {
    const file = await pdfFile(1, {});
    await expect(watermarkPdf(file, textOpts({ text: '   ' }))).rejects.toThrow(/Type the text/);
    await expect(watermarkPdf(file, textOpts({ fontSize: 0 }))).rejects.toThrow(/font size/i);
    await expect(watermarkPdf(file, textOpts({ opacity: 0 }))).rejects.toThrow(/Opacity/);
    await expect(watermarkPdf(file, textOpts({ opacity: 1.5 }))).rejects.toThrow(/Opacity/);
    await expect(watermarkPdf(file, textOpts({ color: 'grey' }))).rejects.toThrow(WatermarkError);
  });

  it('carries a code and params so the widget can localize the message', async () => {
    const file = await pdfFile(1, {});
    await expect(watermarkPdf(file, textOpts({ text: '   ' }))).rejects.toMatchObject({
      code: 'watermarkTextEmpty',
    });
    await expect(watermarkPdf(file, textOpts({ color: 'grey' }))).rejects.toMatchObject({
      code: 'badColour',
      params: { hex: 'grey' },
    });
    await expect(watermarkPdf(file, textOpts({ text: '机密文件' }))).rejects.toMatchObject({
      code: 'fontCoverage',
      params: { subject: 'The watermark text', missing: '机 密 文 件' },
    });
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

// --- box origins ----------------------------------------------------------------------------
//
// `page.getSize()` reports the media box's width and height and drops its ORIGIN, and it never
// looks at the CropBox — the box a reader actually displays. A watermark centred on (w/2, h/2)
// of a page whose box is [100 200 695 1042] therefore lands 100 pt left and 200 pt below where
// the page's middle really is; with a crop box it can land outside the visible area entirely.
// The centre is the same point whatever the /Rotate, which is what makes these numbers checkable
// by hand: the middle of MediaBox [100 200 695 1042] is (100 + 297.5, 200 + 421) = (397.5, 621),
// and the middle of CropBox [80 40 525 742] is (80 + 222.5, 40 + 351) = (302.5, 391).
//
// The crop box here is deliberately OFF-CENTRE inside its media box. A centred crop box — the
// obvious [50 50 545 792] — shares its middle with the media box, so a tool that ignored the
// CropBox entirely would still pass a centring assertion against it.

describe('watermarkPdf on a page whose box is not at the origin', () => {
  for (const rotation of [0, 90, 180, 270]) {
    it(`centres the text on the real middle of the media box at /Rotate ${rotation}`, async () => {
      const file = await pdfFile(1, { mediaBox: [100, 200, 595, 842], rotate: { 0: rotation } });
      const doc = await reopen((await watermarkPdf(file, textOpts({ rotation: 0 }))).blob);
      const t = drawnText(doc, 0)[0];
      const { width, height } = await helveticaBox('CONFIDENTIAL', 48);

      // The mark asked for 0 degrees, so its user-space angle is the page's own rotation.
      // atan2 reports a quarter turn anticlockwise as -90, hence the normalisation.
      expect((((t?.angle ?? 0) % 360) + 360) % 360).toBe(rotation);
      const center = boxCenter({ x: t?.x ?? 0, y: t?.y ?? 0 }, width, height, t?.angle ?? 0);
      expect(center.x).toBeCloseTo(397.5, 1);
      expect(center.y).toBeCloseTo(621, 1);
    });

    it(`centres the text on the middle of the crop box at /Rotate ${rotation}`, async () => {
      const file = await pdfFile(1, { cropBox: [80, 40, 445, 702], rotate: { 0: rotation } });
      const doc = await reopen((await watermarkPdf(file, textOpts({ rotation: 0 }))).blob);
      const t = drawnText(doc, 0)[0];
      const { width, height } = await helveticaBox('CONFIDENTIAL', 48);

      const center = boxCenter({ x: t?.x ?? 0, y: t?.y ?? 0 }, width, height, t?.angle ?? 0);
      expect(center.x).toBeCloseTo(302.5, 1);
      expect(center.y).toBeCloseTo(391, 1);
    });
  }

  it('sizes an image mark against the crop box, and centres it there', async () => {
    // 50% of the crop box's 445 pt width is 222.5 pt — NOT 50% of the media box's 595.
    const file = await pdfFile(1, { cropBox: [80, 40, 445, 702] });
    const doc = await reopen((await watermarkPdf(file, imageOpts({ scalePercent: 50 }))).blob);
    const box = drawnImageBox(doc, 0);

    expect(box.width).toBeCloseTo(222.5, 1);
    expect(box.height).toBeCloseTo(222.5 / 2, 1); // 200x100 source
    expect(box.x + box.width / 2).toBeCloseTo(302.5, 1);
    expect(box.y + box.height / 2).toBeCloseTo(391, 1);
    // Inside the visible page, which the media box alone would not have guaranteed.
    expect(box.x).toBeGreaterThanOrEqual(80);
    expect(box.x + box.width).toBeLessThanOrEqual(525);
  });
});
