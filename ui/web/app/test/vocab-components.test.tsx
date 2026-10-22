/**
 * vocab-components.test.tsx
 * The vocabulary review flow, the read-aloud panel (with a fake
 * speechSynthesis), "Find words to save", Listen, and the helpers the reader
 * and the session share with the server's rules.
 */
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { ReviewSession } from "~/components/vocab/review-session";
import { ReadAloudBar } from "~/components/vocab/read-aloud";
import { WordPicker } from "~/components/vocab/word-picker";
import { ListenButton } from "~/components/vocab/listen-button";
import { MasteryTabs } from "~/components/vocab/mastery-tabs";
import { TutorPane } from "~/components/reading/tutor-pane";
import { clozeMatches, fold, suggestedRating, transcriptSelection, type DueCard } from "~/lib/vocab-types";
import { installFakeSpeech, voice } from "./speech-fake";

beforeAll(() => {
  initI18n("en");
});

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  window.localStorage.clear();
});

type Post = Record<string, string>;

function routed(ui: React.ReactElement, posts: Post[], reply: (body: Post) => unknown = () => ({})) {
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

const recognition: DueCard = {
  id: "card-r",
  note_id: "n1",
  kind: "recognition",
  due_at: "2026-09-27T00:00:00Z",
  reps: 0,
  term: "equilibrium",
  lang: "en",
  reading: "",
  pos: "noun",
  meaning: "A balanced state.",
  context: "When a system at equilibrium is disturbed, it shifts.",
  source: { document_id: "d1", title: "Chemistry.pdf", page: 3 },
};

const cloze: DueCard = {
  id: "card-c",
  note_id: "n2",
  kind: "cloze",
  due_at: "2026-09-27T00:01:00Z",
  reps: 0,
  term: "trí tuệ",
  lang: "vi",
  reading: "",
  pos: "",
  meaning: "intelligence",
  context: "Học máy là một lĩnh vực của trí tuệ nhân tạo",
  cloze: "Học máy là một lĩnh vực của _____ nhân tạo",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("ReviewSession", () => {
  it("reveals a recognition card's meaning, rates it, and moves on", async () => {
    const posts: Post[] = [];
    routed(<ReviewSession cards={[recognition, cloze]} total={2} />, posts, (b) => ({ reviewed: b.card_id }));

    expect(screen.getByText("equilibrium")).toBeInTheDocument();
    expect(screen.queryByText("A balanced state.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Good" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show the meaning" }));
    expect(screen.getByText("A balanced state.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "From Chemistry.pdf" })).toHaveAttribute("href", "/documents/d1?page=3");

    await userEvent.click(screen.getByRole("button", { name: "Good" }));
    await screen.findByText("Type the missing word.");
    expect(posts[0]).toMatchObject({ intent: "review", card_id: "card-r", rating: "good", answer: "" });
    expect(posts[0]?.request_id).toMatch(UUID);
  });

  it("checks a cloze answer ignoring accents, suggests Good, and sends what the learner confirms", async () => {
    const posts: Post[] = [];
    routed(<ReviewSession cards={[cloze]} total={1} />, posts, (b) => ({ reviewed: b.card_id }));

    expect(screen.getByText("Học máy là một lĩnh vực của _____ nhân tạo")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Your answer"), "tri tue");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));

    expect(screen.getByRole("status")).toHaveTextContent("That matches. trí tuệ");
    expect(screen.getByRole("button", { name: /^Good\W*suggested/ })).toBeInTheDocument();
    // The learner may still choose otherwise.
    await userEvent.click(screen.getByRole("button", { name: "Hard" }));
    await screen.findByText("That is everything due today.");
    expect(posts[0]).toMatchObject({ card_id: "card-c", rating: "hard", answer: "tri tue" });
  });

  it("suggests Again for a wrong cloze answer", async () => {
    routed(<ReviewSession cards={[cloze]} total={1} />, []);
    await userEvent.type(screen.getByLabelText("Your answer"), "trí");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByRole("status")).toHaveTextContent("The word was: trí tuệ");
    expect(screen.getByRole("button", { name: /^Again\W*suggested/ })).toBeInTheDocument();
  });

  it("keeps the card and its request id when a review fails, so the retry is idempotent", async () => {
    const posts: Post[] = [];
    let fail = true;
    routed(<ReviewSession cards={[recognition]} total={1} />, posts, (b) => {
      if (fail) {
        fail = false;
        return { errorKey: "errors.generic" };
      }
      return { reviewed: b.card_id };
    });
    await userEvent.click(screen.getByRole("button", { name: "Show the meaning" }));
    await userEvent.click(screen.getByRole("button", { name: "Good" }));
    await screen.findByRole("alert");
    expect(screen.getByText("equilibrium")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Good" }));
    await screen.findByText("That is everything due today.");
    expect(posts).toHaveLength(2);
    expect(posts[1]?.request_id).toBe(posts[0]?.request_id);
  });

  it("says how many more are due beyond the session cap", async () => {
    routed(<ReviewSession cards={[recognition]} total={63} />, [], (b) => ({ reviewed: b.card_id }));
    await userEvent.click(screen.getByRole("button", { name: "Show the meaning" }));
    await userEvent.click(screen.getByRole("button", { name: "Easy" }));
    expect(await screen.findByText("62 more are due today after this session.")).toBeInTheDocument();
  });

  it("says plainly when nothing is due", () => {
    routed(<ReviewSession cards={[]} total={0} />, []);
    expect(screen.getByText("Nothing is due today.")).toBeInTheDocument();
  });
});

describe("ReadAloudBar", () => {
  it("says when there is no voice for the language and offers the others", async () => {
    const { fake, remove } = installFakeSpeech([voice("Samantha", "en-US"), voice("Google US English", "en-US", false)]);
    cleanup = remove;
    render(<ReadAloudBar text="Xin chào các bạn. Hôm nay học gì?" onClose={() => {}} />);

    expect(
      await screen.findByText("Your browser has no voice for vi. Choose a voice for another language to hear it anyway."),
    ).toBeInTheDocument();
    const select = screen.getByLabelText("Voice");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "–",
      "Samantha (en-US) · on this device",
      "Google US English (en-US) · online: the text is sent to your browser's maker",
    ]);
    // Nothing is spoken until the learner chooses a voice.
    expect(fake.queue).toHaveLength(0);
    await userEvent.selectOptions(select, "Samantha-en-US");
    expect(fake.queue.map((u) => u.voice?.name)).toEqual(["Samantha", "Samantha"]);
    // The choice is remembered for Vietnamese.
    expect(JSON.parse(window.localStorage.getItem("lp.speech") ?? "{}").voices).toEqual({ vi: "Samantha-en-US" });
  });

  it("reads with the local voice for the language and highlights the sentence being read", async () => {
    const { fake, remove } = installFakeSpeech([voice("Samantha", "en-US"), voice("Linh", "vi-VN")]);
    cleanup = remove;
    render(<ReadAloudBar text="Xin chào các bạn. Hôm nay học gì?" onClose={() => {}} />);
    await screen.findByRole("button", { name: "Stop" });
    expect(fake.queue.map((u) => [u.text, u.voice?.name])).toEqual([
      ["Xin chào các bạn.", "Linh"],
      ["Hôm nay học gì?", "Linh"],
    ]);
    act(() => {
      fake.step();
    });
    expect(screen.getByText("Xin chào các bạn.")).toHaveAttribute("aria-current", "true");
    // The last sentence plays to its end: the highlight clears and the
    // panel offers to read again.
    act(() => {
      fake.step();
    });
    expect(screen.getByText("Hôm nay học gì?")).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Read aloud" })).toBeInTheDocument();
  });

  it("stops", async () => {
    const { fake, remove } = installFakeSpeech([voice("Samantha", "en-US")]);
    cleanup = remove;
    render(<ReadAloudBar text="One. Two. Three." onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(fake.queue).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Read aloud" })).toBeInTheDocument();
  });
});

describe("ListenButton", () => {
  it("renders nothing without speechSynthesis", () => {
    const { container } = render(<ListenButton text="Hello." />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reads the answer's plain text", async () => {
    const { fake, remove } = installFakeSpeech([voice("Samantha", "en-US")]);
    cleanup = remove;
    render(<ListenButton text={"## Energy\n\nIt is $E=mc^2$ **here** [[cite:chunk:x]]."} />);
    await userEvent.click(await screen.findByRole("button", { name: "Listen" }));
    await screen.findByRole("button", { name: "Stop" });
    expect(fake.queue.map((u) => u.text)).toEqual(["Energy It is here ."]);
  });
});

describe("WordPicker", () => {
  it("finds words on request and saves one with the chosen language and a decision", async () => {
    const posts: Post[] = [];
    routed(<WordPicker selection="a system at equilibrium" page={3} />, posts, (b) =>
      b.intent === "terms"
        ? { terms: [{ term: "equilibrium", meaning: "A balanced state.", pos: "noun" }], lang: "en", existing: [] }
        : { savedWord: true, created: true, note: { ...savedNote, decision: "lookup" } },
    );
    expect(screen.getByText("Asks your reading model once for a list of terms from this passage.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Find words to save" }));
    await screen.findByText("equilibrium");
    expect(posts[0]).toEqual({ intent: "terms", selection: "a system at equilibrium", page: "3" });
    // up-methods phase 3: the meaning waits for a decision.
    expect(screen.queryByText("A balanced state.")).not.toBeInTheDocument();

    // The language is chosen by name; a code the list lacks goes in "Other…".
    const lang = screen.getByLabelText("Language");
    expect(lang).toHaveDisplayValue("English");
    expect(screen.getByRole("link", { name: "Look up equilibrium in Cambridge" })).toHaveAttribute(
      "href",
      "https://dictionary.cambridge.org/dictionary/english/equilibrium",
    );
    await userEvent.selectOptions(lang, "Other…");
    const code = screen.getByLabelText("Language code");
    await userEvent.clear(code);
    await userEvent.type(code, "en-GB");
    // One click learns it; the five decisions are behind "Other ways to keep it".
    expect(screen.getByRole("button", { name: "Learn this word" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Other ways to keep it" }));
    await userEvent.click(screen.getByRole("radio", { name: /Quick lookup/ }));
    expect(screen.getByLabelText("Current sense")).toHaveValue("A balanced state.");
    await userEvent.type(screen.getByLabelText("Source of the current sense"), "Cambridge dictionary");
    await userEvent.click(screen.getByRole("button", { name: "Save the decision" }));
    await screen.findByText("Saved as Quick lookup.");
    expect(posts[1]).toEqual({
      intent: "save-word",
      selection: "a system at equilibrium",
      page: "3",
      term: "equilibrium",
      pos: "noun",
      lang: "en-GB",
      decision: "lookup",
      record_source: "Cambridge dictionary",
      meaning: "A balanced state.",
      task_impact: "",
    });
  });
});

const savedNote = {
  id: "n1",
  term: "equilibrium",
  lang: "en",
  reading: "",
  pos: "noun",
  meaning: "A balanced state.",
  contexts: [],
  cards: [],
  suspended: false,
  created_at: "2026-10-16T00:00:00Z",
  updated_at: "2026-10-16T00:00:00Z",
  decision: "learn" as const,
  record: {},
  task_impact: "" as const,
  decided_at: "2026-10-16T00:00:00Z",
  scenario: "",
  confusable: "",
  production: false,
};

describe("MasteryTabs", () => {
  it("shows the vocabulary due count and no badge at zero", () => {
    const { rerender } = routed(<MasteryTabs vocabDue={4} />, []);
    expect(screen.getByRole("link", { name: /Vocabulary/ })).toHaveTextContent("Vocabulary4 due");
    rerender(<></>);
    routed(<MasteryTabs vocabDue={0} />, []);
    expect(screen.getAllByRole("link", { name: "Vocabulary" }).length).toBeGreaterThan(0);
  });
});

describe("vocab helpers", () => {
  it("fold and clozeMatches follow the server's rule", () => {
    expect(fold("  Trí  Tuệ ")).toBe("tri tue");
    expect(fold("Đường")).toBe("duong");
    expect(clozeMatches("tri tue", "trí tuệ")).toBe(true);
    expect(clozeMatches("", "x")).toBe(false);
    expect(suggestedRating("TRI TUE", "trí tuệ")).toBe("good");
    expect(suggestedRating("tri", "trí tuệ")).toBe("again");
  });

  it("reads the selection back out of a stored vocabulary question", () => {
    expect(transcriptSelection("Vocabulary here (page 3):\n\n> a system at\n> equilibrium")).toBe(
      "a system at equilibrium",
    );
  });
});

describe("two readers", () => {
  it("a second reader silences the first, which then shows it is stopped", async () => {
    const { remove } = installFakeSpeech([voice("Samantha", "en-US")]);
    cleanup = remove;
    render(
      <>
        <ReadAloudBar text="First reader." onClose={() => {}} />
      </>,
    );
    await screen.findByRole("button", { name: "Stop" });
    render(<ReadAloudBar text="Second reader." onClose={() => {}} />);
    await screen.findByRole("button", { name: "Read aloud" });
    expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(1);
  });
});

describe("TutorPane and vocabulary", () => {
  it("offers Find words to save under a vocabulary answer only", async () => {
    const posts: Post[] = [];
    routed(
      <TutorPane
        exchanges={[
          { id: "v", question: "Vocabulary here (page 3):\n\n> a system at equilibrium", answer: "equilibrium: balance", sources: [], page: 3 },
          { id: "e", question: "Explain this (page 3):\n\n> a system", answer: "It means y.", sources: [], page: 3 },
        ]}
      />,
      posts,
      () => ({ terms: [], lang: "en" }),
    );
    const find = screen.getAllByRole("button", { name: "Find words to save" });
    expect(find).toHaveLength(1);
    await userEvent.click(find[0]!);
    await screen.findByText("The model found no words in this passage to save.");
    expect(posts[0]).toEqual({ intent: "terms", selection: "a system at equilibrium", page: "3" });
  });
});
