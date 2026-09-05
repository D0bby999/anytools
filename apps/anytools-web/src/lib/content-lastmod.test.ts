import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Points CONTENT_ROOT at a scratch dir per test; the module caches the table for the
// process lifetime, so each test re-imports a fresh copy.
async function loadWith(table: Record<string, string> | null) {
  const dir = mkdtempSync(join(tmpdir(), 'lastmod-'));
  if (table) writeFileSync(join(dir, '.lastmod.json'), JSON.stringify(table));
  vi.stubEnv('CONTENT_ROOT', dir);
  vi.resetModules();
  const mod = await import('./content-lastmod');
  return { mod, dir };
}

describe('content-lastmod', () => {
  let dir: string | undefined;
  beforeEach(() => {
    dir = undefined;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined for everything when the table is absent', async () => {
    const r = await loadWith(null);
    dir = r.dir;
    expect(r.mod.toolLastModified('en', 'pdf', 'merge-pdf')).toBeUndefined();
    expect(r.mod.clusterLastModified('en', 'pdf')).toBeUndefined();
    expect(r.mod.guideLastModified('en', 'pdf-guide')).toBeUndefined();
  });

  it('takes the newest date among a tool’s faq/tutorial files', async () => {
    const r = await loadWith({
      'en/tools/pdf/merge-pdf-faq.mdx': '2026-08-01T00:00:00+00:00',
      'en/tools/pdf/merge-pdf-tutorial.mdx': '2026-09-02T10:00:00+00:00',
      'en/tools/pdf/split-pdf-faq.mdx': '2026-07-01T00:00:00+00:00',
    });
    dir = r.dir;
    expect(r.mod.toolLastModified('en', 'pdf', 'merge-pdf')?.toISOString()).toBe(
      '2026-09-02T10:00:00.000Z',
    );
    expect(r.mod.toolLastModified('en', 'pdf', 'split-pdf')?.toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
    // A cluster is as fresh as its newest tool body.
    expect(r.mod.clusterLastModified('en', 'pdf')?.toISOString()).toBe('2026-09-02T10:00:00.000Z');
    // Other locales share nothing with English.
    expect(r.mod.toolLastModified('vi', 'pdf', 'merge-pdf')).toBeUndefined();
  });

  it('matches guides by exact file path', async () => {
    const r = await loadWith({
      'vi/guides/pdf-guide.mdx': '2026-05-05T00:00:00+00:00',
      'vi/guides/pdf-guide-2.mdx': '2026-06-06T00:00:00+00:00',
    });
    dir = r.dir;
    expect(r.mod.guideLastModified('vi', 'pdf-guide')?.toISOString()).toBe(
      '2026-05-05T00:00:00.000Z',
    );
  });
});
