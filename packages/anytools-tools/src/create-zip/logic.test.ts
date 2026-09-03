// @vitest-environment node
// happy-dom has no working Blob→ArrayBuffer round trip for jszip's blob output; node 22 does,
// and nothing in this module touches the DOM.
import { describe, expect, it } from 'vitest';
import { CreateZipError, createZip, planEntryPaths } from './logic';

const file = (name: string, body: string, lastModified = Date.UTC(2024, 0, 2)) =>
  new File([body], name, { lastModified });

describe('planEntryPaths', () => {
  it('keeps ordinary names untouched', () => {
    expect(planEntryPaths(['a.txt', 'notes/b.md'])).toEqual(['a.txt', 'notes/b.md']);
  });

  it('strips traversal and absolute prefixes', () => {
    expect(planEntryPaths(['../../etc/passwd', '/var/log/x.log', 'C:\\Users\\me\\a.txt'])).toEqual([
      'etc/passwd',
      'var/log/x.log',
      'Users/me/a.txt',
    ]);
  });

  it('renames collisions instead of dropping the second file', () => {
    expect(planEntryPaths(['photo.jpg', 'photo.jpg', 'photo.jpg'])).toEqual([
      'photo.jpg',
      'photo (2).jpg',
      'photo (3).jpg',
    ]);
  });

  it('nests everything under a normalised root folder', () => {
    expect(planEntryPaths(['a.txt', 'b.txt'], '../my zip/')).toEqual([
      'my zip/a.txt',
      'my zip/b.txt',
    ]);
  });

  it('never produces an empty entry name', () => {
    expect(planEntryPaths(['../..', '/'])).toEqual(['unnamed', 'unnamed (2)']);
  });
});

describe('createZip', () => {
  it('refuses an empty selection', async () => {
    await expect(createZip([], { level: 6 })).rejects.toBeInstanceOf(CreateZipError);
  });

  it('writes every file, and jszip reads back the same names and bytes', async () => {
    const files = [file('a.txt', 'alpha'), file('b.txt', 'beta'), file('dir/c.txt', 'gamma')];
    const result = await createZip(files, { level: 6 });

    expect(result.paths).toEqual(['a.txt', 'b.txt', 'dir/c.txt']);
    expect(result.inputBytes).toBe(5 + 4 + 5);
    expect(result.outputBytes).toBe(result.blob.size);

    const { default: JSZip } = await import('jszip');
    const read = await JSZip.loadAsync(await result.blob.arrayBuffer());
    // jszip also materialises the implicit `dir/` folder entry; only files are asserted.
    const names = Object.values(read.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(names).toEqual(['a.txt', 'b.txt', 'dir/c.txt']);
    expect(await read.file('a.txt')?.async('string')).toBe('alpha');
    expect(await read.file('dir/c.txt')?.async('string')).toBe('gamma');
  });

  it('applies the root folder and the collision rename to the real archive', async () => {
    const result = await createZip([file('x.txt', 'one'), file('x.txt', 'two')], {
      level: 9,
      rootFolder: 'bundle',
    });
    const { default: JSZip } = await import('jszip');
    const read = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(await read.file('bundle/x.txt')?.async('string')).toBe('one');
    expect(await read.file('bundle/x (2).txt')?.async('string')).toBe('two');
  });

  it('level 0 stores: the entry is not smaller than its input', async () => {
    const body = 'repeat '.repeat(500);
    const stored = await createZip([file('r.txt', body)], { level: 0 });
    const deflated = await createZip([file('r.txt', body)], { level: 9 });
    expect(stored.outputBytes).toBeGreaterThan(body.length);
    expect(deflated.outputBytes).toBeLessThan(stored.outputBytes);
  });

  it('reports progress that ends at 100', async () => {
    const seen: number[] = [];
    await createZip([file('a.txt', 'alpha')], { level: 6 }, (p) => seen.push(p));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe(100);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
  });
});
