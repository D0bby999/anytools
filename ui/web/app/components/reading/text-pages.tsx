import { useTranslation } from "react-i18next";
import type { DocumentContent } from "~/lib/kb-types";
import { RichText } from "~/components/rich-text";

/**
 * The parsed-text renderer: every format that is not a PDF, and a PDF whose
 * file could not be loaded.
 *
 * Pages keep `id="page-N"` — the anchor every citation resolves against — and
 * `data-page`, which the selection toolbar reads to know which page a
 * selection came from.
 *
 * The Markdown is rendered through RichText, the component every model answer
 * goes through, under the same rules: no raw HTML, no remote images, unsafe
 * URLs dropped. It came out of a parser or a language model reading an
 * uploaded file, so it is untrusted from two directions, and those rules are
 * what make rendering it safe. Shown as pre-wrapped text, a Markdown file read
 * as its own source: "## 3. Ty thể", "**bold**", a table as rows of pipes.
 */
export function TextPages({
  pages,
  onReadPage,
  readPageLabel,
}: {
  pages: DocumentContent["pages"];
  /** Learning depth, phase 7: read one page aloud. */
  onReadPage?: (text: string) => void;
  readPageLabel?: string;
}) {
  const { t } = useTranslation("knowledge");
  return (
    <article className="lp-prose">
      {(pages ?? []).map((page) => (
        <section
          key={page.page}
          id={`page-${page.page}`}
          data-page={page.page}
          aria-labelledby={`page-${page.page}-label`}
          className="scroll-mt-20 border-t py-6 first:border-t-0"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id={`page-${page.page}-label`} className="lp-section">
              {page.page}
            </h2>
            {onReadPage && page.markdown ? (
              <button
                type="button"
                onClick={() => onReadPage(page.markdown)}
                className="inline-flex min-h-11 items-center text-xs text-primary underline underline-offset-4"
              >
                {readPageLabel}
              </button>
            ) : null}
          </div>
          {page.markdown ? (
            <RichText text={page.markdown} sources={[]} listen={false} />
          ) : (
            <p className="text-muted-foreground">{t("viewer.empty")}</p>
          )}
        </section>
      ))}
    </article>
  );
}
