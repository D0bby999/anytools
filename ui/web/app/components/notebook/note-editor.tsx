import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Bot, Trash2 } from "lucide-react";
import type { Category, Note, Notebook } from "~/lib/reading-types";
import { sourceHref } from "~/lib/reading-types";
import { Button } from "~/components/ui/button";
import { MarkdownPreview } from "~/components/notebook/markdown-preview";
import { sectionTabClass } from "~/components/ui/section-tabs";

/**
 * One note, editable: title, Markdown body with a preview tab, categories,
 * move or copy to another notebook, delete. Every control posts an intent to
 * the notebook route's action.
 *
 * Keyed by note id by the caller, so switching notes resets the draft.
 */
export function NoteEditor({
  note,
  categories,
  notebooks,
}: {
  note: Note;
  categories: Category[];
  notebooks: Notebook[];
}) {
  const { t } = useTranslation("reading");
  const save = useFetcher<{ errorKey?: string; errorDetail?: string }>();
  const other = useFetcher<{ errorKey?: string; errorDetail?: string }>();
  const [preview, setPreview] = useState(false);
  const [body, setBody] = useState(note.body_md);

  const href = sourceHref(note.source);
  const targets = notebooks.filter((nb) => nb.id !== note.notebook_id);
  const error = save.data?.errorKey ? save.data : other.data;

  return (
    // In place of the note's text under its h2: a 1px box, radius 8.
    <article aria-labelledby="lp-note-editor" className="rounded-lg border bg-card p-4 sm:p-5">
      <h3 id="lp-note-editor" className="text-sm leading-6 font-semibold text-muted-foreground">
        {t("note.editing")}
      </h3>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {note.created_by === "agent" ? (
          <span className="inline-flex items-center gap-1">
            <Bot aria-hidden="true" className="size-3.5" />
            {t("note.byTutor")}
          </span>
        ) : null}
        {href ? (
          <Link to={href} className="text-primary underline underline-offset-4">
            {note.source.page ? t("note.sourcePage", { page: note.source.page }) : t("note.source")}
          </Link>
        ) : null}
      </p>

      <save.Form method="post" className="mt-3 space-y-3">
        <input type="hidden" name="intent" value="update" />
        <input type="hidden" name="noteId" value={note.id} />
        <div>
          <label htmlFor="lp-note-title" className="block text-sm font-medium">
            {t("note.titleLabel")}
          </label>
          <input
            id="lp-note-title"
            name="title"
            defaultValue={note.title}
            maxLength={300}
            className="mt-1 h-10 w-full rounded-sm border border-control-border bg-card px-3 text-sm hover:border-primary focus-visible:border-primary focus-visible:outline-none"
          />
        </div>

        {/* Write / Preview as nav links, as up's tabs: the chosen one in the
            action ink, never an underline. */}
        <div role="tablist" aria-label={t("note.bodyLabel")} className="flex gap-1 border-b pb-1">
          <button type="button" role="tab" aria-selected={!preview} className={sectionTabClass({ isActive: !preview })} onClick={() => setPreview(false)}>
            {t("note.write")}
          </button>
          <button type="button" role="tab" aria-selected={preview} className={sectionTabClass({ isActive: preview })} onClick={() => setPreview(true)}>
            {t("note.preview")}
          </button>
        </div>
        {/* The textarea stays mounted while previewing so the draft is what
            gets submitted either way. */}
        <label htmlFor="lp-note-body" className="sr-only">
          {t("note.bodyLabel")}
        </label>
        <textarea
          id="lp-note-body"
          name="body_md"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          hidden={preview}
          className="w-full rounded-sm border border-control-border bg-card px-3 py-2 font-mono text-sm leading-6 hover:border-primary focus-visible:border-primary focus-visible:outline-none"
        />
        {preview ? (
          <div className="min-h-40 rounded-sm border px-3 py-2">
            <MarkdownPreview source={body} />
          </div>
        ) : null}

        {categories.length > 0 ? (
          <fieldset>
            <legend className="text-sm font-medium">{t("note.categories")}</legend>
            {/* Marks the set as present, so unticking every box clears it
                rather than leaving it unchanged. */}
            <input type="hidden" name="categories_present" value="1" />
            <div className="mt-1 flex flex-wrap gap-x-5">
              {categories.map((c) => (
                <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="category_ids" value={c.id} defaultChecked={note.category_ids.includes(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <Button type="submit" disabled={save.state !== "idle"}>
          {save.state !== "idle" ? t("note.saving") : t("note.save")}
        </Button>
      </save.Form>

      <div className="mt-6 flex flex-wrap items-end gap-3 border-t pt-4">
        {targets.length > 0 ? (
          <other.Form method="post" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="noteId" value={note.id} />
            <div>
              <label htmlFor="lp-note-target" className="block text-sm font-medium">
                {t("note.otherNotebook")}
              </label>
              <select
                id="lp-note-target"
                name="notebookId"
                className="mt-1 h-10 rounded-sm border border-control-border bg-card px-3 text-sm hover:border-primary focus-visible:border-primary focus-visible:outline-none"
              >
                {targets.map((nb) => (
                  <option key={nb.id} value={nb.id}>
                    {nb.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" name="intent" value="move" variant="outline" disabled={other.state !== "idle"}>
              {t("note.move")}
            </Button>
            <Button type="submit" name="intent" value="copy" variant="outline" disabled={other.state !== "idle"}>
              {t("note.copy")}
            </Button>
          </other.Form>
        ) : null}
        <other.Form method="post">
          <input type="hidden" name="intent" value="delete-note" />
          <input type="hidden" name="noteId" value={note.id} />
          <Button
            type="submit"
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive-soft"
            disabled={other.state !== "idle"}
            onClick={(event) => {
              if (!window.confirm(t("note.deleteConfirm"))) event.preventDefault();
            }}
          >
            <Trash2 aria-hidden="true" />
            {t("note.delete")}
          </Button>
        </other.Form>
      </div>

      {error?.errorKey ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {t(error.errorKey)}
          {error.errorDetail ? ` ${error.errorDetail}` : ""}
        </p>
      ) : null}
    </article>
  );
}
