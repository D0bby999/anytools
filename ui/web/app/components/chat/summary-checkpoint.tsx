/**
 * summary-checkpoint.tsx — where the model's memory of a conversation turns
 * from messages into a summary (plan 261021-1100 phase 5, after postclaw's
 * compaction checkpoint).
 *
 * Everything above this row is still on the page, but the model no longer
 * reads it word for word: it reads the summary instead. The row says so, and
 * opens the summary, its four parts named in the learner's language (the
 * server writes their labels in English: capabilities/chat/compaction.go).
 * A summary from before the parts existed is shown as written.
 */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { cn } from "~/lib/utils";

const PARTS = ["goal", "covered", "open", "documents"] as const;
type Part = (typeof PARTS)[number];

/** The summary's labelled parts, in order; null when it has none. */
export function summaryParts(summary: string): { part: Part; text: string }[] | null {
  const out: { part: Part; text: string }[] = [];
  for (const raw of summary.split("\n")) {
    const line = raw.trim().replace(/^[-*#•\s]+/, "").replaceAll("**", "");
    const part = PARTS.find((p) => line.toLowerCase().startsWith(`${p}:`));
    if (part) {
      out.push({ part, text: line.slice(part.length + 1).trim() });
    } else if (line !== "") {
      const prev = out.at(-1);
      if (prev) prev.text += `\n${line}`;
    }
  }
  return out.length > 0 ? out : null;
}

export function SummaryCheckpoint({ summary }: { summary: string }) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const parts = summaryParts(summary);

  return (
    <div data-summary-checkpoint>
      <div className="flex items-center gap-3 text-xs leading-5 text-muted-foreground">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span>{t("chat.checkpoint.label")}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-8 items-center gap-1 rounded-[4px] font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t(open ? "chat.checkpoint.hide" : "chat.checkpoint.show")}
          <ChevronDown aria-hidden="true" className={cn("size-3.5 text-deco transition-transform", open && "rotate-180")} />
        </button>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      <div id={bodyId} hidden={!open} className="mx-auto mt-3 max-w-(--lp-measure-read) rounded-lg bg-sunken px-4 py-3 text-sm leading-6">
        <p className="mb-2 text-xs leading-5 text-muted-foreground">{t("chat.checkpoint.help")}</p>
        {parts ? (
          <dl className="grid gap-2">
            {parts.map(({ part, text }, i) => (
              <div key={i}>
                <dt className="font-medium text-foreground">{t(`chat.checkpoint.parts.${part}`)}</dt>
                <dd className="whitespace-pre-wrap break-words text-muted-foreground">
                  {/^none\.?$/i.test(text) ? t("chat.checkpoint.none") : text}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="whitespace-pre-wrap break-words text-muted-foreground">{summary}</p>
        )}
      </div>
    </div>
  );
}
