/**
 * Decode barcodes out of an image, and make sense of what the payload turns out to be.
 *
 * The payload parsers are pure and tested; the decode path needs a canvas and the WASM engine and
 * is checked in the browser lane. They are split because a QR code's *text* is rarely what a
 * person wants — a Wi-Fi code is a structured record with escaping rules, and `WIFI:T:WPA;S:my
 * \;cafe;P:hunter2;;` shown raw is a worse answer than the SSID and password in two fields.
 *
 * The formats parsed here are exactly the ones qr-code-generator emits, so a code made on this
 * site reads back into the same fields it was built from.
 */
import { fitWithin, loadBitmap } from '../shared/canvas-image';
import { type ReadResult, readBarcodes } from '../shared/zxing-loader';

/**
 * Longest edge handed to the decoder.
 *
 * zxing scans at full resolution, and a 48-megapixel phone photo takes tens of seconds — long
 * enough that people conclude the tool is broken. 2000px keeps a code that occupies a modest
 * part of the frame comfortably above the size the detector needs. Downscaling never enlarges,
 * so a small screenshot is passed through untouched.
 */
export const MAX_SCAN_EDGE = 2000;

export type DecodedSymbol = {
  format: string;
  text: string;
  /** Centre of the symbol in the coordinates of the (possibly downscaled) image scanned. */
  center: { x: number; y: number };
  payload: ParsedPayload;
};

export type WifiCredentials = {
  ssid: string;
  password: string;
  /** `WPA`, `WEP`, `nopass`, or whatever the code declared. */
  encryption: string;
  hidden: boolean;
};

export type VCardFields = {
  name?: string;
  org?: string;
  title?: string;
  phone?: string;
  email?: string;
  url?: string;
};

export type ParsedPayload =
  | { kind: 'wifi'; wifi: WifiCredentials }
  | { kind: 'vcard'; vcard: VCardFields }
  | { kind: 'url'; url: string }
  | { kind: 'text' };

/** Split on a separator, ignoring separators that a backslash escapes. Escapes are kept. */
function splitUnescaped(input: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < input.length; i++) {
    const c = input[i] as string;
    if (c === '\\' && i + 1 < input.length) {
      cur += c + input[i + 1];
      i++;
    } else if (c === sep) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function indexOfUnescaped(input: string, ch: string): number {
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '\\') {
      i++;
    } else if (input[i] === ch) {
      return i;
    }
  }
  return -1;
}

const unescapeBackslash = (s: string) => s.replace(/\\(.)/g, '$1');

/**
 * Parse a `WIFI:` payload into fields, or return null if it is not one.
 *
 * The format escapes `\ ; , : "` with a backslash, so a password containing a semicolon — which
 * is a perfectly ordinary password — cannot be recovered by splitting on `;` naively. Fields may
 * appear in any order and only `S` (the SSID) is required in practice.
 */
export function parseWifiPayload(text: string): WifiCredentials | null {
  const trimmed = text.trim();
  if (!/^WIFI:/i.test(trimmed)) return null;
  const fields = new Map<string, string>();
  for (const segment of splitUnescaped(trimmed.slice(5), ';')) {
    if (!segment) continue;
    const at = indexOfUnescaped(segment, ':');
    if (at < 0) continue;
    fields.set(segment.slice(0, at).trim().toUpperCase(), unescapeBackslash(segment.slice(at + 1)));
  }
  const ssid = fields.get('S');
  if (ssid === undefined || ssid === '') return null;
  const declared = (fields.get('T') ?? '').trim();
  return {
    ssid,
    password: fields.get('P') ?? '',
    encryption: declared === '' ? 'nopass' : declared,
    hidden: (fields.get('H') ?? '').toLowerCase() === 'true',
  };
}

/** Pull the handful of vCard properties worth showing. Not a general vCard parser. */
export function parseVCardPayload(text: string): VCardFields | null {
  if (!/^\s*BEGIN:VCARD/i.test(text)) return null;
  const out: VCardFields = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    // Strip any parameters: `TEL;TYPE=CELL:+44…` — the property name is up to the first `;`.
    const prop = (line.slice(0, at).split(';')[0] ?? '').trim().toUpperCase();
    const value = line
      .slice(at + 1)
      .replace(/\\(.)/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
    if (!value) continue;
    if (prop === 'FN' && !out.name) out.name = value;
    else if (prop === 'N' && !out.name) out.name = value.split(';').filter(Boolean).join(' ');
    else if (prop === 'ORG') out.org = value;
    else if (prop === 'TITLE') out.title = value;
    else if (prop === 'TEL' && !out.phone) out.phone = value;
    else if (prop === 'EMAIL' && !out.email) out.email = value;
    else if (prop === 'URL') out.url = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Is this payload a web address safe to offer as a link?
 *
 * Only http and https. A QR code is data from a stranger, and `javascript:`, `data:` and `file:`
 * URLs are all things a scanner could be handed; rendering any of them into an href would turn a
 * printed sticker into a click-to-run. Everything else stays plain text — which is also why the
 * UI never navigates on its own, however clearly a code says "open me".
 */
export function safeLinkUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function classifyPayload(text: string): ParsedPayload {
  const wifi = parseWifiPayload(text);
  if (wifi) return { kind: 'wifi', wifi };
  const vcard = parseVCardPayload(text);
  if (vcard) return { kind: 'vcard', vcard };
  const url = safeLinkUrl(text);
  if (url) return { kind: 'url', url };
  return { kind: 'text' };
}

function toSymbol(result: ReadResult): DecodedSymbol {
  const p = result.position;
  const xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x];
  const ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y];
  return {
    format: result.format,
    text: result.text,
    center: {
      x: Math.round(xs.reduce((a, b) => a + b, 0) / 4),
      y: Math.round(ys.reduce((a, b) => a + b, 0) / 4),
    },
    payload: classifyPayload(result.text),
  };
}

/** Decode every symbol in one frame of pixels. Used by both the file and the camera path. */
export async function decodeImageData(data: ImageData): Promise<DecodedSymbol[]> {
  const results = await readBarcodes(data, {
    tryHarder: true,
    tryInvert: true,
    maxNumberOfSymbols: 32,
  });
  return results.filter((r) => r.isValid && r.text !== '').map(toSymbol);
}

/** Decode a dropped image file: decode, downscale if large, then scan. */
export async function decodeBarcodeImage(file: File): Promise<DecodedSymbol[]> {
  const bitmap = await loadBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_SCAN_EDGE, MAX_SCAN_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Your browser did not provide a 2D canvas context.');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
  } finally {
    bitmap.close();
  }
}
