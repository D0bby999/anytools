/**
 * up-templates.test.tsx
 * up's four templates new at f13ff2d (the private design notes,
 * phase 2), the parts the page adds: an AI evaluation shows the pass rates
 * its case rows give, counted with failures and timeouts among the attempts
 * and updated as the rows change; a consistency plan started on a learning
 * state offers that state's next task and minimum for "Three versions", read
 * with the caller's id (another user's state is a 404) and written only when
 * the learner confirms, never with the private ask_for_help_when.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import type { Answers, TableRow, WorksheetDetail, WorksheetKind } from "~/lib/worksheet-types";
import { agrees, ratesOf } from "~/lib/ai-evaluation";
import { prefillFrom, versionsAnswers } from "~/lib/consistency-plan";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api", API_TOKEN: "t", APP_URL: "http://app.test", SESSION_SECRET: "s".repeat(32), useSecureCookies: false,
}));
vi.mock("~/lib/auth.server", () => ({ requireUser: async () => ({ user: { id: "u1" } }) }));
const apiFetch = vi.fn();
vi.mock("~/lib/api.server", async (orig) => ({ ...(await orig<object>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { default: ToolkitWorksheet } = await import("~/routes/toolkit.$id");
const { default: ToolkitNew, action: newAction, loader: newLoader } = await import("~/routes/toolkit.new");
const { ApiError } = await import("~/lib/api.server");

beforeAll(() => {
  initI18n("en");
});
beforeEach(() => {
  apiFetch.mockReset();
});

const attempt = (version: string, first: string, final = ""): TableRow => ({
  row: "",
  cells: { version, first_pass: first, ...(final ? { final } : {}) },
});

describe("the AI evaluation's rates", () => {
  it("keep failures and timeouts among the attempts", () => {
    const r = ratesOf([
      attempt("current", "pass", "accepted"),
      attempt("current", "fail", "accepted"),
      attempt("current", "timeout", "timed out"),
      attempt("candidate", "pass", "accepted"),
      { row: "", cells: { version: "candidate" } },
    ]);
    expect(r.current).toEqual({ firstPass: 1, revised: 2, attempts: 3 });
    expect(r.candidate).toEqual({ firstPass: 1, revised: 1, attempts: 1 });
  });

  it("agree with a stored rate only when it is accepted/attempts as counted", () => {
    expect(agrees("1/3", 1, 3)).toBe(true);
    expect(agrees(" 1 / 3 ", 1, 3)).toBe(true);
    expect(agrees("", 1, 3)).toBe(true);
    expect(agrees("1/2", 1, 3)).toBe(false);
    expect(agrees("33%", 1, 3)).toBe(false);
  });
});

// The parts of the served kind the page adds to.
const evaluation: WorksheetKind = {
  kind: "ai_evaluation", name: "AI evaluation", group: "projects", source: "docs/en/templates/ai-evaluation.md",
  summary: "", private: false, attach: "state", version: 1,
  sections: [
    {
      key: "cases", title: "Case records",
      fields: [{
        key: "cases", label: "Attempts", type: "table", max_rows: 40,
        columns: [
          { key: "version", label: "Version", type: "choice", options: ["current", "candidate"] },
          { key: "case", label: "Case ID / trial", type: "text" },
          { key: "first_pass", label: "First pass", type: "choice", options: ["pass", "fail", "timeout"] },
          { key: "final", label: "Final state", type: "choice", options: ["accepted", "failed", "timed out"] },
        ],
      }],
    },
    {
      key: "results", title: "Results",
      fields: [{
        key: "rates", label: "Rates", type: "table", row_header: "Version",
        rows: [{ key: "current", label: "Current" }, { key: "candidate", label: "Candidate" }],
        columns: [
          { key: "first_pass", label: "Accepted on the first pass / all attempts", type: "text" },
          { key: "revised", label: "Accepted after human revision / all attempts", type: "text" },
        ],
      }],
    },
  ],
};

const detail = (kind: WorksheetKind, answers: Answers): WorksheetDetail => ({
  worksheet: {
    id: "w1", kind: kind.kind, kind_version: 1, title: "Prompt B", answers, status: "open", private: false,
    reviews: {}, recordings: [], created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  },
  kind,
  earlier: [],
});

const Sheet = ToolkitWorksheet as unknown as (props: { loaderData: WorksheetDetail; actionData: undefined }) => ReactElement;

function renderAt(element: ReactElement) {
  const router = createMemoryRouter([{ path: "/", element, action: async () => null }]);
  return render(<RouterProvider router={router} />);
}

describe("the AI evaluation's page", () => {
  it("shows each version's rates from the case rows, and updates them as the rows change", () => {
    renderAt(
      <Sheet
        loaderData={detail(evaluation, {
          cases: { cases: [attempt("current", "pass", "accepted"), attempt("current", "fail", "accepted")] },
          results: { rates: [{ row: "current", cells: { first_pass: "1/2" } }] },
        })}
        actionData={undefined}
      />,
    );
    const rates = screen.getByRole("table", { name: "Rates" });
    expect(within(rates).getByRole("columnheader", { name: "From the case rows" })).toBeInTheDocument();
    const current = within(rates).getByRole("row", { name: /Current/ });
    expect(within(current).getByText("1/2 first pass · 2/2 after revision")).toBeInTheDocument();
    expect(within(current).queryByText(/differs from the case rows/)).toBeNull();
    const candidate = within(rates).getByRole("row", { name: /Candidate/ });
    expect(within(candidate).getByText("No attempts yet")).toBeInTheDocument();

    // A third attempt that times out: still one pass, now of three.
    fireEvent.click(screen.getByRole("button", { name: "Add a row" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Row 3: Version" }), { target: { value: "current" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Row 3: First pass" }), { target: { value: "timeout" } });
    expect(within(current).getByText("1/3 first pass · 2/3 after revision")).toBeInTheDocument();
    // The stored 1/2 is now out of date, and the page says so.
    expect(within(current).getByText(/differs from the case rows/)).toBeInTheDocument();
  });

  it("adds no rate column to another kind's table", () => {
    renderAt(<Sheet loaderData={detail({ ...evaluation, kind: "ai_project_scorecard" }, {})} actionData={undefined} />);
    expect(screen.queryByRole("columnheader", { name: "From the case rows" })).toBeNull();
  });
});

describe("the consistency plan's start from a goal", () => {
  const MARKER = "PRIVATE-HELP-MARKER";
  const plan: WorksheetKind = {
    kind: "consistency_plan", name: "Consistency plan", group: "projects", source: "docs/en/templates/consistency-plan.md",
    summary: "One change to how you keep going.", private: false, attach: "state", version: 1, sections: [],
  };
  const learningState = {
    id: "s1", goal: "Explain my project", next_task: "Revise the outline and record it",
    next_task_minimum: "Write three sentences", minimum_contract: { ask_for_help_when: MARKER, downshift_when: "x" },
  };
  // The API, as the caller sees it: their own state, and anyone else's as missing.
  const api = (path: string, user: string, opts?: { method?: string; body?: unknown }) => {
    if (path === "/v1/worksheet-kinds") return Promise.resolve({ kinds: [plan] });
    if (path === "/v1/learning/states/s1" && user === "u1") return Promise.resolve({ state: learningState, chains: [] });
    if (path.startsWith("/v1/learning/states/")) return Promise.reject(new ApiError(404, "not found"));
    if (path === "/v1/worksheets" && opts?.method === "POST")
      return Promise.resolve({ id: "w9", updated_at: "2026-10-17T00:00:00Z" });
    if (path === "/v1/worksheets/w9" && opts?.method === "PATCH") return Promise.resolve({});
    return Promise.reject(new Error(`unexpected ${path}`));
  };
  const load = (query: string) =>
    newLoader({ request: new Request(`http://app.test/toolkit/new?${query}`) } as unknown as Parameters<typeof newLoader>[0]);
  const submit = (fields: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return newAction({
      request: new Request("http://app.test/toolkit/new", { method: "POST", body: form }),
    } as unknown as Parameters<typeof newAction>[0]) as Promise<unknown>;
  };

  it("reads only the next task and its minimum", () => {
    const p = prefillFrom(learningState);
    expect(p).toEqual({ minimum: "Write three sentences", standard: "Revise the outline and record it" });
    expect(JSON.stringify(versionsAnswers(p))).not.toContain(MARKER);
    expect(versionsAnswers({ minimum: "", standard: "" })).toEqual({});
  });

  it("offers the caller's own state's tasks", async () => {
    apiFetch.mockImplementation(api);
    const data = await load("kind=consistency_plan&state=s1");
    expect(apiFetch).toHaveBeenCalledWith("/v1/learning/states/s1", "u1");
    expect(data.prefill).toEqual({ minimum: "Write three sentences", standard: "Revise the outline and record it" });
    expect(JSON.stringify(data)).not.toContain(MARKER);
  });

  it("answers another user's state with a 404", async () => {
    apiFetch.mockImplementation(api);
    const thrown = await load("kind=consistency_plan&state=bobs-state").catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });

  it("shows both rows to confirm, ticked", () => {
    const Page = ToolkitNew as unknown as (props: { loaderData: unknown; actionData: undefined }) => ReactElement;
    renderAt(
      <Page
        loaderData={{ kinds: [plan], kind: plan, state: "s1", document: "", prefill: prefillFrom(learningState) }}
        actionData={undefined}
      />,
    );
    expect(screen.getByText("Write three sentences")).toBeInTheDocument();
    expect(screen.getByText("Revise the outline and record it")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Start the three versions with these" })).toBeChecked();
  });

  it("writes the confirmed rows from the state it reads again, not from the form", async () => {
    apiFetch.mockImplementation(api);
    const out = (await submit({ kind: "consistency_plan", title: "Plan", state: "s1", prefill: "on" })) as Response;
    expect(out.headers.get("Location")).toBe("/toolkit/w9");
    const patch = apiFetch.mock.calls.find(([path, , opts]) => path === "/v1/worksheets/w9" && opts?.method === "PATCH");
    expect(patch?.[2].body).toEqual({
      revision: "2026-10-17T00:00:00Z",
      answers: {
        versions: {
          versions: [
            { row: "minimum", cells: { action: "Write three sentences" } },
            { row: "standard", cells: { action: "Revise the outline and record it" } },
          ],
        },
      },
    });
    expect(JSON.stringify(apiFetch.mock.calls)).not.toContain(MARKER);
  });

  it("writes nothing when the learner unticks it", async () => {
    apiFetch.mockImplementation(api);
    await submit({ kind: "consistency_plan", title: "Plan", state: "s1" });
    expect(apiFetch.mock.calls.some(([, , opts]) => opts?.method === "PATCH")).toBe(false);
  });

  it("creates nothing on another user's state", async () => {
    apiFetch.mockImplementation(api);
    const thrown = await submit({ kind: "consistency_plan", title: "Plan", state: "bobs-state", prefill: "on" }).catch(
      (e: unknown) => e,
    );
    expect((thrown as Response).status).toBe(404);
    expect(apiFetch.mock.calls.some(([path]) => path === "/v1/worksheets")).toBe(false);
  });
});
