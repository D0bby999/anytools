import { describe, expect, it } from 'vitest';
import {
  BARCODE_FORMATS,
  type BarcodeFormatId,
  formatSpec,
  gtinCheckDigit,
  validateBarcodeInput,
} from './logic';

/**
 * The check digits below are published examples, not values this implementation produced:
 * 5901234123457 (GS1's own EAN-13 sample), 96385074 (EAN-8), 036000291452 (a real UPC-A, the
 * Wrigley's gum code used in every textbook), 10614141000415 (GS1's ITF-14 sample). Testing
 * against our own output would only prove the code is self-consistent.
 *
 * `generateBarcode` is not tested here: it fetches a 1.5 MB WASM binary, which happy-dom has no
 * fetch path for. Encoding is verified in the browser lane by generating an EAN-13 and reading
 * it back with qr-barcode-scanner.
 */
describe('gtinCheckDigit', () => {
  it('computes the EAN-13 check digit (weights start at 1 for a 12-digit body)', () => {
    expect(gtinCheckDigit('590123412345')).toBe(7);
    expect(gtinCheckDigit('400638133393')).toBe(1);
  });

  it('computes the EAN-8 check digit (weights start at 3 for a 7-digit body)', () => {
    expect(gtinCheckDigit('9638507')).toBe(4);
  });

  it('computes the UPC-A check digit', () => {
    expect(gtinCheckDigit('03600029145')).toBe(2);
  });

  it('computes the ITF-14 check digit', () => {
    expect(gtinCheckDigit('1061414100041')).toBe(5);
  });

  it('returns 0 when the weighted sum is already a multiple of 10', () => {
    // The (10 - sum % 10) % 10 form matters here: without the outer modulo this returns 10.
    expect(gtinCheckDigit('000000000000')).toBe(0);
  });

  it('refuses anything that is not a digit string', () => {
    expect(() => gtinCheckDigit('59012341234X')).toThrow(/digit/i);
  });
});

describe('validateBarcodeInput — GTIN symbologies', () => {
  it('accepts a correct EAN-13 unchanged', () => {
    expect(validateBarcodeInput('EAN13', '5901234123457')).toEqual({
      ok: true,
      value: '5901234123457',
    });
  });

  it('rejects an EAN-13 whose check digit is wrong, naming the digit expected', () => {
    const r = validateBarcodeInput('EAN13', '5901234123456');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toContain('7');
    expect(r.error).toMatch(/check digit/i);
  });

  it('completes the check digit when 12 digits are given', () => {
    expect(validateBarcodeInput('EAN13', '590123412345')).toEqual({
      ok: true,
      value: '5901234123457',
      note: 'Check digit 7 added.',
      noteCode: 'checkDigitAdded',
      noteParams: { check: 7 },
    });
  });

  it('rejects an EAN-13 of the wrong length', () => {
    const r = validateBarcodeInput('EAN13', '59012341');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toContain('13 digits');
  });

  it('rejects letters in a GTIN', () => {
    const r = validateBarcodeInput('EAN13', '59012341234A7');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toMatch(/digits only/i);
  });

  it('strips the spaces and hyphens people paste out of datasheets', () => {
    expect(validateBarcodeInput('EAN13', '5-901234 123457')).toEqual({
      ok: true,
      value: '5901234123457',
    });
  });

  it('accepts a correct EAN-8 and rejects a wrong one', () => {
    expect(validateBarcodeInput('EAN8', '96385074')).toEqual({ ok: true, value: '96385074' });
    expect(validateBarcodeInput('EAN8', '96385070').ok).toBe(false);
  });

  it('accepts a correct UPC-A and rejects a wrong one', () => {
    expect(validateBarcodeInput('UPCA', '036000291452')).toEqual({
      ok: true,
      value: '036000291452',
    });
    expect(validateBarcodeInput('UPCA', '036000291459').ok).toBe(false);
  });

  it('accepts a correct ITF-14 and rejects a wrong one', () => {
    expect(validateBarcodeInput('ITF14', '10614141000415')).toEqual({
      ok: true,
      value: '10614141000415',
    });
    expect(validateBarcodeInput('ITF14', '10614141000410').ok).toBe(false);
  });
});

describe('validateBarcodeInput — the rest', () => {
  it('requires an even digit count for ITF', () => {
    expect(validateBarcodeInput('ITF', '1234')).toEqual({ ok: true, value: '1234' });
    const odd = validateBarcodeInput('ITF', '12345');
    expect(odd.ok).toBe(false);
    if (odd.ok) throw new Error('unreachable');
    expect(odd.error).toMatch(/even/i);
  });

  it('uppercases Code 39 and says so, and rejects characters outside its alphabet', () => {
    expect(validateBarcodeInput('Code39', 'abc-123')).toEqual({
      ok: true,
      value: 'ABC-123',
      note: 'Code 39 has no lowercase; text was uppercased.',
      noteCode: 'code39Uppercased',
    });
    expect(validateBarcodeInput('Code39', 'ABC@123').ok).toBe(false);
  });

  it('rejects characters Code 128 cannot represent, and keeps the ones it can', () => {
    expect(validateBarcodeInput('Code128', 'SKU-000 rev.2')).toEqual({
      ok: true,
      value: 'SKU-000 rev.2',
    });
    const r = validateBarcodeInput('Code128', 'ラベル');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toMatch(/Data Matrix/);
  });

  it('passes arbitrary text through for the 2D symbologies', () => {
    for (const id of ['DataMatrix', 'PDF417', 'Aztec'] as const) {
      expect(validateBarcodeInput(id, 'ラベル 2026 ✓')).toEqual({
        ok: true,
        value: 'ラベル 2026 ✓',
      });
    }
  });

  it('rejects empty input for every format', () => {
    for (const spec of BARCODE_FORMATS) {
      expect(validateBarcodeInput(spec.id, '').ok, spec.id).toBe(false);
    }
  });
});

describe('BARCODE_FORMATS', () => {
  it('offers no QR code — qr-code-generator owns that, with its templates', () => {
    expect(BARCODE_FORMATS.map((f) => f.id)).not.toContain('QRCode');
  });

  it('has a spec for every id it lists, and throws on an unknown one', () => {
    for (const spec of BARCODE_FORMATS) expect(formatSpec(spec.id)).toBe(spec);
    expect(() => formatSpec('Nope' as BarcodeFormatId)).toThrow(/Unknown barcode format/);
  });
});

describe('validation errors carry a code and params for localization', () => {
  it('names the expected and actual check digit', () => {
    const r = validateBarcodeInput('EAN13', '5901234123456');
    expect(r).toMatchObject({
      ok: false,
      code: 'checkDigitWrong',
      params: { body: '590123412345', want: 7, got: 6 },
    });
  });

  it('carries the format label and digit counts', () => {
    const r = validateBarcodeInput('EAN13', '1234');
    expect(r).toMatchObject({
      ok: false,
      code: 'digitCount',
      params: { format: 'EAN-13', total: 13, body: 12, entered: 4 },
    });
  });

  it('throws a coded error for a bad check-digit body and an unknown format', () => {
    expect(() => gtinCheckDigit('12X')).toThrow(
      expect.objectContaining({ code: 'checkDigitDigitsOnly' }),
    );
    expect(() => formatSpec('Nope' as BarcodeFormatId)).toThrow(
      expect.objectContaining({ code: 'unknownFormat', params: { id: 'Nope' } }),
    );
  });
});
