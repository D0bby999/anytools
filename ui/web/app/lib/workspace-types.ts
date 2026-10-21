/** Mirrors gforms.ImportReport. */
export type FormImport = { title: string; added: number; already: number; skipped: number };

/** Mirrors gforms.ExportReport. */
export type FormExport = { form_id: string; responder_uri: string; edit_uri: string; questions: number; skipped: number };

/** POST /v1/sheets/preview. */
export type SheetPreview = { name: string; rows: string[][]; total: number; max: number };

/** Mirrors vocab.ImportResult. */
export type SheetImport = { created: number; duplicates: number; invalid: number; over_limit?: number; first_day?: string; last_day?: string };

/** What the Learning apps action answers for these intents. */
export type WorkspaceResult =
  | { intent: "forms-import"; ok: true; report: FormImport }
  | { intent: "forms-export"; ok: true; report: FormExport }
  | { intent: "sheet-preview"; ok: true; fileId: string; preview: SheetPreview }
  | { intent: "sheet-import"; ok: true; report: SheetImport }
  | { intent: string; ok: false; error: string };

export const FORM_MIME = "application/vnd.google-apps.form";
export const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
