/**
 * loop-cannot-prove.test.ts
 *
 * Phase 10's lint: every metric the learning loop shows is paired with a
 * "cannot prove" note. Enforced structurally, because the failure is quiet —
 * a new score rendered with a bare <span> looks fine and silently drops the
 * one habit this layer exists to teach.
 *
 *  1. Only metric.tsx may style a number as a measured value (`tabular-nums`).
 *     Anything else that wants to show one has to go through <Metric>.
 *  2. Every <Metric> passes `cannotProve`, and never an empty literal.
 *  3. A loop file that formats scores (scoreText) also renders a <Metric>.
 *  4. No gamification in the loop's copy (DESIGN.md: no streaks, confetti, XP).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const APP_DIR = join(resolve(process.cwd()), "app");
const WEB_DIR = resolve(process.cwd());

const componentDir = join(APP_DIR, "components/loop");
const loopFiles = [
  ...readdirSync(componentDir).map((f) => join(componentDir, f)),
  ...readdirSync(join(APP_DIR, "routes"))
    .filter((f) => f.startsWith("loop."))
    .map((f) => join(APP_DIR, "routes", f)),
].filter((p) => p.endsWith(".tsx"));

const read = (p: string) => readFileSync(p, "utf8");
const short = (p: string) => p.slice(APP_DIR.length + 1);

describe("every loop metric says what it cannot prove", () => {
  it("finds the loop UI", () => {
    expect(loopFiles.length).toBeGreaterThanOrEqual(10);
    expect(loopFiles.some((p) => p.endsWith("metric.tsx"))).toBe(true);
  });

  it.each(loopFiles.map((p) => [short(p), p] as const))("%s shows numbers only through <Metric>", (_n, path) => {
    if (path.endsWith("components/loop/metric.tsx")) return;
    expect(read(path), "style measured values with <Metric>, which carries the note").not.toMatch(/tabular-nums/);
  });

  it.each(loopFiles.map((p) => [short(p), p] as const))("%s passes a note to every <Metric>", (_n, path) => {
    for (const m of read(path).matchAll(/<Metric\b([\s\S]*?)\/>/g)) {
      const props = m[1] ?? "";
      expect(props, `<Metric> without cannotProve in ${short(path)}`).toMatch(/\bcannotProve=/);
      expect(props, `<Metric> with an empty note in ${short(path)}`).not.toMatch(/cannotProve=(""|\{""\}|\{''\})/);
    }
  });

  it.each(loopFiles.map((p) => [short(p), p] as const))("%s pairs formatted scores with a <Metric>", (_n, path) => {
    const src = read(path);
    if (/\bscoreText\(|\.map\(scoreText\)/.test(src)) {
      expect(src, `${short(path)} formats scores but renders no <Metric>`).toMatch(/<Metric\b/);
    }
  });

  it("Metric requires the note in its type", () => {
    const src = read(join(componentDir, "metric.tsx"));
    expect(src).toMatch(/cannotProve: string;/);
    expect(src).not.toMatch(/cannotProve\?:/);
  });
});

describe("the loop's copy has no gamification", () => {
  it("loop.json never mentions streaks, confetti, XP, badges or levelling up", () => {
    const copy = read(join(WEB_DIR, "public/locales/en/loop.json")).toLowerCase();
    for (const word of ["streak", "confetti", " xp", "badge", "level up", "levelled", "leaderboard"]) {
      expect(copy, `loop.json mentions "${word}"`).not.toContain(word);
    }
  });
});
