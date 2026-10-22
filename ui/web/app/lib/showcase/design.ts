/**
 * showcase/design.ts
 * The public profile's design document (the private design notes):
 * a theme and the blocks in order. The server checks it
 * (internal/showcase/design.go); this side lists what the editor offers and
 * the page draws (components/showcase/showcase-view.tsx).
 *
 * To let learners design more later:
 *  - a new block type: add it to BLOCK_SPECS here, to blockSpecs in
 *    design.go, a view in BLOCK_VIEWS, and its words in showcase.json;
 *  - a new option of a block: a field on Block, its check in design.go, and
 *    a control in the editor's BlockEditor;
 *  - a new theme option: a field on Theme, its check in design.go, applied
 *    in ShowcaseView's wrapper;
 *  - a change that rewrites stored pages: DESIGN_VERSION + 1 and a case in
 *    design.go's upgrade, so every saved page keeps rendering.
 */

export const DESIGN_VERSION = 1;

/** The app's part colours, each measured for contrast in both themes. */
export const ACCENTS = ["reflect", "read", "ask", "practise", "tools"] as const;
export type Accent = (typeof ACCENTS)[number];

export const BLOCK_TYPES = ["summary", "calendar", "milestones", "outcomes", "about", "links"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type ShowcaseLink = { label: string; url: string };
export type Block = { type: BlockType; title?: string; body?: string; links?: ShowcaseLink[] };
export type Theme = { accent: Accent };
export type Design = { version: number; theme: Theme; blocks: Block[] };

export const LIMITS = {
  blocks: 12,
  name: 60,
  headline: 120,
  aboutTitle: 60,
  aboutBody: 1000,
  links: 5,
  linkLabel: 40,
  url: 300,
} as const;

/**
 * How each block may be used: how many a page may have, whether it shows
 * AnyLearn's count (data) or the learner's words, and a new one.
 */
export const BLOCK_SPECS: Record<BlockType, { max: number; data: boolean; make: () => Block }> = {
  summary: { max: 1, data: true, make: () => ({ type: "summary" }) },
  calendar: { max: 1, data: true, make: () => ({ type: "calendar" }) },
  milestones: { max: 1, data: true, make: () => ({ type: "milestones" }) },
  outcomes: { max: 1, data: true, make: () => ({ type: "outcomes" }) },
  about: { max: 3, data: false, make: () => ({ type: "about", title: "", body: "" }) },
  links: { max: 1, data: false, make: () => ({ type: "links", links: [{ label: "", url: "" }] }) },
};

/** A handle as the server accepts it (showcase.CheckHandle), reserved words aside. */
export const HANDLE_PATTERN = "[a-z0-9][a-z0-9\\-]{1,28}[a-z0-9]";

export function canAdd(design: Design, type: BlockType): boolean {
  return design.blocks.length < LIMITS.blocks && design.blocks.filter((b) => b.type === type).length < BLOCK_SPECS[type].max;
}

/** The list with one entry moved by one place, up (-1) or down (+1). */
export function move<T>(blocks: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= blocks.length) return blocks;
  const out = [...blocks];
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
}

/** What AnyLearn counted, for the blocks on the page (showcase.Stats). */
export type Milestone = { kind: string; target: number; reached_on: string };
export type ShowcaseStats = {
  /** The day the numbers are counted through; only when a counted block is on the page. */
  as_of?: string;
  /** The first study day; with the summary block only. */
  since?: string;
  summary: {
    days: number;
    streak: number;
    longest_streak: number;
    week_goal: number;
    weeks_in_a_row: number;
    longest_weeks: number;
    level: number;
  } | null;
  calendar: { day: string; count: number }[] | null;
  milestones: Milestone[] | null;
  outcomes: { long_term: number; mastered: number; explains_passed: number; answered: number; workouts: number } | null;
};

export type ShowcaseProfile = {
  handle: string;
  name: string;
  headline: string;
  published: boolean;
  /** Search engines may list the page while it is published. */
  indexed: boolean;
  design: Design;
  updated_at: string;
};

export type ShowcasePage = { profile: ShowcaseProfile; stats: ShowcaseStats };
/** `dropped`: stored blocks this version could not take (-1: none could be read). */
export type MyShowcase = { profile: ShowcaseProfile | null; dropped?: number; default_design: Design; stats: ShowcaseStats };

/** The public address of a page, from the site's origin. */
export function showcasePath(handle: string): string {
  return `/u/${handle}`;
}

/**
 * A page in one language. The bare address answers in the visitor's
 * language (the x-default); `?lang=` names one, so each language has an
 * address of its own for search engines.
 */
export function showcaseLangPath(handle: string, lang: string): string {
  return `${showcasePath(handle)}?lang=${lang}`;
}
