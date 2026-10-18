/**
 * app.api.related.ts
 * Resource route: a knowledge base's related papers (learning depth, phase 6).
 *
 * - The loader lists them (`?kb=&focus=`). It is fetched when the learner asks,
 *   never on page load: a fresh list is a model call and three paper searches
 *   (the API caches it for a day).
 * - The action adds one by its OpenAlex id; the API re-reads the paper itself.
 *
 * Both call requireUserId; the API checks the knowledge base is the user's.
 */
import type { Route } from "./+types/app.api.related";
import { requireUserId } from "~/lib/auth.server";
import { ApiError, apiFetch } from "~/lib/api.server";
import type { AddPaperData, RelatedData, RelatedList } from "~/lib/papers-types";

const kbPath = (kb: string) => `/v1/kb/${encodeURIComponent(kb)}`;

export async function loader({ request }: Route.LoaderArgs): Promise<RelatedData> {
  const userId = await requireUserId(request);
  const url = new URL(request.url);
  const kb = url.searchParams.get("kb") ?? "";
  const focus = url.searchParams.get("focus") ?? "";
  try {
    const list = await apiFetch<RelatedList>(`${kbPath(kb)}/related-papers?focus=${encodeURIComponent(focus)}`, userId);
    return { ok: true, list };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function action({ request }: Route.ActionArgs): Promise<AddPaperData> {
  const userId = await requireUserId(request);
  const form = await request.formData();
  try {
    const added = await apiFetch<{ title: string; as_pdf: boolean }>(`${kbPath(String(form.get("kb") ?? ""))}/papers`, userId, {
      method: "POST",
      body: { openalex_id: String(form.get("id") ?? "") },
    });
    return { ok: true, ...added };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    throw error;
  }
}
