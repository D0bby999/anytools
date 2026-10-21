/**
 * english-diagnostic.test.tsx
 * up's English diagnostic (up methods, phase 1) on its page: §4's totals
 * follow the scores as they change, §5's evidence card opens the skill's
 * evidence worksheet prefilled with the barrier (or names the kind when it is
 * not served yet), the CEFR column shows the global scale as its help, and
 * the Loop points a goal with language cards to a diagnostic.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import type { WorksheetDetail, WorksheetKind } from "~/lib/worksheet-types";
import type { CardKind, SkillCard } from "~/lib/loop-types";
import { CardList } from "~/components/loop/card-list";
import { CardNewForm } from "~/components/loop/card-new-form";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api", API_TOKEN: "t", APP_URL: "http://app.test", SESSION_SECRET: "s".repeat(32), useSecureCookies: false,
}));
vi.mock("~/lib/auth.server", () => ({ requireUser: async () => ({ user: { id: "u1" } }) }));
const apiFetch = vi.fn();
vi.mock("~/lib/api.server", async (orig) => ({ ...(await orig<object>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { default: ToolkitWorksheet, action } = await import("~/routes/toolkit.$id");

beforeAll(() => {
  initI18n("en");
});
beforeEach(() => {
  apiFetch.mockReset();
});

const skills = [
  { key: "listening", label: "Listening" },
  { key: "reading", label: "Reading" },
  { key: "speaking", label: "Speaking" },
  { key: "writing", label: "Writing" },
];

// The parts of the served kind this page adds to; the rest is the generic form.
const diagnostic: WorksheetKind = {
  kind: "english_diagnostic",
  name: "English diagnostic",
  group: "language",
  source: "docs/en/templates/english-diagnostic.md",
  summary: "A four-skill baseline.",
  private: false,
  attach: "state",
  version: 1,
  sections: [
    {
      key: "scores",
      title: "Scores: effect, not feeling",
      fields: [
        {
          key: "scores", label: "Scores", type: "table", row_header: "Skill", rows: skills,
          hint: "A total only compares you with yourself over time.",
          columns: [
            { key: "task", label: "Task completion", type: "score" },
            { key: "comprehensibility", label: "Comprehensibility", type: "score" },
            { key: "reason", label: "Evidence reason", type: "text" },
          ],
        },
      ],
    },
    {
      key: "barriers",
      title: "One primary barrier per skill",
      fields: [
        {
          key: "barriers", label: "Primary barriers", type: "table", row_header: "Skill", rows: skills,
          columns: [
            {
              key: "barrier", label: "Primary barrier", type: "choice",
              row_options: {
                listening: ["vocabulary", "sound", "syntax"], reading: ["structure"],
                speaking: ["chunks"], writing: ["sentence"],
              },
            },
            { key: "sample", label: "Sample/timestamp", type: "text" },
            {
              key: "card", label: "Evidence card", type: "label",
              text: { listening: "Listening evidence", reading: "Reading evidence", speaking: "Speaking evidence", writing: "Writing evidence" },
            },
          ],
        },
      ],
    },
    {
      key: "cefr",
      title: "CEFR self-check",
      added: true,
      fields: [
        {
          key: "levels", label: "Where each skill is today", type: "table", row_header: "Skill", rows: skills,
          columns: [
            {
              key: "level", label: "Level", type: "choice", options: ["A1", "A2", "B1", "B2", "C1", "C2", "not sure"],
              hint: "A1: everyday phrases.\nB2: the main ideas of complex texts.\nC2: almost everything, with ease.",
            },
          ],
        },
      ],
    },
  ],
};

// Phase 2–7's kinds, as they might be served once their phases land.
const evidenceKind = (kind: string, name: string, attach: WorksheetKind["attach"]): WorksheetKind => ({
  kind, name, group: "language", source: "s", summary: "", private: false, attach, version: 1,
  sections: [
    {
      key: "task", title: "Task and boundary",
      fields: [
        { key: "aim", label: "Aim", type: "choice", options: ["gist", "detail"] },
        { key: "situation", label: "Real situation", type: "text" },
      ],
    },
  ],
});
const listeningAudit = evidenceKind("listening_audit", "Listening evidence", "state");

type PageData = WorksheetDetail & { kinds: WorksheetKind[] };

const page = (kinds: WorksheetKind[], answers: WorksheetDetail["worksheet"]["answers"] = {}): PageData => ({
  worksheet: {
    id: "d1", kind: "english_diagnostic", kind_version: 1, title: "October baseline", answers,
    state_id: "s1", status: "open", private: false, reviews: {}, recordings: [], created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  kind: diagnostic,
  earlier: [],
  kinds,
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

describe("the diagnostic's scores", () => {
  it("shows each skill's total next to its row, updating as the scores change", () => {
    renderPage(page([], { scores: { scores: [{ row: "reading", cells: { task: 1 } }] } }));
    const table = screen.getByRole("table", { name: "Scores" });
    expect(within(table).getByRole("columnheader", { name: "Total" })).toBeInTheDocument();
    const reading = within(table).getByRole("row", { name: /Reading/ });
    expect(within(reading).getByLabelText("1 of 4")).toBeInTheDocument();
    // An unscored row has no total yet.
    expect(within(within(table).getByRole("row", { name: /Listening/ })).getByText("—")).toBeInTheDocument();

    const comprehensibility = within(table).getByRole("group", { name: "Reading: Comprehensibility" });
    fireEvent.click(within(comprehensibility).getAllByRole("radio")[2]!);
    expect(within(reading).getByLabelText("3 of 4")).toBeInTheDocument();
    fireEvent.click(within(within(table).getByRole("group", { name: "Reading: Task completion" })).getAllByRole("radio")[0]!);
    expect(within(reading).getByLabelText("2 of 4")).toBeInTheDocument();
    // The kind's own note on what a total means is shown.
    expect(screen.getByText(/only compares you with yourself/)).toBeInTheDocument();
  });
});

describe("the diagnostic's evidence cards", () => {
  it("names the kind without a button while its phase has not landed", () => {
    renderPage(page([diagnostic]));
    const table = screen.getByRole("table", { name: "Primary barriers" });
    expect(within(table).getByText("Listening evidence")).toBeInTheDocument();
    expect(within(table).queryByRole("button")).toBeNull();
  });

  it("offers a button once the kind is served, posting the row's barrier as the prefill", async () => {
    const posted: Record<string, string>[] = [];
    renderPage(page([diagnostic, listeningAudit]), (form) => {
      posted.push(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
      return null;
    });
    const table = screen.getByRole("table", { name: "Primary barriers" });
    // Only listening is served; the other rows still name their kind.
    expect(within(table).getAllByRole("button")).toHaveLength(1);
    // The barrier chosen in the row, not yet saved, is what is carried.
    fireEvent.change(within(table).getByLabelText("Listening: Primary barrier"), { target: { value: "sound" } });
    fireEvent.change(within(table).getByLabelText("Listening: Sample/timestamp"), { target: { value: "01:32" } });
    fireEvent.click(within(table).getByRole("button", { name: "Open a listening evidence worksheet" }));
    await waitFor(() => expect(posted.some((p) => p.intent === "openEvidence")).toBe(true));
    const sent = posted.find((p) => p.intent === "openEvidence")!;
    expect(sent.skill).toBe("listening");
    expect(sent.prefill).toBe(
      "From the language diagnostic “October baseline”: the primary barrier is sound. Sample or timestamp: 01:32.",
    );
  });

  it("points a kind that attaches to a document to that document", () => {
    renderPage(page([diagnostic, evidenceKind("reading_evidence", "Reading evidence", "document")]));
    const table = screen.getByRole("table", { name: "Primary barriers" });
    expect(within(table).queryByRole("button")).toBeNull();
    expect(within(table).getByText(/Start it from the video or text you practise on/)).toBeInTheDocument();
  });
});

describe("the CEFR self-check", () => {
  it("shows the global-scale descriptions as the level column's help", () => {
    renderPage(page([]));
    const table = screen.getByRole("table", { name: "Where each skill is today" });
    const level = within(table).getByLabelText("Speaking: Level");
    expect(within(level).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Choose…", "A1", "A2", "B1", "B2", "C1", "C2", "not sure",
    ]);
    expect(screen.getByText(/A1: everyday phrases\./)).toBeInTheDocument();
    expect(screen.getByText(/C2: almost everything, with ease\./)).toBeInTheDocument();
  });
});

// Version 2 (up f13ff2d): §2A, collaboration dimensions, follows §2. A
// worksheet written at version 1 opens with its answers where they were and
// an empty §2A whose sample text is read-only.
describe("the collaboration dimensions on a version 1 diagnostic", () => {
  const collaboration: WorksheetKind["sections"][number] = {
    key: "collaboration",
    title: "Collaboration dimensions",
    hint: "Optional. Use it when your goal involves working with people at a distance.",
    fields: [
      {
        key: "dimensions", label: "Collaboration samples", type: "table", row_header: "Task dimension",
        rows: [
          { key: "mediation", label: "Mediation and retelling" },
          { key: "online", label: "Online interaction" },
          { key: "repair", label: "Repairing misunderstanding" },
        ],
        columns: [
          {
            key: "sample", label: "10–15 minute sample", type: "label",
            text: { mediation: "Read two short texts.", online: "Write one progress update.", repair: "Ask a clarifying question." },
          },
          { key: "evidence", label: "Evidence location and result", type: "long" },
        ],
      },
    ],
  };
  const tasks: WorksheetKind["sections"][number] = {
    key: "tasks", title: "Four first-version tasks",
    fields: [{
      key: "tasks", label: "First-version tasks", type: "table", row_header: "Skill", rows: skills,
      columns: [{ key: "suggested", label: "Suggested first version", type: "label", text: { listening: "Listen once." } }],
    }],
  };
  const v2: WorksheetKind = { ...diagnostic, version: 2, sections: [tasks, collaboration, ...diagnostic.sections] };

  it("shows §2A after §2, empty, with the rest of the answers unchanged", () => {
    const d = page([], { scores: { scores: [{ row: "reading", cells: { task: 2, reason: "essay, para 3" } }] } });
    renderPage({ ...d, kind: v2 });
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles.slice(0, 3)).toEqual(["1. Four first-version tasks", "2. Collaboration dimensions", "3. Scores: effect, not feeling"]);
    expect(screen.getByText(/Optional\. Use it when/)).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Collaboration samples" });
    const online = within(table).getByRole("row", { name: /Online interaction/ });
    // The sample is read-only text; the evidence is the learner's, and empty.
    expect(within(online).getByText("Write one progress update.")).toBeInTheDocument();
    expect(within(online).getAllByRole("textbox")).toHaveLength(1);
    expect(within(table).getByLabelText("Online interaction: Evidence location and result")).toHaveValue("");

    // The version 1 answer is where it was.
    expect(screen.getByLabelText("Reading: Evidence reason")).toHaveValue("essay, para 3");
  });
});

// ─────────────────────────────────────────── the page's openEvidence action

type Call = { path: string; method: string; body?: Record<string, unknown> };

function scriptApi(over: { kinds?: WorksheetKind[]; existing?: { id: string; title: string; state_id?: string }[] } = {}) {
  const calls: Call[] = [];
  apiFetch.mockImplementation(async (path: string, _user: string, init?: { method?: string; body?: Record<string, unknown> }) => {
    const method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body });
    if (path === "/v1/worksheets/d1" && method === "GET") return page([]);
    if (path === "/v1/worksheet-kinds") return { kinds: over.kinds ?? [diagnostic, listeningAudit] };
    if (path.startsWith("/v1/worksheets?")) {
      return { worksheets: (over.existing ?? []).map((w) => ({ kind: "listening_audit", status: "open", private: false, reviews: {}, updated_at: "", ...w })) };
    }
    if (path === "/v1/worksheets" && method === "POST") return { id: "new1", updated_at: "2026-10-02T00:00:00Z" };
    if (path === "/v1/worksheets/new1" && method === "PATCH") return { id: "new1" };
    throw new Error(`unscripted ${method} ${path}`);
  });
  return calls;
}

async function openEvidence(skill: string, prefill: string) {
  const form = new FormData();
  form.set("intent", "openEvidence");
  form.set("skill", skill);
  form.set("prefill", prefill);
  const request = new Request("http://app.test/toolkit/d1", { method: "POST", body: form });
  return (action as unknown as (a: { request: Request; params: { id: string } }) => Promise<unknown>)({
    request,
    params: { id: "d1" },
  });
}

describe("opening an evidence worksheet from the diagnostic", () => {
  it("creates a listening_audit on the diagnostic's goal, its first section prefilled", async () => {
    const calls = scriptApi();
    const res = (await openEvidence("listening", "the primary barrier is sound.")) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/toolkit/new1");
    const create = calls.find((c) => c.path === "/v1/worksheets" && c.method === "POST")!;
    expect(create.body).toEqual({ kind: "listening_audit", title: "Listening evidence: October baseline", state_id: "s1" });
    const patch = calls.find((c) => c.method === "PATCH")!;
    // The first one-line field of the first section, with the revision just created.
    expect(patch.body).toEqual({
      revision: "2026-10-02T00:00:00Z",
      answers: { task: { situation: "the primary barrier is sound." } },
    });
  });

  it("opens the one made before instead of making another", async () => {
    const calls = scriptApi({ existing: [{ id: "old1", title: "Listening evidence: October baseline", state_id: "s1" }] });
    const res = (await openEvidence("listening", "x")) as Response;
    expect(res.headers.get("Location")).toBe("/toolkit/old1");
    expect(calls.some((c) => c.method === "POST" || c.method === "PATCH")).toBe(false);
    expect(calls.find((c) => c.path.startsWith("/v1/worksheets?"))!.path).toBe(
      "/v1/worksheets?kind=listening_audit&state_id=s1",
    );
  });

  it("refuses a kind that is not served, or one that needs a document, without creating anything", async () => {
    let calls = scriptApi({ kinds: [diagnostic] });
    expect(await openEvidence("listening", "x")).toEqual({ errorKey: "diagnostic.cannotOpen" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    calls = scriptApi({ kinds: [diagnostic, evidenceKind("listening_audit", "Listening evidence", "document")] });
    expect(await openEvidence("listening", "x")).toEqual({ errorKey: "diagnostic.cannotOpen" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    calls = scriptApi();
    expect(await openEvidence("grammar", "x")).toEqual({ errorKey: "diagnostic.cannotOpen" });
  });
});

// ──────────────────────────────────────────────────────────── the Loop

const card = (kind: string): SkillCard =>
  ({ id: `c-${kind}`, state_id: "s1", chain_id: "ch", kind, title: `${kind} card`, setup: {}, status: "open" }) as SkillCard;

function inRouter(el: ReactElement) {
  const router = createMemoryRouter([{ path: "/", element: el }]);
  return render(<RouterProvider router={router} />);
}

describe("the Loop's pointer to a diagnostic", () => {
  it("appears for a goal with a language card and no diagnostic", () => {
    inRouter(<CardList cards={[card("listening")]} kinds={[]} diagnostic={{ stateId: "s1", missing: true }} />);
    expect(screen.getByRole("link", { name: "Start with a language diagnostic" })).toHaveAttribute(
      "href",
      "/toolkit/new?kind=english_diagnostic&state=s1",
    );
  });

  it("does not appear once the goal has a diagnostic, or for non-language cards", () => {
    const { unmount } = inRouter(
      <CardList cards={[card("writing")]} kinds={[]} diagnostic={{ stateId: "s1", missing: false }} />,
    );
    expect(screen.queryByRole("link", { name: "Start with a language diagnostic" })).toBeNull();
    unmount();
    inRouter(<CardList cards={[card("field_note")]} kinds={[]} diagnostic={{ stateId: "s1", missing: true }} />);
    expect(screen.queryByRole("link", { name: "Start with a language diagnostic" })).toBeNull();
  });

  it("appears while a language card is being created", () => {
    const kinds = [
      { kind: "field_note", name: "Reader field note", summary: "", retest_delay_days: 7, setup: [], prompts: {} },
      { kind: "speaking", name: "Speaking", summary: "", retest_delay_days: 7, setup: [], prompts: {} },
    ] as CardKind[];
    inRouter(<CardNewForm kinds={kinds} busy={false} diagnostic={{ stateId: "s1", missing: true }} />);
    expect(screen.queryByRole("link", { name: "Start with a language diagnostic" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Speaking/ }));
    expect(screen.getByRole("link", { name: "Start with a language diagnostic" })).toBeInTheDocument();
  });
});
