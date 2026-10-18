/**
 * project-kinds.test.tsx
 * up's project worksheets (up methods, phase 8) on their page: the artifact
 * brief's quality gates read "unverified" while their evidence location is
 * empty, "Add to evidence" appears only once §5's delivery line is saved on a
 * brief attached to a learning state and posts it to a chain as transfer
 * evidence, and the narrative case review shows the private notice.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import type { Answers, WorksheetDetail, WorksheetKind } from "~/lib/worksheet-types";
import type { Chain } from "~/lib/loop-types";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api", API_TOKEN: "t", APP_URL: "http://app.test", SESSION_SECRET: "s".repeat(32), useSecureCookies: false,
}));
vi.mock("~/lib/auth.server", () => ({ requireUser: async () => ({ user: { id: "u1" } }) }));
const apiFetch = vi.fn();
vi.mock("~/lib/api.server", async (orig) => ({ ...(await orig<object>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const { default: ToolkitWorksheet, action, loader } = await import("~/routes/toolkit.$id");

beforeAll(() => {
  initI18n("en");
});
beforeEach(() => {
  apiFetch.mockReset();
});

const gates = ["clear", "accurate", "usable", "maintainable", "accountable"];

// The parts of the served kind this page adds to; the rest is the generic form.
const brief: WorksheetKind = {
  kind: "artifact_brief",
  name: "Artifact brief",
  group: "projects",
  source: "docs/en/templates/artifact-brief.md",
  summary: "Set the edges of one thing you are making.",
  private: false,
  attach: "state",
  version: 1,
  reviews: [{ key: "parallel_test", label: "Parallel test after delivery", days: 5, from: { section: "delivery", field: "date_version" } }],
  sections: [
    {
      key: "gates",
      title: "Quality gates",
      fields: [
        {
          key: "gates", label: "Quality gates", type: "table", row_header: "Gate",
          rows: gates.map((key) => ({ key, label: key[0]!.toUpperCase() + key.slice(1) })),
          columns: [
            {
              key: "check", label: "Check", type: "label",
              text: Object.fromEntries(gates.map((g) => [g, `Is it ${g}?`])),
            },
            {
              key: "evidence", label: "Evidence location", type: "text",
              hint: "A gate with no evidence is unverified, whatever you think of it.",
            },
            { key: "owner", label: "Owner/date", type: "text" },
          ],
        },
      ],
    },
    {
      key: "delivery",
      title: "Delivery and rollback",
      fields: [
        { key: "scope", label: "Who receives it, and what they may do with it", type: "text" },
        { key: "date_version", label: "Delivery date and version", type: "text" },
      ],
    },
  ],
};

const narrative: WorksheetKind = {
  kind: "narrative_case_review", name: "Narrative case review", group: "life",
  source: "docs/en/threads/part-2/narrative-and-evidence.md §6, with docs/en/templates/ai-case-review.md",
  summary: "", private: true, attach: "none", version: 1,
  sections: [
    {
      key: "boundary", title: "Narrative boundary",
      fields: [{ key: "whose", label: "Is this what I saw, what someone else said, or how I read it?", type: "text" }],
    },
  ],
};

type PageData = WorksheetDetail & { chains: Chain[] };

const chain = (id: string, question: string): Chain => ({
  id, state_id: "s1", question, split: { fact: "", interpretation: "", hypothesis: "" },
});

const page = (opts: { answers?: Answers; stateId?: string; chains?: Chain[]; kind?: WorksheetKind } = {}): PageData => {
  const kind = opts.kind ?? brief;
  return {
    worksheet: {
      id: "w1", kind: kind.kind, kind_version: 1, title: "Status page v1", answers: opts.answers ?? {},
      state_id: opts.stateId, status: "open", private: kind.private, reviews: {}, recordings: [],
      created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    },
    kind,
    earlier: [],
    chains: opts.chains ?? [],
  };
};

const delivered: Answers = { delivery: { date_version: "2026-10-09, v1.0" } };

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

describe("the artifact brief's quality gates", () => {
  it("marks a gate unverified while its evidence location is empty", () => {
    renderPage(page({ answers: { gates: { gates: [{ row: "accurate", cells: { evidence: "tests/report.md" } }] } } }));
    const table = screen.getByRole("table", { name: "Quality gates" });
    const row = (name: RegExp) => within(table).getByRole("row", { name });
    expect(within(row(/Clear/)).getByText("unverified")).toBeInTheDocument();
    expect(within(row(/Accurate/)).queryByText("unverified")).toBeNull();
    expect(within(table).getAllByText("unverified")).toHaveLength(4);
    // up's rule is shown under the table, as the evidence column's help.
    expect(screen.getByText(/A gate with no evidence is unverified/)).toBeInTheDocument();

    // The mark follows what is typed, before it is saved.
    fireEvent.change(within(table).getByLabelText("Clear: Evidence location"), { target: { value: "review notes" } });
    expect(within(row(/Clear/)).queryByText("unverified")).toBeNull();
    fireEvent.change(within(table).getByLabelText("Clear: Evidence location"), { target: { value: "   " } });
    expect(within(row(/Clear/)).getByText("unverified")).toBeInTheDocument();
  });

  it("shows no unverified mark on another kind's label columns", () => {
    const other: WorksheetKind = { ...brief, kind: "ai_project_scorecard", name: "AI project scorecard" };
    renderPage(page({ kind: other }));
    expect(screen.queryByText("unverified")).toBeNull();
  });
});

describe("Add to evidence", () => {
  const button = () => screen.queryByRole("button", { name: "Add to evidence" });

  it("is not offered before the delivery line is saved", () => {
    renderPage(page({ stateId: "s1", chains: [chain("c1", "Can I ship it?")] }));
    expect(button()).toBeNull();
    renderPage(page({ stateId: "s1", chains: [chain("c1", "Can I ship it?")], answers: { delivery: { date_version: "  " } } }));
    expect(button()).toBeNull();
  });

  it("is not offered on a brief with no learning state", () => {
    renderPage(page({ answers: delivered, chains: [chain("c1", "Can I ship it?")] }));
    expect(button()).toBeNull();
  });

  it("posts the brief to the goal's only chain once it is delivered", async () => {
    const posted: Record<string, string>[] = [];
    renderPage(page({ answers: delivered, stateId: "s1", chains: [chain("c1", "Can I ship it?")] }), (form) => {
      posted.push(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
      return null;
    });
    const evidence = screen.getByRole("region", { name: "Add to evidence" });
    expect(within(evidence).queryByRole("combobox")).toBeNull();
    fireEvent.click(within(evidence).getByRole("button", { name: "Add to evidence" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ intent: "addToEvidence", chain_id: "c1" });
  });

  it("lets the learner pick among several chains", () => {
    renderPage(page({ answers: delivered, stateId: "s1", chains: [chain("c1", "Can I ship it?"), chain("c2", "Does it hold?")] }));
    const select = screen.getByRole("combobox", { name: "Evidence chain" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Can I ship it?", "Does it hold?"]);
  });

  it("points to the goal's page when it has no chain yet", () => {
    renderPage(page({ answers: delivered, stateId: "s1" }));
    expect(button()).toBeNull();
    expect(screen.getByRole("link", { name: "Start one on the goal's page" })).toHaveAttribute("href", "/loop/state/s1");
  });

  it("adds the brief as transfer evidence and opens the chain", async () => {
    apiFetch.mockResolvedValue({ id: "e1" });
    const form = new FormData();
    form.set("intent", "addToEvidence");
    form.set("chain_id", "c1");
    const res = await action({
      request: new Request("http://app.test/toolkit/w1", { method: "POST", body: form }),
      params: { id: "w1" },
    } as never);
    expect(apiFetch).toHaveBeenCalledWith("/v1/learning/chains/c1/evidence", "u1", {
      method: "POST",
      body: { kind: "worksheet", ref_id: "w1", timepoint: "transfer" },
    });
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).headers.get("Location")).toBe("/loop/evidence/c1");
  });

  it("loads the goal's chains for an artifact brief, and only for one", async () => {
    const detail = (kind: WorksheetKind) => ({ ...page({ kind, stateId: "s1" }), earlier: [] });
    apiFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/worksheets/w1") return detail(brief);
      if (path === "/v1/learning/states/s1") return { chains: [chain("c1", "Can I ship it?")] };
      throw new Error(`unexpected ${path}`);
    });
    const args = { request: new Request("http://app.test/toolkit/w1"), params: { id: "w1" } } as never;
    const loaded = await loader(args);
    expect(loaded.chains.map((c) => c.id)).toEqual(["c1"]);

    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/worksheets/w1") return detail({ ...brief, kind: "ai_project_scorecard" });
      throw new Error(`unexpected ${path}`);
    });
    expect((await loader(args)).chains).toEqual([]);
    // Another kind on a goal never asks for the goal's chains.
    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual(["/v1/worksheets/w1"]);
  });
});

describe("the narrative case review", () => {
  it("shows the private notice", () => {
    renderPage(page({ kind: narrative }));
    expect(screen.getByRole("complementary", { name: "Private" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing in this worksheet is ever sent to an AI model/)).toBeInTheDocument();
  });
});
