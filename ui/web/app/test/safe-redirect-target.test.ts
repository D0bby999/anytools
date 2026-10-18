import { describe, expect, it } from "vitest";
import { sanitizeNextPath } from "~/lib/safe-redirect-target";

describe("sanitizeNextPath", () => {
  it("accepts same-origin relative paths", () => {
    for (const path of ["/", "/knowledge", "/chat?id=1", "/a/b/c#frag"]) {
      expect(sanitizeNextPath(path)).toBe(path);
    }
  });

  // Each of these lands the user off-domain immediately after a successful
  // sign-in, when they are most primed to trust the page they are looking at.
  it("rejects every off-origin shape", () => {
    const hostile = [
      "//evil.test",
      "///evil.test",
      "/\\evil.test",
      "https://evil.test",
      "http://evil.test",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "evil.test",
      "../admin",
    ];
    for (const path of hostile) {
      expect(sanitizeNextPath(path), path).toBeNull();
    }
  });

  it("rejects control characters that could split a header", () => {
    expect(sanitizeNextPath("/ok\r\nSet-Cookie: a=b")).toBeNull();
    expect(sanitizeNextPath("/ok\u0000")).toBeNull();
    expect(sanitizeNextPath("/ok\u007f")).toBeNull();
  });

  it("rejects absurdly long values and empty input", () => {
    expect(sanitizeNextPath("/" + "a".repeat(4000))).toBeNull();
    expect(sanitizeNextPath("")).toBeNull();
    expect(sanitizeNextPath(null)).toBeNull();
    expect(sanitizeNextPath(undefined)).toBeNull();
  });
});
