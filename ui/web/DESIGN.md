# AnyTools — visual world

Written from the built shell on 2026-09-16, not before it. Every number here was
read off the running app (its screenshots and measurements are kept in the
maintainers' planning record).

**Superseded convention.** This file is corrected in place, never silently. When
a rule stops being true, strike it and say why:

> ~~Old rule.~~ **Superseded 2026-09-16:** what replaced it, and the evidence.

A rule with no strike is a rule the code currently obeys.

## The world

The reading world of [`byoungd/up`](https://github.com/byoungd/up), pinned by the
owner (plan.md, Validation Session 2). No dice roll: a user pin beats the dice.
`up`'s theme code is MIT and its values are ported here with attribution; its
prose is CC BY-NC and is never used.

A calm book site, not a dashboard. Paper ground, one deep green ink, generous
leading, hairlines instead of shadows. The product's claim is that an answer is
worth what its source is worth, so the surface reads like something you check,
not something that performs.

**Refused by choice:** the AI-SaaS default (dark hero, violet gradient, glow,
glass), and gamification of every kind. No streaks, no confetti, no XP, no
mascot. Progress here is evidence, and evidence does not celebrate itself.

## Tokens

Raw values live in `app/tokens.css` as `--lp-*`. `app/app.css` is the only file
that reads them, mapping them onto the semantic names components already use.
**No component contains a colour** (enforced: `app/test/no-raw-colour.test.ts`).

### Colour, and what each ink means

| Token | Light | Dark | Means |
|---|---|---|---|
| `--lp-paper` | `#fcfbf9` | `#1a1917` | The page |
| `--lp-surface` | `#ffffff` | `#232220` | A card on the page |
| `--lp-surface-soft` | `#f4f2ee` | `#141312` | Rail and activity panel: one step away from the page |
| `--lp-surface-sunken` | `#eae6df` | `#2b2a27` | Inset blocks (quotes, inputs) |
| `--lp-border` | `#e4e0d8` | `#34322e` | Hairline. Decorative, never identifies a control |
| `--lp-border-control` | `#8d887e` | `#767168` | The outline of something operable. Held to 3:1 |
| `--lp-ink` / `-2` / `-3` | `#1d211f` / `#555c57` / `#666d68` | `#ece8e1` / `#aca79e` / `#97928a` | Body, secondary, metadata. All three pass 4.5:1 on all three surfaces |
| `--lp-brand` | `#176f5b` | `#5ab99d` | **The only action ink.** Primary button, focus ring, links in prose, "ready" |
| `--lp-selected` + `-fg` | `#d5e0d9` + `#0f5c4a` | `#1f2e28` + `#79cbb3` | The current row in the rail |
| `--lp-accent` | `#c0523a` | `#d4694f` | **Reading progress only.** Never on a control |
| `--lp-warning` | `#8a5c00` | `#d6a22a` | Needs your attention. Deliberately not red |
| `--lp-danger` | `#93142f` | `#e88c97` | Destructive, or failed |

Strategy is **Restrained**: neutrals plus one accent. There is deliberately no
second green: "ready" and "current" and "primary action" are the same ink,
because in this product they are the same idea.

Dark is composed, not inverted. `up` ships one brand green for both themes; on
this dark canvas it measures **2.82:1** as text, so dark has its own ramp. The
rail goes darker than the page in dark and lighter in light: in both, it
recedes.

`--lp-warning` has no consumer yet. Phase 4's readiness matrix is the first.

### Type

Three faces, three jobs, all verified to carry Vietnamese (U+1EA0–U+1EF9,
U+20AB) before they were chosen, because a display face without Vietnamese
glyphs is a bug this project has already paid for once (ucdaigym).

| Role | Family | Used for |
|---|---|---|
| Reading | IBM Plex Serif | `h1`–`h3`, long prose, the wordmark |
| Interface | IBM Plex Sans | body, labels, buttons, data |
| Region label | IBM Plex Mono | the small uppercase kickers, measured values |

Fixed rem scale, ~1.2 ratio, `--lp-text-2xs` (0.6875rem) to `--lp-text-3xl`
(2.625rem, `up`'s h1). No fluid clamp: an Operate surface with this many text
elements reads as noise when every size moves with the viewport.

Leading: `1.5` interface, **`1.85` prose** (`up`), `1.18` on h1. Dark raises
prose leading to `1.9` and label tracking to `0.09em`, because light ink on a
dark ground eats both.

Only the cuts actually painted are requested: Sans 400/500, Serif 400/600 plus
400 italic, Mono 600. Measured with `document.fonts.check`.
**2026-09-26:** self-hosted through `@fontsource` instead of Google Fonts. The
cross-origin stylesheet was the largest render-blocker on the landing page
(~940 ms on a throttled phone); the latin Serif 600 cut is preloaded because it
paints the landing h1. Vietnamese re-verified on all three faces.

### Space, radius, depth, motion

4pt scale (`--lp-space-1` … `-8`); 8-only loses the useful middle steps.
Radius: **16px cards, 8px controls** (`up`). Depth is a whisper, two shadows,
neither a lift: this world separates by tone and hairline. Motion is state
feedback only, 100–180ms, exit faster than entrance,
`cubic-bezier(0.16, 1, 0.3, 1)`. No page-load choreography. Reduced motion
drops movement and keeps colour and state.

## Geometry

Measured at 1440 (light and dark, identical): rail `0–240`, topbar `240–1440`,
workspace `240–1120`, **reading measure exactly 780 wide**, activity panel
`1120–1440`. At 390: everything full-bleed with 16px gutters, no horizontal
scroll.

- **Rail** 15rem, `--lp-surface-soft`. Below `lg` it becomes a **bottom bar**,
  not a drawer.
  ~~The bottom bar keeps every destination visible.~~ **Superseded 2026-09-26:**
  with ten destinations each slot shrank to 46px at 390 wide and Loop and
  Settings fell off the edge, unreachable. The bar now carries the four
  destinations marked `phone: true` in `NAV_ITEMS` plus **More**, a plain page
  (`/more`) listing all of them — still no drawer and no focus trap, and every
  destination is at most two taps away. A structural test caps the bar at four. A nav hidden behind a hamburger is how a shell ends up looking
  empty on a phone, and it costs a focus trap to do properly.
  **Added 2026-10-18 (AnyTools phase 2):** a **Tools** slot sits beside More
  (`TOOLS_ITEM`, not one of the four), so the bar holds six slots, about 65px
  each at 390 wide; slot padding on the phone went from 8px to 4px a side so
  "Knowledge" keeps its whole label. On the rail Tools is the last row. It
  leads out of the app to the public tool pages (`/tools` picks the locale).
- **Workspace** widens to `--lp-layout-max` (1480). Read content inside it holds
  `--lp-measure-read` (780).
- **Activity panel** 20rem, always present. Below `lg` it stacks under the
  workspace in the same DOM order. It is the product's thesis as furniture: a
  rail that only appears when a citation exists reads as optional chrome.

### Visitor mode per surface

Operate everywhere except long-form reading. Read surfaces (notebook, document
viewer, research report, weekly review text) keep the 780 measure and the
progress hairline; Operate surfaces widen with the same tokens. Full inventory:
`reports/design-world-interview.md` §10.

## Signature moves

1. **A narrow reading column inside a wide workspace.** The workspace is 880
   wide and the text is 780. That gap is the world.
2. **The mono region label.** `SOURCES`, `WHAT COMES FIRST`. It is always the
   real heading of its region, carrying an `id` that `aria-labelledby` points
   at.
3. **The terracotta hairline.** 2px at the top edge, tracking progress through
   long content. Verified running: `scaleX(0.45)` at 45% scroll, `#c0523a`.

## Anti-patterns for this project

- A kicker floating above a page heading. The mono label is a region's heading,
  never an eyebrow decorating someone else's title.
- A grid of identical icon-and-heading cards as page structure. Sequences are
  hairline rows; the home steps are numbered only because the order is real.
- Terracotta anywhere except reading progress; green as decoration.
- A second green, or a state colour taken from a Tailwind palette entry.
- Colour as the only carrier of meaning. The current nav row has tint, weight,
  and a screen-reader-only "Current section".
- Numbered `01/02/03` where the order carries no information.
- The one permitted coloured left rule is on `blockquote` (3px brand), marking
  text quoted from a source document.

## Verified

axe-core 4.10.2, 0 violations: shell at 1440 light, 1440 dark, 390 light, and
the sign-in page. No horizontal scroll at any of them. Contrast is a test, not
an opinion: `app/test/theme-contrast.test.ts` measures every text pair in both
themes and composites the translucent tints against what is behind them.

## Open follow-ups

- The reading measure is 780px, about 85ch in Plex Serif, wider than the 45–75ch
  craft floor. Kept because the world pins it, and compensated with 1.85
  leading. Revisit on the phase 8 reading surfaces with real documents.
- The activity panel stacks below the workspace on a phone. Phase 6 should
  decide whether a sheet is better once it holds live citations.
- `--lp-warning` and `--lp-surface-sunken` have no consumer until phase 4.
- No `<meta name="theme-color">`, so mobile browser chrome does not match the
  page. Doing it properly needs a colour literal in `root.tsx`, which the
  no-raw-colour guard forbids on purpose. The right fix is to inject it from
  `tokens.css` at build time; not worth the machinery before the app is
  deployed.
- Only the shell and sign-in have had a design pass. Phases 4–10 inherit the
  world through tokens and each needs its own pass.
