/**
 * library-export.test.ts
 * The API loads the Library from internal/library/catalogue.json.gz
 * (the private design notes). It must be the catalogue the
 * data files build today: run `node scripts/library/export.mjs` after
 * changing one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { catalogueExport } from "~/lib/library/export.server";
import { fold } from "~/lib/vocab-types";

describe("the Library's export", () => {
  it("is the catalogue the data files build, with folded search text", () => {
    const embedded = JSON.parse(gunzipSync(readFileSync(join(process.cwd(), "../../internal/library/catalogue.json.gz"))).toString()) as ReturnType<typeof catalogueExport>;
    const built = catalogueExport();
    expect(embedded.version, "run `node scripts/library/export.mjs`").toBe(built.version);
    const thpt = built.items.find((i) => i.id === "thpt-papers")!;
    expect(thpt.search).toBe(fold(thpt.search));
    expect(thpt.search).toContain("de thi tot nghiep");
    expect(built.items.every((i, n) => i.position === n)).toBe(true);
    expect(built.sources.find((s) => s.name === "rossant/awesome-math")).toMatchObject({ pin: expect.stringMatching(/^[0-9a-f]{40}$/), licence: "CC0-1.0 (the list)" });
  });
});
