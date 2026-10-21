/**
 * chat-tool-categories.ts — what kind of work each chat tool does (pure).
 *
 * After postclaw's lib/chat-tool-categories.ts, in AnyLearn's own words: the
 * process row names a group of steps by its kinds of work ("Searched, Read
 * sources") rather than by tool names. `chat-tool-categories.test.ts` reads
 * the Go tools (internal/tools) and fails when one has no category here, so a
 * new tool forces a decision instead of reading as "Worked".
 */
import { BookOpen, Lightbulb, MessageCircleQuestion, PenLine, Search, Sparkles, type LucideIcon } from "lucide-react";

export const PROCESS_CATEGORIES = ["search", "read", "write", "ask", "thinking", "other"] as const;
export type ProcessCategory = (typeof PROCESS_CATEGORIES)[number];

/** Every tool a chat turn can call, by category. */
export const TOOL_CATEGORIES: Record<string, ProcessCategory> = {
  rag_search: "search",
  paper_search: "search",
  zotero_search: "search",
  web_search: "search",
  read_source: "read",
  kb_files: "read",
  web_fetch: "read",
  write_note: "write",
  ask_user: "ask",
};

export const CATEGORY_ICONS: Record<ProcessCategory, LucideIcon> = {
  search: Search,
  read: BookOpen,
  write: PenLine,
  ask: MessageCircleQuestion,
  thinking: Lightbulb,
  other: Sparkles,
};

export function toolCategory(tool: string): ProcessCategory {
  return TOOL_CATEGORIES[tool] ?? "other";
}

/** The i18n key for a category: "Searching" while it runs, "Searched" after. */
export function categoryLabelKey(category: ProcessCategory, running: boolean): string {
  return `chat.process.category.${category}.${running ? "running" : "done"}`;
}

export type CategoryStep = { kind: "thinking" } | { kind: "tool"; name: string };

/**
 * Categories in a run of steps, most frequent first; a tie keeps the order
 * they first appeared in, so a title does not reshuffle as steps arrive.
 */
export function rankCategories(steps: CategoryStep[]): ProcessCategory[] {
  const counts = new Map<ProcessCategory, number>();
  for (const step of steps) {
    const c = step.kind === "thinking" ? "thinking" : toolCategory(step.name);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
