/**
 * Barcode encoding, and the check-digit arithmetic that has to happen before it.
 *
 * Everything above `generateBarcode` is pure and unit-tested. That split is deliberate: zint
 * (inside zxing-wasm) rejects a bad EAN-13 with a terse internal message, and a retail barcode
 * with a wrong final digit is the single most common mistake here — the user usually typed the
 * 12-digit product number and expected the 13th to be worked out. So the check digit is computed
 * in JS, before the WASM is even fetched, and the error names the digit that was expected.
 *
 * No QR code here on purpose — qr-code-generator already does that, with templates for Wi-Fi,
 * vCard and email that a raw "encode this string" box cannot offer.
 */
import { ToolError } from '../shared/tool-error';
import { type WriterOptions, writeBarcode } from '../shared/zxing-loader';

export type BarcodeFormatId =
  | 'EAN13'
  | 'EAN8'
  | 'UPCA'
  | 'ITF14'
  | 'ITF'
  | 'Code128'
  | 'Code39'
  | 'DataMatrix'
  | 'PDF417'
  | 'Aztec';

export type BarcodeFormatSpec = {
  id: BarcodeFormatId;
  label: string;
  /** Total digits including the trailing check digit. Undefined for free-text symbologies. */
  digits?: number;
  hint: string;
};

export const BARCODE_FORMATS: readonly BarcodeFormatSpec[] = [
  { id: 'EAN13', label: 'EAN-13', digits: 13, hint: '13 digits (or 12 — we add the check digit)' },
  { id: 'EAN8', label: 'EAN-8', digits: 8, hint: '8 digits (or 7 — we add the check digit)' },
  { id: 'UPCA', label: 'UPC-A', digits: 12, hint: '12 digits (or 11 — we add the check digit)' },
  { id: 'ITF14', label: 'ITF-14', digits: 14, hint: '14 digits (or 13 — we add the check digit)' },
  { id: 'ITF', label: 'ITF (Interleaved 2 of 5)', hint: 'digits, an even number of them' },
  { id: 'Code128', label: 'Code 128', hint: 'any ASCII text' },
  { id: 'Code39', label: 'Code 39', hint: 'A–Z, 0–9, space and - . $ / + %' },
  { id: 'DataMatrix', label: 'Data Matrix', hint: 'any text' },
  { id: 'PDF417', label: 'PDF417', hint: 'any text' },
  { id: 'Aztec', label: 'Aztec', hint: 'any text' },
] as const;

/** Symbologies whose last digit is a GTIN mod-10 check digit. */
const GTIN_FORMATS: ReadonlySet<BarcodeFormatId> = new Set(['EAN13', 'EAN8', 'UPCA', 'ITF14']);

const CODE39_ALPHABET = /^[0-9A-Z\-. $/+%]*$/;

/**
 * GS1 mod-10 check digit for the body of a GTIN (the code WITHOUT its final digit).
 *
 * Weights alternate 3 and 1 from the right, so they depend on the body's length rather than on
 * the symbology: EAN-13's 12-digit body starts at weight 1, EAN-8's 7-digit body starts at 3.
 * Deriving it from the length is why one function covers EAN-8, EAN-13, UPC-A and ITF-14 rather
 * than four near-copies that each get the phase wrong in their own way.
 */
export function gtinCheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) {
    throw new ToolError('checkDigitDigitsOnly', 'Check digits are only defined for digit strings');
  }
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(i) - 48;
    sum += digit * ((body.length - i) % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export type ValidationParams = Record<string, string | number>;

/**
 * `error` and `note` are the English text (asserted by tests); `code`/`noteCode` plus the params
 * they were built from let a widget render the same message in the page's language.
 */
export type ValidationResult =
  | { ok: true; value: string; note?: string; noteCode?: string; noteParams?: ValidationParams }
  | { ok: false; error: string; code: string; params?: ValidationParams };

export function formatSpec(id: BarcodeFormatId): BarcodeFormatSpec {
  const spec = BARCODE_FORMATS.find((f) => f.id === id);
  if (!spec) throw new ToolError('unknownFormat', `Unknown barcode format: ${id}`, { id });
  return spec;
}

/**
 * Check the input against the symbology's rules, completing a GTIN check digit when the user
 * supplied the body only. Returns the exact string to hand to the encoder.
 */
export function validateBarcodeInput(format: BarcodeFormatId, raw: string): ValidationResult {
  const spec = formatSpec(format);
  // Retail codes are routinely pasted with spaces or hyphens from a datasheet; strip them for
  // the digit-only symbologies, and only for those. Code 39 and Code 128 encode spaces.
  const value = GTIN_FORMATS.has(format) || format === 'ITF' ? raw.replace(/[\s-]/g, '') : raw;

  if (!value) return { ok: false, error: 'Enter the data to encode.', code: 'enterData' };

  if (GTIN_FORMATS.has(format)) {
    const total = spec.digits as number;
    if (!/^\d+$/.test(value)) {
      return {
        ok: false,
        error: `${spec.label} holds digits only — no letters or punctuation.`,
        code: 'digitsOnly',
        params: { format: spec.label },
      };
    }
    if (value.length === total - 1) {
      const check = gtinCheckDigit(value);
      return {
        ok: true,
        value: value + check,
        note: `Check digit ${check} added.`,
        noteCode: 'checkDigitAdded',
        noteParams: { check },
      };
    }
    if (value.length !== total) {
      return {
        ok: false,
        error: `${spec.label} needs ${total} digits (or ${total - 1} and we work out the last one). You entered ${value.length}.`,
        code: 'digitCount',
        params: { format: spec.label, total, body: total - 1, entered: value.length },
      };
    }
    const body = value.slice(0, -1);
    const want = gtinCheckDigit(body);
    const got = value.charCodeAt(value.length - 1) - 48;
    if (want !== got) {
      return {
        ok: false,
        error: `Check digit is wrong: ${body} ends in ${want}, not ${got}. Scanners reject this code.`,
        code: 'checkDigitWrong',
        params: { body, want, got },
      };
    }
    return { ok: true, value };
  }

  if (format === 'ITF') {
    if (!/^\d+$/.test(value)) {
      return { ok: false, error: 'ITF holds digits only.', code: 'itfDigitsOnly' };
    }
    if (value.length % 2 !== 0) {
      return {
        ok: false,
        error: `ITF encodes digits in pairs, so it needs an even count. You entered ${value.length}.`,
        code: 'itfEvenCount',
        params: { entered: value.length },
      };
    }
    return { ok: true, value };
  }

  if (format === 'Code39') {
    const upper = value.toUpperCase();
    if (!CODE39_ALPHABET.test(upper)) {
      return {
        ok: false,
        error: 'Code 39 only carries A–Z, 0–9, space and - . $ / + % — nothing else.',
        code: 'code39Alphabet',
      };
    }
    return upper === value
      ? { ok: true, value }
      : {
          ok: true,
          value: upper,
          note: 'Code 39 has no lowercase; text was uppercased.',
          noteCode: 'code39Uppercased',
        };
  }

  if (format === 'Code128') {
    // Code 128 is byte-oriented over Latin-1. Anything above U+00FF cannot be represented at
    // all, and zint's failure for it is opaque. Data Matrix, PDF417 and Aztec take Unicode.
    const bad = [...value].find((c) => (c.codePointAt(0) ?? 0) > 0xff);
    if (bad) {
      return {
        ok: false,
        error: `Code 128 cannot encode "${bad}". Use Data Matrix, PDF417 or Aztec for text outside Latin-1.`,
        code: 'code128Latin1',
        params: { char: bad },
      };
    }
    return { ok: true, value };
  }

  return { ok: true, value };
}

export type BarcodeRenderOptions = {
  /** Module size in pixels; drives the PNG's resolution. zxing calls this `scale`. */
  scale?: number;
  /** Quiet zone — the mandatory white margin. Off makes an unscannable but tidy image. */
  quietZone?: boolean;
  /** Print the encoded value under the bars (HRI). Ignored by the 2D symbologies. */
  humanReadable?: boolean;
};

export type GeneratedBarcode = {
  format: BarcodeFormatId;
  /** The value actually encoded — may differ from the input (completed check digit, uppercased). */
  value: string;
  svg: string;
  png: Blob;
};

/**
 * Validate, then encode. Throws with the validation message when the input is not encodable, so
 * a caller that forgets to check gets the useful error rather than zint's.
 */
export async function generateBarcode(
  format: BarcodeFormatId,
  raw: string,
  options: BarcodeRenderOptions = {},
): Promise<GeneratedBarcode> {
  const checked = validateBarcodeInput(format, raw);
  if (!checked.ok) throw new ToolError(checked.code, checked.error, checked.params);

  const writerOptions: WriterOptions = {
    format,
    scale: Math.min(32, Math.max(1, Math.round(options.scale ?? 4))),
    addQuietZones: options.quietZone !== false,
    addHRT: options.humanReadable === true,
  };
  const { svg, png } = await writeBarcode(checked.value, writerOptions);
  return { format, value: checked.value, svg, png };
}
