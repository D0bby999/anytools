/**
 * notebooks.$notebookId.tsx
 * One notebook: its notes (filterable by category), the selected note's
 * editor, categories, rename, export as Markdown, and delete.
 *
 * The selected note and the category filter are search params (`?note=`,
 * `?category=`), so a note is a link and the back button works.
 */
import { Form, Link, redirect, useFetcher, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Bot, Download, Plus, X } from "lucide-react";
import type { Route } from "./+types/notebooks.$notebookId";
import { appTitle, raw } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import {
  copyNote,
  createCategory,
  createNote,
  deleteCategory,
  deleteNote,
  deleteNotebook,
  getNotebook,
  listCategories,
  listNotebooks,
  listNotes,
  moveNote,
  renameNotebook,
  updateNote,
} from "~/lib/notebook.server";
import { Button } from "~/components/ui/button";
import { NoteEditor } from "~/components/notebook/note-editor";
import { SaveToDrive } from "~/components/storage/save-to-drive";
import { PageHeader } from "~/components/ui/page-header";
import { DateText } from "~/components/ui/date-text";
import { plainText } from "~/lib/speech";

export function meta({ data, matches }: Route.MetaArgs) {
  return [
    { title: data?.notebook ? appTitle(matches, raw(data.notebook.name)) : appTitle(matches, "Notebook") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? undefined;
  try {
    const [notebook, notes, categories, all] = await Promise.all([
      getNotebook(user.id, params.notebookId),
      listNotes(user.id, params.notebookId, category),
      listCategories(user.id, params.notebookId),
      listNotebooks(user.id),
    ]);
    return { notebook, notes: notes.notes, categories: categories.categories, notebooks: all.notebooks };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Response("Not found", { status: 404 });
    }
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const noteId = String(form.get("noteId") ?? "");
  const here = `/notebooks/${params.notebookId}`;

  try {
    switch (intent) {
      case "create-note": {
        const created = await createNote(user.id, params.notebookId, {
          title: String(form.get("title") ?? "").trim() || "Untitled",
          body_md: "",
        });
        return redirect(`${here}?note=${created.id}`);
      }
      case "update": {
        await updateNote(user.id, noteId, {
          title: String(form.get("title") ?? ""),
          body_md: String(form.get("body_md") ?? ""),
          ...(form.get("categories_present") ? { category_ids: form.getAll("category_ids").map(String) } : {}),
        });
        return { saved: true };
      }
      case "move":
        await moveNote(user.id, noteId, String(form.get("notebookId") ?? ""));
        return redirect(here);
      case "copy":
        await copyNote(user.id, noteId, String(form.get("notebookId") ?? ""));
        return { copied: true };
      case "delete-note":
        await deleteNote(user.id, noteId);
        return redirect(here);
      case "create-category":
        await createCategory(user.id, params.notebookId, String(form.get("name") ?? "").trim());
        return null;
      case "delete-category":
        await deleteCategory(user.id, String(form.get("categoryId") ?? ""));
        return redirect(here);
      case "rename":
        await renameNotebook(user.id, params.notebookId, String(form.get("name") ?? "").trim());
        return null;
      case "delete-notebook":
        await deleteNotebook(user.id, params.notebookId);
        return redirect("/notebooks");
    }
  } catch (error) {
    return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return null;
}

export default function NotebookPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("reading");
  const [params] = useSearchParams();
  const { notebook, notes, categories, notebooks } = loaderData;
  const selectedId = params.get("note");
  const selected = notes.find((n) => n.id === selectedId) ?? null;
  const activeCategory = params.get("category");
  const categoryFetcher = useFetcher();

  return (
    <div className="lp-measure">
      <Link
        to="/notebooks"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("notebook.back")}
      </Link>

      <div className="lp-page-enter mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="text-3xl leading-tight break-words lg:text-4xl">{notebook.name}</h1>
        <div className="flex flex-wrap items-center gap-x-4">
          <a
            href={`/notebooks/${notebook.id}/export.md`}
            download
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary underline underline-offset-4"
          >
            <Download aria-hidden="true" className="size-4" />
            {t("notebook.export")}
          </a>
          <SaveToDrive kind="notebook" id={notebook.id} />
        </div>
      </div>

      {actionData && "errorKey" in actionData && actionData.errorKey ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {t(actionData.errorKey)}
          {actionData.errorDetail ? ` ${actionData.errorDetail}` : ""}
        </p>
      ) : null}

      <section aria-labelledby="lp-nb-categories" className="mt-6">
        <h2 id="lp-nb-categories" className="lp-section">
          {t("notebook.categories")}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            to={`/notebooks/${notebook.id}`}
            aria-current={!activeCategory ? "true" : undefined}
            className="inline-flex min-h-9 items-center rounded-full border px-3 text-xs aria-[current]:bg-selected aria-[current]:text-selected-foreground"
          >
            {t("notebook.allNotes")}
          </Link>
          {categories.map((c) => (
            <span key={c.id} className="inline-flex items-center">
              <Link
                to={`/notebooks/${notebook.id}?category=${c.id}`}
                aria-current={activeCategory === c.id ? "true" : undefined}
                className="inline-flex min-h-9 items-center rounded-l-full border px-3 text-xs aria-[current]:bg-selected aria-[current]:text-selected-foreground"
              >
                {c.name}
              </Link>
              <categoryFetcher.Form method="post">
                <input type="hidden" name="intent" value="delete-category" />
                <input type="hidden" name="categoryId" value={c.id} />
                <button
                  type="submit"
                  aria-label={t("notebook.removeCategory", { name: c.name })}
                  className="inline-flex min-h-9 items-center rounded-r-full border border-l-0 px-2 text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </categoryFetcher.Form>
            </span>
          ))}
          <categoryFetcher.Form method="post" className="inline-flex items-center gap-1">
            <input type="hidden" name="intent" value="create-category" />
            <label htmlFor="lp-cat-name" className="sr-only">
              {t("notebook.newCategory")}
            </label>
            <input
              id="lp-cat-name"
              name="name"
              required
              maxLength={100}
              placeholder={t("notebook.newCategory")}
              className="min-h-9 w-36 rounded-md border border-control-border bg-card px-2 text-xs"
            />
            <Button type="submit" size="sm" variant="ghost" aria-label={t("notebook.addCategory")}>
              <Plus aria-hidden="true" />
            </Button>
          </categoryFetcher.Form>
        </div>
      </section>

      <section aria-labelledby="lp-nb-notes" className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 id="lp-nb-notes" className="lp-section">
            {t("notebook.notes")}
          </h2>
          <Form method="post">
            <input type="hidden" name="intent" value="create-note" />
            <Button type="submit" size="sm">
              <Plus aria-hidden="true" />
              {t("notebook.newNote")}
            </Button>
          </Form>
        </div>
        {notes.length === 0 ? (
          <p className="mt-3 lp-empty">{t("notebook.noNotes")}</p>
        ) : (
          <ul className="mt-3 border-t">
            {notes.map((n) => (
              <li key={n.id} className="border-b">
                <Link
                  to={`/notebooks/${notebook.id}?note=${n.id}${activeCategory ? `&category=${activeCategory}` : ""}`}
                  aria-current={n.id === selectedId ? "true" : undefined}
                  className="grid min-h-11 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 px-1 py-3 transition-colors hover:bg-primary-soft aria-[current]:bg-selected"
                >
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    {n.created_by === "agent" ? (
                      <Bot aria-label={t("note.byTutor")} className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                    <span className="truncate">{n.title || t("note.untitled")}</span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    <DateText iso={n.updated_at} />
                  </span>
                  {/* The first line of the note, so a list of titles can be
                      told apart without opening each. */}
                  {n.body_md ? (
                    <span className="col-span-2 truncate text-xs leading-ui text-muted-foreground">
                      {plainText(n.body_md)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <div className="mt-8">
          <NoteEditor key={selected.id} note={selected} categories={categories} notebooks={notebooks} />
        </div>
      ) : null}

      <section aria-labelledby="lp-nb-manage" className="mt-12 border-t pt-6">
        <h2 id="lp-nb-manage" className="lp-section">
          {t("notebook.manage")}
        </h2>
        <Form method="post" className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="rename" />
          <div>
            <label htmlFor="lp-nb-rename" className="block text-sm font-medium">
              {t("notebook.rename")}
            </label>
            <input
              id="lp-nb-rename"
              name="name"
              required
              maxLength={200}
              defaultValue={notebook.name}
              className="mt-1 min-h-11 rounded-md border border-control-border bg-card px-3 text-sm"
            />
          </div>
          <Button type="submit" variant="outline">
            {t("notebook.renameSubmit")}
          </Button>
        </Form>
        {!notebook.is_default ? (
          <Form method="post" className="mt-4">
            <input type="hidden" name="intent" value="delete-notebook" />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive-soft"
              onClick={(event) => {
                if (!window.confirm(t("notebook.deleteConfirm"))) event.preventDefault();
              }}
            >
              {t("notebook.delete")}
            </Button>
          </Form>
        ) : null}
      </section>
    </div>
  );
}
