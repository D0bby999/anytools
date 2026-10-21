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
import { Bot, Plus, X } from "lucide-react";
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
import { SaveToDrive, useFileStorage } from "~/components/storage/save-to-drive";
import { PageHeader } from "~/components/ui/page-header";
import { DateText } from "~/components/ui/date-text";
import { sectionTabClass } from "~/components/ui/section-tabs";
import { BookMeta } from "~/components/doc/book-meta";
import { MarkdownPreview } from "~/components/notebook/markdown-preview";
import { DOC_H2 } from "~/components/reading/doc-section";

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
  const activeCategory = params.get("category");
  const categoryFetcher = useFetcher();
  const onDrive = useFileStorage() === "drive";
  const noteHref = (id: string) =>
    `/notebooks/${notebook.id}?note=${id}${activeCategory ? `&category=${activeCategory}` : ""}#note-${id}`;

  return (
    <div>
      <PageHeader title={notebook.name} className="mb-0">
        <BookMeta
          label={t("notebook.up.metaLabel")}
          items={[
            { label: t("notebook.back"), to: "/notebooks" },
            { label: t("notebook.count", { count: notes.length }) },
            {
              label: (
                <>
                  {t("notebook.up.updated")} <DateText iso={notebook.updated_at} />
                </>
              ),
            },
            {
              label: (
                <a href={`/notebooks/${notebook.id}/export.md`} download>
                  {t("notebook.export")}
                </a>
              ),
            },
            ...(onDrive ? [{ label: <SaveToDrive kind="notebook" id={notebook.id} /> }] : []),
          ]}
        />
      </PageHeader>

      {actionData && "errorKey" in actionData && actionData.errorKey ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {t(actionData.errorKey)}
          {actionData.errorDetail ? ` ${actionData.errorDetail}` : ""}
        </p>
      ) : null}

      {/* Categories filter the notes, as a row of nav links (up's tabs),
          with the new-note action at its end. */}
      <nav aria-label={t("notebook.categories")} className="mt-6 flex flex-wrap items-center gap-1 border-b pb-2">
        <Link
          to={`/notebooks/${notebook.id}`}
          aria-current={!activeCategory ? "page" : undefined}
          className={sectionTabClass({ isActive: !activeCategory })}
        >
          {t("notebook.allNotes")}
        </Link>
        {categories.map((c) => (
          <span key={c.id} className="inline-flex items-center">
            <Link
              to={`/notebooks/${notebook.id}?category=${c.id}`}
              aria-current={activeCategory === c.id ? "page" : undefined}
              className={sectionTabClass({ isActive: activeCategory === c.id })}
            >
              {c.name}
            </Link>
            <categoryFetcher.Form method="post">
              <input type="hidden" name="intent" value="delete-category" />
              <input type="hidden" name="categoryId" value={c.id} />
              <button
                type="submit"
                aria-label={t("notebook.removeCategory", { name: c.name })}
                className="inline-flex size-8 items-center justify-center rounded-sm text-deco hover:bg-hover hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
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
            className="h-8 w-36 rounded-sm border border-control-border bg-card px-2 text-sm hover:border-primary focus-visible:border-primary focus-visible:outline-none"
          />
          <Button type="submit" size="sm" variant="ghost" aria-label={t("notebook.addCategory")}>
            <Plus aria-hidden="true" />
          </Button>
        </categoryFetcher.Form>
        <Form method="post" className="ml-auto">
          <input type="hidden" name="intent" value="create-note" />
          <Button type="submit" size="sm">
            <Plus aria-hidden="true" />
            {t("notebook.newNote")}
          </Button>
        </Form>
      </nav>

      {/* Each note is a section: an h2 (its title, else its date) and its
          text, so the outline lists the notes. Edit opens the editor in
          place of the text. */}
      {notes.length === 0 ? (
        <p className="mt-8 text-base leading-[1.85] text-muted-foreground">{t("notebook.noNotes")}</p>
      ) : (
        notes.map((n) => {
          const editing = n.id === selectedId;
          return (
            <section key={n.id} aria-labelledby={`note-${n.id}`}>
              <h2 id={`note-${n.id}`} className={DOC_H2}>
                {n.title || <DateText iso={n.created_at} />}
              </h2>
              <p className="-mt-2 mb-4 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                {n.created_by === "agent" ? (
                  <>
                    <Bot aria-hidden="true" className="size-3.5" />
                    <span>{t("note.byTutor")}</span>
                    <span aria-hidden="true">·</span>
                  </>
                ) : null}
                <DateText iso={n.updated_at} />
                {editing ? null : (
                  <>
                    <span aria-hidden="true">·</span>
                    <Link
                      to={noteHref(n.id)}
                      preventScrollReset
                      className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover"
                    >
                      {t("notebook.up.edit")}
                      <span className="sr-only"> {n.title || t("note.untitled")}</span>
                    </Link>
                  </>
                )}
              </p>
              {editing ? (
                <NoteEditor key={n.id} note={n} categories={categories} notebooks={notebooks} />
              ) : n.body_md ? (
                <MarkdownPreview source={n.body_md} className="text-base leading-[1.85]" />
              ) : (
                <p className="text-muted-foreground">{t("note.untitled")}</p>
              )}
            </section>
          );
        })
      )}

      <section aria-labelledby="lp-nb-manage">
        <h2 id="lp-nb-manage" className={DOC_H2}>
          {t("notebook.manage")}
        </h2>
        <Form method="post" className="flex flex-wrap items-end gap-2">
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
              className="mt-1 h-10 rounded-sm border border-control-border bg-card px-3 text-sm hover:border-primary focus-visible:border-primary focus-visible:outline-none"
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
              className="border-destructive text-destructive hover:bg-destructive-soft"
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
