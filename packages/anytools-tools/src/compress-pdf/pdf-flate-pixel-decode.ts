/**
 * Pure pixel-decoding math for compress-pdf's `/FlateDecode` image support — no pdf-lib, no
 * DOM. Split out so every path here is unit-tested directly against plain byte arrays with an
 * exact expected result (see logic.test.ts), the same ground-truth method used to prove this
 * against two real signed PDFs before it shipped (see logic.ts's module comment).
 *
 * Scope is deliberately narrow — see pdf-flate-colorspace.ts and pdf-flate-image-decode.ts for
 * what is and is not classified as decodable; anything outside that returns null upstream and
 * the image is left untouched (`imagesSkipped`), never guessed at.
 */

export type SampleKind = 'gray' | 'rgb' | 'cmyk' | 'indexed';

/** PNG's own per-byte Paeth predictor (PNG spec §6.6) — picks whichever of a/b/c is "closest". */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Undo PNG-style per-row filtering. PDF Predictor values 10–15 all mean "PNG-style" — the
 * filter actually used for EACH row is read from that row's own leading 1-byte tag, not from
 * the DecodeParms `/Predictor` number itself (15, "Optimum", just means the encoder was free to
 * pick a different filter per row). Proven against hand-built Sub/Up/Average/Paeth rows and
 * against a real signature-stamp image from a production PDF (predictor 15) — see logic.test.ts.
 */
export function undoPngPredictor(
  data: Uint8Array,
  rowBytes: number,
  bytesPerPixel: number,
): Uint8Array {
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  let prevRow = new Uint8Array(rowBytes);
  let srcOff = 0;
  let dstOff = 0;
  for (let r = 0; r < rows; r++) {
    const filterType = data[srcOff] ?? 0;
    srcOff++;
    for (let i = 0; i < rowBytes; i++) {
      const raw = data[srcOff + i] ?? 0;
      const a = i >= bytesPerPixel ? (out[dstOff + i - bytesPerPixel] ?? 0) : 0;
      const b = prevRow[i] ?? 0;
      const c = i >= bytesPerPixel ? (prevRow[i - bytesPerPixel] ?? 0) : 0;
      let val: number;
      switch (filterType) {
        case 1:
          val = raw + a;
          break;
        case 2:
          val = raw + b;
          break;
        case 3:
          val = raw + ((a + b) >> 1);
          break;
        case 4:
          val = raw + paeth(a, b, c);
          break;
        default:
          val = raw; // 0 (None), or an unrecognised tag — stored as-is is the closest safe guess.
      }
      out[dstOff + i] = val & 0xff;
    }
    prevRow = out.subarray(dstOff, dstOff + rowBytes);
    srcOff += rowBytes;
    dstOff += rowBytes;
  }
  return out;
}

/**
 * Undo the predictor declared in a stream's `/DecodeParms`. Only "none" (1, or absent) and
 * PNG-style (10–15) are handled — TIFF predictor (2, horizontal differencing) is deliberately
 * NOT supported: no real-world PDF sampled while building this used it, so there was nothing to
 * prove it against. Returns null for that or any other value; callers treat null as "skip this
 * image" rather than guess.
 */
export function undoPredictor(
  data: Uint8Array,
  predictor: number,
  rowBytes: number,
  bytesPerPixel: number,
): Uint8Array | null {
  if (predictor <= 1) return data;
  if (predictor >= 10) return undoPngPredictor(data, rowBytes, bytesPerPixel);
  return null;
}

/**
 * Unpack a row-padded, MSB-first PDF sample stream into one integer per component per pixel,
 * still in the RAW `0..2^bitsPerComponent-1` domain (see `scaleSampleTo8Bit`). PDF pads every
 * row to a byte boundary regardless of bit depth (PDF 32000-1 §7.4.4.4), so a bit depth under 8
 * cannot be read as one flat bitstream across rows.
 */
export function unpackSamples(
  data: Uint8Array,
  width: number,
  height: number,
  components: number,
  bitsPerComponent: number,
): Uint16Array {
  const out = new Uint16Array(width * height * components);
  const rowBytes = Math.ceil((components * bitsPerComponent * width) / 8);
  let outIdx = 0;
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    let bitPos = 0;
    const rowBits = width * components * bitsPerComponent;
    while (bitPos < rowBits) {
      let value = 0;
      for (let b = 0; b < bitsPerComponent; b++) {
        const byteIdx = rowStart + (bitPos >> 3);
        const byte = data[byteIdx] ?? 0;
        const bit = (byte >> (7 - (bitPos & 7))) & 1;
        value = (value << 1) | bit;
        bitPos++;
      }
      out[outIdx] = value;
      outIdx++;
    }
  }
  return out;
}

/** Scale a raw sample (`0..2^bitsPerComponent-1`) to the 0-255 display range, linearly. */
export function scaleSampleTo8Bit(raw: number, bitsPerComponent: number): number {
  const max = 2 ** bitsPerComponent - 1;
  return Math.round((raw * 255) / max);
}

/** Naive (non-colour-managed) CMYK -> RGB — the same "additive complement" approximation every
 *  viewer without a CMYK ICC engine falls back to; documented as a limitation in the FAQ. */
export function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  return [
    Math.round(255 * (1 - c / 255) * (1 - k / 255)),
    Math.round(255 * (1 - m / 255) * (1 - k / 255)),
    Math.round(255 * (1 - y / 255) * (1 - k / 255)),
  ];
}

/**
 * Turn unpacked component samples into RGBA pixels (alpha always opaque here — combining an
 * `/SMask` happens one level up, in pdf-flate-image-decode.ts, after this runs once for the
 * base image and once for the mask). `palette` is required for `kind === 'indexed'`, and its
 * values are used as a raw INDEX — never scaled, unlike every other kind.
 */
export function samplesToRgba(
  samples: Uint16Array,
  width: number,
  height: number,
  components: number,
  bitsPerComponent: number,
  kind: SampleKind,
  palette?: Uint8Array,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    let r: number;
    let g: number;
    let b: number;
    if (kind === 'indexed') {
      const index = samples[p] ?? 0;
      r = palette?.[index * 3] ?? 0;
      g = palette?.[index * 3 + 1] ?? 0;
      b = palette?.[index * 3 + 2] ?? 0;
    } else {
      const s = (i: number) =>
        scaleSampleTo8Bit(samples[p * components + i] ?? 0, bitsPerComponent);
      if (kind === 'gray') {
        r = g = b = s(0);
      } else if (kind === 'rgb') {
        r = s(0);
        g = s(1);
        b = s(2);
      } else {
        [r, g, b] = cmykToRgb(s(0), s(1), s(2), s(3));
      }
    }
    out[p * 4] = r;
    out[p * 4 + 1] = g;
    out[p * 4 + 2] = b;
    out[p * 4 + 3] = 255;
  }
  return out;
}
