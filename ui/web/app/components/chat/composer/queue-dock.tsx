/**
 * queue-dock.tsx — messages waiting behind the answer being written (after
 * postclaw's QueueDock).
 *
 * Up to MAX_QUEUED, kept for this tab (sessionStorage). They go one by one as
 * answers finish. A failure or a stop pauses them with the reason, and "Send
 * next" resumes; nothing is sent into a problem on its own.
 */
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "~/components/ui/button";

/** The most messages that can wait behind a running turn. */
export const MAX_QUEUED = 5;

export function QueueDock({
  items,
  onRemove,
  paused,
  onResume,
}: {
  items: string[];
  onRemove?: (index: number) => void;
  /** Why the queue waits ("stopped", "failed"), or null while it drains. */
  paused?: "stopped" | "failed" | null;
  onResume?: () => void;
}) {
  const { t } = useTranslation("common");
  if (items.length === 0) return null;
  return (
    <section aria-label={t("chat.queue.title", { count: items.length })} className="mb-2 rounded-lg border bg-card p-2" data-testid="queue-dock">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-xs leading-ui text-muted-foreground">
          {paused ? t(paused === "stopped" ? "chat.queue.pausedStopped" : "chat.queue.pausedFailed", { count: items.length }) : t("chat.queue.title", { count: items.length })}
        </p>
        {paused && onResume ? (
          <Button type="button" size="sm" variant="outline" onClick={onResume}>
            {t("chat.queue.resume")}
          </Button>
        ) : null}
      </div>
      <ol className="mt-1 flex flex-col gap-1">
        {items.map((q, i) => (
          <li key={`${i}-${q}`} className="flex items-center gap-2 rounded-md bg-sunken px-2 py-1 text-sm">
            <span aria-hidden="true" className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate">{q}</span>
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">{t("chat.queue.remove", { message: q })}</span>
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
