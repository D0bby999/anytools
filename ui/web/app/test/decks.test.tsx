/**
 * decks.test.tsx
 * General decks on the page (the private design notes,
 * phase 5; ux/05-decks.md): a CrowdAnki deck is read from its deck.json,
 * sub-decks too, without its media; notes map to fronts and backs; the
 * bundled decks are whole and within the API's limits; the library says each
 * licence and adds only what may be shipped; a deck is deleted on a second
 * click.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import JSZip from "jszip";
import { initI18n } from "~/lib/i18n";
import { loadSqlJs, type SqlJsStatic } from "~/tools/sql-playground/logic";
import { readDeck, mapCards, guessCardMap, AnkiError, MAX_BACK, MAX_FRONT } from "~/lib/anki/read";
import { LIBRARY } from "~/lib/deck-library";
import { DeckLibrary, DeckList } from "~/components/vocab/decks";
import en from "~/data/decks/ultimate-geography-en.json";
import es from "~/data/decks/ultimate-geography-es.json";
import pt from "~/data/decks/ultimate-geography-pt.json";
import flagsEn from "~/data/decks/ultimate-geography-flags-en.json";
import flagsEs from "~/data/decks/ultimate-geography-flags-es.json";
import mapsPt from "~/data/decks/ultimate-geography-maps-pt.json";
import { existsSync } from "node:fs";
import { join } from "node:path";

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await loadSqlJs();
  await initI18n("en");
});

const model = { crowdanki_uuid: "m1", name: "Geo", flds: [{ name: "Capital", ord: 1 }, { name: "Country", ord: 0 }, { name: "Flag", ord: 2 }] };

async function crowdAnki(deck: unknown) {
  const zip = new JSZip();
  zip.file("Ultimate Geography [EN]/deck.json", JSON.stringify(deck));
  zip.file("Ultimate Geography [EN]/media/flag.svg", "<svg/>".repeat(1000));
  return new Blob([await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })]);
}

describe("reading a CrowdAnki deck", () => {
  it("reads its models and notes, sub-decks too, and counts the media it leaves", async () => {
    const deck = await readDeck(
      await crowdAnki({
        name: "Ultimate Geography",
        note_models: [model],
        notes: [{ note_model_uuid: "m1", fields: ["England", "London", '<img src="flag.svg" />'] }],
        children: [{ notes: [{ note_model_uuid: "m1", fields: ["Peru", "Lima", ""] }] }],
      }),
      SQL,
    );
    expect(deck.format).toBe("crowdanki");
    expect(deck.name).toBe("Ultimate Geography");
    expect(deck.types).toEqual([{ id: "m1", name: "Geo", fields: ["Country", "Capital", "Flag"] }]);
    expect(deck.notes.map((n) => n.fields[0])).toEqual(["England", "Peru"]);
    expect(deck.media).toBe(1);
    const { cards, skipped } = mapCards(deck, [guessCardMap(deck.types[0]!)]);
    expect(cards).toEqual([
      { front: "England", back: "London" },
      { front: "Peru", back: "Lima" },
    ]);
    expect(skipped).toBe(0);
  });

  it("refuses a zip that is neither", async () => {
    const zip = new JSZip();
    zip.file("notes.txt", "hello");
    await expect(readDeck(new Blob([await zip.generateAsync({ type: "arraybuffer" })]), SQL)).rejects.toMatchObject({ code: "not_a_deck" });
    await expect(readDeck(new Blob(["not a zip"]), SQL)).rejects.toBeInstanceOf(AnkiError);
  });
});

describe("mapping notes to cards", () => {
  const deck = {
    format: "crowdanki" as const,
    types: [{ id: "t", name: "Basic", fields: ["Front", "Back", "Note"] }],
    notes: [
      { typeId: "t", fields: ["<b>2 + 2</b>", "4", "even"] },
      { typeId: "t", fields: ["", "no front", ""] },
      { typeId: "t", fields: ["long", "x".repeat(MAX_BACK + 1), ""] },
      { typeId: "other", fields: ["unmapped", "type", ""] },
    ],
    media: 0,
  };
  it("joins the extra field to the back, strips markup, and skips empty or long faces", () => {
    const { cards, skipped } = mapCards(deck, [{ typeId: "t", front: 0, back: 1, extra: 2 }]);
    expect(cards).toEqual([{ front: "2 + 2", back: "4\neven" }]);
    expect(skipped).toBe(2);
  });
});

describe("the bundled decks", () => {
  it("are whole, in their language, and within the API's limits", () => {
    for (const d of [en, es, pt]) {
      expect(d.cards.length).toBe(LIBRARY.find((l) => l.slug === d.slug)?.cards);
      expect(d.licence).toMatch(/^Public domain/);
      for (const c of d.cards) {
        expect(c.front.length).toBeGreaterThan(0);
        expect(c.back.length).toBeGreaterThan(0);
        expect(c.front.length).toBeLessThanOrEqual(MAX_FRONT);
        expect(c.back.length).toBeLessThanOrEqual(MAX_BACK);
      }
      expect(new Set(d.cards.map((c) => c.front)).size).toBe(d.cards.length);
    }
    expect(es.cards[0]).toEqual({ front: "Inglaterra: ¿capital?", back: "Londres" });
    expect(LIBRARY.filter((d) => d.bundled).every((d) => ["public-domain", "cc-by", "free-pictures"].includes(d.licence))).toBe(true);
  });

  it("show a staged picture on each flag and map card, credited", () => {
    // The pictures are staged by `pnpm build` (scripts/stage-tool-runtime.mjs);
    // where they are, every card's file must be among them.
    const staged = existsSync(join(process.cwd(), "tool-runtime", "ultimate-geography-media@5.3"));
    for (const d of [flagsEn, flagsEs, mapsPt]) {
      expect(d.cards.length).toBe(LIBRARY.find((l) => l.slug === d.slug)?.cards);
      for (const c of d.cards) {
        expect(c.image.src).toMatch(/^ultimate-geography-media@5\.3\/ug-(flag|map)-[a-z0-9_-]+\.(svg|png)$/);
        if (staged) expect(existsSync(join(process.cwd(), "tool-runtime", c.image.src)), c.image.src).toBe(true);
        expect(c.image.source).toMatch(/^https:\/\//);
        expect(["PD", "CC0 1.0", "CC BY 3.0", "CC BY-SA 2.5", "CC BY-SA 3.0", "CC BY-SA 4.0"]).toContain(c.image.licence);
        expect(c.back.length).toBeLessThanOrEqual(MAX_BACK);
      }
      // One card per picture: they all ask the same question.
      expect(new Set(d.cards.map((c) => c.image.src)).size).toBe(d.cards.length);
    }
    expect(flagsEn.cards.find((c) => c.image.src.endsWith("ug-flag-france.svg"))?.back).toMatch(/^France/);
  });
});

function inRouter(element: React.ReactElement, posts: Record<string, string>[] = []) {
  const router = createMemoryRouter(
    [{ path: "/", element, action: async ({ request }) => (posts.push(Object.fromEntries(await request.formData()) as Record<string, string>), null) }],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("the library", () => {
  it("adds a free deck in one tap and links the others with their licence", async () => {
    const posts: Record<string, string>[] = [];
    inRouter(<DeckLibrary decks={[]} />, posts);
    const geo = screen.getByRole("heading", { name: /^Ultimate Geography \(/ }).closest("li")!;
    expect(within(geo).getByText(/436 cards · Public domain/)).toBeInTheDocument();
    await userEvent.click(within(geo).getByRole("button", { name: "Add Ultimate Geography (English)" }));
    expect(posts[0]).toEqual({ intent: "library", slug: "ultimate-geography-en" });
    const jlpt = screen.getByRole("heading", { name: /JLPT/ }).closest("li")!;
    expect(within(jlpt).getByText(/Non-commercial use only/)).toBeInTheDocument();
    expect(within(jlpt).getByRole("link", { name: "Get the deck JLPT N5–N1 from its page" })).toHaveAttribute("href", "https://github.com/5mdld/anki-jlpt-decks");
    expect(within(jlpt).queryByRole("button", { name: /^Add/ })).toBeNull();
  });

  it("says how many cards were left out when the decks are full", async () => {
    const router = createMemoryRouter(
      [{ path: "/", element: <DeckLibrary decks={[]} />, action: () => ({ added: { name: "Ultimate Geography", created: 30, over_limit: 406 } }) }],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Ultimate Geography (English)" }));
    expect(await screen.findByText(/406 cards were not added: your decks hold at most 50,000 cards in all/)).toBeInTheDocument();
  });

  it("says a deck already added, and offers Ultimate Geography in another language", async () => {
    inRouter(<DeckLibrary decks={[{ id: "d", name: "UG", source: "library:ultimate-geography-en", licence: "", source_url: "", cards: 438, due: 0, new: 438 }]} />);
    const geo = screen.getByRole("heading", { name: /^Ultimate Geography \(/ }).closest("li")!;
    expect(within(geo).getByText("Added")).toBeInTheDocument();
    await userEvent.selectOptions(within(geo).getByLabelText("Language"), "es");
    expect(screen.getByRole("button", { name: "Add Ultimate Geography (Spanish)" })).toBeInTheDocument();
  });
});

describe("the learner's decks", () => {
  it("shows the counts and deletes on a second click", async () => {
    const posts: Record<string, string>[] = [];
    inRouter(
      <DeckList decks={[{ id: "d1", name: "Geography", source: "", licence: "Public domain", source_url: "https://github.com/anki-geo/ultimate-geography", cards: 438, due: 12, new: 400, last_new: "2026-11-11" }]} />,
      posts,
    );
    expect(screen.getByText(/438 cards · 12 due today · 400 new to come, the last on 2026-11-11/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Public domain" })).toHaveAttribute("href", "https://github.com/anki-geo/ultimate-geography");
    await userEvent.click(screen.getByRole("button", { name: "Delete the deck Geography" }));
    expect(posts).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(posts[0]).toEqual({ intent: "delete", id: "d1" });
  });
});

describe("a field's text", () => {
  it("leaves an entity outside Unicode as written instead of failing the deck", async () => {
    const { fieldText } = await import("~/lib/anki/read");
    expect(fieldText("a &#99999999; b &#x41;")).toBe("a &#99999999; b A");
  });
});

describe("a card with a picture", () => {
  it("shows the picture without naming it, then the answer with the picture's credit", async () => {
    const { ReviewSession } = await import("~/components/vocab/review-session");
    const card = {
      id: "c1", kind: "card" as const, due_at: "2026-10-21T00:00:00Z", reps: 0, term: "", lang: "", reading: "", pos: "", meaning: "", context: "",
      front: "Whose flag is this?", back: "France", deck: { id: "d", name: "Ultimate Geography: flags" },
      image: { src: "ultimate-geography-media@5.3/ug-flag-france.svg", source: "https://commons.wikimedia.org/wiki/File:Flag_of_France.svg", licence: "PD" },
    };
    inRouter(<ReviewSession cards={[card]} total={1} />);
    const img = screen.getByRole("img", { name: /The picture to name/ });
    expect(img).toHaveAttribute("src", "/tool-runtime/ultimate-geography-media@5.3/ug-flag-france.svg");
    expect(screen.queryByText("France")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    expect(screen.getByText("France")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "commons.wikimedia.org" })).toHaveAttribute("href", card.image.source);
    expect(screen.getByText(/public domain/)).toBeInTheDocument();
  });
});
