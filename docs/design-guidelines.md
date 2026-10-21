# Design guidelines

> Source of visual truth: [../ui/web/DESIGN.md](../ui/web/DESIGN.md). This page is a pointer and a digest; when
> they disagree, DESIGN.md wins.

**World:** the modern textbook (2026-10-19), built in `byoungd/up`'s structure since 2026-10-21: VitePress's top nav,
sidebar, article, outline and pager, worn in the textbook's own type and colour. The study app is the book; the
public tools are its appendix, led by AnyProfile.

- **Shell:** top nav 64, sidebar 272 (the table of contents from `lib/nav-tree.ts`: Today, Parts I to IV, Mine,
  the appendix, Settings pinned at the foot), article 688 beside the outline or 780, outline 224 from 1280.

- **Parts:** Read (teal), Ask (brick), Practise (plum), Reflect (forest), and the tools appendix (slate). A part
  colour is wayfinding only; `data-part` on an ancestor sets it (`lib/parts.ts`).
- **Action:** navy `--lp-brand` is the only action ink (buttons, links, focus, selection).
- **Highlighter:** `--lp-highlight` means "needs you now" (due counts, selection); the warning ink is its family.
- **Type:** Literata (titles, prose, numerals), Be Vietnam Pro (interface), Plex Mono (code and data only).
- **Page header:** `components/ui/page-header.tsx`: a book-face title, a lede and the actions; no numeral, nothing above it.
- **Patterns:** `components/doc/` (quick start, ref table, dated list, field table, status line…); lists carry no bullets.
- **Boxes:** `lp-keybox` (part tint, full outline), `lp-empty` (dashed workbook answer box), `lp-tab` (part tab).
- **Never:** a one-sided border, an eyebrow above a title, a part colour on a control, mono as a label.
- **Tokens:** `ui/web/app/tokens.css` only; `app.css` maps them. No colour in a component.
- **Space:** a 4pt scale; controls 40 high; section tabs 36, filled when current.
- **Checks:** `theme-contrast.test.ts`, `no-raw-colour.test.ts`, `page-titles.test.ts`, `detect.mjs`, axe at 390 and 1440 in both themes.
