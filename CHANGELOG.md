# Changelog

All notable changes to AnyTools are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-04

First self-host release. AnyTools has run at [anytools.world](https://anytools.world)
for months; this is the first version anyone can also run on their own machine,
tagged, and pulled from a registry.

### Added

- **107 browser-side tools across 13 clusters**, MIT-licensed, counted straight from
  the registry (`packages/anytools-tools/src/*/meta.ts`): Lifestyle (16), Converters
  (12), PDF (10), Generators (10), Finance (9), Encoding (9), Formatters (8), Image
  (7), Health (7), Design (7), Text/Regex (6), Time/Date (4), Web3 (2). 4 UI locales
  (en, vi, es, pt) — some of the newest tools ship English-only content by design
  (see "Known limitations" below).
- **Self-host Docker image**, `ghcr.io/d0bby999/anytools`, built by
  `.github/workflows/release.yml` from a dedicated `selfhost` stage in
  `apps/anytools-web/Dockerfile`: no environment variables required, no volume, no
  sign-up. Multi-arch (`linux/amd64` + `linux/arm64`) merged into one manifest list.
  Run it with:
  ```bash
  docker run -p 3000:3000 ghcr.io/d0bby999/anytools:v1.0.0
  ```
  or via the `docker-compose.yml` at the repo root. Full guide:
  [`docs/self-hosting.md`](docs/self-hosting.md).
- **Service worker + installable PWA**: `/sw.js` caches static assets and previously
  visited tool pages so they keep working after the server goes away — install the
  app from the browser's install prompt, open a tool once online, and it stays usable
  offline from then on. Ships with a pre-written kill switch
  (`public/sw-tombstone.js`) in case a rollback is ever needed.
- `apps/anytools-web/scripts/list-routes.mjs` + `scripts/release-gate.mjs`: enumerate
  every route the app should serve straight from the tool/cluster/guide registries
  (not from `/sitemap.xml`, which intentionally omits untranslated tool bodies and
  the blog) and fetch them against a running container, asserting 200/404 as
  expected. Used to gate this release; see
  `plans/260903-1527-anytools-selfhost-distribution/phase-04-release-v1-gate.md` for
  the full verification record.

### Changed

- Nothing — this is the first tagged release. The self-host build flag
  (`NEXT_PUBLIC_SELF_HOSTED=1`, build-time only) does not alter the hosted build at
  `anytools.world` in any way; that was verified byte-for-byte during development.

### Notes — what's disabled in self-host mode

The self-host image never talks to AdSense, Umami, or a newsletter provider, never
initializes auth, and never emits an absolute URL. In full: no AdSense, no Umami
analytics, no cookie-consent banner, no newsletter (form or footer card), no
`/ads.txt`, no `/api/postclaw/**` blog-ingest endpoints, no `/sign-in` / `/sign-up` /
`/dashboard` / `/admin/**` / `/api/auth/**` (better-auth never initializes — no
secret needed, no database file written), no `/blog`, no HSTS header, no
`/sitemap.xml` / `/llms.txt` (both 404, not an empty 200), no `og:image` /
`twitter:image` / JSON-LD, and no ad/analytics hosts in the CSP header. `/privacy`
and `/terms` render a separate, accurate self-host copy instead of the hosted one.
The footer instead shows a small "Powered by AnyTools" attribution line — the only
place `anytools.world` appears in a self-hosted page. Full table with file pointers:
[`docs/self-hosting.md`](docs/self-hosting.md#what-is-disabled-in-self-host-mode).

### Licensing

AnyTools is MIT-licensed (see [`LICENSE`](LICENSE)). It bundles `libheif-js`
(LGPL-3.0) for HEIC decoding — the licence text and full attribution for every
bundled runtime asset (pdf.js, tesseract.js, an ONNX background-removal model,
libarchive, and others) ship inside the image at `/app/LICENSE` and
`/app/THIRD-PARTY-NOTICES.md`. See
[`docs/deployment-guide.md`](docs/deployment-guide.md) for the full list and sizes.

### Known limitations

- **Offline is "tools you've used," not "every tool, cold."** The service worker
  caches `/_next/static/**` on first fetch (cache-first), it does not precache the
  whole app. A tool whose code-split chunk was never requested while online (e.g. a
  dynamic-import used only inside one specific tool) will fail to load the first
  time you open it with no server reachable; open it once online and it works
  offline from then on.
- **Two tools make real network calls.** The currency converter (`/api/fx`) fetches
  live rates from Frankfurter (ECB reference data, no key) or Open Exchange Rates if
  you set `OXR_APP_ID`. The curl-to-code converter POSTs the curl command you paste
  — including any header you typed, such as `Authorization` — to this server's own
  `/api/curl-convert` endpoint to parse it; nothing leaves your network unless the
  curl command itself targets somewhere external. Every other tool runs entirely in
  the browser tab.
- **`linux/amd64` is verified in CI only.** The release pipeline builds and smoke-
  tests both `linux/amd64` (GitHub-hosted `ubuntu-latest` runner) and `linux/arm64`
  (native `ubuntu-24.04-arm` runner, avoiding slow QEMU emulation for the native
  `better-sqlite3` addon compile). Local verification for this release ran on Apple
  Silicon (arm64 native); amd64 correctness rests on the CI job's own build + gate
  run, not a second local machine.

[Unreleased]: https://github.com/D0bby999/anytools/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/D0bby999/anytools/releases/tag/v1.0.0
