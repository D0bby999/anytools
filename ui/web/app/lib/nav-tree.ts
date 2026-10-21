/**
 * nav-tree.ts
 * The app's one table of contents, as `up` keeps its `navigation.mjs`: the
 * sidebar, the pager, the search index and the /more page all read this, so a
 * destination is added in one place and appears in all four.
 *
 * `collapsed` follows VitePress: absent = always open and no caret; `true` =
 * folded by default; `false` = open by default but foldable. The order of the
 * array is the reading order, which is also the pager's Previous / Next.
 */

import {
  BookOpen,
  Dumbbell,
  GraduationCap,
  Home,
  Languages,
  ListChecks,
  MessageSquare,
  NotebookPen,
  NotebookText,
  Repeat,
  Settings,
  Sigma,
  Telescope,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavPage = {
  to: string;
  labelKey: string;
  /** Matches only the exact path (NavLink's `end`). */
  end?: boolean;
  /** Outside this app's router (the tools site): a document link, not a Link. */
  external?: boolean;
  items?: NavPage[];
  collapsed?: boolean;
  /** Top-level pages only: the sidebar row's icon, so a row is found by shape before it is read. */
  icon?: LucideIcon;
};

/** One of the learner's own titles in the search index (routes/app.api.search-index.ts). `section` is a common.json label key. */
export type SearchIndexItem = { title: string; to: string; section: string };

export type NavGroup = {
  id: string;
  labelKey: string;
  collapsed?: boolean;
  items: NavPage[];
  /** The sidebar draws no title for it (Start holds Today alone); the label still names the group. */
  untitled?: boolean;
  /** A folded group drawn as a row of its own (Settings, Appendix), with this icon. */
  icon?: LucideIcon;
};

export const NAV_TREE: NavGroup[] = [
  { id: "start", labelKey: "nav.groups.start", untitled: true, items: [{ to: "/home", labelKey: "nav.home", end: true, icon: Home }] },
  {
    id: "read",
    labelKey: "nav.groups.read",
    items: [
      { to: "/knowledge", labelKey: "nav.knowledge", icon: BookOpen },
      { to: "/notebooks", labelKey: "nav.notebooks", icon: NotebookPen },
    ],
  },
  {
    id: "ask",
    labelKey: "nav.groups.ask",
    items: [
      { to: "/chat", labelKey: "nav.chat", icon: MessageSquare },
      { to: "/solve", labelKey: "nav.solve", icon: Sigma },
      { to: "/research", labelKey: "nav.research", icon: Telescope },
    ],
  },
  {
    id: "practise",
    labelKey: "nav.groups.practise",
    items: [
      {
        to: "/quiz",
        labelKey: "nav.quiz",
        icon: ListChecks,
        end: true,
        collapsed: true,
        items: [
          { to: "/quiz/bank", labelKey: "nav.pages.quizBank" },
          { to: "/quiz/practice", labelKey: "nav.pages.quizPractice" },
          { to: "/quiz/exams", labelKey: "nav.pages.quizExams" },
        ],
      },
      {
        to: "/mastery",
        labelKey: "nav.mastery",
        icon: GraduationCap,
        end: true,
        collapsed: true,
        items: [
          { to: "/mastery/review", labelKey: "nav.pages.masteryReview" },
          { to: "/mastery/vocabulary", labelKey: "nav.pages.masteryVocabulary" },
          { to: "/mastery/book-cards", labelKey: "nav.pages.masteryBookCards" },
          { to: "/mastery/decks", labelKey: "nav.pages.masteryDecks" },
        ],
      },
      { to: "/languages", labelKey: "nav.languages", icon: Languages },
      {
        to: "/body",
        labelKey: "nav.body",
        icon: Dumbbell,
        end: true,
        collapsed: true,
        items: [
          { to: "/body/plan", labelKey: "nav.pages.bodyPlan" },
          { to: "/body/progress", labelKey: "nav.pages.bodyProgress" },
          { to: "/body/coach", labelKey: "nav.pages.bodyCoach" },
          { to: "/body/library", labelKey: "nav.pages.bodyLibrary" },
        ],
      },
    ],
  },
  {
    id: "reflect",
    labelKey: "nav.groups.reflect",
    items: [
      { to: "/loop", labelKey: "nav.loop", icon: Repeat },
      { to: "/toolkit", labelKey: "nav.pages.toolkit", icon: NotebookText },
    ],
  },
  {
    id: "settings",
    labelKey: "nav.groups.settings",
    icon: Settings,
    collapsed: true,
    items: [
      { to: "/settings", labelKey: "nav.pages.settingsConnections", end: true },
      { to: "/settings/routes", labelKey: "nav.pages.settingsRoutes" },
      { to: "/settings/search", labelKey: "nav.pages.settingsSearch" },
      { to: "/settings/account", labelKey: "nav.pages.settingsAccount" },
      { to: "/settings/profile", labelKey: "nav.pages.settingsProfile" },
      { to: "/settings/storage", labelKey: "nav.pages.settingsStorage" },
      { to: "/settings/reminders", labelKey: "nav.pages.settingsReminders" },
    ],
  },
  {
    id: "appendix",
    labelKey: "nav.groups.appendix",
    icon: Wrench,
    collapsed: true,
    items: [
      // `/tools` redirects to the tools home in the learner's language, and
      // `?page=anyprofile` to AnyProfile there (routes/tools.ts allowlists it).
      { to: "/tools", labelKey: "nav.pages.freeTools", external: true },
      { to: "/tools?page=anyprofile", labelKey: "nav.pages.anyProfile", external: true },
    ],
  },
];

/** The four links on the top nav, as `up` has four: the main ways in. */
export const TOP_NAV: { to: string; labelKey: string }[] = [
  { to: "/home", labelKey: "nav.home" },
  { to: "/knowledge", labelKey: "nav.knowledge" },
  { to: "/chat", labelKey: "nav.chat" },
  { to: "/loop", labelKey: "nav.loop" },
];

/** Every page of the tree with its group, depth first: the reading order. */
export function flatEntries(): { group: NavGroup; page: NavPage; parent?: NavPage }[] {
  const out: { group: NavGroup; page: NavPage; parent?: NavPage }[] = [];
  for (const group of NAV_TREE) {
    for (const page of group.items) {
      out.push({ group, page });
      for (const child of page.items ?? []) out.push({ group, page: child, parent: page });
    }
  }
  return out;
}

/** The pages in reading order, for the pager. External pages are left out. */
export function flatPages(): NavPage[] {
  return flatEntries()
    .map((e) => e.page)
    .filter((p) => !p.external);
}

/**
 * Pages with no entry of their own, named by the page they are opened from: a
 * document, a book and a feed from Knowledge, the old English page from
 * Languages, a shared import from Knowledge.
 */
const ALIAS: Record<string, string> = {
  documents: "/knowledge",
  books: "/knowledge",
  feeds: "/knowledge",
  share: "/knowledge",
  english: "/languages",
};

function matches(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(to + "/");
}

/**
 * The tree entry a path belongs to: the page itself, or for a detail page
 * (`/chat/abc`, `/quiz/exams/x`) the deepest page whose path is its prefix.
 * The sidebar lights that entry and opens the groups around it.
 */
export function sectionOf(pathname: string): { group: NavGroup; page: NavPage; parent?: NavPage } | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const alias = ALIAS[path.split("/")[1] ?? ""];
  const target = alias ?? path;
  let best: { group: NavGroup; page: NavPage; parent?: NavPage } | null = null;
  for (const entry of flatEntries()) {
    if (entry.page.external || !matches(target, entry.page.to)) continue;
    if (!best || entry.page.to.length > best.page.to.length) best = entry;
  }
  return best;
}

/**
 * A top-nav link is current when the page is in its section, by the same rule
 * as the sidebar: a document lights Knowledge, a question bank lights nothing
 * (Quiz is not a top link).
 */
export function isTopActive(pathname: string, to: string): boolean {
  const entry = sectionOf(pathname)?.page.to;
  return !!entry && (entry === to || entry.startsWith(to + "/"));
}

/** The previous and next pages of an exact tree page; none for a detail page. */
export function pagerOf(pathname: string): { prev?: NavPage; next?: NavPage } | null {
  const pages = flatPages();
  const i = pages.findIndex((p) => p.to === pathname);
  if (i === -1) return null;
  return { prev: pages[i - 1], next: pages[i + 1] };
}
