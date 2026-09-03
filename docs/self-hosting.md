# Self-hosting AnyTools

A separate image, built from the same source, with every hosted-only surface (ads,
analytics, accounts, newsletter, blog, and any absolute URL) compiled out at build time.
This document covers running it. For *why* it's a separate image rather than an env
switch, see `apps/anytools-web/src/lib/self-hosted.ts`.

## Requirements

- Docker (or Podman) able to pull from `ghcr.io`.
- Roughly 1 GB of RAM free for the container. The image itself is a few hundred MB —
  it ships offline WASM runtimes for the file tools (pdf.js, tesseract.js, an ONNX
  background-removal model, libheif, libarchive; see [Third-party runtime
  assets](./deployment-guide.md#third-party-runtime-assets-wasm-models-fonts) for the
  breakdown) so that those tools work without calling out to a CDN.
- No database. No persistent volume is required for the self-host image (the hosted
  image mounts one for its own login system, which self-host never initializes — see
  below).

## Quick start

```bash
docker run -p 3000:3000 ghcr.io/d0bby999/anytools:v1.0.0
```

That's the whole setup — no environment variables, no volume, no config file. Visit
`http://localhost:3000/en`.

Or with Compose:

```yaml
# docker-compose.yml
services:
  anytools:
    image: ghcr.io/d0bby999/anytools:v1.0.0
    container_name: anytools
    ports: ["3000:3000"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

```bash
docker compose up -d
```

## Configuration (runtime environment)

The runtime env surface is intentionally tiny:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `3000` | change the port the Node process listens on |
| `OXR_APP_ID` | no | unset | an [Open Exchange Rates](https://openexchangerates.org) app ID; without it the currency converter (`/api/fx`) uses [Frankfurter](https://api.frankfurter.app) (ECB reference rates, no key needed) and never touches this variable |

Nothing else is read at runtime — no build-time flag can be changed by passing
`docker run -e` against an already-built image. See "Building your own image" below if
you need to change one of those.

## Reverse proxy

The container listens on plain HTTP on port 3000 and does not send an HSTS header
(that header is stripped specifically in self-host builds, since it's a trap on a bare
LAN/HTTP deployment — see the "What is disabled" table below). TLS is entirely the
proxy's decision.

Caddy:

```
tools.example.com {
    reverse_proxy localhost:3000
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name tools.example.com;
    # ssl_certificate / ssl_certificate_key here

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Upgrading

There is no database and no migration to run. Bump the tag and recreate the container:

```bash
docker compose pull && docker compose up -d
```

or, without Compose:

```bash
docker pull ghcr.io/d0bby999/anytools:vX.Y.Z
docker stop anytools && docker rm anytools
docker run -d --name anytools -p 3000:3000 ghcr.io/d0bby999/anytools:vX.Y.Z
```

## What is disabled in self-host mode

Everything below is compiled out of the `NEXT_PUBLIC_SELF_HOSTED=1` build; the hosted
build (`anytools.world`) is unaffected — a byte-diff against the unpatched build showed
zero behavioral change on the hosted side. If this list and the code disagree, the code
wins; update this table alongside `phase-01-selfhost-mode-flag.md` in the source repo's
plan directory if that ever happens.

| # | Surface | Where | How it's gated |
|---|---------|-------|-----------------|
| 1 | AdSense | `components/adsense-script.tsx` | renders nothing |
| 2 | Umami analytics | `components/umami-analytics.tsx` | renders nothing |
| 3 | Cookie-consent banner | `components/cookie-consent-banner.tsx` | renders nothing (its only job is gating analytics, which is already off) |
| 4 | Newsletter (2 places) | the waitlist section on the home page, and the newsletter card in the footer | both sections are hidden entirely, not just the signup form |
| 5 | `POST /api/newsletter/subscribe` | `api/newsletter/subscribe/route.ts` | returns 404 on `POST`. A bare `GET` to the same path returns Next's own 405 Method Not Allowed on **both** builds, since the route never exported a `GET` handler — that's stock Next.js behavior, not a self-host bug |
| 6 | `/ads.txt` | `app/ads.txt/route.ts` | 404 |
| 7 | `/api/postclaw/**` (3 routes: `health`, `posts`, `posts/[id]`) | internal blog-ingest endpoints | wrapped re-exports return 404 instead of calling through |
| 8 | Auth surfaces: `/sign-in`, `/sign-up`, `/dashboard`, `/admin/**`, `/api/auth/**` | respective `page.tsx` / `route.ts` files | 404 before anything imports the auth module, so better-auth is never initialized — no `BETTER_AUTH_SECRET` needed, no database file written. `/dashboard` additionally needed a dedicated `dashboard/layout.tsx`: its sibling `loading.tsx` wraps the page in a React Suspense boundary, and once that boundary starts streaming, a `notFound()` thrown later from inside the page can still render the right "not found" content but can no longer undo the HTTP 200 status the response already committed to (a known Next.js limitation, `vercel/next.js#45801`). A layout's body runs *before* the Suspense boundary it wraps, so gating there produces a real 404 status code |
| 9 | `/blog`, `/blog/[slug]` | `[locale]/blog/page.tsx`, `blog/[slug]/page.tsx` | 404 — the header/footer/mobile nav never linked `/blog` to begin with, they only ever pointed at `/guides` |
| 10 | `Strict-Transport-Security` header | `next.config.ts` | header is filtered out of the response; Content-Security-Policy and everything else stay as-is |
| 11 | `/sitemap.xml`, `/llms.txt` | `app/sitemap.ts`, `app/llms.txt/route.ts` | both return 404 (not a `200` with an empty list) |
| 12 | `/privacy`, `/terms` copy | `[locale]/privacy/page.tsx`, `[locale]/terms/page.tsx` | self-host builds render a separate text variant of both pages that does not mention AdSense, Umami, the newsletter or the cookie banner — because none of that runs in this build. The only network calls the self-host copy discloses are the same two covered in [What leaves the browser](../README.md#what-leaves-the-browser): `/api/fx` (currency rates) and the curl converter POSTing to this server |
| 13 | `og:image`, `twitter:image`, JSON-LD (`application/ld+json`) | shared metadata helpers | none of these are emitted on any page when this flag is on — no social preview image tags, no structured data script |

Beyond that table: no page emits an absolute URL. No `rel="canonical"`, no `hreflang`
alternates, no `og:url` — `generateMetadata` returns `undefined` for all of them when
this flag is on. `robots.txt` becomes `User-agent: * / Disallow: /` with no `Sitemap:`
line. The footer instead shows a small `Powered by AnyTools · anytools.world · GitHub`
attribution line — the only place `anytools.world` appears at all in a self-hosted page.

Rows 12–13 landed as a follow-up to the initial 11-row gate in `phase-01` (same flag,
same review), on `master` around the time this document was written — if a build you
are running predates it, `/privacy`/`/terms` and social-preview/JSON-LD tags may still
be visible; the surfaces from rows 1–11 are unaffected either way.

**One thing that stays, on purpose:** the `better-sqlite3` native binding is still
present in the image even though self-host never opens a database with it — cutting it
out means splitting auth-adjacent routes out of the build entirely, which is a bigger
change than this flag makes. Don't read "auth is disabled" as "the binding isn't
there" — it is, it's just unused.

## Building your own image

```bash
docker build -f apps/anytools-web/Dockerfile --target selfhost \
  --build-arg NEXT_PUBLIC_SELF_HOSTED=1 \
  --build-arg NEXT_PUBLIC_URL=https://tools.example.com \
  -t anytools-selfhost:custom .
```

`NEXT_PUBLIC_URL` **only has an effect here**, as a `--build-arg`. Every
`NEXT_PUBLIC_*` value is read once, at `next build` time, and inlined into the static
HTML for the whole locale tree (`[locale]/layout.tsx` calls next-intl's
`setRequestLocale`, which opts every page under it into static prerendering). By the
time the container starts, that HTML already exists — there is no code path left that
reads the env var again, so `docker run -e NEXT_PUBLIC_URL=…` against the published
image is silently ignored. The published `ghcr.io/d0bby999/anytools` image deliberately
leaves `NEXT_PUBLIC_URL` unset, which is why the self-host build emits no absolute URLs
at all rather than an arbitrary placeholder.
