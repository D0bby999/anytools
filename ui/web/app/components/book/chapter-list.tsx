import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { Book, Chapter } from "~/lib/book-types";
import { SaveToDrive } from "~/components/storage/save-to-drive";
import { SendTo } from "~/components/apps/send-to";

type ActionData = { errorKey?: string; errorDetail?: string };

/**
 * A confirmed book's chapters, as hairline rows: each with its state, how
 * much of it is written, whether its sources have changed since, and what
 * writing the rest of it would cost on the learner's key.
 *
 * "Write every chapter" runs as one background job and says what it will
 * cost before it starts; while it runs, the calls billed so far and Cancel.
 * A paused book says why, and writing a chapter again resumes it.
 */
export function ChapterList({ book }: { book: Book }) {
  const { t } = useTranslation("book");
  const fetcher = useFetcher<ActionData>();
  const busy = fetcher.state !== "idle";
  const left = book.chapters.some((c) => c.status !== "ready" || c.ready < c.blocks);

  return (
    <div className="mt-8">
      {book.paused_reason ? (
        <div role="status" className="mb-4 rounded-lg border border-warning bg-warning-soft p-4 text-sm leading-prose">
          <p className="font-medium">{t("book.paused")}</p>
          <p className="mt-1 text-muted-foreground">{book.paused_reason}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {book.compiling ? (
          <>
            <p role="status" className="text-sm text-muted-foreground">
              {t("book.compiling", { count: book.progress?.billed ?? 0 })}
            </p>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="cancel" />
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                {t("book.cancel")}
              </Button>
            </fetcher.Form>
          </>
        ) : left ? (
          <fetcher.Form method="post" className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="intent" value="compile-all" />
            <Button type="submit" disabled={busy}>
              {t("book.compileAll")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("book.compileAllCost", { count: book.estimated_calls })}</span>
          </fetcher.Form>
        ) : null}
        <SaveToDrive kind="book" id={book.id} />
        <SendTo kind="book" id={book.id} />
      </div>
      {fetcher.data?.errorKey ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("errors.compileFailed")}
          {fetcher.data.errorDetail ? ` ${fetcher.data.errorDetail}` : ""}
        </p>
      ) : null}

      {/* A mini sidebar (I5's `up` nav-link weight: 14/500), not the body's
          serif prose: this is a table of contents, read by its position
          and title, not a passage to read in itself. */}
      <ol className="mt-6 border-t">
        {book.chapters.map((c) => (
          <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b py-3">
            <Link
              to={`/books/${book.id}/chapters/${c.id}`}
              className="flex min-h-11 items-baseline gap-3 text-sm font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="font-mono text-2xs text-muted-foreground">{String(c.ord).padStart(2, "0")}</span>
              <span>{c.title}</span>
            </Link>
            <span className="font-mono text-2xs text-muted-foreground">
              <ChapterState chapter={c} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One chapter's state in words, for the list and the reader. */
export function ChapterState({ chapter: c }: { chapter: Chapter }) {
  const { t } = useTranslation("book");
  const label = {
    pending: t("chapterStatus.pending"),
    compiling: t("chapterStatus.compiling"),
    ready: t("chapterStatus.ready"),
    error: t("chapterStatus.error"),
    paused: t("chapterStatus.paused"),
  }[c.status];
  return (
    <>
      {label}
      {c.blocks > 0 ? ` · ${t("chapter.blocksWritten", { ready: c.ready, total: c.blocks })}` : ""}
      {c.stale ? ` · ${t("chapter.staleShort")}` : ""}
    </>
  );
}
