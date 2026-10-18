/**
 * The client's half of the ONE citation format. The Go validator
 * (internal/citations) and this parser have to agree on what a marker is; these
 * cases are the same ones its test file pins.
 */
import { describe, expect, it } from "vitest";
import { CITATION_PATTERN, splitCitations } from "~/lib/citations";

describe("splitCitations", () => {
  it("splits text and markers in order", () => {
    const segments = splitCitations("Hybrid [[cite:chunk:abc-1]] merges arms [[cite:chunk:def-2]].");

    expect(segments).toEqual([
      { kind: "text", text: "Hybrid " },
      { kind: "citation", citeKind: "chunk", id: "abc-1" },
      { kind: "text", text: " merges arms " },
      { kind: "citation", citeKind: "chunk", id: "def-2" },
      { kind: "text", text: "." },
    ]);
  });

  it("returns a single text run when there is nothing to cite", () => {
    expect(splitCitations("No documents cover that.")).toEqual([
      { kind: "text", text: "No documents cover that." },
    ]);
  });

  it("handles a marker at the very start and the very end", () => {
    expect(splitCitations("[[cite:chunk:a]]")).toEqual([
      { kind: "citation", citeKind: "chunk", id: "a" },
    ]);
  });

  it("parses the url kind phase 9 adds", () => {
    expect(splitCitations("See [[cite:url:3]]")).toEqual([
      { kind: "text", text: "See " },
      { kind: "citation", citeKind: "url", id: "3" },
    ]);
  });

  /**
   * The charset is narrow on both sides of the wire. A permissive pattern would
   * let a poisoned document's text be swallowed into an "id" and then rendered.
   */
  it("leaves malformed markers as literal text", () => {
    for (const text of [
      "[[cite:chunk:]]",
      "[[cite:file:abc]]",
      "[[cite:chunk:has space]]",
      "[[cite:chunk:<script>]]",
      "[cite:chunk:abc]",
    ]) {
      const segments = splitCitations(text);
      expect(segments, text).toEqual([{ kind: "text", text }]);
    }
  });

  /**
   * A module-level global regex carries lastIndex between calls. If it were not
   * reset, the second answer on a page would silently lose its first citation.
   */
  it("does not leak regex state between calls", () => {
    const text = "One [[cite:chunk:a]] two [[cite:chunk:b]]";
    const first = splitCitations(text);
    const second = splitCitations(text);
    expect(second).toEqual(first);
    expect(CITATION_PATTERN.lastIndex).toBe(0);
  });
});
