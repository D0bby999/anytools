/**
 * no-raw-colour.test.ts
 *
 * Phase 3 success criterion: "a new screen built by a cook agent in phase 5
 * uses only tokens from tokens.css (lint: no raw hex in app/**\/*.tsx)".
 *
 * This is that lint. It exists because the drift it catches is invisible in
 * review: `text-[#176f5b]` renders identically to `text-primary` in light mode
 * and then stays dark green in dark mode, on one screen, for months. The same
 * goes for a Tailwind palette entry like `bg-emerald-500`, which is a colour
 * this world never chose.
 *
 * tokens.css is the only file allowed to contain a colour literal, and the
 * theme-contrast guard is what keeps the values in it honest.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const APP_DIR = join(resolve(process.cwd()), "app");

function walk(dir: string, filter: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "build" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

const componentFiles = walk(APP_DIR, (p) => p.endsWith(".tsx"));

/** Strips comments so prose about a colour is not mistaken for a colour. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** `#rgb`, `#rrggbb`, `rgb()/rgba()`, `hsl()/hsla()`, `oklch()`. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color-mix)\s*\(/;

/**
 * Tailwind's own palette. Every one of these is a colour the world did not
 * choose, which is exactly why they are easy to reach for.
 */
const TAILWIND_PALETTE =
  /\b(?:bg|text|border|ring|outline|from|via|to|fill|stroke|divide|shadow|accent|caret|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

describe("no component carries a colour of its own", () => {
  it("finds components to check", () => {
    expect(componentFiles.length).toBeGreaterThan(0);
  });

  it.each(componentFiles.map((p) => [relative(APP_DIR, p), p] as const))(
    "%s has no colour literal",
    (name, path) => {
      const offenders = code(readFileSync(path, "utf8"))
        .split("\n")
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => COLOUR_LITERAL.test(line))
        .map(([n, line]) => `${name}:${n}  ${line.trim()}`);

      expect(
        offenders,
        "colours live in app/tokens.css and reach components through app.css",
      ).toEqual([]);
    },
  );

  it.each(componentFiles.map((p) => [relative(APP_DIR, p), p] as const))(
    "%s uses no Tailwind palette colour",
    (name, path) => {
      const offenders = code(readFileSync(path, "utf8"))
        .split("\n")
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => TAILWIND_PALETTE.test(line))
        .map(([n, line]) => `${name}:${n}  ${line.trim()}`);

      expect(
        offenders,
        "use a semantic name (bg-card, text-muted-foreground, bg-selected, ...)",
      ).toEqual([]);
    },
  );
});

describe("the token layer stays the only source of colour", () => {
  it("tokens.css is where the literals are", () => {
    const tokens = readFileSync(join(APP_DIR, "tokens.css"), "utf8");
    expect(tokens).toMatch(COLOUR_LITERAL);
  });

  it("app.css maps semantic names onto --lp-* and defines no colour of its own", () => {
    const app = readFileSync(join(APP_DIR, "app.css"), "utf8");
    const body = app.replace(/\/\*[\s\S]*?\*\//g, "");

    expect(body, "app.css must import the world").toContain('@import "./tokens.css"');

    const literals = body
      .split("\n")
      .filter((line) => /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\s*\(/.test(line))
      .map((line) => line.trim());

    expect(literals, "a colour in app.css is a colour outside the world").toEqual([]);
  });
});
