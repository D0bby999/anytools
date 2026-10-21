/**
 * The Providers page's grid (plan 261021-1100 phase 4, after postclaw's
 * settings-providers): every provider a learner can connect, narrowed by a
 * search and two rows of filters, each a card that opens the provider's page.
 *
 * Filtering is in lib/provider-catalog.ts; this file only draws it. The
 * filters are toggle buttons in a labelled group, so a screen reader hears
 * which one is on, and the count above the grid is a live region.
 */
import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import type { CatalogEntry } from "~/lib/byok.types";
import {
  filterProviders,
  NO_FILTER,
  type AccessFilter,
  type ProviderFilter,
  type ServeFilter,
} from "~/lib/provider-catalog";
import { providerName } from "~/lib/provider-names";
import { ProviderTile } from "./provider-tile";

const ACCESS: AccessFilter[] = ["all", "api_key", "free", "sign_in", "custom"];
const SERVES: ServeFilter[] = ["all", "chat", "parse", "embed", "tts", "stt"];

// On a phone a filter row scrolls sideways rather than stacking six rows of
// chips above the first provider; from 640 it wraps.
const ROW = "-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0";

const CHIP =
  "inline-flex shrink-0 min-h-9 items-center rounded-md border border-control-border px-3 text-sm transition-colors hover:bg-primary-soft aria-pressed:bg-selected aria-pressed:text-selected-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none";

export function ProviderGrid({ entries, connected }: { entries: CatalogEntry[]; connected: Record<string, number> }) {
  const { t } = useTranslation("common");
  const [filter, setFilter] = useState<ProviderFilter>(NO_FILTER);
  const set = (patch: Partial<ProviderFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const count = (type: string) => connected[type] ?? 0;
  // A filter row offers only what some provider has: no sign-in chip with the lanes off.
  const access = ACCESS.filter(
    (a) => a === "all" || filterProviders(entries, { ...NO_FILTER, access: a }, count).length > 0,
  );
  const shown = filterProviders(entries, filter, count);

  return (
    <div>
      <label className="relative block max-w-md">
        <span className="sr-only">{t("settings.providers.search")}</span>
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={filter.query}
          onChange={(e) => set({ query: e.target.value })}
          placeholder={t("settings.providers.searchPlaceholder")}
          className="h-10 w-full rounded-md border border-control-border bg-card ps-9 pe-3 text-sm"
        />
      </label>

      <div className="mt-4 grid gap-3">
        <div role="group" aria-label={t("settings.providers.access")} className={ROW}>
          <span className="me-1 shrink-0 text-sm text-muted-foreground" aria-hidden="true">
            {t("settings.providers.access")}
          </span>
          {access.map((a) => (
            <button key={a} type="button" aria-pressed={filter.access === a} onClick={() => set({ access: a })} className={CHIP}>
              {t(`settings.providers.accessOptions.${a}`)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t("settings.providers.serves")} className={ROW}>
          <span className="me-1 shrink-0 text-sm text-muted-foreground" aria-hidden="true">
            {t("settings.providers.serves")}
          </span>
          {SERVES.map((s) => (
            <button key={s} type="button" aria-pressed={filter.serves === s} onClick={() => set({ serves: s })} className={CHIP}>
              {t(`settings.providers.servesOptions.${s}`)}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={filter.connected}
            onClick={() => set({ connected: !filter.connected })}
            className={CHIP}
          >
            {t("settings.providers.connectedOnly")}
          </button>
        </div>
      </div>

      <p role="status" className="mt-5 text-sm text-muted-foreground">
        {t("settings.providers.count", { shown: shown.length, total: entries.length })}
      </p>

      {shown.length === 0 ? (
        <p className="mt-3 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
          {t("settings.providers.empty")}
        </p>
      ) : (
        <ul className="mt-3 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((e) => (
            <ProviderCard key={e.type} entry={e} connections={count(e.type)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProviderCard({ entry, connections }: { entry: CatalogEntry; connections: number }) {
  const { t } = useTranslation("common");
  const name = providerName(t, entry.type) || entry.label;
  return (
    <li className="relative flex min-w-0 gap-3 rounded-lg border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-primary hover:border-control-border">
      <ProviderTile icon={entry.icon} hue={entry.hue} />
      <div className="min-w-0 flex-1">
        {/* Not an h3 or a p: lp-doc's unlayered heading and paragraph rules
            would set the card in the book face with prose margins. */}
        <div className="text-sm leading-6 font-medium">
          {/* The whole card is the link's target (after::inset-0); the name is its text. */}
          <Link
            to={`/settings/providers/${entry.type}`}
            className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none"
          >
            {name}
          </Link>
        </div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">
          {entry.serves.map((s) => t(`settings.providers.servesOptions.${s}`)).join(" · ")}
        </div>
        {connections > 0 || entry.free_tier ? (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5">
            {connections > 0 ? (
              <span className="inline-flex items-center gap-2 font-medium text-foreground">
                <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
                {t("settings.providers.connectedCount", { count: connections })}
              </span>
            ) : null}
            {entry.free_tier ? <span className="text-muted-foreground">{t("settings.providers.free")}</span> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
