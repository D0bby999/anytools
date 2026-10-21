/**
 * mine.ts
 * Types and rules shared by the "Mine" pages and their server loader.
 */
import type { KBDocument } from "~/lib/kb-types";

export type MineKB = { id: string; name: string };
export type MineDocument = KBDocument & { kb_name: string };

/**
 * A link is anything AnyLearn fetched from an address (a web page, a YouTube
 * video, a page of a followed site, a file of a repository); a file is
 * something the learner uploaded.
 */
export function isLinkDocument(doc: Pick<KBDocument, "source_url" | "site_id" | "repo_id" | "source_kind">): boolean {
  return Boolean(doc.source_url || doc.site_id || doc.repo_id) || ["web", "youtube", "site_page", "repo_file"].includes(doc.source_kind);
}

/** The host of a link, for the Source column: "en.wikipedia.org". */
export function linkHost(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
