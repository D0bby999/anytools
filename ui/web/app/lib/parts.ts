/**
 * parts.ts
 * The textbook's table of contents: which PART of the book a page belongs to.
 *
 * The world (tokens.css, DESIGN.md) divides the app into four parts, each
 * owning one colour that is used only for wayfinding, plus the front matter
 * (Today, More, Settings) and the tools appendix. The shell sets
 * `data-part` from this map, so a page's tab, numeral, key-concept boxes and
 * reading progress all take its part's colour without the page naming one.
 */
export type PartId = "home" | "read" | "ask" | "practise" | "reflect" | "tools";

/** The four numbered parts, in book order. */
export const PARTS = [
  { id: "read", numeral: "I", labelKey: "parts.read.title", bodyKey: "parts.read.body" },
  { id: "ask", numeral: "II", labelKey: "parts.ask.title", bodyKey: "parts.ask.body" },
  { id: "practise", numeral: "III", labelKey: "parts.practise.title", bodyKey: "parts.practise.body" },
  { id: "reflect", numeral: "IV", labelKey: "parts.reflect.title", bodyKey: "parts.reflect.body" },
] as const satisfies ReadonlyArray<{ id: PartId; numeral: string; labelKey: string; bodyKey: string }>;

/** First path segment to part. Anything not listed is front matter. */
const BY_SEGMENT: Record<string, PartId> = {
  knowledge: "read",
  documents: "read",
  books: "read",
  feeds: "read",
  notebooks: "read",
  chat: "ask",
  solve: "ask",
  research: "ask",
  quiz: "practise",
  mastery: "practise",
  loop: "reflect",
  toolkit: "reflect",
  tools: "tools",
};

export function partOf(pathname: string): PartId {
  const segment = pathname.split("/").find(Boolean) ?? "";
  return BY_SEGMENT[segment] ?? "home";
}
