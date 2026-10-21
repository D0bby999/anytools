/**
 * process-row.tsx — how an answer was found, grouped and folded the way
 * postclaw shows its work (DeepSeek Harness `standard` work details).
 *
 * - While the answer streams, its steps show as groups by kind of work, each
 *   folded to one row; the live group names what it is doing now and the
 *   step's own argument ("Searching your documents · Ohm's law"), held at
 *   least 150 ms so a fast tool does not flicker the title.
 * - A completed answer folds all of that behind one row ("Searched, Read
 *   sources · 9 passages · 3.1 s"), so the answer sits under the question.
 * - A failed or stopped answer keeps its work open: it is why the reader is
 *   looking.
 *
 * Folded content stays mounted (`UntilFound`), so find-in-page and the
 * conversation's search still reach it. Nothing spins.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { workTotals, type WorkStep, type WorkView } from "~/lib/chat-work";
import { CATEGORY_ICONS, categoryLabelKey, TOOL_CATEGORIES } from "~/lib/chat-tool-categories";
import {
  groupSteps,
  isGroupOpen,
  isTurnOpen,
  liveDetail,
  turnCategories,
  type ProcessGroup,
  type TurnState,
} from "~/lib/chat-process-groups";
import { DisclosureRow } from "~/components/chat/shared/disclosure-row";
import { LiveLabel } from "~/components/chat/shared/live-label";
import { UntilFound } from "~/components/chat/shared/until-found";
import { useFolds } from "~/components/chat/folds";
import { cn } from "~/lib/utils";

/** postclaw's LIVE_TITLE_MIN_MS: a live title stays up at least this long. */
export const LIVE_TITLE_MIN_MS = 150;

type T = (key: string, opts?: Record<string, unknown>) => string;

/** The fold keys under one answer, for "Expand all". */
export function processFoldKeys(turnId: string, work: WorkView | null | undefined, thinking?: string): string[] {
  const groups = groupSteps(work?.steps ?? [], { thinking });
  return [turnId, ...groups.map((g) => `${turnId}:${g.key}`)];
}

export function ProcessRow({
  turnId,
  work,
  thinking,
  state,
}: {
  turnId: string;
  work: WorkView | null | undefined;
  /** Live reasoning, while the answer streams. */
  thinking?: string;
  state: TurnState;
}) {
  const { t } = useTranslation("common");
  const folds = useFolds();
  const bodyId = useId();
  const steps = work?.steps ?? [];
  const groups = groupSteps(steps, { thinking, running: state === "running" });
  const notes = work ? workNotes(work, t) : [];
  if (groups.length === 0 && notes.length === 0) return null;

  const body = (
    <div className="flex flex-col">
      {groups.map((g) => (
        <GroupRow key={g.key} turnId={turnId} group={g} />
      ))}
      {notes.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1 pl-5 text-sm leading-6 text-muted-foreground">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  // Running or interrupted: no turn row, the groups themselves are shown.
  if (state !== "done") {
    return (
      <div className="mb-3" data-testid="process-row" data-state={state} data-chat-searchable>
        {body}
      </div>
    );
  }

  const open = isTurnOpen(state, folds.get(turnId));
  const totals = work ? workTotals(work) : { passages: 0 };
  const summary: string[] = [];
  if (totals.passages > 0) summary.push(t("chat.work.passages", { count: totals.passages }));
  if (work?.ms && work.ms >= 1000) summary.push(t("chat.work.seconds", { value: (work.ms / 1000).toFixed(1) }));
  const title = categoryList(turnCategories(steps, !!thinking), t) || t("chat.work.title");

  return (
    <div className="mb-3" data-testid="process-row" data-state={state}>
      <DisclosureRow
        expanded={open}
        controls={bodyId}
        onToggle={() => folds.set(turnId, !open)}
        label={title}
        summary={summary.length > 0 ? summary.join(" · ") : undefined}
        testId="process-turn"
      />
      <div id={bodyId}>
        <UntilFound open={open} foldKey={turnId} onReveal={() => folds.set(turnId, true)} className={open ? "mt-1 pl-5" : "pl-5"}>
          <div data-chat-searchable>{body}</div>
        </UntilFound>
      </div>
    </div>
  );
}

function GroupRow({ turnId, group }: { turnId: string; group: ProcessGroup }) {
  const { t } = useTranslation("common");
  const folds = useFolds();
  const bodyId = useId();
  const key = `${turnId}:${group.key}`;
  const open = isGroupOpen(folds.get(key));
  const live = !!group.live || group.liveThinking;
  const Icon = CATEGORY_ICONS[group.category];

  const liveText = live ? `${t(categoryLabelKey(group.category, true))}\u0000${liveDetail(group.live)}` : "";
  const shown = useStableLiveTitle(liveText, live);
  const [shownLabel = "", shownDetail = ""] = shown.split("\u0000");
  const count = group.steps.filter((s) => !s.repeated).length;
  const label = live
    ? shownLabel
    : t(categoryLabelKey(group.category, false)) + (count > 1 ? ` (${count})` : "");

  return (
    <div data-process-group={group.category}>
      <DisclosureRow
        expanded={open}
        controls={bodyId}
        onToggle={() => folds.set(key, !open)}
        tone={!live && group.hasError ? "error" : "default"}
        icon={<Icon aria-hidden="true" className="size-3.5 shrink-0 text-deco" />}
        label={<LiveLabel live={live}>{label}</LiveLabel>}
        summary={live && shownDetail ? shownDetail : undefined}
        testId="process-group"
      />
      <div id={bodyId}>
        <UntilFound open={open} foldKey={key} onReveal={() => folds.set(key, true)} className={cn("pl-5", open && "mb-1")}>
          {group.thinking ? (
            <p className="text-sm leading-6 whitespace-pre-wrap break-words text-muted-foreground">{group.thinking}</p>
          ) : (
            <ol className="flex flex-col gap-1 text-sm leading-6 text-muted-foreground">
              {group.steps.map((step, i) => (
                <li key={i}>
                  <span className={step.error ? "text-destructive" : "text-foreground"}>
                    {stepLabel(step, t, step.running ? "running" : "done")}
                  </span>
                  {step.detail ? <span className="break-words"> “{step.detail}”</span> : null}
                  {step.repeated ? <span> · {t("chat.work.repeated")}</span> : null}
                  {step.error ? <span className="text-destructive"> · {t("chat.work.failed")}</span> : null}
                  {step.found ? <span> · {t("chat.work.passages", { count: step.found })}</span> : null}
                </li>
              ))}
            </ol>
          )}
        </UntilFound>
      </div>
    </div>
  );
}

/** Hold each live title for LIVE_TITLE_MIN_MS; keep only the newest pending one. */
function useStableLiveTitle(desired: string, active: boolean): string {
  const [shown, setShown] = useState(desired);
  const shownAt = useRef(Date.now());
  const latest = useRef(desired);
  latest.current = desired;
  useEffect(() => {
    if (!active || shown === desired) return;
    const wait = LIVE_TITLE_MIN_MS - (Date.now() - shownAt.current);
    const commit = () => {
      shownAt.current = Date.now();
      setShown(latest.current);
    };
    if (wait <= 0) {
      commit();
      return;
    }
    const timer = setTimeout(commit, wait);
    return () => clearTimeout(timer);
  }, [active, desired, shown]);
  return active ? shown : desired;
}

/** "Searched, Read sources, Saved a note": the top three, no counts. */
function categoryList(categories: ReturnType<typeof turnCategories>, t: T): string {
  return categories
    .slice(0, 3)
    .map((c) => t(categoryLabelKey(c, false)))
    .join(", ");
}

function stepLabel(step: WorkStep, t: T, state: "running" | "done"): string {
  if (step.tool in TOOL_CATEGORIES) return t(`chat.work.tool.${step.tool}.${state}`);
  return t(`chat.work.tool.other.${state}`, { tool: step.tool });
}

function workNotes(work: WorkView, t: T): string[] {
  const notes: string[] = [];
  if (work.summarised) notes.push(t("chat.work.summarised", { count: work.summarised }));
  if (work.limitReached) notes.push(t("chat.work.limitReached"));
  if (work.continued) notes.push(t("chat.work.continued"));
  if (work.contextTokens && work.contextWindow) {
    notes.push(t("chat.work.context", { used: compact(work.contextTokens), window: compact(work.contextWindow) }));
  }
  return notes;
}

/** 3200 → "3.2k", 1048576 → "1M". */
function compact(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}
