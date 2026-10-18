import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { Book } from "~/lib/book-types";
import { MAX_CHAPTERS, MIN_CHAPTERS } from "~/lib/book-types";
import type { BooksActionData } from "~/routes/app.api.books";

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
export function KbBooks({ kbId, books }: { kbId: string; books: Book[] }) {
  const { t } = useTranslation("book");
  const fetcher = useFetcher<BooksActionData>();
  const busy = fetcher.state !== "idle";
  const failed = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

  return (
    <section aria-labelledby="lp-kb-books" className="mt-10">
      <h2 id="lp-kb-books" className="lp-section">
        {t("kb.title")}
      </h2>
      <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("kb.lead")}</p>

      <fetcher.Form method="post" action={ACTION} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="create" />
        <input type="hidden" name="kbId" value={kbId} />
        <label className="min-w-48 flex-1 text-sm">
          <span className="block font-medium">{t("kb.goal")}</span>
          <input
            name="goal"
            maxLength={500}
            placeholder={t("kb.goalPlaceholder")}
            className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3"
          />
        </label>
        <label className="text-sm">
          <span className="block font-medium">{t("kb.chapters")}</span>
          <select
            name="chapters"
            defaultValue="6"
            className="mt-1 min-h-11 rounded-md border border-control-border bg-card px-3"
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
        <ul className="mt-6 border-t">
          {books.map((b) => {
            const written = b.chapters.filter((c) => c.status === "ready").length;
            return (
              <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b py-3">
                <Link to={`/books/${b.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  {b.title}
                </Link>
                <span className="font-mono text-2xs text-muted-foreground">
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
