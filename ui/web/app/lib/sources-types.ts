/**
 * sources-types.ts
 * Documentation sites and GitHub repositories (up-methods phase 18): the
 * shapes `internal/api/sourceapi` returns, and the small pure helpers the
 * knowledge base page renders them with.
 */
import type { DriveReason } from "~/lib/drive-storage";

export type SiteStatus = "queued" | "crawling" | "ready" | "failed" | "cancelled";
export type RepoStatus = "queued" | "syncing" | "ready" | "failed";
export type PageStatus = "pending" | "added" | "changed" | "unchanged" | "skipped" | "failed" | "removed";

/** Mirrors internal/knowledge.Site. */
export type Site = {
  id: string;
  kb_id: string;
  start_url: string;
  path_prefix: string;
  max_depth: number;
  max_pages: number;
  title: string;
  status: SiteStatus;
  error?: string;
  job_id?: string;
  generation: number;
  last_crawled_at?: string;
  /** Pages the current crawl has found, and finished. */
  found: number;
  done: number;
  documents: number;
  removed: number;
};

/** Mirrors internal/knowledge.SitePage. */
export type SitePage = {
  url: string;
  depth: number;
  ord?: number;
  status: PageStatus;
  reason?: string;
  document_id?: string;
  title?: string;
  document_status?: string;
  removed_at?: string;
};

/** Mirrors internal/knowledge.Repo. */
export type Repo = {
  id: string;
  kb_id: string;
  owner: string;
  name: string;
  branch: string;
  resolved_branch?: string;
  path_prefix: string;
  extensions: string[];
  ignore_paths: string[];
  status: RepoStatus;
  error?: string;
  note?: string;
  job_id?: string;
  commit_sha?: string;
  file_count: number;
  last_synced_at?: string;
  removed: number;
};

export type SiteLimits = { default_depth: number; max_depth: number; default_pages: number; max_pages: number };

export type RepoDefaults = {
  doc_extensions: string[];
  code_extensions: string[];
  max_file_bytes: number;
  max_files: number;
  max_repo_bytes: number;
};

/** What the knowledge base page loads for its sources section. */
export type SourcesData = {
  sites: Site[];
  repos: Repo[];
  limits: SiteLimits;
  defaults: RepoDefaults;
};

/** The resource route's answer to an action. */
export type SourceActionData =
  | { ok: true; intent: string; title?: string }
  | { ok: false; intent: string; error: string; driveReason?: DriveReason };

/** A site or repository something is still working on. */
export function siteWorking(site: Site): boolean {
  return site.status === "queued" || site.status === "crawling";
}

export function repoWorking(repo: Repo): boolean {
  return repo.status === "queued" || repo.status === "syncing";
}

/**
 * The crawl's progress, 0-100. The frontier grows while pages are read, so
 * the bar can step back; it never claims more than the pages finished.
 */
export function crawlPercent(site: Site): number {
  if (site.status === "ready") return 100;
  if (site.found <= 0) return 0;
  return Math.min(100, Math.round((site.done / site.found) * 100));
}

/** Splits a comma, space or newline list typed by the learner. */
export function splitList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The first seven characters of a commit, as GitHub shows it. */
export function shortSHA(sha?: string): string {
  return sha ? sha.slice(0, 7) : "";
}
