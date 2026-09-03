// @vitest-environment node
// The libarchive path needs a real Worker and a real WASM fetch, which neither happy-dom nor
// node provides — it is verified in the browser lane (docs/tool-runtime-verification.md).
// Everything here is the part that decides WHETHER that path runs, plus the jszip path, which
// runs fine in node.
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  ArchiveError,
  MAX_ENTRIES,
  MAX_TOTAL_BYTES,
  detectFormat,
  enforceArchiveLimits,
  openArchive,
  repackAll,
} from './logic';

const head = (bytes: number[], offset = 0, length = 512) => {
  const buf = new Uint8Array(length);
  buf.set(bytes, offset);
  return buf;
};

/**
 * A real zip, written here so the test does not depend on a gitignored fixture.
 * `declaredSize` overrides the uncompressed-size header — which is exactly what a zip bomb
 * does, and how a 3 GB entry can be tested without writing 3 GB.
 */
function buildZip(
  files: { name: string; body: string; declaredSize?: number }[],
  encrypted = false,
) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const flag = encrypted ? 0x0801 : 0x0800;
  for (const { name, body, declaredSize } of files) {
    const raw = Buffer.from(body, 'utf8');
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const size = declaredSize ?? raw.length;
    // crc32 of the plaintext; jszip only verifies it after inflating.
    const crc = crc32(raw) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flag, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flag, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

const asFile = (bytes: Buffer | Uint8Array, name: string) =>
  new File([new Uint8Array(bytes)], name);

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

  it('recognises real archives this repository can produce', async () => {
    const zip = buildZip([{ name: 'a.txt', body: 'alpha' }]);
    expect(detectFormat(new Uint8Array(zip))).toBe('zip');
    expect(detectFormat(new Uint8Array(gzipSync(Buffer.from('x'))))).toBe('gzip');
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

  it('refuses a declared expansion past 2 GB, and says where it stopped', () => {
    const gb = 1024 * 1024 * 1024;
    expect(() => enforceArchiveLimits([{ size: 3 * gb }])).toThrow(/more than 2 GB.*entry 1 of 1/s);
    expect(() => enforceArchiveLimits([{ size: gb }, { size: gb }, { size: 1 }])).toThrow(
      /entry 3 of 3/,
    );
    // Exactly at the ceiling is fine; the check is "past", not "at".
    expect(() => enforceArchiveLimits([{ size: MAX_TOTAL_BYTES }])).not.toThrow();
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
    await expect(openArchive(asFile(Buffer.from('%PDF-1.7'), 'a.pdf'))).rejects.toThrow(
      /does not look like/,
    );
  });

  it('asks for a password on an encrypted zip rather than failing obscurely', async () => {
    // jszip refuses encrypted entries; without a password there is nothing libarchive could
    // do either, so the WASM must not be fetched to find that out.
    const encrypted = asFile(buildZip([{ name: 'a.txt', body: 'secret' }], true), 'secret.zip');
    await expect(openArchive(encrypted)).rejects.toThrow(/encrypted.*password/is);
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

  it('applies the zip-bomb ceiling to a real zip before extracting', async () => {
    // 60,000 entries of one byte: under the size ceiling, past the entry ceiling.
    const many = Array.from({ length: MAX_ENTRIES + 10_000 }, (_, i) => ({
      name: `f${i}.txt`,
      body: 'x',
    }));
    await expect(openArchive(asFile(buildZip(many), 'many.zip'))).rejects.toThrow(ArchiveError);
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
});
