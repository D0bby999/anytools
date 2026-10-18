import { useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { AddPaperData, Paper, RelatedData } from "~/lib/papers-types";

const ROUTE = "/app/api/related";

/**
 * Related papers for a knowledge base (learning depth, phase 6): recent work
 * found from a summary of the documents, listed on request, added one at a
 * time. A paper under an open licence comes in as its PDF; any other comes in
 * as a note with its abstract and a link.
 */
export function RelatedPapers({ kbId }: { kbId: string }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<RelatedData>();
  const [focus, setFocus] = useState("");
  const busy = fetcher.state !== "idle";
  const data = fetcher.data;

  return (
    <section aria-labelledby="lp-related-title" className="mt-10">
      <h2 id="lp-related-title" className="lp-section">
        {t("related.title")}
      </h2>
      <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("related.lead")}</p>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void fetcher.load(`${ROUTE}?kb=${encodeURIComponent(kbId)}&focus=${encodeURIComponent(focus)}`);
        }}
      >
        <label className="min-w-48 flex-1 text-sm">
          <span className="block font-medium">{t("related.focus")}</span>
          <input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            maxLength={80}
            placeholder={t("related.focusPlaceholder")}
            className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3"
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? t("related.finding") : t("related.find")}
        </Button>
      </form>

      {data && !data.ok ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {data.error}
        </p>
      ) : null}
      {data?.ok ? (
        data.list.papers.length === 0 ? (
          <p className="mt-4 lp-empty">{t("related.none")}</p>
        ) : (
          <>
            <p className="mt-4 text-xs text-muted-foreground">
              {t("related.searched", { queries: data.list.queries.join(" · ") })}
            </p>
            <ul className="mt-2 border-t">
              {data.list.papers.map((p) => (
                <li key={p.id} className="border-b py-3">
                  <PaperRow paper={p} kbId={kbId} />
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}
    </section>
  );
}

function PaperRow({ paper: p, kbId }: { paper: Paper; kbId: string }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<AddPaperData>();
  const revalidator = useRevalidator();
  const added = fetcher.data?.ok ? fetcher.data : null;
  const failed = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;
  const openPDF = p.pdf_url !== undefined && p.pdf_url !== "";

  return (
    <div className="text-sm">
      <p className="font-medium leading-snug">{p.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {[p.authors.slice(0, 3).join(", "), p.year, t("related.cited", { count: p.citations })].filter(Boolean).join(" · ")}
        {openPDF ? <span className="lp-chip ml-2">{t("related.openAccess")}</span> : null}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {added ? (
          <p role="status" className="text-xs text-muted-foreground">
            {added.as_pdf ? t("related.addedPDF") : t("related.addedNote")}
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={fetcher.state !== "idle" || p.source !== "openalex"}
            onClick={() => {
              void fetcher.submit({ kb: kbId, id: p.id }, { method: "post", action: ROUTE }).then(() => revalidator.revalidate());
            }}
          >
            {t("related.add")}
          </Button>
        )}
        <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-primary underline underline-offset-4">
          {t("related.open")}
        </a>
      </div>
      {failed ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {failed}
        </p>
      ) : null}
    </div>
  );
}
