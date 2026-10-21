/**
 * question-card-math.test.tsx
 * A maths answer on the shared question card (plans/261020-1535-beyond-
 * english-learning-areas, phase 2; ux/02-maths.md): a math field with its
 * hint, the flag that asks to be told about an unreadable answer, the
 * "couldn't read" alert with "Send as text", and the three outcomes worded
 * apart. MathLive does not load under jsdom: the plain box it starts as is
 * what is typed into here, which is also what a learner without it gets.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { QuestionCard } from "~/components/quiz/question-card";
import type { AttemptResult, Judgement, QuestionView } from "~/lib/study-types";

vi.mock("mathlive", () => {
  throw new Error("not in jsdom");
});

beforeAll(() => {
  initI18n("en");
});

const question: QuestionView = {
  id: "q1",
  kb_id: "kb1",
  prompt: "Factorise x^2 - 1.",
  type: "short",
  options: [],
  difficulty: "medium",
  source_chunk_ids: [],
  created_at: "2026-10-20T00:00:00Z",
  revealed: false,
  math: true,
};

function result(answer: string, judge: Judgement): AttemptResult {
  return {
    attempt: {
      id: "a1", question_id: "q1", user_answer: answer, is_correct: judge.correct, judge,
      error_type: "", self_attribution: "", rating: judge.almost ? "hard" : judge.correct ? "good" : "again",
      created_at: "2026-10-20T00:00:30Z",
    },
    answer: "(x-1)(x+1)",
    explanation: "",
    sources: [],
  };
}

function renderCard(reply: (body: Record<string, string>) => unknown, posts: Record<string, string>[]) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <QuestionCard question={question} /> },
      {
        path: "/quiz/questions/:questionId",
        action: async ({ request }) => {
          const body = Object.fromEntries(await request.formData()) as Record<string, string>;
          posts.push(body);
          return reply(body);
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

async function answer(text: string) {
  await userEvent.type(screen.getByLabelText("Your answer"), text);
  await userEvent.click(screen.getByRole("button", { name: "Check answer" }));
}

describe("a maths answer", () => {
  it("is typed as written, with a hint, and asks to be told if it cannot be read", async () => {
    const posts: Record<string, string>[] = [];
    renderCard(() => ({ result: result("(x+1)(x-1)", { correct: true, mode: "math" }) }), posts);
    expect(screen.getByLabelText("Your answer")).toHaveAccessibleDescription(/2\(x\+1\), x\^2/);
    await answer("(x+1)(x-1)");
    await screen.findByText("Correct");
    expect(posts[0]).toMatchObject({ intent: "attempt", user_answer: "(x+1)(x-1)", ask_if_unreadable: "1" });
    expect(screen.getByText("Your answer (x+1)(x-1) equals the recorded (x-1)(x+1).")).toBeInTheDocument();
  });

  it("says almost when it is equal but not in the form asked", async () => {
    renderCard(() => ({ result: result("x^2-1", { correct: true, mode: "math", almost: true }) }), []);
    await answer("x^2-1");
    await screen.findByText("Almost");
    expect(screen.getByText("Equal to the answer, but not in the form the question asks for.")).toBeInTheDocument();
  });

  it("says when the unit is not the one asked", async () => {
    renderCard(() => ({ result: result("5 m", { correct: true, mode: "math", almost: true, almost_why: "unit" }) }), []);
    await answer("5 m");
    expect(await screen.findByText("Equal to the answer, but not in the unit the question asks for.")).toBeInTheDocument();
  });

  it("says when the unit is missing", async () => {
    renderCard(() => ({ result: result("5", { correct: true, mode: "math", almost: true, almost_why: "no_unit" }) }), []);
    await answer("5");
    expect(await screen.findByText("The number is right, but the unit is missing.")).toBeInTheDocument();
  });

  it("says the value differs when it is wrong, without a model's reason", async () => {
    renderCard(() => ({ result: result("x^2+1", { correct: false, mode: "math", reason: "The value differs from the recorded answer." }) }), []);
    await answer("x^2+1");
    await screen.findByText("Not quite");
    expect(screen.getByText("The value differs from the recorded answer.")).toBeInTheDocument();
  });

  it("is not marked when it cannot be read, and can be sent as text", async () => {
    const posts: Record<string, string>[] = [];
    renderCard(
      (body) =>
        body.ask_if_unreadable === "1"
          ? { unreadable: { answer: body.user_answer, attribution: body.self_attribution } }
          : { result: result(body.user_answer ?? "", { correct: false, mode: "llm", reason: "Unbalanced brackets." }) },
      posts,
    );
    await answer("(x-1)(x+1");
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't read this as maths");
    // Nothing was marked: the form is still there, the answer kept.
    expect(screen.getByRole("button", { name: "Check answer" })).toBeEnabled();
    expect(screen.getByLabelText("Your answer")).toHaveValue("(x-1)(x+1");
    await userEvent.click(screen.getByRole("button", { name: "Send as text" }));
    await screen.findByText("Unbalanced brackets.");
    expect(posts[1]).toEqual({ intent: "attempt", user_answer: "(x-1)(x+1", self_attribution: "" });
  });
});
