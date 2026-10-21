/**
 * nav-tree.test.ts
 * The one table of contents (lib/nav-tree.ts): every entry is a route, none
 * twice, the reading order is the plan's, and a detail page finds its entry.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flatEntries, flatPages, NAV_TREE, pagerOf, sectionOf, TOP_NAV } from "~/lib/nav-tree";
import en from "../../public/locales/en/common.json";
import vi from "../../public/locales/vi/common.json";
import es from "../../public/locales/es/common.json";
import pt from "../../public/locales/pt/common.json";

const routes = readFileSync("app/routes.ts", "utf8");

describe("NAV_TREE", () => {
  it("names only registered routes", () => {
    for (const { page } of flatEntries()) {
      const path = page.to.split("?")[0]!.replace(/^\/settings\//, "").replace(/^\//, "");
      expect(routes, page.to).toContain(`"${path}"`);
    }
  });

  it("holds no page twice", () => {
    const tos = flatEntries().map((e) => e.page.to);
    expect(new Set(tos).size).toBe(tos.length);
  });

  it("reads in the plan's order", () => {
    expect(NAV_TREE.map((g) => g.id)).toEqual(["start", "read", "ask", "practise", "reflect", "mine", "settings", "appendix"]);
    expect(flatPages().map((p) => p.to)).toEqual([
      "/home",
      "/knowledge", "/notebooks", "/library",
      "/chat", "/solve", "/research",
      "/quiz", "/quiz/bank", "/quiz/practice", "/quiz/exams",
      "/mastery", "/mastery/review", "/mastery/vocabulary", "/mastery/book-cards", "/mastery/decks",
      "/languages",
      "/body", "/body/plan", "/body/progress", "/body/coach", "/body/library",
      "/loop", "/toolkit",
      "/files", "/upload", "/links", "/storage",
      "/settings", "/settings/providers", "/settings/routes", "/settings/search", "/settings/account", "/settings/profile", "/settings/reminders",
    ]);
    expect(TOP_NAV.map((p) => p.to)).toEqual(["/home", "/knowledge", "/chat", "/loop"]);
  });

  it("folds Settings, the appendix and the three practise sections by default", () => {
    expect(NAV_TREE.find((g) => g.id === "settings")?.collapsed).toBe(true);
    expect(NAV_TREE.find((g) => g.id === "appendix")?.collapsed).toBe(true);
    const practise = NAV_TREE.find((g) => g.id === "practise")!;
    expect(practise.items.filter((p) => p.collapsed).map((p) => p.to)).toEqual(["/quiz", "/mastery", "/body"]);
  });

  it.each([
    ["/home", "/home", "start"],
    ["/quiz/bank", "/quiz/bank", "practise"],
    ["/quiz/exams/ex-1", "/quiz/exams", "practise"],
    ["/quiz", "/quiz", "practise"],
    ["/documents/abc", "/knowledge", "read"],
    ["/books/b1/chapters/c2", "/knowledge", "read"],
    ["/chat/s-9", "/chat", "ask"],
    ["/mastery/path-1/session", "/mastery", "practise"],
    ["/settings/account", "/settings/account", "settings"],
    ["/toolkit/new", "/toolkit", "reflect"],
    ["/english", "/languages", "practise"],
    ["/loop/state/x", "/loop", "reflect"],
  ])("files %s under %s", (path, to, group) => {
    const found = sectionOf(path);
    expect(found?.page.to).toBe(to);
    expect(found?.group.id).toBe(group);
  });

  it("leaves a page outside the tree unfiled", () => {
    expect(sectionOf("/more")).toBeNull();
  });

  it("pages through the tree, and not from a detail page", () => {
    const bank = pagerOf("/quiz/bank");
    expect(bank?.prev?.to).toBe("/quiz");
    expect(bank?.next?.to).toBe("/quiz/practice");
    expect(pagerOf("/home")?.prev).toBeUndefined();
    expect(pagerOf("/chat/s-1")).toBeNull();
  });

  it("has every label in all four languages", () => {
    const get = (o: unknown, k: string) => k.split(".").reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], o);
    const keys = [...NAV_TREE.map((g) => g.labelKey), ...flatEntries().map((e) => e.page.labelKey), ...TOP_NAV.map((p) => p.labelKey)];
    for (const bundle of [en, vi, es, pt]) {
      for (const k of keys) expect(typeof get(bundle, k), k).toBe("string");
    }
  });
});
