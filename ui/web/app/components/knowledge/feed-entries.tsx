import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  entryState,
  formatDay,
  formatDuration,
  isPlaylistFeed,
  pickable,
  type Feed,
  type FeedActionData,
  type FeedEntry,
  type FeedLimits,
} from "~/lib/feeds-types";

/**
 * feed-entries.tsx
 * The parts of a feed's page (up-methods phase 17): what the listing can
 * show (the keyless YouTube feed's 15), the check, seen and auto_add
 * controls, and the entry picker. Every form posts to the feed's own route
 * (routes/feeds.$feedId.tsx).
 */

/** What this feed's listing can and cannot show, and the last check's note. */
export function FeedNotice({ feed, limits }: { feed: Feed; limits: FeedLimits }) {
  const { t, i18n } = useTranslation("knowledge");
  return (
    <div className="mt-4 space-y-1 text-sm leading-prose text-muted-foreground">
      {feed.kind === "youtube" && feed.listed_by === "feed" ? (
        <p role="note">
          {t("feed.keylessLimit", { limit: limits.youtube_feed_limit })}
          {isPlaylistFeed(feed) ? ` ${t("feed.dataApiHint", { limit: limits.data_api_limit })}` : ""}
        </p>
      ) : null}
      {feed.listed_by === "data_api" ? <p>{t("feed.dataApiListed", { limit: limits.data_api_limit })}</p> : null}
      <p>
        {t("feed.daily")}{" "}
        {feed.last_checked_at
          ? t("feed.checked", { when: formatDay(feed.last_checked_at, i18n.language) })
          : t("feed.neverChecked")}
      </p>
      {feed.check_error ? <p className="text-destructive">{feed.check_error}</p> : null}
    </div>
  );
}

function ActionMessage({ data }: { data?: FeedActionData }) {
  const { t } = useTranslation("knowledge");
  if (!data) return null;
  if (!data.ok) {
    return (
      <p role="alert" className="text-sm leading-snug text-destructive">
        {t(data.errorKey)}
        {data.errorDetail ? ` ${data.errorDetail}` : ""}
      </p>
    );
  }
  if (data.intent === "check") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("feed.checkedNew", { count: data.count ?? 0 })}
      </p>
    );
  }
  return null;
}

/** Check now, mark seen, and auto_add. */
export function FeedControls({ feed, limits }: { feed: Feed; limits: FeedLimits }) {
  const { t } = useTranslation("knowledge");
  const check = useFetcher<FeedActionData>();
  const seen = useFetcher<FeedActionData>();
  const auto = useFetcher<FeedActionData>();
  const autoOn = auto.formData ? auto.formData.get("auto_add") === "on" : feed.auto_add;

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-wrap gap-2">
        <check.Form method="post" action={`/feeds/${feed.id}`}>
          <input type="hidden" name="intent" value="check" />
          <Button type="submit" variant="outline" size="sm" disabled={check.state !== "idle"}>
            <RefreshCw aria-hidden="true" />
            {check.state !== "idle" ? t("feed.checking") : t("feed.check")}
          </Button>
        </check.Form>
        {feed.new > 0 ? (
          <seen.Form method="post" action={`/feeds/${feed.id}`}>
            <input type="hidden" name="intent" value="seen" />
            <Button type="submit" variant="outline" size="sm" disabled={seen.state !== "idle"}>
              {t("feed.markSeen")}
            </Button>
          </seen.Form>
        ) : null}
      </div>
      <ActionMessage data={check.data} />
      <ActionMessage data={seen.data} />

      <auto.Form method="post" action={`/feeds/${feed.id}`}>
        <input type="hidden" name="intent" value="auto-add" />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="auto_add"
            value="on"
            checked={autoOn}
            onChange={(event) => auto.submit(event.currentTarget.form)}
            className="size-4 accent-primary"
          />
          {t("feed.autoAdd", { count: limits.auto_add_per_day })}
        </label>
        <p className="text-xs leading-snug text-muted-foreground">{t("feed.autoAddHint")}</p>
      </auto.Form>
      <ActionMessage data={auto.data} />
    </div>
  );
}

/** The entries, each tickable unless it is in the knowledge base or on its way. */
export function EntryPicker({ feedId, entries, limits }: { feedId: string; entries: FeedEntry[]; limits: FeedLimits }) {
  const { t, i18n } = useTranslation("knowledge");
  const fetcher = useFetcher<FeedActionData>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const busy = fetcher.state !== "idle";

  // A finished add clears the ticks: those entries are on their way.
  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.intent === "add") setPicked(new Set());
  }, [fetcher.data]);

  if (entries.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">{t("feed.noEntries")}</p>;
  }
  const queued = entries.filter((e) => entryState(e) === "queued").length;
  const full = picked.size >= limits.max_pick;

  const toggle = (key: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <fetcher.Form method="post" action={`/feeds/${feedId}`} className="mt-3">
      <input type="hidden" name="intent" value="add" />
      <ul className="divide-y border-y">
        {entries.map((entry) => {
          const state = entryState(entry);
          const canPick = pickable(entry);
          const checked = picked.has(entry.key);
          const id = `lp-entry-${entry.key}`;
          const duration = formatDuration(entry.duration_seconds);
          const day = formatDay(entry.published_at, i18n.language);
          return (
            <li key={entry.key} className="flex items-start gap-3 py-3">
              <input
                id={id}
                type="checkbox"
                name="entry"
                value={entry.key}
                checked={checked}
                disabled={!canPick || (full && !checked)}
                onChange={(event) => toggle(entry.key, event.currentTarget.checked)}
                aria-label={t("feed.pickLabel", { title: entry.title })}
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <div className="min-w-0 flex-1">
                <label htmlFor={id} className="block font-medium">
                  {entry.title}
                </label>
                <p className="font-mono text-2xs text-muted-foreground">
                  {[day, duration].filter(Boolean).join(" · ")}
                  {entry.new && state === "available" ? (
                    <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-primary">{t("feed.state.new")}</span>
                  ) : null}
                </p>
                <EntryStatus entry={entry} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || picked.size === 0}>
          <Plus aria-hidden="true" />
          {busy
            ? t("feed.adding")
            : picked.size === 0
              ? t("feed.addNone")
              : t("feed.addSelected", { count: picked.size })}
        </Button>
        {queued > 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("feed.queued", { count: queued })}
          </p>
        ) : null}
      </div>
      <div className="mt-2">
        <ActionMessage data={fetcher.data} />
      </div>
    </fetcher.Form>
  );
}

function EntryStatus({ entry }: { entry: FeedEntry }) {
  const { t } = useTranslation("knowledge");
  const state = entryState(entry);
  if (state === "added" && entry.document_id) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("feed.state.added")}
        {entry.document_status === "needs_transcript" ? ` · ${t("feed.needsTranscript")}` : ""}
        {" · "}
        <Link to={`/documents/${entry.document_id}`} className="underline underline-offset-4 hover:text-foreground">
          {t("feed.openDocument")}
        </Link>
      </p>
    );
  }
  if (state === "queued") return <p className="text-xs text-muted-foreground">{t("feed.state.queued")}</p>;
  if (state === "failed") {
    return (
      <p className="text-xs text-destructive">
        {t("feed.state.failed")}
        {entry.add_error ? `: ${entry.add_error}` : ""}
      </p>
    );
  }
  return null;
}
