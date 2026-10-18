/**
 * card-kinds-single-source.test.ts
 *
 * Phase 8's structural guard: the skill card kinds — their names, summaries,
 * setup fields and prompts — are defined ONCE, in Go
 * (internal/learning/loop/cards.go), and served by GET /v1/learning/card-kinds.
 * A second copy in the web app would drift the first time a prompt is
 * reworded, and the page would ask one thing while the API meant another.
 *
 * So: no sentence of the Go table may appear in the web app's source or its
 * locale files, no kind identifier is hard-coded, and every route that renders
 * a card list or the new-card form loads the kinds from the API.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const WEB_DIR = resolve(process.cwd());
const APP_DIR = join(WEB_DIR, "app");
const GO_TABLE = resolve(WEB_DIR, "../../internal/learning/loop/cards.go");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "test" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const sources = walk(APP_DIR);
const locales = walk(join(WEB_DIR, "public/locales")).concat(
  readdirSync(join(WEB_DIR, "public/locales/en")).map((f) => join(WEB_DIR, "public/locales/en", f)),
);

// Every sentence in the Go table: the quoted strings of 20+ characters in the
// Label/Hint/Name/Summary fields and the prompt lists.
function goSentences(): string[] {
  const src = readFileSync(GO_TABLE, "utf8");
  const start = src.indexOf("var (\n\tsetupSituation");
  const end = src.indexOf("// CardKinds returns every kind");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const table = src.slice(start, end);
  return [...table.matchAll(/"((?:[^"\\]|\\.){20,})"/g)].map((m) => (m[1] ?? "").replace(/\\"/g, '"'));
}

describe("skill card kinds have one source", () => {
  const sentences = goSentences();

  it("finds the Go table and its prompts", () => {
    expect(sentences.length).toBeGreaterThan(30);
    expect(sources.length).toBeGreaterThan(50);
  });

  it("no sentence of the kinds table is copied into the web app or its locales", () => {
    const files = [...sources, ...locales.filter((p) => p.endsWith(".json"))];
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const s of sentences) if (text.includes(s)) hits.push(`${f.slice(WEB_DIR.length + 1)}: ${s}`);
    }
    expect(hits).toEqual([]);
  });

  it("no kind identifier is hard-coded in the app", () => {
    const hits = sources.filter((f) => /["'`]field_note["'`]/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("every route that renders cards or the new-card form loads the served kinds", () => {
    const routes = readdirSync(join(APP_DIR, "routes")).map((f) => join(APP_DIR, "routes", f));
    const rendering = routes.filter((f) => /<(CardList|CardNewForm|RetestsDueList)\b/.test(readFileSync(f, "utf8")));
    expect(rendering.length).toBeGreaterThanOrEqual(2);
    for (const f of rendering) expect(readFileSync(f, "utf8"), f).toMatch(/listCardKinds\(/);
  });
});
