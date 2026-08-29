# Design System

> **Source of truth:** `apps/anytools-web/design-system/anytools/MASTER.md` + `packages/ui/src/styles/globals.css`.
> This file is a quick reference; if it disagrees with those, they win.

## Brand
- **Name:** AnyTools
- **Voice:** friendly, no-BS, dev-first
- **Visual:** Swiss-Modernism slate chrome + **emerald brand accent**, light mode default (dark via toggle).
  Playful/bold brand moments (morphing-module logo, emerald→cyan gradient, hero glow) layered on the neutral base.

## Tokens (CSS custom properties)

Defined in `packages/ui/src/styles/globals.css` (OKLCH). Primary is **slate** (neutral); the brand color lives in **accent** (emerald).

| Token | Light | Dark |
|---|---|---|
| `--color-background` | slate-50 `oklch(0.985 0.005 247)` | slate-900 `oklch(0.21 0.026 256)` |
| `--color-foreground` | slate-800 `oklch(0.28 0.034 256)` | slate-50 `oklch(0.985 0.005 247)` |
| `--color-primary` | slate-600 `oklch(0.45 0.034 256)` | slate-300 `oklch(0.78 0.025 247)` |
| `--color-accent` (brand) | emerald-700 `oklch(0.52 0.11 162)` #047857 | emerald-500 `oklch(0.70 0.15 162)` #10B981 |
| `--color-accent-foreground` | white | slate-900 (dark-on-emerald for AA) |
| `--color-brand-from` / `--color-brand-to` | emerald-500 → cyan-500 (brand-only gradient) | same |
| `--radius` | `0.5rem` | same |

**Per-cluster accents** (`--color-accent-{finance,health,lifestyle,design}` + Tailwind ring hues in `cluster-config.ts`) stay distinct from the brand accent — do not recolor them to emerald.

**Light vs dark:** emerald accent is intentionally deeper in light mode (vivid emerald fails WCAG AA on white). The vivid emerald + gradient carry the "playful" punch in dark mode, logo, and hero.

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
