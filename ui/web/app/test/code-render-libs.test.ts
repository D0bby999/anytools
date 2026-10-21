/**
 * The parsers and highlighter behind code, diff and terminal blocks
 * (postclaw parity, phase 3). They return data, never markup.
 */
import { describe, expect, it } from "vitest";
import { grammarFor, highlightLines, MAX_HIGHLIGHT_CHARS } from "~/lib/highlight";
import { hasAnsi, parseAnsi, stripAnsi } from "~/lib/ansi";
import { MAX_DIFF_ROWS, parseDiff } from "~/lib/diff-lines";

const ESC = "\u001b";

describe("highlight", () => {
  it("knows a learner's languages by their usual fence names", () => {
    expect(grammarFor("py")).toBe("python");
    expect(grammarFor("C++")).toBe("cpp");
    expect(grammarFor("bash")).toBe("shellscript");
    expect(grammarFor("java")).toBe("java");
  });

  it("misses a model-written name that is an inherited property", () => {
    expect(grammarFor("constructor")).toBeUndefined();
    expect(grammarFor("__proto__")).toBeUndefined();
    expect(grammarFor("brainfuck")).toBeUndefined();
  });

  it("colours tokens with the world's code inks, line by line", async () => {
    const lines = await highlightLines('def add(a, b):\n    return a + 1  # sum\nprint("hi")', "python");
    expect(lines).toHaveLength(3);
    const all = lines!.flat();
    expect(all.find((s) => s.text === "def")?.color).toBe("var(--lp-code-token-keyword)");
    expect(all.find((s) => s.text.includes("hi"))?.color).toMatch(/^var\(--lp-code-token-string(-expression)?\)$/);
    expect(all.find((s) => s.text.includes("# sum"))?.color).toBe("var(--lp-code-token-comment)");
    // Nothing is lost: the runs put back together are the code.
    expect(lines!.map((l) => l.map((s) => s.text).join("")).join("\n")).toBe(
      'def add(a, b):\n    return a + 1  # sum\nprint("hi")',
    );
  });

  it("leaves an unknown language and an over-long block plain", async () => {
    expect(await highlightLines("x", "nope")).toBeUndefined();
    expect(await highlightLines("x".repeat(MAX_HIGHLIGHT_CHARS + 1), "python")).toBeUndefined();
  });
});

describe("ansi", () => {
  it("maps the basic colours onto theme inks and resets", () => {
    const [line] = parseAnsi(`${ESC}[31merror${ESC}[0m: ${ESC}[1;32mok${ESC}[m done`);
    expect(line).toEqual([
      { text: "error", style: { color: "var(--lp-code-ansi-red)" } },
      { text: ": " },
      { text: "ok", style: { bold: true, color: "var(--lp-code-ansi-green)" } },
      { text: " done" },
    ]);
  });

  it("drops 256-colour, true-colour and background codes without reading their numbers as codes", () => {
    const [line] = parseAnsi(`${ESC}[38;5;31mA${ESC}[48;2;1;2;3mB${ESC}[0m`);
    expect(line).toEqual([{ text: "A" }, { text: "B" }]);
  });

  it("keeps lines, shows a redrawn line's last frame, and removes other escapes", () => {
    const lines = parseAnsi(`one\n10%\r55%\r100%\n${ESC}]0;title${ESC}\\${ESC}[2Kthree`);
    expect(lines.map((l) => l.map((s) => s.text).join(""))).toEqual(["one", "100%", "three"]);
  });

  it("copies as plain text, and says when there is colour to read", () => {
    expect(stripAnsi(`${ESC}[33mwarn${ESC}[0m\nx`)).toBe("warn\nx");
    expect(hasAnsi(`${ESC}[33m`)).toBe(true);
    expect(hasAnsi("plain")).toBe(false);
  });
});

describe("diff", () => {
  it("classes a bare hunk by each line's first character", () => {
    const diff = parseDiff("@@ -1,2 +1,2 @@\n def f():\n-    return 1\n+    return 2");
    expect(diff.rows.map((r) => r.kind)).toEqual(["hunk", "context", "remove", "add"]);
    expect(diff.rows[2]).toEqual({ kind: "remove", sign: "-", text: "    return 1" });
    expect([diff.added, diff.removed, diff.clipped]).toEqual([1, 1, false]);
  });

  it("reads file headers as headers, not as a removed and an added line", () => {
    const diff = parseDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b");
    expect(diff.rows.slice(0, 3).map((r) => r.kind)).toEqual(["meta", "meta", "meta"]);
    expect([diff.added, diff.removed]).toEqual([1, 1]);
  });

  it("draws at most MAX_DIFF_ROWS rows but counts the whole diff", () => {
    const diff = parseDiff(Array.from({ length: MAX_DIFF_ROWS + 10 }, () => "+x").join("\n"));
    expect(diff.rows).toHaveLength(MAX_DIFF_ROWS);
    expect(diff.added).toBe(MAX_DIFF_ROWS + 10);
    expect(diff.clipped).toBe(true);
  });
});
