/**
 * writing-diagnosis.test.tsx
 * up-methods phase 4: the writing evidence card's per-pass diagnosis. A
 * diagnosis shows its issues — quote, problem, basis, confidence, how it
 * might be wrong — with the model and the date; "Use this quote as before"
 * fills that pass's Before cell and saves the section; nothing ever writes
 * After; the draft takes 20,000 characters; other kinds get no panel.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { WorksheetForm } from "~/components/worksheet/worksheet-form";
import { writingDiagnosisExtra, type DiagnoseResult } from "~/components/worksheet/writing-diagnosis";
import type { WorksheetKind, WritingDiagnosis } from "~/lib/worksheet-types";

beforeAll(() => {
  initI18n("en");
});

// The served kind, cut to the two sections the panel touches.
const kind: WorksheetKind = {
  kind: "writing_evidence",
  name: "Writing evidence",
  group: "language",
  source: "docs/en/templates/writing-evidence.md",
  summary: "",
  private: false,
  attach: "state",
  version: 1,
  sections: [
    {
      key: "draft",
      title: "Unaided draft",
      fields: [{ key: "draft", label: "The draft", type: "long", max_len: 20000 }],
    },
    {
      key: "passes",
      title: "Five revision passes",
      fields: [
        {
          key: "passes",
          label: "Passes",
          type: "table",
          row_header: "Pass",
          rows: [
            { key: "task_fact", label: "Task and fact" },
            { key: "structure", label: "Structure and evidence" },
            { key: "sentence", label: "Sentence and meaning" },
            { key: "register", label: "Register and voice" },
            { key: "delivery", label: "Delivery and boundary" },
          ],
          columns: [
            { key: "problem", label: "Main problem", type: "text" },
            { key: "before", label: "Before", type: "long" },
            { key: "after", label: "After", type: "long" },
            { key: "why", label: "Why it changes the task result", type: "long" },
          ],
        },
        { key: "voice", label: "Personal voice kept", type: "text" },
      ],
    },
  ],
};

const stored: WritingDiagnosis = {
  id: "d1",
  worksheet_id: "w1",
  pass: 1,
  model: "fake-1",
  created_at: "2026-10-16T08:00:00Z",
  issues: [
    {
      quote: "probably maybe",
      problem: "Two hedges blur the request.",
      basis: "The reader has to act on it.",
      confidence: "high",
      might_be_wrong: "The team may hedge by habit.",
    },
  ],
};

type Posted = Record<string, string>;

function renderCard(diagnoses: WritingDiagnosis[], onAction: (form: FormData) => unknown, answers = {}) {
  const el: ReactElement = (
    <WorksheetForm
      worksheetId="w1"
      kind={kind}
      answers={answers}
      revision="2026-10-16T08:00:00Z"
      renderSectionExtra={writingDiagnosisExtra(kind, "w1", diagnoses)}
    />
  );
  const router = createMemoryRouter([
    {
      path: "/",
      element: el,
      action: async ({ request }) => onAction(await request.formData()),
    },
  ]);
  return render(<RouterProvider router={router} />);
}

const entries = (form: FormData): Posted => Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));

describe("the writing diagnosis", () => {
  it("shows a stored diagnosis with its basis, confidence, doubt, model and date", () => {
    renderCard([stored], () => null);
    const panel = screen.getByRole("region", { name: "AI diagnosis" });
    expect(within(panel).getAllByRole("listitem").filter((li) => li.textContent?.startsWith("Pass "))).toHaveLength(5);
    const issues = within(panel).getByRole("list", { name: "Issues for pass 1" });
    expect(within(issues).getByText("probably maybe").tagName).toBe("BLOCKQUOTE");
    expect(within(issues).getByText("Two hedges blur the request.")).toBeInTheDocument();
    expect(within(issues).getByText("The reader has to act on it.")).toBeInTheDocument();
    expect(within(issues).getByText("High")).toBeInTheDocument();
    expect(within(issues).getByText("The team may hedge by habit.")).toBeInTheDocument();
    expect(within(panel).getByText("Diagnosed by fake-1 on 2026-10-16")).toBeInTheDocument();
    // Pass 1 is diagnosed; the other four can be asked for.
    expect(within(panel).getAllByRole("button", { name: "Diagnose" })).toHaveLength(4);
  });

  it("copies a quote into its pass's Before and saves the section, leaving After alone", async () => {
    const posted: Posted[] = [];
    renderCard([stored], (form) => {
      posted.push(entries(form));
      return { section: String(form.get("section")), ok: true, revision: "2026-10-16T08:00:01Z" };
    }, { passes: { passes: [{ row: "task_fact", cells: { problem: "Hedging" } }] } });
    fireEvent.click(screen.getByRole("button", { name: "Use this quote as before" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    const sent = posted[0]!;
    expect(sent.intent).toBe("section");
    expect(sent.section).toBe("passes");
    const values = JSON.parse(sent.values ?? "{}") as { passes: { row: string; cells: Record<string, string> }[] };
    expect(values.passes).toEqual([{ row: "task_fact", cells: { problem: "Hedging", before: "probably maybe" } }]);
    const table = screen.getByRole("table", { name: "Passes" });
    expect(within(table).getByLabelText("Task and fact: Before")).toHaveValue("probably maybe");
    expect(within(table).getByLabelText("Task and fact: After")).toHaveValue("");
  });

  it("adds a quote below what the learner already wrote in Before", async () => {
    const posted: Posted[] = [];
    renderCard([stored], (form) => {
      posted.push(entries(form));
      return { section: "passes", ok: true, revision: "2026-10-16T08:00:01Z" };
    }, { passes: { passes: [{ row: "task_fact", cells: { before: "My own note" } }] } });
    fireEvent.click(screen.getByRole("button", { name: "Use this quote as before" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    const values = JSON.parse(posted[0]!.values ?? "{}") as { passes: { cells: Record<string, string> }[] };
    expect(values.passes[0]!.cells.before).toBe("My own note\n\nprobably maybe");
  });

  it("asks for one pass and shows what comes back, or why not", async () => {
    const posted: Posted[] = [];
    renderCard([], (form) => {
      const sent = entries(form);
      posted.push(sent);
      if (sent.pass === "1") {
        return { pass: 1, diagnoseError: "save your own draft first" } satisfies DiagnoseResult;
      }
      return { pass: 2, diagnosis: { ...stored, id: "d2", pass: 2, issues: [] } } satisfies DiagnoseResult;
    });
    const buttons = screen.getAllByRole("button", { name: "Diagnose" });
    fireEvent.click(buttons[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("save your own draft first");
    fireEvent.click(buttons[1]!);
    expect(await screen.findByText("Nothing that matters for this pass was found.")).toBeInTheDocument();
    expect(posted.map((p) => [p.intent, p.pass])).toEqual([
      ["diagnose", "1"],
      ["diagnose", "2"],
    ]);
  });

  it("the draft takes 20,000 characters; other kinds have no panel", () => {
    renderCard([], () => null);
    expect(screen.getByLabelText("The draft")).toHaveAttribute("maxLength", "20000");
    expect(writingDiagnosisExtra({ ...kind, kind: "reading_evidence" }, "w1", [stored])).toBeUndefined();
  });
});
