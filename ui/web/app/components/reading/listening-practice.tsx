/**
 * listening-practice.tsx
 * Up-methods phase 2: "Practise listening" on a video. The video's open
 * listening audit (up: docs/en/templates/listening-audit.md), rendered from
 * its served kind and saved section by section through the worksheet's own
 * page action, beside the player it audits.
 *
 * What this page adds to the generic form:
 *  - the scaffold ladder (§5) decides whether the transcript, the study notes
 *    and the tutor are on screen (ladder.ts); the page reports what it
 *    decides through onView, and says why while they are away;
 *  - a timestamp in the error map (§4), and the segment's start and end (§7),
 *    get "Play" (the player seeks there and stops at the end, or 20 seconds
 *    later) and "Now" (the moment last chosen on this page: the frame is a
 *    plain nocookie iframe, so its playhead cannot be read);
 *  - the delayed-shadow recorder sits beside "Play segment";
 *  - while the retelling is written, the transcript is away (§7, "after
 *    closing the text").
 *
 * One open audit per video; "Start another" once it is done. The fourteen-day
 * experiment is started here and lives on its own page.
 */
import { useEffect, useMemo, useState } from "react";
import { Form, Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { formatClock, parseClock } from "~/lib/kb-types";
import type { WorksheetDetail, WorksheetSummary } from "~/lib/worksheet-types";
import type { SectionValues } from "~/lib/worksheet-values";
import {
  LADDER,
  LADDER_STAGES,
  ladderOf,
  ladderRows,
  listeningView,
  markedDoneKey,
  segmentRange,
  type ListeningView,
} from "~/lib/ladder";
import { Button } from "~/components/ui/button";
import { WorksheetForm } from "~/components/worksheet/worksheet-form";
import { WorksheetMediaContext } from "~/components/worksheet/audio-cell";
import { FieldAddonContext, type FieldAddon } from "~/components/worksheet/field-input";
import { WorksheetList } from "~/components/worksheet/worksheet-list";

/** What the video's page loads for this tab. */
export type ListeningData = {
  /** The video's open listening audit, with its answers; null when there is none. */
  audit: WorksheetDetail | null;
  /** Every listening audit of this video, newest first. */
  audits: WorksheetSummary[];
  /** The fourteen-day experiments on this video. */
  experiments: WorksheetSummary[];
};

/** The field that, while focused, puts the transcript away. */
export const RETELLING_ID = "ws-segment-retelling";
const ERROR_TIME = /^ws-errors-map-(\d+)-timestamp$/;

/** The view the page opens with, before anything is typed: stored answers only. */
export function initialListeningView(data: ListeningData | undefined): ListeningView {
  const audit = data?.audit;
  return listeningView(audit?.kind ? ladderOf(audit.worksheet.answers) : null);
}

type Props = {
  data: ListeningData;
  /** The moment last chosen on the page, in seconds ("Now"). */
  moment: number;
  /** Seek the player to start and stop it at end. */
  onPlay: (start: number, end: number) => void;
  /** What the ladder now hides, as the learner types. */
  onView: (view: ListeningView) => void;
};

export function ListeningPractice({ data, moment, onPlay, onView }: Props) {
  const { t } = useTranslation("listening");
  const audit = data.audit?.kind ? data.audit : null;
  const w = audit?.worksheet;
  const answers = w?.answers;

  const [ladder, setLadder] = useState(() => ladderOf(answers));
  const [segment, setSegment] = useState<SectionValues>(() => answers?.segment ?? {});
  const [retelling, setRetelling] = useState(false);
  // An explicit "stage done", on this device: the API is not changed.
  const [markedDone, setMarkedDone] = useState(0);
  useEffect(() => {
    if (!w) return;
    setMarkedDone(Number(window.localStorage.getItem(markedDoneKey(w.id))) || 0);
  }, [w?.id]);
  // A reload that brings a different stored ladder (a save, another tab)
  // replaces it; any other reload leaves what is being typed alone.
  const storedLadder = JSON.stringify(ladderOf(answers));
  useEffect(() => setLadder(ladderOf(answers)), [storedLadder]);

  const view = listeningView(audit ? ladder : null, markedDone, retelling);
  useEffect(() => onView(view), [view.stage, view.hidden]);

  const markDone = (stage: number) => {
    if (!w) return;
    window.localStorage.setItem(markedDoneKey(w.id), String(stage));
    setMarkedDone(stage);
  };

  const onValues = (section: string, values: SectionValues) => {
    if (section === LADDER.section) setLadder(ladderRows(values[LADDER.field]));
    if (section === "segment") setSegment(values);
  };

  const segStart = typeof segment.start === "string" ? parseClock(segment.start) : null;
  const segEnd = typeof segment.end === "string" ? parseClock(segment.end) : null;
  const playSegment = () => {
    if (segStart === null) return;
    const r = segmentRange(segStart, segEnd);
    onPlay(r.start, r.end);
  };

  const addon = useMemo<FieldAddon>(
    () => (id, field, value, onChange) => {
      const text = typeof value === "string" ? value : "";
      const row = ERROR_TIME.exec(id);
      const now = (name: string) => (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(formatClock(moment), true)}
          aria-label={t("now", { field: name, time: formatClock(moment) })}>
          {t("nowShort")}
        </Button>
      );
      const play = (name: string, from: number | null, to?: number | null) => (
        <Button type="button" variant="outline" size="sm" disabled={from === null}
          onClick={() => {
            if (from === null) return;
            const r = segmentRange(from, to);
            onPlay(r.start, r.end);
          }}
          aria-label={t("play", { field: name })}>
          {t("playShort")}
        </Button>
      );
      if (row) {
        const name = t("rowTime", { n: Number(row[1]) + 1 });
        return (
          <span className="flex gap-1">
            {play(name, parseClock(text))}
            {now(name)}
          </span>
        );
      }
      if (id === "ws-segment-start") {
        return (
          <span className="flex gap-1">
            {play(field.label, parseClock(text), segEnd)}
            {now(field.label)}
          </span>
        );
      }
      if (id === "ws-segment-end") return now(field.label);
      if (id === "ws-segment-shadow") {
        const length = segStart !== null && segEnd !== null ? segEnd - segStart : null;
        return (
          <div className="space-y-1">
            <Button type="button" variant="outline" size="sm" disabled={segStart === null} onClick={playSegment}>
              {t("playSegment")}
            </Button>
            {segStart === null ? <p className="text-xs text-faint">{t("segmentFirst")}</p> : null}
            {length !== null && (length < 5 || length > 20) ? (
              <p className="text-xs text-warning">{t("segmentLength", { seconds: length })}</p>
            ) : null}
          </div>
        );
      }
      return null;
    },
    [moment, segStart, segEnd, onPlay, t],
  );

  const stageAction = (n: number) =>
    audit?.kind?.sections
      .find((s) => s.key === LADDER.section)
      ?.fields.find((f) => f.key === LADDER.field)
      ?.columns?.find((c) => c.key === "action")?.text?.[`stage${n}`] ?? "";
  const earlier = data.audits.filter((a) => a.id !== w?.id);

  return (
    <div className="space-y-6">
      <p className="text-sm leading-prose text-muted-foreground">{t("lead")}</p>

      {audit && w ? (
        <>
          <section aria-labelledby="lp-ladder-now" className="space-y-2 rounded-md border bg-sunken p-3">
            <h3 id="lp-ladder-now" className="lp-section">
              {view.stage > LADDER_STAGES ? t("ladderDone") : t("stage", { n: view.stage, of: LADDER_STAGES })}
            </h3>
            {view.stage <= LADDER_STAGES ? <p className="text-sm">{stageAction(view.stage)}</p> : null}
            {view.hidden ? (
              <p role="status" className="text-sm text-muted-foreground">
                {view.hidden === "retelling"
                  ? t("hidden.retelling")
                  : view.stage === 5
                    ? t("hidden.closed")
                    : t("hidden.first")}
              </p>
            ) : null}
            {view.stage <= LADDER_STAGES ? (
              <Button type="button" variant="outline" size="sm" onClick={() => markDone(view.stage)}>
                {t("markStage", { n: view.stage })}
              </Button>
            ) : null}
          </section>

          <WorksheetMediaContext.Provider value={{ worksheetId: w.id, recordings: w.recordings ?? [], related: {} }}>
            <FieldAddonContext.Provider value={addon}>
              <div
                onFocusCapture={(e) => e.target.id === RETELLING_ID && setRetelling(true)}
                onBlurCapture={(e) => e.target.id === RETELLING_ID && setRetelling(false)}
              >
                {/* Keeping or deleting a take changes what the server holds
                    in its cells: the form starts again from the saved answers. */}
                <WorksheetForm
                  key={`${w.id}:${(w.recordings ?? []).map((r) => r.id).join(",")}`}
                  worksheetId={w.id}
                  kind={audit.kind!}
                  answers={w.answers}
                  revision={w.updated_at}
                  action={`/toolkit/${w.id}`}
                  onValues={onValues}
                />
              </div>
            </FieldAddonContext.Provider>
          </WorksheetMediaContext.Provider>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Link to={`/toolkit/${w.id}`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">
              {t("fullPage")}
            </Link>
            <FinishAudit id={w.id} revision={w.updated_at} />
          </div>
        </>
      ) : (
        <Form method="post">
          <input type="hidden" name="intent" value="listening-start" />
          <Button type="submit">{data.audits.length > 0 ? t("startAnother") : t("start")}</Button>
        </Form>
      )}

      {earlier.length > 0 ? (
        <section aria-labelledby="lp-listening-earlier">
          <h3 id="lp-listening-earlier" className="lp-section">
            {t("earlier")}
          </h3>
          <WorksheetList worksheets={earlier} />
        </section>
      ) : null}

      <section aria-labelledby="lp-listening-experiment" className="space-y-2">
        <h3 id="lp-listening-experiment" className="lp-section">
          {t("experiment.title")}
        </h3>
        <p className="text-sm leading-prose text-muted-foreground">{t("experiment.lead")}</p>
        <WorksheetList worksheets={data.experiments} />
        <Form method="post">
          <input type="hidden" name="intent" value="experiment-start" />
          <Button type="submit" variant="outline">
            {t("experiment.start")}
          </Button>
        </Form>
      </section>
    </div>
  );
}

/** "This audit is done": the worksheet's own status, through its page's action. */
function FinishAudit({ id, revision }: { id: string; revision: string }) {
  const { t } = useTranslation("listening");
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  return (
    <fetcher.Form method="post" action={`/toolkit/${id}`} className="flex items-center gap-2">
      <input type="hidden" name="intent" value="status" />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="status" value="done" />
      <Button type="submit" variant="ghost" size="sm" disabled={fetcher.state !== "idle"}>
        {t("finish")}
      </Button>
      {fetcher.data?.error ? (
        <span role="alert" className="text-sm text-destructive">
          {fetcher.data.error}
        </span>
      ) : null}
    </fetcher.Form>
  );
}
