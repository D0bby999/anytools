import { useState } from "react";
import { Link, useFetcher, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { AddZoteroData, ZoteroCollection, ZoteroItem, ZoteroListData } from "~/lib/zotero-types";

const ROUTE = "/app/api/zotero";

/**
 * "Add from Zotero" (up-methods phase 20): search the learner's own Zotero
 * library or browse its collections, then add one item at a time. An item
 * with a PDF in their Zotero storage comes in as that PDF; any other comes
 * in as a note of its details and abstract with a link. Nothing is fetched
 * until the learner asks: each list is a call on their own key.
 */
export function ZoteroPanel({ kbId }: { kbId: string }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<ZoteroListData>();
  const [query, setQuery] = useState("");
  // The collections opened, top level first; empty while searching or
  // before browsing.
  const [trail, setTrail] = useState<ZoteroCollection[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const busy = fetcher.state !== "idle";
  const data = fetcher.data;

  const browse = (path: ZoteroCollection[]) => {
    setBrowsing(true);
    setTrail(path);
    const at = path.at(-1)?.key ?? "";
    void fetcher.load(`${ROUTE}?kb=${encodeURIComponent(kbId)}&collection=${encodeURIComponent(at)}`);
  };

  return (
    <div>
      <p className="max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">{t("zotero.lead")}</p>
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim() === "") return;
          setBrowsing(false);
          setTrail([]);
          void fetcher.load(`${ROUTE}?kb=${encodeURIComponent(kbId)}&q=${encodeURIComponent(query.trim())}`);
        }}
      >
        <label className="min-w-48 flex-1 text-sm">
          <span className="block font-medium">{t("zotero.searchLabel")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
            placeholder={t("zotero.searchPlaceholder")}
            className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3"
          />
        </label>
        <Button type="submit" disabled={busy || query.trim() === ""}>
          {busy && !browsing ? t("zotero.searching") : t("zotero.search")}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => browse([])}>
          {t("zotero.browse")}
        </Button>
      </form>

      {data && !data.ok ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {data.notConnected ? (
            <>
              {t("zotero.notConnected")}{" "}
              <Link to="/settings/search" className="underline underline-offset-4">
                {t("zotero.settingsLink")}
              </Link>
            </>
          ) : (
            data.error
          )}
        </p>
      ) : null}

      {data?.ok && browsing ? (
        <nav aria-label={t("zotero.trailLabel")} className="mt-4 flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground">
          <button type="button" className="underline underline-offset-4" disabled={busy} onClick={() => browse([])}>
            {t("zotero.allCollections")}
          </button>
          {trail.map((c, i) => (
            <span key={c.key}>
              {" / "}
              <button
                type="button"
                className="underline underline-offset-4"
                disabled={busy}
                onClick={() => browse(trail.slice(0, i + 1))}
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>
      ) : null}

      {data?.ok && data.collections.length > 0 ? (
        <ul aria-label={t("zotero.collections")} className="mt-2 border-t">
          {data.collections.map((c) => (
            <li key={c.key} className="flex flex-wrap items-baseline justify-between gap-2 border-b py-2 text-sm">
              <button
                type="button"
                className="text-left font-medium underline-offset-4 hover:underline"
                disabled={busy}
                onClick={() => browse([...trail, c])}
              >
                {c.name}
              </button>
              <span className="font-mono text-xs text-muted-foreground">
                {t("zotero.collectionCount", { count: c.items })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {data?.ok ? (
        data.items.length === 0 ? (
          !browsing || trail.length > 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{browsing ? t("zotero.emptyCollection") : t("zotero.none")}</p>
          ) : null
        ) : (
          <ul aria-label={t("zotero.items")} className="mt-3 border-t">
            {data.items.map((item) => (
              <li key={item.key} className="border-b py-3">
                <ZoteroRow item={item} kbId={kbId} />
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function ZoteroRow({ item, kbId }: { item: ZoteroItem; kbId: string }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<AddZoteroData>();
  const revalidator = useRevalidator();
  const added = fetcher.data?.ok ? fetcher.data : null;
  const failed = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;
  const creators =
    item.creators.length > 3 ? `${item.creators.slice(0, 3).join(", ")}, …` : item.creators.join(", ");

  return (
    <div className="text-sm">
      <p className="font-medium leading-snug">{item.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {[creators, item.year, item.item_type].filter((part) => part !== "").join(" · ")}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {added ? (
          <p role="status" className="text-xs text-muted-foreground">
            {added.as_pdf ? t("zotero.addedPDF") : t("zotero.addedNote")}
            {added.note ? ` ${t("zotero.pdfSkipped", { reason: added.note })}` : null}
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={fetcher.state !== "idle"}
            onClick={() => {
              void fetcher
                .submit({ kb: kbId, key: item.key }, { method: "post", action: ROUTE })
                .then(() => revalidator.revalidate());
            }}
          >
            {fetcher.state !== "idle" ? t("zotero.adding") : t("zotero.add")}
          </Button>
        )}
      </div>
      {failed ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {failed}
        </p>
      ) : null}
    </div>
  );
}
