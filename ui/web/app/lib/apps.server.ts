/**
 * apps.server.ts
 * Canva and Notion on Learning apps (learning-tool-connections phases 8, 9).
 */
import { apiFetch } from "~/lib/api.server";
import type { AppStatus, CanvaDesign, NotionImported, NotionPage } from "~/lib/apps-types";

export function appStatus(userId: string, provider: "canva" | "notion") {
  return apiFetch<AppStatus>(`/v1/apps/${provider}`, userId);
}

export function disconnectApp(userId: string, provider: "canva" | "notion") {
  return apiFetch<{ connected: boolean }>(`/v1/apps/${provider}`, userId, { method: "DELETE" });
}

export function canvaDesigns(userId: string, query: string) {
  return apiFetch<{ designs: CanvaDesign[]; continuation?: string }>(
    `/v1/canva/designs?query=${encodeURIComponent(query)}`,
    userId,
  );
}

export function canvaImport(userId: string, kbId: string, designId: string) {
  return apiFetch<{ document_id: string; kb_id: string; title: string }>(`/v1/kb/${encodeURIComponent(kbId)}/canva/import`, userId, {
    method: "POST",
    body: { design_id: designId },
  });
}

export function notionPages(userId: string, query = "") {
  return apiFetch<{ pages: NotionPage[]; imported: NotionImported[] }>(`/v1/notion/pages?query=${encodeURIComponent(query)}`, userId);
}

export function notionImport(userId: string, kbId: string, pageIds: string[]) {
  return apiFetch<{ imported: number; failed: number }>(`/v1/kb/${encodeURIComponent(kbId)}/notion/import`, userId, {
    method: "POST",
    body: { page_ids: pageIds },
  });
}

export function notionSync(userId: string) {
  return apiFetch<{ changed: number }>("/v1/notion/sync", userId, { method: "POST", body: {} });
}
