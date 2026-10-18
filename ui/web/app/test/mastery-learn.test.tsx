/**
 * mastery-learn.test.tsx
 *
 * The session's learn and explain-back cards (learning-depth phase 2). What
 * they must always do is make the model's text checkable — every citation is
 * a chip that opens its page — and keep the learner's dispute honest: offered
 * only once there is a verdict to dispute, and shown as the learner's own.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { LearnCard } from "~/components/mastery/learn-card";
import { ExplainBackCard } from "~/components/mastery/explain-back-card";
import type { ExplainBackResult, Explanation, ExplainVerdict } from "~/lib/study-types";

beforeAll(() => {
  initI18n("en");
});

const source = { kind: "chunk", id: "c1", title: "RAG paper", page: 3, document_id: "doc-1" };

const explanation: Explanation = {
  id: "x1",
  knowledge_point_id: "kp1",
  model: "fake-1",
  variant: 0,
  body_md: "Parametric memory lives in the model's weights. [[cite:chunk:c1]]",
  sources: [source],
  stale: false,
  cached: true,
  created_at: "2026-09-27T00:00:00Z",
};

function verdict(kind: ExplainVerdict, override?: boolean): ExplainBackResult {
  return {
    attempt: {
      id: "e1",
      knowledge_point_id: "kp1",
      path_id: "p1",
      request_id: "r1",
      explanation: "It is what the model memorised.",
      verdict: kind,
      passed: kind === "passed",
      gaps: kind === "failed" ? ["You did not say where it is stored. [[cite:chunk:c1]]"] : [],
      misconceptions: kind === "failed" ? ["It is not the retrieved text."] : [],
      feedback: kind === "unjudged" ? "Your model's verdict could not be read." : "Say where it lives.",
      sources: kind === "unjudged" ? [] : [source],
      ...(override === undefined ? {} : { override_passed: override, overridden_at: "2026-09-27T00:02:00Z" }),
      created_at: "2026-09-27T00:01:00Z",
    },
    graduated: [],
    replayed: false,
  };
}

/** Renders a card with the resource route it posts to, recording each post. */
function renderWithRoute(element: ReactElement, posts: Record<string, string>[], reply: (body: Record<string, string>) => unknown) {
  const router = createMemoryRouter(
    [
      { path: "/", element },
      {
        path: "/mastery/points/:pointId",
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

describe("LearnCard", () => {
  it("renders the explanation with citations that open their page", () => {
    renderWithRoute(<LearnCard pointId="kp1" pointName="Parametric memory" explanation={explanation} />, [], () => null);
    expect(screen.getByText(/lives in the model's weights/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open RAG paper, page 3" })).toHaveAttribute("href", "/documents/doc-1?page=3");
    expect(screen.queryByText(/Sources changed/)).toBeNull();
  });

  it("asks for the next angle when told to explain it differently", async () => {
    const posts: Record<string, string>[] = [];
    renderWithRoute(
      <LearnCard pointId="kp1" pointName="Parametric memory" explanation={explanation} />,
      posts,
      () => ({ explanation: { ...explanation, variant: 1, body_md: "Think of a library you memorised. [[cite:chunk:c1]]" } }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Explain it differently" }));
    await screen.findByText(/library you memorised/);
    expect(posts[0]).toMatchObject({ intent: "learn", variant: "1", refresh: "false" });
  });

  it("flags a stale explanation and rewrites it only when asked", async () => {
    const posts: Record<string, string>[] = [];
    renderWithRoute(
      <LearnCard pointId="kp1" pointName="Parametric memory" explanation={{ ...explanation, stale: true }} />,
      posts,
      () => ({ explanation }),
    );
    expect(screen.getByText(/Sources changed/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Rewrite it from the current sources" }));
    await waitFor(() => expect(screen.queryByText(/Sources changed/)).toBeNull());
    expect(posts[0]).toMatchObject({ intent: "learn", variant: "0", refresh: "true" });
  });
});

describe("ExplainBackCard", () => {
  const card = (onContinue?: () => void) => (
    <ExplainBackCard
      pointId="kp1"
      pointName="Parametric memory"
      prompt="Explain it in your own words."
      onContinue={onContinue}
    />
  );
  const longEnough = "It is what the model memorised in training.";

  it("offers no dispute before there is a verdict, and needs 20 characters", async () => {
    renderWithRoute(card(), [], () => null);
    expect(screen.queryByRole("button", { name: /Judged wrong/ })).toBeNull();
    const submit = screen.getByRole("button", { name: "Check my explanation" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Your explanation"), "too short");
    expect(submit).toBeDisabled();
  });

  it("shows the verdict with its gaps cited, then records a dispute as the learner's", async () => {
    const posts: Record<string, string>[] = [];
    renderWithRoute(card(), posts, (body) => ({ verdict: body.intent === "override" ? verdict("failed", true) : verdict("failed") }));

    await userEvent.type(screen.getByLabelText("Your explanation"), longEnough);
    await userEvent.click(screen.getByRole("button", { name: "Check my explanation" }));

    await screen.findByText("Not yet — there are gaps");
    expect(posts[0]).toMatchObject({ intent: "explain", text: longEnough });
    expect(posts[0]?.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText(/did not say where it is stored/)).toBeInTheDocument();
    expect(screen.getByText(/not the retrieved text/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open RAG paper, page 3" })).toHaveAttribute("href", "/documents/doc-1?page=3");

    await userEvent.click(screen.getByRole("button", { name: /Judged wrong/ }));
    await screen.findByText(/counted as explained, on your word/);
    expect(posts[1]).toMatchObject({ intent: "override", attemptId: "e1" });
    // The judge's verdict stays on screen; the learner's sits beside it.
    expect(screen.getByText("Not yet — there are gaps")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Judged wrong/ })).toBeNull());
  });

  it("offers no dispute for a reply that could not be judged", async () => {
    renderWithRoute(card(), [], () => ({ verdict: verdict("unjudged") }));
    await userEvent.type(screen.getByLabelText("Your explanation"), longEnough);
    await userEvent.click(screen.getByRole("button", { name: "Check my explanation" }));
    await screen.findByText("This explanation could not be judged");
    expect(screen.queryByRole("button", { name: /Judged wrong/ })).toBeNull();
  });

  it("starts a new request id for a new try", async () => {
    const posts: Record<string, string>[] = [];
    renderWithRoute(card(), posts, () => ({ verdict: verdict("failed") }));
    await userEvent.type(screen.getByLabelText("Your explanation"), longEnough);
    await userEvent.click(screen.getByRole("button", { name: "Check my explanation" }));
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await userEvent.type(screen.getByLabelText("Your explanation"), " Stored in the weights.");
    await userEvent.click(screen.getByRole("button", { name: "Check my explanation" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]?.request_id).not.toEqual(posts[0]?.request_id);
  });
});
