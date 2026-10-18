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
import { Link, redirect, useFetcher, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Trash2 } from "lucide-react";
import type { Route } from "./+types/books.$bookId";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { cancelBook, compileBook, confirmBook, deleteBook, getBook, saveProposal } from "~/lib/books.server";
import type { ProposedChapter } from "~/lib/book-types";
import { Button } from "~/components/ui/button";
import { BookProposalEditor } from "~/components/book/proposal-editor";
import { ChapterList } from "~/components/book/chapter-list";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: data?.book ? `${data.book.title} · AnyTools` : "AnyTools" },
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

  return (
    <div className="lp-measure">
      <Link
        to={`/knowledge/${book.kb_id}`}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("book.back")}
      </Link>
      <PageHeader title={book.title} className="mt-2" lede={book.proposal.audience || undefined}>
        <p className="mt-3">
          <span className="lp-tab">{book.status === "proposed" ? t("book.outlineKicker") : t("book.kicker")}</span>
        </p>
      </PageHeader>

      {book.status === "proposed" ? (
        <>
          <p className="mt-4 text-sm leading-prose text-muted-foreground">{t("editor.lead")}</p>
          <BookProposalEditor book={book} />
        </>
      ) : (
        <ChapterList book={book} />
      )}

      <DeleteBook />
    </div>
  );
}

function DeleteBook() {
  const { t } = useTranslation("book");
  const fetcher = useFetcher();
  return (
    <section aria-labelledby="lp-book-danger" className="mt-12 border-t pt-6">
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
          className="text-destructive hover:bg-destructive-soft"
        >
          <Trash2 aria-hidden="true" />
          {t("book.delete")}
        </Button>
      </fetcher.Form>
    </section>
  );
}
