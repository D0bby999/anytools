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

/** A rectangle as pdf-lib's setters take it: lower-left corner plus extent. */
type Box = [x: number, y: number, width: number, height: number];

/**
 * A real PDF. `rotate` sets /Rotate on the page at that index, as a scanner would.
 *
 * `mediaBox` and `cropBox` apply to every page. Both matter: `addPage([w, h])` always produces a
 * media box anchored at the origin, which is the one case where dropping the box origin cannot
 * be noticed.
 */
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

  // --- box origins ---------------------------------------------------------------------------
  //
  // `page.getSize()` returns only the media box's WIDTH and HEIGHT, so a page whose box does not
  // start at the origin — [100 200 695 1042], what a trimmed or imposed page looks like — used to
  // be stamped as if it started at (0, 0), putting the label 100 pt left and 200 pt below the
  // sheet: off the page, with no error. The CropBox is worse, because that is the box readers
  // actually display; a label inside the media box but outside the crop box is simply invisible.
  //
  // Every number below is derived by hand from the mapping in shared/pdf-page-stamp.ts and
  // written out in the comments, so a wrong formula cannot be "confirmed" by re-deriving it from
  // itself. All four rotations, because each one uses a different pair of box edges.

  describe('a media box that does not start at the origin', () => {
    // MediaBox [100 200 695 1042]: origin (100, 200), 595 x 842. Bottom-left label, margin 36,
    // so the visible point is (36, 36) and the media-box extent is w=595, h=842.
    //   /Rotate 0   → (bx + x, by + y)          = (100 + 36, 200 + 36)         = (136, 236)
    //   /Rotate 90  → (bx + w - y, by + x)      = (100 + 595 - 36, 200 + 36)   = (659, 236)
    //   /Rotate 180 → (bx + w - x, by + h - y)  = (659, 200 + 842 - 36)        = (659, 1006)
    //   /Rotate 270 → (bx + y, by + h - x)      = (136, 1006)
    const expected: Record<number, { x: number; y: number }> = {
      0: { x: 136, y: 236 },
      90: { x: 659, y: 236 },
      180: { x: 659, y: 1006 },
      270: { x: 136, y: 1006 },
    };

    for (const rotation of [0, 90, 180, 270]) {
      it(`stamps inside the box at /Rotate ${rotation}`, async () => {
        const file = await pdfFile(1, {
          mediaBox: [100, 200, 595, 842],
          rotate: { 0: rotation },
        });
        const r = await addPageNumbers(file, opts({ position: 'bottom-left' }));
        const t = drawnText(await reopen(r.blob), 0)[0];

        expect(t?.x).toBeCloseTo(expected[rotation]?.x as number, 4);
        expect(t?.y).toBeCloseTo(expected[rotation]?.y as number, 4);
        // atan2 reports a quarter turn anticlockwise as -90, hence the normalisation.
        expect((((t?.angle ?? 0) % 360) + 360) % 360).toBe(rotation);
        // And, independently of the arithmetic above: on the sheet at all.
        expect(t?.x).toBeGreaterThanOrEqual(100);
        expect(t?.x).toBeLessThanOrEqual(695);
        expect(t?.y).toBeGreaterThanOrEqual(200);
        expect(t?.y).toBeLessThanOrEqual(1042);
      });
    }
  });

  describe('a crop box smaller than the media box', () => {
    // MediaBox [0 0 595 842], CropBox [50 50 545 792]: origin (50, 50), 495 x 742. Same visible
    // point (36, 36); the frame is now the CROP box, so w=495, h=742.
    //   /Rotate 0   → (50 + 36, 50 + 36)                    = (86, 86)
    //   /Rotate 90  → (50 + 495 - 36, 50 + 36)              = (509, 86)
    //   /Rotate 180 → (50 + 495 - 36, 50 + 742 - 36)        = (509, 756)
    //   /Rotate 270 → (50 + 36, 50 + 742 - 36)              = (86, 756)
    const expected: Record<number, { x: number; y: number }> = {
      0: { x: 86, y: 86 },
      90: { x: 509, y: 86 },
      180: { x: 509, y: 756 },
      270: { x: 86, y: 756 },
    };

    for (const rotation of [0, 90, 180, 270]) {
      it(`stamps inside the visible area at /Rotate ${rotation}`, async () => {
        const file = await pdfFile(1, { cropBox: [50, 50, 495, 742], rotate: { 0: rotation } });
        const r = await addPageNumbers(file, opts({ position: 'bottom-left' }));
        const t = drawnText(await reopen(r.blob), 0)[0];

        expect(t?.x).toBeCloseTo(expected[rotation]?.x as number, 4);
        expect(t?.y).toBeCloseTo(expected[rotation]?.y as number, 4);
        // atan2 reports a quarter turn anticlockwise as -90, hence the normalisation.
        expect((((t?.angle ?? 0) % 360) + 360) % 360).toBe(rotation);
        // Inside the crop box, not merely inside the media box — the media box would accept
        // (36, 36), which the reader never shows.
        expect(t?.x).toBeGreaterThanOrEqual(50);
        expect(t?.x).toBeLessThanOrEqual(545);
        expect(t?.y).toBeGreaterThanOrEqual(50);
        expect(t?.y).toBeLessThanOrEqual(792);
      });
    }

    it('measures a right-aligned label against the crop box edge', async () => {
      // Right alignment is the case that needs the frame's WIDTH as well as its origin: the
      // label's right edge must sit one margin in from the crop box's right edge, 545 - 36 = 509.
      const file = await pdfFile(1, { cropBox: [50, 50, 495, 742] });
      const r = await addPageNumbers(file, opts({ position: 'top-right' }));
      const t = drawnText(await reopen(r.blob), 0)[0];

      const probe = await PDFDocument.create();
      const font = await probe.embedFont(StandardFonts.Helvetica);
      const width = font.widthOfTextAtSize('1', 12);
      const ascent = font.heightAtSize(12, { descender: false });

      expect((t?.x as number) + width).toBeCloseTo(509, 4);
      expect((t?.y as number) + ascent).toBeCloseTo(792 - 36, 4);
    });
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

  it('refuses a fractional starting number rather than printing "1.5"', async () => {
    // A number input accepts typed decimals whatever its step says, and the page after 1.5 was
    // 2.5. Page numbers are whole or they are not page numbers.
    const file = await pdfFile(2, {});
    await expect(addPageNumbers(file, opts({ startAt: 1.5 }))).rejects.toThrow(/whole number/);
    await expect(addPageNumbers(file, opts({ startAt: Number.NaN }))).rejects.toThrow(
      PageNumberError,
    );
    await expect(addPageNumbers(file, opts({ startAt: 0 }))).resolves.toBeTruthy();
  });

  it('names a file it cannot read', async () => {
    const bad = new File([new Uint8Array([1, 2, 3])], 'broken.pdf', { type: 'application/pdf' });
    await expect(addPageNumbers(bad, opts())).rejects.toThrow(/broken\.pdf/);
  });

  it('stays fast enough to be worth running in a tab on a long document', async () => {
    // The name used to be the whole test: it numbered 120 pages and asserted only the labels,
    // so any amount of time would have passed. Measure it. The budget is deliberately loose —
    // 120 pages takes tens of milliseconds here, so 4 seconds is ~100x headroom and will not
    // flake on a loaded CI runner, while still catching the accident that matters: embedding
    // the font (or reopening the document) per page, which is quadratic and lands in minutes.
    const file = await pdfFile(120, {});
    const started = performance.now();
    const r = await addPageNumbers(file, opts({ format: 'of-total' }));
    const elapsed = performance.now() - started;

    expect(r.numbered).toBe(120);
    expect(r.lastLabel).toBe('120 / 120');
    expect(elapsed).toBeLessThan(4000);
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
