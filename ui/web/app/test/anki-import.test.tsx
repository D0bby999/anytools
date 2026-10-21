/**
 * anki-import.test.tsx
 * Mastery → Vocabulary → Anki decks (the private design notes,
 * phase 3): a deck is read in the browser, each note type's fields are
 * mapped, the first words are shown, and the words go to the server in
 * batches; the outcome says how many were imported, over which days, and how
 * many were already there.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "~/lib/i18n";
import { AnkiImport } from "~/components/vocab/anki-decks";

// The page loads sql.js's wasm from the staged tool runtime; here, from node_modules.
vi.mock("~/tools/sql-playground/logic", async (orig) => {
  const real = await orig<typeof import("~/tools/sql-playground/logic")>();
  return { ...real, loadSqlJs: () => real.loadSqlJs() };
});

beforeAll(() => {
  initI18n("en");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("importing an Anki deck", () => {
  it("maps the fields, shows the first words and imports them in batches", async () => {
    const posts: { lang: string; notes: { term: string; meaning: string; sentence: string }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        posts.push(JSON.parse(String(init.body)));
        return Response.json({ created: 1, duplicates: 1, invalid: 0, first_day: "2026-10-21", last_day: "2026-10-21" });
      }),
    );
    render(<AnkiImport langs={["vi"]} />);
    const file = new File([readFileSync(join(__dirname, "fixtures", "anki21b-synthetic.apkg"))], "deck.apkg");
    await userEvent.upload(screen.getByLabelText("Choose an Anki deck"), file);

    expect(await screen.findByText(/4 notes in this deck\. 2 images or sounds will be left out\./)).toBeInTheDocument();
    const vocabType = screen.getByRole("group", { name: /Vocab \(front\/back\/example\)/ });
    expect(within(vocabType).getByLabelText("Word")).toHaveDisplayValue("Word");
    expect(within(vocabType).getByLabelText("Meaning")).toHaveDisplayValue("Definition");
    expect(within(vocabType).getByLabelText("Example sentence")).toHaveDisplayValue("Example");
    expect(screen.getByLabelText("The words' language")).toHaveDisplayValue("en");

    // The cloze note type maps Text to the word by default; leave it out.
    const cloze = screen.getByRole("group", { name: /Cloze/ });
    await userEvent.click(within(cloze).getByLabelText("Import this note type"));
    expect(screen.getByRole("cell", { name: "ubiquitous" })).toBeInTheDocument();
    expect(screen.getByText(/2 words to import\. 1 note has no word or no meaning/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Import 2 words" }));
    expect(await screen.findByText("1 word imported.")).toBeInTheDocument();
    expect(screen.getByText("They come up for review on 2026-10-21.")).toBeInTheDocument();
    expect(screen.getByText("1 was already in your vocabulary and was left as it is.")).toBeInTheDocument();
    expect(posts).toEqual([
      {
        lang: "en",
        notes: [
          { term: "ubiquitous", meaning: "present everywhere", sentence: "Phones are ubiquitous now." },
          { term: "ephemeral", meaning: "lasting a very short time fleeting", sentence: "Fame is ephemeral." },
        ],
      },
    ]);
  });

  it("says when a file is not a deck", async () => {
    render(<AnkiImport langs={[]} />);
    await userEvent.upload(screen.getByLabelText("Choose an Anki deck"), new File(["hello"], "notes.apkg"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This file is not an Anki deck (.apkg).");
  });
});
