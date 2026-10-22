/**
 * showcase/api.server.ts
 * The public profile's calls to the API (the private design notes).
 * The learner's own page goes as the learner; a visitor's read goes with the
 * gateway bearer and no user (POST /v1/showcase/read is gateway-only), and
 * only a published page answers.
 */
import { apiFetch } from "~/lib/api.server";
import { API_BASE, API_TOKEN } from "~/lib/env.server";
import type { Design, MyShowcase, ShowcasePage, ShowcaseProfile } from "~/lib/showcase/design";

export function getMyShowcase(userId: string) {
  return apiFetch<MyShowcase>("/v1/showcase", userId);
}

export type ShowcaseInput = { handle: string; name: string; headline: string; published: boolean; indexed: boolean; design: Design };

export function saveShowcase(userId: string, input: ShowcaseInput) {
  return apiFetch<ShowcaseProfile>("/v1/showcase", userId, { method: "PUT", body: input });
}

export function deleteShowcase(userId: string) {
  return apiFetch<void>("/v1/showcase", userId, { method: "DELETE" });
}

/**
 * Pages read in the last half minute, shared by the page and its card, so a
 * link opened by a whole group chat reads once. Bounded; a page unpublished
 * stops answering within the half minute.
 */
const READ_MS = 30_000;
const KEEP = 500;
const recent = new Map<string, { at: number; page: ShowcasePage | null }>();

/** Tests read each page afresh. */
export function __forgetShowcaseReadsForTests(): void {
  recent.clear();
}

/** A published page, or null for a handle with none. */
export async function readShowcase(handle: string): Promise<ShowcasePage | null> {
  const hit = recent.get(handle);
  if (hit && Date.now() - hit.at < READ_MS) return hit.page;
  const page = await fetchShowcase(handle);
  if (recent.size >= KEEP) recent.delete(recent.keys().next().value!);
  recent.set(handle, { at: Date.now(), page });
  return page;
}

async function fetchShowcase(handle: string): Promise<ShowcasePage | null> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/showcase/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}) },
      body: JSON.stringify({ handle }),
    });
  } catch {
    throw new Response("Unavailable", { status: 503 });
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Response("Unavailable", { status: 503 });
  return (await res.json()) as ShowcasePage;
}

/**
 * The published pages whose learners let search engines list them, for the
 * sitemap: handles and when each last changed. Empty, not an error, when the
 * API cannot be reached, so the sitemap still lists the site's own pages.
 */
export async function listIndexedShowcases(): Promise<{ handle: string; updated_at: string }[]> {
  try {
    const res = await fetch(`${API_BASE}/v1/showcase/listed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}) },
      body: "{}",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    return ((await res.json()) as { pages: { handle: string; updated_at: string }[] }).pages ?? [];
  } catch {
    return [];
  }
}
