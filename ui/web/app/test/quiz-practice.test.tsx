/**
 * quiz-practice.test.tsx
 *
 * Practise your mistakes: an empty queue says what practice is, and a queue is
 * walked one unrevealed question at a time with an "N left" counter that goes
 * down as the learner moves on.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import type { PracticeItem, QuestionView } from "~/lib/study-types";

vi.mock("~/lib/auth.server", () => ({}));
vi.mock("~/lib/quiz.server", () => ({}));
const { default: QuizPractice, shouldRevalidate } = await import("~/routes/quiz.practice");

beforeAll(() => {
  initI18n("en");
});

function question(id: string, prompt: string): QuestionView {
  return {
    id,
    kb_id: "kb1",
    prompt,
    type: "tf",
    options: [],
    difficulty: "easy",
    source_chunk_ids: [],
    created_at: "2026-09-25T00:00:00Z",
    revealed: false,
  };
}

function item(id: string, prompt: string, status: PracticeItem["status"], misses = 1): PracticeItem {
  return { question: question(id, prompt), status, opened_at: "2026-09-25T00:00:00Z", misses, kb_name: "Biology" };
}

function renderPractice(items: PracticeItem[], remaining: number) {
  const Page = QuizPractice as unknown as (props: { loaderData: unknown }) => React.ReactElement;
  const router = createMemoryRouter(
    [
      { path: "/quiz/practice", element: <Page loaderData={{ items, remaining }} /> },
      {
        path: "/quiz/questions/:questionId",
        action: async () => ({
          result: {
            attempt: {
              id: "a1", question_id: "q1", user_answer: "true", is_correct: true,
              judge: { correct: true, mode: "exact" }, error_type: "", self_attribution: "",
              rating: "good", created_at: "2026-09-25T00:00:30Z",
            },
            answer: "true",
            explanation: "",
            sources: [],
          },
        }),
      },
    ],
    { initialEntries: ["/quiz/practice"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("practice", () => {
  it("explains practice when nothing is waiting", () => {
    renderPractice([], 0);
    expect(screen.getByText(/Nothing to practise/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the question bank" })).toHaveAttribute("href", "/quiz/bank");
  });

  it("walks the queue one unrevealed question at a time, counting down", async () => {
    renderPractice([item("q1", "Cells have walls", "retrying", 2), item("q2", "Mitochondria make ATP", "review")], 5);

    expect(screen.getByText("5 left")).toBeInTheDocument();
    expect(screen.getByText(/wrong 2 times/)).toBeInTheDocument();
    expect(screen.getByText("Cells have walls")).toBeInTheDocument();
    expect(screen.queryByText("Mitochondria make ATP")).toBeNull();
    expect(screen.queryByText(/Answer:/)).toBeNull();

    await userEvent.click(screen.getAllByRole("radio")[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await userEvent.click(await screen.findByRole("button", { name: "Next question" }));

    expect(screen.getByText("4 left")).toBeInTheDocument();
    expect(screen.getByText("Mitochondria make ATP")).toBeInTheDocument();
    expect(screen.getByText(/right once/)).toBeInTheDocument();
  });

  it("keeps the queue while the learner reads a verdict, and reloads it on request", () => {
    const args = (formAction?: string) =>
      ({ formAction, defaultShouldRevalidate: true }) as unknown as Parameters<typeof shouldRevalidate>[0];
    // An answer leaves the queue once marked; reloading would take the card
    // and its verdict off the screen.
    expect(shouldRevalidate(args("/quiz/questions/q1"))).toBe(false);
    // "Check for more" (a plain revalidation) and other forms reload it.
    expect(shouldRevalidate(args())).toBe(true);
    expect(shouldRevalidate(args("/settings/account"))).toBe(true);
  });
});
