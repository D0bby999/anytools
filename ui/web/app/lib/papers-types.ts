/**
 * papers-types.ts
 * Wire shapes for related papers (internal/api/relatedapi). Client-safe.
 */
export type Paper = {
  id: string;
  source: "openalex" | "arxiv";
  doi?: string;
  title: string;
  authors: string[];
  year?: number;
  citations: number;
  url: string;
  abstract?: string;
  open_access: boolean;
  license?: string;
  pdf_url?: string;
};

export type RelatedList = { focus: string; queries: string[]; papers: Paper[]; fallback: boolean; at: string };

export type RelatedData =
  | { ok: true; list: RelatedList }
  | { ok: false; error: string };

export type AddPaperData = { ok: true; title: string; as_pdf: boolean } | { ok: false; error: string };
