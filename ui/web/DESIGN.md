# AnyTools: visual world

Written on 2026-10-19 from the built app, not before it. Every number here was read
off the running pages or measured by a test.

**Superseded convention.** This file is corrected in place, never silently. When a
rule stops being true, strike it and say why:

> ~~Old rule.~~ **Superseded 2026-10-19:** what replaced it, and the evidence.

A rule with no strike is a rule the code currently obeys.

> ~~The reading world of `byoungd/up`, pinned by the owner (2026-09-16).~~
> **Superseded 2026-10-19:** the owner asked for the whole UI to be rebuilt in a study
> style, with the study app (AnyLearn) as the main surface, the tools as a secondary section and
> AnyProfile leading the tools. design-world rolled the direction (dice key
> `018be165`, assigned 3 of 7). The owner accepted the recommendation: the modern
> textbook, plus the highlighter from the notebook comp. Three things were kept from
> `up`: the reading measure, the prose leading and the reading-progress hairline.

## The world

**A premium printed study guide turned into software.** The page is warm white. Titles
and reading are set in a book face, and the interface in a sans made for Vietnamese.
The app is divided into four **parts**, like a textbook. Each part owns one colour,
used only to show where you are. The tools are the book's **appendix**, and AnyProfile
is its feature.

The product's claim is that an answer is worth what its source is worth. So the
surface reads like a book you check, not a dashboard that performs.

**Refused by choice:**

- The AI-SaaS default: dark hero, violet gradient, glow, glass.
- Gamification: no streaks, confetti, XP or mascot.
- A grid of identical cards as page structure.

## Tokens

Raw values live in `app/tokens.css` as `--lp-*`. `app/app.css` is the only file that
reads them, mapping them onto semantic names. **No component contains a colour**
(`app/test/no-raw-colour.test.ts`). Every text pair, including the part colours on
their own tints, is measured in both themes by `app/test/theme-contrast.test.ts`.

### Colour, and what each ink means

Strategy: **Full palette, disciplined**. Neutrals carry the page. One navy is the only
action ink. Four part colours are used for wayfinding only, and one highlighter means
"this needs you now".

| Token | Light | Dark | Means |
|---|---|---|---|
| `--lp-paper` | `#fbfaf6` | `#16171b` | The page |
| `--lp-surface` | `#ffffff` | `#1f2026` | A card or a field |
| `--lp-surface-soft` | `#f3f0e7` | `#111216` | Rail, bands: one step away from the page |
| `--lp-surface-sunken` | `#ebe6d9` | `#272830` | Inset (code, pressed) |
| `--lp-border` / `-control` | `#e2dccd` / `#8a8476` | `#30323b` / `#737786` | Hairline (decorative) / outline of an operable thing (3:1) |
| `--lp-ink` / `-2` / `-3` | `#1a1e29` / `#4d5262` / `#5c6170` | `#ece8df` / `#b0ab9f` / `#9a968b` | Body, secondary, metadata |
| `--lp-brand` | `#1f3d78` | `#8fb0f0` | **The only action ink.** Primary button, link, focus ring, current section tab, "ready" |
| `--lp-selected` + `-fg` | `#e1e8f5` + `#18325f` | `#232d45` + `#a9c2f5` | The selected option of a control (section tabs, filters) |
| `--lp-hover` | `#ebe8df` | `#1a1d25` | A hovered row: one step darker, no hue |
| `--lp-part-read` | `#0b6762` teal | `#5cc0b6` | Part I, Read: Knowledge, documents, books, feeds, Notebook |
| `--lp-part-ask` | `#a8461a` brick | `#e9935a` | Part II, Ask: Chat, Solve, Research |
| `--lp-part-practise` | `#7a3570` plum | `#c896e6` | Part III, Practise: Quiz, exams, Mastery, vocabulary |
| `--lp-part-reflect` | `#2c663a` forest | `#7cc58c` | Part IV, Reflect: Loop, Toolkit |
| `--lp-part-tools` | `#4a5363` slate | `#a3abba` | The appendix: public tools, AnyProfile |
| `--lp-highlight` | `#fbe36b` | `#e9d45a` | **Needs you now**: a due count, the selection. A fill behind ink, never a text colour |
| `--lp-warning` | `#7a5200` on `#fef5cb` | `#e2b84a` on `#3f3d2e` | Attention. Deliberately the highlighter's family |
| `--lp-danger` | `#9e0b3c` | `#f08a9c` | Destructive or failed, and nothing else |

Each part also has `-soft` (the fill of its key-concept box), `-line` (that box's full
outline) and `-fg` (text on a solid tab). Translucent tints are **frozen to hex**, so
their contrast is measured, not guessed.

**How a part reaches a component.** An element with
`data-part="read|ask|practise|reflect|tools|home"` sets `--lp-part*` for everything
inside it. The utilities `text-part`, `bg-part-soft`, `border-part-line` and `lp-tab`
paint in whichever part they sit in. The shell sets the part from the route
(`lib/parts.ts`). The rail sets it per group. Front matter (Today, More, Settings) is
`home`: ink, with a white card for its box.

Dark is composed for a desk lamp at night, not inverted. Each part colour is lifted
until it reads as text, and the highlighter stays the same yellow with dark ink on it.
Light is the default (owner, 2026-10-19): dark applies only when the visitor chose it with
the theme switch, never from the system setting.

### Type

Three faces, three jobs. All carry Vietnamese (U+1EA0 to U+1EF9 and U+20AB),
self-hosted through `@fontsource`.

| Role | Family | Cuts | Used for |
|---|---|---|---|
| Book | Literata | 400, 400 italic, 600, 800 | `h1` to `h3`, prose, margin notes, the chapter numeral (800), the wordmark |
| Interface | Be Vietnam Pro | 400, 500, 600 | Body, labels, buttons, data |
| Code and data | IBM Plex Mono | 400 | Code, hashes, model ids. Never a label |

The rem scale is fixed (`2xs` 0.6875 to `4xl` 3rem, plus `numeral` 4.5rem). Leading is
1.5 for the interface, **1.85 for prose** (from `up`) and 1.12 for titles. `h1` tracks
`-0.02em`. The latin Literata 600 cut is preloaded because it paints the landing h1.

### Space, radius, depth, motion

- **Space:** a 4pt scale.
- **Radius:** 12px for cards, 8px for controls, 6px for tabs.
- **Depth:** a page lying on a desk. A card is lifted one sheet (`shadow-sm`), and the
  feature covers and the sign-in book use `shadow-md`.
- **Motion:** state feedback at 100 to 200ms, exit faster than entrance,
  `cubic-bezier(0.16, 1, 0.3, 1)`. One entrance per page, the **page turn**
  (`lp-page-enter`, 420ms, 6px rise) on the page header. Reduced motion keeps the fade
  and drops the travel.

### Marks

The products share one tile: AnyProfile's warm-white squircle with a soft shadow,
one glyph in the product's ink (`public/icons/*.svg`, masters at 1024).

- **AnyTools**: a wildcard asterisk, six round-ended navy arms meeting at the centre,
  the top one in the highlighter. The `*` that matches anything: any tool, the one
  needed now marked. Drawn in SVG (comp chosen from four made through 9router,
  2026-10-19), never traced from the raster.
- **AnyLearn**: a navy page with its corner turned, a highlighter line across it, a
  second page behind it (AnyProfile's two tiles, as pages). The product's promise: the
  answer is checked against the page.

Favicons are the glyph alone, cropped tight, and lift to the dark-theme inks under
`prefers-color-scheme: dark`, so they read on a dark tab bar. The study app's pages and
sign-in show AnyLearn's (root.tsx picks by route); everything else shows AnyTools'.
Icon URLs carry `?v=` so a changed mark replaces the cached one.

## Geometry

Measured at 1440:

- **Rail:** 256 wide.
- **Workspace:** padded by 32.
- **Reading measure:** 780.
- **Margin:** 320.

At 390, everything is full-bleed with 16px gutters and no horizontal scroll. This is
checked on every main page, in both themes.

- **The rail is a table of contents.** It runs, in order:
  - the wordmark;
  - Today;
  - Parts I to IV, each under its numeral tab;
  - Settings;
  - then, pushed to the foot, **Appendix: tools**. It holds the **AnyProfile cover**
    (ink card) and "All free tools".

  The current row takes its part's tint, a full outline, weight and a screen-reader
  "Current section". Part groups are `role="group"`, not landmarks.
- **The phone bar** has four destinations plus Tools and More. Its tests cap the bar at
  four destinations. **More** is the phone's table of contents: the same parts,
  then the study tools, then the appendix with the AnyProfile cover.
- **The running head** (topbar) shows the part's tab and the section name, like the top
  of a textbook page. It replaces a breadcrumb.
- **The margin** (right panel) is always present. It shows sources in Read and Ask,
  and the part's own margin note elsewhere (Practise: how review works; Reflect: the
  5-minute / 14-day / 90-day pace from `up`). A page can pass its own content.

### Visitor mode per surface

- **Persuade:** the landing (`/`). It shows the study app first, the book's contents
  I to IV, then the appendix led by AnyProfile.
- **Operate:** every app page.
- **Read:** documents, books, notebooks, reports and guides. They keep the 780 measure
  and the progress hairline, in the part's colour.
- **Public tools:** the appendix. Its header's one filled button leads back to the
  study app, and a study band sits above every footer.

## Components and moves

1. **The page header** (`components/ui/page-header.tsx`): a book-face title, a lede
   and the page's actions. A **chapter numeral** appears only when the number means
   something: a book chapter's position, a review's week. Nothing floats above a title.
   A kind or status sits below it as a part tab.
2. **The part tab** (`lp-tab`): a small solid label in the part's colour, like a
   chapter's edge tab. It does wayfinding and is never a control.
3. **The key-concept box** (`lp-keybox`): the part's tint with a full outline. It is
   used for Today's next step and due box, the Loop's goal, book definitions, and the
   AnyProfile install steps.
4. **The highlighter** (`lp-highlight`): a marker stroke behind a due count. Selection
   is the highlighter too.
5. **The workbook empty state** (`lp-empty`): a dashed answer box in italic book face.
   It says what will appear and how to put it there.
6. **The dot leader** (`lp-leader`): drawn dots between a name and its count, used in
   the tools index.
7. **Section tabs** (`components/ui/section-tabs.tsx`): Settings, Mastery and Quiz
   (`components/quiz/quiz-tabs.tsx`). The current tab is tinted and outlined, **never
   underlined**. Ways of doing one thing inside a page (adding to a knowledge base) use
   the same look as ARIA tabs: `components/ui/panel-tabs.tsx`.
8. **The cover:** ink panels for AnyProfile (More, tools home, landing, its own page)
   and for the sign-in book. It is the one block that is not paper. On the rail,
   beside study pages, AnyProfile is a slate-tinted card instead: the ink block was
   the heaviest shape on every page.
9. **Share cards:** the site card is drawn from `deploy/og/og.html` (title beside the contents I to IV). A tool's
   card is rendered by `lib/tools/og-image.server.ts` with the part tab of the appendix. Bump `OG_VERSION` in
   `lib/tools/seo.ts` whenever either changes look, or caches serve the old card for a day.
10. **Fields:** white (`bg-card`), with a 3:1 control outline. On a phone they are 16px,
   from an unlayered rule, so iOS does not zoom. A file input keeps the native control
   with an outlined button (`lp-file`).
11. **Lists that open:** a list for finding things (the question bank) is one row per
   item, opening into the full card. A long form that is needed now and then (a goal's
   interruption) is folded behind a labelled `<details>`.
12. **Progress against a mark** (`components/mastery/mastery-meter.tsx`): a bar in the
   part's colour with an ink tick at the pass threshold, beside the numbers in text.
13. **Dates** (`components/ui/date-text.tsx`): "19 Oct 2026", never a numeric date.
   API errors shown after our own sentence go through `lib/sentence.ts`.

14. **The chat surface** (plan 261019-1015, after postclaw's): an answer opens with
   its **work row** (`components/chat/work-row.tsx`), one folded muted line ("Searched
   twice · 9 passages · 3.1 s") that opens onto the steps; it names the running step
   while the turn streams and never spins. Under the answer: Listen, Copy, Ask again
   (last answer only), Draw it, then **follow-ups** as outlined pill buttons (last
   answer only). The last question has Edit. The composer sticks above the phone bar,
   grows to 160px, keeps a draft per conversation, queues up to three messages while
   a turn runs, and carries the model menu and the keyboard hint underneath. "Jump to
   latest" appears only when the learner has scrolled away from a streaming answer.

15. **The site header** (`components/layout/site-header.tsx`, owner 2026-10-19): one
   header on the landing page, every public tool page and sign-in, drawn from the
   landing page's. Wordmark (to `/` in the visitor's language), Tools / Guides /
   AnyProfile, then the tools search where the page has none of its own, the
   **language menu** (a `<details>` naming the current language; pages in one
   language draw none), the theme switch, and Sign in as an outlined button. On a
   phone the places and Sign in fold into the ☰ menu and the search takes its own row.
   The signed-in app keeps its rail and topbar: a workspace, not a site (ten places in
   four parts do not fit three header links). The topbar ends like the site header: the
   wordmark in the same size on a phone, the theme switch, and Sign out as the same
   outlined button (`ACCOUNT_ACTION`). The site
   **footer** (`SiteFooter`) is one too: wordmark, a sentence, the links.
16. **Plates** (`components/ui/plate.tsx`, `public/plates/`): textbook figures in pen
   and ink with flat washes in the parts' colours, made with 9router
   (`comp-gen.mjs`), each prompt kept beside its file as JSON. The paper is
   transparent, so on a light page only the drawing shows; in dark mode a plate is
   printed on `--lp-plate-paper`, rounded. Always decorative (`alt=""`), one per
   first viewport at most, 600/1200 WebP. A page's first-run empty state is the
   part's plate beside the sentence (`PlateEmpty`); an empty list inside a busy page
   stays an `lp-empty` line. A new plate is made the same way, never a stock photo.

## Anti-patterns for this project

- **One-sided borders.** Callouts, quotes, tabs and timelines all use full outlines or
  tints. `detect.mjs` reports none.
- **An eyebrow above a title.** The part tab goes below it, or in the running head.
- **Misused part colours.** A part colour never goes on a button or a link; navy is
  the only action ink. The highlighter is never text, and red is never "attention".
- **Mono as a costume.** Plex Mono is for code and data. Labels are sans, in sentence
  case.
- **Em dashes in the app's English copy.** Rendered joins use ` · `. A bare `—` still
  marks a missing value, and the indexed page titles keep theirs.
- **Colour as the only carrier of meaning.** The current row has tint, outline, weight
  and screen-reader text.

## Verified (2026-10-19)

- **axe-core 4.10.2, 0 violations** on:
  - the app at 1440 light: Today, Loop, a goal, a knowledge base, Settings, Quiz,
    Mastery, Chat;
  - the app at 1440 dark: Today, a goal, Settings, Chat, Knowledge;
  - the app at 390: Today, More, Settings, Loop (light) and Today (dark);
  - the public side at 1440: landing, sign-in, tools home, AnyProfile, a tool page,
    guides, privacy, a cluster;
  - the public side at 390 dark: landing, sign-in, tools home, AnyProfile.
- **No horizontal scroll** at any of them.
- `theme-contrast.test.ts`: 28 checks, every part on every surface and on its own box,
  in both themes.
- Full web suite: 5979 passed.

## View-by-view review (2026-10-19)

Every study view was seen with real content (plan `261019-0148-study-ui-review`):
documents indexed through the real pipeline on a local model, the rest seeded. What
changed: chat chooses its knowledge bases; the reader renders Markdown; a failed
document can be retried; a knowledge base leads with its documents and how to study
them; the question bank is a list; Quiz has section tabs; Today ticks finished setup
steps; mastery modules show a meter; the margin no longer says "Nothing is cited" on
pages that never cite. axe 0 on the changed views at 1440 light and 390 dark, apart
from two findings caused by the seeded answer's own Markdown.

## Open follow-ups

- The mastery explain-back verdict and a live (streaming) chat turn were seen only in
  their empty and stored states; the local model could not produce a real one.
- The 137 tool UIs (`app/tools/*`) keep their own copy, which still has 34 em dashes,
  and small uppercase labels in some templates. Their primitives (`tools-ui`) are on
  the world.
- `--lp-warning` and the highlighter are one family on purpose. If a page ever needs
  "due" and "warning" side by side, it should separate them with a label, not a
  second yellow.
- There is still no `<meta name="theme-color">`. Injecting it from `tokens.css` at
  build time is the right fix.
