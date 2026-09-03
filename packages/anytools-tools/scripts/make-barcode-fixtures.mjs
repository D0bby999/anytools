/**
 * Generate the barcode images used to verify qr-barcode-scanner in a real browser.
 *
 * Nothing here is committed: the files land in ../fixtures/ (gitignored). The point of these
 * three is that they are produced by the SAME encoder the site ships, so the browser lane is a
 * genuine round trip — barcode-generator's engine writes them, qr-barcode-scanner reads them —
 * rather than a test against a picture someone found.
 *
 *   barcode-ean13.png    5901234123457, straight from zxing's own PNG output. The check digit
 *                        is GS1's published sample; the scanner must read those 13 digits back.
 *   qr-wifi.png          a QR built by the `qrcode` package (the one qr-code-generator uses)
 *                        holding a WIFI: payload with an escaped semicolon in the password —
 *                        the case a naive `split(';')` parser gets wrong.
 *   barcodes-three.png   EAN-13, Code 128 and Data Matrix side by side in one image, to check
 *                        that the scanner lists every symbol rather than stopping at the first.
 *
 * Run: pnpm --filter @anytools/tools exec node scripts/make-barcode-fixtures.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib, { deflateSync } from 'node:zlib';
import QRCode from 'qrcode';
import { prepareZXingModule, writeBarcode } from 'zxing-wasm/full';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'fixtures');
mkdirSync(OUT, { recursive: true });

// The same staged binary the site serves, rather than the CDN copy zxing-wasm would otherwise
// fetch. If this file is missing, run `pnpm --filter @anytools/web vendor:assets` first.
const WASM = join(
  here,
  '..',
  '..',
  '..',
  'apps',
  'anytools-web',
  'public',
  'third-party',
  'zxing',
  'zxing_full.wasm',
);
prepareZXingModule({
  overrides: { wasmBinary: readFileSync(WASM).buffer },
  fireImmediately: true,
});

// --- minimal RGB PNG encoder (only needed for the composed image) ----------------------------
const crc32 = (buf) => zlib.crc32(buf) >>> 0;

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** `pixels` is width*height bytes of grey; 0 is black. */
function greyPng(pixels, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    pixels.subarray(y * width, (y + 1) * width).forEach((v, x) => {
      raw[y * (width + 1) + 1 + x] = v;
    });
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const EAN13 = '5901234123457';
// Exactly what qr-code-generator's buildPayload emits for this input, escaping included.
const WIFI = 'WIFI:T:WPA;S:Cafe Guest;P:flat\\;white;H:false;;';

// --- one EAN-13, as the tool itself would produce it ------------------------------------------
const ean = await writeBarcode(EAN13, { format: 'EAN13', scale: 4, addHRT: true });
if (ean.error || !ean.image) throw new Error(`EAN-13 encode failed: ${ean.error}`);
writeFileSync(join(OUT, 'barcode-ean13.png'), Buffer.from(await ean.image.arrayBuffer()));

// --- one QR, from the package qr-code-generator uses -------------------------------------------
await QRCode.toFile(join(OUT, 'qr-wifi.png'), WIFI, { margin: 2, scale: 6 });

// --- three symbols in one image ----------------------------------------------------------------
const SCALE = 3;
const GAP = 40;
const symbols = [];
for (const [format, text] of [
  ['EAN13', EAN13],
  ['Code128', 'SKU-000123'],
  ['DataMatrix', 'https://anytools.pro'],
]) {
  const r = await writeBarcode(text, { format, scale: 2 });
  if (r.error) throw new Error(`${format} encode failed: ${r.error}`);
  symbols.push(r.symbol);
}

const width = GAP + symbols.reduce((w, s) => w + s.width * SCALE + GAP, 0);
const height = GAP * 2 + Math.max(...symbols.map((s) => s.height * SCALE));
const canvas = new Uint8Array(width * height).fill(0xff);
let cursor = GAP;
for (const s of symbols) {
  for (let y = 0; y < s.height * SCALE; y++) {
    for (let x = 0; x < s.width * SCALE; x++) {
      const src = s.data[Math.floor(y / SCALE) * s.width + Math.floor(x / SCALE)];
      canvas[(GAP + y) * width + cursor + x] = src;
    }
  }
  cursor += s.width * SCALE + GAP;
}
writeFileSync(join(OUT, 'barcodes-three.png'), greyPng(canvas, width, height));

console.log(
  `fixtures written to ${OUT}: barcode-ean13.png (${EAN13}) qr-wifi.png (${WIFI}) barcodes-three.png (3 symbols)`,
);
