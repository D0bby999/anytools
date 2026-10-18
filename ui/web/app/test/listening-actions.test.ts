// @vitest-environment node
/**
 * listening-actions.test.ts
 * Up-methods phase 2, server side. "Practise listening" starts a video's
 * listening audit on the document the URL names, never a posted one, and at
 * most one open audit per video; a fourteen-day experiment opens on its own
 * page. An experiment's day 5 links the audit of the same video.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api.internal:8080", API_TOKEN: "t", isProduction: false }));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));
const kb = { documentContent: vi.fn(), getDocument: vi.fn() };
vi.mock("~/lib/kb.server", () => kb);
vi.mock("~/lib/reading.server", () => ({ openWorkspace: vi.fn() }));
vi.mock("~/lib/chat.server", () => ({ getMessages: vi.fn() }));
const sheets = { listWorksheets: vi.fn(), createWorksheet: vi.fn(), getWorksheet: vi.fn() };
vi.mock("~/lib/worksheets.server", () => sheets);

const { action } = await import("~/routes/documents.$docId");
const toolkit = await import("~/routes/toolkit.$id");
const { ApiError } = await import("~/lib/api.server");

const DOC = "11111111-1111-4111-8111-111111111111";

function submit(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const args = {
    request: new Request(`http://app.test/documents/${DOC}`, { method: "POST", body: form }),
    params: { docId: DOC },
  };
  return action(args as unknown as Parameters<typeof action>[0]) as Promise<unknown>;
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  for (const fn of [...Object.values(kb), ...Object.values(sheets)]) fn.mockReset();
  kb.getDocument.mockResolvedValue({ document: { id: DOC, title: "Me at the zoo", source_kind: "youtube" } });
});

describe("starting listening practice", () => {
  it("creates the audit on THIS video, ignoring any posted document", async () => {
    sheets.listWorksheets.mockResolvedValue([]);
    sheets.createWorksheet.mockResolvedValue({ id: "w1" });
    const out = await submit({ intent: "listening-start", document_id: "someone-elses" });
    expect(kb.getDocument).toHaveBeenCalledWith("user-1", DOC);
    expect(sheets.listWorksheets).toHaveBeenCalledWith("user-1", { kind: "listening_audit", documentId: DOC });
    expect(sheets.createWorksheet).toHaveBeenCalledWith("user-1", {
      kind: "listening_audit",
      title: "Listening audit: Me at the zoo",
      document_id: DOC,
    });
    expect(out).toEqual({ listeningStarted: true });
  });

  it("keeps one open audit per video", async () => {
    sheets.listWorksheets.mockResolvedValue([
      { id: "old", status: "done" },
      { id: "w1", status: "open" },
    ]);
    await submit({ intent: "listening-start" });
    expect(sheets.createWorksheet).not.toHaveBeenCalled();
    sheets.listWorksheets.mockResolvedValue([{ id: "old", status: "done" }]);
    sheets.createWorksheet.mockResolvedValue({ id: "w2" });
    await submit({ intent: "listening-start" });
    expect(sheets.createWorksheet).toHaveBeenCalledTimes(1);
  });

  it("opens a new experiment on its own page", async () => {
    sheets.createWorksheet.mockResolvedValue({ id: "e1" });
    const out = (await submit({ intent: "experiment-start" })) as Response;
    expect(sheets.createWorksheet).toHaveBeenCalledWith("user-1", {
      kind: "listening_experiment",
      title: "14-day listening experiment: Me at the zoo",
      document_id: DOC,
    });
    expect(out.status).toBe(302);
    expect(out.headers.get("Location")).toBe("/toolkit/e1");
  });

  it("answers a refusal beside the button instead of throwing", async () => {
    sheets.listWorksheets.mockResolvedValue([]);
    sheets.createWorksheet.mockRejectedValue(new ApiError(400, "this kind attaches to youtube documents", "bad_request"));
    const out = await submit({ intent: "listening-start" });
    expect(out).toMatchObject({ errorDetail: "this kind attaches to youtube documents" });
  });

  it("refuses another user's document as the API does", async () => {
    kb.getDocument.mockRejectedValue(new ApiError(404, "not found", "not_found"));
    const out = await submit({ intent: "experiment-start" });
    expect(sheets.createWorksheet).not.toHaveBeenCalled();
    expect(out).toMatchObject({ errorKey: "errors.generic" });
  });
});

describe("the experiment's page", () => {
  it("links day 5 to the listening audit of the same video", async () => {
    sheets.getWorksheet.mockResolvedValue({
      worksheet: { id: "e1", document_id: DOC, answers: {} },
      kind: {
        sections: [
          { key: "days", fields: [{ key: "plan", rows: [{ key: "day5", see: { kind: "listening_audit", section: "segment" } }] }] },
        ],
      },
      earlier: [],
    });
    sheets.listWorksheets.mockImplementation(async (_u: string, f: { documentId?: string }) =>
      f.documentId === DOC ? [{ id: "audit-on-this-video" }] : [{ id: "newest-elsewhere" }],
    );
    const out = await toolkit.loader({
      request: new Request("http://app.test/toolkit/e1"),
      params: { id: "e1" },
    } as unknown as Parameters<typeof toolkit.loader>[0]);
    expect(out.related).toEqual({ listening_audit: "audit-on-this-video" });
  });
});
