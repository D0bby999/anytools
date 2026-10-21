/**
 * chat-search.ts — finding text in a conversation (pure).
 *
 * The matcher is postclaw's (lib/chat-search.ts): both sides are folded for
 * case and diacritics, so "nghieng" finds "nghiêng", with an index map back to
 * the ORIGINAL text, because a match is highlighted where the reader sees it.
 * `đ` / `Đ` are letters of their own that NFD does not decompose, so they are
 * folded by hand.
 *
 * What is searched differs: postclaw searched its turn model and marked a whole
 * markdown answer as one hit. Here the hook (use-chat-search.ts) hands over the
 * rendered text of each searchable block (questions, answers, the work steps,
 * folded or not), and the matches become ranges inside the rendered answer, so
 * the exact words are highlighted even inside Markdown.
 */

export type SearchHit = {
  /** Index of the text segment the hit is in. */
  segment: number;
  /** Range in the segment's ORIGINAL text. */
  start: number;
  end: number;
};

/**
 * Folds a string for comparison and maps each folded offset back to the
 * original one. `map[folded.length]` is the original length, so `map[end]` is
 * a valid exclusive end.
 */
export function foldWithMap(input: string): { folded: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "đ" || ch === "Đ") {
      out.push("d");
      map.push(i);
      continue;
    }
    const bare = ch.normalize("NFD").replace(/\p{M}/gu, "");
    for (const c of bare) {
      out.push(c.toLowerCase());
      map.push(i);
    }
  }
  map.push(input.length);
  return { folded: out.join(""), map };
}

export function fold(input: string): string {
  return foldWithMap(input).folded;
}

/**
 * Every occurrence of `query` across the segments, in order. An empty query
 * finds nothing (an empty box must not highlight the whole conversation), and
 * occurrences do not overlap, so each hit is one highlight.
 */
export function findHits(segments: readonly string[], query: string): SearchHit[] {
  const needle = fold(query.trim());
  if (needle === "") return [];
  const hits: SearchHit[] = [];
  segments.forEach((text, segment) => {
    if (!text) return;
    const { folded, map } = foldWithMap(text);
    let from = 0;
    for (;;) {
      const at = folded.indexOf(needle, from);
      if (at === -1) break;
      hits.push({ segment, start: map[at]!, end: map[at + needle.length]! });
      from = at + needle.length;
    }
  });
  return hits;
}

/** The next position, wrapping: 0-based, -1 when there is nothing. */
export function step(position: number, count: number, by: 1 | -1): number {
  if (count === 0) return -1;
  if (position < 0) return by === 1 ? 0 : count - 1;
  return (position + by + count) % count;
}
