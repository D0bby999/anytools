/**
 * Single source of truth for "are we building the self-host image".
 *
 * Why build-time, not runtime: `[locale]/layout.tsx` calls `setRequestLocale(locale)`
 * (next-intl), which opts the whole locale subtree into STATIC rendering — home plus
 * every tool/cluster/guide page is prerendered once at `next build`. An env var read at
 * request time cannot change HTML that was already baked into the image, so the flag has
 * to be resolved from `process.env` at build time (Next inlines `NEXT_PUBLIC_*` reads at
 * compile time, same mechanism as `NODE_ENV` checks) and every gated surface must derive
 * from it, not re-read the env var itself.
 *
 * Why two images instead of one image with a runtime switch: the prerendered HTML for
 * hosted mode has AdSense markup, canonical/hreflang/OG tags, and newsletter forms baked
 * in; the self-host HTML has none of that. A single running container cannot serve both
 * — `docker build --build-arg NEXT_PUBLIC_SELF_HOSTED=1` produces a distinct image
 * (`ghcr.io/d0bby999/anytools`), separate from the hosted image
 * (`ghcr.io/d0bby999/anytools-web`) that Coolify deploys.
 *
 * Every gated surface in this app imports IS_SELF_HOSTED from here — never re-reads
 * `process.env.NEXT_PUBLIC_SELF_HOSTED` directly (the one exception is `next.config.ts`,
 * which cannot use the `@/` path alias and reads the raw env var with the same comment
 * pointing back to this file).
 */
export const IS_SELF_HOSTED = process.env.NEXT_PUBLIC_SELF_HOSTED === '1';

/**
 * Shared 404 Response for API routes that only exist for the hosted platform
 * (the 3 `/api/postclaw/**` routes re-export handlers trivially, so there is no
 * function body of their own to gate with an `if` — the whole exported const is
 * swapped for this instead). Ignores whatever arguments the real handler would
 * have received; a function with fewer declared parameters is assignable to any
 * Next.js route handler type.
 */
export const notFoundHandler = (): Response => new Response(null, { status: 404 });
