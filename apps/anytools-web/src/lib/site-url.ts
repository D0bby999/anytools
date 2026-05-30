// Hard-coded canonical URL for production builds. Used as metadataBase fallback
// so Next.js can statically resolve OG image URLs during build without env vars.
const PRODUCTION_URL = 'https://anytools.world';

export const SITE_URL =
  process.env.NEXT_PUBLIC_URL ??
  (process.env.NODE_ENV === 'production' ? PRODUCTION_URL : 'http://localhost:3000');

export const METADATA_BASE = new URL(SITE_URL);
