# Deployment guide — anytools.world

## How a deploy happens

1. Push to `master` → `.github/workflows/deploy.yml` builds on a GitHub runner.
2. Image is pushed to GHCR as **two** tags: `ghcr.io/d0bby999/anytools-web:latest` and
   `…:<git-sha>`.
3. The workflow SSHes to the Hetzner host and runs `docker pull …:latest`.
4. It then calls Coolify, which clones this repo and builds
   `apps/anytools-web/Dockerfile.deploy` — a one-line `FROM ghcr.io/d0bby999/anytools-web:latest`.
   Nothing compiles on the host, so the 4 GB box cannot OOM.

**Why step 3 is not optional.** `:latest` is a mutable tag, so Coolify's `FROM` resolves against
the host's local Docker cache. Skip the pull and the deploy reports success while serving the
previous image. This was shipped broken once and fixed in `2de4030`.

## Two images, one Dockerfile

`apps/anytools-web/Dockerfile` has two runtime stages that both inherit from a shared
`runtime-base` stage: `selfhost` and `runner` (the **last** stage in the file, so it's
the one Docker picks when nobody passes `--target`). The two differ in exactly two
ways: whether `NEXT_PUBLIC_SELF_HOSTED=1` was passed as a build-arg to the earlier
`builder` stage, and whether `runner`'s extra `RUN mkdir /data` + `VOLUME /data`
lines ran (`selfhost` never declares that volume — a `VOLUME` instruction can't be
un-declared by a later stage, which is why `runner` has to come after `selfhost`,
not before it).

This section (`deploy.yml`) only ever produces the **hosted** image,
`ghcr.io/d0bby999/anytools-web`, by building with no `--target` — nothing above
changes: no new build-arg, no new target, same `:latest` + `:<git-sha>` tags, still
the `runner` stage with its `/data` volume for the better-auth SQLite DB. A second,
independent workflow, [`.github/workflows/release.yml`](../.github/workflows/release.yml)
(triggered only by pushing a `vX.Y.Z` tag — no manual dispatch), builds the
**self-host** image, `ghcr.io/d0bby999/anytools`, with `--target selfhost` and
`--build-arg NEXT_PUBLIC_SELF_HOSTED=1` — no ads, no analytics, no accounts, no
database volume — for both `linux/amd64` and `linux/arm64`, published as one manifest
list. See [`docs/self-hosting.md`](./self-hosting.md) for what that image disables
and how to run it.

## Rollback

There is no rollback button. `Dockerfile.deploy` pins the mutable `:latest` tag with no digest,
so reverting means re-pointing that tag at a known-good image and redeploying.

Find the good SHA first — GitHub Actions run history, or:

```bash
# list recent tags on the package
gh api /users/D0bby999/packages/container/anytools-web/versions \
  --jq '.[].metadata.container.tags | select(length>0) | .[]' | head -20
```

Then, on the Hetzner host (`157.180.70.19`):

```bash
GOOD=<git-sha>
docker pull ghcr.io/d0bby999/anytools-web:$GOOD
docker tag  ghcr.io/d0bby999/anytools-web:$GOOD ghcr.io/d0bby999/anytools-web:latest
```

Then trigger a Coolify redeploy for app uuid `v5kik8xxwkh7wqlu56wq5eb2` **from the Coolify UI**.
Verify by fetching a page and checking it reflects the rolled-back build — a green Coolify status
alone does not prove which image is running.

Two traps in this procedure:

- **Do not `docker push` the retagged image.** The host is a pull-only consumer; nothing
  provisions GHCR *write* credentials there, so the push fails with
  `denied: permission_denied: write_package` — in the middle of an incident. It is also
  unnecessary: `Dockerfile.deploy`'s `FROM …:latest` resolves against the host's **local** cache,
  so the local `docker tag` is the whole fix.
- **Do not "just re-run the deploy job" instead.** Its first step is
  `docker pull …:latest` (`.github/workflows/deploy.yml`), which overwrites your local retag with
  the bad image from the registry and silently undoes the rollback.

The rollback is therefore local to the host and survives only until the next successful `master`
build. Land the real fix on `master`; the retag just buys time.

## Pull requests build but never publish

`build` passes `push: ${{ github.event_name != 'pull_request' }}`. A PR still compiles the image
so a broken Dockerfile fails the check, but it must never publish `:latest` — that tag is what
production resolves against, so publishing it from an unmerged branch would leave the site one
`docker pull` (or one rollback runbook) away from serving PR code.

## This repo is the only thing that builds anytools-web

`D0bby999/anytools` owns the image. The old monorepo (`postclaw/earn`) used to build it too, from
a copy of `apps/anytools-web` that still exists there and has since fallen behind. Both pushed the
same `:latest` tag, so an unrelated commit in that repo could silently overwrite production. The
anytools build was removed from `earn/.github/workflows/deploy.yml` on 2026-09-02 — **do not
re-add it.**

`earn/.github/workflows/sync-blogs.yml` is unaffected and still owns anytools blog content
(MDX in earn → Postgres → rendered from the DB, no image rebuild).

## GHCR permissions

GHCR grants write access **per package**, not per owner, and there is no REST API for it. If a
push fails with `denied: permission_denied: write_package`, fix it by hand at
`github.com/users/D0bby999/packages/container/anytools-web/settings` → Manage Actions access →
Add Repository → role Write.

The misleading part: the failure surfaces as a `results-receiver … GetCacheEntryDownloadURL`
error that looks like broken GitHub Actions caching. It is not — read further down for the real
push-denied line.

## Third-party runtime assets (WASM, models, fonts)

Since 2026-09-03 the file tools load their heavy parts at runtime from our own origin, never a
CDN: pdf.js cmaps/fonts, tesseract worker + core + traineddata, zxing wasm, onnxruntime wasm +
the u2netp model, libheif glue + wasm, libarchive worker + wasm, Excalidraw fonts, Noto Sans.
`apps/anytools-web/scripts/copy-vendor-assets.mjs` stages them into `public/third-party/`
(gitignored) from the manifest `apps/anytools-web/vendor-assets.json`; it runs before `build`
and `dev`, and CI runs it before `pnpm -r test`. Downloaded files are sha256-pinned; a mismatch
fails the build on purpose.

Consequences for deploys:

- The Docker builder stage needs outbound HTTPS to github.com and notofonts.github.io for the
  pinned downloads (~15 MB, cached under `~/.cache/anytools-vendor` inside the stage).
- The runner image grew by roughly 54 MB (`public/third-party/`); the largest pieces are the
  onnxruntime wasm (14 MB), Excalidraw's Xiaolai CJK font (12 MB) and tessdata (10 MB).
- `next start` serves `public/` with `Cache-Control: public, max-age=0`, so every cold visit
  revalidates. The tools cache the big binaries themselves (Cache API / IndexedDB), but a
  `Cache-Control: immutable` header for `/third-party/*` in `next.config.ts` would still spare
  a revalidation per asset — open follow-up.
- A key marked `"pending": true` in the manifest is skipped: its tool has not shipped.
