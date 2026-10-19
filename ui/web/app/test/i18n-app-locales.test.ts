// @vitest-environment node
/**
 * i18n-app-locales.test.ts
 * AnyLearn in four languages (plan 261019-1317, phase 2): every English string
 * of every app namespace has a translation in vi, es and pt, with the same
 * {{variables}} and the same <0>/<strong> tags, no empty string, and lists of
 * the same length. A string added in English and not translated fails here,
 * instead of reaching a Vietnamese learner in English.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appNs } from "~/lib/i18n";

const LOCALES = join(__dirname, "../../public/locales");
const read = (lang: string, ns: string) => JSON.parse(readFileSync(join(LOCALES, lang, `${ns}.json`), "utf8")) as unknown;

type Leaf = { path: string; value: unknown };

function leaves(x: unknown, path = ""): Leaf[] {
  if (Array.isArray(x)) return x.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (x && typeof x === "object") return Object.entries(x).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [{ path, value: x }];
}

const vars = (s: string) => [...s.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).sort();
const tags = (s: string) => [...s.matchAll(/<\/?\d+>|<[a-z]+\/?>|<\/[a-z]+>/g)].map((m) => m[0]).sort();

describe.each(["vi", "es", "pt"])("AnyLearn in %s", (lang) => {
  it.each([...appNs])("%s has every English string, with its variables and tags", (ns) => {
    const en = new Map(leaves(read("en", ns)).map((l) => [l.path, l.value]));
    const other = new Map(leaves(read(lang, ns)).map((l) => [l.path, l.value]));
    const missing = [...en.keys()].filter((k) => !other.has(k));
    const extra = [...other.keys()].filter((k) => !en.has(k));
    expect(missing, `${lang}/${ns}: missing`).toEqual([]);
    expect(extra, `${lang}/${ns}: not in English`).toEqual([]);
    for (const [path, value] of en) {
      const t = other.get(path);
      if (typeof value !== "string") {
        expect(typeof t, `${lang}/${ns}: ${path}`).toBe(typeof value);
        continue;
      }
      expect(typeof t === "string" && t.trim() !== "", `${lang}/${ns}: ${path} is empty`).toBe(true);
      expect(vars(t as string), `${lang}/${ns}: ${path} variables`).toEqual(vars(value));
      expect(tags(t as string), `${lang}/${ns}: ${path} tags`).toEqual(tags(value));
    }
  });
});
