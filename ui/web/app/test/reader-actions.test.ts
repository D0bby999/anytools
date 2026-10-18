// @vitest-environment node
/**
 * reader-actions.test.ts
 *
 * The document viewer's action. The rule that matters most: the workspace is
 * resolved from the document the URL names, never from a posted id, so a form
 * cannot aim an action, a highlight or a note at another reader's workspace.
 * Failures come back beside the control rather than through the error boundary,
 * which would unmount the document the reader is in the middle of.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api.internal:8080", API_TOKEN: "t", isProduction: false }));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));

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
  for (const fn of Object.values(reading)) fn.mockReset();
  reading.openWorkspace.mockResolvedValue({ id: "ws-own", document_id: DOC, progress: {} });
});

describe("documents action", () => {
  it("starts a reading turn on the workspace for THIS document, ignoring any posted id", async () => {
    reading.startReadingAction.mockResolvedValue({ turn_id: "t1", session_id: "s1", status: "queued", action: "explain" });
    const out = await submit({ intent: "action", action: "explain", selection: "x", page: "4", workspaceId: "ws-other" });
    expect(reading.openWorkspace).toHaveBeenCalledWith("user-1", DOC);
    expect(reading.startReadingAction).toHaveBeenCalledWith("user-1", "ws-own", { action: "explain", selection: "x", page: 4 });
    expect(out).toEqual({ turnId: "t1", sessionId: "s1" });
  });

  it("refuses an action outside the four without calling the API", async () => {
    const out = await submit({ intent: "action", action: "summarise-my-other-books", selection: "x" });
    expect(reading.startReadingAction).not.toHaveBeenCalled();
    expect(out).toMatchObject({ errorKey: "errors.actionFailed" });
  });

  it("saves a note with its page and the tutor flag", async () => {
    reading.captureNote.mockResolvedValue({ id: "n1" });
    await submit({ intent: "capture", body_md: "answer", page: "7", from: "tutor" });
    expect(reading.captureNote).toHaveBeenCalledWith("user-1", "ws-own", {
      title: undefined,
      body_md: "answer",
      page: 7,
      from: "tutor",
      highlight_id: undefined,
    });
  });

  it("reports an API refusal beside the control instead of throwing", async () => {
    reading.startReadingAction.mockRejectedValue(new ApiError(409, "the tutor is still answering; wait for it to finish", "turn_in_progress"));
    const out = await submit({ intent: "action", action: "vocab", selection: "x", page: "1" });
    expect(out).toEqual({ errorKey: "errors.actionFailed", errorDetail: "the tutor is still answering; wait for it to finish" });
  });

  it("never sends a negative or fractional page", async () => {
    reading.createHighlight.mockResolvedValue({});
    await submit({ intent: "highlight", text: "x", page: "-3.7" });
    expect(reading.createHighlight).toHaveBeenCalledWith("user-1", "ws-own", { page: 0, text: "x" });
  });
});
