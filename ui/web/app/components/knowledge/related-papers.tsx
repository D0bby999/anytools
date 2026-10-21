import { useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { AddPaperData, Paper, RelatedData } from "~/lib/papers-types";
import { DOC_H2 } from "~/components/reading/doc-section";
import { Badge } from "~/components/doc/badge";
import { useOverflowTabStop } from "~/components/doc/scroll-box";

const ROUTE = "/app/api/related";

/**
 * Related papers for a knowledge base (learning depth, phase 6): recent work
 * found from a summary of the documents, listed on request, added one at a
 * time. A paper under an open licence comes in as its PDF; any other comes in
 * as a note with its abstract and a link.
 */
export function RelatedPapers({ kbId, n }: { kbId: string; n?: number }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<RelatedData>();
  const [scrollTable, tableTabIndex] = useOverflowTabStop<HTMLTableElement>();
  const [focus, setFocus] = useState("");
  const busy = fetcher.state !== "idle";
  const data = fetcher.data;

  return (
    <section aria-labelledby="lp-related-title">
      <h2 id="lp-related-title" className={DOC_H2}>
        {n ? `${n}. ` : null}
        {t("related.title")}
      </h2>
      <p className="text-base leading-[1.85] text-muted-foreground">{t("related.lead")}</p>
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
            className="mt-1 h-10 w-full rounded-sm border border-control-border bg-card px-3 hover:border-primary focus-visible:border-primary focus-visible:outline-none"
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
            {/* A table, as up puts anything comparable in one (P5). */}
            <table ref={scrollTable} tabIndex={tableTabIndex} className="lp-table">
              <caption className="sr-only">{t("related.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("related.colPaper")}</th>
                  <th scope="col">{t("related.colYear")}</th>
                  <th scope="col">{t("related.colCited")}</th>
                  <th scope="col">
                    <span className="sr-only">{t("table.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.list.papers.map((p) => (
                  <PaperRow key={p.id} paper={p} kbId={kbId} />
                ))}
              </tbody>
            </table>
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
    <tr>
      <th scope="row">
        <span className="font-semibold text-foreground">{p.title}</span>
        <span className="mt-1 block text-xs font-normal">
          {p.authors.slice(0, 3).join(", ")}
          {openPDF ? <Badge type="tip" className="ml-2">{t("related.openAccess")}</Badge> : null}
        </span>
        <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs font-normal text-primary underline underline-offset-4">
          {t("related.open")}
        </a>
      </th>
      <td className="whitespace-nowrap text-muted-foreground">{p.year || "—"}</td>
      <td className="whitespace-nowrap text-muted-foreground">{t("related.cited", { count: p.citations })}</td>
      <td>
        {added ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
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
        {failed ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {failed}
          </p>
        ) : null}
      </td>
    </tr>
  );
}
