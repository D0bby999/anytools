/**
 * book-components.test.tsx
 *
 * Living books (learning depth, phase 11): the outline editor keeps
 * prerequisites pointing backwards through a reorder and refuses to confirm
 * a chapter with no passage; a chapter's blocks render through RichText with
 * their citations; a quiz block answers in place; a flash-card block's "Add
 * to review" posts its choice; an error block says why; a chapter whose
 * sources changed says so; a flash card reviews like a word.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { BookProposalEditor } from "~/components/book/proposal-editor";
import { BlockView } from "~/components/book/block-view";
import { ChapterList } from "~/components/book/chapter-list";
import { KbBooks } from "~/components/book/kb-books";
import { ReviewSession } from "~/components/vocab/review-session";
import ChapterPage from "~/routes/books.$bookId.chapters.$chapterId";
import { fromDraft, toDraft, type Block, type Book, type Chapter } from "~/lib/book-types";
import type { DueCard } from "~/lib/vocab-types";

beforeAll(() => {
  initI18n("en");
});

type Post = Record<string, string>;
let posts: Post[] = [];
afterEach(() => {
  posts = [];
});

function routed(ui: React.ReactElement, reply: (body: Post) => unknown = () => ({})) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: ui,
        action: async ({ request }) => {
          const form = await request.formData();
          const body: Post = {};
          for (const [k, v] of form.entries()) body[k] = String(v);
          posts.push(body);
          return reply(body);
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

const chunk = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const chapter = (over: Partial<Chapter> = {}): Chapter => ({
  id: "ch1",
  book_id: "b1",
  ord: 1,
  title: "What retrieval is",
  objectives: ["explain retrieval"],
  prereqs: [],
  anchors: [chunk(1)],
  status: "ready",
  blocks: 6,
  ready: 6,
  stale: false,
  estimated_calls: 6,
  ...over,
});

const proposedBook = (): Book => ({
  id: "b1",
  kb_id: "kb1",
  title: "Retrieval",
  goal: "",
  length: 4,
  status: "proposed",
  proposal: {
    title: "Retrieval",
    audience: "New learners",
    chapters: [
      { title: "One", objectives: ["o1"], prereqs: [], anchors: [chunk(1)] },
      { title: "Two", objectives: ["o2"], prereqs: [1], anchors: [chunk(2)] },
      { title: "Three", objectives: ["o3"], prereqs: [1, 2], anchors: [chunk(3)] },
    ],
    outline: [1, 2, 3].map((n) => ({
      chunk_id: chunk(n),
      document_id: "d1",
      title: "Notes.pdf",
      page: n,
      snippet: `Passage ${n}`,
    })),
  },
  chapters: [],
  created_at: "2026-09-27T00:00:00Z",
  updated_at: "2026-09-27T00:00:00Z",
  compiling: false,
  estimated_calls: 0,
});

const source = { kind: "chunk", id: chunk(1), title: "Notes.pdf", page: 1, document_id: "d1" };

const block = (over: Partial<Block>): Block => ({
  id: "blk1",
  chapter_id: "ch1",
  ord: 1,
  type: "text",
  status: "ready",
  title: "The idea",
  payload: { markdown: `Retrieval finds passages first. [[cite:chunk:${chunk(1)}]]` },
  sources: [source],
  version: 1,
  created_at: "2026-09-27T00:00:00Z",
  ...over,
});

describe("the outline's prerequisites", () => {
  it("follow a chapter through a reorder and never point forward", () => {
    const draft = toDraft(proposedBook().proposal.chapters);
    // Move chapter three to the top: its prerequisites are now later
    // chapters, and are dropped; chapter two still builds on chapter one.
    const moved = [draft[2]!, draft[0]!, draft[1]!];
    const saved = fromDraft(moved);
    expect(saved.map((c) => c.title)).toEqual(["Three", "One", "Two"]);
    expect(saved[0]!.prereqs).toEqual([]);
    expect(saved[2]!.prereqs).toEqual([2]);
  });
});

describe("BookProposalEditor", () => {
  it("saves the edited outline and confirms it", async () => {
    const user = userEvent.setup();
    routed(<BookProposalEditor book={proposedBook()} />);
    const title = await screen.findByDisplayValue("Two");
    await user.clear(title);
    await user.type(title, "Indexing");
    await user.click(screen.getAllByRole("button", { name: "Move up" })[1]!);
    await user.click(screen.getByRole("button", { name: "Confirm outline" }));

    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]!.intent).toBe("confirm");
    const saved = JSON.parse(posts[0]!.proposal ?? "{}");
    expect(saved.chapters.map((c: { title: string }) => c.title)).toEqual(["Indexing", "One", "Three"]);
    // "Indexing" built on "One", which is now after it: dropped, not sent forward.
    expect(saved.chapters[0].prereqs).toEqual([]);
    expect(saved.chapters[2].prereqs).toEqual([1, 2]);
  });

  it("will not confirm a chapter with no passage behind it", async () => {
    const user = userEvent.setup();
    routed(<BookProposalEditor book={proposedBook()} />);
    await user.click(await screen.findByRole("button", { name: "Add a chapter" }));
    expect(screen.getByText("Choose at least one passage.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm outline" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save outline" })).toBeEnabled();
  });
});

describe("BlockView", () => {
  it("renders a text block through RichText with its citation chip", async () => {
    routed(<BlockView block={block({})} />);
    expect(await screen.findByText(/Retrieval finds passages first/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Notes\.pdf/ })).toHaveAttribute("href", "/documents/d1?page=1");
    expect(screen.queryByText(/\[\[cite/)).toBeNull();
  });

  it("never renders a block's HTML", async () => {
    routed(<BlockView block={block({ payload: { markdown: '<img src=x onerror="alert(1)"> plain' } })} />);
    await screen.findByText(/plain/);
    expect(document.querySelector("img[onerror]")).toBeNull();
  });

  it("answers a quiz block's question in place", async () => {
    const user = userEvent.setup();
    routed(
      <BlockView
        block={block({
          type: "quiz",
          title: "Check",
          payload: { question_ids: ["q1"] },
          questions: [
            {
              id: "q1",
              kb_id: "kb1",
              prompt: "What comes first?",
              type: "mcq",
              options: [
                { label: "A", body: "Retrieval" },
                { label: "B", body: "Writing" },
              ],
              difficulty: "easy",
              source_chunk_ids: [chunk(1)],
              created_at: "2026-09-27T00:00:00Z",
              revealed: false,
            },
          ],
        })}
      />,
    );
    expect(await screen.findByText("What comes first?")).toBeInTheDocument();
    // The answer is not in the page before an attempt.
    expect(screen.queryByText(/Answer:/)).toBeNull();
    const form = screen.getByText("What comes first?").closest("article")!;
    await user.click(within(form).getByRole("radio", { name: /Retrieval/ }));
    expect(within(form).getByRole("button", { name: /Check|Submit|Answer/ })).toBeEnabled();
  });

  it("puts flash cards in and out of review", async () => {
    const user = userEvent.setup();
    routed(
      <BlockView
        block={block({
          type: "flash_cards",
          title: "Terms",
          payload: { count: 2 },
          cards: [
            { front: "What is retrieval?", back: "Finding passages." },
            { front: "What is a chunk?", back: "A piece of a document." },
          ],
          in_review: true,
        })}
      />,
    );
    expect(await screen.findByText("What is retrieval?")).toBeInTheDocument();
    const toggle = screen.getByRole("checkbox", { name: "Add to review" });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ intent: "review", blockId: "blk1", on: "false" });
  });

  it("says why a block could not be written, and offers a retry", async () => {
    routed(<BlockView block={block({ status: "error", error: "the block cites none of the passages", version: 0 })} />);
    expect(await screen.findByText(/could not be written: the block cites none/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText(/Retrieval finds passages/)).toBeNull();
  });

  it("keeps the previous version on the page while a block is rewritten", async () => {
    routed(<BlockView block={block({ status: "pending", version: 1 })} />);
    expect(await screen.findByText("Being rewritten; this is the previous version.")).toBeInTheDocument();
    expect(screen.getByText(/Retrieval finds passages first/)).toBeInTheDocument();
  });

  it("draws a diagram block through the diagram renderer, never as inline SVG", async () => {
    routed(
      <BlockView
        block={block({
          type: "diagram",
          title: "The flow",
          payload: { kind: "mermaid", source: "flowchart TD\n  A --> B", caption: "The pipeline." },
          sources: [],
        })}
      />,
    );
    expect(await screen.findByText("The pipeline.")).toBeInTheDocument();
    expect(document.querySelector("svg[id^='mermaid']")).toBeNull();
  });
});

describe("the chapter page", () => {
  const view = (over: Partial<Chapter>, blocks: Block[] = [block({})]) => {
    const ch = chapter(over);
    const book = { ...proposedBook(), status: "confirmed" as const, chapters: [ch] };
    const props = { loaderData: { book, view: { chapter: ch, blocks } } } as unknown as React.ComponentProps<typeof ChapterPage>;
    return routed(<ChapterPage {...props} />);
  };

  it("says when its sources changed since it was written", async () => {
    view({ stale: true });
    // The first render of the route module is slow on a loaded machine.
    expect(await screen.findByText("Sources changed since this was written. Refresh.", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh this chapter" })).toBeInTheDocument();
  });

  it("shows no stale banner for a fresh chapter", async () => {
    view({});
    await screen.findByText(/Retrieval finds passages first/, {}, { timeout: 8000 });
    expect(screen.queryByText(/Sources changed/)).toBeNull();
  });

  it("says what writing an unwritten chapter costs before anything is spent", async () => {
    view({ status: "pending", blocks: 0, ready: 0, estimated_calls: 11 }, []);
    expect(await screen.findByRole("button", { name: "Write this chapter" }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText("Up to 11 calls on your key: one to plan it, one per block.")).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });
});

describe("ChapterList", () => {
  it("says what writing every chapter costs, and why a book is paused", async () => {
    const book: Book = {
      ...proposedBook(),
      status: "confirmed",
      paused_reason: "Paused after two provider failures in a row.",
      chapters: [chapter({ status: "paused", blocks: 6, ready: 2, estimated_calls: 4 }), chapter({ id: "ch2", ord: 2, status: "pending", blocks: 0, ready: 0, estimated_calls: 11 })],
      estimated_calls: 15,
    };
    routed(<ChapterList book={book} />);
    expect(await screen.findByText("About 15 calls on your key, in the background.")).toBeInTheDocument();
    expect(screen.getByText("Paused after two provider failures in a row.")).toBeInTheDocument();
    expect(screen.getByText(/Paused · 2 of 6 blocks/)).toBeInTheDocument();
  });
});

describe("KbBooks", () => {
  it("says what making a book costs, and lists the knowledge base's books", async () => {
    const confirmed = { ...proposedBook(), id: "b2", title: "Ranking", status: "confirmed" as const, chapters: [chapter({}), chapter({ id: "c2", status: "pending" })] };
    routed(<KbBooks kbId="kb1" books={[proposedBook(), confirmed]} />);
    expect(await screen.findByText(/Proposing the outline is one call on your key/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retrieval" })).toHaveAttribute("href", "/books/b1");
    expect(screen.getByText("Outline to review")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 chapters written")).toBeInTheDocument();
  });
});

describe("a flash card in review", () => {
  it("shows the front, then the back, and rates it like a word", async () => {
    const user = userEvent.setup();
    const card: DueCard = {
      id: "f1",
      kind: "flash",
      due_at: "2026-09-27T00:00:00Z",
      reps: 0,
      term: "",
      lang: "",
      reading: "",
      pos: "",
      meaning: "",
      context: "",
      front: "What is retrieval?",
      back: "Finding the passages first.",
      book: { book_id: "b1", title: "Retrieval", chapter_id: "ch1" },
    };
    routed(<ReviewSession cards={[card]} total={1} />, () => ({ reviewed: "f1" }));
    expect(await screen.findByText("What is retrieval?")).toBeInTheDocument();
    expect(screen.queryByText("Finding the passages first.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show the answer" }));
    expect(screen.getByText("Finding the passages first.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "From Retrieval" })).toHaveAttribute("href", "/books/b1/chapters/ch1");
    await user.click(screen.getByRole("button", { name: "Good" }));
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ intent: "review", card_id: "f1", rating: "good", answer: "" });
  });
});
