/**
 * plates.test.ts
 * Every plate the app can ask for is on disk at both widths, with the prompt
 * that made it beside it (DESIGN.md rule 16), so a new name never ships as a
 * broken image.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLATES } from "~/components/ui/plate";

const DIR = join(resolve(process.cwd()), "public/plates");

describe("plates", () => {
  it.each(PLATES)("%s has its 1200 and 600 WebP and its prompt", (name) => {
    expect(existsSync(join(DIR, `${name}.webp`))).toBe(true);
    expect(existsSync(join(DIR, `${name}-sm.webp`))).toBe(true);
    const sidecar = JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf-8")) as { prompt?: string };
    expect(sidecar.prompt).toMatch(/no text/i);
  });
});
