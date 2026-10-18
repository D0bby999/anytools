// @vitest-environment node
/**
 * reading-passes-action.test.ts
 *
 * The reader's five passes on the server side of the page (up-methods phase
 * 5). "Mark a barrier" appends one §4 row — the page and the selected text —
 * through the server-side row append, never a whole-table write; the card is
 * found (or created) from the document the URL names, so a posted id cannot
 * aim a write at another worksheet; and only the two sections the panel owns
 * are written from here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api.internal:8080", API_TOKEN: "t", isProduction: false }));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));

const sheets = {
  listKinds: vi.fn(),
  listWorksheets: vi.fn(),
  getWorksheet: vi.fn(),
  createWorksheet: vi.fn(),
  appendRow: vi.fn(),
  patchWorksheet: vi.fn(),
};
vi.mock("~/lib/worksheets.server", () => sheets);
const kb = { documentContent: vi.fn(), getDocument: vi.fn() };
vi.mock("~/lib/kb.server", () => kb);
const reading = { openWorkspace: vi.fn() };
vi.mock("~/lib/reading.server", () => reading);
vi.mock("~/lib/chat.server", () => ({ getMessages: vi.fn() }));

const { action } = await import("~/routes/documents.$docId");
const { ApiError } = await import("~/lib/api.server");

const DOC = "11111111-1111-4111-8111-111111111111";

function submit(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const args = {
    request: new Request(`http://app.test/documents/${DOC}`, { method: "POST", body: form }),
    params: { docId: DOC },
  };
  return action(args as unknown as Parameters<typeof action>[0]) as Promise<Record<string, unknown> | null>;
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  for (const fn of [...Object.values(sheets), ...Object.values(kb), ...Object.values(reading)]) fn.mockReset();
  kb.getDocument.mockResolvedValue({ document: { id: DOC, title: "paper.pdf" } });
  sheets.appendRow.mockResolvedValue({ id: "ws-own" });
  sheets.patchWorksheet.mockResolvedValue({ id: "ws-own" });
});

describe("Mark a barrier", () => {
  it("adds a §4 row with the page and the selected text to the document's open card", async () => {
    sheets.listWorksheets.mockResolvedValue([
      { id: "ws-done", status: "done" },
      { id: "ws-own", status: "open" },
    ]);
    const out = await submit({ intent: "barrier", selection: "the second\n  clause ", page: "4", worksheetId: "ws-other" });
    expect(sheets.listWorksheets).toHaveBeenCalledWith("user-1", { kind: "reading_evidence", documentId: DOC });
    expect(sheets.createWorksheet).not.toHaveBeenCalled();
    expect(sheets.appendRow).toHaveBeenCalledWith("user-1", "ws-own", {
      section: "barriers",
      field: "map",
      row: { row: "", cells: { page: "4", stuck: "the second clause" } },
    });
    expect(sheets.patchWorksheet).not.toHaveBeenCalled();
    expect(reading.openWorkspace).not.toHaveBeenCalled();
    expect(out).toEqual({ barrierMarked: true });
  });

  it("creates the card on the document first when it has none open", async () => {
    sheets.listWorksheets.mockResolvedValue([]);
    sheets.createWorksheet.mockResolvedValue({ id: "ws-new" });
    await submit({ intent: "barrier", selection: "a word", page: "0" });
    expect(sheets.createWorksheet).toHaveBeenCalledWith("user-1", {
      kind: "reading_evidence",
      title: "Reading: paper.pdf",
      document_id: DOC,
    });
    expect(sheets.appendRow).toHaveBeenCalledWith("user-1", "ws-new", {
      section: "barriers",
      field: "map",
      row: { row: "", cells: { stuck: "a word" } },
    });
  });

  it("does nothing for an empty selection", async () => {
    const out = await submit({ intent: "barrier", selection: "  ", page: "2" });
    expect(sheets.appendRow).not.toHaveBeenCalled();
    expect(out).toMatchObject({ passesErrorKey: "passes.failed" });
  });
});

describe("the panel's writes", () => {
  it("writes one section of the document's card at the revision it carries, ignoring a posted id", async () => {
    sheets.listWorksheets.mockResolvedValue([{ id: "ws-own", status: "open" }]);
    const rows = [{ row: "orient", cells: { output: "gist", done: true } }];
    const out = await submit({
      intent: "passes-save",
      section: "passes",
      rows: JSON.stringify(rows),
      revision: "2026-10-16T08:00:00Z",
      worksheetId: "ws-other",
    });
    expect(sheets.patchWorksheet).toHaveBeenCalledWith("user-1", "ws-own", {
      revision: "2026-10-16T08:00:00Z",
      answers: { passes: { passes: rows } },
    });
    expect(out).toEqual({ passesSaved: true });
  });

  it("writes only the passes and the barrier map", async () => {
    sheets.listWorksheets.mockResolvedValue([{ id: "ws-own", status: "open" }]);
    const out = await submit({ intent: "passes-save", section: "first_pass", rows: "[]", revision: "r" });
    expect(sheets.patchWorksheet).not.toHaveBeenCalled();
    expect(out).toMatchObject({ passesErrorKey: "passes.failed" });
  });

  it("reports a stale section beside the panel", async () => {
    sheets.listWorksheets.mockResolvedValue([{ id: "ws-own", status: "open" }]);
    sheets.patchWorksheet.mockRejectedValue(new ApiError(409, "barriers changed", "stale"));
    const out = await submit({ intent: "passes-save", section: "barriers", rows: "[]", revision: "r" });
    expect(out).toEqual({ passesErrorKey: "passes.stale" });
  });

  it("opens the card from the panel's entry", async () => {
    sheets.listWorksheets.mockResolvedValue([]);
    sheets.createWorksheet.mockResolvedValue({ id: "ws-new" });
    expect(await submit({ intent: "passes-start" })).toEqual({ passesOpened: true });
    expect(sheets.createWorksheet).toHaveBeenCalledTimes(1);
  });
});
