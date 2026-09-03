/**
 * A minimal RGB PNG encoder for tests and fixtures — node only (uses zlib for the IDAT stream).
 *
 * Written against Uint8Array/DataView rather than Buffer on purpose: under TypeScript 5.7's
 * generic typed arrays, `Buffer<ArrayBufferLike>` is not assignable to `Uint8Array<ArrayBufferLike>`
 * in this workspace's type set-up, and three test files that each carried a Buffer-based copy of
 * this encoder failed typecheck with 30 identical errors (2026-09-03). One typed copy instead.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = concat([new TextEncoder().encode(type), data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

/**
 * Encode a `width`×`height` 8-bit RGB PNG. `pixel(x, y)` returns the red channel value (green and
 * blue are 0) — enough to make the image content-dependent when a test needs distinct bytes.
 */
export function encodeRgbPng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number = (x, y) => (x * 7 + y * 11) & 0xff,
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const stride = width * 3 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) raw[y * stride + 1 + x * 3] = pixel(x, y) & 0xff;
  }
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
