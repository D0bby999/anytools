import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { Hit } from "~/lib/kb-types";
import { Details } from "~/components/doc/details";

/**
 * retrieval-debug.tsx
 *
 * Runs the same hybrid search a chat answer will run, and shows what came back.
 *
 * It exists because AC1 is "a citation that opens the page containing the
 * quoted text", and the only way to know that holds before phase 6 has a chat
 * to prove it with is to look at the passages and open one. Each hit therefore
 * links to the viewer AT ITS PAGE — the same link shape a citation will use.
 */
export function RetrievalDebug({ kbId, blocked }: { kbId: string; blocked: boolean }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<{ hits?: Hit[]; queryErrorKey?: string; queryErrorDetail?: string }>();

  const searching = fetcher.state !== "idle";
  const hits = fetcher.data?.hits;

  return (
    // Folded (I7): a tool for checking the index, not a step of studying.
    <Details summary={t("debug.title")} className="mt-12">
      <p className="mt-0 max-w-prose text-sm leading-6 text-muted-foreground">
        {t("debug.hint")}
      </p>

      <fetcher.Form method="post" action={`/knowledge/${kbId}`} className="mt-4 flex gap-2">
        <input type="hidden" name="intent" value="query" />
        <label htmlFor="lp-debug-query" className="sr-only">
          {t("debug.placeholder")}
        </label>
        <input
          id="lp-debug-query"
          name="query"
          type="search"
          required
          disabled={blocked}
          placeholder={t("debug.placeholder")}
          className="h-10 min-w-0 flex-1 rounded-sm border border-control-border bg-card px-3 text-sm hover:border-primary focus-visible:border-primary focus-visible:outline-none disabled:opacity-50"
        />
        <Button type="submit" disabled={searching || blocked}>
          <Search aria-hidden="true" />
          {searching ? t("debug.searching") : t("debug.submit")}
        </Button>
      </fetcher.Form>

      {fetcher.data?.queryErrorKey ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {t(fetcher.data.queryErrorKey)}
          {fetcher.data.queryErrorDetail ? ` ${fetcher.data.queryErrorDetail}` : ""}
        </p>
      ) : null}

      {/* aria-live so a result announced to a screen reader arrives without a
          focus jump: the query field keeps focus for the next question. */}
      <div aria-live="polite" className="mt-4">
        {hits && hits.length === 0 ? (
          <p className="text-sm leading-prose text-muted-foreground">{t("debug.noResults")}</p>
        ) : null}

        {hits && hits.length > 0 ? (
          <ol className="border-t">
            {hits.map((hit) => {
              const arms = [
                hit.from_text ? t("debug.text") : null,
                hit.from_vector ? t("debug.vector") : null,
              ].filter(Boolean);

              return (
                <li key={hit.chunk_id} className="border-b py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <Link
                      // The citation link shape: document plus page. Phase 6's
                      // citations resolve to exactly this.
                      to={`/documents/${hit.document_id}?page=${hit.page_start}`}
                      className="font-sans text-sm font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {hit.title} · p.{hit.page_start}
                      {hit.page_end !== hit.page_start ? `–${hit.page_end}` : ""}
                    </Link>
                    <span className="font-mono text-2xs text-faint">
                      {t("debug.matchedBy")}: {arms.join(" + ")}
                    </span>
                  </div>

                  {hit.heading_path ? (
                    <p className="mt-1 font-mono text-2xs text-faint">{hit.heading_path}</p>
                  ) : null}

                  {/* The passage itself, quoted, in a full outline (never a
                      one-sided rule): text taken from a source document. */}
                  <blockquote className="mt-2 rounded-lg border bg-card px-3 py-2 text-sm leading-6 text-muted-foreground">
                    {hit.text.length > 600 ? `${hit.text.slice(0, 600)}…` : hit.text}
                  </blockquote>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </Details>
  );
}
