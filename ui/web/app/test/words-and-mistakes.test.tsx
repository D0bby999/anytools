/**
 * words-and-mistakes.test.tsx
 * Phase 3 of the private design notes: a word is learned in one click
 * with the meaning in the learner's language and its record prefilled; a
 * chat answer's corrections are ticked and saved as cards; a word with no
 * sentence of its own gets one, and a voice, on its card.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { WordPicker } from "~/components/vocab/word-picker";
import { SaveMistakesButton, SaveMistakesPanel } from "~/components/chat/save-mistakes";
import { CardExample } from "~/components/vocab/card-example";
import { cueFrom, learnPrefill } from "~/lib/vocab-types";

beforeAll(() => {
  initI18n("en");
});
afterEach(() => window.localStorage.clear());

type Post = Record<string, string>;

function routed(
  ui: React.ReactElement,
  posts: Post[],
  reply: (body: Post, url: string) => unknown,
  load: (url: URL) => unknown = () => ({}),
) {
  const handler = async ({ request }: { request: Request }) => {
    const form = await request.formData();
    const body: Post = {};
    for (const [k, v] of form.entries()) body[k] = String(v);
    posts.push(body);
    return reply(body, request.url);
  };
  const router = createMemoryRouter(
    [
      { path: "/", element: ui, action: handler },
      { path: "/app/api/chat-corrections", action: handler },
      { path: "/mastery/vocabulary/sources", loader: ({ request }) => load(new URL(request.url)), action: handler },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("learning a word in one click", () => {
  it("blanks the word in its sentence for the cue", () => {
    expect(cueFrom("hands the turn back", "She smiles. Then she hands the turn back to him!")).toBe(
      "Then she ___ to him!",
    );
    expect(learnPrefill({ term: "x", meaning: "m", sound: "eks", collocation: "an x" }, "an x here")).toEqual({
      sound: "eks",
      collocation: "an x",
      cue: "an ___ here",
    });
  });

  it("saves to learn with the gloss as its meaning and the proposed record", async () => {
    const posts: Post[] = [];
    routed(<WordPicker selection="Then she hands the turn back to him." page={1} />, posts, (b) =>
      b.intent === "terms"
        ? {
            terms: [
              {
                term: "hands the turn back",
                meaning: "lets the other person speak",
                gloss: "nhường lượt nói",
                sound: "hands the TURN back",
                collocation: "hand the turn back to someone",
              },
            ],
            lang: "en",
            existing: [],
          }
        : {
            savedWord: true,
            created: true,
            note: { id: "n1", term: "hands the turn back", lang: "en", decision: "learn", record: {}, meaning: "", contexts: [], cards: [] },
          },
    );
    await userEvent.click(screen.getByRole("button", { name: "Find words to save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Learn this word" }));
    await screen.findByText("Saved to learn. Its two cards are in today's review.");
    expect(posts[1]).toMatchObject({
      intent: "save-word",
      decision: "learn",
      meaning: "nhường lượt nói",
      record_sound: "hands the TURN back",
      record_collocation: "hand the turn back to someone",
      record_cue: "Then she ___ to him.",
    });
  });
});

describe("saving a chat answer's corrections", () => {
  it("lists them ticked, lets one be left out, and saves the rest", async () => {
    const posts: Post[] = [];
    routed(
      <div>
        <SaveMistakesButton messageId="5d3b9b6e-6f0e-4b0e-9a55-2c7c1c1f0a11" />
        <SaveMistakesPanel messageId="5d3b9b6e-6f0e-4b0e-9a55-2c7c1c1f0a11" />
      </div>,
      posts,
      (b) =>
        b.intent === "find"
          ? {
              ok: true,
              intent: "find",
              lang: "en",
              corrections: [
                { wrong: "I go", right: "I went", why: "Past tense." },
                { wrong: "everybodies", right: "everybody", why: "No plural." },
              ],
            }
          : { ok: true, intent: "save", created: 1 },
    );
    await userEvent.click(screen.getByRole("button", { name: "Save mistakes to review" }));
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes.slice(0, 2).every((b) => (b as HTMLInputElement).checked)).toBe(true);
    // The row's button is gone once the list is open.
    expect(screen.queryByRole("button", { name: "Save mistakes to review" })).toBeNull();
    await userEvent.click(boxes[1]!);
    await userEvent.click(screen.getByRole("checkbox", { name: /Also practise saying it right/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save 1 to Vocabulary" }));
    await screen.findByText(/Saved 1 to Vocabulary, in today's review\./);
    expect(posts[1]?.intent).toBe("save");
    expect(JSON.parse(posts[1]!.items!)).toEqual([{ wrong: "I go", right: "I went", why: "Past tense.", production: true }]);
  });

  it("says so when the answer corrected nothing", async () => {
    routed(
      <div>
        <SaveMistakesButton messageId="5d3b9b6e-6f0e-4b0e-9a55-2c7c1c1f0a12" />
        <SaveMistakesPanel messageId="5d3b9b6e-6f0e-4b0e-9a55-2c7c1c1f0a12" />
      </div>,
      [],
      () => ({ ok: true, intent: "find", lang: "", corrections: [] }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save mistakes to review" }));
    await screen.findByText("No mistake of yours was corrected in this answer.");
  });
});

describe("an example on a word's card", () => {
  it("looks up a sentence and a recording as the card is shown, and keeps the sentence", async () => {
    const posts: Post[] = [];
    const looked: string[] = [];
    routed(
      <CardExample noteId="n1" term="weather" lang="en" show />,
      posts,
      () => ({ used: "Nice weather today." }),
      (url) => {
        looked.push(url.searchParams.get("kind") ?? "");
        return url.searchParams.get("kind") === "sentences"
          ? {
              sentences: [
                {
                  id: 1,
                  text: "Nice weather today.",
                  licence: "CC BY 2.0 FR",
                  author: "tom",
                  url: "https://tatoeba.org/sentences/show/1",
                  translation: { text: "Hôm nay trời đẹp.", licence: "CC BY 2.0 FR", author: "lan" },
                },
              ],
            }
          : { recordings: [{ id: "r1", speaker: "Ann", licence: "CC BY-SA 4.0", page: "https://commons.wikimedia.org/x", source: "Lingua Libre" }] };
      },
    );
    await screen.findByText("Nice weather today.");
    expect(screen.getByText("Hôm nay trời đẹp.")).toBeInTheDocument();
    expect(screen.getByLabelText("weather, said by Ann")).toBeInTheDocument();
    expect(looked.sort()).toEqual(["recordings", "sentences"]);
    await userEvent.click(screen.getByRole("button", { name: "Keep this sentence" }));
    await screen.findByText(/Kept as the word's sentence/);
    expect(posts[0]).toMatchObject({ id: "n1", sentence: "Nice weather today." });
  });
});
