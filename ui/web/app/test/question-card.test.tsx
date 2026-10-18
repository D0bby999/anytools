/**
 * question-card.test.tsx
 *
 * The card every quiz surface shares. What it must never do is show the answer
 * before the learner has committed to one; what it must always do is make the
 * explanation checkable — its citations open the page they came from.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { QuestionCard } from "~/components/quiz/question-card";
import type { AttemptResult, QuestionView } from "~/lib/study-types";

beforeAll(() => {
  initI18n("en");
});

const mcq: QuestionView = {
  id: "q1",
  kb_id: "kb1",
  prompt: "Where does a RAG model keep its parametric memory?",
  type: "mcq",
  options: [
    { label: "A", body: "In the retrieved passages" },
    { label: "B", body: "In the model's weights" },
  ],
  difficulty: "easy",
  source_chunk_ids: ["c1"],
  created_at: "2026-09-25T00:00:00Z",
  revealed: false,
};

function result(correct: boolean, overridden = false): AttemptResult {
  return {
    attempt: {
      id: "a1",
      question_id: "q1",
      user_answer: correct ? "B" : "A",
      is_correct: correct,
      judge: { correct, mode: overridden ? "user" : "exact" },
      error_type: correct ? "" : "unknown",
      self_attribution: overridden ? "disputed" : "",
      rating: correct ? "good" : "again",
      ...(overridden ? { overridden_at: "2026-09-25T00:01:00Z" } : {}),
      created_at: "2026-09-25T00:00:30Z",
    },
    answer: "B",
    explanation: "Parametric memory lives in the weights. [[cite:chunk:c1]]",
    scheduled: { knowledge_point_id: "kp1", due_at: "2026-09-25T00:10:00Z", mastery_estimate: 0, rating: "again", lapses: 1 },
    sources: [{ kind: "chunk", id: "c1", title: "RAG paper", page: 3, document_id: "doc-1" }],
  };
}

/** Renders the card with the resource route it posts to, recording each post. */
function renderCard(question: QuestionView, posts: Record<string, string>[]) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <QuestionCard question={question} sources={result(true).sources} /> },
      {
        path: "/quiz/questions/:questionId",
        action: async ({ request }) => {
          const body = Object.fromEntries(await request.formData()) as Record<string, string>;
          posts.push(body);
          if (body.intent === "override") return { result: result(body.isCorrect === "true", true) };
          return { result: result(body.user_answer === "B") };
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("QuestionCard", () => {
  it("does not render an answer before the learner commits to one", () => {
    renderCard(mcq, []);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByText(/Answer:/)).toBeNull();
    expect(screen.getByRole("button", { name: "Check answer" })).toBeInTheDocument();
  });

  it("posts the answer, then shows the verdict with a citation that opens its page", async () => {
    const posts: Record<string, string>[] = [];
    renderCard(mcq, posts);

    await userEvent.click(screen.getByLabelText(/In the retrieved passages/));
    await userEvent.click(screen.getByRole("button", { name: "Check answer" }));

    await screen.findByText("Not quite");
    expect(posts[0]).toMatchObject({ intent: "attempt", user_answer: "A" });
    expect(screen.getByText(/B\. In the model's weights/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open RAG paper, page 3" })).toHaveAttribute(
      "href",
      "/documents/doc-1?page=3",
    );
    // The form is spent: a second submit cannot record a second attempt.
    expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
  });

  it("lets the learner overrule the marking, once", async () => {
    const posts: Record<string, string>[] = [];
    renderCard(mcq, posts);

    await userEvent.click(screen.getByLabelText(/In the retrieved passages/));
    await userEvent.click(screen.getByRole("button", { name: "Check answer" }));
    await userEvent.click(await screen.findByRole("button", { name: "I was right — count it" }));

    await screen.findByText(/you corrected the marking/);
    expect(posts[1]).toMatchObject({ intent: "override", attemptId: "a1", isCorrect: "true" });
    await waitFor(() => expect(screen.queryByRole("button", { name: /count/ })).toBeNull());
  });

  it("shows a previously answered question's answer and explanation without a form", () => {
    renderCard({ ...mcq, revealed: true, answer: "B", explanation: "See [[cite:chunk:c1]]" }, []);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/B\. In the model's weights/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open RAG paper, page 3" })).toBeInTheDocument();
  });
});
