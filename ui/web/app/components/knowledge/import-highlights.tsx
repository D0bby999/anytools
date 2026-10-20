import { useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { bookFileName, bookMarkdown, parseHighlights, type Book } from "~/lib/highlights";

/**
 * import-highlights.tsx
 * Knowledge → a knowledge base → Add → Highlights (plans/261020-1155-open-
 * source-adds, phase 5): a Kindle's My Clippings.txt or a KOReader JSON
 * export, read here; the learner ticks the books to add, and each becomes a
 * Markdown document through the page's own upload, one file per book.
 *
 * Uploads are not de-duplicated, so a book whose file name is already a
 * document here is marked and left unticked; adding it again is a choice.
 */

type UploadData = { uploaded?: string; uploadErrorKey?: string; uploadErrorDetail?: string };

export function ImportHighlights({ titles }: { titles: string[] }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<UploadData>();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [sent, setSent] = useState(0);
  const here = new Set(titles);
  const busy = fetcher.state !== "idle";

  const read = async (file: File) => {
    const found = parseHighlights(await file.text());
    setBooks(found);
    setSent(0);
    setPicked(new Set(found.map((b, i) => (here.has(bookFileName(b)) ? -1 : i)).filter((i) => i >= 0)));
  };

  const add = () => {
    if (!books) return;
    const labels = {
      by: t("highlights.by"),
      page: t("highlights.page"),
      location: t("highlights.location"),
      note: t("highlights.note"),
      notes: t("highlights.notes"),
    };
    const body = new FormData();
    body.set("intent", "upload");
    for (const i of picked) {
      const book = books[i]!;
      body.append("file", new File([bookMarkdown(book, labels)], bookFileName(book), { type: "text/markdown" }));
    }
    setSent(picked.size);
    fetcher.submit(body, { method: "post", encType: "multipart/form-data" });
  };

  const done = !busy && sent > 0 && fetcher.data && !fetcher.data.uploadErrorKey;
  return (
    <div className="space-y-3">
      <p className="text-sm leading-prose text-muted-foreground">{t("highlights.lead")}</p>
      <label className="block text-sm">
        <span className="font-medium">{t("highlights.pick")}</span>
        <input
          type="file"
          accept=".txt,.json,text/plain,application/json"
          className="mt-1 lp-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void read(file);
            e.target.value = "";
          }}
        />
      </label>
      {books && books.length === 0 ? (
        <p role="status" className="text-sm">
          {t("highlights.none")}
        </p>
      ) : null}
      {books && books.length > 0 && !done ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("highlights.books", { count: books.length })}</legend>
          <ul className="space-y-1">
            {books.map((b, i) => (
              <li key={i}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={picked.has(i)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      setPicked(next);
                    }}
                  />
                  <span>
                    <span className="font-medium">{b.title}</span>
                    {b.author ? <span className="text-muted-foreground"> · {b.author}</span> : null}
                    <span className="block text-xs text-muted-foreground">
                      {t("highlights.counts", { count: b.highlights.length })}
                      {b.notes.length > 0 ? `, ${t("highlights.loose", { count: b.notes.length })}` : ""}
                      {here.has(bookFileName(b)) ? ` · ${t("highlights.already")}` : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Button type="button" disabled={busy || picked.size === 0} onClick={add}>
            {busy ? t("highlights.adding") : t("highlights.add", { count: picked.size })}
          </Button>
        </fieldset>
      ) : null}
      {done ? (
        <p role="status" className="text-sm">
          {t("highlights.added", { count: sent })}
        </p>
      ) : null}
      {!busy && fetcher.data?.uploadErrorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t(fetcher.data.uploadErrorKey)}
          {fetcher.data.uploadErrorDetail ? ` ${fetcher.data.uploadErrorDetail}` : ""}
        </p>
      ) : null}
    </div>
  );
}
