/**
 * worksheet-components.test.tsx
 * up's worksheets, rendered from a served kind: every field type appears as
 * the kind describes it, autosave posts exactly one section, a private kind
 * shows its notice, and /toolkit groups kinds as up does.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { WorksheetForm } from "~/components/worksheet/worksheet-form";
import { ToolkitGroups } from "~/components/worksheet/toolkit-groups";
import { nextReview } from "~/components/worksheet/worksheet-list";
import { sectionPayload } from "~/lib/worksheet-values";
import type { WorksheetDetail, WorksheetKind, WorksheetSummary } from "~/lib/worksheet-types";

const { default: ToolkitWorksheet } = await import("~/routes/toolkit.$id");

beforeAll(() => {
  initI18n("en");
});

// A kind invented for the test, with every field type: if the page shows
// these words, it renders what it was given rather than a copy of its own.
const kind: WorksheetKind = {
  kind: "test_sheet",
  name: "Test sheet",
  group: "language",
  source: "test",
  summary: "A kind that exists only in this test.",
  private: false,
  attach: "state",
  version: 1,
  reviews: [{ key: "day7", label: "Seventh-day retest", days: 7, from: {} }],
  sections: [
    {
      key: "boundary",
      title: "Where it starts",
      hint: "Write the task first.",
      fields: [
        { key: "task", label: "The task line", type: "text" },
        { key: "situation", label: "The situation prose", type: "long" },
        { key: "context", label: "The context choice", type: "choice", options: ["work", "study"], other: true },
        { key: "help", label: "The help used", type: "multi", options: ["dictionary", "captions"] },
        { key: "confidence", label: "The confidence score", type: "score", score_labels: ["none", "some", "alone"] },
        { key: "ready", label: "Ready gate", type: "yesno" },
        { key: "review_on", label: "The review date", type: "date" },
        { key: "saved", label: "First version saved", type: "check" },
      ],
    },
    {
      key: "retest",
      title: "The retest",
      fields: [
        {
          key: "timeline",
          label: "Timeline",
          type: "table",
          row_header: "When",
          rows: [
            { key: "day0", label: "Day zero" },
            { key: "day7", label: "Day seven" },
          ],
          columns: [
            { key: "removed", label: "What is removed", type: "label", text: { day0: "Nothing", day7: "Captions" } },
            { key: "barrier", label: "Barrier", type: "choice", row_options: { day0: ["sound", "speed"], day7: ["words", "layout"] } },
            { key: "result", label: "Result", type: "text" },
          ],
        },
      ],
    },
    {
      key: "log",
      title: "The log",
      fields: [
        {
          key: "entries",
          label: "Entries",
          type: "table",
          max_rows: 2,
          columns: [{ key: "note", label: "Note", type: "text" }],
        },
      ],
    },
  ],
};

function inRouter(el: ReactElement, onAction?: (form: FormData) => unknown) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: el,
      action: async ({ request }) => {
        const form = await request.formData();
        return onAction ? onAction(form) : null;
      },
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe("WorksheetForm", () => {
  it("renders every field type from the served kind", () => {
    inRouter(<WorksheetForm worksheetId="w1" kind={kind} answers={{}} revision="2026-10-01T00:00:00Z" />);
    for (const title of ["Where it starts", "The retest", "The log"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText("Write the task first.")).toBeInTheDocument();
    expect(screen.getByLabelText("The task line")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("The situation prose").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("The review date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("First version saved")).toHaveAttribute("type", "checkbox");
    // The choice offers up's options and "other".
    const context = screen.getByLabelText("The context choice");
    expect(within(context).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose…", "work", "study", "Other…"]);
    fireEvent.change(context, { target: { value: "__other" } });
    expect(screen.getByLabelText("Other")).toBeInTheDocument();
    expect(screen.getByLabelText("dictionary")).toHaveAttribute("type", "checkbox");
    // The score shows 0–2 with its anchors; the gate is yes or no.
    expect(screen.getByText("alone")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3 + 2);
    // The fixed table: up's row labels, the label column's text, per-row options.
    const table = screen.getByRole("table", { name: "Timeline" });
    expect(within(table).getByRole("rowheader", { name: "Day seven" })).toBeInTheDocument();
    expect(within(table).getByText("Captions")).toBeInTheDocument();
    const day7Barrier = within(table).getByLabelText("Day seven: Barrier");
    expect(within(day7Barrier).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose…", "words", "layout"]);
    // The free table adds rows up to its limit.
    const add = screen.getByRole("button", { name: "Add a row" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(add).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
  });

  it("autosaves one section on blur, with the page's revision", async () => {
    const posted: Record<string, string>[] = [];
    inRouter(
      <WorksheetForm
        worksheetId="w1"
        kind={kind}
        answers={{ boundary: { task: "old task" }, retest: { timeline: [{ row: "day0", cells: { result: "kept" } }] } }}
        revision="2026-10-01T00:00:00Z"
      />,
      (form) => {
        posted.push(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
        return { section: String(form.get("section")), ok: true, revision: "2026-10-01T00:00:01Z" };
      },
    );
    const task = screen.getByLabelText("The task line");
    // Focus moving away without a change sends nothing.
    fireEvent.blur(task);
    fireEvent.change(task, { target: { value: "new task" } });
    fireEvent.blur(task);
    await waitFor(() => expect(posted).toHaveLength(1));
    const sent = posted[0]!;
    expect(sent.intent).toBe("section");
    expect(sent.section).toBe("boundary");
    expect(sent.revision).toBe("2026-10-01T00:00:00Z");
    const values = JSON.parse(sent.values ?? "{}") as Record<string, unknown>;
    // Every field of this section, an empty one as null — and nothing else.
    expect(Object.keys(values).sort()).toEqual(
      ["confidence", "context", "help", "ready", "review_on", "saved", "situation", "task"].sort(),
    );
    expect(values.task).toBe("new task");
    expect(values.situation).toBeNull();
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

  it("reloads a section the server says was changed elsewhere", async () => {
    inRouter(
      <WorksheetForm worksheetId="w1" kind={kind} answers={{ boundary: { task: "mine" } }} revision="2026-10-01T00:00:00Z" />,
      (form) => ({
        section: String(form.get("section")),
        conflict: true,
        values: { task: "theirs" },
        revision: "2026-10-01T00:00:05Z",
      }),
    );
    const task = screen.getByLabelText("The task line");
    fireEvent.change(task, { target: { value: "mine, edited" } });
    fireEvent.blur(task);
    await waitFor(() => expect(screen.getByLabelText("The task line")).toHaveValue("theirs"));
    expect(screen.getByRole("alert")).toHaveTextContent("changed somewhere else");
  });
});

describe("sectionPayload", () => {
  it("sends a fixed table's filled rows only, and a free table's rows in order", () => {
    const retest = kind.sections[1]!;
    expect(
      sectionPayload(retest, {
        timeline: [
          { row: "day0", cells: { result: "done", removed: "never sent" } },
          { row: "day7", cells: { result: "  " } },
        ],
      }),
    ).toEqual({ timeline: [{ row: "day0", cells: { result: "done" } }] });
    expect(sectionPayload(retest, { timeline: [{ row: "day7", cells: {} }] })).toEqual({ timeline: null });
  });

  it("keeps false and 0, which are answers", () => {
    const out = sectionPayload(kind.sections[0]!, { ready: false, confidence: 0, task: "  t  " });
    expect(out.ready).toBe(false);
    expect(out.confidence).toBe(0);
    expect(out.task).toBe("t");
  });
});

const detail = (over: Partial<WorksheetKind>): WorksheetDetail => ({
  worksheet: {
    id: "w1", kind: "test_sheet", kind_version: 1, title: "My sheet", answers: { boundary: { gone: "old" } },
    status: "open", private: Boolean(over.private), reviews: {}, recordings: [], created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  kind: { ...kind, ...over },
  earlier: ["boundary.gone"],
});

// The route component, given its loader's data the way the framework would.
const Page = ToolkitWorksheet as unknown as (props: { loaderData: WorksheetDetail; actionData: undefined }) => ReactElement;

function renderPage(d: WorksheetDetail) {
  const router = createMemoryRouter([{ path: "/", element: <Page loaderData={d} actionData={undefined} /> }]);
  return render(<RouterProvider router={router} />);
}

describe("the worksheet page", () => {
  it("a private kind shows the private notice", () => {
    renderPage(detail({ private: true }));
    const note = screen.getByRole("complementary", { name: "Private" });
    expect(note).toHaveTextContent("ever sent to an AI model");
    expect(note).toHaveTextContent("passwords");
  });

  it("a public kind shows none, and keys from an earlier version are shown read-only", () => {
    renderPage(detail({ private: false }));
    expect(screen.queryByRole("complementary", { name: "Private" })).toBeNull();
    expect(screen.getByRole("heading", { name: "From an earlier version" })).toBeInTheDocument();
    expect(screen.getByText("boundary.gone")).toBeInTheDocument();
    expect(screen.getByText('"old"')).toBeInTheDocument();
    // An event-free review is scheduled from creation; this one has no date yet.
    expect(screen.getByText("Seventh-day retest")).toBeInTheDocument();
    expect(screen.getByText(/Not scheduled yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download as Markdown" })).toHaveAttribute("href", "/toolkit/w1/export.md");
  });
});

describe("/toolkit", () => {
  const k = (id: string, group: WorksheetKind["group"], name: string, priv = false): WorksheetKind => ({
    ...kind, kind: id, group, name, private: priv, summary: `${name} summary`,
  });

  it("groups kinds as up does — language, projects, life — with each kind's worksheets", () => {
    const list: WorksheetSummary[] = [
      { id: "a", kind: "life1", title: "My recovery", status: "open", private: true, reviews: {}, updated_at: "" },
    ];
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <ToolkitGroups
            kinds={[k("life1", "life", "Recovery reset", true), k("proj1", "projects", "Artifact brief"), k("lang1", "language", "Listening audit")]}
            list={list}
          />
        ),
      },
    ]);
    render(<RouterProvider router={router} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Language", "Projects", "Life"]);
    const life = screen.getByRole("region", { name: "Life" });
    expect(within(life).getByText("Private")).toBeInTheDocument();
    expect(within(life).getByRole("link", { name: /My recovery/ })).toHaveAttribute("href", "/toolkit/a");
    expect(within(life).getByRole("link", { name: "New Recovery reset" })).toHaveAttribute("href", "/toolkit/new?kind=life1");
  });

  it("says so when no kind is served", () => {
    const router = createMemoryRouter([{ path: "/", element: <ToolkitGroups kinds={[]} list={[]} /> }]);
    render(<RouterProvider router={router} />);
    expect(screen.getByText("No worksheets are available yet.")).toBeInTheDocument();
  });

  it("the next review is the earliest one not done", () => {
    expect(
      nextReview({
        reviews: {
          a: { due: "2026-10-20", earliest: "2026-10-20" },
          b: { due: "2026-10-09", earliest: "2026-10-09", done: true },
          c: { due: "2026-10-12", earliest: "2026-10-12" },
        },
      }),
    ).toBe("2026-10-12");
  });
});
