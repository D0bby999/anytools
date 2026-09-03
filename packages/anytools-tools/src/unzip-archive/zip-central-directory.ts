/**
 * Read a zip's central directory ourselves, before JSZip is asked to load anything.
 *
 * JSZip cannot be trusted with the numbers this tool's zip-bomb ceiling depends on. It builds
 * every integer with `(result << 8) + byte`, which is a *signed 32-bit* operation, so an 8-byte
 * ZIP64 field wraps modulo 2^32 and loses its top bits entirely. Measured against JSZip 3.10.1
 * on 2026-09-03:
 *
 *   declared 3 GiB  -> -1073741824   (negative; "not greater than 2 GB" — the bug found in the
 *                                     browser lane, patched at the time with a sign fixup)
 *   declared 5 GiB  ->  1073741824   (reports 1 GiB: a 5 GB bomb looks like a 1 GB archive)
 *   declared 4 GiB  ->  undefined    (JSZip gives up and exposes no size at all)
 *   declared 64 GiB ->  undefined
 *
 * A sign fixup cannot repair any of the last three: the information is gone before it reaches
 * us. So the sizes the ceiling is computed from are read here instead, straight out of the
 * archive, with `DataView` (unsigned by construction) and `getBigUint64` for the ZIP64 fields.
 *
 * Reading the directory first also answers "how many entries does this archive claim?" from the
 * 22-byte end-of-central-directory record, before JSZip allocates one object per entry.
 *
 * Written from the PKWARE APPNOTE (sections 4.3.12, 4.3.14, 4.3.16 and 4.5.3), not adapted from
 * any implementation.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
/** Header ID of the ZIP64 extended information extra field. */
const ZIP64_EXTRA_ID = 0x0001;

const EOCD_LENGTH = 22;
const ZIP64_LOCATOR_LENGTH = 20;
const ZIP64_EOCD_MIN_LENGTH = 56;
const CENTRAL_FILE_HEADER_LENGTH = 46;

const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
/** The EOCD's trailing comment is a 16-bit length, so it can never start further back. */
const MAX_EOCD_SEARCH = EOCD_LENGTH + MAX_UINT16;

export type ZipDirectoryEntry = {
  name: string;
  /**
   * Uncompressed bytes as the archive declares them, or `null` when the archive claims a ZIP64
   * size but does not carry a readable ZIP64 extra field. `null` means "unknown", and unknown
   * must never be treated as zero — that is precisely how a bomb walks past a size ceiling.
   */
  size: number | null;
};

export type ZipCentralDirectory = {
  /** Entry count the archive states about itself, read before any entry is parsed. */
  declaredEntryCount: number;
  entries: ZipDirectoryEntry[];
};

/** Names are UTF-8 whenever bit 11 is set, which every archiver written this century sets. */
const decodeName = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes);

/** Byte offset of the EOCD record, or null when this is not a readable zip. */
function findEndOfCentralDirectory(view: DataView): number | null {
  const earliest = Math.max(0, view.byteLength - MAX_EOCD_SEARCH);
  for (let at = view.byteLength - EOCD_LENGTH; at >= earliest; at--) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  return null;
}

type DirectoryLocation = { entryCount: number; offset: number; size: number };

/**
 * A zip past 4 GB, or past 65,535 entries, puts its real totals in a second record and leaves
 * `0xFFFF...` sentinels in the classic one. Returns null when the sentinels are there but the
 * ZIP64 records are not, which is a corrupt archive rather than a big one.
 */
function readZip64Location(view: DataView, eocd: number): DirectoryLocation | null {
  const locator = eocd - ZIP64_LOCATOR_LENGTH;
  if (locator < 0 || view.getUint32(locator, true) !== ZIP64_LOCATOR_SIGNATURE) return null;

  const record = Number(view.getBigUint64(locator + 8, true));
  if (
    !Number.isSafeInteger(record) ||
    record < 0 ||
    record + ZIP64_EOCD_MIN_LENGTH > view.byteLength ||
    view.getUint32(record, true) !== ZIP64_EOCD_SIGNATURE
  ) {
    return null;
  }
  return {
    entryCount: Number(view.getBigUint64(record + 32, true)),
    size: Number(view.getBigUint64(record + 40, true)),
    offset: Number(view.getBigUint64(record + 48, true)),
  };
}

/**
 * The 8-byte uncompressed size out of a ZIP64 extra field, or null when it is absent or
 * truncated. It is the first value in the field, present exactly when the 4-byte size in the
 * central header reads `0xFFFFFFFF` — which is the only case this is called for.
 */
function readZip64Size(view: DataView, start: number, length: number): number | null {
  let at = start;
  const end = start + length;
  while (at + 4 <= end) {
    const id = view.getUint16(at, true);
    const payload = view.getUint16(at + 2, true);
    if (at + 4 + payload > end) return null;
    if (id === ZIP64_EXTRA_ID) {
      if (payload < 8) return null;
      const size = Number(view.getBigUint64(at + 4, true));
      return Number.isFinite(size) ? size : null;
    }
    at += 4 + payload;
  }
  return null;
}

/**
 * Parse the central directory of `bytes`. Returns null when there is no EOCD record to work
 * from — a truncated or non-zip file, which JSZip will reject with its own message.
 */
export function readZipCentralDirectory(bytes: Uint8Array): ZipCentralDirectory | null {
  if (bytes.byteLength < EOCD_LENGTH) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = findEndOfCentralDirectory(view);
  if (eocd === null) return null;

  let location: DirectoryLocation = {
    entryCount: view.getUint16(eocd + 10, true),
    size: view.getUint32(eocd + 12, true),
    offset: view.getUint32(eocd + 16, true),
  };
  if (
    location.entryCount === MAX_UINT16 ||
    location.size === MAX_UINT32 ||
    location.offset === MAX_UINT32
  ) {
    const zip64 = readZip64Location(view, eocd);
    if (!zip64) return null;
    location = zip64;
  }

  const entries: ZipDirectoryEntry[] = [];
  const end = Math.min(location.offset + location.size, bytes.byteLength);
  let at = location.offset;
  while (
    at >= 0 &&
    at + CENTRAL_FILE_HEADER_LENGTH <= end &&
    view.getUint32(at, true) === CENTRAL_FILE_SIGNATURE
  ) {
    const declared = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const nameAt = at + CENTRAL_FILE_HEADER_LENGTH;
    const extraAt = nameAt + nameLength;
    if (extraAt + extraLength > bytes.byteLength) break;

    entries.push({
      name: decodeName(bytes.subarray(nameAt, extraAt)),
      size: declared === MAX_UINT32 ? readZip64Size(view, extraAt, extraLength) : declared,
    });
    at = extraAt + extraLength + commentLength;
  }

  return { declaredEntryCount: location.entryCount, entries };
}
