/**
 * research.server.ts
 * The research feature's thin API module. Server-side only; every call is
 * scoped by an explicit user id.
 */
import { apiFetch } from "~/lib/api.server";
import type { Report, ReportSummary, ResearchMode, StartedTurn } from "~/lib/research-types";

export function startResearch(
  userId: string,
  body: { query: string; mode: ResearchMode; kb_ids?: string[]; allow_web?: boolean },
) {
  return apiFetch<StartedTurn>("/v1/research", userId, { method: "POST", body });
}

export function listReports(userId: string, limit = 20) {
  return apiFetch<{ reports: ReportSummary[] }>(`/v1/research/reports?limit=${limit}`, userId);
}

export function getReport(userId: string, reportId: string) {
  return apiFetch<Report>(`/v1/research/reports/${encodeURIComponent(reportId)}`, userId);
}

export function saveReportNote(userId: string, reportId: string) {
  return apiFetch<{ note_id: string }>(
    `/v1/research/reports/${encodeURIComponent(reportId)}/note`,
    userId,
    { method: "POST" },
  );
}

/** What POST /v1/research/reports/{id}/knowledge answers. */
export type ToKnowledgeResponse = {
  kb_id: string;
  report_added: boolean;
  report_already: boolean;
  sources_added: number;
  sources_already: number;
  sources_failed: number;
};

/** Adds a report, and optionally the pages it cites, to a knowledge base. */
export function addReportToKnowledge(
  userId: string,
  reportId: string,
  body: { kb_id: string; include_sources: boolean },
) {
  return apiFetch<ToKnowledgeResponse>(`/v1/research/reports/${reportId}/knowledge`, userId, {
    method: "POST",
    body,
  });
}
