// @vitest-environment node
// The libarchive path needs a real Worker and a real WASM fetch, which neither happy-dom nor
// node provides — it is verified in the browser lane (docs/tool-runtime-verification.md) and,
// for the parts that are pure logic, in libarchive-session.test.ts.
// Everything here is the part that decides WHETHER that path runs, plus the jszip path, which
// runs fine in node.
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createExtractionBudget, unsignedSize } from './archive-limits';
import { openWithJsZip } from './jszip-session';
import {
  ArchiveError,
  MAX_ENTRIES,
  MAX_TOTAL_BYTES,
  detectFormat,
  enforceArchiveLimits,
  openArchive,
  repackAll,
} from './logic';

const GIB = 1024 * 1024 * 1024;
const ZIP64_MARKER = 0xffffffff;

const head = (bytes: number[], offset = 0, length = 512) => {
  const buf = new Uint8Array(length);
  buf.set(bytes, offset);
  return buf;
};

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const block = (length: number) => {
  const buf = new Uint8Array(length);
  return { buf, view: new DataView(buf.buffer) };
};

type ZipEntrySpec = {
  name: string;
  body: string;
  /** Raw value for the 4-byte uncompressed-size field — a zip bomb's whole trick. */
  declaredSize?: number;
  /** Sets the 4-byte field to the ZIP64 marker and puts this 8-byte size in an extra field. */
  zip64Size?: number;
  /** `truncate` writes a ZIP64 extra field too short to hold a size. */
  zip64Extra?: 'full' | 'truncate';
};

/**
 * A real zip, written here so the test does not depend on a gitignored fixture. Uint8Array
 * throughout: node's Buffer is not assignable to the Uint8Array these APIs are typed against.
 */
function buildZip(files: ZipEntrySpec[], encrypted = false): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const flag = encrypted ? 0x0801 : 0x0800;
  for (const spec of files) {
    const raw = new TextEncoder().encode(spec.body);
    const data = new Uint8Array(deflateRawSync(raw));
    const name = new TextEncoder().encode(spec.name);
    const zip64 = spec.zip64Size !== undefined;
    const size = zip64 ? ZIP64_MARKER : (spec.declaredSize ?? raw.length);
    // crc32 of the plaintext; jszip only verifies it after inflating.
    const crc = crc32(raw) >>> 0;

    let extra = new Uint8Array(0);
    if (zip64) {
      const payload = spec.zip64Extra === 'truncate' ? 4 : 8;
      const field = block(4 + payload);
      field.view.setUint16(0, 0x0001, true);
      field.view.setUint16(2, payload, true);
      if (payload === 8) field.view.setBigUint64(4, BigInt(spec.zip64Size ?? 0), true);
      extra = field.buf;
    }

    const local = block(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, zip64 ? 45 : 20, true);
    local.view.setUint16(6, flag, true);
    local.view.setUint16(8, 8, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, size, true);
    local.view.setUint16(26, name.length, true);
    parts.push(local.buf, name, data);

    const cd = block(46);
    cd.view.setUint32(0, 0x02014b50, true);
    cd.view.setUint16(4, zip64 ? 45 : 20, true);
    cd.view.setUint16(6, zip64 ? 45 : 20, true);
    cd.view.setUint16(8, flag, true);
    cd.view.setUint16(10, 8, true);
    cd.view.setUint32(16, crc, true);
    cd.view.setUint32(20, data.length, true);
    cd.view.setUint32(24, size, true);
    cd.view.setUint16(28, name.length, true);
    cd.view.setUint16(30, extra.length, true);
    cd.view.setUint32(42, offset, true);
    central.push(cd.buf, name, extra);
    offset += local.buf.length + name.length + data.length;
  }
  const cdBuf = concat(central);
  const eocd = block(22);
  eocd.view.setUint32(0, 0x06054b50, true);
  eocd.view.setUint16(8, files.length, true);
  eocd.view.setUint16(10, files.length, true);
  eocd.view.setUint32(12, cdBuf.length, true);
  eocd.view.setUint32(16, offset, true);
  return concat([...parts, cdBuf, eocd.buf]);
}

const asFile = (bytes: Uint8Array, name: string) => new File([bytes], name);

describe('detectFormat', () => {
  it('reads the four zip-family and container signatures', () => {
    expect(detectFormat(head([0x50, 0x4b, 0x03, 0x04]))).toBe('zip');
    expect(detectFormat(head([0x50, 0x4b, 0x05, 0x06]))).toBe('zip');
    expect(detectFormat(head([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBe('7z');
    expect(detectFormat(head([0x1f, 0x8b, 0x08]))).toBe('gzip');
  });

  it('reads RAR4 and RAR5, which share a prefix', () => {
    expect(detectFormat(head([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]))).toBe('rar');
    expect(detectFormat(head([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]))).toBe('rar');
  });

  it('finds ustar 257 bytes in, where tar hides its only marker', () => {
    expect(detectFormat(head([0x75, 0x73, 0x74, 0x61, 0x72], 257))).toBe('tar');
    // The same bytes anywhere else are not a tar.
    expect(detectFormat(head([0x75, 0x73, 0x74, 0x61, 0x72], 0))).toBeNull();
  });

  it('returns null for anything else', () => {
    expect(detectFormat(head([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // %PDF
    expect(detectFormat(new Uint8Array(0))).toBeNull();
  });

  it('recognises real archives this repository can produce', () => {
    expect(detectFormat(buildZip([{ name: 'a.txt', body: 'alpha' }]))).toBe('zip');
    expect(detectFormat(new Uint8Array(gzipSync(new TextEncoder().encode('x'))))).toBe('gzip');
  });
});

describe('enforceArchiveLimits', () => {
  it('passes an ordinary archive', () => {
    expect(() => enforceArchiveLimits([{ size: 1024 }, { size: 5 * 1024 * 1024 }])).not.toThrow();
  });

  it('refuses more than 50,000 entries', () => {
    const entries = Array.from({ length: MAX_ENTRIES + 1 }, () => ({ size: 1 }));
    expect(() => enforceArchiveLimits(entries)).toThrow(ArchiveError);
    expect(() => enforceArchiveLimits(entries)).toThrow(/50,001 entries/);
    // The boundary itself is allowed.
    expect(() => enforceArchiveLimits(entries.slice(0, MAX_ENTRIES))).not.toThrow();
  });

  it('refuses on the count the archive declares, before any entry is in hand', () => {
    expect(() => enforceArchiveLimits([], MAX_ENTRIES + 1)).toThrow(/50,001 entries/);
    expect(() => enforceArchiveLimits([{ size: 1 }], 10)).not.toThrow();
  });

  it('refuses a declared expansion past 2 GB, and says where it stopped', () => {
    expect(() => enforceArchiveLimits([{ size: 3 * GIB }])).toThrow(
      /more than 2 GB.*entry 1 of 1/s,
    );
    expect(() => enforceArchiveLimits([{ size: GIB }, { size: GIB }, { size: 1 }])).toThrow(
      /entry 3 of 3/,
    );
    // Exactly at the ceiling is fine; the check is "past", not "at".
    expect(() => enforceArchiveLimits([{ size: MAX_TOTAL_BYTES }])).not.toThrow();
  });

  it('refuses a negative size instead of counting it as zero', () => {
    // Clamping to zero is how a 3 GB tar walked through this guard in the lane: libarchive
    // reported -1,073,741,824 and `Math.max(0, size)` turned the bomb into an empty file.
    expect(() => enforceArchiveLimits([{ size: -1_073_741_824 }])).toThrow(ArchiveError);
    expect(() => enforceArchiveLimits([{ size: 10 }, { size: -1 }])).toThrow(
      /Entry 2 of 2 does not state a size/,
    );
    expect(() => enforceArchiveLimits([{ size: Number.NaN }])).toThrow(/does not state a size/);
  });

  it('names each refusal with a code and params for the widget to localize', () => {
    expect(() => enforceArchiveLimits([], MAX_ENTRIES + 1)).toThrow(
      expect.objectContaining({
        code: 'tooManyEntries',
        params: { count: MAX_ENTRIES + 1, max: MAX_ENTRIES },
      }),
    );
    expect(() => enforceArchiveLimits([{ size: 10 }, { size: -1 }])).toThrow(
      expect.objectContaining({ code: 'unknownEntrySize', params: { index: 2, total: 2 } }),
    );
    expect(() => enforceArchiveLimits([{ size: 3 * GIB }])).toThrow(
      expect.objectContaining({ code: 'declaredTooBig', params: { index: 1, total: 1 } }),
    );
    const budget = createExtractionBudget(1024);
    expect(() => budget.spend(2048)).toThrow(
      expect.objectContaining({ code: 'budgetExceeded', params: { limit: '1 KB' } }),
    );
  });

  it('recovers a size a signed 32-bit reader mangled', () => {
    expect(unsignedSize(-1_073_741_824)).toBe(3 * GIB);
    expect(unsignedSize(0x7fff_ffff)).toBe(0x7fff_ffff);
    expect(unsignedSize(0)).toBe(0);
  });
});

describe('openArchive', () => {
  it('lists a zip with jszip, without touching libarchive', async () => {
    const zip = asFile(
      buildZip([
        { name: 'readme.txt', body: 'hello' },
        { name: 'docs/notes.md', body: '# notes' },
      ]),
      'sample.zip',
    );
    const session = await openArchive(zip);
    expect(session.engine).toBe('jszip');
    expect(session.kind).toBe('zip');
    expect(session.entries).toEqual([
      { path: 'readme.txt', size: 5 },
      { path: 'docs/notes.md', size: 7 },
    ]);
    expect(await (await session.extract('readme.txt')).text()).toBe('hello');
    await session.close();
  });

  it('rejects a file whose bytes are not an archive', async () => {
    await expect(
      openArchive(asFile(new TextEncoder().encode('%PDF-1.7'), 'a.pdf')),
    ).rejects.toThrow(/does not look like/);
  });

  it('asks for a password on an encrypted zip rather than failing obscurely', async () => {
    // jszip refuses encrypted entries; without a password there is nothing libarchive could
    // do either, so the WASM must not be fetched to find that out.
    const encrypted = asFile(buildZip([{ name: 'a.txt', body: 'secret' }], true), 'secret.zip');
    await expect(openArchive(encrypted)).rejects.toThrow(/encrypted.*password/is);
    await expect(openArchive(encrypted)).rejects.toMatchObject({ code: 'zipEncrypted' });
  });

  it('refuses a zip bomb whose 3 GB entry jszip reports as a NEGATIVE size', async () => {
    // The browser lane caught this on 2026-09-03: a real 3 GB bomb sailed through, because
    // jszip builds the 4-byte size with signed shifts and 0xC0000000 reads as -1,073,741,824.
    const bomb = buildZip([{ name: 'zeros.bin', body: 'x', declaredSize: 0xc000_0000 }]);
    await expect(openArchive(asFile(bomb, 'bomb.zip'))).rejects.toThrow(/more than 2 GB/);
  });

  it('reads a size just under 2 GiB as itself, not as a negative', async () => {
    const big = buildZip([{ name: 'big.bin', body: 'x', declaredSize: 0x7fff_ffff }]);
    const session = await openArchive(asFile(big, 'big.zip'));
    expect(session.entries[0]?.size).toBe(0x7fff_ffff);
  });

  it('refuses an archive jszip would silently load one file short', async () => {
    // jszip resolves `..` out of an entry name as it loads and keys its file map on the result,
    // so `../config.json` lands on top of `config.json` and one file disappears before this
    // tool can see it. Three entries in, two out: say so rather than hand over the survivor.
    const zip = buildZip([
      { name: '../config.json', body: 'outer' },
      { name: 'config.json', body: 'inner' },
      { name: 'docs/notes.md', body: '# notes' },
    ]);
    await expect(openArchive(asFile(zip, 'collapse.zip'))).rejects.toThrow(
      /3 files but only 2 of them have distinct paths/,
    );
  });

  it('does not mistake an ordinary traversal name for a collapsed archive', async () => {
    // `../../etc/passwd` resolves to a path nothing else claims: two entries in, two out.
    const zip = buildZip([
      { name: '../../etc/passwd', body: 'root' },
      { name: 'docs/ok.txt', body: 'fine' },
    ]);
    const session = await openArchive(asFile(zip, 'evil.zip'));
    expect(session.entries.map((e) => e.path)).toEqual(['etc/passwd', 'docs/ok.txt']);
  });

  it('applies the zip-bomb ceiling to a real zip before extracting', async () => {
    // 60,000 entries of one byte: under the size ceiling, past the entry ceiling.
    const many = Array.from({ length: MAX_ENTRIES + 10_000 }, (_, i) => ({
      name: `f${i}.txt`,
      body: 'x',
    }));
    await expect(openArchive(asFile(buildZip(many), 'many.zip'))).rejects.toThrow(ArchiveError);
  });
});

describe('openArchive, ZIP64 sizes', () => {
  // Measured against jszip 3.10.1: 4 GiB and 64 GiB come back `undefined`, 5 GiB comes back as
  // 1 GiB. Every one of those walks straight through a ceiling that trusts jszip's number.
  it.each([
    ['4 GiB', 4 * GIB],
    ['5 GiB', 5 * GIB],
    ['64 GiB', 64 * GIB],
  ])('refuses a tiny stream declaring %s in a ZIP64 field', async (_label, declared) => {
    const zip = buildZip([{ name: 'zeros.bin', body: 'x', zip64Size: declared }]);
    await expect(openArchive(asFile(zip, 'zip64.zip'))).rejects.toThrow(ArchiveError);
    await expect(openArchive(asFile(zip, 'zip64.zip'))).rejects.toThrow(/more than 2 GB/);
  });

  it('refuses a ZIP64 marker with no extra field to read the real size from', async () => {
    const zip = buildZip([{ name: 'zeros.bin', body: 'x', declaredSize: ZIP64_MARKER }]);
    await expect(openArchive(asFile(zip, 'orphan.zip'))).rejects.toThrow(/size.*unknown|unknown/is);
  });

  it('refuses a ZIP64 extra field too short to hold the size it promises', async () => {
    const zip = buildZip([
      { name: 'zeros.bin', body: 'x', zip64Size: 5 * GIB, zip64Extra: 'truncate' },
    ]);
    await expect(openArchive(asFile(zip, 'truncated.zip'))).rejects.toThrow(ArchiveError);
  });

  it('still opens a small file whose writer used ZIP64 fields anyway', async () => {
    // Some archivers always write ZIP64. Refusing every one of them would be a false positive;
    // the rule is "unknown or past the ceiling", not "ZIP64".
    const zip = buildZip([{ name: 'small.txt', body: 'hello', zip64Size: 5 }]);
    const session = await openArchive(asFile(zip, 'forced.zip'));
    expect(session.entries).toEqual([{ path: 'small.txt', size: 5 }]);
    expect(await (await session.extract('small.txt')).text()).toBe('hello');
  });
});

describe('extraction budget', () => {
  it('stops an entry that expands far past the size it declared', async () => {
    // The declared size is the attacker's number. This entry says one byte and inflates to
    // 400 KB; only counting the bytes that actually arrive catches that.
    const zip = buildZip([{ name: 'lies.bin', body: 'z'.repeat(400_000), declaredSize: 1 }]);
    const session = await openWithJsZip(asFile(zip, 'lies.zip'), createExtractionBudget(64 * 1024));
    expect(session.entries).toEqual([{ path: 'lies.bin', size: 1 }]);
    await expect(session.extract('lies.bin')).rejects.toThrow(/already produced more than/);
  });

  it('is shared across entries, so a session cannot be drained one file at a time', async () => {
    const zip = buildZip([
      { name: 'a.bin', body: 'a'.repeat(40_000) },
      { name: 'b.bin', body: 'b'.repeat(40_000) },
    ]);
    const session = await openWithJsZip(asFile(zip, 'two.zip'), createExtractionBudget(50_000));
    expect((await session.extract('a.bin')).size).toBe(40_000);
    await expect(session.extract('b.bin')).rejects.toThrow(/already produced more than/);
  });
});

describe('repackAll', () => {
  it('re-zips every entry and strips traversal from the paths', async () => {
    const session = await openArchive(
      asFile(
        buildZip([
          { name: '../../etc/passwd', body: 'root' },
          { name: 'docs/ok.txt', body: 'fine' },
        ]),
        'evil.zip',
      ),
    );
    const seen: number[] = [];
    const blob = await repackAll(session, (done) => seen.push(done));
    expect(seen).toEqual([1, 2]);

    const { default: JSZip } = await import('jszip');
    const read = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.values(read.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(names).toEqual(['docs/ok.txt', 'etc/passwd']);
    expect(await read.file('etc/passwd')?.async('string')).toBe('root');
  });

  it('keeps all three files when normalising makes two paths collide', async () => {
    // A zip written on Windows carries backslashes, which jszip treats as part of one segment
    // and this tool turns into separators — so `..\config.json` and `config.json` arrive as two
    // entries and normalise to one path. zip.file() would overwrite, and the user would receive
    // two files after being shown three.
    const session = await openArchive(
      asFile(
        buildZip([
          { name: '..\\config.json', body: 'outer' },
          { name: 'config.json', body: 'inner' },
          { name: 'docs/notes.md', body: '# notes' },
        ]),
        'collide.zip',
      ),
    );
    expect(session.entries).toHaveLength(3);
    const blob = await repackAll(session);

    const { default: JSZip } = await import('jszip');
    const read = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.values(read.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(names).toEqual(['config (2).json', 'config.json', 'docs/notes.md']);
    expect(await read.file('config.json')?.async('string')).toBe('outer');
    expect(await read.file('config (2).json')?.async('string')).toBe('inner');
  });
});
