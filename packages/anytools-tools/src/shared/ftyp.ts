/**
 * The `ftyp` box every ISO base media file opens with — HEIC, AVIF, MP4 and friends.
 *
 * Extensions lie and `file.type` is empty on Windows for .heic, so the bytes are the only
 * reliable signal for telling a HEIC apart from an AVIF that shares the same container.
 */

/** ISO-BMFF brands libheif can open. iPhones write `heic`; `mif1`/`msf1` are the generic ones. */
const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'mif1',
  'mif2',
  'msf1',
  'heif',
]);

/** AV1 in the same container. Different codec, and browsers already open it natively. */
const AVIF_BRANDS = new Set(['avif', 'avis', 'avio']);

/**
 * How many compatible brands to read.
 *
 * Real files list a handful. The cap is a guard, not a limit: a `ftyp` whose declared size is 0
 * (or larger than the file) leaves the scan running to the end of the buffer, which on a 20 MB
 * photo means five million four-character strings before the file is rejected anyway.
 */
const MAX_COMPATIBLE_BRANDS = 32;

export type FtypBox = { majorBrand: string; compatibleBrands: string[] };

const fourcc = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(...bytes.subarray(at, at + 4));

/**
 * Read the box: 4-byte size, the literal `ftyp`, the major brand, a minor version, then the
 * compatible-brand list. Returns null when the file does not start with one.
 */
export function readFtypBrand(bytes: Uint8Array): FtypBox | null {
  if (bytes.length < 16 || fourcc(bytes, 4) !== 'ftyp') return null;
  const declared = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  const end = Math.min(
    declared > 0 ? declared : bytes.length,
    bytes.length,
    16 + MAX_COMPATIBLE_BRANDS * 4,
  );
  const compatibleBrands: string[] = [];
  for (let at = 16; at + 4 <= end; at += 4) compatibleBrands.push(fourcc(bytes, at));
  return { majorBrand: fourcc(bytes, 8), compatibleBrands };
}

/**
 * What the container says it holds.
 *
 * The major brand decides first, and that ordering is the whole point: a real AVIF lists `mif1`
 * among its compatible brands — Apple's writes `avif` + `MiPr avif miaf mif1` — so a check that
 * only looked for a HEIF brand anywhere in the list would send an AV1 file to a decoder that has
 * no AV1 in it, and the user would get a generic failure after a 1 MB download.
 */
export function classifyBrand(box: FtypBox): 'heif' | 'avif' | 'other' {
  if (AVIF_BRANDS.has(box.majorBrand)) return 'avif';
  if (HEIF_BRANDS.has(box.majorBrand)) return 'heif';
  // Only then the compatible list, for cameras that write their own major brand: Canon .hif is
  // `heix` or a vendor code with `mif1` alongside.
  if (box.compatibleBrands.some((b) => AVIF_BRANDS.has(b))) return 'avif';
  if (box.compatibleBrands.some((b) => HEIF_BRANDS.has(b))) return 'heif';
  return 'other';
}

/** True when libheif should be able to open this. */
export const isHeifBrand = (box: FtypBox): boolean => classifyBrand(box) === 'heif';

export const isAvifBrand = (box: FtypBox): boolean => classifyBrand(box) === 'avif';
