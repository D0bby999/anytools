import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// CONTENT_ROOT is read at module load, so the fixture has to be in place and the
// env var set before the import — hence the dynamic import inside beforeAll.
let hasLocalizedToolBody: (locale: string, cluster: string, slug: string) => boolean;
let MIN_BODY_WORDS: number;
let root: string;
const previousRoot = process.env.CONTENT_ROOT;

/** n words of filler — the check counts words, it does not read them. */
const words = (n: number) => `${'lorem '.repeat(n).trim()}\n`;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'anytools-content-'));
  for (const loc of ['en', 'es', 'vi']) {
    mkdirSync(join(root, loc, 'tools', 'encoding'), { recursive: true });
  }
  const at = (loc: string, file: string) => join(root, loc, 'tools', 'encoding', file);

  // English: a full FAQ on its own clears the floor.
  writeFileSync(at('en', 'base64-encode-faq.mdx'), `## Question?\n\n${words(400)}`);
  // Spanish: tutorial only, also over the floor — either file alone is real prose.
  writeFileSync(at('es', 'base64-encode-tutorial.mdx'), words(400));
  // Vietnamese: two files that each fall short but together clear it. The check sums
  // them, so a tool split across a short FAQ and a short tutorial still counts.
  writeFileSync(at('vi', 'base64-encode-faq.mdx'), words(150));
  writeFileSync(at('vi', 'base64-encode-tutorial.mdx'), words(150));

  // The regression this guard exists for: a scaffolded placeholder. Long enough to
  // pass a naive word count, but it is a TODO marker, not a body.
  writeFileSync(at('en', 'url-encode-faq.mdx'), `TODO: write this\n\n${words(400)}`);
  // The mirror image: real prose that happens to discuss TODO comments must count.
  writeFileSync(
    at('en', 'prose-mentions-todo-faq.mdx'),
    `Use a regex to find TODO comments in a codebase.\n\n${words(400)}`,
  );
  // TODO is "all" in Spanish and Portuguese, and a bolded lead-in is ordinary. The corpus
  // already ships "TODOS os objetos". A line-initial-only rule deindexed this.
  writeFileSync(
    at('es', 'spanish-todo-lead-faq.mdx'),
    `**TODO lo que necesitas saber sobre JSON**\n\n${words(400)}`,
  );
  // Prose containing an unpaired `<`. A /<[^>]+>/ strip matches across newlines and eats
  // everything to the next `>` — measured at 120 words in one match on html-entity-tutorial.
  writeFileSync(
    at('en', 'angle-brackets-faq.mdx'),
    `Use \`&lt;\` for <, and \`&gt;\` for >.\n\n${words(320)}\n\nCompare a < b and c > d.\n`,
  );
  // A file that exists but says almost nothing — the case an existsSync check missed.
  writeFileSync(at('en', 'hex-encode-faq.mdx'), words(20));
  // Frontmatter, import lines and JSX *tags* must not be counted. Text nested inside a
  // component is left in on purpose — a reader sees it, so it is body content.
  writeFileSync(
    at('en', 'jwt-decoder-faq.mdx'),
    `---\ntitle: ${words(400)}---\nimport { Foo } from 'bar'\n\n<Callout type="warning" />\n\n${words(30)}`,
  );

  process.env.CONTENT_ROOT = root;
  ({ hasLocalizedToolBody, MIN_BODY_WORDS } = await import('./has-localized-tool-body'));
});

afterAll(() => {
  if (previousRoot === undefined) delete process.env.CONTENT_ROOT;
  else process.env.CONTENT_ROOT = previousRoot;
});

describe('hasLocalizedToolBody', () => {
  it('is true for a full FAQ', () =>
    expect(hasLocalizedToolBody('en', 'encoding', 'base64-encode')).toBe(true));

  it('is true when only one of the two files exists — either alone is real prose', () =>
    expect(hasLocalizedToolBody('es', 'encoding', 'base64-encode')).toBe(true));

  it('sums FAQ and tutorial rather than requiring either to clear the floor alone', () =>
    expect(hasLocalizedToolBody('vi', 'encoding', 'base64-encode')).toBe(true));

  it('is false when the locale directory does not exist at all', () =>
    expect(hasLocalizedToolBody('pt', 'encoding', 'base64-encode')).toBe(false));

  it('does not confuse a similarly named slug (prefix match must not count)', () => {
    // "base64" is a prefix of "base64-encode"; a sloppy startsWith check passes here.
    expect(hasLocalizedToolBody('en', 'encoding', 'base64')).toBe(false);
  });

  // The three cases below are why this is a word count and not an existsSync. Each
  // one PASSED the old check, which is how 150 bodyless pages reached the sitemap.
  it('rejects a TODO placeholder however long it is', () =>
    expect(hasLocalizedToolBody('en', 'encoding', 'url-encode')).toBe(false));

  it('rejects a file that exists but is far under the floor', () =>
    expect(hasLocalizedToolBody('en', 'encoding', 'hex-encode')).toBe(false));

  it('does not count frontmatter, imports or JSX tags as prose', () =>
    expect(hasLocalizedToolBody('en', 'encoding', 'jwt-decoder')).toBe(false));

  it('states its floor so a caller cannot drift from it', () => {
    expect(MIN_BODY_WORDS).toBe(300);
  });

  it('counts a body that merely mentions TODO in prose', () => {
    // regex-tester's tutorial talks about "finding TODO comments". A bare \bTODO\b
    // match zeroed it and made the whole corpus read thinner than it is.
    expect(hasLocalizedToolBody('en', 'encoding', 'prose-mentions-todo')).toBe(true);
  });

  it('counts Spanish prose opening with TODO ("all"), which is not a placeholder', () =>
    expect(hasLocalizedToolBody('es', 'encoding', 'spanish-todo-lead')).toBe(true));

  it('does not let an unpaired < swallow the rest of the document', () =>
    expect(hasLocalizedToolBody('en', 'encoding', 'angle-brackets')).toBe(true));
});
