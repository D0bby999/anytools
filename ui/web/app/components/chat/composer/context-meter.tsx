/**
 * context-meter.tsx — how full the model's window is (after postclaw's
 * context meter).
 *
 * A 48px bar beside the model: what the last question sent against the
 * model's window, with a tick where earlier messages start to be summarised
 * (the chat capability's history budget). Numbers in text beside it, and a
 * sentence for a screen reader and on hover; the bar alone carries nothing.
 */
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";

/** 3200 → "3.2k", 1048576 → "1M". */
export function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

export function ContextMeter({ used, window, budget }: { used: number; window: number; budget?: number }) {
  const { t } = useTranslation("common");
  if (!(used > 0 && window > 0)) return null;
  const share = Math.min(1, used / window);
  const tick = budget && budget < window ? budget / window : null;
  const full = share >= 0.8;
  const sentence = t("chat.context.meter", {
    used: compactTokens(used),
    window: compactTokens(window),
    percent: Math.round(share * 100),
  });
  const note = budget ? t("chat.context.budget", { budget: compactTokens(budget) }) : "";
  return (
    <div className="flex items-center gap-2 text-xs leading-ui text-muted-foreground" title={note ? `${sentence} ${note}` : sentence}>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={window}
        aria-valuenow={used}
        aria-label={t("chat.context.label")}
        aria-valuetext={sentence}
        className="relative h-1.5 w-12 overflow-hidden rounded-full bg-sunken"
      >
        <div className={cn("h-full rounded-full", full ? "bg-warning" : "bg-primary")} style={{ width: `${share * 100}%` }} />
        {tick !== null ? (
          <span aria-hidden="true" className="absolute inset-y-0 w-px bg-foreground" style={{ left: `${tick * 100}%` }} />
        ) : null}
      </div>
      <span className="tabular-nums" aria-hidden="true">
        {compactTokens(used)} / {compactTokens(window)}
      </span>
      {note ? <span className="sr-only">{note}</span> : null}
    </div>
  );
}
