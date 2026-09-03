/**
 * Generate the archive fixtures used to verify create-zip and unzip-archive in a real browser.
 *
 * Nothing here is committed: run this and the files land in ../fixtures/ (gitignored).
 *
 *   sample.zip        three small text files in two folders — the plain jszip path.
 *   sample.tar.gz     the same three files as a gzipped ustar archive. NOT a zip, so opening it
 *                     is what proves the libarchive WASM is fetched on demand and not before.
 *   secret.zip        password `openme`, written by the macOS `zip -P` CLI (ZipCrypto). jszip
 *                     refuses encrypted entries by design; this is the libarchive password path.
 *   bomb.zip          ~3 MB that declares 3 GB of zeros in one entry. A real DEFLATE stream, not
 *                     a doctored header: the 2 GB guard must stop it before extraction.
 *   zip64-5gib.zip    a one-byte stream declaring 5 GiB in a ZIP64 extra field. jszip reads that
 *                     field as 1 GiB (its integer reader wraps at 32 bits), so a guard built on
 *                     jszip's number lets it through; this must be refused.
 *   collide.zip       three entries, two of which normalise to the same path (`..\config.json`
 *                     and `config.json`). All three must come back out of "extract all".
 *
 * The zip and tar containers are written by hand rather than with a library because the point
 * is to have a file whose bytes we chose. Run: node scripts/make-archive-fixtures.mjs
 */
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
mkdirSync(OUT, { recursive: true });

const crc32 = (buf, seed = 0) => zlib.crc32(buf, seed) >>> 0;

const ENTRIES = [
  { name: 'readme.txt', body: 'anytools archive fixture\n' },
  { name: 'docs/notes.md', body: `# notes\n\n${'a line of text\n'.repeat(40)}` },
  {
    name: 'docs/data.csv',
    body: `id,value\n${[...Array(50).keys()].map((i) => `${i},${i * 3}`).join('\n')}\n`,
  },
];

// --- zip writer -------------------------------------------------------------------------------
// Local header (30 + name), data, then a central directory of 46 + name each, then the EOCD.
// Deliberately not Zip64: every fixture stays well under 4 GB.
function zipFile(path, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data, crc, size, method, extra = Buffer.alloc(0) } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    // 45 is the version that announces ZIP64; the extra field only carries meaning with it.
    const version = extra.length > 0 ? 45 : 20;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(version, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(version, 4);
    cd.writeUInt16LE(version, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(extra.length, 30);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf, extra);

    offset += local.length + nameBuf.length + data.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  writeFileSync(path, Buffer.concat([...chunks, cdBuf, eocd]));
}

function sampleZip() {
  const entries = ENTRIES.map(({ name, body }) => {
    const raw = Buffer.from(body, 'utf8');
    return {
      name,
      data: zlib.deflateRawSync(raw, { level: 6 }),
      crc: crc32(raw),
      size: raw.length,
      method: 8,
    };
  });
  zipFile(join(OUT, 'sample.zip'), entries);
}

/** One entry of `total` zero bytes, deflated in 8 MB slices so nothing that large is buffered. */
async function bombZip(total = 3 * 1024 * 1024 * 1024) {
  const slice = Buffer.alloc(8 * 1024 * 1024);
  const parts = [];
  // A single streaming deflate: deflateRawSync per slice would restart the stream each time.
  const z = zlib.createDeflateRaw({ level: 9 });
  z.on('data', (d) => parts.push(d));
  const finished = new Promise((resolve, reject) => {
    z.on('end', resolve);
    z.on('error', reject);
  });
  let crc = 0;
  for (let written = 0; written < total; written += slice.length) {
    crc = crc32(slice, crc);
    // Without honouring backpressure the loop queues all 3 GB inside the stream.
    if (!z.write(slice)) await once(z, 'drain');
  }
  z.end();
  await finished;
  zipFile(join(OUT, 'bomb.zip'), [
    { name: 'zeros.bin', data: Buffer.concat(parts), crc, size: total, method: 8 },
  ]);
}

/** Deflate one small body into the shape zipFile() wants. */
const zipEntry = (name, body, extra) => {
  const raw = Buffer.from(body, 'utf8');
  return {
    name,
    data: zlib.deflateRawSync(raw, { level: 6 }),
    crc: crc32(raw),
    size: extra ? 0xffffffff : raw.length,
    method: 8,
    extra,
  };
};

/**
 * A one-byte entry whose real size lives in a ZIP64 extra field and says 5 GiB.
 *
 * jszip reads that 8-byte field with signed 32-bit shifts and returns 1 GiB, so a size ceiling
 * that trusts jszip waves this through. The 4-byte field carries the 0xFFFFFFFF marker that
 * says "look in the extra field", exactly as a real archiver writes it.
 */
function zip64Zip() {
  const extra = Buffer.alloc(12);
  extra.writeUInt16LE(0x0001, 0); // ZIP64 extended information
  extra.writeUInt16LE(8, 2); // one 8-byte value follows
  extra.writeBigUInt64LE(BigInt(5 * 1024 * 1024 * 1024), 4);
  zipFile(join(OUT, 'zip64-5gib.zip'), [zipEntry('zeros.bin', 'x', extra)]);
}

/**
 * Two entries that collapse onto one path once `..` and the Windows separator are stripped,
 * plus one that does not. Backslashes rather than `../`: jszip resolves a `/`-separated `..`
 * away while loading, so a slash version would never reach the repacking step this checks.
 */
function collideZip() {
  zipFile(join(OUT, 'collide.zip'), [
    zipEntry('..\\config.json', '{"from":"outside"}\n'),
    zipEntry('config.json', '{"from":"inside"}\n'),
    zipEntry('docs/notes.md', '# notes\n'),
  ]);
}

// --- tar.gz writer ----------------------------------------------------------------------------
// ustar: a 512-byte header per entry (checksum over the header with the checksum field blanked),
// the data padded to 512, then two empty blocks.
function tarBlock({ name, body }) {
  const data = Buffer.from(body, 'utf8');
  const header = Buffer.alloc(512, 0);
  header.write(name.slice(0, 100), 0, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write(
    `${Math.floor(Date.UTC(2024, 0, 2) / 1000)
      .toString(8)
      .padStart(11, '0')}\0`,
    136,
  );
  header.write('        ', 148); // checksum placeholder: eight spaces
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  const sum = header.reduce((n, b) => n + b, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, pad]);
}

function sampleTarGz() {
  const tar = Buffer.concat([...ENTRIES.map(tarBlock), Buffer.alloc(1024, 0)]);
  writeFileSync(join(OUT, 'sample.tar.gz'), zlib.gzipSync(tar, { level: 9 }));
}

/** ZipCrypto, via the CLI macOS ships. Skipped with a clear message where `zip` is absent. */
function secretZip() {
  const tmp = join(OUT, '.secret-src');
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, 'secret.txt'), 'the password was openme\n');
  rmSync(join(OUT, 'secret.zip'), { force: true });
  try {
    execFileSync('zip', ['-P', 'openme', '-j', join(OUT, 'secret.zip'), join(tmp, 'secret.txt')], {
      stdio: 'pipe',
    });
  } catch (e) {
    console.warn(`  ! secret.zip skipped: ${e.message.split('\n')[0]}`);
  }
  rmSync(tmp, { recursive: true, force: true });
}

sampleZip();
sampleTarGz();
secretZip();
zip64Zip();
collideZip();
await bombZip();
console.log(
  `fixtures written to ${OUT}: sample.zip sample.tar.gz secret.zip zip64-5gib.zip collide.zip bomb.zip`,
);
