/**
 * stream-proxy.test.ts
 *
 * The resource route is the browser's only door to a stream, and it holds the
 * gateway bearer. Four things have to be true of it, and each of them fails
 * silently if it is not:
 *
 *  - it refuses before forwarding anything when there is no session;
 *  - `topic` is an allowlist, not a path fragment — otherwise the route is an
 *    SSRF primitive aimed at the one host that trusts this process;
 *  - it forwards the resume cursor, both as `after_seq` and as the
 *    `Last-Event-ID` the browser replays on its own reconnect;
 *  - it passes the body through without reading it, and without a transform
 *    that would coalesce frames.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserId = vi.fn();

vi.mock("~/lib/env.server", () => ({
  API_BASE: "http://api.internal:8080",
  API_TOKEN: "gateway-token",
}));

vi.mock("~/lib/auth.server", () => ({
  requireUserId: (request: Request) => requireUserId(request),
}));

const { loader } = await import("~/routes/app.api.stream.$topic.$id");

const TURN = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

function upstreamOK(body = "id: 1\nevent: content\ndata: {}\n\n") {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  }), { status: 200 });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  requireUserId.mockReset().mockResolvedValue(USER);
  fetchMock = vi.fn().mockResolvedValue(upstreamOK());
  vi.stubGlobal("fetch", fetchMock);
});

function request(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

/** The arguments of the single upstream fetch this route is allowed to make. */
function forwarded(): { target: URL; init: RequestInit & { headers: Record<string, string> } } {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error("the route made no upstream request");
  return {
    target: new URL(String(call[0])),
    init: call[1] as RequestInit & { headers: Record<string, string> },
  };
}

describe("stream proxy", () => {
  it("requires a session before forwarding anything", async () => {
    requireUserId.mockRejectedValue(new Response(null, { status: 302 }));

    await expect(
      loader({ request: request("http://app.test/app/api/stream/turns/" + TURN), params: { topic: "turns", id: TURN } }),
    ).rejects.toBeInstanceOf(Response);

    expect(fetchMock, "the upstream was called before the guard ran").not.toHaveBeenCalled();
  });

  it("attaches the gateway bearer and the session's user id", async () => {
    await loader({
      request: request("http://app.test/app/api/stream/turns/" + TURN),
      params: { topic: "turns", id: TURN },
    });

    const { target, init } = forwarded();
    expect(target.toString()).toBe(`http://api.internal:8080/v1/turns/${TURN}/events`);
    expect(init.headers.authorization).toBe("Bearer gateway-token");
    expect(init.headers["X-AnyTools-User-Id"]).toBe(USER);
    expect(init.headers.accept).toBe("text/event-stream");
  });

  it("maps the kb topic onto the knowledge base's event endpoint", async () => {
    const KB = "33333333-3333-3333-3333-333333333333";
    await loader({
      request: request("http://app.test/app/api/stream/kb/" + KB),
      params: { topic: "kb", id: KB },
    });

    const { target, init } = forwarded();
    expect(target.toString()).toBe(`http://api.internal:8080/v1/kb/${KB}/events`);
    // The upstream re-checks ownership, but it can only check it against the
    // user this process asserts — so the assertion has to be forwarded.
    expect(init.headers["X-AnyTools-User-Id"]).toBe(USER);
  });

  it("refuses an unknown topic instead of building a path from it", async () => {
    for (const topic of ["users", "../v1/byok", "", "turns/../secrets"]) {
      fetchMock.mockClear();
      const res = await loader({
        request: request(`http://app.test/app/api/stream/${topic}/${TURN}`),
        params: { topic, id: TURN },
      });
      expect(res.status, topic).toBe(404);
      expect(fetchMock, topic).not.toHaveBeenCalled();
    }
  });

  it("refuses an id that is not a uuid", async () => {
    for (const id of ["1", "abc", "../../health", `${TURN}/../x`]) {
      fetchMock.mockClear();
      const res = await loader({
        request: request(`http://app.test/app/api/stream/turns/${id}`),
        params: { topic: "turns", id },
      });
      expect(res.status, id).toBe(404);
      expect(fetchMock, id).not.toHaveBeenCalled();
    }
  });

  it("forwards a numeric after_seq and nothing else from the query string", async () => {
    await loader({
      request: request(`http://app.test/app/api/stream/turns/${TURN}?after_seq=42&evil=1`),
      params: { topic: "turns", id: TURN },
    });

    const { target } = forwarded();
    expect(target.searchParams.get("after_seq")).toBe("42");
    expect(target.searchParams.get("evil")).toBeNull();
  });

  it("drops a non-numeric after_seq rather than passing it upstream", async () => {
    await loader({
      request: request(`http://app.test/app/api/stream/turns/${TURN}?after_seq=DROP+TABLE`),
      params: { topic: "turns", id: TURN },
    });

    const { target } = forwarded();
    expect(target.searchParams.get("after_seq")).toBeNull();
  });

  /**
   * This is the header the browser sets by itself on a reconnect the
   * application never sees. Not forwarding it means an unattended reconnect
   * replays the whole turn, and the user watches the answer type itself twice.
   */
  it("forwards Last-Event-ID so an unattended reconnect resumes", async () => {
    await loader({
      request: request(`http://app.test/app/api/stream/turns/${TURN}`, { "last-event-id": "17" }),
      params: { topic: "turns", id: TURN },
    });

    expect(forwarded().init.headers["last-event-id"]).toBe("17");
  });

  it("ignores a malformed Last-Event-ID", async () => {
    await loader({
      request: request(`http://app.test/app/api/stream/turns/${TURN}`, { "last-event-id": "abc" }),
      params: { topic: "turns", id: TURN },
    });

    expect(forwarded().init.headers["last-event-id"]).toBeUndefined();
  });

  it("returns the upstream body untouched, with no-transform", async () => {
    const res = await loader({
      request: request(`http://app.test/app/api/stream/turns/${TURN}`),
      params: { topic: "turns", id: TURN },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    await expect(res.text()).resolves.toContain("event: content");
  });

  it("propagates the abort signal so the API drops the subscriber", async () => {
    const controller = new AbortController();
    await loader({
      request: new Request(`http://app.test/app/api/stream/turns/${TURN}`, {
        signal: controller.signal,
      }),
      params: { topic: "turns", id: TURN },
    });
    expect(forwarded().init.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes an upstream refusal through, so the client stops retrying", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    const res = await loader({
      request: request(`http://app.test/app/api/stream/turns/${TURN}`),
      params: { topic: "turns", id: TURN },
    });
    expect(res.status).toBe(404);
  });

  it("answers 503 when the API cannot be reached at all", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await loader({
      request: request(`http://app.test/app/api/stream/turns/${TURN}`),
      params: { topic: "turns", id: TURN },
    });
    expect(res.status).toBe(503);
  });
});
