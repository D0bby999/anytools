/**
 * library/api.server.ts
 * The Library's catalogue from the API (the private design notes): the page's lists, its first screen by field, and one item, all
 * answered from Postgres. Server-side only.
 */
import { ApiError, apiFetch } from "~/lib/api.server";
import type { LibraryFilter, LibraryItem, LibrarySubject } from "~/lib/library/types";

export type FieldGroup = { subject: LibrarySubject; total: number; items: LibraryItem[] };

/** The query string for a filter; ui is the learner's interface language. */
function query(filter: LibraryFilter, ui: string) {
  const p = new URLSearchParams({ ui });
  if (filter.kind) p.set("kind", filter.kind);
  if (filter.subject) p.set("subject", filter.subject);
  if (filter.lang) p.set("lang", filter.lang);
  if (filter.q) p.set("q", filter.q);
  if (filter.sort && filter.sort !== "featured") p.set("sort", filter.sort);
  if (filter.level) p.set("level", filter.level);
  if (filter.certificate) p.set("certificate", filter.certificate);
  if (filter.video) p.set("video", "1");
  if (filter.reusable) p.set("reusable", "1");
  if (filter.offset) p.set("offset", String(filter.offset));
  return p.toString();
}

/** One page of a list: a field, a search, or every item. */
export function findItems(userId: string, filter: LibraryFilter, ui: string) {
  return apiFetch<{ total: number; items: LibraryItem[]; languages: string[] }>(`/v1/library/items?${query(filter, ui)}`, userId);
}

/** The first screen: each field's first items and how many it has. */
export function findByField(userId: string, filter: LibraryFilter, ui: string) {
  return apiFetch<{ total: number; groups: FieldGroup[]; languages: string[] }>(`/v1/library/fields?${query(filter, ui)}`, userId);
}

/** One item, or null when the catalogue has no such id. */
export async function libraryItem(userId: string, id: string): Promise<LibraryItem | null> {
  try {
    return await apiFetch<LibraryItem>(`/v1/library/items/${encodeURIComponent(id)}`, userId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
