/**
 * og-image-vietnamese.test.ts
 *
 * A tool's share card must draw Vietnamese. On 2026-10-19 anytools.world
 * served cards with holes where Đ and ị belong: the latin, latin-ext and
 * Vietnamese font subsets were registered under one name and satori used the
 * latin file alone. A title made only of those letters must therefore paint
 * something, which a card with the letters missing does not.
 */
import { describe, expect, it } from "vitest";
import { renderToolCard } from "~/lib/tools/og-image.server";

describe("the tool share card", () => {
  it("draws Vietnamese letters rather than gaps", async () => {
    const blank = await renderToolCard({ title: " ", description: " ", cluster: " " });
    const vietnamese = await renderToolCard({ title: "Đị ểề ữợ", description: "Đặt ở đây", cluster: "Định" });
    // A blank card and a card of missing glyphs compress to the same bytes;
    // painted letters add tens of kilobytes of edges.
    expect(vietnamese.length - blank.length).toBeGreaterThan(5000);
  }, 60_000);
});
