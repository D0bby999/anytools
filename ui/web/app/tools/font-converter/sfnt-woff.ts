/**
 * Read/write the two binary containers this tool converts between: a raw sfnt (the format
 * inside both .ttf and .otf — they differ only in which outline table they carry, not in the
 * container) and WOFF 1.0 (per the W3C spec, https://www.w3.org/TR/WOFF/).
 *
 * WOFF2 is deliberately not handled here: its tables are Brotli-compressed and its glyf/loca
 * tables are further transformed, and neither the Compression Streams API (`gzip` / `deflate` /
 * `deflate-raw` only — no `br`) nor any dependency pinned for this batch can decode Brotli.
 * `detectFontFlavor` still recognises a WOFF2 file, purely so the caller can say why it was
 * refused instead of failing on a garbled read.
 *
 * True outline conversion (rewriting a TrueType `glyf`/`loca` font into PostScript `CFF`
 * outlines, or back) is also out of scope — that needs a font-engineering library (fonttools,
 * opentype.js), none of which is pinned. What this module does is honest about the difference:
 * wrapping/unwrapping WOFF never touches a table's bytes, so the output keeps whatever outline
 * flavor the input already had. `flavor` is the file's real sfnt version, not a request.
 */

export type SfntTable = { tag: number; checksum: number; data: Uint8Array };
export type Sfnt = { flavor: number; tables: SfntTable[] };
export type FontFlavor = 'ttf' | 'otf' | 'woff' | 'woff2' | 'unknown';

const SFNT_HEADER_SIZE = 12;
const SFNT_ENTRY_SIZE = 16;
const WOFF_HEADER_SIZE = 44;
const WOFF_ENTRY_SIZE = 20;
const WOFF_SIGNATURE = 0x774f4646; // 'wOFF'
const WOFF2_SIGNATURE = 0x774f4632; // 'wOF2'
const SFNT_TRUETYPE = 0x00010000;
const SFNT_TRUETYPE_APPLE = 0x74727565; // 'true'
const SFNT_CFF = 0x4f54544f; // 'OTTO'

export class SfntFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SfntFormatError';
  }
}

const dataViewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const pad4 = (n: number) => (n + 3) & ~3;
const largestPow2AtMost = (n: number) => {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
};

/** Sniff a file's container from its first bytes, without trusting its extension. */
export function detectFontFlavor(bytes: Uint8Array): FontFlavor {
  if (bytes.byteLength < 4) return 'unknown';
  const tag = dataViewOf(bytes).getUint32(0);
  if (tag === WOFF_SIGNATURE) return 'woff';
  if (tag === WOFF2_SIGNATURE) return 'woff2';
  if (tag === SFNT_TRUETYPE || tag === SFNT_TRUETYPE_APPLE) return 'ttf';
  if (tag === SFNT_CFF) return 'otf';
  return 'unknown';
}

/** `.ttf` for glyf-flavored sfnt, `.otf` for CFF-flavored — based on the real tag, not a guess. */
export const extensionForFlavor = (flavor: number): 'ttf' | 'otf' =>
  flavor === SFNT_CFF ? 'otf' : 'ttf';

/** Parse a raw sfnt (.ttf/.otf) into its table directory. Table bytes are copied, not aliased. */
export function parseSfnt(bytes: Uint8Array): Sfnt {
  if (bytes.byteLength < SFNT_HEADER_SIZE)
    throw new SfntFormatError('File is too short to be a font.');
  const dv = dataViewOf(bytes);
  const flavor = dv.getUint32(0);
  if (flavor !== SFNT_TRUETYPE && flavor !== SFNT_TRUETYPE_APPLE && flavor !== SFNT_CFF) {
    throw new SfntFormatError('Not a raw TTF/OTF (unexpected sfnt version tag).');
  }
  const numTables = dv.getUint16(4);
  const tables: SfntTable[] = [];
  for (let i = 0; i < numTables; i++) {
    const rec = SFNT_HEADER_SIZE + i * SFNT_ENTRY_SIZE;
    if (rec + SFNT_ENTRY_SIZE > bytes.byteLength)
      throw new SfntFormatError('Truncated table directory.');
    const offset = dv.getUint32(rec + 8);
    const length = dv.getUint32(rec + 12);
    if (offset + length > bytes.byteLength)
      throw new SfntFormatError('A font table runs past the end of the file.');
    tables.push({
      tag: dv.getUint32(rec),
      checksum: dv.getUint32(rec + 4),
      data: bytes.slice(offset, offset + length),
    });
  }
  return { flavor, tables };
}

/** Total size of `tables` once written as a raw sfnt — what WOFF's header calls totalSfntSize. */
function sfntTotalSize(tables: SfntTable[]): number {
  return tables.reduce(
    (size, t) => size + pad4(t.data.byteLength),
    SFNT_HEADER_SIZE + tables.length * SFNT_ENTRY_SIZE,
  );
}

/** Rebuild a raw sfnt file from a table directory — the inverse of `parseSfnt`. */
export function buildSfnt(sfnt: Sfnt): Uint8Array {
  const { tables, flavor } = sfnt;
  if (tables.length === 0) throw new SfntFormatError('A font needs at least one table.');
  const maxPow2 = largestPow2AtMost(tables.length);
  const searchRange = maxPow2 * 16;

  const directorySize = SFNT_HEADER_SIZE + tables.length * SFNT_ENTRY_SIZE;
  const out = new Uint8Array(sfntTotalSize(tables));
  const dv = dataViewOf(out);
  dv.setUint32(0, flavor);
  dv.setUint16(4, tables.length);
  dv.setUint16(6, searchRange);
  dv.setUint16(8, Math.round(Math.log2(maxPow2)));
  dv.setUint16(10, tables.length * 16 - searchRange);

  let offset = directorySize;
  tables.forEach((t, i) => {
    const rec = SFNT_HEADER_SIZE + i * SFNT_ENTRY_SIZE;
    dv.setUint32(rec, t.tag);
    dv.setUint32(rec + 4, t.checksum);
    dv.setUint32(rec + 8, offset);
    dv.setUint32(rec + 12, t.data.byteLength);
    out.set(t.data, offset);
    offset += pad4(t.data.byteLength);
  });
  return out;
}

async function pipeThrough(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Read a WOFF 1.0 file back into a table directory, inflating any zlib-compressed tables. */
export async function unwrapWoff(bytes: Uint8Array): Promise<Sfnt> {
  if (bytes.byteLength < WOFF_HEADER_SIZE)
    throw new SfntFormatError('File is too short to be a WOFF file.');
  const dv = dataViewOf(bytes);
  if (dv.getUint32(0) !== WOFF_SIGNATURE) {
    throw new SfntFormatError(
      dv.getUint32(0) === WOFF2_SIGNATURE
        ? 'This is a WOFF2 file. WOFF2 needs a Brotli decoder this tool does not have.'
        : "Not a WOFF file (bad signature — expected 'wOFF').",
    );
  }
  const flavor = dv.getUint32(4);
  const numTables = dv.getUint16(12);
  if (numTables === 0) throw new SfntFormatError('This WOFF file lists no tables.');

  const tables: SfntTable[] = [];
  for (let i = 0; i < numTables; i++) {
    const rec = WOFF_HEADER_SIZE + i * WOFF_ENTRY_SIZE;
    if (rec + WOFF_ENTRY_SIZE > bytes.byteLength)
      throw new SfntFormatError('Truncated WOFF table directory.');
    const tag = dv.getUint32(rec);
    const offset = dv.getUint32(rec + 4);
    const compLength = dv.getUint32(rec + 8);
    const origLength = dv.getUint32(rec + 12);
    const checksum = dv.getUint32(rec + 16);
    if (offset + compLength > bytes.byteLength)
      throw new SfntFormatError('WOFF table data runs past the end of the file.');
    const stored = bytes.slice(offset, offset + compLength);
    // Equal lengths is WOFF's own signal for "stored uncompressed" — decompressing it anyway
    // would be undefined behaviour (there is nothing valid to inflate).
    const data =
      compLength === origLength
        ? stored
        : await pipeThrough(stored, new DecompressionStream('deflate'));
    if (data.byteLength !== origLength) {
      throw new SfntFormatError(
        `Table decompressed to ${data.byteLength} bytes, expected ${origLength}.`,
      );
    }
    tables.push({ tag, checksum, data });
  }
  return { flavor, tables };
}

/** Wrap a parsed sfnt into a WOFF 1.0 file, deflating each table that actually shrinks. */
export async function wrapWoff(sfnt: Sfnt): Promise<Uint8Array> {
  if (sfnt.tables.length === 0) throw new SfntFormatError('A font needs at least one table.');
  const stored = await Promise.all(
    sfnt.tables.map(async (t) => {
      const compressed = await pipeThrough(t.data, new CompressionStream('deflate'));
      return compressed.byteLength < t.data.byteLength ? compressed : t.data;
    }),
  );

  const directorySize = WOFF_HEADER_SIZE + sfnt.tables.length * WOFF_ENTRY_SIZE;
  const totalLength = stored.reduce((n, s) => n + pad4(s.byteLength), directorySize);
  const out = new Uint8Array(totalLength);
  const dv = dataViewOf(out);
  dv.setUint32(0, WOFF_SIGNATURE);
  dv.setUint32(4, sfnt.flavor);
  dv.setUint32(8, totalLength);
  dv.setUint16(12, sfnt.tables.length);
  dv.setUint16(14, 0); // reserved
  dv.setUint32(16, sfntTotalSize(sfnt.tables));
  // majorVersion/minorVersion (20/22) and the meta/private blocks (24-43) are left at 0: this
  // tool carries no font-vendor version number and writes no WOFF metadata block.

  let offset = directorySize;
  sfnt.tables.forEach((t, i) => {
    const rec = WOFF_HEADER_SIZE + i * WOFF_ENTRY_SIZE;
    const compressed = stored[i] as Uint8Array;
    dv.setUint32(rec, t.tag);
    dv.setUint32(rec + 4, offset);
    dv.setUint32(rec + 8, compressed.byteLength);
    dv.setUint32(rec + 12, t.data.byteLength);
    dv.setUint32(rec + 16, t.checksum);
    out.set(compressed, offset);
    offset += pad4(compressed.byteLength);
  });
  return out;
}
