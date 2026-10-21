/**
 * A connection's models on its provider's page (plan 261021-1100 phase 4,
 * after postclaw's connection-models panel): what the provider lists for the
 * learner's key, grouped by what each model is for, and the ones the learner
 * added by id, which they can remove. Shown on request, since listing asks
 * the provider.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Details } from "~/components/doc/details";
import { useConnectionModels } from "~/hooks/use-connection-models";
import { fold } from "~/lib/chat-search";
import { groupModels } from "~/lib/provider-catalog";

/** Most models drawn per group; the search reaches the rest. */
const PER_GROUP = 40;

type ModelActionData = { ok: boolean; message: string | null; intent?: string };

export function ConnectionModels({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation("common");
  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState("");
  const { data, loading, refresh } = useConnectionModels(connectionId, shown);
  const fetcher = useFetcher<ModelActionData>();
  const added = fetcher.data;

  // An added or removed model changes the list: fetch it again.
  useEffect(() => {
    if (fetcher.state === "idle" && added?.ok) refresh();
  }, [fetcher.state, added, refresh]);

  const groups = useMemo(() => {
    if (!data?.ok) return [];
    const q = fold(query.trim());
    return groupModels(data.models.filter((m) => !q || fold(m).includes(q)));
  }, [data, query]);
  const custom = data?.ok ? data.custom.filter((m) => !query || fold(m).includes(fold(query.trim()))) : [];
  const total = data?.ok ? data.models.length : 0;

  if (!shown) {
    return (
      <div className="mt-4 border-t pt-4">
        <Button type="button" variant="outline" size="sm" aria-expanded={false} onClick={() => setShown(true)}>
          {t("settings.models.show")}
        </Button>
      </div>
    );
  }

  return (
    <section className="mt-4 border-t pt-4" aria-label={t("settings.models.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t("settings.models.title")}</span>
        <Button type="button" variant="ghost" size="sm" aria-expanded onClick={() => setShown(false)}>
          {t("settings.models.hide")}
        </Button>
      </div>

      {loading ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {t("settings.models.loading")}
        </p>
      ) : data && !data.ok ? (
        <p className="mt-2 text-sm text-destructive">{data.error || t("settings.models.unavailable")}</p>
      ) : data?.ok ? (
        <>
          {data.list_error ? <p className="mt-2 text-sm leading-prose text-muted-foreground">{data.list_error}</p> : null}
          {total + data.custom.length > 8 ? (
            <label className="mt-3 block max-w-sm">
              <span className="sr-only">{t("settings.models.search")}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("settings.models.search")}
                className="h-9 w-full rounded-md border border-control-border bg-card px-3 text-sm"
              />
            </label>
          ) : null}

          {custom.length > 0 ? (
            <ModelGroup title={t("settings.models.addedTitle")} count={custom.length}>
              {custom.map((m) => (
                <li key={m} className="flex min-h-8 items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-xs">{m}</span>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="delete-model" />
                    <input type="hidden" name="id" value={connectionId} />
                    <input type="hidden" name="model" value={m} />
                    <Button type="submit" variant="ghost" size="sm" aria-label={t("settings.models.remove", { model: m })}>
                      {t("settings.connections.remove")}
                    </Button>
                  </fetcher.Form>
                </li>
              ))}
            </ModelGroup>
          ) : null}

          {groups.map((g) => (
            <ModelGroup key={g.kind} title={t(`settings.models.kinds.${g.kind}`)} count={g.models.length}>
              {g.models.slice(0, PER_GROUP).map((m) => (
                <li key={m} className="flex min-h-7 items-center font-mono text-xs">
                  <span className="min-w-0 truncate">{m}</span>
                </li>
              ))}
              {g.models.length > PER_GROUP ? (
                <li className="text-xs text-muted-foreground">
                  {t("settings.models.more", { count: g.models.length - PER_GROUP })}
                </li>
              ) : null}
            </ModelGroup>
          ))}
          {total === 0 && data.custom.length === 0 && !data.list_error ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("settings.models.none")}</p>
          ) : null}
        </>
      ) : null}

      <Details summary={t("settings.models.addTitle")}>
        <fetcher.Form method="post" className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="add-model" />
          <input type="hidden" name="id" value={connectionId} />
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span>{t("settings.models.addLabel")}</span>
            <input
              name="model"
              required
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              placeholder="vendor/model-name"
              className="h-10 w-full rounded-md border border-control-border bg-card px-3 font-mono text-sm"
            />
          </label>
          <Button type="submit" variant="outline" disabled={fetcher.state !== "idle"}>
            {t("settings.models.add")}
          </Button>
        </fetcher.Form>
        {added && !added.ok && added.message ? <p className="mt-2 text-sm text-destructive">{added.message}</p> : null}
        <p className="mt-2 text-xs leading-prose text-muted-foreground">{t("settings.models.addHelp")}</p>
      </Details>
    </section>
  );
}

function ModelGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="mt-4">
      <div className="text-xs leading-5 font-semibold text-muted-foreground">
        {title} <span className="font-normal">({count})</span>
      </div>
      <ul className="mt-1 grid list-none gap-x-6 p-0 sm:grid-cols-2">{children}</ul>
    </div>
  );
}
