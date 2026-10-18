// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PdfRemoveError, removePdfPages } from './logic';

/** n pages, each a distinct width so a page can be identified after the fact. */
async function pdfFile(n: number, name = 'doc.pdf'): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([100 + i * 10, 400]);
  return new File([(await doc.save()).slice()], name, { type: 'application/pdf' });
}
const widths = async (blob: Blob) => {
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  return doc.getPages().map((p) => Math.round(p.getWidth()));
};

describe('removePdfPages', () => {
  it('removes the pages the user named, not their neighbours', async () => {
    // The regression this test exists for. Pages are 100,110,120,130,140,150 wide.
    // Removing 1,3,5 (indices 0,2,4) must leave 110,130,150. Deleting low-to-high
    // instead removes 100, then what is NOW index 2 (originally 130), then 150 —
    // leaving 110,120,140 and looking plausible enough to ship.
    const r = await removePdfPages(await pdfFile(6), '1, 3, 5');
    expect(await widths(r.blob)).toEqual([110, 130, 150]);
    expect(r.pages).toBe(3);
    expect(r.removed).toBe(3);
  });

  it('removes a contiguous range', async () => {
    const r = await removePdfPages(await pdfFile(6), '2-4');
    expect(await widths(r.blob)).toEqual([100, 140, 150]);
  });

  it('removes the last page', async () => {
    expect(await widths((await removePdfPages(await pdfFile(3), '3')).blob)).toEqual([100, 110]);
  });

  it('removes the first page', async () => {
    expect(await widths((await removePdfPages(await pdfFile(3), '1')).blob)).toEqual([110, 120]);
  });

  it('treats a duplicated page number as one removal', async () => {
    const r = await removePdfPages(await pdfFile(4), '2, 2, 2');
    expect(r.removed).toBe(1);
    expect(await widths(r.blob)).toEqual([100, 120, 130]);
  });

  it('refuses to empty the document', async () => {
    await expect(removePdfPages(await pdfFile(3), '1-3')).rejects.toThrow(PdfRemoveError);
    await expect(removePdfPages(await pdfFile(3), '1-3')).rejects.toThrow(/at least one page/i);
  });

  it('rejects a page past the end', async () => {
    await expect(removePdfPages(await pdfFile(3), '5')).rejects.toThrow(/does not exist/);
  });

  it('carries a code and params so the widget can localize the message', async () => {
    await expect(removePdfPages(await pdfFile(3), '1-3')).rejects.toMatchObject({
      code: 'removeAllPages',
    });
    await expect(removePdfPages(await pdfFile(3), '5')).rejects.toMatchObject({
      code: 'pageOutOfRange',
      params: { page: 5, count: 3 },
    });
  });

  it('produces a document that reopens', async () => {
    const r = await removePdfPages(await pdfFile(5), '2');
    expect((await PDFDocument.load(await r.blob.arrayBuffer())).getPageCount()).toBe(4);
  });
});
