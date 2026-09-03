import { IS_SELF_HOSTED } from './self-hosted';

// Hard-coded canonical URL for production builds. Used as metadataBase fallback
// so Next.js can statically resolve OG image URLs during build without env vars.
const PRODUCTION_URL = 'https://anytools.world';

// A self-host image is built once and run by strangers on their own host/port/reverse
// proxy — it has no way to know its own public URL at build time, and must never leak
// anytools.world (the hosted site's domain) into a stranger's install. `NEXT_PUBLIC_URL`
// is a build-arg (see self-hosted.ts), so `docker run -e NEXT_PUBLIC_URL=…` cannot fix
// this at runtime either: release.yml deliberately leaves it unset for the self-host
// build. This placeholder only backstops code paths that unconditionally interpolate
// SITE_URL (JSON-LD @id/url fields on tool/cluster/guide pages) — it is never rendered
// into canonical/hreflang/OG tags, which selfHostSafeAlternates() strips to `undefined`
// instead of pointing them at this placeholder.
const SELF_HOSTED_PLACEHOLDER_URL = 'http://localhost';

export const SITE_URL = IS_SELF_HOSTED
  ? SELF_HOSTED_PLACEHOLDER_URL
  : (process.env.NEXT_PUBLIC_URL ??
    (process.env.NODE_ENV === 'production' ? PRODUCTION_URL : 'http://localhost:3000'));

export const METADATA_BASE = new URL(SITE_URL);

/**
 * Strips `alternates` (canonical + hreflang `languages`) to `undefined` in self-host
 * builds. A relative canonical path resolved against a placeholder host is still an
 * absolute URL that points at the wrong place once a stranger runs the image on their
 * own domain — omitting the tag entirely (not pointing it at localhost) is the only
 * choice that is never wrong. Callers pass their normal `alternates` object through;
 * this is the one place that decides whether it ships.
 */
export function selfHostSafeAlternates<T>(alternates: T): T | undefined {
  return IS_SELF_HOSTED ? undefined : alternates;
}

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
