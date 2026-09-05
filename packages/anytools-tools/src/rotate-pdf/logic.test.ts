// @vitest-environment node
import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { rotatePdf } from './logic';

async function pdfFile(n: number, preset: number[] = []): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([200, 400]);
    if (preset[i] !== undefined) page.setRotation(degrees(preset[i] as number));
  }
  return new File([(await doc.save()).slice()], 'doc.pdf', { type: 'application/pdf' });
}
const angles = async (blob: Blob) => {
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  return doc.getPages().map((p) => p.getRotation().angle);
};

describe('rotatePdf', () => {
  it('rotates every page when no range is given', async () => {
    expect(await angles((await rotatePdf(await pdfFile(3), 90)).blob)).toEqual([90, 90, 90]);
  });

  it('rotates only the pages in the range', async () => {
    const r = await rotatePdf(await pdfFile(4), 180, '2-3');
    expect(await angles(r.blob)).toEqual([0, 180, 180, 0]);
    expect(r.rotated).toBe(2);
  });

  it('adds to an existing rotation instead of replacing it', async () => {
    // A scanner that saved pages at 270 is the common case. Assigning rather than adding
    // would silently undo that correction while looking like it worked.
    expect(await angles((await rotatePdf(await pdfFile(2, [270, 90]), 90)).blob)).toEqual([0, 180]);
  });

  it('wraps past 360 rather than storing 450', async () => {
    expect(await angles((await rotatePdf(await pdfFile(1, [180]), 270)).blob)).toEqual([90]);
  });

  it('normalises a negative starting rotation', async () => {
    expect(await angles((await rotatePdf(await pdfFile(1, [-90]), 90)).blob)).toEqual([0]);
  });

  it('is a no-op for the document when the range names one page', async () => {
    const r = await rotatePdf(await pdfFile(5), 90, '3');
    expect(r.pages).toBe(5);
    expect(r.rotated).toBe(1);
    expect(await angles(r.blob)).toEqual([0, 0, 90, 0, 0]);
  });

  it('rejects a page past the end', async () => {
    await expect(rotatePdf(await pdfFile(2), 90, '7')).rejects.toThrow(/does not exist/);
  });

  it('carries a code and params so the widget can localize the message', async () => {
    const bad = new File([new Uint8Array([1, 2, 3])], 'broken.pdf', { type: 'application/pdf' });
    await expect(rotatePdf(bad, 90)).rejects.toMatchObject({
      code: 'pdfUnreadable',
      params: { name: 'broken.pdf' },
    });
    await expect(rotatePdf(await pdfFile(2), 90, '7')).rejects.toMatchObject({
      code: 'pageOutOfRange',
      params: { page: 7, count: 2 },
    });
  });
});
