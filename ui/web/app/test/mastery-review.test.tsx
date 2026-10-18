/**
 * mastery-review.test.tsx
 *
 * The cross-path review (up-methods phase 12). The order is the server's; what
 * the page owes the learner is that the switch between subjects is visible —
 * every item names its path and module — and that an explain-back waiting on
 * a path is pointed to, not asked here. The way in is offered only when what
 * is due spans two or more paths.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ComponentProps, ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { duePathCount, ReviewAllLink } from "~/components/mastery/review-all-link";
import MasteryReview from "~/routes/mastery.review";
import type { NextQuestion } from "~/lib/study-types";

beforeAll(() => {
  initI18n("en");
});

function routed(element: ReactElement) {
  const router = createMemoryRouter([{ path: "/", element }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

const item = (over: Partial<NextQuestion> = {}): NextQuestion => ({
  kind: "question",
  question: {
    id: "q1",
    kb_id: "kb1",
    prompt: "Where does a model keep its parametric memory?",
    type: "short",
    options: [],
    difficulty: "easy",
    source_chunk_ids: [],
    created_at: "2026-10-16T00:00:00Z",
    revealed: false,
    knowledge_point_id: "kp1",
    module_id: "m1",
  },
  knowledge_point: { id: "kp1", module_id: "m1", name: "Parametric memory", type: "concept" },
  module_name: "Memory in RAG",
  path_id: "p1",
  path_goal: "Read RAG papers",
  due: true,
  generated: false,
  remaining_due: 3,
  ...over,
});

type Props = ComponentProps<typeof MasteryReview>;
const page = (loaderData: { next: NextQuestion | null; stopKey: string | null; stopDetail: string }) =>
  routed(<MasteryReview {...({ loaderData } as unknown as Props)} />);

describe("the cross-path review page", () => {
  it("names each item's path and module", async () => {
    page({ next: item(), stopKey: null, stopDetail: "" });
    // The first render of a route module is slow on a loaded machine.
    expect(await screen.findByTestId("review-path", {}, { timeout: 8000 })).toHaveTextContent("Read RAG papers");
    expect(screen.getByTestId("review-module")).toHaveTextContent("Memory in RAG");
    expect(screen.getByTestId("review-module")).toHaveTextContent("Parametric memory");
    expect(screen.getByText("Where does a model keep its parametric memory?")).toBeInTheDocument();
    expect(screen.getByText("3 more due after this")).toBeInTheDocument();
    expect(screen.queryByText(/explain-back is waiting/)).toBeNull();
  });

  it("points to an explain-back waiting on the item's path instead of asking it", async () => {
    page({ next: item({ explain_back_waiting: true }), stopKey: null, stopDetail: "" });
    expect(
      await screen.findByText("An explain-back is waiting in Read RAG papers.", { exact: false }, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open that path" })).toHaveAttribute("href", "/mastery/p1/session");
  });

  it("says when nothing is due on any path", async () => {
    page({ next: null, stopKey: "review.nothingDue", stopDetail: "" });
    expect(await screen.findByText(/Nothing is due on any path right now/, {}, { timeout: 8000 })).toBeInTheDocument();
  });
});

describe("Review everything due", () => {
  it("appears only when what is due spans two or more paths", async () => {
    const { unmount } = routed(<ReviewAllLink count={5} paths={2} />);
    expect(await screen.findByRole("link", { name: "Review everything due (5)" })).toHaveAttribute(
      "href",
      "/mastery/review",
    );
    unmount();

    // A marker beside the link, so "absent" is checked after the render.
    routed(
      <>
        <span>ready</span>
        <ReviewAllLink count={5} paths={1} />
      </>,
    );
    await screen.findByText("ready");
    expect(screen.queryByRole("link", { name: /Review everything due/ })).toBeNull();
  });

  it("is not offered with nothing due", async () => {
    routed(
      <>
        <span>ready</span>
        <ReviewAllLink count={0} paths={3} />
      </>,
    );
    await screen.findByText("ready");
    expect(screen.queryByRole("link", { name: /Review everything due/ })).toBeNull();
  });

  it("counts the distinct paths a due list spans", () => {
    expect(duePathCount([])).toBe(0);
    expect(duePathCount([{ path_id: "a" }, { path_id: "a" }])).toBe(1);
    expect(duePathCount([{ path_id: "a" }, { path_id: "b" }, { path_id: "a" }])).toBe(2);
  });
});
