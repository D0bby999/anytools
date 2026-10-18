import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { BookmarkPlus, Trash2 } from "lucide-react";
import type { Highlight } from "~/lib/reading-types";
import { Button } from "~/components/ui/button";

/**
 * The reader's highlights, in page order. Each jumps to its page, can be saved
 * to the notebook (linked back to the highlight), or removed.
 *
 * A list rather than marks painted over the page: the text layer's geometry is
 * pdf.js's, and a highlight drawn over the wrong words is worse than one that
 * is listed with its page.
 */
export function HighlightsPanel({ highlights }: { highlights: Highlight[] }) {
  const { t } = useTranslation("reading");
  const sorted = [...highlights].sort((a, b) => a.page - b.page || a.created_at.localeCompare(b.created_at));

  return (
    <section aria-labelledby="lp-highlights" className="mt-8">
      <h2 id="lp-highlights" className="lp-section">
        {t("highlights.title")}
      </h2>
      {sorted.length === 0 ? (
        <p className="mt-3 lp-empty">{t("highlights.empty")}</p>
      ) : (
        <ul className="mt-3 border-t">
          {sorted.map((h) => (
            <HighlightRow key={h.id} highlight={h} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HighlightRow({ highlight }: { highlight: Highlight }) {
  const { t } = useTranslation("reading");
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";

  return (
    <li className="border-b py-3 text-sm">
      <a
        href={`#page-${highlight.page}`}
        onClick={(event) => {
          const target = document.getElementById(`page-${highlight.page}`);
          if (!target) return;
          event.preventDefault();
          target.scrollIntoView({ block: "start" });
        }}
        className="block rounded-sm leading-snug hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        <span className="font-mono text-2xs text-faint">p.{highlight.page}</span>{" "}
        <span className="line-clamp-3">{highlight.text}</span>
      </a>
      <div className="mt-1 flex flex-wrap gap-1">
        {highlight.note_id ? (
          <span className="inline-flex min-h-9 items-center text-xs text-muted-foreground">{t("highlights.saved")}</span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              fetcher.submit(
                {
                  intent: "capture",
                  body_md: `> ${highlight.text}`,
                  page: String(highlight.page),
                  highlight_id: highlight.id,
                },
                { method: "post" },
              )
            }
          >
            <BookmarkPlus aria-hidden="true" />
            {t("actions.save")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => fetcher.submit({ intent: "delete-highlight", highlightId: highlight.id }, { method: "post" })}
          className="text-destructive hover:bg-destructive-soft"
        >
          <Trash2 aria-hidden="true" />
          {t("highlights.remove")}
        </Button>
      </div>
    </li>
  );
}
