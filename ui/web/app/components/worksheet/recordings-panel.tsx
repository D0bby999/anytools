/**
 * recordings-panel.tsx
 * Every take on a worksheet (up-methods phase 7), and "Compare": an earlier
 * take beside a later one, so a baseline can be heard next to its retest.
 * Each take is named by the cell that holds it, read from the kind; a take no
 * cell holds is still listed, so it can be used or deleted.
 */
import { useState } from "react";
import { useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import type { Answers, Recording, TableRow, WorksheetKind } from "~/lib/worksheet-types";
import { Button } from "~/components/ui/button";
import { clock } from "~/components/worksheet/recorder";
import { deleteTake, recordingURL } from "~/components/worksheet/audio-cell";
import { DriveFileNotice, useDriveReason } from "~/components/storage/drive-file-notice";

/** Where each recording is held: "Section · row · column", by id. */
export function recordingPlaces(kind: WorksheetKind, answers: Answers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of kind.sections) {
    for (const f of s.fields) {
      const v = answers[s.key]?.[f.key];
      if (f.type === "audio" && typeof v === "string") out[v] ??= `${s.title} · ${f.label}`;
      if (f.type !== "table" || !Array.isArray(v)) continue;
      for (const [i, row] of (v as TableRow[]).entries()) {
        const rowLabel = f.rows?.find((r) => r.key === row.row)?.label ?? String(i + 1);
        for (const c of f.columns ?? []) {
          const id = row.cells?.[c.key];
          if (c.type === "audio" && typeof id === "string") out[id] ??= `${s.title} · ${rowLabel}`;
        }
      }
    }
  }
  return out;
}

type Props = {
  worksheetId: string;
  kind: WorksheetKind;
  answers: Answers;
  recordings: Recording[];
};

export function RecordingsPanel({ worksheetId, kind, answers, recordings }: Props) {
  const { t } = useTranslation("toolkit");
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const places = recordingPlaces(kind, answers);
  const first = recordings[0]?.id ?? "";
  const last = recordings[recordings.length - 1]?.id ?? "";
  const [a, setA] = useState(first);
  const [b, setB] = useState(last);
  // A take kept in the learner's Drive says why it will not play
  // (drive-user-storage phase 3).
  const [reason, checkReason] = useDriveReason();
  if (recordings.length === 0) return null;
  const name = (r: Recording) =>
    t("recordings.takeLabel", {
      where: places[r.id] ?? t("recordings.unused"),
      length: clock(r.duration_seconds),
      date: r.created_at.slice(0, 10),
    });
  const known = (id: string) => recordings.some((r) => r.id === id);
  const left = known(a) ? a : first;
  const right = known(b) ? b : last;

  return (
    <section aria-labelledby="ws-recordings" className="mt-10">
      <h2 id="ws-recordings" className="lp-kicker">
        {t("recordings.title")}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("recordings.lead")}</p>

      {recordings.length > 1 ? (
        <div className="mt-4">
          <h3 className="text-sm font-medium">{t("recordings.compare")}</h3>
          <p className="text-xs text-faint">{t("recordings.compareLead")}</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {[
              { value: left, set: setA, label: t("recordings.earlier") },
              { value: right, set: setB, label: t("recordings.later") },
            ].map((side) => (
              <div key={side.label} className="space-y-2">
                <label className="block text-xs font-medium">
                  <span className="font-mono uppercase tracking-wide text-faint">{side.label}</span>
                  <select
                    value={side.value}
                    onChange={(e) => side.set(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-control-border bg-background px-3 py-2 text-sm"
                  >
                    {recordings.map((r) => (
                      <option key={r.id} value={r.id}>
                        {name(r)}
                      </option>
                    ))}
                  </select>
                </label>
                <audio
                  key={side.value}
                  controls
                  preload="metadata"
                  src={recordingURL(worksheetId, side.value)}
                  className="w-full"
                  aria-label={side.label}
                  onError={() => checkReason(recordingURL(worksheetId, side.value))}
                />
              </div>
            ))}
          </div>
          {reason ? <DriveFileNotice reason={reason} className="mt-2" /> : null}
        </div>
      ) : null}

      <ul className="mt-4 border-t text-sm">
        {recordings.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
            <span>{name(r)}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={async () => {
                const failed = await deleteTake(worksheetId, r.id);
                if (failed !== null) {
                  setError(failed || t("recordings.deleteFailed"));
                  return;
                }
                setError(null);
                revalidator.revalidate();
              }}
            >
              {t("recordings.delete")}
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
