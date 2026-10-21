/**
 * self-reflection.test.tsx
 * The self-reflection cards of up's part 6 (the private design notes,
 * phase 3): one private life worksheet whose notice carries the first
 * chapter's safety line, and whose cards each open with the chapter they
 * come from. A worksheet with one card written shows that card's words and
 * leaves the others empty.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import type { WorksheetDetail, WorksheetKind } from "~/lib/worksheet-types";

const { default: ToolkitWorksheet } = await import("~/routes/toolkit.$id");

beforeAll(() => {
  initI18n("en");
});

// Two of the eleven cards, as the API serves them (kinds_self_reflection.go).
const KIND: WorksheetKind = {
  kind: "self_reflection", name: "Self-reflection cards", group: "life",
  source: "docs/en/threads/part-6/ (…)", summary: "Eleven short cards", private: true, attach: "none", version: 1,
  reviews: [{ key: "retest", label: "Retest and decide", days: 0, from: { section: "hypothesis", field: "retest_on" } }],
  sections: [
    {
      key: "work_note", title: "A harsh thought, rewritten as a work note",
      hint: "From “Being kind to yourself”: replace a judgement about yourself with something you can act on.",
      fields: [
        { key: "fact", label: "Fact: what did I do, and where?", type: "text" },
        { key: "support", label: "Support: what condition, reminder or help would make next time go better?", type: "text" },
      ],
    },
    {
      key: "hypothesis", title: "A thirty-day experiment",
      hint: "From “Improving yourself”: test one change for thirty days against a starting sample, then decide what happens to it.",
      fields: [
        { key: "baseline", label: "Starting sample", type: "text" },
        { key: "retest_on", label: "Retest date", type: "date" },
        { key: "decision", label: "Decision on day thirty", type: "choice", options: ["continue", "transfer", "repair", "stop"] },
      ],
    },
  ],
};

const detail: WorksheetDetail = {
  worksheet: {
    id: "w1", kind: KIND.kind, kind_version: 1, title: "Private note", status: "open", private: true,
    answers: { work_note: { fact: "Skipped Tuesday's call" } },
    reviews: {}, recordings: [], created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  },
  kind: KIND,
  earlier: [],
};

const Page = ToolkitWorksheet as unknown as (props: { loaderData: WorksheetDetail; actionData: undefined }) => ReactElement;

function renderPage() {
  const router = createMemoryRouter([{ path: "/", element: <Page loaderData={detail} actionData={undefined} /> }]);
  return render(<RouterProvider router={router} />);
}

describe("the self-reflection cards", () => {
  it("show the private notice with the chapter's safety line, and no other kind's", () => {
    renderPage();
    const note = screen.getByRole("complementary", { name: "Private" });
    expect(note).toHaveTextContent("not a daily score");
    expect(note).toHaveTextContent("Nothing in this worksheet is ever sent to an AI model");
    expect(note).toHaveTextContent("mental-health professional");
    expect(note).not.toHaveTextContent("do not stay alone");
    expect(note).not.toHaveTextContent("hard to undo");
  });

  it("open each card with its chapter, and keep one written card's words", () => {
    renderPage();
    expect(screen.getByText(/^From “Being kind to yourself”:/)).toBeInTheDocument();
    expect(screen.getByText(/^From “Improving yourself”:/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Skipped Tuesday's call")).toBeInTheDocument();
    expect(screen.getByLabelText("Starting sample")).toHaveValue("");
    expect(screen.getByLabelText("Retest date")).toHaveAttribute("type", "date");
  });
});
