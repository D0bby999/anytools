# Design System

> **Source of truth:** `apps/anytools-web/design-system/anytools/MASTER.md` + `packages/ui/src/styles/globals.css`.
> This file is a quick reference; if it disagrees with those, they win.

## Brand
- **Name:** AnyTools
- **Voice:** friendly, no-BS, dev-first
- **Visual:** Swiss-Modernism slate chrome + **emerald brand accent**, light mode default (dark via toggle).
  Playful/bold brand moments (morphing-module logo, teal→cyan gradient, hero aurora) layered on the neutral base.

## Tokens (CSS custom properties)

Defined in `packages/ui/src/styles/globals.css` (OKLCH — that file is the source of truth; this table is a digest). Brand color is the **logo cyan**; primary = accent so the main CTA carries the brand.

| Token | Light | Dark |
|---|---|---|
| `--color-background` | slate-50 `oklch(0.985 0.005 247)` | slate-900 `oklch(0.21 0.026 256)` |
| `--color-foreground` | slate-800 `oklch(0.28 0.034 256)` | slate-50 `oklch(0.985 0.005 247)` |
| `--color-primary` = `--color-accent` (brand) | cyan-700 `#0E7490` (white text 5.36:1) | logo cyan `#08B7C9` (slate-900 text 7.33:1) |
| `--color-brand-from` / `--color-brand-to` | logo teal `#0AB7B3` → logo cyan `#08B7C9` (brand-only gradient) | same |
| `--color-success` / `--color-warning` / `--color-info` | green-700 / amber-700 / blue-700 (AA on white) | green-300 / amber-300 / blue-300 |
| `--radius` | `0.5rem` | same |

**Status inks — one meaning each:** success = passed, warning = attention, info = neutral annotation, destructive = error/danger. Soft badge form: `bg-{status}/10 text-{status}`. Never hand-roll green/amber/blue palette classes for status — categorical data scales (per-cluster hues, http-status 4xx orange, json-diff purple) are the only sanctioned raw-palette use and each must carry a comment.

**Per-cluster accents** (`--color-accent-{finance,health,lifestyle,design}` + Tailwind ring hues in `cluster-config.ts`) stay distinct from the brand accent — do not recolor them to cyan.

**Light vs dark:** brand cyan is deeper in light mode (the logo's own cyan carries white text at only 2.43:1); dark mode shows the literal logo cyan.

**Tailwind sources:** `globals.css` must `@source` every workspace package whose TSX uses utilities (`../` for packages/ui, `../../../anytools-tools/src` for tool UIs) — a utility used only in an unlisted package is silently dropped from the build.

## Typography
- **Sans:** Inter (Google Fonts) — UI text, body
- **Mono:** JetBrains Mono (Google Fonts) — code blocks, tool inputs/outputs

## Components (shadcn-style, in `packages/ui`)

Implemented (Phase 0):
- `Button` (default, destructive, outline, secondary, ghost, link variants)
- `Card` + sub-components
- `Input`, `Textarea`
- `Tabs`
- `Dialog`
- `Tooltip`
- `Badge`
- `CopyButton`

To add when needed:
- `Select`, `Combobox` (Radix)
- `Toast` (sonner)
- `Sheet` (mobile drawer)

## Patterns

- **Theme:** light default for new visitors (owner decision 260829); dark + system selectable via next-themes toggle, stored choice wins
- **Mobile-first:** all components responsive
- **Accessibility:** WCAG AA color contrast min, focus rings always visible, keyboard nav tested
- **Animation:** sparingly on product/tool UI. **Sanctioned brand-motion exceptions** (brand surfaces only): morphing-module logo animation (load + hover), hero aurora glow. All gated by `prefers-reduced-motion`. Do not add motion to cluster/tool chrome.
- **Spacing:** 4px base unit (Tailwind default scale)

## Anti-patterns

- No emojis in UI text (unless user-generated)
- No custom shadows beyond Tailwind `shadow-sm/md/lg/xl` — **except** sanctioned emerald brand glow on the logo, hero, and primary/⌘K (brand surfaces only)
- No CSS-in-JS for new code (Tailwind only)
- No `dangerouslySetInnerHTML` except verified schema markup
