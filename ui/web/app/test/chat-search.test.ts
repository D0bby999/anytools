import { describe, expect, it } from "vitest";
import { findHits, fold, foldWithMap, step } from "~/lib/chat-search";

describe("chat search", () => {
  it("folds case and Vietnamese diacritics, đ included", () => {
    expect(fold("NGHIÊNG Đường")).toBe("nghieng duong");
    const { map } = foldWithMap("ả");
    expect(map).toEqual([0, 1]);
  });

  it("reports ranges in the original text", () => {
    const text = "Định luật Ôm: điện trở";
    const [hit] = findHits([text], "dien tro");
    expect(text.slice(hit!.start, hit!.end)).toBe("điện trở");
  });

  it("finds every occurrence across segments, in order, without overlaps", () => {
    expect(findHits(["aaa", "", "b a"], "aa")).toEqual([{ segment: 0, start: 0, end: 2 }]);
    expect(findHits(["cell", "a Cell and a cell"], "cell").map((h) => [h.segment, h.start])).toEqual([
      [0, 0],
      [1, 2],
      [1, 13],
    ]);
  });

  it("finds nothing for an empty query", () => {
    expect(findHits(["anything"], "   ")).toEqual([]);
  });

  it("steps through matches and wraps", () => {
    expect(step(-1, 3, 1)).toBe(0);
    expect(step(-1, 3, -1)).toBe(2);
    expect(step(2, 3, 1)).toBe(0);
    expect(step(0, 3, -1)).toBe(2);
    expect(step(0, 0, 1)).toBe(-1);
  });
});
