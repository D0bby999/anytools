/** Mirrors appconn.Status. */
export type AppStatus = { id: "canva" | "notion"; configured: boolean; connected: boolean; account?: string; needs_reconnect: boolean };

/** Mirrors canva.Design. */
export type CanvaDesign = { id: string; title: string; thumbnail?: string; edit_url?: string; updated_at?: number };

/** Mirrors notion.Item. */
export type NotionPage = { id: string; kind: "page" | "database"; title: string; url: string; last_edited: string; imported: boolean };

/** Mirrors appsapi's importedView. */
export type NotionImported = { page_id: string; title: string; kb_id: string; gone: boolean; error?: string; synced_at?: string };

/** What the Learning apps action answers for Canva and Notion. */
export type AppsResult =
  | { intent: "canva-search"; ok: true; designs: CanvaDesign[] }
  | { intent: "canva-import"; ok: true; title: string; kbId: string }
  | { intent: "notion-import"; ok: true; imported: number; failed: number; kbId: string }
  | { intent: "notion-sync"; ok: true; changed: number }
  | { intent: "app-disconnect"; ok: true }
  | { intent: string; ok: false; error: string };

export const APP_NOTICES = ["connected", "denied", "failed", "unavailable"] as const;

/** `?app=canva-connected` and the like, or null. */
export function parseAppNotice(v: string | null): { provider: "canva" | "notion"; notice: (typeof APP_NOTICES)[number] } | null {
  const m = /^(canva|notion)-(\w+)$/.exec(v ?? "");
  if (!m || !(APP_NOTICES as readonly string[]).includes(m[2]!)) return null;
  return { provider: m[1] as "canva" | "notion", notice: m[2] as (typeof APP_NOTICES)[number] };
}
