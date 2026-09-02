import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// CONTENT_ROOT is read at module load, so the fixture has to be in place and the
// env var set before the import — hence the dynamic import inside beforeAll.
let hasLocalizedToolBody: (locale: string, cluster: string, slug: string) => boolean;
let root: string;
const previousRoot = process.env.CONTENT_ROOT;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'anytools-content-'));
  mkdirSync(join(root, 'en', 'tools', 'encoding'), { recursive: true });
  mkdirSync(join(root, 'es', 'tools', 'encoding'), { recursive: true });
  // English tool: both files. Spanish: tutorial only. Portuguese: directory absent.
  writeFileSync(join(root, 'en', 'tools', 'encoding', 'base64-encode-faq.mdx'), '## Q?\nA.\n');
  writeFileSync(join(root, 'en', 'tools', 'encoding', 'base64-encode-tutorial.mdx'), 'Body.\n');
  writeFileSync(join(root, 'es', 'tools', 'encoding', 'base64-encode-tutorial.mdx'), 'Cuerpo.\n');
  process.env.CONTENT_ROOT = root;
  ({ hasLocalizedToolBody } = await import('./has-localized-tool-body'));
});

afterAll(() => {
  if (previousRoot === undefined) delete process.env.CONTENT_ROOT;
  else process.env.CONTENT_ROOT = previousRoot;
});

describe('hasLocalizedToolBody', () => {
  it('is true when both tutorial and FAQ exist', () =>
    expect(hasLocalizedToolBody('en', 'encoding', 'base64-encode')).toBe(true));

  it('is true when only one of the two exists — either alone is real prose', () =>
    expect(hasLocalizedToolBody('es', 'encoding', 'base64-encode')).toBe(true));

  it('is false when the locale directory does not exist at all', () =>
    expect(hasLocalizedToolBody('pt', 'encoding', 'base64-encode')).toBe(false));

  it('is false for a tool with no files in an otherwise populated locale', () =>
    expect(hasLocalizedToolBody('en', 'encoding', 'url-encode')).toBe(false));

  it('does not confuse a similarly named slug (prefix match must not count)', () => {
    // "base64" is a prefix of "base64-encode"; a sloppy startsWith check passes here.
    expect(hasLocalizedToolBody('en', 'encoding', 'base64')).toBe(false);
  });
});
