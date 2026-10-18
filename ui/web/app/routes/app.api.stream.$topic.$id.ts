/**
 * app.api.stream.$topic.$id.ts
 *
 * The browser's ONLY door to a server-sent event stream.
 *
 * Why a proxy at all, when Spike D measured that calling Go directly is also
 * fine: the trust boundary (docs/architecture.md). The Go API's port is never
 * published and the browser has no route to it, so a stream has to arrive
 * through this server — and this server is the only process that holds the
 * gateway bearer and knows which user the session belongs to. An EventSource
 * cannot set headers, so same-origin cookie auth is the only mechanism a
 * browser-native stream can use.
 *
 * Measured through exactly this path (reports/spike-stream-retrieval.md §SSE):
 * 11.9 ms median TTFB, and a 400 ms producer arrives at 395.8/401.3/415.9 ms
 * inter-event — the Node adapter does not buffer, as long as nothing here
 * reads the body.
 *
 * `topic` is a fixed allowlist rather than a path fragment forwarded upstream.
 * A route that appended an arbitrary segment to the API URL would be a
 * server-side request forgery primitive pointed at the one host on the network
 * that trusts this process.
 */
import { API_BASE, API_TOKEN } from "~/lib/env.server";
import { USER_ID_HEADER } from "~/lib/api.server";
import { requireUserId } from "~/lib/auth.server";

/** Streamable topics and how each maps onto an upstream path. */
const TOPICS: Record<string, (id: string) => string> = {
  // Phase 6: one turn's events.
  turns: (id) => `/v1/turns/${id}/events`,
  // Phase 5's document lifecycle, added at the wiring merge. The upstream
  // endpoint checks knowledge-base ownership itself; the session guard below is
  // what decides WHICH user it is checked against.
  kb: (id) => `/v1/kb/${id}/events`,
};

/** Only a uuid may reach the upstream path. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { topic?: string; id?: string };
}) {
  // The session guard runs BEFORE anything is forwarded. Without it this route
  // would stream any turn to anyone who could guess an id, using this
  // process's own credentials to fetch it.
  const userId = await requireUserId(request);

  const topic = params.topic ?? "";
  const id = params.id ?? "";
  const buildPath = TOPICS[topic];
  if (!buildPath || !UUID.test(id)) {
    return new Response("not found", { status: 404 });
  }

  const target = new URL(API_BASE + buildPath(id));

  // Only the resume cursor is forwarded. Copying the whole query string would
  // let a caller append parameters to an internal endpoint.
  const afterSeq = new URL(request.url).searchParams.get("after_seq");
  if (afterSeq && /^\d{1,19}$/.test(afterSeq)) {
    target.searchParams.set("after_seq", afterSeq);
  }

  // Last-Event-ID is what the browser replays on ITS OWN reconnect — the one
  // the application never sees. Forwarding it is what makes a dropped
  // connection resume gap-free with no client code at all.
  const lastEventId = request.headers.get("last-event-id");

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: {
        accept: "text/event-stream",
        ...(API_TOKEN ? { authorization: `Bearer ${API_TOKEN}` } : {}),
        [USER_ID_HEADER]: userId,
        ...(lastEventId && /^\d{1,19}$/.test(lastEventId) ? { "last-event-id": lastEventId } : {}),
      },
      // Propagating the abort is what closes the upstream connection when the
      // browser navigates away; without it the API keeps a subscriber and a
      // goroutine for a client that is gone.
      signal: request.signal,
    });
  } catch {
    return new Response("stream unavailable", { status: 503 });
  }

  if (!upstream.ok || !upstream.body) {
    // Forward the status so the client can tell "not yours" (404) from "the
    // API is down" (503) instead of retrying forever against a 404.
    return new Response(null, { status: upstream.status === 200 ? 502 : upstream.status });
  }

  // The body is passed through UNTOUCHED. Awaiting it, or letting a transform
  // layer see it, is exactly the buffering that turns a live stream into one
  // delivery at the end — hence `no-transform` on the way out too.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
