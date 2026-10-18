/**
 * exam-components.test.tsx
 *
 * Mock exams (learning depth, phase 3): the review screen edits what the
 * extraction produced and sends the server nothing it did not compute itself
 * (issues are the server's); the timer runs on the server's clock and counts
 * over time rather than stopping; the result says what each answer earned and
 * why; the paper saves itself as it is typed; a written question is answered
 * at length and its rubric marking is shown.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import type { ExamTemplate, ExamView } from "~/lib/exam-types";
import type { AttemptResult, QuestionView } from "~/lib/study-types";
import { TemplateEditor } from "~/components/exam/template-editor";
import { ExamTimer } from "~/components/exam/exam-timer";
import { ExamResult } from "~/components/exam/exam-result";
import { AUTOSAVE_MS, ExamSheet } from "~/components/exam/exam-sheet";
import { QuestionCard } from "~/components/quiz/question-card";

beforeAll(() => {
  initI18n("en");
});

afterEach(() => {
  vi.useRealTimers();
});

const template: ExamTemplate = {
  id: "t1",
  title: "Midterm 2024",
  filename: "midterm.pdf",
  kind: "pdf",
  bytes: 1000,
  page_count: 3,
  status: "review",
  items: [
    {
      number: "1",
      type: "mcq",
      stem_md: "Where is non-parametric memory kept?",
      options: [{ label: "A", text_md: "An index" }],
      points: 2,
      difficulty: "easy",
      source_page: 1,
      issues: ["a multiple-choice question needs at least two options"],
    },
    { number: "2", type: "written", stem_md: "Discuss retrieval.", options: null, points: 4, difficulty: "hard", source_page: 2, figure_page: 3 },
    { number: "3", type: "tf", stem_md: "Not a question: the header.", options: null, points: 1, difficulty: "medium", source_page: 1 },
  ],
  warnings: ["question 4 is missing (between 3 and 5)"],
  total_points: 7,
  created_at: "2026-09-27T00:00:00Z",
  updated_at: "2026-09-27T00:00:00Z",
};

/** Renders element at "/", recording what its fetchers post there. */
function renderRoute(element: React.ReactNode, posts: Record<string, string>[], reply: unknown = { ok: true }) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element,
        action: async ({ request }) => {
          posts.push(Object.fromEntries(await request.formData()) as Record<string, string>);
          return reply;
        },
      },
      { path: "/quiz/practice", element: <p>practice</p> },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("TemplateEditor", () => {
  it("shows the server's issues and warnings, and posts the learner's edits without them", async () => {
    const posts: Record<string, string>[] = [];
    renderRoute(<TemplateEditor template={template} paperUrl="/quiz/exams/templates/t1/paper" />, posts);

    expect(screen.getByText("a multiple-choice question needs at least two options")).toBeInTheDocument();
    expect(screen.getByText("question 4 is missing (between 3 and 5)")).toBeInTheDocument();
    expect(screen.getByText(/1 question needs fixing/)).toBeInTheDocument();

    // Fix question 1: a second option. Change question 2's marks. Delete 3.
    const options = screen.getByLabelText("Options");
    await userEvent.type(options, "{End}{Enter}Its weights");
    const marks = screen.getAllByLabelText("Marks");
    await userEvent.clear(marks[1]!);
    await userEvent.type(marks[1]!, "5");
    await userEvent.click(screen.getAllByRole("button", { name: "Delete question" })[2]!);
    await userEvent.click(screen.getByRole("button", { name: "Save and mark ready" }));

    await waitFor(() => expect(posts).toHaveLength(1));
    const payload = JSON.parse(posts[0]!.payload!) as { items: Record<string, unknown>[]; ready: boolean; title: string };
    expect(posts[0]!.intent).toBe("save");
    expect(payload.ready).toBe(true);
    expect(payload.title).toBe("Midterm 2024");
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]!.options).toEqual([
      { label: "A", text_md: "An index" },
      { label: "B", text_md: "Its weights" },
    ]);
    expect(payload.items[1]!.points).toBe(5);
    for (const item of payload.items) expect(item).not.toHaveProperty("issues");
  });

  it("offers a PDF's page, and points a Word paper's figure at the original", () => {
    const { unmount } = renderRoute(<TemplateEditor template={template} paperUrl="/p" />, []);
    expect(screen.getByRole("button", { name: "Show page 3" })).toBeInTheDocument();
    unmount();
    renderRoute(<TemplateEditor template={{ ...template, kind: "docx" }} paperUrl="/p" />, []);
    expect(screen.queryByRole("button", { name: /Show page/ })).toBeNull();
    expect(screen.getByText("The figure is in the original paper.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download it" })).toHaveAttribute("href", "/p");
  });
});

describe("ExamTimer", () => {
  it("runs on the server's clock and counts over time instead of stopping", () => {
    vi.useFakeTimers();
    // This laptop is ten minutes fast; the server says 90 seconds are left.
    vi.setSystemTime(new Date("2026-09-27T10:10:00Z"));
    render(<ExamTimer deadline="2026-09-27T10:01:30Z" serverNow="2026-09-27T10:00:00Z" />);
    expect(screen.getByText("1:30 left")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(92_000);
    });
    expect(screen.getByText("0:02 over time")).toBeInTheDocument();
    expect(screen.getByText("Over time:")).toBeInTheDocument();
  });
});

const question = (id: string, type: QuestionView["type"], extra: Partial<QuestionView> = {}): QuestionView => ({
  id,
  kb_id: "kb1",
  prompt: `Question ${id}?`,
  type,
  options: type === "mcq" ? [{ label: "A", body: "An index" }, { label: "B", body: "Its weights" }] : [],
  difficulty: "medium",
  source_chunk_ids: ["c1"],
  created_at: "2026-09-27T00:00:00Z",
  revealed: false,
  ...extra,
});

const base: ExamView = {
  id: "e1",
  kb_id: "kb1",
  title: "Midterm 2024",
  status: "in_progress",
  requested: 3,
  generated: 3,
  dropped: [],
  time_limit_minutes: 30,
  started_at: "2026-09-27T10:00:00Z",
  created_at: "2026-09-27T09:00:00Z",
  items: [
    { id: "i1", ord: 0, number: "1", points: 2, question: question("q1", "mcq"), answer: "" },
    { id: "i2", ord: 1, number: "2", points: 4, question: question("q2", "written"), answer: "Draft" },
    { id: "i3", ord: 2, number: "3", points: 1, question: question("q3", "tf"), answer: "" },
  ],
  item_count: 3,
  deadline_at: "2026-09-27T10:30:00Z",
  late: false,
  marked: 0,
  sources: [],
  server_now: "2026-09-27T10:05:00Z",
};

describe("ExamSheet", () => {
  it("saves every answer a moment after the last change, and hands in what was typed", async () => {
    const posts: Record<string, string>[] = [];
    renderRoute(<ExamSheet exam={base} />, posts, { ok: true, saved: true });

    await userEvent.click(screen.getByLabelText(/Its weights/));
    const essay = screen.getAllByRole("textbox")[0]!;
    expect(essay).toHaveAttribute("maxlength", "20000");
    await userEvent.type(essay, " more");

    await waitFor(() => expect(posts.some((p) => p.intent === "save")).toBe(true), { timeout: AUTOSAVE_MS + 2000 });
    const saved = JSON.parse(posts.find((p) => p.intent === "save")!.answers!) as { item_id: string; answer: string }[];
    expect(saved).toEqual([
      { item_id: "i1", answer: "B" },
      { item_id: "i2", answer: "Draft more" },
      { item_id: "i3", answer: "" },
    ]);

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Hand in and mark" }));
    expect(confirm).toHaveBeenCalledWith("1 question has no answer. Hand in anyway?");
    await waitFor(() => expect(posts.some((p) => p.intent === "submit")).toBe(true));
    confirm.mockRestore();
  });

  it("locks a handed-in exam whose marking stopped, and offers to mark the rest", () => {
    renderRoute(<ExamSheet exam={{ ...base, submitted_at: "2026-09-27T10:20:00Z", marked: 2 }} />, []);
    expect(screen.getByText(/Marking stopped after 2 of 3 answers/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark the rest" })).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")[0]).toBeDisabled();
  });
});

describe("ExamResult", () => {
  it("shows the score, the lateness, and what each answer earned and why", () => {
    const marked: ExamView = {
      ...base,
      status: "submitted",
      submitted_at: "2026-09-27T10:31:05Z",
      late: true,
      taken_seconds: 1865,
      score: 3.4,
      max_score: 7,
      marked: 3,
      items: [
        { ...base.items[0]!, answer: "A", score: 0, awarded: 0, correct: false, question: question("q1", "mcq", { revealed: true, answer: "B", explanation: "Weights. [[cite:chunk:c1]]" }), judge: { correct: false, mode: "exact" } },
        {
          ...base.items[1]!,
          score: 0.6,
          awarded: 2.4,
          correct: false,
          question: question("q2", "written", { revealed: true, answer: "Retrieval supplies facts." }),
          judge: {
            correct: false,
            mode: "rubric",
            reason: "The mechanism is missing.",
            score: 0.6,
            criteria: [
              { criterion: "Names the memory", points: 3, awarded: 2.4, comment: "Mostly there." },
              { criterion: "Explains why", points: 1, awarded: 0 },
            ],
          },
        },
        { ...base.items[2]!, answer: "true", score: 1, awarded: 1, correct: true, question: question("q3", "tf", { revealed: true, answer: "true" }), judge: { correct: true, mode: "exact" } },
      ],
      sources: [{ kind: "chunk", id: "c1", title: "RAG paper", page: 3, document_id: "doc-1" }],
    };
    renderRoute(<ExamResult exam={marked} />, []);

    expect(screen.getByText("3.4 of 7 marks")).toBeInTheDocument();
    expect(screen.getByText("Time taken 31:05 · limit 30 minutes")).toBeInTheDocument();
    expect(screen.getByText("Handed in after the time limit.")).toBeInTheDocument();
    expect(screen.getByText("No marks")).toBeInTheDocument();
    expect(screen.getByText("Part marks")).toBeInTheDocument();
    expect(screen.getByText("Full marks")).toBeInTheDocument();
    expect(screen.getByText("2.4 of 4 points")).toBeInTheDocument();
    expect(screen.getByText("Mostly there.")).toBeInTheDocument();
    expect(screen.getByText("The mechanism is missing.")).toBeInTheDocument();
    expect(screen.getByText(/2 answers are waiting in Practice/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Practise them" })).toHaveAttribute("href", "/quiz/practice");
    // The explanation's citation opens its page.
    expect(screen.getByRole("link", { name: /RAG paper/ })).toHaveAttribute("href", expect.stringContaining("doc-1"));
  });
});

describe("QuestionCard with a written question", () => {
  it("takes a long answer and shows the rubric's marking in the verdict", async () => {
    const essay = question("q9", "written");
    const verdict: AttemptResult = {
      attempt: {
        id: "a9",
        question_id: "q9",
        user_answer: "Banks hold reserves.",
        is_correct: false,
        score: 0.6,
        judge: {
          correct: false,
          mode: "rubric",
          reason: "The why is missing.",
          score: 0.6,
          criteria: [
            { criterion: "States what is held", points: 3, awarded: 3 },
            { criterion: "Says why", points: 2, awarded: 0, comment: "Not addressed." },
          ],
        },
        error_type: "concept",
        self_attribution: "",
        rating: "again",
        created_at: "2026-09-27T00:00:00Z",
      },
      answer: "Banks hold a share of deposits.",
      explanation: "",
      sources: [],
    };
    const router = createMemoryRouter(
      [
        { path: "/", element: <QuestionCard question={essay} /> },
        { path: "/quiz/questions/:questionId", action: async () => ({ result: verdict }) },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    expect(screen.getByText(/Written answer/)).toBeInTheDocument();
    const box = screen.getByLabelText("Your answer", { selector: "textarea" });
    expect(box).toHaveAttribute("maxlength", "20000");
    fireEvent.change(box, { target: { value: "Banks hold reserves." } });
    await userEvent.click(screen.getByRole("button", { name: "Check answer" }));

    expect(await screen.findByText("3 of 5 points")).toBeInTheDocument();
    expect(screen.getByText("Not addressed.")).toBeInTheDocument();
    expect(screen.getByText("Not quite")).toBeInTheDocument();
  });
});
