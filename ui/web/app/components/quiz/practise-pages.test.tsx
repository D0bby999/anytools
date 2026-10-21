import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ComponentProps } from "react";
import { initI18n } from "~/lib/i18n";
import QuizBank from "~/routes/quiz.bank";
import { SessionProgress } from "~/components/mastery/session-progress";
import { ExamTimer } from "~/components/exam/exam-timer";
import { LookupSection } from "~/components/languages/lookup-section";

beforeAll(async () => { await initI18n("en"); });

describe("Practise document patterns", () => {
  it("expands a bank question below its metadata and keeps filters in the URL", async () => {
    const props = {
      loaderData: {
        kbs: [{ id: "kb1", name: "Biology" }], sources: [],
        entries: [{ question: {
          id: "q1", kb_id: "kb1", prompt: "Plants use sunlight", type: "tf", options: [],
          difficulty: "easy", source_chunk_ids: [], created_at: "2026-10-20T00:00:00Z", revealed: false,
        }, attempts: 0, kb_name: "Biology", module_name: "", knowledge_point_name: "" }],
      },
    } as unknown as ComponentProps<typeof QuizBank>;
    const router = createMemoryRouter([{ path: "/quiz/bank", element: <QuizBank {...props} /> }], {
      initialEntries: ["/quiz/bank?kb=kb1&type=tf"],
    });
    render(<RouterProvider router={router} />);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Last attempt" })).toBeInTheDocument();
    expect(screen.getByText("Open question").closest("details")).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("Open question"));
    expect(screen.getByText("Open question").closest("details")).toHaveAttribute("open");
    expect(within(table).getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByText(/Question 1 of 1/)).toBeInTheDocument();
    // Native controls remain successful form controls even when their flyout is closed.
    const form = screen.getByRole("button", { name: "Apply" }).closest("form")!;
    expect(new FormData(form).get("kb")).toBe("kb1");
    expect(new FormData(form).get("type")).toBe("tf");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(router.state.location.search).toContain("kb=kb1");
    expect(router.state.location.search).toContain("type=tf");
  });

  it("counts a new session card once and follows a changing due queue", () => {
    const { rerender } = render(<SessionProgress cardKey="q1" remaining={3} />);
    expect(screen.getByRole("meter", { name: "Card 1 of 4" })).toHaveAttribute("aria-valuenow", "25");
    rerender(<SessionProgress cardKey="q1" remaining={3} />);
    expect(screen.getByRole("meter", { name: "Card 1 of 4" })).toBeInTheDocument();
    rerender(<SessionProgress cardKey="q2" remaining={2} />);
    expect(screen.getByRole("meter", { name: "Card 2 of 4" })).toHaveAttribute("aria-valuenow", "50");
  });

  it("warns when fewer than five minutes remain on the server clock", () => {
    // A frozen clock: on a loaded machine a real second can pass between the
    // timer reading the time and this assertion, and the badge shows 3:59.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T01:00:00Z"));
    try {
      render(<ExamTimer deadline="2026-10-21T01:04:00Z" serverNow="2026-10-21T01:00:00Z" />);
      expect(screen.getByText(/4:00/).closest(".lp-badge")).toHaveAttribute("data-type", "warning");
    } finally {
      vi.useRealTimers();
    }
  });

  it("looks up a typed word using the existing language dictionary destinations", async () => {
    render(<LookupSection lang="ja" />);
    await userEvent.type(screen.getByLabelText("Word to look up"), "猫");
    expect(screen.getByRole("link", { name: "Jisho" })).toHaveAttribute("href", "https://jisho.org/search/%E7%8C%AB");
  });
});
