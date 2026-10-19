import { useTranslation } from "react-i18next";
import { ChevronRight, Search } from "lucide-react";
import { workTotals, type WorkStep, type WorkView } from "~/lib/chat-work";

/** Tools with their own words; anything else reads as "Used <name>". */
const KNOWN_TOOLS = new Set([
  "rag_search",
  "read_source",
  "kb_files",
  "write_note",
  "ask_user",
  "paper_search",
  "zotero_search",
  "web_search",
  "web_fetch",
]);

/**
 * How an answer was found: one folded line above it, the steps when opened.
 *
 * It sits in the transcript rather than in the side panel because the
 * question "where did this come from" is asked of one answer, while reading
 * it; postclaw's grouped work details (chat-surface.md) made the same move.
 * Folded by default and quiet in colour: the answer is the page, this is its
 * margin note. While the turn runs, the line names the step in progress, and
 * nothing spins (reduced motion is respected by not animating at all).
 */
export function WorkRow({ work, live = false }: { work: WorkView; live?: boolean }) {
  const { t } = useTranslation("common");
  const totals = workTotals(work);
  const running = [...work.steps].reverse().find((s) => s.running);
  const notes = workNotes(work, t);
  if (work.steps.length === 0 && notes.length === 0) return null;

  const parts: string[] = [];
  if (running) {
    parts.push(stepLabel(running, t, "running"));
  } else {
    if (totals.searches > 0) parts.push(t("chat.work.searches", { count: totals.searches }));
    else if (totals.steps > 0) parts.push(t("chat.work.steps", { count: totals.steps }));
    else parts.push(t("chat.work.title"));
    if (totals.passages > 0) parts.push(t("chat.work.passages", { count: totals.passages }));
    if (work.ms && work.ms >= 1000) parts.push(t("chat.work.seconds", { value: (work.ms / 1000).toFixed(1) }));
  }

  return (
    <details className="group mb-2 text-xs leading-ui text-muted-foreground" data-testid="work-row">
      <summary className="flex min-h-8 w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 hover:bg-sunken hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate" aria-live={live ? "polite" : undefined}>
          {parts.join(" · ")}
        </span>
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
      </summary>

      <ol className="mt-1 ml-2 flex flex-col gap-1 rounded-md border px-3 py-2">
        {work.steps.map((step, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
            <span className={step.error ? "text-destructive" : "text-foreground"}>
              {stepLabel(step, t, step.running ? "running" : "done")}
            </span>
            {step.detail ? <span className="min-w-0 break-words">“{step.detail}”</span> : null}
            {step.repeated ? <span>· {t("chat.work.repeated")}</span> : null}
            {step.error ? <span className="text-destructive">· {t("chat.work.failed")}</span> : null}
            {step.found ? <span>· {t("chat.work.passages", { count: step.found })}</span> : null}
          </li>
        ))}
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ol>
    </details>
  );
}

type T = (key: string, opts?: Record<string, unknown>) => string;

function stepLabel(step: WorkStep, t: T, state: "running" | "done"): string {
  if (KNOWN_TOOLS.has(step.tool)) return t(`chat.work.tool.${step.tool}.${state}`);
  return t(`chat.work.tool.other.${state}`, { tool: step.tool });
}

function workNotes(work: WorkView, t: T): string[] {
  const notes: string[] = [];
  if (work.summarised) notes.push(t("chat.work.summarised", { count: work.summarised }));
  if (work.limitReached) notes.push(t("chat.work.limitReached"));
  if (work.continued) notes.push(t("chat.work.continued"));
  if (work.contextTokens && work.contextWindow) {
    notes.push(
      t("chat.work.context", {
        used: compact(work.contextTokens),
        window: compact(work.contextWindow),
      }),
    );
  }
  return notes;
}

/** 3200 → "3.2k", 1048576 → "1M". */
function compact(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}
