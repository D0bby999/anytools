// @vitest-environment node
// pdf-lib runs fine under node and this file touches no DOM. The package default is
// happy-dom, where File/Blob differ subtly from node's — pinning the environment keeps
// the fixtures honest.
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PdfMergeError, mergePdfs } from './logic';

/** A real PDF of `n` pages, each a different size so order is observable. */
async function pdfFile(name: string, n: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([200 + i, 400]);
  const bytes = await doc.save();
  return new File([bytes.slice()], name, { type: 'application/pdf' });
}

describe('mergePdfs', () => {
  it('concatenates page counts', async () => {
    const r = await mergePdfs([await pdfFile('a.pdf', 2), await pdfFile('b.pdf', 3)]);
    expect(r.pages).toBe(5);
    expect(r.sources).toEqual([
      { name: 'a.pdf', pages: 2 },
      { name: 'b.pdf', pages: 3 },
    ]);
  });

  it('preserves the order it was given', async () => {
    // Page widths are 200,201 for a and 200,201,202 for b. Merged a-then-b the third page
    // is b's first (200 wide); merged b-then-a it is b's third (202 wide).
    const a = await pdfFile('a.pdf', 2);
    const b = await pdfFile('b.pdf', 3);
    const ab = await PDFDocument.load(await (await mergePdfs([a, b])).blob.arrayBuffer());
    const ba = await PDFDocument.load(await (await mergePdfs([b, a])).blob.arrayBuffer());
    expect(Math.round(ab.getPage(2).getWidth())).toBe(200);
    expect(Math.round(ba.getPage(2).getWidth())).toBe(202);
  });

  it('produces a document that reopens', async () => {
    const r = await mergePdfs([await pdfFile('a.pdf', 1), await pdfFile('b.pdf', 1)]);
    const reopened = await PDFDocument.load(await r.blob.arrayBuffer());
    expect(reopened.getPageCount()).toBe(2);
    expect(r.blob.type).toBe('application/pdf');
  });

  it('handles many inputs', async () => {
    const files = await Promise.all(Array.from({ length: 10 }, (_, i) => pdfFile(`f${i}.pdf`, 2)));
    expect((await mergePdfs(files)).pages).toBe(20);
  });

  it('refuses a single file — merging one PDF is a no-op, not a result', async () => {
    await expect(mergePdfs([await pdfFile('a.pdf', 1)])).rejects.toThrow(PdfMergeError);
    await expect(mergePdfs([])).rejects.toThrow(/at least two/i);
  });

  it('names the file that could not be read', async () => {
    const bad = new File([new Uint8Array([1, 2, 3])], 'broken.pdf', { type: 'application/pdf' });
    await expect(mergePdfs([await pdfFile('ok.pdf', 1), bad])).rejects.toThrow(/broken\.pdf/);
  });
});
