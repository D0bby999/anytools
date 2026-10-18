/**
 * sources.server.ts
 * Documentation sites and GitHub repositories (up-methods phase 18): the thin
 * API module. Server-side only; every call takes the user id explicitly, as
 * kb.server.ts does.
 */
import { apiFetch } from "~/lib/api.server";
import type { Repo, RepoDefaults, Site, SiteLimits, SitePage, SourcesData } from "~/lib/sources-types";

const kbPath = (kb: string) => `/v1/kb/${encodeURIComponent(kb)}`;
const sitePath = (id: string) => `/v1/sites/${encodeURIComponent(id)}`;
const repoPath = (id: string) => `/v1/repos/${encodeURIComponent(id)}`;

export async function loadSources(userId: string, kbId: string): Promise<SourcesData> {
  const [sites, repos] = await Promise.all([
    apiFetch<{ sites: Site[]; limits: SiteLimits }>(`${kbPath(kbId)}/sites`, userId),
    apiFetch<{ repos: Repo[]; defaults: RepoDefaults }>(`${kbPath(kbId)}/repos`, userId),
  ]);
  return { sites: sites.sites, limits: sites.limits, repos: repos.repos, defaults: repos.defaults };
}

export function getSite(userId: string, siteId: string) {
  return apiFetch<{ site: Site; pages: SitePage[] }>(sitePath(siteId), userId);
}

export function addSite(userId: string, kbId: string, body: { url: string; depth: number; pages: number }) {
  return apiFetch<{ site: Site; job_id: string }>(`${kbPath(kbId)}/sites`, userId, { method: "POST", body });
}

export function resyncSite(userId: string, siteId: string) {
  return apiFetch<{ job_id: string }>(`${sitePath(siteId)}/resync`, userId, { method: "POST", body: {} });
}

export function cancelSite(userId: string, siteId: string) {
  return apiFetch<{ cancelled: boolean }>(`${sitePath(siteId)}/cancel`, userId, { method: "POST", body: {} });
}

export function deleteSite(userId: string, siteId: string) {
  return apiFetch<void>(sitePath(siteId), userId, { method: "DELETE" });
}

export function addRepo(
  userId: string,
  kbId: string,
  body: { url: string; branch: string; path: string; extensions: string[]; ignore: string[] },
) {
  return apiFetch<{ repo: Repo; job_id: string }>(`${kbPath(kbId)}/repos`, userId, { method: "POST", body });
}

export function resyncRepo(userId: string, repoId: string) {
  return apiFetch<{ job_id: string }>(`${repoPath(repoId)}/resync`, userId, { method: "POST", body: {} });
}

export function deleteRepo(userId: string, repoId: string) {
  return apiFetch<void>(repoPath(repoId), userId, { method: "DELETE" });
}
