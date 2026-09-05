import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Per-file last-modified dates for the MDX corpus, read from content/.lastmod.json
 * (written by scripts/generate-content-lastmod.mjs at image build time from git history).
 *
 * The sitemap is the only consumer. When the file is missing — local builds, shallow
 * clones, self-host images — every lookup returns undefined and the sitemap omits
 * `lastmod`, exactly as it did before the file existed.
 */

const CONTENT_ROOT = process.env.CONTENT_ROOT ?? join(process.cwd(), 'content');

let table: Record<string, string> | null | undefined;

function load(): Record<string, string> | null {
  if (table !== undefined) return table;
  const file = join(CONTENT_ROOT, '.lastmod.json');
  if (!existsSync(file)) {
    table = null;
    return table;
  }
  try {
    table = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  } catch {
    table = null;
  }
  return table;
}

/** Latest commit date among content files whose path starts with `prefix`. */
export function latestContentDate(prefix: string): Date | undefined {
  const dates = load();
  if (!dates) return undefined;
  let best: string | undefined;
  for (const [path, iso] of Object.entries(dates)) {
    if (path.startsWith(prefix) && (!best || iso > best)) best = iso;
  }
  return best ? new Date(best) : undefined;
}

export const toolLastModified = (locale: string, cluster: string, slug: string) =>
  latestContentDate(`${locale}/tools/${cluster}/${slug}-`);

export const clusterLastModified = (locale: string, cluster: string) =>
  latestContentDate(`${locale}/tools/${cluster}/`);

export const guideLastModified = (locale: string, slug: string) =>
  latestContentDate(`${locale}/guides/${slug}.mdx`);

/** Test seam: forget the cached table so a test can point CONTENT_ROOT elsewhere. */
export function resetContentLastModCache(): void {
  table = undefined;
}
