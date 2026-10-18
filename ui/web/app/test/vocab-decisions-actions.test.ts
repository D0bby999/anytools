// @vitest-environment node
/**
 * vocab-decisions-actions.test.ts
 *
 * up-methods phase 3, the route actions: the reader's word list looks up
 * what was already decided, a decision change is a PATCH (never a second
 * save), and Mastery → Vocabulary copies notes into an audit's §3 queue
 * through the worksheet's row append, stopping when the queue is full.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api.internal:8080", API_TOKEN: "t", isProduction: false }));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));

const vocab = {
  findTerms: vi.fn(),
  saveWord: vi.fn(),
  listWords: vi.fn(),
  dueCards: vi.fn(),
  updateWord: vi.fn(),
  deleteWord: vi.fn(),
  reviewCard: vi.fn(),
  practiseWord: vi.fn(),
};
vi.mock("~/lib/vocab.server", () => vocab);
const worksheets = { appendRow: vi.fn(), listWorksheets: vi.fn() };
vi.mock("~/lib/worksheets.server", () => worksheets);
const reading = {
  openWorkspace: vi.fn(),
  saveProgress: vi.fn(),
  listHighlights: vi.fn(),
  createHighlight: vi.fn(),
  deleteHighlight: vi.fn(),
  startReadingAction: vi.fn(),
  captureNote: vi.fn(),
  fetchWorkspaceFile: vi.fn(),
};
vi.mock("~/lib/reading.server", () => reading);
vi.mock("~/lib/kb.server", () => ({ documentContent: vi.fn() }));
vi.mock("~/lib/chat.server", () => ({ getMessages: vi.fn() }));

const masteryRoute = await import("~/routes/mastery.vocabulary");
const documentRoute = await import("~/routes/documents.$docId");
const { ApiError } = await import("~/lib/api.server");

const DOC = "11111111-1111-4111-8111-111111111111";

function formOf(fields: Record<string, string | string[]>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) form.append(k, one);
  return form;
}

function mastery(fields: Record<string, string | string[]>) {
  const args = { request: new Request("http://app.test/mastery/vocabulary", { method: "POST", body: formOf(fields) }), params: {} };
  return masteryRoute.action(args as unknown as Parameters<typeof masteryRoute.action>[0]) as Promise<Record<string, unknown>>;
}

function reader(fields: Record<string, string | string[]>) {
  const args = {
    request: new Request(`http://app.test/documents/${DOC}`, { method: "POST", body: formOf(fields) }),
    params: { docId: DOC },
  };
  return documentRoute.action(args as unknown as Parameters<typeof documentRoute.action>[0]) as Promise<Record<string, unknown>>;
}

const base = {
  lang: "en",
  reading: "",
  pos: "",
  contexts: [],
  cards: [],
  suspended: false,
  created_at: "",
  updated_at: "",
  decided_at: "",
  scenario: "",
  confusable: "",
  production: false,
  task_impact: "",
  meaning: "",
};

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  for (const fn of [...Object.values(vocab), ...Object.values(worksheets), ...Object.values(reading)]) fn.mockReset();
  reading.openWorkspace.mockResolvedValue({ id: "ws-own", document_id: DOC, progress: {} });
});

describe("the reader's word list", () => {
  it("looks up what was already decided about the terms it found", async () => {
    vocab.findTerms.mockResolvedValue({ terms: [{ term: "equilibrium", meaning: "m" }, { term: "flux", meaning: "f" }], lang: "en" });
    vocab.listWords.mockResolvedValue({ notes: [{ ...base, id: "n1", term: "equilibrium", decision: "skip", record: { why: "w" } }] });
    const out = await reader({ intent: "terms", selection: "x", page: "2" });
    expect(vocab.listWords).toHaveBeenCalledWith("user-1", { terms: ["equilibrium", "flux"] });
    expect(out.existing).toHaveLength(1);
  });

  it("saves a new word with its decision, and changes a decided one by PATCH", async () => {
    vocab.saveWord.mockResolvedValue({ note: { id: "n1" }, created: true, week: { learning: 6, notice: "select" } });
    const saved = await reader({
      intent: "save-word", selection: "x", page: "2", term: "equilibrium", lang: "en",
      decision: "learn", record_sound: "s", record_collocation: "c", record_cue: "q", meaning: "m", task_impact: "minor",
    });
    expect(vocab.saveWord).toHaveBeenCalledWith("user-1", expect.objectContaining({
      workspace_id: "ws-own", term: "equilibrium", meaning: "m",
      decision: "learn", record: { sound: "s", collocation: "c", cue: "q" }, task_impact: "minor",
    }));
    expect(saved).toMatchObject({ savedWord: true, created: true, week: { learning: 6, notice: "select" } });

    vocab.updateWord.mockResolvedValue({ id: "n1", decision: "skip", week: undefined });
    const changed = await reader({ intent: "decide-word", id: "n1", decision: "skip", record_why: "later", task_impact: "" });
    expect(vocab.updateWord).toHaveBeenCalledWith("user-1", "n1", { decision: "skip", record: { why: "later" }, task_impact: "" });
    expect(vocab.saveWord).toHaveBeenCalledTimes(1);
    expect(changed).toMatchObject({ savedWord: true, changed: true, note: { id: "n1", decision: "skip" } });
  });
});

describe("Mastery → Vocabulary", () => {
  it("copies the selected notes into the audit's decision queue, row by row, until it is full", async () => {
    vocab.listWords.mockResolvedValue({
      notes: [
        { ...base, id: "n1", term: "equilibrium", decision: "learn", record: { sound: "s", collocation: "c", cue: "q" } },
        { ...base, id: "n2", term: "flux", decision: "skip", record: { why: "w" }, task_impact: "none" },
        { ...base, id: "n3", term: "entropy", decision: "infer", record: { sense: "d", confidence: "low" } },
        { ...base, id: "n4", term: "not selected", decision: "skip", record: { why: "w" } },
      ],
    });
    worksheets.appendRow
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ApiError(400, "Unknown items: this table holds at most 30 rows", "bad_request"));
    const out = await mastery({ intent: "audit", worksheet: "w1", note: ["n1", "n2", "n3"] });
    expect(out).toEqual({ auditAdded: 2, auditFull: true });
    expect(worksheets.appendRow).toHaveBeenCalledTimes(3);
    expect(worksheets.appendRow).toHaveBeenNthCalledWith(1, "user-1", "w1", {
      section: "queue", field: "items",
      row: { row: "", cells: { item: "equilibrium", decision: "learn", basis: "s; c; q" } },
    });
    expect(worksheets.appendRow).toHaveBeenNthCalledWith(2, "user-1", "w1", {
      section: "queue", field: "items",
      row: { row: "", cells: { item: "flux", decision: "skip", impact: "none", basis: "w" } },
    });
  });

  it("refuses an empty selection and reports a foreign audit as a failure", async () => {
    expect(await mastery({ intent: "audit", worksheet: "w1" })).toEqual({ errorKey: "audit.nothing" });
    vocab.listWords.mockResolvedValue({ notes: [{ ...base, id: "n1", term: "x", decision: "skip", record: { why: "w" } }] });
    worksheets.appendRow.mockRejectedValueOnce(new ApiError(404, "not found", "not_found"));
    expect(await mastery({ intent: "audit", worksheet: "someone-elses", note: ["n1"] })).toMatchObject({ errorKey: "errors.generic" });
  });

  it("changes a decision, makes and stops the production card", async () => {
    vocab.updateWord.mockResolvedValue({ id: "n2", week: { learning: 9, notice: "over" } });
    expect(
      await mastery({ intent: "decide", id: "n2", decision: "learn", record_sound: "s", record_collocation: "c", record_cue: "q", meaning: "m" }),
    ).toEqual({ updated: "n2", week: { learning: 9, notice: "over" } });
    expect(vocab.updateWord).toHaveBeenCalledWith("user-1", "n2", {
      decision: "learn", record: { sound: "s", collocation: "c", cue: "q" }, task_impact: "", meaning: "m",
    });
    expect(await mastery({ intent: "decide", id: "n2", decision: "forget" })).toEqual({ errorKey: "errors.generic" });

    vocab.practiseWord.mockResolvedValue({});
    await mastery({ intent: "practise", id: "n2", scenario: "a meeting", confusable: "" });
    expect(vocab.practiseWord).toHaveBeenCalledWith("user-1", "n2", { scenario: "a meeting", confusable: "" });
    vocab.updateWord.mockResolvedValue({ id: "n2" });
    await mastery({ intent: "production-off", id: "n2" });
    expect(vocab.updateWord).toHaveBeenLastCalledWith("user-1", "n2", { production: false });
  });
});
