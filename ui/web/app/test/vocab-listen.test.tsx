/**
 * vocab-listen.test.tsx
 * The listening card (plans/261020-1155-open-source-adds, phase 1): it plays
 * the line a word was saved from, cut to that line; the blanked line waits
 * behind "Show the line"; the answer is typed and marked like a cloze; a card
 * whose video is gone reads as a cloze. The word list offers it only for a
 * word with a line to play.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { ReviewSession } from "~/components/vocab/review-session";
import { WordList } from "~/components/vocab/word-list";
import type { DueCard, VocabNote } from "~/lib/vocab-types";

beforeAll(() => {
  initI18n("en");
});

type Post = Record<string, string>;

function routed(ui: React.ReactElement, posts: Post[], reply: (body: Post) => unknown = () => ({})) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: ui,
        action: async ({ request }) => {
          const body = Object.fromEntries((await request.formData()).entries()) as Post;
          posts.push(body);
          return reply(body);
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

const clip = { document_id: "doc-1", page: 2, video_id: "dQw4w9WgXcQ", start: 12, end: 17, sentence: "s" };

const listen: DueCard = {
  id: "card-l",
  note_id: "n1",
  kind: "listen",
  due_at: "2026-10-16T00:00:00Z",
  reps: 0,
  term: "equilibrium",
  lang: "en",
  reading: "",
  pos: "noun",
  meaning: "A balanced state.",
  context: "The market reached equilibrium by noon.",
  cloze: "The market reached _____ by noon.",
  clip,
};

describe("the listening card", () => {
  it("plays only the line, hides it until asked, and marks the typed word", async () => {
    const posts: Post[] = [];
    routed(<ReviewSession cards={[listen]} total={1} />, posts, () => ({ reviewed: "card-l" }));
    expect(screen.getByText("Play the line and type the word you hear.")).toBeInTheDocument();
    expect(screen.queryByText(/reached/)).not.toBeInTheDocument();
    expect(screen.queryByTitle("The line the word was saved from")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Play the line" }));
    const frame = screen.getByTitle("The line the word was saved from");
    const src = new URL(frame.getAttribute("src")!);
    expect(src.pathname).toBe("/embed/dQw4w9WgXcQ");
    expect(src.searchParams.get("start")).toBe("12");
    expect(src.searchParams.get("end")).toBe("18");
    expect(screen.getByRole("button", { name: "Play it again" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show the line" }));
    expect(screen.getByText("The market reached _____ by noon.")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Your answer"), "Equilibrium");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByRole("status")).toHaveTextContent("That matches. equilibrium");
    expect(screen.getByText("The market reached equilibrium by noon.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Good/ }));
    await screen.findByText("That is everything due today.");
    expect(posts[0]).toMatchObject({ intent: "review", card_id: "card-l", rating: "good", answer: "Equilibrium" });
  });

  it("plays a recording from this origin", () => {
    const { container } = routed(
      <ReviewSession cards={[{ ...listen, clip: { ...clip, video_id: undefined } }]} total={1} />,
      [],
    );
    expect(container.querySelector("audio")?.getAttribute("src")).toBe("/documents/doc-1/media");
  });

  it("reads as a cloze when the video is gone", () => {
    routed(<ReviewSession cards={[{ ...listen, clip: undefined }]} total={1} />, []);
    expect(screen.getByText(/is gone, so here is the line to read instead/)).toBeInTheDocument();
    expect(screen.getByText("The market reached _____ by noon.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play the line" })).not.toBeInTheDocument();
  });
});

function note(over: Partial<VocabNote>): VocabNote {
  return {
    id: "n1", term: "equilibrium", lang: "en", reading: "", pos: "noun", meaning: "A balanced state.",
    contexts: [], cards: [], suspended: false, created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T00:00:00Z",
    decision: "learn", record: {}, task_impact: "", decided_at: "2026-10-16T00:00:00Z",
    scenario: "", confusable: "", production: false, listening: false,
    ...over,
  };
}

describe("Practise hearing it", () => {
  it("is offered only for a word with a line to play, and turns the card on and off", async () => {
    const posts: Post[] = [];
    routed(
      <WordList
        notes={[note({ id: "n-video", term: "equilibrium", clip }), note({ id: "n-pdf", term: "entropy" })]}
        q=""
        lang=""
        langs={["en"]}
      />,
      posts,
      (b) => ({ updated: b.id }),
    );
    const pdfRow = screen.getByText("entropy").closest("li")!;
    expect(within(pdfRow).queryByRole("button", { name: "Practise hearing it" })).not.toBeInTheDocument();
    const videoRow = screen.getByText("equilibrium").closest("li")!;
    await userEvent.click(within(videoRow).getByRole("button", { name: "Practise hearing it" }));
    await screen.findByText("equilibrium");
    expect(posts[0]).toEqual({ intent: "listening", id: "n-video", on: "true" });
  });
});
