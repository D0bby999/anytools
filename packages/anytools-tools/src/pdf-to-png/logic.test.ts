// The render path needs a real canvas AND a pdf.js worker; happy-dom provides neither, and
// this repo has no browser lane. What IS testable is the arithmetic that decides whether a
// render will succeed — which is also where a wrong answer is silent rather than loud.
// Rendering quality, CMYK colour and transparency are verified BY HAND.
import { describe, expect, it, vi } from 'vitest';
import { MAX_CANVAS_PIXELS, pdfToPng, scaleForDpi } from './logic';

// A stand-in document whose one page is A0, so the ceiling check fires before any canvas is
// touched — the only render-path failure that can be reached without a browser.
vi.mock('../shared/pdfjs-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/pdfjs-loader')>();
  return {
    ...actual,
    openPdf: async () => ({
      numPages: 1,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 2384 * scale,
          height: 3370 * scale,
        }),
        cleanup: () => undefined,
      }),
      destroy: async () => undefined,
    }),
  };
});

describe('pdfToPng', () => {
  it('carries a code and params so the widget can localize the message', async () => {
    const file = new File([new Uint8Array([1])], 'plan.pdf', { type: 'application/pdf' });
    await expect(pdfToPng(file, 300)).rejects.toMatchObject({
      code: 'pageTooLargeAtDpi',
      params: { page: 1, dpi: 300, width: 9933, height: 14042 },
    });
  });
});

describe('scaleForDpi', () => {
  it('treats PDF user space as 72 units per inch', () => {
    expect(scaleForDpi(72)).toBe(1);
    expect(scaleForDpi(150)).toBeCloseTo(2.0833, 4);
    expect(scaleForDpi(300)).toBeCloseTo(4.1667, 4);
  });

  it('renders A4 within the canvas ceiling at every offered DPI', () => {
    // A4 is 595x842 points. At 300 DPI that is ~2480x3508 = 8.7 MP — under the limit.
    const [w, h] = [595, 842];
    for (const dpi of [72, 150, 300] as const) {
      const s = scaleForDpi(dpi);
      expect(w * s * (h * s)).toBeLessThan(MAX_CANVAS_PIXELS);
    }
  });

  it('flags A0 at 300 DPI as past the ceiling', () => {
    // A0 is 2384x3370 points -> ~139 MP at 300 DPI. Browsers return a BLANK canvas rather
    // than an error, so this has to be caught by arithmetic before anything is drawn.
    const s = scaleForDpi(300);
    expect(2384 * s * (3370 * s)).toBeGreaterThan(MAX_CANVAS_PIXELS);
  });
});
