# Changelog

All notable changes to AnyTools are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-09-07

The first release that actually reaches anyone. 1.0.0 below was built, documented and
gated on 2026-09-04 but never published — no git tag was ever pushed, so the workflow that
builds the image never ran: there was no GitHub Release and nothing at
`ghcr.io/d0bby999/anytools`. This release ships that work plus everything since.

### Added

- **25 tools**, taking the catalog from 107 to 132 across the same 13 clusters. All still
  browser-side, MIT, no upload:
  - *Crypto/security*: `aes-text-encrypt` (AES-256-GCM, PBKDF2), `rsa-keypair-generator`
    (RSA + Ed25519 where the browser has it), `hmac-generator` (hex keys, constant-time
    verify), `jwt-sign-verify` (HS/RS/ES; `alg: none` refused), `x509-certificate-decoder`,
    `bip39-mnemonic`.
  - *Data*: `json-schema-validator` (draft-07 + 2020-12), `protobuf-decoder` (with and
    without a `.proto`), `msgpack-decoder`, `jq-playground` (real jq in a cancellable
    worker), `sql-playground` (SQLite in the tab), `token-counter`.
  - *PDF*: `pdf-password` (set and remove), `compress-pdf` (recompresses embedded JPEGs).
  - *Image*: `rotate-image`, `watermark-image`, `image-to-base64`,
    `youtube-thumbnail-grabber`.
  - *Files/media*: `font-converter` (TTF/OTF ⇄ WOFF1 + real subsetting), `audio-trim`,
    `stl-obj-viewer`.
  - *Text/design/time*: `unicode-cleaner` (invisible characters + homoglyphs),
    `cubic-bezier-generator`, `color-blindness-simulator`, `discord-timestamp-generator`.
- **Vietnamese tool content**: 56 hand-written FAQ bodies (~49,900 words), which moved those
  pages from `noindex` to indexable.

### Changed

- `compress-image` now encodes with mozjpeg and oxipng instead of `canvas.toBlob`. Measured
  on the same source at the same quality: JPEG 159.6 KB → 105 KB, PNG 160 KB → 34 KB.
- The Content-Security-Policy is enforced rather than report-only.

### Known limitations — stated because they are easy to hit

- `compress-pdf` only recompresses `/DCTDecode` (already-JPEG) images. A PDF whose images are
  `/FlateDecode`, `/CCITTFaxDecode`, `/JPXDecode` or `/JBIG2Decode`, or that uses an `/SMask`,
  is left alone: measured on a real 924 KB form, the reduction is 0.2%. Scans and photos are
  usually JPEG and do compress (78% on a 1.2 MB three-page scan at quality 60 / 150 DPI). The
  tool says so on screen when it recompresses nothing rather than handing back a "compressed"
  file.
- `font-converter` does not do WOFF2 (that needs Brotli, which browsers do not expose as a
  compression codec) and does not convert TTF ⇄ OTF outlines.
- `audio-trim` exports WAV only; MP3 encoding would mean an LGPL dependency this repo cannot
  take. A trimmed WAV is usually larger than the source file.
- `image-to-svg` was cut: `@visioncortex/vtracer` publishes only a Node build that reads its
  own `.wasm` off disk at load, so it cannot run in a browser bundle at all.
- The 25 tools above ship English FAQ bodies. Their `/vi`, `/es` and `/pt` pages serve
  `noindex` until a translated body exists.

### Verified

Release gate run against this build in self-host mode: **613 routes expected to serve did
serve, 11 expected to be blocked were blocked, 0 failures** (1.0.0's numbers were 415 and 11).
Test suite: 1844 + 185 + 86 passing.


## [1.0.0] - 2026-09-04 (built, never published)

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
  expected. Used to gate this release (415 routes expected to serve, 11 expected to
  be blocked, checked against a container started with no environment and no volume).

### Changed

- The hosted site at `anytools.world` picked up the service worker, the install
  prompt and the footer attribution slot from this release; its Open Graph image URLs
  moved from `…/opengraph-image?<hash>` to `…/opengraph-image/og?<hash>` as a side
  effect of making them switchable per build. Everything the self-host build flag
  (`NEXT_PUBLIC_SELF_HOSTED=1`, build-time only) turns off stays on for the hosted
  build — that part was verified surface by surface during development.

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
