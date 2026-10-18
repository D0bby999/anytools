/**
 * grammar-kinds.test.tsx
 * The grammar error map (up methods, phase 6) on its page: its rows are
 * shown highest priority first (priority is derived from each row's impact,
 * never stored), and "Start a contrast card" opens a grammar evidence
 * worksheet prefilled from the row.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import type { TableRow, WorksheetDetail, WorksheetField, WorksheetKind } from "~/lib/worksheet-types";
import { contrastCardAnswers, priorityOrder } from "~/lib/grammar";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api", API_TOKEN: "t", APP_URL: "http://app.test", SESSION_SECRET: "s".repeat(32), useSecureCookies: false,
}));
vi.mock("~/lib/auth.server", () => ({ requireUser: async () => ({ user: { id: "u1" } }) }));
const apiFetch = vi.fn();
vi.mock("~/lib/api.server", async (orig) => ({ ...(await orig<object>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { default: ToolkitWorksheet, action } = await import("~/routes/toolkit.$id");
const { loader: newLoader } = await import("~/routes/toolkit.new");

beforeAll(() => {
  initI18n("en");
});
beforeEach(() => {
  apiFetch.mockReset();
});

const decisions = ["who acts and who is responsible", "time and state", "which object"];
const impacts = ["meaning-changing", "task-blocking", "recurring", "register mismatch", "low-impact"];
const priorities: Record<string, string> = {
  "meaning-changing": "Highest", "task-blocking": "Highest", recurring: "High", "register mismatch": "Medium", "low-impact": "Later",
};

// The error table as GET /v1/worksheet-kinds serves it (kinds_grammar.go).
const errorsTable: WorksheetField = {
  key: "errors", label: "My errors", type: "table", max_rows: 40,
  columns: [
    { key: "sample", label: "Sample", type: "text" },
    { key: "decision", label: "Meaning decision", type: "choice", options: decisions },
    { key: "impact", label: "Impact", type: "choice", options: impacts },
    { key: "priority", label: "Priority", type: "label", text_from: "impact", text: priorities },
    { key: "meant", label: "What I meant", type: "text" },
    { key: "contrast", label: "The contrast I will practise", type: "text" },
  ],
};

const errorMap: WorksheetKind = {
  kind: "grammar_error_map", name: "Grammar error map", group: "language", source: "docs/en/threads/part-1/grammar.md §2, §4",
  summary: "Sort slips by what they did to the reader.", private: false, attach: "state_or_document", version: 1,
  sections: [{ key: "map", title: "Error map", fields: [errorsTable] }],
};

const grammarEvidence: WorksheetKind = {
  kind: "grammar_evidence", name: "Grammar evidence", group: "language", source: "docs/en/templates/grammar-evidence.md",
  summary: "One structure.", private: false, attach: "state", version: 1,
  sections: [
    {
      key: "problem", title: "One structural problem",
      fields: [
        { key: "original", label: "My original sentence or passage", type: "long" },
        { key: "impact", label: "Impact", type: "choice", options: impacts },
        {
          key: "samples", label: "Samples", type: "table", row_header: "Sample",
          rows: [{ key: "original", label: "Original" }, { key: "contrast_a", label: "Contrast A" }],
          columns: [{ key: "choice", label: "Structural choice", type: "choice", options: decisions }],
        },
      ],
    },
    { key: "contrast", title: "Meaning contrast card", fields: [{ key: "meaning", label: "Meaning I need to express", type: "text" }] },
  ],
};

const row = (sample: string, impact?: string, more: Record<string, string> = {}): TableRow => ({
  row: "",
  cells: { sample, ...(impact ? { impact } : {}), ...more },
});

type PageData = WorksheetDetail & { kinds: WorksheetKind[]; related: Record<string, string>; diagnoses: [] };

const page = (rows: TableRow[], over: Partial<WorksheetDetail["worksheet"]> = {}): PageData => ({
  worksheet: {
    id: "m1", kind: "grammar_error_map", kind_version: 1, title: "October slips", answers: { map: { errors: rows } },
    state_id: "s1", status: "open", private: false, reviews: {}, recordings: [], created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z", ...over,
  },
  kind: errorMap,
  earlier: [],
  kinds: [],
  related: {},
  diagnoses: [],
});

const Page = ToolkitWorksheet as unknown as (props: { loaderData: PageData; actionData: undefined }) => ReactElement;

function renderPage(d: PageData, onAction?: (form: FormData) => unknown) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: <Page loaderData={d} actionData={undefined} />,
      action: async ({ request }) => (onAction ? onAction(await request.formData()) : null),
    },
  ]);
  return render(<RouterProvider router={router} />);
}

const samplesInOrder = (table: HTMLElement) =>
  within(table)
    .getAllByLabelText(/: Sample$/)
    .map((el) => (el as HTMLInputElement).value);

describe("the error map's order", () => {
  it("shows rows highest priority first, ties and rows without an impact as saved", () => {
    renderPage(
      page([
        row("later one", "low-impact"),
        row("no impact yet"),
        row("recurring one", "recurring"),
        row("blocks the task", "task-blocking"),
        row("register", "register mismatch"),
        row("changes meaning", "meaning-changing"),
      ]),
    );
    const table = screen.getByRole("table", { name: "My errors" });
    expect(samplesInOrder(table)).toEqual([
      "blocks the task", "changes meaning", "recurring one", "register", "later one", "no impact yet",
    ]);
    // The derived priority is shown in its row.
    const top = within(table).getAllByRole("row")[1]!;
    expect(within(top).getByText("Highest")).toBeInTheDocument();
  });

  it("re-sorts as an impact changes, keeping the row's own inputs", () => {
    renderPage(page([row("first", "recurring"), row("second", "low-impact")]));
    const table = screen.getByRole("table", { name: "My errors" });
    expect(samplesInOrder(table)).toEqual(["first", "second"]);
    const second = within(table).getAllByLabelText(/: Impact$/)[1]!;
    fireEvent.change(second, { target: { value: "meaning-changing" } });
    expect(samplesInOrder(table)).toEqual(["second", "first"]);
    expect((within(table).getAllByLabelText(/: Impact$/)[0] as HTMLSelectElement).value).toBe("meaning-changing");
  });

  it("orders by the kind's own priority labels (pure)", () => {
    const rows = [row("a", "register mismatch"), row("b"), row("c", "meaning-changing"), row("d", "recurring")];
    expect(priorityOrder(errorsTable, rows)).toEqual([2, 3, 0, 1]);
  });
});

describe("Start a contrast card", () => {
  it("posts the row's current values, and is disabled until the row has a sample", async () => {
    const posted: Record<string, string>[] = [];
    renderPage(page([row("I work here since 2024", "meaning-changing", { meant: "I still work here", decision: "time and state" }), row("")]), (form) => {
      posted.push(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
      return null;
    });
    const table = screen.getByRole("table", { name: "My errors" });
    const buttons = within(table).getAllByRole("button", { name: /Start a contrast card/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).toBeDisabled();
    fireEvent.click(within(table).getByRole("button", { name: "Start a contrast card for “I work here since 2024”" }));
    await waitFor(() => expect(posted.some((p) => p.intent === "contrastCard")).toBe(true));
    expect(posted.find((p) => p.intent === "contrastCard")).toEqual({
      intent: "contrastCard", sample: "I work here since 2024", meant: "I still work here", decision: "time and state", impact: "meaning-changing",
    });
  });

  it("is not offered on any other kind", () => {
    renderPage({ ...page([]), kind: { ...errorMap, kind: "other_kind" } });
    expect(screen.queryByRole("button", { name: /Start a contrast card/ })).toBeNull();
  });
});

// ──────────────────────────────────────────── the page's contrastCard action

type Call = { path: string; method: string; body?: Record<string, unknown> };

function scriptApi(over: { map?: Partial<WorksheetDetail["worksheet"]>; kinds?: WorksheetKind[]; existing?: { id: string; title: string; state_id?: string }[] } = {}) {
  const calls: Call[] = [];
  apiFetch.mockImplementation(async (path: string, _user: string, init?: { method?: string; body?: Record<string, unknown> }) => {
    const method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body });
    if (path === "/v1/worksheets/m1" && method === "GET") return page([], over.map);
    if (path === "/v1/worksheet-kinds") return { kinds: over.kinds ?? [errorMap, grammarEvidence] };
    if (path.startsWith("/v1/worksheets?")) {
      return { worksheets: (over.existing ?? []).map((w) => ({ kind: "grammar_evidence", status: "open", private: false, reviews: {}, updated_at: "", ...w })) };
    }
    if (path === "/v1/worksheets" && method === "POST") return { id: "g1", updated_at: "2026-10-02T00:00:00Z" };
    if (path === "/v1/worksheets/g1" && method === "PATCH") return { id: "g1" };
    throw new Error(`unscripted ${method} ${path}`);
  });
  return calls;
}

async function contrastCard(fields: Record<string, string>) {
  const form = new FormData();
  form.set("intent", "contrastCard");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const request = new Request("http://app.test/toolkit/m1", { method: "POST", body: form });
  return (action as unknown as (a: { request: Request; params: { id: string } }) => Promise<unknown>)({
    request,
    params: { id: "m1" },
  });
}

describe("starting a contrast card from a row", () => {
  it("creates a grammar_evidence worksheet on the map's goal, prefilled from the row", async () => {
    const calls = scriptApi();
    const res = (await contrastCard({
      sample: "I work here since 2024", meant: "I still work here", decision: "time and state", impact: "meaning-changing",
    })) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/toolkit/g1");
    const create = calls.find((c) => c.path === "/v1/worksheets" && c.method === "POST")!;
    expect(create.body).toEqual({ kind: "grammar_evidence", title: "Grammar evidence: I work here since 2024", state_id: "s1" });
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toEqual({
      revision: "2026-10-02T00:00:00Z",
      answers: {
        problem: {
          original: "I work here since 2024",
          impact: "meaning-changing",
          samples: [{ row: "original", cells: { choice: "time and state" } }],
        },
        contrast: { meaning: "I still work here" },
      },
    });
  });

  it("opens the card started from the same row before instead of making another", async () => {
    const calls = scriptApi({ existing: [{ id: "old", title: "Grammar evidence: I work here since 2024", state_id: "s1" }] });
    const res = (await contrastCard({ sample: "I work here since 2024" })) as Response;
    expect(res.headers.get("Location")).toBe("/toolkit/old");
    expect(calls.some((c) => c.method === "POST" || c.method === "PATCH")).toBe(false);
  });

  it("starts an unattached card from a map kept on a document", async () => {
    const calls = scriptApi({ map: { state_id: undefined, document_id: "doc1" } });
    await contrastCard({ sample: "If I know earlier, I tell you." });
    const create = calls.find((c) => c.path === "/v1/worksheets" && c.method === "POST")!;
    expect(create.body).toEqual({ kind: "grammar_evidence", title: "Grammar evidence: If I know earlier, I tell you." });
  });

  it("refuses a row without a sample, a worksheet that is not a map, or a card kind not served", async () => {
    let calls = scriptApi();
    expect(await contrastCard({ sample: "" })).toEqual({ errorKey: "grammar.needsSample" });
    expect(calls).toHaveLength(0);
    calls = scriptApi({ map: { kind: "writing_evidence" } });
    expect(await contrastCard({ sample: "x" })).toEqual({ errorKey: "grammar.notAMap" });
    calls = scriptApi({ kinds: [errorMap] });
    expect(await contrastCard({ sample: "x" })).toEqual({ errorKey: "grammar.cannotStart" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("leaves out values the card's lists do not hold, so the write is never refused (pure)", () => {
    expect(contrastCardAnswers(grammarEvidence, { sample: "s", meant: "", decision: "word order", impact: "minor" })).toEqual({
      problem: { original: "s" },
    });
  });
});

describe("where an error map can be started", () => {
  const kinds = [errorMap, grammarEvidence, { ...grammarEvidence, kind: "doc_only", attach: "document" as const }];
  const load = async (query: string) => {
    apiFetch.mockImplementation(async () => ({ kinds }));
    const request = new Request(`http://app.test/toolkit/new${query}`);
    return (await (newLoader as unknown as (a: { request: Request }) => Promise<{ kinds: WorksheetKind[] }>)({ request })).kinds.map(
      (k) => k.kind,
    );
  };

  it("is offered from a learning state and from a document", async () => {
    expect(await load("?state=s1")).toEqual(["grammar_error_map", "grammar_evidence"]);
    expect(await load("?document=d1")).toEqual(["grammar_error_map", "doc_only"]);
  });
});
