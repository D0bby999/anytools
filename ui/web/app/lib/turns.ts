/**
 * turns.ts
 *
 * Turn-status predicates shared by the route and its tests.
 *
 * It is NOT a `.server.ts` module and holds no imports on purpose: the route it
 * serves pulls in the API client (and therefore the gateway token), so a test
 * that wanted to exercise this logic through the route would have to boot the
 * whole server environment to check a list filter.
 */

/** The statuses a turn can hold, mirroring the Go enum. */
export type TurnStatus =
  | "queued"
  | "running"
  | "waiting_user"
  | "done"
  | "failed"
  | "cancelled";

/**
 * Non-terminal statuses: the server is still working on, or waiting for,
 * something the user should be watching.
 */
const LIVE: readonly TurnStatus[] = ["queued", "running", "waiting_user"];

export function isLiveStatus(status: string): boolean {
  return (LIVE as readonly string[]).includes(status);
}

/**
 * The turn to re-attach a stream to after a page load, or null.
 *
 * This is what makes "refresh mid-stream resumes" work. After F5 the browser
 * has no memory of the turn it was watching, but the server does: the session's
 * turn list comes back newest-first, so the first non-terminal entry is the one
 * still in flight. Without this the user sees a frozen page with no stop button
 * and no answer until they reload a second time.
 */
export function liveTurnID(turns: readonly { id: string; status: string }[]): string | null {
  return turns.find((t) => isLiveStatus(t.status))?.id ?? null;
}

/**
 * The uuid shape every id interpolated into an API path must have.
 *
 * React Router decodes `%2F` before a loader sees a param, so an id like
 * `..%2F..%2Fme` becomes a path with `..` segments that `fetch` then normalises
 * — reaching a different internal endpoint with this process's own gateway
 * token attached. The blast radius is limited to the same authenticated user,
 * but it is a path-injection primitive aimed at the one host on the network
 * that trusts this server, and it costs one regex to close. The stream proxy
 * route already does exactly this.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: string): boolean {
  return UUID.test(value);
}

/** Throws a 404 Response for anything that is not a uuid. */
export function requireUUID(value: string): string {
  if (!isUUID(value)) throw new Response("not found", { status: 404 });
  return value;
}
