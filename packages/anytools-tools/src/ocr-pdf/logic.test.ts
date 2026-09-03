// @vitest-environment node
/**
 * The two things that can be wrong in a way nobody sees: the .txt assembly, and where the
 * invisible words land.
 *
 * The layer is invisible by construction, so a broken mapping produces a file that opens fine,
 * looks right and finds nothing — the exact failure mode that needs a test rather than a look.
 * pdf-lib runs in node, so the last test here builds a real one-page PDF, writes a layer onto
 * it, then reads the emitted content stream back and checks the text matrix against the mapping
 * computed by hand. Rendering and recognition need a browser and are covered by the lane.
 */
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { pageFrame } from '../shared/pdf-page-stamp';
import {
  type OcrPdfPage,
  formatPagesText,
  meanPageConfidence,
  outputName,
  renderScale,
} from './logic';
import {
  MIN_LAYER_CONFIDENCE,
  buildSearchablePdf,
  needsUnicodeFont,
  placeWord,
  pointsPerPixel,
} from './searchable-layer';

const page = (n: number, text: string, words = 10, confidence = 90): OcrPdfPage => ({
  pageNumber: n,
  text,
  confidence,
  words,
});

describe('formatPagesText', () => {
  it('marks every page so a long .txt stays navigable', () => {
    expect(formatPagesText([page(1, 'First'), page(2, 'Second')])).toBe(
      '--- Page 1 ---\nFirst\n\n--- Page 2 ---\nSecond',
    );
  });

  it('keeps the real page numbers when a range skipped some', () => {
    expect(formatPagesText([page(3, 'Third'), page(7, 'Seventh')])).toContain('--- Page 7 ---');
  });

  it('still marks a page that produced nothing, rather than dropping it', () => {
    expect(formatPagesText([page(1, '', 0)])).toBe('--- Page 1 ---\n');
  });
});

describe('meanPageConfidence', () => {
  it('weights by words, so a near-blank page cannot swing the number', () => {
    expect(meanPageConfidence([page(1, 'a', 190, 90), page(2, 'b', 10, 40)])).toBeCloseTo(87.5, 5);
  });

  it('is zero when no page produced a word', () => {
    expect(meanPageConfidence([page(1, '', 0, 0)])).toBe(0);
  });
});

describe('renderScale', () => {
  it('is dpi/72 for an ordinary page', () => {
    expect(renderScale(595.28, 841.89, 200)).toBeCloseTo(200 / 72, 10);
  });

  it('reduces rather than exceeding the canvas ceiling on a huge page', () => {
    // A0 is 2384 x 3370 pt; at 200 DPI that would be ~119 megapixels.
    const scale = renderScale(2384, 3370, 200);
    expect(scale).toBeLessThan(200 / 72);
    expect(2384 * scale * (3370 * scale)).toBeLessThanOrEqual(16_777_216 + 1);
  });
});

describe('outputName', () => {
  it('replaces the .pdf extension, case-insensitively', () => {
    expect(outputName('Scan.PDF', 'ocr', 'txt')).toBe('Scan-ocr.txt');
    expect(outputName('report.pdf', 'searchable', 'pdf')).toBe('report-searchable.pdf');
  });
});

describe('placeWord', () => {
  // A 200-DPI render of a 612 x 792 pt page is 1700 x 2200 px, so one pixel is 0.36 pt.
  const scale = 612 / 1700;

  it('flips the origin from top-left pixels to bottom-left points', () => {
    // Box 100..400 across, 200..250 down, on a page 792 pt tall.
    const p = placeWord({ x0: 100, y0: 200, x1: 400, y1: 250 }, scale, 792);
    expect(p.x).toBeCloseTo(36, 6); // 100 px * 0.36
    expect(p.y).toBeCloseTo(792 - 90, 6); // bottom of the box, measured up from the foot
    expect(p.size).toBeCloseTo(18, 6); // 50 px tall
  });

  it('never returns a font size of zero for a degenerate box', () => {
    expect(placeWord({ x0: 5, y0: 5, x1: 5, y1: 5 }, scale, 792).size).toBe(1);
  });
});

describe('pointsPerPixel', () => {
  it('divides the visible width, so a downscaled render still maps correctly', () => {
    const frame = pageFrame({ x: 0, y: 0, width: 612, height: 792 }, 0);
    expect(pointsPerPixel(frame, 1700)).toBeCloseTo(0.36, 10);
    expect(pointsPerPixel(frame, 850)).toBeCloseTo(0.72, 10);
  });

  it('uses the rotated width on a page stored sideways', () => {
    // /Rotate 90 means the reader sees a 792 x 612 page.
    expect(
      pointsPerPixel(pageFrame({ x: 0, y: 0, width: 612, height: 792 }, 90), 2200),
    ).toBeCloseTo(792 / 2200, 10);
  });

  it('returns zero rather than Infinity for an empty image', () => {
    expect(pointsPerPixel(pageFrame({ x: 0, y: 0, width: 612, height: 792 }, 0), 0)).toBe(0);
  });
});

describe('needsUnicodeFont', () => {
  it('is true only for Vietnamese among the staged languages', () => {
    expect(needsUnicodeFont('vie')).toBe(true);
    for (const lang of ['eng', 'spa', 'por'] as const) {
      expect(needsUnicodeFont(lang)).toBe(false);
    }
  });
});

/** Every content stream in a saved document, inflated. */
function contentStreams(bytes: Uint8Array): Promise<string[]> {
  return PDFDocument.load(bytes).then((doc) => {
    const out: string[] = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      let raw: Uint8Array = obj.contents;
      if (String(obj.dict.get(PDFName.of('Filter')) ?? '').includes('FlateDecode')) {
        try {
          raw = new Uint8Array(inflateSync(Buffer.from(raw)));
        } catch {
          continue;
        }
      }
      out.push(Buffer.from(raw).toString('latin1'));
    }
    return out;
  });
}

/** Every `a b c d e f Tm` in a document, as numbers. */
function textMatrices(streams: string[]): number[][] {
  const N = String.raw`(-?[\d.]+(?:e[-+]?\d+)?)`;
  const re = new RegExp(`${N} ${N} ${N} ${N} ${N} ${N} Tm`, 'g');
  return streams.flatMap((s) => [...s.matchAll(re)].map((m) => m.slice(1, 7).map(Number)));
}

/** Every font size set with `Tf`. */
function fontSizes(streams: string[]): number[] {
  return streams.flatMap((s) => [...s.matchAll(/\/\S+ ([\d.]+) Tf/g)].map((m) => Number(m[1])));
}

async function onePagePdf(width: number, height: number): Promise<File> {
  const doc = await PDFDocument.create();
  const p = doc.addPage([width, height]);
  p.drawText('scan stand-in', {
    x: 20,
    y: 20,
    size: 10,
    font: await doc.embedFont(StandardFonts.Helvetica),
  });
  const bytes = await doc.save();
  return new File([bytes.slice()], 'scan.pdf', { type: 'application/pdf' });
}

describe('buildSearchablePdf', () => {
  const words = [
    { text: 'rhinoceros', confidence: 92, bbox: { x0: 100, y0: 200, x1: 400, y1: 250 } },
    { text: 'invoice', confidence: 88, bbox: { x0: 100, y0: 300, x1: 300, y1: 340 } },
  ];

  it('draws each word at the point its pixel box maps to', async () => {
    const file = await onePagePdf(612, 792);
    const { blob, skipped } = await buildSearchablePdf(
      file,
      [{ pageIndex: 0, words, imageWidth: 1700, imageHeight: 2200 }],
      'eng',
    );
    expect(skipped).toBe(0);

    const streams = await contentStreams(new Uint8Array(await blob.arrayBuffer()));
    // Computed independently of the implementation: 612 pt / 1700 px = 0.36 pt per pixel; the
    // page is 792 pt tall; the box bottom (y1) is the baseline.
    const placed = textMatrices(streams).filter(
      (m) => Math.abs((m[0] ?? 0) - 1) < 1e-9 && Math.abs(m[1] ?? 1) < 1e-9,
    );
    const at = (x: number, y: number) =>
      placed.some((m) => Math.abs((m[4] ?? 0) - x) < 1e-6 && Math.abs((m[5] ?? 0) - y) < 1e-6);
    expect(at(100 * 0.36, 792 - 250 * 0.36)).toBe(true);
    expect(at(100 * 0.36, 792 - 340 * 0.36)).toBe(true);

    // Font size is the box height in points: 50 px and 40 px.
    const sizes = fontSizes(streams);
    expect(sizes.some((s) => Math.abs(s - 18) < 1e-6)).toBe(true);
    expect(sizes.some((s) => Math.abs(s - 14.4) < 1e-6)).toBe(true);
  });

  it('keeps the original page and its content', async () => {
    const file = await onePagePdf(612, 792);
    const { blob } = await buildSearchablePdf(
      file,
      [{ pageIndex: 0, words, imageWidth: 1700, imageHeight: 2200 }],
      'eng',
    );
    const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(612, 6);
    const streams = await contentStreams(new Uint8Array(await blob.arrayBuffer()));
    // "scan stand-in" from the original page, as hex — the layer must be added, not replace it.
    const hex = Buffer.from('scan stand-in', 'latin1').toString('hex').toUpperCase();
    expect(streams.some((s) => s.includes(hex))).toBe(true);
  });

  it('drops noise below the confidence floor instead of putting it in the index', async () => {
    const file = await onePagePdf(612, 792);
    const { blob } = await buildSearchablePdf(
      file,
      [
        {
          pageIndex: 0,
          words: [
            {
              text: 'good',
              confidence: MIN_LAYER_CONFIDENCE,
              bbox: { x0: 0, y0: 0, x1: 50, y1: 20 },
            },
            {
              text: 'noise',
              confidence: MIN_LAYER_CONFIDENCE - 1,
              bbox: { x0: 0, y0: 40, x1: 50, y1: 60 },
            },
            { text: '   ', confidence: 99, bbox: { x0: 0, y0: 80, x1: 50, y1: 100 } },
          ],
          imageWidth: 1700,
          imageHeight: 2200,
        },
      ],
      'eng',
    );
    const streams = await contentStreams(new Uint8Array(await blob.arrayBuffer()));
    const layer = streams.join('\n');
    expect(layer).toContain(Buffer.from('good').toString('hex').toUpperCase());
    expect(layer).not.toContain(Buffer.from('noise').toString('hex').toUpperCase());
  });

  it('maps onto the visible frame of a page stored sideways', async () => {
    const doc = await PDFDocument.create();
    const p = doc.addPage([612, 792]);
    p.setRotation(degrees(90));
    const file = new File([(await doc.save()).slice()], 'rot.pdf', { type: 'application/pdf' });

    // With /Rotate 90 the reader sees a 792 x 612 page, so a 2200 px wide render is again
    // 0.36 pt per pixel. Worked by hand: the word lands at visible (36, 612 - 250*0.36 = 522),
    // which is user space (612 - 522, 36) = (90, 36), and the text is turned with the page.
    const { blob } = await buildSearchablePdf(
      file,
      [
        {
          pageIndex: 0,
          words: [
            { text: 'sideways', confidence: 90, bbox: { x0: 100, y0: 200, x1: 400, y1: 250 } },
          ],
          imageWidth: 2200,
          imageHeight: 1700,
        },
      ],
      'eng',
    );
    const [a, b, c, d, e, f] = textMatrices(
      await contentStreams(new Uint8Array(await blob.arrayBuffer())),
    ).at(-1) as number[];
    expect(Math.abs(a ?? 1)).toBeLessThan(1e-9); // cos 90
    expect(b).toBeCloseTo(1, 9); // sin 90
    expect(c).toBeCloseTo(-1, 9);
    expect(Math.abs(d ?? 1)).toBeLessThan(1e-9);
    expect(e).toBeCloseTo(90, 6);
    expect(f).toBeCloseTo(36, 6);
  });

  it('counts words it could not encode instead of failing the whole export', async () => {
    const file = await onePagePdf(612, 792);
    const { blob, skipped } = await buildSearchablePdf(
      file,
      [
        {
          pageIndex: 0,
          words: [
            { text: 'ok', confidence: 90, bbox: { x0: 0, y0: 0, x1: 20, y1: 20 } },
            // Helvetica is WinAnsi; Vietnamese tone marks are outside it.
            { text: 'tiếng', confidence: 90, bbox: { x0: 0, y0: 40, x1: 60, y1: 60 } },
          ],
          imageWidth: 1700,
          imageHeight: 2200,
        },
      ],
      'eng',
    );
    expect(skipped).toBe(1);
    expect((await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()))).getPageCount()).toBe(
      1,
    );
  });
});
