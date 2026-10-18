// @vitest-environment node
/**
 * drive-upload-notices-server.test.ts
 * Drive-user-storage phase 5, the BFF side: every upload action passes on
 * the code the API answers when the learner's Drive refuses a file
 * (drive_reconnect, drive_file_removed, drive_full), so each form can say
 * why. Any other refusal carries no reason. Only fetch and the session are
 * mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api.internal:8080",
  API_TOKEN: "gateway-token",
  isProduction: false,
  GOOGLE_API_KEY: "browser-api-key",
  GOOGLE_PICKER_APP_ID: "123456789012",
  driveConfigured: () => true,
}));
const requireUser = vi.fn();
const requireUserId = vi.fn();
vi.mock("~/lib/auth.server", () => ({
  requireUser: (request: Request) => requireUser(request),
  requireUserId: (request: Request) => requireUserId(request),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { action: kbAction } = await import("~/routes/knowledge.$kbId");
const { action: examsAction } = await import("~/routes/quiz.exams");
const { action: sourcesAction } = await import("~/routes/app.api.sources");
const { action: recordingAction } = await import("~/routes/toolkit.$id.recordings");

const KB_ID = "44444444-4444-4444-4444-444444444444";

beforeEach(() => {
  fetchMock.mockReset();
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  requireUserId.mockReset().mockResolvedValue("user-1");
});

/** Every API call answers status with this code. */
function answer(status: number, code: string) {
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ error: "refused", code }), { status, headers: { "Content-Type": "application/json" } }),
  );
}

function form(fields: Record<string, string | File>, url: string): Request {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request(url, { method: "POST", body });
}

const paper = () => new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" });

type Submit = () => Promise<unknown>;

const surfaces: [string, Submit][] = [
  [
    "an exam paper upload",
    () => examsAction({ request: form({ intent: "upload", file: paper() }, "http://app.test/quiz/exams"), params: {} } as never),
  ],
  [
    "Add a link",
    () =>
      kbAction({
        request: form({ intent: "add-link", url: "https://example.com/notes" }, `http://app.test/knowledge/${KB_ID}`),
        params: { kbId: KB_ID },
      } as never),
  ],
  [
    "Add a site",
    () =>
      sourcesAction({
        request: form({ intent: "add-site", kb: KB_ID, url: "https://docs.example.com/" }, "http://app.test/app/api/sources"),
        params: {},
      } as never),
  ],
  [
    "Add a repository",
    () =>
      sourcesAction({
        request: form({ intent: "add-repo", kb: KB_ID, url: "https://github.com/acme/docs" }, "http://app.test/app/api/sources"),
        params: {},
      } as never),
  ],
  [
    "a Drive import",
    () =>
      kbAction({
        request: form(
          { intent: "drive-import", picked: JSON.stringify([{ id: "a", kind: "file" }]) },
          `http://app.test/knowledge/${KB_ID}`,
        ),
        params: { kbId: KB_ID },
      } as never),
  ],
  [
    "several photos as one document",
    () => {
      const body = new FormData();
      body.set("intent", "upload");
      body.set("one_document", "true");
      body.append("file", new File(["a"], "p1.jpg", { type: "image/jpeg" }));
      body.append("file", new File(["b"], "p2.jpg", { type: "image/jpeg" }));
      return kbAction({
        request: new Request(`http://app.test/knowledge/${KB_ID}`, { method: "POST", body }),
        params: { kbId: KB_ID },
      } as never);
    },
  ],
  [
    "several separate files",
    () => {
      const body = new FormData();
      body.set("intent", "upload");
      body.append("file", new File(["a"], "a.md", { type: "text/markdown" }));
      body.append("file", new File(["b"], "b.md", { type: "text/markdown" }));
      return kbAction({
        request: new Request(`http://app.test/knowledge/${KB_ID}`, { method: "POST", body }),
        params: { kbId: KB_ID },
      } as never);
    },
  ],
];

describe.each(surfaces)("%s", (_name, submit) => {
  it.each([
    [409, "drive_reconnect"],
    [410, "drive_file_removed"],
    [507, "drive_full"],
  ])("passes on %i %s", async (status, code) => {
    answer(status, code);
    expect(await submit()).toMatchObject({ driveReason: code });
  });

  it("carries no reason for any other refusal", async () => {
    answer(409, "duplicate");
    expect(await submit()).not.toHaveProperty("driveReason");
  });
});

describe("a worksheet recording take", () => {
  it("passes the API's answer, code and all, to the recorder", async () => {
    answer(409, "drive_reconnect");
    const res = (await recordingAction({
      request: form(
        { audio: new File(["take"], "take.webm", { type: "audio/webm" }), duration_seconds: "3.0" },
        "http://app.test/toolkit/w1/recordings",
      ),
      params: { id: "w1" },
    } as never)) as Response;
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "drive_reconnect" });
  });
});

describe("a Drive import that kept some files", () => {
  it("passes each refused file's code on in the report", async () => {
    const report = {
      kb_id: KB_ID,
      imported: 0,
      failed: 1,
      items: [{ file_id: "a", name: "a.pdf", kind: "file", state: "active", error: "x", code: "drive_full" }],
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(report), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await kbAction({
      request: form({ intent: "drive-import", picked: JSON.stringify([{ id: "a", kind: "file" }]) }, `http://app.test/knowledge/${KB_ID}`),
      params: { kbId: KB_ID },
    } as never);
    expect(result).toEqual({ driveReport: report });
  });
});
