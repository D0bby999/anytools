import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Generate the PDF fixtures used to verify file tools in a real browser.
 *
 * Nothing here is committed: run this and the files land in ../fixtures/ (gitignored). Each
 * fixture exists to trip one specific failure that unit tests under happy-dom cannot reach:
 *
 *   text-3p.pdf        three text pages — the plain case; page count, order, rotation.
 *   images-shared.pdf  ONE PNG embedded once and drawn on all three pages. pdf.js caches such
 *                      an image under a `g_` id in `commonObjs`, not `page.objs`; a reader
 *                      that asks the wrong store hangs forever (extract-images bug, 260902).
 *   cjk.pdf            Japanese text set in a NON-embedded font through the predefined CMap
 *                      UniJIS-UCS2-H. Rendering it needs /third-party/pdfjs/cmaps/; if that path is
 *                      wrong the worker throws "Built-in CMap parameters are not provided".
 *
 * The PNG is built in-process (a 96x96 two-colour checkerboard) so the repository does not
 * carry a binary. pdf-lib cannot emit a non-embedded CJK font, so cjk.pdf is written by hand
 * with a correct xref table.
 *
 * Run: node scripts/make-fixtures.mjs
 */
import { deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
mkdirSync(OUT, { recursive: true });

// --- minimal PNG encoder --------------------------------------------------------------------
// Node 22 exposes zlib.crc32; fall back to a table implementation for older runtimes.
import zlib from 'node:zlib';
const crc32 =
  typeof zlib.crc32 === 'function'
    ? (buf) => zlib.crc32(buf) >>> 0
    : (() => {
        const t = new Uint32Array(256).map((_, n) => {
          let c = n;
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          return c >>> 0;
        });
        return (buf) => {
          let c = 0xffffffff;
          for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
          return (c ^ 0xffffffff) >>> 0;
        };
      })();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function checkerboardPng(size = 96, cell = 12) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const dark = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = dark ? 0x04 : 0xf8;
      raw[o + 1] = dark ? 0x78 : 0xfa;
      raw[o + 2] = dark ? 0x57 : 0xfc;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- text-3p.pdf ----------------------------------------------------------------------------
async function textThreePages() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Fixture text-3p — page ${i} of 3`, { x: 60, y: 760, size: 24, font });
    page.drawText('The quick brown fox jumps over the lazy dog.', {
      x: 60,
      y: 720,
      size: 12,
      font,
    });
    if (i === 2) page.setRotation(degrees(90)); // one rotated page, to catch tools that ignore /Rotate
  }
  writeFileSync(join(OUT, 'text-3p.pdf'), await doc.save());
}

// --- images-shared.pdf ----------------------------------------------------------------------
async function imagesShared() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await doc.embedPng(checkerboardPng()); // embedded ONCE
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Letterhead fixture — page ${i}`, { x: 60, y: 700, size: 18, font });
    page.drawImage(png, { x: 60, y: 740, width: 96, height: 96 }); // same XObject on every page
  }
  writeFileSync(join(OUT, 'images-shared.pdf'), await doc.save());
}

// --- cjk.pdf (hand-written) -----------------------------------------------------------------
function cjkPdf() {
  // 日本語テスト = U+65E5 U+672C U+8A9E U+30C6 U+30B9 U+30C8, as UCS-2 hex for UniJIS-UCS2-H
  const hex = '65E5672C8A9E30C630B930C8';
  const content = `BT /F1 36 Tf 72 700 Td <${hex}> Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPr6N-Regular /Encoding /UniJIS-UCS2-H /DescendantFonts [5 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /KozMinPr6N-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /FontDescriptor 7 0 R /DW 1000 >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /FontDescriptor /FontName /KozMinPr6N-Regular /Flags 4 /FontBBox [-437 -340 1147 1317] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 740 /StemV 80 >>',
  ];
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(join(OUT, 'cjk.pdf'), Buffer.from(out, 'latin1'));
}

await textThreePages();
await imagesShared();
cjkPdf();
console.log(`fixtures written to ${OUT}: text-3p.pdf images-shared.pdf cjk.pdf`);
