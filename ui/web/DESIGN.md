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

> ~~The textbook's structure: a rail of icons under numeral tabs, a running head, a
> margin that is always there, a phone bar of four places plus More.~~
> **Superseded 2026-10-21:** the owner asked for AnyLearn to take `up`'s structure and
> UX in detail (its VitePress 1.6.4 shell, its page patterns, every feature laid out as
> one of them), then to wear the textbook's own type and colour, which stay as written
> below. Plan `plans/261020-2246-anylearn-up-shell`. The measured mimic (up's colours
> and Inter too) is the git tag `up-shell-mimic`; the numbers are in that plan's
> `reports/fidelity.md`.

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
| `--lp-progress` | the part's colour | the part's colour | The reading-progress hairline, set per part in `app.css` |
| `--lp-backdrop` | `rgba(26,30,41,.5)` | `rgba(0,0,0,.6)` | Behind the drawer and the search modal |
| `--lp-ink-deco` | `#5c6170` | `#9a968b` | Icons and carets only (3:1); never text |

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

**Roles in the up structure.** The article (`.lp-doc`, `components/doc/doc.css`) sets
its prose and titles in the book face; tables, badges and controls inside it, the
sidebar, the top nav and the outline are the interface face. The wordmark is book face.
Kickers are interface face, 12px/600, in sentence case (up's mono capitals are not
kept: see the anti-patterns).

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

- **AnyTools**: four tiles, one navy, two outlined in the selected tint, one in the
  highlighter. A set of tools, one of them needed now. (The wildcard asterisk tried on
  2026-10-19 was taken back the same day: the tiles read better.)
- **AnyLearn**: a navy page with its corner turned, a highlighter line across it, a
  second page behind it (AnyProfile's two tiles, as pages). The product's promise: the
  answer is checked against the page.

Favicons are the glyph alone, cropped tight, and lift to the dark-theme inks under
`prefers-color-scheme: dark`, so they read on a dark tab bar. The study app's pages and
sign-in show AnyLearn's (root.tsx picks by route); everything else shows AnyTools'.
Icon URLs carry `?v=` so a changed mark replaces the cached one.

The **AnyTools logo** (`public/brand/`) is the four tiles beside the wordmark: Literata
600 at the site's display tracking (as the header sets it), outlined so it needs no
font. The tiles are 1.5 times the cap height and centred on the caps, 0.5 cap from the
word. `anytools-logo.svg` and `-dark.svg` are the horizontal lockup on paper and on
the dark theme, `-stacked` the tiles over the word, `-mono` one ink with the tint
tiles left open (print, a single colour); the PNGs are the horizontal lockup at 256 px
high on a transparent ground. The public site's header and footer draw the same
lockup live (`components/layout/anytools-mark.tsx`): the tiles inline, in the tokens,
beside the wordmark as text, at the cap ratio above (24 px beside `text-2xl`, 20 px
beside `text-xl`, `gap-2`). The header shows the tiles from `sm` up: on a phone its first
row has about 9 px to spare, and the tiles would push the theme switch to a second row.

## Geometry

> ~~Rail 256, workspace padded by 32, margin 320 always present; the rail with icons,
> the phone bar, the running head and the margin as described on 2026-10-19.~~
> **Superseded 2026-10-21:** VitePress's geometry, from `up` (plan
> 261020-2246-anylearn-up-shell), measured in Chrome:

Measured at 1440 (`--lp-*` in `tokens.css`):

- **Top nav:** 64 high (`--lp-topbar-h`). The wordmark sits in a column as wide as the
  sidebar; then ⌘K search (40 high, radius 8), four places (Today, Knowledge, Chat,
  Loop: `TOP_NAV`), the language menu, the appearance switch (a 40×22 pill), Free
  tools and the account menu. Below 1280 the inline controls fold into "…"; below 768
  the places too, into a full-screen nav screen behind ☰.
- **Sidebar:** 272 wide (`--lp-rail-w`), on `surface-soft`, no icons. It is the table of
  contents, from one source (`lib/nav-tree.ts`, `NAV_TREE`): Start (Today); Parts I to
  IV, each title behind its numeral tab (`lp-tab` in the part's colour); Settings
  (folded); Appendix: tools (folded). Groups and pages with children fold; the one that
  holds the current page opens itself. The current page is navy, with
  `aria-current="page"` and "Current section"; a current child also has a 6px dot on the
  tree's guide line. Groups are `role="group"`, not landmarks.
- **Article:** 780 (`--lp-measure-read`), 688 (`--lp-measure-aside`) beside an outline
  or a page's own panel. The reader keeps 780 (`handle.measure = "read"`). Chat,
  Solve, Research and a mastery session take the whole width (`handle.layout = "page"`).
- **Aside:** from 1280, 224 wide (`--lp-aside-w`): "On this page" (the page's h2 and h3,
  scroll-spied, a dot on the rail for the current one), then the part's margin note or
  the page's own panel (sources in Ask, the tutor in the reader). Its title lines up
  with the h1.
- **Pager:** under every page in the nav tree, Previous and Next from `flatPages()`
  (two 336×66 cards). A book chapter passes its own order (`handle.pager`).
- **Reading progress:** 2px, fixed at the top, in the part's colour, only when the
  article is more than 160px longer than the screen.

Below 1280 "On this page" is a dropdown in the **local nav** (48 high, under the top
nav). Below 960 the local nav also has **Menu**, which opens the sidebar as a 320
drawer over a backdrop; Esc closes it and returns focus, and the page is `inert`
behind it. There is no phone bar: `/more` lists the same tree as a page. At 390
nothing scrolls sideways; wide tables scroll inside their own box.

### Visitor mode per surface

- **Persuade:** the landing (`/`). It shows the study app first, the book's contents
  I to IV, then the appendix led by AnyProfile.
- **Operate:** every app page.
- **Read:** documents, books, notebooks, reports and guides. They keep the 780 measure
  and the progress hairline, in the part's colour.
- **Public tools:** the appendix. Its header's one filled button leads back to the
  study app, and a study band sits above every footer.

## Components and moves

1. **The page header** (`components/ui/page-header.tsx`): a book-face title (42px, 22ch,
   32px on a phone), a lede and the page's actions under it. Nothing floats above a
   title. ~~A chapter numeral; a part tab below the title.~~ **Superseded 2026-10-21:**
   up's header has neither; the sidebar and the outline say where you are.
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
7. **Section tabs** (`components/ui/section-tabs.tsx`). **Since 2026-10-21** they are
   drawn as up's nav links: 14/500, the current one in navy with `aria-current`, no
   tint, no outline, no underline. What follows describes where they are used:: Settings, Mastery and Quiz
   (`components/quiz/quiz-tabs.tsx`). The current tab is tinted and outlined, **never
   underlined**. Ways of doing one thing inside a page (adding to a knowledge base) use
   the same look as ARIA tabs: `components/ui/panel-tabs.tsx`.
8. **The cover:** ink panels for AnyProfile (More, tools home, landing, its own page)
   and for the sign-in book. It is the one block that is not paper. ~~On the rail,
   AnyProfile is a slate-tinted card.~~ **Superseded 2026-10-21:** the sidebar is a
   table of contents of text rows, so AnyProfile is a row in its folded Appendix group.
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
   while the turn streams and never spins. **Since 2026-10-21** the conversation reads
   as a chapter (`layout: "page"`): the learner's question is a block on the right, not a
   heading; the answer is prose in the book face with citations as superscript numbers
   (their names start with the number); its sources are in the aside. Under the answer:
   Listen · Copy · Ask again (last answer only) · Draw it, as text links, then
   **follow-ups** as "→" links (last answer only). The last question has Edit. The
   composer sticks to the foot of the page, grows to 160px, keeps a draft per conversation, queues up to three messages while
   a turn runs, and carries the model menu and the keyboard hint underneath. "Jump to
   latest" appears only when the learner has scrolled away from a streaming answer.

15. **The site header** (`components/layout/site-header.tsx`, owner 2026-10-19): one
   header on the landing page, every public tool page and sign-in, drawn from the
   landing page's. Wordmark (to `/` in the visitor's language), Tools / Guides /
   AnyProfile, then the tools search where the page has none of its own, the
   **language menu** (a `<details>` naming the current language; pages in one
   language draw none), the theme switch, and Sign in as an outlined button. On a
   phone the places and Sign in fold into the ☰ menu and the search takes its own row.
   The signed-in app has its own top nav and sidebar (Geometry): a workspace, not a
   site. ~~Its rail and topbar.~~ **Superseded 2026-10-21** by up's top nav, whose
   account menu holds Sign out. The site
   **footer** (`SiteFooter`) is one too: wordmark, a sentence, the links.
16. **Plates** (`components/ui/plate.tsx`, `public/plates/`): textbook figures in pen
   and ink with flat washes in the parts' colours, made with 9router
   (`comp-gen.mjs`), each prompt kept beside its file as JSON. The paper is
   transparent, so on a light page only the drawing shows; in dark mode a plate is
   printed on `--lp-plate-paper`, rounded. Always decorative (`alt=""`), one per
   first viewport at most, 600/1200 WebP. A page's first-run empty state is the
   part's plate beside the sentence (`PlateEmpty`); an empty list inside a busy page
   stays an `lp-empty` line. A new plate is made the same way, never a stock photo.
   Three plates mark a moment rather than a part, each on a wide screen only (`sm` up)
   so a phone's first viewport stays the work: `done-today` beside Home's due count when
   nothing is due (not on a low day), `low-day` beside the goal in Home's Today block on a
   low day (the smaller step is the plan, not a failure), and `part-body` on the card a
   finished workout shows; `part-body` is also Body's first-run plate.

17. **up's page patterns** (`components/doc/`, spec in the plan's
   `reports/feature-ui-spec.md`). Every app page is one column built from them:
   **At a glance** (an h2 and a short list), **numbered sections** (h2 "1. …" with a
   rule above), **QuickStart** (kicker, title, one primary and up to two secondary
   actions, the cycle line), **BookMeta** (numbers split by 1px rules), **GuidePaths**
   (Today's groups, tinted and outlined in their part's colour, names in navy),
   **DatedList** (**date** · title · note; the join is `NOTE_JOIN` in
   `lib/sentence.ts`), **RefTable** (zebra rows, scrolls inside itself),
   **DownloadGrid**, **ChoiceRow** (an answer or option as up's search-result row: a 2px
   outline, navy when chosen, danger or tip after marking), **FieldTable** (a form as a
   table of inputs), **Field**, **Badge**, **Details**, **CodeBlock** (with Copy),
   **StatusLine** (the result of an action, `role="status"`, under its buttons, never a
   toast), **Dialog**, **ProgressBar**, **WorksheetActions** (Download Markdown, Copy
   worksheet), **Closing** and the **404**. Charts always have a table of their numbers
   under them.
18. **Search** (`components/layout/search-modal.tsx`, ⌘K, Ctrl K or `/`): up's local
   search box over the nav tree and the learner's own titles
   (`/app/api/search-index`, per user). It matches without diacritics ("ngan hang"
   finds "Ngân hàng"), ↑↓ choose, Enter opens, Esc returns focus where it came from.
19. **ScrollBox** (`components/doc/scroll-box.tsx`) and `useOverflowTabStop`: a wide
   table scrolls in its own box, which is a tab stop only while it overflows and is
   positioned, so the sr-only labels in its cells cannot widen the page.

## Anti-patterns for this project

- **One-sided borders.** Callouts, quotes, tabs and timelines all use full outlines or
  tints. `detect.mjs` reports none.
- **An eyebrow above a title.** The part tab goes below it, or in the running head.
- **Misused part colours.** A part colour never goes on a button or a link; navy is
  the only action ink. The highlighter is never text, and red is never "attention".
- **Mono as a costume.** Plex Mono is for code and data. Labels are sans, in sentence
  case. This is why up's mono capital kickers ("START HERE") were not kept.
- **Em dashes in the app's English copy.** Rendered joins use ` · `. A bare `—` still
  marks a missing value, and the indexed page titles keep theirs.
- **Colour as the only carrier of meaning.** The current row has tint, outline, weight
  and screen-reader text.

## Deliberate departures from `up` (2026-10-21)

- The textbook's type and colour instead of Inter, white and up's green.
- A 6px dot instead of up's 2px coloured bar for the current child and the outline's
  current entry, and blockquotes with a full outline instead of a left bar (one-sided
  borders are banned here).
- Accessibility up's theme does not do: `aria-current` and "Current section", group
  titles as real buttons, the page `inert` behind the drawer, labelled scroll boxes.
- One scroll region (`[data-lp-scroll]`) instead of the window, for the reasons in
  `routes/app-layout.tsx`; the nav and sidebar sit outside it rather than `fixed`.
- Light by default, never from the system setting (owner, 2026-10-19).
- Plates are kept (first-run empty states and the moments listed under Plates).

## Verified (2026-10-21, up structure)

- axe-core 4.10.2 (wcag2a/aa, wcag21a/aa, best-practice), 0 violations on the final
  version at 1440 light: Today, a knowledge base, a document, a conversation, the
  question bank, Mastery, a learning state, a worksheet, Settings, Body, More; at 1440
  dark: Today, the question bank, Loop, Settings, a conversation, Knowledge; at 390
  light: Today, a knowledge base, Chat, the question bank, Loop, Mastery, a worksheet,
  Settings, More. The mimic had the same on 40 more page checks, with the drawer and
  the search modal open (the plan's `reports/fidelity.md`).
- No horizontal scroll at any of them.
- Geometry of the final version equals the mimic's: nav 64, sidebar 272, article 688
  beside the outline, aside at x 1169 and 224 wide, h1 42/49.56.
- Full web suite: 6754 passed; the 13 failures are the unbuilt tool-runtime folder in a
  fresh worktree (`tool-runtime`, `tools-batch-b`, `unzip-archive`), as before the plan.

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
