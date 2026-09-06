// @vitest-environment node
// Cross-library check. pdf-password is the one tool built on @cantoo/pdf-lib; the other ten
// PDF tools use plain pdf-lib 1.17.1, and the two are deliberately kept side by side (the fork
// silently encodes CJK that the original refuses — see the batch plan's Phase 0). A test written
// only against @cantoo could pass while producing a file nothing else in this repo can read, so
// the assertions here are made with pdf-lib: it must REFUSE the locked output and ACCEPT the
// unlocked one.
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { lockPdf, unlockPdf } from './logic';

const bytes = readFileSync(new URL('../../fixtures/text-3p.pdf', import.meta.url));
const source = () => new File([bytes], 'text-3p.pdf', { type: 'application/pdf' });

describe('pdf-password against plain pdf-lib', () => {
  it('locks so plain pdf-lib refuses it, then unlocks so plain pdf-lib accepts it', async () => {
    const locked = await lockPdf(source(), {
      userPassword: 'secret',
      ownerPassword: 'owner',
      permissions: {},
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
