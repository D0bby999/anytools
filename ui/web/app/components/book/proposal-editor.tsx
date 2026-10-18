import { useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { fromDraft, MAX_CHAPTERS, toDraft, type Book, type DraftChapter } from "~/lib/book-types";

type ActionData = { errorKey?: string; errorDetail?: string };

let nextKey = 0;

/**
 * The first gate of a living book: the proposed outline, edited by the
 * learner and then confirmed.
 *
 * The learner can rename, reorder, cut and add chapters, rewrite their
 * objectives, choose which earlier chapters each builds on, and choose the
 * passages each is written from — only from the outline the proposal read,
 * which is also all the server accepts. Prerequisites are held by chapter,
 * not by number, so a reorder keeps them; one that ends up pointing forward
 * is dropped when the outline is saved.
 *
 * "Confirm" saves first. Confirming creates the chapters and writes none of
 * them; nothing is spent until a chapter is opened and written.
 */
export function BookProposalEditor({ book }: { book: Book }) {
  const { t } = useTranslation("book");
  const fetcher = useFetcher<ActionData>();
  const outline = book.proposal.outline ?? [];
  const [title, setTitle] = useState(book.proposal.title);
  const [audience, setAudience] = useState(book.proposal.audience);
  const [chapters, setChapters] = useState<DraftChapter[]>(() => toDraft(book.proposal.chapters));
  const busy = fetcher.state !== "idle";

  const update = (key: string, change: Partial<DraftChapter>) =>
    setChapters((cs) => cs.map((c) => (c.key === key ? { ...c, ...change } : c)));
  const move = (i: number, by: number) =>
    setChapters((cs) => {
      const out = [...cs];
      const [c] = out.splice(i, 1);
      if (c) out.splice(i + by, 0, c);
      return out;
    });
  const remove = (key: string) =>
    setChapters((cs) => cs.filter((c) => c.key !== key).map((c) => ({ ...c, prereqs: c.prereqs.filter((k) => k !== key) })));
  const add = () =>
    setChapters((cs) => [...cs, { key: `new${nextKey++}`, title: "", objectives: "", prereqs: [], anchors: [] }]);
  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const incomplete = chapters.some((c) => !c.title.trim() || !c.objectives.trim() || c.anchors.length === 0);
  const payload = JSON.stringify({ title, audience, chapters: fromDraft(chapters) });

  return (
    <fetcher.Form method="post" className="mt-6">
      <input type="hidden" name="proposal" value={payload} />
      <div className="grid gap-3">
        <label className="text-sm">
          <span className="block font-medium">{t("editor.title")}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-background px-3"
          />
        </label>
        <label className="text-sm">
          <span className="block font-medium">{t("editor.audience")}</span>
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            maxLength={300}
            className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-background px-3"
          />
        </label>
      </div>

      <h2 className="lp-kicker mt-8">{t("editor.chapters")}</h2>
      <ol className="mt-3 border-t">
        {chapters.map((c, i) => (
          <li key={c.key} className="border-b py-4" aria-label={t("editor.chapterLabel", { n: i + 1 })}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-2xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <input
                value={c.title}
                onChange={(e) => update(c.key, { title: e.target.value })}
                maxLength={200}
                aria-label={t("editor.chapterTitle")}
                placeholder={t("editor.chapterTitle")}
                className="min-h-11 min-w-48 flex-1 rounded-md border border-control-border bg-background px-3 font-serif"
              />
              <Button type="button" variant="ghost" size="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("editor.up")}>
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={i === chapters.length - 1}
                onClick={() => move(i, 1)}
                aria-label={t("editor.down")}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={chapters.length === 1}
                onClick={() => remove(c.key)}
                aria-label={t("editor.remove")}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>

            <label className="mt-3 block text-sm">
              <span className="block text-xs text-muted-foreground">{t("editor.objectives")}</span>
              <textarea
                value={c.objectives}
                onChange={(e) => update(c.key, { objectives: e.target.value })}
                rows={Math.max(2, c.objectives.split("\n").length)}
                className="mt-1 w-full rounded-md border border-control-border bg-background px-3 py-2 text-sm leading-prose"
              />
            </label>

            {i > 0 ? (
              <fieldset className="mt-3">
                <legend className="text-xs text-muted-foreground">{t("editor.prereqs")}</legend>
                <div className="mt-1 flex flex-wrap gap-x-4">
                  {chapters.slice(0, i).map((earlier, j) => (
                    <label key={earlier.key} className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={c.prereqs.includes(earlier.key)}
                        onChange={() => update(c.key, { prereqs: toggle(c.prereqs, earlier.key) })}
                      />
                      {j + 1}. {earlier.title || t("editor.untitled")}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer py-2 text-sm">
                {t("editor.sources", { count: c.anchors.length })}
              </summary>
              <ul className="mt-1 max-h-72 overflow-y-auto border-t">
                {outline.map((item) => (
                  <li key={item.chunk_id} className="border-b py-2">
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={c.anchors.includes(item.chunk_id)}
                        onChange={() => update(c.key, { anchors: toggle(c.anchors, item.chunk_id) })}
                      />
                      <span>
                        <span className="font-mono text-2xs text-muted-foreground">
                          {item.title}
                          {item.page ? ` · p. ${item.page}` : ""}
                          {item.heading ? ` · ${item.heading}` : ""}
                        </span>
                        <span className="block leading-snug text-muted-foreground">{item.snippet}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
            {c.anchors.length === 0 ? <p className="mt-1 text-xs text-destructive">{t("editor.needsSource")}</p> : null}
          </li>
        ))}
      </ol>

      <Button type="button" variant="outline" size="sm" className="mt-3" disabled={chapters.length >= MAX_CHAPTERS} onClick={add}>
        <Plus aria-hidden="true" />
        {t("editor.add")}
      </Button>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="submit" name="intent" value="save" variant="outline" disabled={busy}>
          {t("editor.save")}
        </Button>
        <Button type="submit" name="intent" value="confirm" disabled={busy || incomplete}>
          {t("editor.confirm")}
        </Button>
        <p className="w-full text-xs leading-snug text-muted-foreground">{t("editor.confirmHint")}</p>
        {fetcher.data?.errorKey ? (
          <p role="alert" className="w-full text-sm text-destructive">
            {t("errors.saveFailed")}
            {fetcher.data.errorDetail ? ` ${fetcher.data.errorDetail}` : ""}
          </p>
        ) : null}
      </div>
    </fetcher.Form>
  );
}
