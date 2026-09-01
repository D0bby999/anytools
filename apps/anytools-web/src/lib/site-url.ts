// Hard-coded canonical URL for production builds. Used as metadataBase fallback
// so Next.js can statically resolve OG image URLs during build without env vars.
const PRODUCTION_URL = 'https://anytools.world';

export const SITE_URL =
  process.env.NEXT_PUBLIC_URL ??
  (process.env.NODE_ENV === 'production' ? PRODUCTION_URL : 'http://localhost:3000');

export const METADATA_BASE = new URL(SITE_URL);

/**
 * Public source repository.
 *
 * Defined once because it was hard-coded in five places across two spellings, one
 * of which — `github.com/anytools` — is an unrelated person's account.
 *
 * Points at `D0bby999/anytools`, which is where AnyTools is intended to live as its
 * own repository. Today that path 301s to the `dobby-platform` monorepo it was
 * renamed from, so the link resolves either way: correct now, and still correct
 * once the project is split out.
 */
export const GITHUB_REPO_URL = 'https://github.com/D0bby999/anytools';
