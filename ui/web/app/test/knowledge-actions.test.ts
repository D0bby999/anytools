// @vitest-environment node
//
// node, not jsdom: the action reads its form through `Request.formData()`, whose
// entries are undici's File objects. Under jsdom the global `File` is jsdom's
// own, so the route's `file instanceof File` check would be false for every
// upload and this suite would "pass" against a route that rejects everything.
/**
 * knowledge-actions.test.ts
 *
 * The knowledge base route's action, which is where the phase-5 UI review found
 * two failures that a screenshot cannot show:
 *
 *  1. an upload was judged by whether a MESSAGE came back, not by the HTTP
 *     status — and the BFF parses the error body with `.catch(() => ({}))`, so
 *     a 413 from a proxy, an HTML 502 or an empty 500 produced no message, fell
 *     through the check and was reported as a successful upload with no new row.
 *     The copy on this very screen promises "up to 50 MB", which makes 413 the
 *     single most likely failure here.
 *  2. reindex and delete threw, which unmounts the whole route through the
 *     error boundary and loses the document list — to report something that
 *     belongs beside one button. A 429 from the embedding provider is the
 *     likeliest failure on this route.
 *
 * Both are asserted below against the real action, with only the API module
 * mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api.internal:8080",
  API_TOKEN: "gateway-token",
  isProduction: false,
}));

const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({
  requireUser: (request: Request) => requireUser(request),
}));

const kb = {
  uploadDocument: vi.fn(),
  deleteDocument: vi.fn(),
  reindexKB: vi.fn(),
  deleteKB: vi.fn(),
  queryKB: vi.fn(),
  getKB: vi.fn(),
  listDocuments: vi.fn(),
};
vi.mock("~/lib/kb.server", () => kb);

const { action } = await import("~/routes/knowledge.$kbId");
const { ApiError } = await import("~/lib/api.server");

const KB_ID = "44444444-4444-4444-4444-444444444444";

// The action's return type is a union of five shapes; asserting on one of them
// is the point of these tests, so the result is read as a plain record rather
// than narrowed five ways at every call site.
type ActionResult = Record<string, string | undefined> | null;

function submit(fields: Record<string, string | File>): Promise<ActionResult> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const args = {
    request: new Request("http://app.test/knowledge/" + KB_ID, { method: "POST", body: form }),
    params: { kbId: KB_ID },
  };
  return action(args as unknown as Parameters<typeof action>[0]) as Promise<ActionResult>;
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  for (const fn of Object.values(kb)) fn.mockReset();
});

describe("upload", () => {
  it("reports a failure the API could not describe", async () => {
    // A proxy's 413: correct status, no JSON body, therefore no message.
    kb.uploadDocument.mockResolvedValue({ status: 413 });

    const result = await submit({ intent: "upload", file: new File(["x"], "big.pdf") });

    expect(result, "a 413 with no message was reported as a successful upload").toMatchObject({
      uploadErrorKey: "errors.uploadFailed",
    });
    expect(result?.uploadErrorDetail).toContain("big.pdf");
  });

  it("passes the API's own sentence through when there is one", async () => {
    kb.uploadDocument.mockResolvedValue({ status: 415, error: "that file type is not supported" });

    const result = await submit({ intent: "upload", file: new File(["x"], "notes.key") });

    expect(result?.uploadErrorKey).toBe("errors.uploadFailed");
    expect(result?.uploadErrorDetail).toBe("notes.key: that file type is not supported");
  });

  it("accepts a 202", async () => {
    kb.uploadDocument.mockResolvedValue({ status: 202 });

    expect(await submit({ intent: "upload", file: new File(["x"], "rag.pdf") })).toEqual({
      uploaded: "rag.pdf",
    });
  });

  it("asks for a file when none was chosen", async () => {
    expect(await submit({ intent: "upload" })).toMatchObject({ uploadErrorKey: "errors.chooseFile" });
    expect(kb.uploadDocument).not.toHaveBeenCalled();
  });
});

describe("reindex", () => {
  it("returns a rate limit beside the button instead of throwing", async () => {
    kb.reindexKB.mockRejectedValue(new ApiError(429, "slow down", "rate_limited"));

    const result = await submit({ intent: "reindex" });

    expect(result).toMatchObject({ actionErrorKey: "errors.reindexFailed", actionErrorDetail: "slow down" });
  });

  it("returns null when it worked", async () => {
    kb.reindexKB.mockResolvedValue({ job_id: "job-1" });
    expect(await submit({ intent: "reindex" })).toBeNull();
  });
});

describe("delete", () => {
  it("treats a missing document as the outcome the user asked for", async () => {
    kb.deleteDocument.mockRejectedValue(new ApiError(404, "not found", "not_found"));
    expect(await submit({ intent: "delete-document", documentId: "doc-1" })).toBeNull();
  });

  it("reports any other failure rather than throwing", async () => {
    kb.deleteDocument.mockRejectedValue(new ApiError(503, "API unreachable", "api_unreachable"));

    expect(await submit({ intent: "delete-document", documentId: "doc-1" })).toMatchObject({
      actionErrorKey: "errors.deleteFailed",
    });
  });

  it("reports a failed knowledge base delete instead of redirecting into a 404", async () => {
    kb.deleteKB.mockRejectedValue(new ApiError(500, "something went wrong", "internal"));

    expect(await submit({ intent: "delete-kb" })).toMatchObject({
      actionErrorKey: "errors.deleteKbFailed",
    });
  });

  it("redirects when the knowledge base really is gone", async () => {
    kb.deleteKB.mockResolvedValue(undefined);

    await expect(submit({ intent: "delete-kb" })).rejects.toMatchObject({ status: 302 });
  });
});

describe("query", () => {
  it("asks for a question before running a search", async () => {
    expect(await submit({ intent: "query", query: "   " })).toMatchObject({
      queryErrorKey: "errors.emptyQuery",
    });
    expect(kb.queryKB).not.toHaveBeenCalled();
  });

  it("carries the API's reason for refusing a search", async () => {
    kb.queryKB.mockRejectedValue(
      new ApiError(409, "this knowledge base's embedding model changed", "needs_reembed"),
    );

    expect(await submit({ intent: "query", query: "what is rrf" })).toMatchObject({
      queryErrorKey: "errors.queryFailed",
      queryErrorDetail: "this knowledge base's embedding model changed",
    });
  });
});

/**
 * Every i18n key this surface can return must exist.
 *
 * The structural guard only follows LITERAL `t("…")` calls, and these keys are
 * chosen in the action and translated through a variable — exactly the shape
 * that ships a raw key string as visible gibberish.
 */
describe("the error keys the action can return all exist", () => {
  const bundle = JSON.parse(
    readFileSync(join(resolve(process.cwd()), "public/locales/en/knowledge.json"), "utf8"),
  ) as { errors: Record<string, string> };

  const sources = [
    "app/routes/knowledge.$kbId.tsx",
    "app/components/knowledge/upload-dropzone.tsx",
    "app/components/knowledge/retrieval-debug.tsx",
  ];

  it("finds keys to check", () => {
    expect(Object.keys(bundle.errors).length).toBeGreaterThan(0);
  });

  it.each(sources)("%s", (file) => {
    const src = readFileSync(join(resolve(process.cwd()), file), "utf8");
    const keys = [...src.matchAll(/"errors\.([a-zA-Z]+)"/g)].map((m) => m[1] ?? "");
    for (const key of keys) {
      expect(bundle.errors[key], `knowledge:errors.${key} is missing from the en bundle`).toBeTypeOf(
        "string",
      );
    }
  });
});
