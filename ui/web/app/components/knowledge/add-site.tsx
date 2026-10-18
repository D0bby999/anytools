import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { Button } from "~/components/ui/button";
import { DriveFileNotice } from "~/components/storage/drive-file-notice";
import type { SiteLimits, SourceActionData } from "~/lib/sources-types";

/**
 * add-site.tsx
 * "Add a site" beside "Add a link" (up-methods phase 18): a documentation site
 * is crawled from a start URL, following links on the same origin and under
 * the start URL's folder, as robots.txt allows. Depth 0-3 (default 2) and a
 * page limit (default 50, at most 200), as DeepTutor's crawler limits them.
 *
 * The server judges the URL and the limits; the inputs only bound what can be
 * typed. The crawl runs as a job, so the reply says it started, and the
 * sources list below shows its progress.
 */
const fieldClass =
  "min-h-11 w-full min-w-0 rounded-md border border-control-border bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none";

export function AddSite({ kbId, limits }: { kbId: string; limits: SiteLimits }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<SourceActionData>();
  const form = useRef<HTMLFormElement>(null);
  const busy = fetcher.state !== "idle";
  const data = fetcher.data;

  useEffect(() => {
    if (data?.ok) form.current?.reset();
  }, [data]);

  return (
    <fetcher.Form ref={form} method="post" action="/app/api/sources" className="space-y-3">
      <input type="hidden" name="intent" value="add-site" />
      <input type="hidden" name="kb" value={kbId} />
      <label htmlFor="lp-site-url" className="block text-sm font-medium">
        {t("site.urlLabel")}
      </label>
      <input
        id="lp-site-url"
        name="url"
        type="url"
        inputMode="url"
        required
        autoComplete="off"
        placeholder={t("site.placeholder")}
        aria-describedby="lp-site-hint"
        className={fieldClass}
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("site.depth")}</span>
          <input
            name="depth"
            type="number"
            min={0}
            max={limits.max_depth}
            defaultValue={limits.default_depth}
            required
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t("site.pages")}</span>
          <input
            name="pages"
            type="number"
            min={1}
            max={limits.max_pages}
            defaultValue={limits.default_pages}
            required
            className={fieldClass}
          />
        </label>
        <Button type="submit" disabled={busy} className="shrink-0">
          <Globe aria-hidden="true" />
          {busy ? t("site.adding") : t("site.submit")}
        </Button>
      </div>
      <p id="lp-site-hint" className="text-xs leading-snug text-muted-foreground">
        {t("site.hint", { maxDepth: limits.max_depth, maxPages: limits.max_pages })}
      </p>
      {data?.ok ? (
        <p role="status" className="text-sm leading-snug text-muted-foreground">
          {t("site.added", { title: data.title ?? "" })}
        </p>
      ) : null}
      {data && !data.ok && data.driveReason ? (
        <DriveFileNotice reason={data.driveReason} />
      ) : data && !data.ok ? (
        <p role="alert" className="text-sm leading-snug text-destructive">
          {t("sources.errors.siteFailed")}
          {data.error ? ` ${data.error}` : ""}
        </p>
      ) : null}
    </fetcher.Form>
  );
}
