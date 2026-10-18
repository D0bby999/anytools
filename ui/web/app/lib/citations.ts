/**
 * citations.ts
 *
 * The client half of the product's ONE citation representation:
 *
 *     [[cite:chunk:<id>]]
 *
 * The server (Go: internal/citations) validates these and drops any whose id no
 * tool in the turn produced, so anything reaching this file is meant to render
 * as a chip. Splitting the text here rather than in a component means the
 * renderer and the validator agree on what a marker is — the pattern below is
 * the same one `internal/citations/parse.go` compiles.
 *
 * This is NOT a `.server.ts` module on purpose: the chip renders in the
 * browser, and a component importing a server module pulls the gateway token
 * into the client bundle (app/test/structural-guards.test.ts).
 */

/** `[[cite:<kind>:<id>]]`, with the same narrow id charset as the Go parser. */
export const CITATION_PATTERN = /\[\[cite:(chunk|url):([A-Za-z0-9_.:-]{1,128})\]\]/g;

/** A run of text, or a citation marker found in it. */
export type Segment =
  | { kind: "text"; text: string }
  | { kind: "citation"; citeKind: string; id: string };

/**
 * Splits an answer into text runs and citation markers, in order.
 *
 * Returning segments rather than HTML keeps the escaping decision in React,
 * where it is automatic. Building a string with `<a>` in it and setting
 * innerHTML would make every model-authored answer an XSS surface.
 */
export function splitCitations(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  // A global regex carries lastIndex across calls, so it is reset here rather
  // than trusted: a shared module-level pattern that skipped the first match of
  // every other answer would be maddening to diagnose.
  CITATION_PATTERN.lastIndex = 0;

  for (let m = CITATION_PATTERN.exec(text); m !== null; m = CITATION_PATTERN.exec(text)) {
    if (m.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, m.index) });
    }
    segments.push({ kind: "citation", citeKind: m[1] ?? "chunk", id: m[2] ?? "" });
    cursor = m.index + m[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}
