import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { formatDay, type Feed } from "~/lib/feeds-types";

/**
 * feed-panel.tsx
 * A knowledge base's podcast feeds and YouTube playlists and channels
 * (up-methods phase 17): one hairline row each, with what the last check
 * found and how many entries are new. The feed's own page lists its entries
 * to pick from.
 *
 * A feed is added through "Add a link", so this panel has no form of its
 * own.
 */
export function FeedPanel({ feeds }: { feeds: Feed[] }) {
  const { t, i18n } = useTranslation("knowledge");
  if (feeds.length === 0) {
    return <p className="text-sm leading-prose text-muted-foreground">{t("feed.empty")}</p>;
  }
  return (
    <ul className="divide-y border-y">
      {feeds.map((feed) => (
        <li key={feed.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-faint">{t(`feed.kind.${feed.kind}`)}</p>
            <Link
              to={`/feeds/${feed.id}`}
              className="block truncate font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            >
              {feed.title || feed.url}
            </Link>
            <p className="text-xs text-muted-foreground">
              {t("feed.counts", { entries: feed.entries, added: feed.added })}
              {" · "}
              {feed.last_checked_at
                ? t("feed.checked", { when: formatDay(feed.last_checked_at, i18n.language) })
                : t("feed.neverChecked")}
            </p>
            {feed.check_error ? <p className="text-xs text-muted-foreground">{feed.check_error}</p> : null}
          </div>
          {feed.new > 0 ? (
            <span className="rounded-full bg-primary-soft px-2 py-0.5 font-mono text-2xs text-primary">
              {t("feed.newCount", { count: feed.new })}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
