// @vitest-environment node
// pdf-lib runs fine under node and this file touches no DOM.
//
// These tests do not settle for "the file got bigger". They inflate each page's content stream
// and read back the text pdf-lib actually wrote, with its text matrix — so the label, its
// position and its rotation are all asserted against the bytes in the document. A tool that
// stamped every number into the same wrong corner would pass a size check and fail here.
import { inflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  StandardFonts,
  degrees,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PageRangeError } from '../shared/page-range';
import {
  type AddPageNumbersOptions,
  PageNumberError,
  addPageNumbers,
  labelFor,
  labelOrigin,
} from './logic';

// --- fixtures and content-stream reading ----------------------------------------------------

/** A real PDF. `rotate` sets /Rotate on the page at that index, as a scanner would. */
async function pdfFile(
  pages: number,
  { name = 'in.pdf', size = [595, 842] as [number, number], rotate = {} as Record<number, number> },
): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(size);
    if (rotate[i]) page.setRotation(degrees(rotate[i] as number));
  }
  const bytes = await doc.save();
  return new File([bytes.slice()], name, { type: 'application/pdf' });
}

type DrawnText = { text: string; x: number; y: number; angle: number };

/**
 * Every string drawn on a page, with where and at what angle.
 *
 * pdf-lib writes `a b c d e f Tm` followed by `<hex> Tj`. For a rotation the matrix is
 * [cos, sin, -sin, cos, x, y], so the angle is atan2(b, a) and the position is (e, f).
 */
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
    const raw = stream.getContents();
    let body: string;
    try {
      body = inflateSync(Buffer.from(raw)).toString('latin1');
    } catch {
      body = Buffer.from(raw).toString('latin1');
    }
    const pattern =
      /(-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) Tm[\s\S]*?<([0-9A-Fa-f]*)> Tj/g;
    for (const m of body.matchAll(pattern)) {
      const hex = m[7] ?? '';
      out.push({
        text: (hex.match(/../g) ?? [])
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

const opts = (over: Partial<AddPageNumbersOptions> = {}): AddPageNumbersOptions => ({
  position: 'bottom-center',
  format: 'plain',
  startAt: 1,
  range: '',
  fontSize: 12,
  margin: 36,
  ...over,
});

const reopen = async (blob: Blob) => PDFDocument.load(await blob.arrayBuffer());
const labelsOf = async (blob: Blob) => {
  const doc = await reopen(blob);
  return Array.from({ length: doc.getPageCount() }, (_, i) =>
    drawnText(doc, i)
      .map((t) => t.text)
      .join(''),
  );
};

// --- labelFor -------------------------------------------------------------------------------

describe('labelFor', () => {
  it('renders the three formats', () => {
    expect(labelFor('plain', 4, 9)).toBe('4');
    expect(labelFor('of-total', 4, 9)).toBe('4 / 9');
    expect(labelFor('page-n', 4, 9)).toBe('Page 4');
  });
});

// --- labelOrigin ----------------------------------------------------------------------------

describe('labelOrigin', () => {
  const frame = { width: 600, height: 800 };

  it('puts a bottom-left label exactly one margin in from both edges', () => {
    expect(labelOrigin('bottom-left', frame, 36, 20, 9)).toEqual({ x: 36, y: 36 });
  });

  it('subtracts the text width when aligning right, so the label ends at the margin', () => {
    const { x } = labelOrigin('bottom-right', frame, 36, 20, 9);
    expect(x).toBe(600 - 36 - 20);
    expect(x + 20).toBe(600 - 36);
  });

  it('centres on the text width, not on the margin', () => {
    expect(labelOrigin('bottom-center', frame, 36, 20, 9).x).toBe((600 - 20) / 2);
    // Independent of the margin — a centred label is centred whatever the edge inset.
    expect(labelOrigin('top-center', frame, 72, 20, 9).x).toBe((600 - 20) / 2);
  });

  it('subtracts the ascent when aligning top, so the glyph tops sit at the margin', () => {
    const { y } = labelOrigin('top-left', frame, 36, 20, 9);
    expect(y).toBe(800 - 36 - 9);
    expect(y + 9).toBe(800 - 36);
  });
});

// --- addPageNumbers -------------------------------------------------------------------------

describe('addPageNumbers', () => {
  it('leaves the page count and page sizes alone', async () => {
    const r = await addPageNumbers(await pdfFile(5, {}), opts());
    expect(r.pages).toBe(5);
    expect(r.numbered).toBe(5);
    const doc = await reopen(r.blob);
    expect(doc.getPageCount()).toBe(5);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595, 5);
    expect(doc.getPage(4).getHeight()).toBeCloseTo(842, 5);
  });

  it('writes a different, increasing number on each page', async () => {
    const r = await addPageNumbers(await pdfFile(4, {}), opts());
    expect(await labelsOf(r.blob)).toEqual(['1', '2', '3', '4']);
    expect(r.firstLabel).toBe('1');
    expect(r.lastLabel).toBe('4');
  });

  it('honours the starting number', async () => {
    const r = await addPageNumbers(await pdfFile(3, {}), opts({ startAt: 7 }));
    expect(await labelsOf(r.blob)).toEqual(['7', '8', '9']);
  });

  it('"{n} / {total}" counts the numbers printed, not the pages in the file', async () => {
    const all = await addPageNumbers(await pdfFile(3, {}), opts({ format: 'of-total' }));
    expect(await labelsOf(all.blob)).toEqual(['1 / 3', '2 / 3', '3 / 3']);

    // Number only pages 3-5 of a six-page file, starting the count at 1: the reader of those
    // three pages should see 1/3..3/3, not 1/6.
    const some = await addPageNumbers(
      await pdfFile(6, {}),
      opts({ format: 'of-total', range: '3-5' }),
    );
    expect(await labelsOf(some.blob)).toEqual(['', '', '1 / 3', '2 / 3', '3 / 3', '']);
    expect(some.numbered).toBe(3);
    expect(some.pages).toBe(6);
  });

  it('numbers only the pages in the range, in document order', async () => {
    const r = await addPageNumbers(await pdfFile(5, {}), opts({ range: '1, 4-5' }));
    expect(await labelsOf(r.blob)).toEqual(['1', '', '', '2', '3']);
  });

  it('places the label where the position says, in page coordinates', async () => {
    const file = await pdfFile(1, {});
    const bl = drawnText(
      await reopen((await addPageNumbers(file, opts({ position: 'bottom-left' }))).blob),
      0,
    );
    expect(bl[0]).toMatchObject({ x: 36, angle: 0 });
    expect(bl[0]?.y).toBeCloseTo(36, 5);

    const tr = drawnText(
      await reopen((await addPageNumbers(file, opts({ position: 'top-right' }))).blob),
      0,
    );
    // Right-aligned: the label's right edge is one margin from the page edge, so its left
    // edge is further in by the width of "1".
    expect(tr[0]?.x).toBeGreaterThan(500);
    expect(tr[0]?.x).toBeLessThan(595 - 36);
    expect(tr[0]?.y).toBeGreaterThan(780);
  });

  it('follows /Rotate so the number is upright in the corner the reader sees', async () => {
    // Page 2 is turned a quarter turn, as a sideways scan is. Without the frame mapping the
    // number reads sideways and lands in a different corner from every other page.
    const file = await pdfFile(3, { rotate: { 1: 90 } });
    const doc = await reopen((await addPageNumbers(file, opts({ position: 'bottom-left' }))).blob);

    expect(drawnText(doc, 0)[0]?.angle).toBe(0);
    expect(drawnText(doc, 1)[0]?.angle).toBe(90);
    expect(drawnText(doc, 2)[0]?.angle).toBe(0);

    // Reader's bottom-left on a page turned clockwise is the media box's bottom-RIGHT.
    const rotated = drawnText(doc, 1)[0];
    expect(rotated?.x).toBeCloseTo(595 - 36, 5);
    expect(rotated?.y).toBeCloseTo(36, 5);
  });

  it('measures the margin against the page as the reader sees it, not the media box', async () => {
    // The rotated page is 842 wide and 595 tall to a reader. A centred label must be centred
    // on 842, which after mapping is an offset along the media box's HEIGHT.
    const file = await pdfFile(1, { rotate: { 0: 90 } });
    const t = drawnText(await reopen((await addPageNumbers(file, opts())).blob), 0)[0];
    expect(t?.y).toBeGreaterThan(842 / 2 - 20);
    expect(t?.y).toBeLessThan(842 / 2 + 20);
  });

  it('rejects a range the document cannot satisfy, with the range parser message', async () => {
    await expect(addPageNumbers(await pdfFile(3, {}), opts({ range: '9' }))).rejects.toThrow(
      PageRangeError,
    );
    await expect(addPageNumbers(await pdfFile(3, {}), opts({ range: '9' }))).rejects.toThrow(
      /has 3 pages/,
    );
    await expect(addPageNumbers(await pdfFile(3, {}), opts({ range: 'x' }))).rejects.toThrow(
      /not a page or a range/,
    );
  });

  it('rejects nonsense settings before touching the file', async () => {
    const file = await pdfFile(2, {});
    await expect(addPageNumbers(file, opts({ startAt: -1 }))).rejects.toThrow(PageNumberError);
    await expect(addPageNumbers(file, opts({ fontSize: 0 }))).rejects.toThrow(/font size/i);
  });

  it('names a file it cannot read', async () => {
    const bad = new File([new Uint8Array([1, 2, 3])], 'broken.pdf', { type: 'application/pdf' });
    await expect(addPageNumbers(bad, opts())).rejects.toThrow(/broken\.pdf/);
  });

  it('stays fast enough to be worth running in a tab on a long document', async () => {
    const r = await addPageNumbers(await pdfFile(120, {}), opts({ format: 'of-total' }));
    expect(r.numbered).toBe(120);
    expect(r.lastLabel).toBe('120 / 120');
  });

  it('produces a document that reopens as a PDF', async () => {
    const r = await addPageNumbers(await pdfFile(2, {}), opts());
    expect(r.blob.type).toBe('application/pdf');
    expect((await reopen(r.blob)).getPageCount()).toBe(2);
  });

  it('references the standard Helvetica rather than embedding a font', async () => {
    // Embedding would add 100 KB+ to every output file. StandardFonts are referenced by name
    // and rendered from the reader's own copy, which is precisely why the tool is Latin-only
    // and says so. Read from the object graph: the font dict lives in a compressed object
    // stream, so grepping the saved bytes finds nothing either way.
    const doc = await reopen((await addPageNumbers(await pdfFile(1, {}), opts())).blob);
    const dicts = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => obj)
      .filter((obj): obj is PDFDict => obj instanceof PDFDict);

    const fonts = dicts.filter((d) => d.get(PDFName.of('Type'))?.toString() === '/Font');
    expect(fonts).toHaveLength(1);
    expect(fonts[0]?.get(PDFName.of('BaseFont'))?.toString()).toBe(`/${StandardFonts.Helvetica}`);
    // No descriptor carrying actual glyph bytes.
    expect(dicts.some((d) => d.has(PDFName.of('FontFile')))).toBe(false);
    expect(dicts.some((d) => d.has(PDFName.of('FontFile2')))).toBe(false);
    expect(dicts.some((d) => d.has(PDFName.of('FontFile3')))).toBe(false);
  });
});
