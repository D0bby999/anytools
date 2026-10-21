/**
 * Every page's tab title is translated: appTitle() falls back to the English
 * word when a language has no entry, which left "Library", "Body" and
 * "Training plan" in Vietnamese tabs (design audit, 2026-10-21).
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routes = resolve(process.cwd(), "app/routes");
const keys = new Set<string>();
for (const file of readdirSync(routes)) {
  const source = readFileSync(resolve(routes, file), "utf8");
  for (const match of source.matchAll(/appTitle\(matches, "([^"]+)"/g)) keys.add(match[1]!);
}

describe("page titles", () => {
  it("finds the titles to check", () => {
    expect(keys.size).toBeGreaterThan(20);
  });

  it.each(["vi", "es", "pt"])("has every title in %s", (language) => {
    const { titles } = JSON.parse(readFileSync(resolve(process.cwd(), `public/locales/${language}/common.json`), "utf8"));
    expect([...keys].filter((key) => !titles[key])).toEqual([]);
  });
});
