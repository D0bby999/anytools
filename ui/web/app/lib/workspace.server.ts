/**
 * workspace.server.ts
 * Google Forms and Sheets (learning-tool-connections phase 5): a picked form
 * into a knowledge base's Quiz, a Quiz out to a graded form, a picked sheet
 * into vocabulary. The API does the Google calls under drive.file.
 */
import { apiFetch } from "~/lib/api.server";
import type { FormExport, FormImport, SheetPreview, SheetImport } from "~/lib/workspace-types";

export function importForm(userId: string, kbId: string, formId: string) {
  return apiFetch<FormImport>(`/v1/kb/${encodeURIComponent(kbId)}/forms/import`, userId, {
    method: "POST",
    body: { form_id: formId },
  });
}

export function exportForm(userId: string, kbId: string, title: string) {
  return apiFetch<FormExport>(`/v1/kb/${encodeURIComponent(kbId)}/forms/export`, userId, {
    method: "POST",
    body: { title },
  });
}

export function previewSheet(userId: string, fileId: string) {
  return apiFetch<SheetPreview>("/v1/sheets/preview", userId, { method: "POST", body: { file_id: fileId } });
}

export function importSheet(
  userId: string,
  lang: string,
  body: { file_id: string; term: number; meaning: number; example: number; header: boolean },
) {
  return apiFetch<SheetImport>("/v1/sheets/vocab", userId, { method: "POST", body: { ...body, lang } });
}
