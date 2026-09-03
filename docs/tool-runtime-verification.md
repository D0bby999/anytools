# Verifying a file tool in a real browser

Unit tests here run under happy-dom, where canvas returns `null`, WASM workers do not start and
`toBlob` never calls back. For any tool that takes a file, "typecheck and tests green" says almost
nothing about whether it runs. A tool that skipped 100% of images and reported "no images found"
shipped with green tests on 2026-09-02. This is the check that would have caught it.

There is no Playwright in this repository. The lane below uses the `agent-browser` CLI (headless
Chromium, installed globally on the owner's machine — `agent-browser --version`) against a local
server. Chrome DevTools MCP was tried first and could not connect: it needs the owner's Chrome
launched with a remote-debugging port, which it normally is not. `agent-browser` needs nothing.

**Always set `AGENT_BROWSER_SESSION=anytools-lane`** (or any name of your own). The default session
is shared by every agent on this machine; on 2026-09-03 the unnamed session turned out to belong to
another running session's e2e tester, complete with its logged-in tabs. A named session is an
isolated browser with its own tabs, cookies and network log.

## Fixtures

```bash
pnpm --filter @anytools/tools exec node scripts/make-fixtures.mjs
```

writes to `packages/anytools-tools/fixtures/` (gitignored):

| File | Trips |
|---|---|
| `text-3p.pdf` | page count, order, a rotated page (`/Rotate 90` on page 2) |
| `images-shared.pdf` | one PNG drawn on three pages — the `g_`/`commonObjs` cache path that hangs a naive reader |
| `cjk.pdf` | non-embedded Japanese font via `UniJIS-UCS2-H` — needs `/third-party/pdfjs/cmaps/` to render |

Formats we cannot synthesise cleanly go in `packages/anytools-tools/fixtures/manual/` (also
gitignored). Drop real files there before verifying the tools that need them:

| File | Needed by |
|---|---|
| `photo.heic` (an iPhone photo, ideally a Live Photo) | heic-to-jpg |
| `doc.docx` (headings, a table, an image) | docx-to-markdown |
| `book.xlsx` (two sheets, a date column) | xlsx-to-csv |
| `scan.pdf` (a real 3–5 page scan) | ocr-pdf |
| `archive.rar`, `archive.7z` | unzip-archive |
| `portrait.jpg`, `product.jpg`, `pet.jpg`, `hair.jpg` | remove-background quality gate |

## The six steps

Prefer the **production build** (`pnpm --filter @anytools/web build && pnpm --filter @anytools/web start`)
— it is what Docker ships, and pdf.js worker loading differs between `next dev` and `next build`.
`next dev` and `next build` share `.next/`; never run both at once.

```bash
export AGENT_BROWSER_SESSION=anytools-lane
FX=packages/anytools-tools/fixtures
agent-browser open http://localhost:3000/en/<cluster>/<slug>
agent-browser wait --load networkidle
sleep 3   # let React hydrate — an upload that lands before hydration sets input.files but no handler runs
agent-browser upload '#tool input[type=file]' $FX/<fixture>      # the input is sr-only, still targetable
agent-browser eval "(() => [...document.querySelectorAll('#tool button')].find(b => b.textContent.trim() === '<Run label>').click())()"
sleep 10
agent-browser eval "(() => document.getElementById('tool').innerText)"   # what the user sees
agent-browser screenshot /tmp/<slug>.png
agent-browser console | grep -iE 'error|warn'                    # must be empty
agent-browser network requests | grep -v localhost:3000 \
  | grep -viE 'googlesyndication|doubleclick|google\.com|adtrafficquality'   # must be empty
```

Notes on each step:

- **Click by text through `eval`**, not `find role button click` — the latter matched the command
  palette button first and opened it over the tool.
- **Console** must have no `error` entries. In dev, ignore `[Fast Refresh]` lines.
- **Network**: after removing our own origin and the AdSense hosts (they load on every page today,
  a known and separately tracked decision), the list **must be empty**. A `cdn.jsdelivr.net`,
  `unpkg.com`, `esm.sh`, `huggingface.co` or `github.com` row here is a bug, whatever the tool
  showed on screen.

Paste the three results (what `#tool` said, console verdict, network verdict) into the **Verify**
section of the tool's phase file. A phase with an empty Verify section is not done.

## Vendor assets

Every WASM binary, model, language file and font a tool loads at runtime is copied or downloaded
at build time by `apps/anytools-web/scripts/copy-vendor-assets.mjs` from the manifest
`apps/anytools-web/vendor-assets.json` into `public/third-party/<key>/`. Downloaded files are
checksum-pinned; a mismatch fails the build on purpose. A key marked `"pending": true` is skipped:
its tool has not shipped, so the deploy should not carry the bytes (or, for LGPL binaries,
distribute them before the notice exists). Shipping the tool means deleting that flag. Libraries must be pointed at
`/third-party/<key>/` explicitly — most of them default to a CDN, and step 6 above is how that
default gets noticed.
