# AnyTools Brand Assets

Canonical logo files for the AnyTools brand (Emerald Morph). Symbol = **morphing module** (3 geometric cells mid-transformation = "any tool / composable"). Brand color = emerald; signature gradient emerald→cyan (`#10B981` → `#06B6D4`).

## Vector sources (edit these)

| File | Use |
|------|-----|
| `logo-mark.svg` | Symbol only, transparent. App icon / favicon source. |
| `logo-wordmark.svg` | Mark + "AnyTools", **dark text** (light backgrounds). |
| `logo-wordmark-dark.svg` | Mark + "AnyTools", **white text** (dark backgrounds). |
| `logo-mark-maskable.svg` | Full-bleed gradient tile + white mark (PWA maskable, 512). |
| `showcase.svg` | 1200×630 branded card (dark slate + emerald glow). |

## Rendered PNGs

| File | Size | Use |
|------|------|-----|
| `logo-mark-1024.png` | 1024² transparent | Slide decks, press, large icon. |
| `logo-wordmark-1600.png` | 1600w transparent | Headers on light bg. |
| `logo-wordmark-dark-1600.png` | 1600w transparent | Headers on dark bg / README. |
| `showcase-1200x630.png` | 1200×630 | Social card / repo preview. |

## Notes

- The in-app web copies live in `apps/anytools-web/public/icons/` (logo-mark, maskable, wordmark + raster favicons). Keep this folder and that one in sync if the mark changes.
- Font: **Inter** (weight 800 for wordmark). PNGs were rasterized with Inter installed locally; the web renders Inter via Google Fonts.
- Re-render PNGs: `rsvg-convert -w <px> <file>.svg -o <out>.png` (or `magick`).
- Color tokens + AA rationale: `packages/ui/src/styles/globals.css` + `apps/anytools-web/design-system/anytools/MASTER.md`.
