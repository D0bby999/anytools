/**
 * books.$bookId.chapters.$chapterId.tsx
 * One chapter of a living book (learning depth, phase 11): its blocks, read
 * in order — explanation, example, practice — with its quiz answered in place
 * and its flash cards sent to the Book cards queue.
 *
 * A chapter not yet written says what writing it costs before anything is
 * spent. A chapter whose source documents changed since it was written says
 * so, and "Refresh" rewrites its blocks, each keeping its previous version
 * on the page until the new one is ready.
 */
import { useEffect } from "react";
import { useFetcher, useRevalidator, type UIMatch } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import type { Route } from "./+types/books.$bookId.chapters.$chapterId";
import { appTitle, raw } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { addNote, compileChapter, getBook, getChapter, regenerateBlock, setInReview } from "~/lib/books.server";
import { Button } from "~/components/ui/button";
import { BlockView } from "~/components/book/block-view";
import { ChapterState } from "~/components/book/chapter-list";
import { PageHeader } from "~/components/ui/page-header";
import { BookMeta, type BookMetaItem } from "~/components/doc/book-meta";
import { AtAGlance } from "~/components/doc/at-a-glance";
import { Closing } from "~/components/doc/closing";
import { Prose } from "~/components/reading/doc-section";
import { DateText } from "~/components/ui/date-text";
import type { Pager, PagerHandle } from "~/components/layout/doc-pager";

export function meta({ data, matches }: Route.MetaArgs) {
  return [
    { title: data?.view ? appTitle(matches, raw(data.view.chapter.title)) : appTitle(matches) },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  try {
    const [book, view] = await Promise.all([
      getBook(user.id, params.bookId),
      getChapter(user.id, params.bookId, params.chapterId),
    ]);
    return { book, view };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new Response("Not found", { status: 404 });
    throw error;
  }
}

/** What the pager reads from the loader: the book's chapter order and this chapter. */
type PagerData = {
  book: { id: string; chapters: { id: string; title: string }[] };
  view: { chapter: { id: string } };
};

/**
 * Previous and next chapter, in `book.chapters`' own order (the book's
 * loader already carries the whole chapter list, so no extra fetch is
 * needed). Exported as a plain function so the pager can be unit-tested
 * without mounting the route or a router.
 */
export function chapterPager(data: PagerData | undefined): Pager | null {
  if (!data) return null;
  const { book, view } = data;
  const index = book.chapters.findIndex((c) => c.id === view.chapter.id);
  if (index === -1) return null;
  const prev = index > 0 ? book.chapters[index - 1] : undefined;
  const next = index < book.chapters.length - 1 ? book.chapters[index + 1] : undefined;
  return {
    prev: prev ? { to: `/books/${book.id}/chapters/${prev.id}`, label: prev.title } : undefined,
    next: next ? { to: `/books/${book.id}/chapters/${next.id}`, label: next.title } : undefined,
  };
}

/** A book chapter pages through its own chapters, not NAV_TREE's neighbours. */
export const handle: PagerHandle = {
  pager: (match: UIMatch) => chapterPager(match.data as PagerData | undefined),
};

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const { bookId, chapterId } = params;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const blockId = String(form.get("blockId") ?? "");
  try {
    switch (intent) {
      case "compile":
        await compileChapter(user.id, bookId, chapterId);
        return { started: true };
      case "regenerate":
        await regenerateBlock(user.id, bookId, blockId);
        return { block: blockId };
      case "review":
        await setInReview(user.id, bookId, blockId, form.get("on") === "true");
        return { block: blockId };
      case "note": {
        const markdown = String(form.get("markdown") ?? "").trim();
        if (!markdown) return { errorKey: "errors.emptyNote", errorDetail: "" };
        await addNote(user.id, bookId, chapterId, markdown);
        return { noted: true };
      }
    }
  } catch (error) {
    return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return { errorKey: "errors.generic", errorDetail: "" };
}

export default function ChapterPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("book");
  const { book, view } = loaderData;
  const { chapter, blocks } = view;
  const revalidator = useRevalidator();
  const compiling = chapter.status === "compiling";

  useEffect(() => {
    if (!compiling) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 4000);
    return () => clearInterval(timer);
  }, [compiling, revalidator]);

  const metaItems: BookMetaItem[] = [
    { label: book.title, to: `/books/${book.id}` },
    { label: <ChapterState chapter={chapter} /> },
    ...(chapter.compiled_at
      ? [{ label: <>{t("meta.updated")} <DateText iso={chapter.compiled_at} /></> }]
      : []),
  ];

  return (
    <div>
      <PageHeader title={t("chapter.heading", { n: chapter.ord, title: chapter.title })} className="mb-0">
        <BookMeta items={metaItems} label={t("meta.chapterLabel")} />
      </PageHeader>

      {chapter.objectives.length > 0 ? (
        <Prose>
          <AtAGlance items={chapter.objectives} />
        </Prose>
      ) : null}

      {chapter.stale ? <StaleBanner /> : null}
      {book.paused_reason ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {book.paused_reason}
        </p>
      ) : null}
      {chapter.status === "error" && chapter.error ? (
        <p role="status" className="mt-4 text-sm text-destructive">
          {chapter.error}
        </p>
      ) : null}

      <CompileControl
        compiling={compiling}
        refresh={chapter.blocks > 0 && (chapter.stale || chapter.ready === chapter.blocks)}
        calls={chapter.estimated_calls}
        planned={chapter.blocks > 0}
        busy={book.compiling && !compiling}
      />

      <div>
        {blocks.map((b) => (
          <BlockView key={b.id} block={b} />
        ))}
      </div>

      {/* Keyed on the chapter's note count: a saved note remounts an empty
          form, so saved text is never left looking unsaved. */}
      <NoteForm key={blocks.filter((b) => b.type === "note").length} />

      {/* up's afterword-closing: where the chapter ends. The pager after it
          is the doc layout's, from handle.pager, in the book's own order. */}
      <Closing theme={t("chapter.closing", { n: chapter.ord })} signoff={book.title} />
    </div>
  );
}

/** Source drift: a document this chapter was written from has changed. */
function StaleBanner() {
  const { t } = useTranslation("book");
  return (
    <div role="status" className="mt-4 flex gap-3 rounded-lg border border-warning bg-warning-soft p-4">
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
      <p className="text-sm leading-prose">{t("chapter.stale")}</p>
    </div>
  );
}

/**
 * Write (or refresh) this chapter, saying first what it costs: before a plan
 * exists the most it can be, then one call per block left to write — or per
 * block, when the chapter is refreshed because its sources changed or it is
 * all written.
 */
function CompileControl({
  compiling,
  refresh,
  calls,
  planned,
  busy,
}: {
  compiling: boolean;
  refresh: boolean;
  calls: number;
  planned: boolean;
  busy: boolean;
}) {
  const { t } = useTranslation("book");
  const fetcher = useFetcher<{ errorKey?: string; errorDetail?: string }>();
  if (compiling) {
    return (
      <p role="status" className="mt-6 text-sm text-muted-foreground">
        {t("chapter.compiling")}
      </p>
    );
  }
  return (
    <fetcher.Form method="post" className="mt-6 flex flex-wrap items-center gap-3">
      <input type="hidden" name="intent" value="compile" />
      <Button type="submit" variant={refresh ? "outline" : "default"} disabled={fetcher.state !== "idle" || busy}>
        {refresh ? t("chapter.refresh") : t("chapter.compile")}
      </Button>
      <span className="text-xs text-muted-foreground">
        {planned ? t("chapter.cost", { count: calls }) : t("chapter.costMax", { count: calls })}
      </span>
      {busy ? <span className="w-full text-xs text-muted-foreground">{t("chapter.busy")}</span> : null}
      {fetcher.data?.errorKey ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {t("errors.compileFailed")}
          {fetcher.data.errorDetail ? ` ${fetcher.data.errorDetail}` : ""}
        </p>
      ) : null}
    </fetcher.Form>
  );
}

/** The learner's own note, added at the end of the chapter. */
function NoteForm() {
  const { t } = useTranslation("book");
  const fetcher = useFetcher<{ noted?: boolean; errorKey?: string; errorDetail?: string }>();
  return (
    <fetcher.Form method="post" className="mt-8">
      <input type="hidden" name="intent" value="note" />
      <label className="block text-sm">
        <span className="lp-kicker">{t("chapter.noteLabel")}</span>
        <textarea
          name="markdown"
          rows={3}
          maxLength={5000}
          className="mt-2 w-full rounded-md border border-control-border bg-card px-3 py-2 text-sm leading-prose"
        />
      </label>
      <Button type="submit" variant="outline" size="sm" className="mt-2" disabled={fetcher.state !== "idle"}>
        {t("chapter.addNote")}
      </Button>
      {fetcher.data?.errorKey ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("errors.noteFailed")}
          {fetcher.data.errorDetail ? ` ${fetcher.data.errorDetail}` : ""}
        </p>
      ) : null}
    </fetcher.Form>
  );
}
