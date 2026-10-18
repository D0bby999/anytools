// @vitest-environment node
// libarchive.js itself needs a Worker and a WASM fetch, so the browser lane covers the real
// reader (docs/tool-runtime-verification.md). What is testable here — and what actually broke —
// is the contract around it: every failure between "the worker exists" and "a session is
// returned" must close that worker, because close() is the only thing that frees the WASM heap
// holding the whole archive. A leaked reader is invisible until a tab has several.
import { describe, expect, it } from 'vitest';
import { ArchiveError, createExtractionBudget } from './archive-limits';
import {
  type CompressedEntry,
  type LibarchiveReader,
  sessionFromReader,
} from './libarchive-session';

const entry = (path: string, name: string, size: number, body = 'x'): CompressedEntry => ({
  path,
  file: { name, size, extract: async () => new File([body], name) },
});

/** A reader that counts its own closures, so the test can assert the worker was released. */
function fakeReader(overrides: Partial<LibarchiveReader> & { entries?: CompressedEntry[] } = {}): {
  reader: LibarchiveReader;
  closes: () => number;
} {
  let closes = 0;
  const reader: LibarchiveReader = {
    usePassword: overrides.usePassword ?? (async () => undefined),
    getFilesArray: overrides.getFilesArray ?? (async () => overrides.entries ?? []),
    close:
      overrides.close ??
      (async () => {
        closes += 1;
      }),
  };
  return { reader, closes: () => closes };
}

const budget = () => createExtractionBudget();

describe('sessionFromReader, close-on-failure', () => {
  it('closes the reader when the password is rejected', async () => {
    const { reader, closes } = fakeReader({
      usePassword: async () => {
        throw new Error('Passphrase required for this entry');
      },
    });
    await expect(sessionFromReader(reader, budget(), 'wrong')).rejects.toThrow(
      /That password did not open the archive/,
    );
    await expect(sessionFromReader(reader, budget(), 'wrong')).rejects.toMatchObject({
      code: 'wrongPassword',
    });
    expect(closes()).toBe(2);
  });

  it('closes the reader when listing fails', async () => {
    const { reader, closes } = fakeReader({
      getFilesArray: async () => {
        throw new Error('Unrecognized archive format');
      },
    });
    await expect(sessionFromReader(reader, budget())).rejects.toThrow(/could not be read/);
    await expect(sessionFromReader(reader, budget())).rejects.toMatchObject({
      code: 'unsupportedVariant',
      params: { detail: 'Unrecognized archive format' },
    });
    expect(closes()).toBe(2);
  });

  it('closes the reader when the archive is past the size ceiling', async () => {
    const gb = 1024 * 1024 * 1024;
    const { reader, closes } = fakeReader({ entries: [entry('', 'huge.bin', 3 * gb)] });
    await expect(sessionFromReader(reader, budget())).rejects.toThrow(ArchiveError);
    await expect(sessionFromReader(reader, budget())).rejects.toThrow(/more than 2 GB/);
    expect(closes()).toBe(2);
  });

  it('reports the limit failure as itself, not wrapped in "could not be read"', async () => {
    const { reader } = fakeReader({ entries: [entry('', 'huge.bin', 3 * 1024 * 1024 * 1024)] });
    const error = await sessionFromReader(reader, budget()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArchiveError);
  });

  it('does not close the reader on the way to a working session', async () => {
    const { reader, closes } = fakeReader({ entries: [entry('docs/', 'a.txt', 1)] });
    const session = await sessionFromReader(reader, budget());
    expect(closes()).toBe(0);
    await session.close();
    expect(closes()).toBe(1);
  });

  it('survives a reader whose close() throws, keeping the original failure', async () => {
    const { reader } = fakeReader({
      getFilesArray: async () => {
        throw new Error('Unrecognized archive format');
      },
      close: async () => {
        throw new Error('worker already gone');
      },
    });
    await expect(sessionFromReader(reader, budget())).rejects.toThrow(/Unrecognized archive/);
  });
});

describe('sessionFromReader, listing', () => {
  it('keeps duplicate names apart instead of collapsing them into one entry', async () => {
    // tar keeps every version of a file it was handed; a Map keyed on the joined path used to
    // drop all but the last, so the listing was missing files the archive really contained.
    const { reader } = fakeReader({
      entries: [
        entry('docs/', 'notes.md', 10, 'first'),
        entry('docs/', 'notes.md', 20, 'second'),
        entry('', 'readme.txt', 5),
      ],
    });
    const session = await sessionFromReader(reader, budget());
    expect(session.entries.map((e) => e.path)).toEqual([
      'docs/notes.md',
      'docs/notes (2).md',
      'readme.txt',
    ]);
    expect(await (await session.extract('docs/notes.md')).text()).toBe('first');
    expect(await (await session.extract('docs/notes (2).md')).text()).toBe('second');
  });

  it('refuses a 3 GB entry that libarchive reports as a negative size', async () => {
    // Measured in the browser lane on 2026-09-03: a tar declaring 3 GB came back as
    // -1,073,741,824, the UI printed "-1048576.0 KB", and the ceiling let it through.
    const { reader, closes } = fakeReader({ entries: [entry('', 'zeros.bin', -1_073_741_824)] });
    await expect(sessionFromReader(reader, budget())).rejects.toThrow(/more than 2 GB/);
    expect(closes()).toBe(1);
  });

  it('counts extracted bytes against the shared budget', async () => {
    const { reader } = fakeReader({ entries: [entry('', 'a.bin', 1, 'x'.repeat(3000))] });
    const session = await sessionFromReader(reader, createExtractionBudget(2000));
    await expect(session.extract('a.bin')).rejects.toThrow(/already produced more than/);
  });

  it('names an entry that is not in the archive', async () => {
    const { reader } = fakeReader({ entries: [entry('', 'a.txt', 1)] });
    const session = await sessionFromReader(reader, budget());
    await expect(session.extract('nope.txt')).rejects.toThrow(/is not in this archive/);
    await expect(session.extract('nope.txt')).rejects.toMatchObject({
      code: 'notInArchive',
      params: { path: 'nope.txt' },
    });
  });
});
