/**
 * app.api.zotero.ts
 * Resource route: a knowledge base's "Add from Zotero" (up-methods phase 20).
 *
 * - The loader searches the learner's library (`?kb=&q=`) or lists one level
 *   of its collections (`?kb=&collection=`, empty for the top level). Fetched
 *   only when the learner asks: each is a call on their own Zotero key.
 * - The action adds one item by its key; the API re-reads the item itself.
 *
 * Both call requireUserId; the API checks the knowledge base is the user's
 * before it reads the key or calls Zotero.
 */
import type { Route } from "./+types/app.api.zotero";
import { requireUserId } from "~/lib/auth.server";
import { ApiError, apiFetch } from "~/lib/api.server";
import type { AddZoteroData, ZoteroCollection, ZoteroItem, ZoteroListData } from "~/lib/zotero-types";

const kbPath = (kb: string) => `/v1/kb/${encodeURIComponent(kb)}/zotero`;

export async function loader({ request }: Route.LoaderArgs): Promise<ZoteroListData> {
  const userId = await requireUserId(request);
  const url = new URL(request.url);
  const kb = url.searchParams.get("kb") ?? "";
  const q = url.searchParams.get("q");
  try {
    if (q !== null) {
      const res = await apiFetch<{ items: ZoteroItem[] }>(`${kbPath(kb)}/search?q=${encodeURIComponent(q)}`, userId);
      return { ok: true, collections: [], items: res.items };
    }
    const collection = url.searchParams.get("collection") ?? "";
    const res = await apiFetch<{ collections: ZoteroCollection[]; items: ZoteroItem[] }>(
      `${kbPath(kb)}/collections?collection=${encodeURIComponent(collection)}`,
      userId,
    );
    return { ok: true, collections: res.collections, items: res.items };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.message, notConnected: error.code === "zotero_not_connected" };
    }
    throw error;
  }
}

export async function action({ request }: Route.ActionArgs): Promise<AddZoteroData> {
  const userId = await requireUserId(request);
  const form = await request.formData();
  try {
    const added = await apiFetch<{ title: string; as_pdf: boolean; note?: string }>(
      `${kbPath(String(form.get("kb") ?? ""))}/items`,
      userId,
      { method: "POST", body: { item_key: String(form.get("key") ?? "") } },
    );
    return { ok: true, ...added };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    throw error;
  }
}
