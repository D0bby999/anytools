import { useEffect, useState } from "react";
import { Link, useFetcher, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { RefreshCw, Square, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { SitePagesData } from "~/routes/app.api.sources";
import {
  crawlPercent,
  repoWorking,
  shortSHA,
  siteWorking,
  type Repo,
  type Site,
  type SourceActionData,
} from "~/lib/sources-types";

/**
 * kb-sources.tsx
 * A knowledge base's documentation sites and repositories (up-methods phase
 * 18): one hairline row each, with the crawl's progress bar, the page list,
 * and re-sync, cancel and delete.
 *
 * Pages and files are ordinary documents and also appear in the document
 * table; this list is the group's view: what the crawl found, what it skipped
 * and why, and what is no longer on the site. While a crawl or sync is
 * running the page's loader is refreshed every few seconds.
 */
const POLL_MS = 2500;

export function KbSources({ sites, repos }: { sites: Site[]; repos: Repo[] }) {
  const { t } = useTranslation("knowledge");
  const revalidator = useRevalidator();
  const working = sites.some(siteWorking) || repos.some(repoWorking);

  useEffect(() => {
    if (!working) return;
    const id = window.setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [working, revalidator]);

  if (sites.length === 0 && repos.length === 0) {
    return <p className="text-sm leading-prose text-muted-foreground">{t("sources.empty")}</p>;
  }
  return (
    <ul className="divide-y border-y">
      {sites.map((site) => (
        <SiteRow key={site.id} site={site} />
      ))}
      {repos.map((repo) => (
        <RepoRow key={repo.id} repo={repo} />
      ))}
    </ul>
  );
}

function SiteRow({ site }: { site: Site }) {
  const { t } = useTranslation("knowledge");
  const working = siteWorking(site);
  const percent = crawlPercent(site);
  const [open, setOpen] = useState(false);
  const pages = useFetcher<SitePagesData>();

  // Reload the open list as the crawl moves.
  useEffect(() => {
    if (open) pages.load(`/app/api/sources?site=${encodeURIComponent(site.id)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, site.done, site.status]);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-faint">{t("sources.siteKind")}</p>
          <p className="truncate font-medium">{site.title || site.start_url}</p>
          <p className="truncate font-mono text-2xs text-muted-foreground">{site.start_url}</p>
        </div>
        <SourceActions kind="site" id={site.id} working={working} />
      </div>

      <div className="mt-2 space-y-1">
        <div
          role="progressbar"
          aria-label={t("sources.progressLabel", { title: site.title || site.start_url })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t(`sources.siteStatus.${site.status}`)}
          {" · "}
          {t("sources.siteCounts", { done: site.done, found: site.found, documents: site.documents })}
          {site.removed > 0 ? ` · ${t("sources.removedCount", { count: site.removed })}` : ""}
          {" · "}
          {t("sources.siteLimits", { depth: site.max_depth, pages: site.max_pages })}
        </p>
        {site.error ? <p className="text-xs text-destructive">{site.error}</p> : null}
      </div>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="mt-1 inline-flex min-h-11 items-center rounded-md px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        {open ? t("sources.hidePages") : t("sources.showPages")}
      </button>
      {open ? <PageList data={pages.data} loading={pages.state !== "idle" && !pages.data} /> : null}
    </li>
  );
}

function PageList({ data, loading }: { data?: SitePagesData; loading: boolean }) {
  const { t } = useTranslation("knowledge");
  if (loading) return <p className="text-xs text-muted-foreground">{t("sources.loadingPages")}</p>;
  if (!data) return null;
  if (!data.ok) return <p className="text-xs text-destructive">{data.error}</p>;
  if (data.pages.length === 0) return <p className="text-xs text-muted-foreground">{t("sources.noPages")}</p>;
  return (
    <ol className="mt-1 divide-y border-y text-xs">
      {data.pages.map((page) => {
        const removed = page.status === "removed" || Boolean(page.removed_at);
        return (
          <li key={page.url} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
            <span className="min-w-0 truncate">
              {page.document_id ? (
                <Link to={`/documents/${page.document_id}`} className="underline underline-offset-4 hover:text-primary">
                  {page.title || page.url}
                </Link>
              ) : (
                page.title || page.url
              )}
              <span className="ml-2 font-mono text-2xs text-faint">{page.url}</span>
            </span>
            <span className={removed ? "text-warning" : "text-muted-foreground"}>
              {removed ? t("sources.removed") : t(`sources.pageStatus.${page.status}`)}
              {page.reason && !removed ? ` · ${page.reason}` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RepoRow({ repo }: { repo: Repo }) {
  const { t } = useTranslation("knowledge");
  const working = repoWorking(repo);
  const branch = repo.resolved_branch || repo.branch || t("sources.defaultBranch");
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-faint">{t("sources.repoKind")}</p>
          <p className="truncate font-medium">
            {repo.owner}/{repo.name}
            {repo.path_prefix ? <span className="text-muted-foreground"> / {repo.path_prefix}</span> : null}
          </p>
          <p className="font-mono text-2xs text-muted-foreground">
            {branch}
            {repo.commit_sha ? ` @ ${shortSHA(repo.commit_sha)}` : ""}
            {" · "}
            {repo.extensions.join(" ")}
          </p>
        </div>
        <SourceActions kind="repo" id={repo.id} working={working} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t(`sources.repoStatus.${repo.status}`)}
        {" · "}
        {t("sources.fileCount", { count: repo.file_count })}
        {repo.removed > 0 ? ` · ${t("sources.removedFromRepo", { count: repo.removed })}` : ""}
      </p>
      {repo.note ? <p className="text-xs text-muted-foreground">{repo.note}</p> : null}
      {repo.error ? <p className="text-xs text-destructive">{repo.error}</p> : null}
    </li>
  );
}

function SourceActions({ kind, id, working }: { kind: "site" | "repo"; id: string; working: boolean }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<SourceActionData>();
  const busy = fetcher.state !== "idle";
  const submit = (intent: string) => fetcher.submit({ intent, id }, { method: "post", action: "/app/api/sources" });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-2">
        {working && kind === "site" ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => submit("cancel-site")}>
            <Square aria-hidden="true" />
            {t("sources.cancel")}
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" disabled={busy || working} onClick={() => submit(`resync-${kind}`)}>
          <RefreshCw aria-hidden="true" />
          {t("sources.resync")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t(kind === "site" ? "sources.deleteSiteConfirm" : "sources.deleteRepoConfirm"))) {
              submit(`delete-${kind}`);
            }
          }}
          className="text-destructive hover:bg-destructive-soft"
        >
          <Trash2 aria-hidden="true" />
          {t("sources.delete")}
        </Button>
      </div>
      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="text-xs text-destructive">
          {fetcher.data.error || t("sources.errors.actionFailed")}
        </p>
      ) : null}
    </div>
  );
}
