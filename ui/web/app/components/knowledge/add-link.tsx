import { useEffect, useRef } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Link2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { DriveFileNotice } from "~/components/storage/drive-file-notice";
import type { DriveReason } from "~/lib/drive-storage";

/**
 * add-link.tsx
 * "Add a link" on the knowledge base page (learning-depth phase 4): a web page
 * or a public YouTube video becomes a document.
 *
 * The URL is the server's to judge — https only, the fetch guard, robots.txt,
 * the 5 MB cap, the YouTube id — so the browser checks only that something was
 * typed. What comes back is either the new document's title or the API's own
 * sentence for the refusal, beside the form.
 *
 * A podcast feed or a YouTube playlist, channel or @handle is followed
 * instead (up-methods phase 17), and the answer links to the feed's page.
 *
 * A link whose copy the learner's Google Drive refused says why, with what
 * to do (drive-user-storage phase 5).
 */
export type AddLinkResult =
  | { linkAdded: { title: string; needsTranscript: boolean } }
  | { feedAdded: { id: string; title: string; entries: number } }
  | { linkErrorKey: string; linkErrorDetail: string; driveReason?: DriveReason };

export function AddLink({ kbId }: { kbId: string }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<AddLinkResult>();
  const form = useRef<HTMLFormElement>(null);
  const busy = fetcher.state !== "idle";
  const data = fetcher.data;

  useEffect(() => {
    if (data && ("linkAdded" in data || "feedAdded" in data)) form.current?.reset();
  }, [data]);

  return (
    <fetcher.Form ref={form} method="post" action={`/knowledge/${kbId}`} className="space-y-3">
      <input type="hidden" name="intent" value="add-link" />
      <label htmlFor="lp-link-url" className="block text-sm font-medium">
        {t("link.urlLabel")}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="lp-link-url"
          name="url"
          type="url"
          inputMode="url"
          required
          autoComplete="off"
          placeholder={t("link.placeholder")}
          aria-describedby="lp-link-hint"
          className="min-h-11 w-full min-w-0 rounded-md border border-control-border bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        />
        <Button type="submit" disabled={busy} className="shrink-0">
          <Link2 aria-hidden="true" />
          {busy ? t("link.adding") : t("link.submit")}
        </Button>
      </div>
      <p id="lp-link-hint" className="text-xs leading-snug text-muted-foreground">
        {t("link.hint")} {t("feed.linkHint")}
      </p>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="auto_sync" value="on" className="size-4 accent-primary" />
        {t("link.autoSync")}
      </label>

      {data && "linkAdded" in data ? (
        <p role="status" className="text-sm leading-snug text-muted-foreground">
          {data.linkAdded.needsTranscript
            ? t("link.needsTranscript", { title: data.linkAdded.title })
            : t("link.added", { title: data.linkAdded.title })}
        </p>
      ) : null}
      {data && "feedAdded" in data ? (
        <p role="status" className="text-sm leading-snug text-muted-foreground">
          {t("feed.followed", { title: data.feedAdded.title, count: data.feedAdded.entries })}{" "}
          <Link to={`/feeds/${data.feedAdded.id}`} className="font-medium text-foreground underline underline-offset-4">
            {t("feed.openFeed")}
          </Link>
        </p>
      ) : null}
      {data && "linkErrorKey" in data && data.driveReason ? (
        <DriveFileNotice reason={data.driveReason} />
      ) : data && "linkErrorKey" in data ? (
        <p role="alert" className="text-sm leading-snug text-destructive">
          {t(data.linkErrorKey)}
          {data.linkErrorDetail ? ` ${data.linkErrorDetail}` : ""}
        </p>
      ) : null}
    </fetcher.Form>
  );
}
