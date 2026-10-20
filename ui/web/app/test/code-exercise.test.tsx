/**
 * code-exercise.test.tsx
 * A code question on the shared card (plans/261020-1535-beyond-english-
 * learning-areas, phase 4; ux/04-code.md): runs are practice and send
 * nothing; a run where every declared test passes sends the attempt with
 * the results; after a failed run "Show a solution" sends it as not passed;
 * a stopped run says so; an answered card shows the verdict and no form.
 * Python itself is replaced: the harness runs in Pyodide, which jsdom has not.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import type { RunOutcome } from "~/lib/python-runner";

const python = vi.hoisted(() => ({ next: [] as RunOutcome[], calls: [] as { code: string; module: string }[] }));
vi.mock("~/lib/python-runner", () => ({
  HARD_STOP_MS: 30000,
  warmPython: () => undefined,
  pythonReady: () => true,
  onPythonProgress: () => () => undefined,
  stopPython: () => undefined,
  runPython: (code: string, _tests: string, module: string) => {
    python.calls.push({ code, module });
    return Promise.resolve(python.next.shift()!);
  },
}));
vi.mock("codemirror", () => {
  throw new Error("not in jsdom");
});

const { QuestionCard } = await import("~/components/quiz/question-card");
const { declaredTests, allPassed } = await import("~/components/quiz/code-exercise");
const { testLabel } = await import("~/lib/python-harness");
import type { AttemptResult, QuestionView } from "~/lib/study-types";

beforeAll(() => {
  initI18n("en");
});
beforeEach(() => {
  python.next = [];
  python.calls = [];
});

const tests = `import unittest

from leap import leap_year


class LeapTest(unittest.TestCase):
    def test_year_not_divisible_by_4(self):
        self.assertIs(leap_year(2015), False)

    def test_year_divisible_by_400(self):
        self.assertIs(leap_year(2000), True)
`;

const question: QuestionView = {
  id: "q1",
  kb_id: "kb1",
  prompt: "## Leap\n\nGiven a year, report if it is a **leap year**.",
  type: "code",
  options: [],
  difficulty: "easy",
  source_chunk_ids: [],
  created_at: "2026-10-20T00:00:00Z",
  revealed: false,
  code: { module: "leap", starter: "def leap_year(year):\n    pass\n", tests, credit: "Exercise from Exercism's Python track (MIT licence)" },
};

const pass = (name: string) => ({ name: `LeapTest.${name}`, passed: true, message: "" });
const fail = (name: string, message: string) => ({ name: `LeapTest.${name}`, passed: false, message });

function verdict(correct: boolean): AttemptResult {
  return {
    attempt: {
      id: "a1", question_id: "q1", user_answer: "def leap_year(y): ...", is_correct: correct,
      judge: { correct, mode: "tests", tests: correct ? [pass("test_year_not_divisible_by_4"), pass("test_year_divisible_by_400")] : [] },
      error_type: "", self_attribution: "", rating: correct ? "good" : "again", created_at: "2026-10-20T00:00:30Z",
    },
    answer: "def leap_year(year):\n    return year % 4 == 0",
    explanation: "",
    sources: [],
  };
}

function renderCard(posts: Record<string, string>[]) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <QuestionCard question={question} /> },
      {
        path: "/quiz/questions/:questionId",
        action: async ({ request }) => {
          const body = Object.fromEntries(await request.formData()) as Record<string, string>;
          posts.push(body);
          const results = JSON.parse(body.tests ?? "[]") as { passed: boolean }[];
          return { result: verdict(results.length > 0 && results.every((r) => r.passed)) };
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("a code exercise", () => {
  it("names its tests and reads them from the file", () => {
    expect(declaredTests(tests)).toEqual(["test_year_not_divisible_by_4", "test_year_divisible_by_400"]);
    expect(testLabel("LeapTest.test_year_divisible_by_400")).toBe("year divisible by 400");
    expect(allPassed({ error: "", output: "", results: [pass("test_year_not_divisible_by_4")] }, declaredTests(tests))).toBe(false);
  });

  it("sends nothing for a failing run, then offers the solution, which sends it as not passed", async () => {
    const posts: Record<string, string>[] = [];
    renderCard(posts);
    expect(screen.getByRole("heading", { name: "Leap" })).toBeInTheDocument();
    expect(screen.getByText(/Exercism's Python track/)).toBeInTheDocument();
    python.next.push({
      kind: "result",
      result: { error: "", output: "", results: [pass("test_year_not_divisible_by_4"), fail("test_year_divisible_by_400", "AssertionError: None is not True (line 11)")] },
    });
    await userEvent.click(screen.getByRole("button", { name: "Run the tests" }));
    expect(await screen.findByText("1 of 2 tests passed.")).toBeInTheDocument();
    expect(screen.getByText("AssertionError: None is not True (line 11)")).toBeInTheDocument();
    expect(python.calls[0]).toEqual({ code: question.code!.starter, module: "leap" });
    expect(posts).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Show a solution" }));
    await screen.findByText("Not quite");
    expect(posts[0]).toMatchObject({ intent: "attempt", user_answer: question.code!.starter });
    expect(JSON.parse(posts[0]!.tests!)).toHaveLength(2);
  });

  it("sends the attempt when every test passes, then shows the verdict and no form", async () => {
    const posts: Record<string, string>[] = [];
    renderCard(posts);
    python.next.push({ kind: "result", result: { error: "", output: "", results: [pass("test_year_not_divisible_by_4"), pass("test_year_divisible_by_400")] } });
    await userEvent.click(screen.getByRole("button", { name: "Run the tests" }));
    await screen.findByText("Correct");
    expect(posts).toHaveLength(1);
    expect(screen.getAllByText("2 of 2 tests passed.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Run the tests" })).toBeNull();
    expect(screen.queryByLabelText("Your answer")).toBeNull();
  });

  it("says when the code did not run, and when a run was stopped", async () => {
    renderCard([]);
    python.next.push({ kind: "result", result: { error: "SyntaxError: invalid syntax (line 1)", output: "", results: [] } });
    await userEvent.click(screen.getByRole("button", { name: "Run the tests" }));
    expect(await screen.findByText("SyntaxError: invalid syntax (line 1)")).toBeInTheDocument();
    python.next.push({ kind: "stopped", byTimeout: true });
    await userEvent.click(screen.getByRole("button", { name: "Run the tests" }));
    await waitFor(() => expect(screen.getByText("Stopped after 30 seconds. Is there a loop that never ends?")).toBeInTheDocument());
  });
});
