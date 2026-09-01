# AnyTools

Free browser-based calculators, converters and developer tools — [anytools.world](https://anytools.world).

76 tools across encoding, formatting, generators, converters, text/regex, time/date, web3,
finance, health, lifestyle and design. Available in English, Vietnamese, Spanish and Portuguese.

Almost every tool runs entirely in your browser: what you paste stays on your device. The two
exceptions are documented on their own pages — the curl converter parses server-side because
tree-sitter needs native bindings, and the currency converter fetches ECB reference rates.

## Layout

```
apps/anytools-web            Next.js 15 app (App Router, next-intl, 4 locales)
packages/anytools-tools      the 76 tools: pure logic + UI, one directory each
packages/ui                  shared components and the design tokens
packages/anytools-i18n       locale list and helpers
packages/anytools-analytics  Umami event wrapper
packages/db-shared           Postgres client for the DB-backed blog
packages/postclaw-blog-endpoint  blog ingest endpoint
packages/config              shared tsconfig/biome presets
```

Each tool is a folder with `logic.ts` (pure, testable), `ui.tsx`, `meta.ts` and `logic.test.ts`.
Adding a tool means adding that folder and registering it in `meta-registry.ts`; the catalogue,
sitemap, cluster pages and search pick it up from there.

## Working on it

```bash
pnpm install
pnpm dev          # anytools-web on :3000
pnpm typecheck    # every workspace package
pnpm -r test      # 832 tests
pnpm build
```

Tool copy lives in `apps/anytools-web/content/<locale>/tools/<cluster>/<slug>-faq.mdx`
(and `-tutorial.mdx`). The FAQ block is both the page body and the FAQPage structured data,
so a tool without one ships a page with nothing on it but a widget.

`packages/anytools-tools/src/reference-values.test.ts` cross-checks the numbers the FAQ copy
states out loud against the implementations, using values derived independently from the
published formulas. If a formula changes, or the copy drifts from it, that suite fails.

## History

Extracted from the `dobby-platform` monorepo, which also holds two affiliate content sites.
The commits touching AnyTools came across with it, so `git log` reaches back to May 2026.

## Licence

MIT.
