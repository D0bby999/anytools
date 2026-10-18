// @vitest-environment node
// Cross-library check. pdf-password is the one tool built on @cantoo/pdf-lib; the other ten
// PDF tools use plain pdf-lib 1.17.1, and the two are deliberately kept side by side (the fork
// silently encodes CJK that the original refuses — see the batch plan's Phase 0). A test written
// only against @cantoo could pass while producing a file nothing else in this repo can read, so
// the assertions here are made with pdf-lib: it must REFUSE the locked output and ACCEPT the
// unlocked one.
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { lockPdf, unlockPdf } from './logic';

// The old repo's fixtures/text-3p.pdf was generated (scripts/make-fixtures.mjs) and gitignored.
// This builds the same three pages, the second one rotated, in the test instead.
async function textThreePages(): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Fixture text-3p — page ${i} of 3`, { x: 60, y: 760, size: 24, font });
    page.drawText('The quick brown fox jumps over the lazy dog.', { x: 60, y: 720, size: 12, font });
    if (i === 2) page.setRotation(degrees(90));
  }
  return (await doc.save()) as Uint8Array<ArrayBuffer>;
}

const bytes = await textThreePages();
const source = () => new File([bytes], 'text-3p.pdf', { type: 'application/pdf' });

describe('pdf-password against plain pdf-lib', () => {
  it('locks so plain pdf-lib refuses it, then unlocks so plain pdf-lib accepts it', async () => {
    const locked = await lockPdf(source(), {
      userPassword: 'secret',
      ownerPassword: 'owner',
      permissions: { printing: true, copying: false, modifying: false, annotating: false },
    });
    const lockedBytes = new Uint8Array(await locked.blob.arrayBuffer());
    expect(Buffer.from(lockedBytes).includes(Buffer.from('/Encrypt'))).toBe(true);
    await expect(PDFDocument.load(lockedBytes)).rejects.toThrow();

    const lockedFile = new File([lockedBytes], 'locked.pdf', { type: 'application/pdf' });
    await expect(unlockPdf(lockedFile, 'wrong-one')).rejects.toThrow();

    const freed = await unlockPdf(lockedFile, 'secret');
    const freedBytes = new Uint8Array(await freed.blob.arrayBuffer());
    const reopened = await PDFDocument.load(freedBytes);
    expect(reopened.getPageCount()).toBe(3);
    expect(Buffer.from(freedBytes).includes(Buffer.from('/Encrypt'))).toBe(false);
  });
});
