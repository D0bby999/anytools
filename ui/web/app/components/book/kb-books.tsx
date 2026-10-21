import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { Book } from "~/lib/book-types";
import { MAX_CHAPTERS, MIN_CHAPTERS } from "~/lib/book-types";
import type { BooksActionData } from "~/routes/app.api.books";
import { DOC_H2 } from "~/components/reading/doc-section";

const ACTION = "/app/api/books";
const LENGTHS = Array.from({ length: MAX_CHAPTERS - MIN_CHAPTERS + 1 }, (_, i) => MIN_CHAPTERS + i);

/**
 * The knowledge base page's living books (learning depth, phase 11): "Make a
 * book", and the books already made from this knowledge base.
 *
 * Making one is a single call on the learner's key that proposes an outline;
 * the page then opens the book, where the outline is edited and confirmed.
 * Nothing else is written before that, and the form says so.
 */
export function KbBooks({ kbId, books, n }: { kbId: string; books: Book[]; n?: number }) {
  const { t } = useTranslation("book");
  const fetcher = useFetcher<BooksActionData>();
  const busy = fetcher.state !== "idle";
  const failed = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

  return (
    <section aria-labelledby="lp-kb-books">
      <h2 id="lp-kb-books" className={DOC_H2}>
        {n ? `${n}. ` : null}
        {t("kb.title")}
      </h2>
      <p className="text-base leading-[1.85] text-muted-foreground">{t("kb.lead")}</p>

      <fetcher.Form method="post" action={ACTION} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="create" />
        <input type="hidden" name="kbId" value={kbId} />
        <label className="min-w-48 flex-1 text-sm">
          <span className="block font-medium">{t("kb.goal")}</span>
          <input
            name="goal"
            maxLength={500}
            placeholder={t("kb.goalPlaceholder")}
            className="mt-1 h-10 w-full rounded-sm border border-control-border bg-card px-3 hover:border-primary focus-visible:border-primary focus-visible:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="block font-medium">{t("kb.chapters")}</span>
          <select
            name="chapters"
            defaultValue="6"
            className="mt-1 h-10 rounded-sm border border-control-border bg-card px-3 hover:border-primary focus-visible:border-primary focus-visible:outline-none"
          >
            {LENGTHS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? t("kb.creating") : t("kb.create")}
        </Button>
        <p className="w-full text-xs leading-snug text-muted-foreground">{t("kb.cost")}</p>
        {failed ? (
          <p role="alert" className="w-full text-sm text-destructive">
            {failed}
          </p>
        ) : null}
      </fetcher.Form>

      {books.length > 0 ? (
        // A dated list (P4): **title** · progress.
        <ul className="mt-6 space-y-2 leading-[1.85]">
          {books.map((b) => {
            const written = b.chapters.filter((c) => c.status === "ready").length;
            return (
              <li key={b.id}>
                <Link to={`/books/${b.id}`} className="font-semibold text-primary underline underline-offset-2 hover:text-primary-hover">
                  {b.title}
                </Link>
                {" · "}
                <span className="text-muted-foreground">
                  {b.status === "proposed"
                    ? t("kb.proposed")
                    : t("kb.progress", { ready: written, total: b.chapters.length })}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
