/**
 * books.$bookId.tsx
 * A living book (learning depth, phase 11). While it is proposed, the outline
 * editor — the first gate. Once confirmed, its chapters: each opened and
 * written on request, or all written by one background job, with what that
 * costs said first.
 *
 * The page reloads every few seconds while a chapter is being written.
 */
import { useEffect } from "react";
import { redirect, useFetcher, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import type { Route } from "./+types/books.$bookId";
import { appTitle, raw } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { cancelBook, compileBook, confirmBook, deleteBook, getBook, saveProposal } from "~/lib/books.server";
import type { ProposedChapter } from "~/lib/book-types";
import { Button } from "~/components/ui/button";
import { BookProposalEditor } from "~/components/book/proposal-editor";
import { ChapterList } from "~/components/book/chapter-list";
import { PageHeader } from "~/components/ui/page-header";
import { BookMeta, type BookMetaItem } from "~/components/doc/book-meta";
import { QuickStart } from "~/components/doc/quick-start";
import { Details } from "~/components/doc/details";
import { DateText } from "~/components/ui/date-text";
import { DocSection } from "~/components/reading/doc-section";

export function meta({ data, matches }: Route.MetaArgs) {
  return [
    { title: data?.book ? appTitle(matches, raw(data.book.title)) : appTitle(matches) },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  try {
    return { book: await getBook(user.id, params.bookId) };
  } catch (error) {
    // Another user's book answers exactly as a missing one.
    if (error instanceof ApiError && error.status === 404) throw new Response("Not found", { status: 404 });
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const id = params.bookId;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    switch (intent) {
      case "save":
      case "confirm": {
        let proposal: { title: string; audience: string; chapters: ProposedChapter[] };
        try {
          proposal = JSON.parse(String(form.get("proposal") ?? "")) as typeof proposal;
        } catch {
          return { errorKey: "errors.saveFailed", errorDetail: "" };
        }
        await saveProposal(user.id, id, proposal);
        if (intent === "confirm") await confirmBook(user.id, id);
        return { saved: true };
      }
      case "compile-all":
        await compileBook(user.id, id);
        return { started: true };
      case "cancel":
        await cancelBook(user.id, id);
        return { cancelled: true };
      case "delete": {
        const { kb_id } = await getBook(user.id, id);
        await deleteBook(user.id, id);
        return redirect(`/knowledge/${kb_id}`);
      }
    }
  } catch (error) {
    return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return { errorKey: "errors.generic", errorDetail: "" };
}

export default function BookPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("book");
  const { book } = loaderData;
  const revalidator = useRevalidator();

  useEffect(() => {
    if (!book.compiling) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 4000);
    return () => clearInterval(timer);
  }, [book.compiling, revalidator]);

  const written = book.chapters.filter((c) => c.status === "ready").length;
  // No field tracks where the learner left off reading (only writing
  // progress is tracked), so the quick-start always opens chapter one
  // rather than guessing a "continue" target.
  const firstChapter = book.chapters[0];

  const metaItems: BookMetaItem[] = [
    ...(book.chapters.length > 0 ? [{ label: t("chapters.count", { count: book.chapters.length }) }] : []),
    ...(book.chapters.length > 0 ? [{ label: t("kb.progress", { ready: written, total: book.chapters.length }) }] : []),
    { label: <>{t("meta.updated")} <DateText iso={book.updated_at} /></> },
  ];

  return (
    <div>
      <PageHeader title={book.title} lede={book.proposal.audience || undefined} className="mb-0">
        <BookMeta
          label={t("meta.bookLabel")}
          items={[
            { label: t("book.back"), to: `/knowledge/${book.kb_id}` },
            { label: book.status === "proposed" ? t("book.outlineKicker") : t("book.kicker") },
            ...metaItems,
            // A plain anchor: the export is a resource route, so it must be a
            // real browser navigation for its download headers to apply.
            ...(book.status === "proposed"
              ? []
              : [{ label: <a href={`/books/${book.id}/export.md`}>{t("book.export")}</a> }]),
          ]}
        />
      </PageHeader>

      {book.status === "proposed" ? (
        // The outline is editable only while it is a proposal (the API
        // refuses an edit after Confirm), so the editor folds here, open.
        <Details summary={t("book.up.editProposal")} open className="mt-8">
          <p className="text-sm leading-6 text-muted-foreground">{t("editor.lead")}</p>
          <BookProposalEditor book={book} />
        </Details>
      ) : (
        <>
          {firstChapter ? (
            <QuickStart
              kicker={t("book.up.kicker")}
              title={t("book.up.title")}
              primary={{ label: t("book.up.readFrom1"), to: `/books/${book.id}/chapters/${firstChapter.id}` }}
            />
          ) : null}

          <DocSection title={t("book.up.contents")} id="lp-book-contents">
            <ChapterList book={book} />
          </DocSection>
        </>
      )}

      <DeleteBook />
    </div>
  );
}

function DeleteBook() {
  const { t } = useTranslation("book");
  const fetcher = useFetcher();
  return (
    <section aria-labelledby="lp-book-danger" className="mt-16 border-t pt-6">
      <h2 id="lp-book-danger" className="sr-only">
        {t("book.delete")}
      </h2>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="delete" />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={fetcher.state !== "idle"}
          onClick={(event) => {
            if (!window.confirm(t("book.deleteConfirm"))) event.preventDefault();
          }}
          className="border-destructive text-destructive hover:bg-destructive-soft"
        >
          <Trash2 aria-hidden="true" />
          {t("book.delete")}
        </Button>
      </fetcher.Form>
    </section>
  );
}
