/**
 * life-kinds.test.tsx
 * up's life practice toolkit (up methods, phase 9, and f13ff2d's care card):
 * every life worksheet shows the private notice with up's warnings, the
 * recovery reset puts safety first, the Life group carries up's five "how to use" steps, and
 * Home counts a due private note without its title.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { ToolkitGroups } from "~/components/worksheet/toolkit-groups";
import { dueCounts, WorksheetsDue } from "~/components/worksheet/worksheets-due";
import type { DueReview, WorksheetDetail, WorksheetKind, WorksheetSection } from "~/lib/worksheet-types";

const { default: ToolkitWorksheet } = await import("~/routes/toolkit.$id");

beforeAll(() => {
  initI18n("en");
});

const section = (key: string, title: string): WorksheetSection => ({
  key,
  title,
  fields: [{ key: `${key}_line`, label: `${title} line`, type: "text" }],
});

// The five kinds as the API serves them, reduced to what the page reads.
// The recovery reset's sections are its real keys and order (kinds_life.go).
const lifeKind = (id: string, name: string, sections: WorksheetSection[]): WorksheetKind => ({
  kind: id, name, group: "life", source: "docs/en/templates/life-practice-toolkit.md", summary: `${name} summary`,
  private: true, attach: "none", version: 1, reviews: [], sections,
});

const LIFE: WorksheetKind[] = [
  lifeKind("choice_brief", "Choice brief", [section("problem", "The problem")]),
  lifeKind("attention_audit", "Attention audit", [section("week", "The week")]),
  lifeKind("relationship_card", "Relationship conversation card", [section("before", "Before the conversation"), section("after", "After the talk")]),
  lifeKind("recovery_reset", "Recovery reset", [
    section("safety", "Safety first"),
    section("body", "Body"),
    section("today", "Today"),
    section("support", "Support agreement"),
    section("return", "Gates before going back to work"),
  ]),
  lifeKind("life_weekly_review", "Weekly five questions", [section("questions", "This week")]),
  // The care card up added at f13ff2d (plans/261017-1828-up-f13ff2d-upgrade, phase 1).
  lifeKind("life_care_card", "Care and shared responsibility card", [
    section("person", "The person or the task"),
    section("carry", "What each of us carries"),
    section("next", "Next step decided together"),
    section("review", "Review"),
  ]),
];

const detail = (k: WorksheetKind): WorksheetDetail => ({
  worksheet: {
    id: "w1", kind: k.kind, kind_version: 1, title: "My private page", answers: {}, status: "open", private: true,
    reviews: {}, recordings: [], created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  },
  kind: k,
  earlier: [],
});

const Page = ToolkitWorksheet as unknown as (props: { loaderData: WorksheetDetail; actionData: undefined }) => ReactElement;

function renderAt(element: ReactElement) {
  const router = createMemoryRouter([{ path: "/", element }]);
  return render(<RouterProvider router={router} />);
}

describe("the private notice on a life worksheet", () => {
  it.each(LIFE.map((k) => [k.kind, k] as const))("%s shows up's warnings", (_, k) => {
    renderAt(<Page loaderData={detail(k)} actionData={undefined} />);
    const note = screen.getByRole("complementary", { name: "Private" });
    expect(note).toHaveTextContent("private record");
    expect(note).toHaveTextContent("not a daily score");
    for (const word of ["passwords", "ID numbers", "exact addresses", "medical records", "client data", "has not agreed"]) {
      expect(note).toHaveTextContent(word);
    }
    for (const word of ["immediate danger", "violence", "sleeplessness", "low mood", "debt", "legal", "qualified professional"]) {
      expect(note).toHaveTextContent(word);
    }
    expect(note).not.toHaveTextContent(/encrypt/i);
  });

  it("each kind with a chapter safety rule shows its own line, and only that one", () => {
    const lines = {
      choice_brief: "hard to undo",
      relationship_card: "Do not arrange a last talk alone",
      recovery_reset: "do not stay alone",
      life_care_card: "never means giving up your safety",
    };
    for (const k of LIFE) {
      const { unmount } = renderAt(<Page loaderData={detail(k)} actionData={undefined} />);
      const note = screen.getByRole("complementary", { name: "Private" });
      for (const [id, line] of Object.entries(lines)) {
        if (id === k.kind) expect(note).toHaveTextContent(line);
        else expect(note).not.toHaveTextContent(line);
      }
      unmount();
    }
  });

  it("the recovery reset puts safety first, in its notice and in its form", () => {
    renderAt(<Page loaderData={detail(LIFE[3]!)} actionData={undefined} />);
    const note = screen.getByRole("complementary", { name: "Private" });
    const paragraphs = within(note).getAllByText((_, el) => el?.tagName === "P").map((p) => p.textContent ?? "");
    expect(paragraphs[0]).toMatch(/immediate danger/);
    expect(paragraphs[1]).toMatch(/do not stay alone/);
    expect(paragraphs.findIndex((p) => p.includes("not a daily score"))).toBeGreaterThan(1);
    // Section headings are numbered as up numbers a worksheet's parts.
    const sections = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.replace(/^\d+\. /, ""));
    const safety = sections.indexOf("Safety first");
    expect(safety).toBeGreaterThanOrEqual(0);
    expect(sections.slice(safety, safety + 5)).toEqual(["Safety first", "Body", "Today", "Support agreement", "Gates before going back to work"]);
  });

  it("another kind keeps its warnings after the private record line", () => {
    renderAt(<Page loaderData={detail(LIFE[0]!)} actionData={undefined} />);
    const note = screen.getByRole("complementary", { name: "Private" });
    const paragraphs = within(note).getAllByText((_, el) => el?.tagName === "P").map((p) => p.textContent ?? "");
    expect(paragraphs[0]).toMatch(/not a daily score/);
  });
});

describe("/toolkit's Life group", () => {
  it("carries up's five steps for using the toolkit, and no other group does", () => {
    const language: WorksheetKind = { ...LIFE[0]!, kind: "lang", name: "Listening audit", group: "language", private: false };
    renderAt(<ToolkitGroups kinds={[language, ...LIFE]} list={[]} />);
    const life = screen.getByRole("region", { name: "Life" });
    expect(within(life).getByText("How to use these")).toBeInTheDocument();
    const steps = within(life).getAllByRole("listitem").filter((li) => li.closest("ol"));
    expect(steps).toHaveLength(5);
    expect(steps[0]).toHaveTextContent("Write the date");
    expect(steps[4]).toHaveTextContent("Delete what no longer helps");
    const lang = screen.getByRole("region", { name: "Language" });
    expect(within(lang).queryByText("How to use these")).toBeNull();
  });
});

describe("Home's due block", () => {
  const due: DueReview[] = [
    { id: "p1", kind: "recovery_reset", name: "Recovery reset", title: "Private note", private: true, review: "review", label: "Review date", due: "2026-10-01" },
    { id: "s1", kind: "vocabulary_audit", name: "Vocabulary evidence", title: "Week 3 words", private: false, review: "day_1", label: "Day 1 retest", due: "2026-10-01" },
  ];

  it("counts a due private note without a title, a kind or a name", () => {
    const counts = dueCounts({ due });
    expect(counts).toEqual({ count: 1, private: 1 });
    renderAt(<WorksheetsDue {...counts} />);
    const block = screen.getByRole("region", { name: "To revisit today" });
    expect(block).toHaveTextContent("1 private note to revisit.");
    expect(block).toHaveTextContent("1 worksheet review is due.");
    for (const leak of ["Private note", "Recovery reset", "Week 3 words", "Vocabulary evidence"]) {
      expect(block).not.toHaveTextContent(leak);
    }
  });

  it("a private worksheet with two due reviews is one note; private notes alone still show", () => {
    const two = [due[0]!, { ...due[0]!, review: "other" }];
    expect(dueCounts({ due: two })).toEqual({ count: 0, private: 1 });
    renderAt(<WorksheetsDue {...dueCounts({ due: [...two, { ...due[0]!, id: "p2" }] })} />);
    expect(screen.getByRole("region", { name: "To revisit today" })).toHaveTextContent("2 private notes to revisit.");
    expect(screen.queryByText(/worksheet review/)).toBeNull();
  });
  it("a care card due on its next review date is a private note, with no name or title", () => {
    const care: DueReview = {
      id: "c1", kind: "life_care_card", name: "Care and shared responsibility card", title: "Private note",
      private: true, review: "review", label: "Next review date", due: "2026-10-15",
    };
    renderAt(<WorksheetsDue {...dueCounts({ due: [care] })} />);
    const block = screen.getByRole("region", { name: "To revisit today" });
    expect(block).toHaveTextContent("1 private note to revisit.");
    for (const leak of ["Private note", "Care and shared responsibility card", "Next review date"]) {
      expect(block).not.toHaveTextContent(leak);
    }
  });
});
