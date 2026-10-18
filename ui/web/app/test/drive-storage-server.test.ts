// @vitest-environment node
/**
 * drive-storage-server.test.ts
 * Drive-user-storage phase 3, the BFF side: an upload the learner's Drive
 * refused (full, or the connection needs reconnecting) reaches the dropzone
 * with its reason, so it can say why instead of a bare "upload failed";
 * any other failure carries none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api.internal:8080",
  API_TOKEN: "gateway-token",
  isProduction: false,
}));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({
  requireUser: (request: Request) => requireUser(request),
}));

const upload = await import("~/routes/knowledge.$kbId.upload");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1" } });
});
afterEach(() => vi.unstubAllGlobals());

function multipart(): Request {
  const form = new FormData();
  form.set("file", new File(["%PDF-1.7"], "notes.pdf", { type: "application/pdf" }));
  return new Request("http://app.test/knowledge/kb-1/upload?name=notes.pdf", { method: "POST", body: form });
}

describe("an upload Drive refused", () => {
  it.each([
    [507, "drive_full"],
    [409, "drive_reconnect"],
  ])("answers %i %s with its reason", async (status, code) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "refused", code }), { status }));
    const result = await upload.action({ request: multipart(), params: { kbId: "kb-1" } } as never);
    expect(result).toMatchObject({ uploadErrorKey: "errors.uploadFailed", driveReason: code });
  });

  it("carries no reason for any other refusal", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "already there", code: "duplicate" }), { status: 409 }));
    const result = await upload.action({ request: multipart(), params: { kbId: "kb-1" } } as never);
    expect(result).toMatchObject({ uploadErrorKey: "errors.uploadFailed" });
    expect(result).not.toHaveProperty("driveReason");
  });
});
