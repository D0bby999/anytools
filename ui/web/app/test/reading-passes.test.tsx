/**
 * reading-passes.test.tsx
 * "Read in five passes" in the reader (up-methods phase 5): the current pass
 * is the first not done and moves on when one is marked done; at pass 4 the
 * document and the tutor are put away and come back once it is done; "Mark a
 * barrier" adds a row with the page and the selected text, and a barrier
 * asks for its layer, whose next step then shows.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { useState } from "react";
import { initI18n } from "~/lib/i18n";
import { ClosedForRebuild, ReadingPasses } from "~/components/reading/reading-passes";
import { SelectionToolbar } from "~/components/reading/selection-toolbar";
import { VOCABULARY_LAYER, barrierRow, barrierWord, clipLine, closedForRebuild } from "~/lib/reading-passes";
import type { TableRow, WorksheetDetail, WorksheetKind } from "~/lib/worksheet-types";

beforeAll(() => {
  initI18n("en");
});

// The parts of the served kind the panel reads, with this test's own words:
// the panel shows what it is given.
const kind: WorksheetKind = {
  kind: "reading_evidence",
  name: "Reading evidence",
  group: "language",
  source: "test",
  summary: "",
  private: false,
  attach: "document",
  version: 1,
  sections: [
    {
      key: "passes",
      title: "Five passes",
      added: true,
      fields: [
        {
          key: "passes",
          label: "Passes",
          type: "table",
          row_header: "Pass",
          rows: [
            { key: "orient", label: "First: orient" },
            { key: "structure", label: "Second: structure" },
            { key: "evidence", label: "Third: evidence" },
            { key: "rebuild", label: "Fourth: rebuild" },
            { key: "task", label: "Fifth: task" },
          ],
          columns: [
            {
              key: "job",
              label: "Job",
              type: "label",
              text: { orient: "Job one", structure: "Job two", evidence: "Job three", rebuild: "Job four", task: "Job five" },
            },
            { key: "output", label: "Output", type: "long" },
            { key: "done", label: "Done", type: "yesno" },
          ],
        },
      ],
    },
    {
      key: "barriers",
      title: "Barrier map",
      fields: [
        {
          key: "map",
          label: "Barriers",
          type: "table",
          max_rows: 30,
          columns: [
            { key: "page", label: "Paragraph or page", type: "text" },
            { key: "stuck", label: "Where I got stuck", type: "text" },
            {
              key: "layer",
              label: "Barrier layer",
              type: "choice",
              options: ["layer one", "layer two"],
              option_hints: { "layer one": "Next step for layer one", "layer two": "Next step for layer two" },
            },
          ],
        },
      ],
    },
  ],
};

function sheetWith(answers: WorksheetDetail["worksheet"]["answers"]): WorksheetDetail {
  return {
    kind,
    earlier: [],
    worksheet: {
      id: "ws-1",
      kind: "reading_evidence",
      kind_version: 1,
      title: "Reading: paper.pdf",
      answers,
      document_id: "doc-1",
      status: "open",
      private: false,
      reviews: {},
      recordings: [],
      created_at: "2026-10-16T08:00:00Z",
      updated_at: "2026-10-16T08:00:00Z",
    },
  };
}

type Save = (section: string, rows: TableRow[], revision: string) => void;

/**
 * The reader as the route lays it out: the document and the tutor, closed at
 * pass 4. A save lands in the sheet as the loader's next read would.
 */
function Reader({ initial, onSave }: { initial: WorksheetDetail; onSave?: Save }) {
  const [sheet, setSheet] = useState(initial);
  const closed = closedForRebuild(sheet);
  const field = (section: string) => (section === "passes" ? "passes" : "map");
  return (
    <div>
      {closed ? <ClosedForRebuild /> : <article>The document text</article>}
      <ReadingPasses
        sheet={sheet}
        busy={false}
        onStart={() => {}}
        onSave={(section, rows, revision) => {
          onSave?.(section, rows, revision);
          setSheet((s) => ({
            ...s,
            worksheet: { ...s.worksheet, answers: { ...s.worksheet.answers, [section]: { [field(section)]: rows } } },
          }));
        }}
      />
      {closed ? null : <p>The tutor pane</p>}
    </div>
  );
}

function renderInRouter(element: React.ReactElement) {
  const router = createMemoryRouter([{ path: "/", element }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

function markDone(output: string) {
  fireEvent.change(screen.getByLabelText("Output"), { target: { value: output } });
  fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
}

describe("the current pass", () => {
  it("is the first not done, and moves on when it is marked done", () => {
    const onSave = vi.fn<Save>();
    renderInRouter(<Reader initial={sheetWith({})} onSave={onSave} />);
    expect(screen.getByText("Pass 1 of 5")).toBeTruthy();
    expect(screen.getByText("First: orient")).toBeTruthy();
    expect(screen.getByText("Job one")).toBeTruthy();

    markDone("The gist in one line");
    expect(onSave).toHaveBeenCalledWith(
      "passes",
      [{ row: "orient", cells: { output: "The gist in one line", done: true } }],
      "2026-10-16T08:00:00Z",
    );
    expect(screen.getByText("Pass 2 of 5")).toBeTruthy();
    expect(screen.getByText("Job two")).toBeTruthy();
    expect((screen.getByLabelText("Output") as HTMLTextAreaElement).value).toBe("");
  });

  it("starts where the stored passes left off, and says when all are done", () => {
    const done = (row: string) => ({ row, cells: { output: "x", done: true } });
    const { unmount } = renderInRouter(
      <Reader initial={sheetWith({ passes: { passes: [done("orient"), done("structure")] } })} />,
    );
    expect(screen.getByText("Pass 3 of 5")).toBeTruthy();
    unmount();
    renderInRouter(
      <Reader
        initial={sheetWith({
          passes: { passes: ["orient", "structure", "evidence", "rebuild", "task"].map(done) },
        })}
      />,
    );
    expect(screen.queryByLabelText("Output")).toBeNull();
    expect(screen.getByText(/All five passes are done/)).toBeTruthy();
  });

  it("offers to start when the document has no card yet", () => {
    const onStart = vi.fn();
    renderInRouter(<ReadingPasses sheet={null} busy={false} onStart={onStart} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Read in five passes" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

describe("pass 4: tools closed", () => {
  it("hides the document and the tutor while the learner rebuilds, and brings them back after", () => {
    renderInRouter(<Reader initial={sheetWith({})} />);
    markDone("one");
    markDone("two");
    expect(screen.getByText("The document text")).toBeTruthy();
    markDone("three");

    expect(screen.getByText("Pass 4 of 5")).toBeTruthy();
    expect(screen.queryByText("The document text")).toBeNull();
    expect(screen.queryByText("The tutor pane")).toBeNull();
    expect(screen.getByText("Pass 4: tools closed")).toBeTruthy();

    markDone("Problem, claim, evidence, limit, next action.");
    expect(screen.getByText("Pass 5 of 5")).toBeTruthy();
    expect(screen.getByText("The document text")).toBeTruthy();
    expect(screen.getByText("The tutor pane")).toBeTruthy();
  });

  it("is a page rule only: a finished card closes nothing", () => {
    const at4 = sheetWith({
      passes: { passes: ["orient", "structure", "evidence"].map((row) => ({ row, cells: { done: true } })) },
    });
    expect(closedForRebuild(at4)).toBe(true);
    expect(closedForRebuild({ ...at4, worksheet: { ...at4.worksheet, status: "done" } })).toBe(false);
    expect(closedForRebuild(null)).toBe(false);
  });
});

describe("Mark a barrier", () => {
  it("is on the selection toolbar when the card applies", () => {
    const onMarkBarrier = vi.fn();
    render(
      <SelectionToolbar
        selection={{ text: "the second clause", page: 4 }}
        busy
        onAction={() => {}}
        onHighlight={() => {}}
        onSave={() => {}}
        onDismiss={() => {}}
        onMarkBarrier={onMarkBarrier}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark a barrier" }));
    expect(onMarkBarrier).toHaveBeenCalledTimes(1);
  });

  it("is absent where the card does not apply", () => {
    render(
      <SelectionToolbar
        selection={{ text: "x", page: 1 }}
        busy={false}
        onAction={() => {}}
        onHighlight={() => {}}
        onSave={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Mark a barrier" })).toBeNull();
  });

  it("makes a row with the page and the selected text, on one line and within the limit", () => {
    expect(barrierRow("  the  second\nclause ", 4)).toEqual({ row: "", cells: { page: "4", stuck: "the second clause" } });
    expect(barrierRow("no page", 0)).toEqual({ row: "", cells: { stuck: "no page" } });
    const long = clipLine("é".repeat(600));
    expect(Array.from(long)).toHaveLength(500);
    expect(long.endsWith("…")).toBe(true);
  });

  it("asks for the layer, and the chosen layer shows its next step", () => {
    const onSave = vi.fn<Save>();
    renderInRouter(
      <Reader
        initial={sheetWith({
          barriers: {
            map: [
              { row: "", cells: { page: "2", stuck: "an older one", layer: "layer two" } },
              { row: "", cells: { page: "4", stuck: "the second clause" } },
            ],
          },
        })}
        onSave={onSave}
      />,
    );
    const items = screen.getAllByRole("listitem");
    // Newest first: the barrier just marked asks for its layer.
    const newest = items[0]!;
    expect(within(newest).getByText("the second clause")).toBeTruthy();
    expect(within(newest).getByText("Which layer is this barrier?")).toBeTruthy();
    expect(within(items[1]!).getByText("Next step for layer two")).toBeTruthy();

    fireEvent.change(within(newest).getByRole("combobox"), { target: { value: "layer one" } });
    expect(onSave).toHaveBeenCalledWith(
      "barriers",
      [
        { row: "", cells: { page: "2", stuck: "an older one", layer: "layer two" } },
        { row: "", cells: { page: "4", stuck: "the second clause", layer: "layer one" } },
      ],
      "2026-10-16T08:00:00Z",
    );
    expect(within(screen.getAllByRole("listitem")[0]!).getByText("Next step for layer one")).toBeTruthy();
  });
});

// Phase 5, requirement 3, wired by phase 14 once phase 3's picker merged: a
// barrier on the vocabulary layer opens the word picker on its own passage
// and page; the reader's action finds and saves the word as it does from the
// tutor.
describe("Save the word", () => {
  const vocabKind: WorksheetKind = structuredClone(kind);
  const layer = vocabKind.sections[1]!.fields[0]!.columns!.find((c) => c.key === "layer")!;
  layer.options = [VOCABULARY_LAYER, "structure and reference"];
  layer.option_hints = {};

  it("opens the word picker on a vocabulary barrier's passage and page, and on no other row", async () => {
    const posted: Record<string, string>[] = [];
    const sheet = sheetWith({
      barriers: {
        map: [
          { row: "", cells: { page: "3", stuck: "the gist of it", layer: VOCABULARY_LAYER } },
          { row: "", cells: { page: "5", stuck: "a pronoun far away", layer: "structure and reference" } },
          { row: "", cells: { page: "para two", stuck: "no page number", layer: VOCABULARY_LAYER } },
        ],
      },
    });
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <ReadingPasses sheet={{ ...sheet, kind: vocabKind }} busy={false} onStart={() => {}} onSave={() => {}} />,
          action: async ({ request }) => {
            posted.push(Object.fromEntries((await request.formData()).entries()) as Record<string, string>);
            return { terms: [], lang: "en", existing: [] };
          },
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    const buttons = screen.getAllByRole("button", { name: "Save the word" });
    expect(buttons).toHaveLength(1);
    const row = screen.getAllByRole("listitem").find((li) => within(li).queryByText("the gist of it"))!;
    fireEvent.click(within(row).getByRole("button", { name: "Save the word" }));
    fireEvent.click(within(row).getByRole("button", { name: "Find words to save" }));
    await vi.waitFor(() => expect(posted).toEqual([{ intent: "terms", selection: "the gist of it", page: "3" }]));
    fireEvent.click(within(row).getByRole("button", { name: "Close the word picker" }));
    expect(within(row).queryByRole("button", { name: "Find words to save" })).toBeNull();
  });

  it("reads a row as a passage and a page only on the vocabulary layer", () => {
    expect(barrierWord({ row: "", cells: { page: " 12 ", stuck: " a word ", layer: VOCABULARY_LAYER } })).toEqual({
      selection: "a word",
      page: 12,
    });
    expect(barrierWord({ row: "", cells: { page: "12", stuck: "a word", layer: "structure and reference" } })).toBeNull();
    expect(barrierWord({ row: "", cells: { page: "0", stuck: "a word", layer: VOCABULARY_LAYER } })).toBeNull();
    expect(barrierWord({ row: "", cells: { page: "12", stuck: " ", layer: VOCABULARY_LAYER } })).toBeNull();
  });
});
