// @vitest-environment node
import { PDFDocument } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { PdfPasswordError, inspectLockedPdf, lockPdf, unlockPdf } from './logic';

async function pdfFile(n: number, name = 'doc.pdf'): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([100 + i * 10, 400]);
  return new File([(await doc.save()).slice()], name, { type: 'application/pdf' });
}

async function lockedPdfFile(
  n: number,
  password: string,
  opts: { withFormField?: boolean } = {},
): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const page = doc.addPage([100 + i * 10, 400]);
    if (opts.withFormField && i === 0) {
      const form = doc.getForm();
      const field = form.createTextField(`field-${i}`);
      field.addToPage(page, { x: 10, y: 10, width: 80, height: 20 });
    }
  }
  doc.encrypt({ userPassword: password, ownerPassword: `${password}-owner` });
  return new File([(await doc.save()).slice()], 'locked.pdf', { type: 'application/pdf' });
}

const allowAll = { printing: true, copying: true, modifying: true, annotating: true };

describe('lockPdf', () => {
  it('produces a file that rejects opening without a password', async () => {
    const r = await lockPdf(await pdfFile(3), { userPassword: 'secret', permissions: allowAll });
    await expect(PDFDocument.load(await r.blob.arrayBuffer())).rejects.toThrow(/encrypted/i);
    expect(r.pages).toBe(3);
  });

  it('opens with the user password and keeps every page', async () => {
    const r = await lockPdf(await pdfFile(4), { userPassword: 'secret', permissions: allowAll });
    const opened = await PDFDocument.load(await r.blob.arrayBuffer(), { password: 'secret' });
    expect(opened.getPageCount()).toBe(4);
  });

  it('also opens with the owner password when one is set', async () => {
    const r = await lockPdf(await pdfFile(2), {
      userPassword: 'secret',
      ownerPassword: 'boss',
      permissions: allowAll,
    });
    const opened = await PDFDocument.load(await r.blob.arrayBuffer(), { password: 'boss' });
    expect(opened.getPageCount()).toBe(2);
  });

  it('rejects a blank password before touching the file', async () => {
    await expect(
      lockPdf(await pdfFile(1), { userPassword: '  ', permissions: allowAll }),
    ).rejects.toMatchObject({ code: 'passwordRequired' });
  });

  it('refuses to double-lock an already-encrypted file', async () => {
    const already = await lockedPdfFile(1, 'first');
    await expect(
      lockPdf(already, { userPassword: 'second', permissions: allowAll }),
    ).rejects.toMatchObject({ code: 'alreadyLocked' });
  });

  it('rejects a file that is not a PDF at all', async () => {
    const junk = new File([new Uint8Array([1, 2, 3, 4])], 'junk.pdf', { type: 'application/pdf' });
    await expect(
      lockPdf(junk, { userPassword: 'secret', permissions: allowAll }),
    ).rejects.toMatchObject({ code: 'pdfUnreadable' });
  });
});

describe('unlockPdf', () => {
  it('removes the password — the result reopens with no password needed', async () => {
    const r = await unlockPdf(await lockedPdfFile(3, 'secret'), 'secret');
    expect(r.pages).toBe(3);
    const reopened = await PDFDocument.load(await r.blob.arrayBuffer());
    expect(reopened.getPageCount()).toBe(3);
  });

  it('accepts the owner password too', async () => {
    const r = await unlockPdf(await lockedPdfFile(2, 'secret'), 'secret-owner');
    expect(r.pages).toBe(2);
  });

  it('rejects the wrong password without leaking the library error', async () => {
    const locked = await lockedPdfFile(1, 'secret');
    await expect(unlockPdf(locked, 'nope')).rejects.toMatchObject({ code: 'wrongPassword' });
  });

  it('rejects a blank password', async () => {
    const locked = await lockedPdfFile(1, 'secret');
    await expect(unlockPdf(locked, '   ')).rejects.toMatchObject({
      code: 'unlockPasswordRequired',
    });
  });

  it('carries a PdfPasswordError with params the widget can localize', async () => {
    const locked = await lockedPdfFile(1, 'secret', { withFormField: false });
    try {
      await unlockPdf(locked, 'wrong');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PdfPasswordError);
      expect((e as PdfPasswordError).params).toMatchObject({ name: 'locked.pdf' });
    }
  });
});

describe('inspectLockedPdf', () => {
  it('reports zero fields for a plain document', async () => {
    const info = await inspectLockedPdf(await lockedPdfFile(2, 'secret'), 'secret');
    expect(info).toEqual({ pages: 2, fieldCount: 0 });
  });

  it('detects a form field before the lossy unlock step runs', async () => {
    const info = await inspectLockedPdf(
      await lockedPdfFile(2, 'secret', { withFormField: true }),
      'secret',
    );
    expect(info.pages).toBe(2);
    expect(info.fieldCount).toBe(1);
  });

  it('rejects the wrong password the same way unlockPdf does', async () => {
    const locked = await lockedPdfFile(1, 'secret');
    await expect(inspectLockedPdf(locked, 'nope')).rejects.toMatchObject({
      code: 'wrongPassword',
    });
  });
});
