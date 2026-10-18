# Design guidelines

> Source of visual truth: [../ui/web/DESIGN.md](../ui/web/DESIGN.md). This page is a pointer and a digest; when
> they disagree, DESIGN.md wins.

**World:** the modern textbook (2026-10-19). The study app is the book; the public tools are its appendix, led by
AnyProfile.

- **Parts:** Read (teal), Ask (brick), Practise (plum), Reflect (forest), and the tools appendix (slate). A part
  colour is wayfinding only; `data-part` on an ancestor sets it (`lib/parts.ts`).
- **Action:** navy `--lp-brand` is the only action ink (buttons, links, focus, selection).
- **Highlighter:** `--lp-highlight` means "needs you now" (due counts, selection); the warning ink is its family.
- **Type:** Literata (titles, prose, numerals), Be Vietnam Pro (interface), Plex Mono (code and data only).
- **Page header:** `components/ui/page-header.tsx`; a numeral only when the number means something.
- **Boxes:** `lp-keybox` (part tint, full outline), `lp-empty` (dashed workbook answer box), `lp-tab` (part tab).
- **Never:** a one-sided border, an eyebrow above a title, a part colour on a control, mono as a label.
- **Tokens:** `ui/web/app/tokens.css` only; `app.css` maps them. No colour in a component.
- **Checks:** `theme-contrast.test.ts`, `no-raw-colour.test.ts`, `detect.mjs`, axe at 390 and 1440 in both themes.
