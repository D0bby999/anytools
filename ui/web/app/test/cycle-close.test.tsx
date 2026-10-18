/**
 * cycle-close.test.tsx
 * Up-methods phase 10, rendered: "Close this cycle" from day 84 on the
 * learner's calendar (the API counts the day), opening the cycle's close once
 * it exists; "From the last close" on a new cycle whose week 1 is empty, with
 * the continue and transfer results only; and a close's destinations saying
 * what a transfer or a stop still needs. (The actions are
 * cycle-close-actions.test.ts.)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import LoopCycle from "~/routes/loop.cycle.$id";
import { CycleCloseLink } from "~/components/loop/cycle-close-link";
import { useCycleCloseExtras } from "~/components/worksheet/cycle-close-extras";
import { WorksheetTable } from "~/components/worksheet/worksheet-table";
import { canClose, missingForRow, weekOneIsEmpty, withWeekOne, type CycleCloses } from "~/lib/cycle-close";
import type { CycleDetail, WeeklyQuestion } from "~/lib/loop-types";
import type { TableRow, WorksheetField, WorksheetKind, WorksheetSummary } from "~/lib/worksheet-types";

beforeAll(() => {
  initI18n("en");
});

function inRouter(el: ReactElement) {
  const router = createMemoryRouter([{ path: "/", element: el }]);
  return render(<RouterProvider router={router} />);
}

const summary: WorksheetSummary = {
  id: "ws-close",
  kind: "cycle_close",
  title: "Cycle close: Explain my work",
  status: "open",
  private: false,
  state_id: "st-1",
  cycle_id: "cy-1",
  reviews: {},
  updated_at: "2026-10-16T00:00:00Z",
};

describe("Close this cycle", () => {
  it("opens on day 84 and not before", () => {
    expect(canClose(83, 84)).toBe(false);
    expect(canClose(84, 84)).toBe(true);

    const { unmount } = inRouter(<CycleCloseLink goal="Explain my work" day={83} closeFromDay={84} close={null} busy={false} />);
    expect(screen.queryByRole("button", { name: "Close this cycle" })).not.toBeInTheDocument();
    expect(screen.getByText("Day 83 of the cycle. The close opens here on day 84.")).toBeInTheDocument();
    unmount();

    const { container } = inRouter(
      <CycleCloseLink goal="Explain my work" day={84} closeFromDay={84} close={null} busy={false} />,
    );
    expect(screen.getByRole("button", { name: "Close this cycle" })).toBeInTheDocument();
    expect(container.querySelector('input[name="intent"]')).toHaveValue("close-cycle");
    expect(container.querySelector('input[name="title"]')).toHaveValue("Cycle close: Explain my work");
  });

  it("opens the close the cycle already has instead of starting another", () => {
    inRouter(<CycleCloseLink goal="g" day={90} closeFromDay={84} close={summary} busy={false} />);
    expect(screen.queryByRole("button", { name: "Close this cycle" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open this cycle's close" })).toHaveAttribute("href", "/toolkit/ws-close");
  });
});

const gate = {
  from: "calibrate",
  to: "stack",
  open: false,
  final: false,
  missing: [],
  cannot_prove: [],
  counted: [],
  progress: null,
};

const previous: CycleCloses["previous"] = {
  id: "ws-last",
  title: "Cycle close: last time",
  cycle_id: "cy-0",
  offers: [
    { row: 0, result: "Explaining", destination: "continue", next_step: "Explain to a new client" },
    {
      row: 2,
      result: "Calls",
      destination: "transfer",
      next_step: "Answer questions I cannot predict",
      condition: "unprepared questions",
    },
  ],
  reduce_first: [{ row: 1, result: "Sleep", destination: "repair", next_step: "Lights out by eleven" }],
};

function cyclePage(questions: WeeklyQuestion[], closes: CycleCloses, day = 3) {
  const loaderData: CycleDetail & { closes: CycleCloses } = {
    id: "cy-1",
    state_id: "st-1",
    started_at: "2026-10-14T00:00:00Z",
    phase: "calibrate",
    gate_evidence: [],
    weekly_questions: questions,
    interruptions: [],
    day90_review_md: "Old free text",
    goal: "Explain my work",
    current_week: 1,
    day,
    close_from_day: 84,
    gate,
    reviews: [],
    closes,
  };
  const props = { loaderData, actionData: undefined, params: { id: "cy-1" }, matches: [] };
  return inRouter(<LoopCycle {...(props as unknown as Parameters<typeof LoopCycle>[0])} />);
}

describe("a cycle's page", () => {
  it("keeps the old review text as Notes, beside the close", () => {
    cyclePage([], { close: null, previous: null }, 85);
    expect(screen.getByRole("heading", { name: "Notes" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("Old free text");
    expect(screen.getByRole("heading", { name: "Close the cycle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close this cycle" })).toBeInTheDocument();
  });

  it("offers the last close's continue and transfer results while week 1 is empty", () => {
    cyclePage([], { close: null, previous });
    const region = screen.getByRole("heading", { name: "From the last close" }).closest("section")!;
    const uses = within(region).getAllByRole("button", { name: /as week 1's question/ });
    expect(uses.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Use “Explain to a new client” as week 1's question",
      "Use “Answer questions I cannot predict” as week 1's question",
    ]);
    const rows = uses.map((b) => b.closest("form")!.querySelector('input[name="row"]')!.getAttribute("value"));
    expect(rows).toEqual(["0", "2"]);
    expect(within(region).getByText("Changed condition: unprepared questions")).toBeInTheDocument();
    // Repair is a note to reduce first, never a week's question.
    expect(within(region).getByText("Reduce first")).toBeInTheDocument();
    expect(within(region).getByText(/Lights out by eleven/)).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Open the last close" })).toHaveAttribute("href", "/toolkit/ws-last");
  });

  it("offers nothing once week 1 has a question", () => {
    cyclePage([{ question: "Explain to a new client", capacity: "full" }], { close: null, previous });
    expect(screen.queryByRole("heading", { name: "From the last close" })).not.toBeInTheDocument();
  });

  it("offers nothing with no last close", () => {
    cyclePage([], { close: null, previous: null });
    expect(screen.queryByRole("heading", { name: "From the last close" })).not.toBeInTheDocument();
  });
});

describe("week 1 from the last close", () => {
  it("fills week 1 only while it is empty, keeping the other weeks", () => {
    expect(weekOneIsEmpty([])).toBe(true);
    expect(weekOneIsEmpty([{ question: "  ", capacity: "reduced" }])).toBe(true);
    expect(weekOneIsEmpty([{ question: "x", capacity: "full" }])).toBe(false);
    expect(
      withWeekOne(
        [
          { question: "", capacity: "reduced" },
          { question: "Week two", capacity: "full" },
        ],
        "Explain to a new client",
      ),
    ).toEqual([
      { question: "Explain to a new client", capacity: "reduced" },
      { question: "Week two", capacity: "full" },
    ]);
  });
});

const results: WorksheetField = {
  key: "results",
  label: "Results",
  type: "table",
  max_rows: 20,
  columns: [
    { key: "result", label: "Result", type: "text" },
    { key: "destination", label: "Destination", type: "choice", options: ["continue", "transfer", "repair", "stop"] },
    { key: "next_step", label: "Next step", type: "text" },
    { key: "condition", label: "Changed condition", type: "text" },
    { key: "basis", label: "Stop: grounds written down", type: "text" },
    { key: "archived", label: "Stop: where reusable material is archived", type: "text" },
    { key: "told", label: "Stop: who was told", type: "text" },
  ],
};

const closeKind = { kind: "cycle_close", sections: [] } as unknown as WorksheetKind;

function Destinations({ rows }: { rows: TableRow[] }) {
  const extras = useCycleCloseExtras(closeKind);
  return <WorksheetTable field={results} id="d" rows={rows} onChange={() => {}} extras={extras?.("destinations", results)} />;
}

describe("a close's destinations", () => {
  it("say what a stop or a transfer still needs", () => {
    const rows: TableRow[] = [
      { row: "", cells: { result: "Podcast", destination: "stop", basis: "No listeners" } },
      { row: "", cells: { result: "Calls", destination: "transfer" } },
      { row: "", cells: { result: "Reading", destination: "continue" } },
    ];
    expect(missingForRow(rows[0]!)).toEqual(["archived", "told"]);
    inRouter(<Destinations rows={rows} />);
    expect(screen.getByRole("columnheader", { name: "Still missing" })).toBeInTheDocument();
    expect(screen.getByText("where it is archived, who was told")).toBeInTheDocument();
    expect(screen.getByText("the changed condition")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(1);
  });

  it("add nothing to another kind's tables", () => {
    function Other() {
      const extras = useCycleCloseExtras({ kind: "listening_audit" } as WorksheetKind);
      return <p>{extras ? "extras" : "none"}</p>;
    }
    inRouter(<Other />);
    expect(screen.getByText("none")).toBeInTheDocument();
  });
});
