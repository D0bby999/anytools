// @vitest-environment node
/**
 * media-upload-server.test.ts
 * Up-methods phase 15, the BFF side: an upload is piped to the API as a
 * stream (never `request.formData()`), with the browser's own multipart type
 * and boundary, and a body over the API's cap is refused before any fetch; a
 * recording is proxied with the player's Range header and the API's
 * nosniff and type headers.
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

const { streamUpload, fetchRecording, MAX_UPLOAD_REQUEST } = await import("~/lib/kb.server");
const upload = await import("~/routes/knowledge.$kbId.upload");
const media = await import("~/routes/documents.$docId.media");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1" } });
});
afterEach(() => vi.unstubAllGlobals());

function multipart(): Request {
  const form = new FormData();
  form.set("intent", "upload");
  form.set("file", new File(["ID3 audio"], "class.mp3", { type: "audio/mpeg" }));
  return new Request("http://app.test/knowledge/kb-1/upload?name=class.mp3", { method: "POST", body: form });
}

describe("streamUpload", () => {
  it("pipes the body to the API without parsing it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ document: {} }), { status: 202 }));
    const req = multipart();
    const formData = vi.spyOn(req, "formData");
    const type = req.headers.get("Content-Type")!;

    expect(await streamUpload("user-1", "kb-1", req)).toEqual({ status: 202 });
    expect(formData).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { duplex?: string }];
    expect(url).toBe("http://api.internal:8080/v1/kb/kb-1/documents");
    expect(init.duplex).toBe("half");
    expect(init.body).toBeInstanceOf(ReadableStream);
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe(type);
    expect(headers["X-AnyTools-User-Id"]).toBe("user-1");
    // The bytes reach the API as the browser sent them.
    const sent = await new Response(init.body as ReadableStream).text();
    expect(sent).toContain('filename="class.mp3"');
    expect(sent).toContain("ID3 audio");
  });

  it("refuses an oversized body before fetching, and a non-multipart one", async () => {
    const big = new Request("http://app.test/x", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=x", "Content-Length": String(MAX_UPLOAD_REQUEST + 1) },
      body: "x",
    });
    expect((await streamUpload("user-1", "kb-1", big)).status).toBe(413);
    const json = new Request("http://app.test/x", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    expect((await streamUpload("user-1", "kb-1", json)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the API's refusal with the file's name through the route", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "that file type is not supported" }), { status: 415 }));
    const result = await upload.action({ request: multipart(), params: { kbId: "kb-1" } } as never);
    expect(result).toEqual({
      uploadErrorKey: "errors.uploadFailed",
      uploadErrorDetail: "class.mp3: that file type is not supported",
    });
  });
});

describe("fetchRecording", () => {
  it("forwards Range and returns the API's 206 with its headers", async () => {
    fetchMock.mockResolvedValue(
      new Response("abc", {
        status: 206,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Range": "bytes 0-2/10",
          "X-Content-Type-Options": "nosniff",
          "Set-Cookie": "x=y",
        },
      }),
    );
    const req = new Request("http://app.test/documents/doc-m/media", { headers: { Range: "bytes=0-2" } });
    const res = await media.loader({ request: req, params: { docId: "doc-m" } } as never);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.internal:8080/v1/documents/doc-m/media");
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-2");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(await res.text()).toBe("abc");
  });

  it("passes another learner's 404 through", async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"not found"}', { status: 404 }));
    const res = await fetchRecording("user-1", "doc-x", new Request("http://app.test/documents/doc-x/media"));
    expect(res.status).toBe(404);
  });
});
