import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { groupSteps, isGroupOpen, isTurnOpen, liveDetail, turnCategories } from "~/lib/chat-process-groups";
import { rankCategories, TOOL_CATEGORIES, toolCategory } from "~/lib/chat-tool-categories";
import type { WorkStep } from "~/lib/chat-work";

const step = (tool: string, extra: Partial<WorkStep> = {}): WorkStep => ({ tool, ...extra });

describe("tool categories", () => {
  // postclaw's coverage rule: a Go tool with no category would read as
  // "Worked", so a new one has to be placed here.
  it("names every tool in internal/tools", () => {
    const dir = resolve(process.cwd(), "../../internal/tools");
    const names = readdirSync(dir)
      .filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"))
      .flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/Name\(\) string \{ return "([a-z_]+)" \}/g)].map((m) => m[1]!));
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((n) => !(n in TOOL_CATEGORIES))).toEqual([]);
  });

  it("ranks by frequency and keeps first-seen order on a tie", () => {
    expect(
      rankCategories([
        { kind: "tool", name: "read_source" },
        { kind: "tool", name: "rag_search" },
        { kind: "tool", name: "web_search" },
        { kind: "thinking" },
      ]),
    ).toEqual(["search", "read", "thinking"]);
    expect(toolCategory("something_new")).toBe("other");
  });
});

describe("process groups", () => {
  it("groups consecutive steps of one category", () => {
    const groups = groupSteps([step("rag_search"), step("web_search"), step("read_source"), step("rag_search")]);
    expect(groups.map((g) => [g.key, g.category, g.steps.length])).toEqual([
      ["step-0", "search", 2],
      ["step-2", "read", 1],
      ["step-3", "search", 1],
    ]);
  });

  it("puts live thinking first and marks the running step", () => {
    const groups = groupSteps([step("rag_search"), step("read_source", { running: true, detail: "p. 4" })], {
      thinking: "Let me look.",
      running: true,
    });
    expect(groups[0]!).toMatchObject({ key: "thinking", category: "thinking", liveThinking: false });
    expect(groups[2]!.live?.detail).toBe("p. 4");
    expect(groupSteps([], { thinking: "Hmm", running: true })[0]!.liveThinking).toBe(true);
  });

  it("keeps a group's key while later steps arrive", () => {
    const first = groupSteps([step("rag_search", { running: true })], { running: true });
    const later = groupSteps([step("rag_search"), step("rag_search", { running: true })], { running: true });
    expect(later[0]!.key).toBe(first[0]!.key);
  });

  it("marks a group with a failed step, and no live step once finished", () => {
    const [g] = groupSteps([step("web_search", { error: true, running: true })]);
    expect(g!.hasError).toBe(true);
    expect(g!.live).toBeNull();
  });

  it("names the answer's categories without counting repeats", () => {
    expect(turnCategories([step("read_source"), step("rag_search", { repeated: true }), step("read_source")], true)).toEqual([
      "read",
      "thinking",
    ]);
  });
});

describe("fold rules", () => {
  it("folds only a completed turn, and the reader's choice wins there", () => {
    expect(isTurnOpen("running", false)).toBe(true);
    expect(isTurnOpen("interrupted", false)).toBe(true);
    expect(isTurnOpen("done", undefined)).toBe(false);
    expect(isTurnOpen("done", true)).toBe(true);
    expect(isGroupOpen(undefined)).toBe(false);
    expect(isGroupOpen(true)).toBe(true);
  });

  it("shortens a long live detail", () => {
    expect(liveDetail(step("rag_search", { detail: `  ${"x".repeat(80)} ` }))).toHaveLength(58);
    expect(liveDetail(null)).toBe("");
  });
});
