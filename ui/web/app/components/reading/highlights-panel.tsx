import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { Highlight } from "~/lib/reading-types";

/** A row's action, as the chat's action row: 12/500 secondary ink, a text link. */
const ACTION =
  "inline-flex min-h-8 cursor-pointer items-center font-medium text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50";

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
      <h2 id="lp-highlights" data-outline-ignore className="text-sm leading-8 font-semibold">
        {t("highlights.title")}
      </h2>
      {sorted.length === 0 ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("highlights.empty")}</p>
      ) : (
        // A small dated list (P4): **p. N** · the passage, its two actions under it.
        <ul className="mt-2 list-disc space-y-3 pl-5 text-sm leading-6">
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
    <li>
      <a
        href={`#page-${highlight.page}`}
        onClick={(event) => {
          const target = document.getElementById(`page-${highlight.page}`);
          if (!target) return;
          event.preventDefault();
          target.scrollIntoView({ block: "start" });
        }}
        className="rounded-sm text-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        <strong className="font-semibold">p.{highlight.page}</strong>
        {" · "}
        <span className="line-clamp-3 inline">{highlight.text}</span>
      </a>
      <div className="flex flex-wrap items-center gap-x-1 text-xs">
        {highlight.note_id ? (
          <span className="text-muted-foreground">{t("highlights.saved")}</span>
        ) : (
          <button
            type="button"
            className={ACTION}
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
            {t("actions.save")}
          </button>
        )}
        <span aria-hidden="true">·</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => fetcher.submit({ intent: "delete-highlight", highlightId: highlight.id }, { method: "post" })}
          className={`${ACTION} hover:text-destructive`}
        >
          {t("highlights.remove")}
        </button>
      </div>
    </li>
  );
}
