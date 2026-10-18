/**
 * zotero-types.ts
 * Wire shapes for "Add from Zotero" (internal/api/zoteroapi, up-methods
 * phase 20). Client-safe.
 */
export type ZoteroItem = {
  key: string;
  item_type: string;
  title: string;
  creators: string[];
  year: string;
  publication?: string;
  doi?: string;
  url?: string;
  abstract?: string;
};

export type ZoteroCollection = { key: string; name: string; items: number; subcollections: number };

/** A search, or one level of the collection tree with its items. */
export type ZoteroListData =
  | { ok: true; collections: ZoteroCollection[]; items: ZoteroItem[] }
  | { ok: false; error: string; notConnected: boolean };

export type AddZoteroData =
  | { ok: true; title: string; as_pdf: boolean; note?: string }
  | { ok: false; error: string };
