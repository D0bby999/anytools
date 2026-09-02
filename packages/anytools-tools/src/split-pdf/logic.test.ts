// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PdfSplitError, readPageCount, splitPdf } from './logic';

async function pdfFile(n: number, name = 'report.pdf'): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([100 + i * 10, 400]);
  return new File([(await doc.save()).slice()], name, { type: 'application/pdf' });
}
const widths = async (blob: Blob) => {
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  return doc.getPages().map((p) => Math.round(p.getWidth()));
};

describe('splitPdf', () => {
  it('extracts a single contiguous range as one document', async () => {
    const r = await splitPdf(await pdfFile(6), { kind: 'ranges', range: '2-4' });
    expect(r.parts).toHaveLength(1);
    expect(await widths(r.parts[0]!.blob)).toEqual([110, 120, 130]);
    // One part means no archive to unpack.
    expect(r.zip).toBeUndefined();
  });

  it('splits a gapped range into one document per run', async () => {
    const r = await splitPdf(await pdfFile(12), { kind: 'ranges', range: '1-3, 7, 9-12' });
    expect(r.parts.map((p) => p.pages)).toEqual([3, 1, 4]);
    expect(r.zip).toBeDefined();
  });

  it('names parts by the pages the user sees, one-based', async () => {
    const r = await splitPdf(await pdfFile(12), { kind: 'ranges', range: '1-3, 7' });
    expect(r.parts.map((p) => p.name)).toEqual(['report-p1-3.pdf', 'report-p7.pdf']);
  });

  it('splits every page in "each" mode', async () => {
    const r = await splitPdf(await pdfFile(4), { kind: 'each' });
    expect(r.parts).toHaveLength(4);
    expect(r.parts.every((p) => p.pages === 1)).toBe(true);
    expect(r.parts.map((p) => p.name)).toEqual([
      'report-p1.pdf',
      'report-p2.pdf',
      'report-p3.pdf',
      'report-p4.pdf',
    ]);
  });

  it('preserves page order inside a run', async () => {
    const r = await splitPdf(await pdfFile(6), { kind: 'ranges', range: '4-6' });
    expect(await widths(r.parts[0]!.blob)).toEqual([130, 140, 150]);
  });

  it('produces parts that reopen', async () => {
    const r = await splitPdf(await pdfFile(5), { kind: 'ranges', range: '1-2, 5' });
    for (const part of r.parts) {
      const doc = await PDFDocument.load(await part.blob.arrayBuffer());
      expect(doc.getPageCount()).toBe(part.pages);
    }
  });

  it('rejects a page past the end', async () => {
    await expect(splitPdf(await pdfFile(3), { kind: 'ranges', range: '9' })).rejects.toThrow(
      /does not exist/,
    );
  });

  it('rejects an unreadable file by name', async () => {
    const bad = new File([new Uint8Array([1, 2, 3])], 'broken.pdf', { type: 'application/pdf' });
    await expect(splitPdf(bad, { kind: 'each' })).rejects.toThrow(PdfSplitError);
    await expect(splitPdf(bad, { kind: 'each' })).rejects.toThrow(/broken\.pdf/);
  });

  it('reads a page count without splitting', async () => {
    expect(await readPageCount(await pdfFile(7))).toBe(7);
  });
});
