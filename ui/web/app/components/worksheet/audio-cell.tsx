/**
 * audio-cell.tsx
 * One `audio` value of a worksheet (up-methods phase 7): the take it names,
 * with a player, or a recorder that keeps a new one. The value is the
 * recording's id; the API refuses any id that is not one of this worksheet's
 * own recordings.
 *
 * Keeping a take uploads it, then writes its id into the cell and saves the
 * section at once. Deleting a take deletes its file; the API clears its id
 * from every cell that held it, and the page reloads what it saved.
 */
import { createContext, useContext, useState } from "react";
import { useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import type { Recording } from "~/lib/worksheet-types";
import { Button } from "~/components/ui/button";
import { Recorder, clock, type KeepFailure } from "~/components/worksheet/recorder";
import { DriveFileNotice, useDriveReason } from "~/components/storage/drive-file-notice";
import { driveReason } from "~/lib/drive-storage";

/** What an audio cell needs from its page. Absent outside a saved worksheet. */
export type WorksheetMedia = {
  worksheetId: string;
  recordings: Recording[];
  /** The learner's own worksheet of a kind a row points at (Row.see), by kind. */
  related: Record<string, string>;
};

export const WorksheetMediaContext = createContext<WorksheetMedia | null>(null);

export function recordingURL(worksheetId: string, rid: string): string {
  return `/toolkit/${encodeURIComponent(worksheetId)}/recordings/${encodeURIComponent(rid)}`;
}

const EXTENSIONS: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a" };

/**
 * Uploads one take; resolves to the kept recording, or why it was not kept:
 * the API's sentence, or the reason the learner's Drive refused it
 * (drive-user-storage phase 5), read from the answer's code.
 */
export async function uploadTake(
  worksheetId: string,
  audio: Blob,
  type: string,
  seconds: number,
): Promise<Recording | KeepFailure> {
  const base = (type.split(";")[0] ?? "").trim();
  const file = audio instanceof File ? audio : new File([audio], `take.${EXTENSIONS[base] ?? "webm"}`, { type });
  const body = new FormData();
  body.set("duration_seconds", seconds.toFixed(1));
  body.set("audio", file);
  try {
    const res = await fetch(`/toolkit/${encodeURIComponent(worksheetId)}/recordings`, { method: "POST", body });
    const data = (await res.json().catch(() => ({}))) as Partial<Recording> & { error?: string; code?: string };
    if (!res.ok || !data.id) {
      const reason = driveReason(data.code);
      return reason ? { driveReason: reason } : (data.error ?? "");
    }
    return data as Recording;
  } catch {
    return "";
  }
}

/** Deletes one take, its file first; resolves to an error sentence or null. */
export async function deleteTake(worksheetId: string, rid: string): Promise<string | null> {
  try {
    const res = await fetch(recordingURL(worksheetId, rid), { method: "DELETE" });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? "";
  } catch {
    return "";
  }
}

type Props = {
  value: string | undefined;
  /** commit saves the section now, instead of on blur. */
  onChange: (v: string | undefined, commit?: boolean) => void;
  label: string;
};

export function AudioCell({ value, onChange, label }: Props) {
  const { t } = useTranslation("toolkit");
  const media = useContext(WorksheetMediaContext);
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  // A take kept a moment ago, until the page's reload lists it.
  const [justKept, setJustKept] = useState<Recording | null>(null);
  // A take kept in the learner's Drive says why it will not play
  // (drive-user-storage phase 3).
  const [reason, checkReason] = useDriveReason();
  if (!media) return <p className="text-sm text-muted-foreground">{t("recordings.unsaved")}</p>;
  const take = value
    ? (media.recordings.find((r) => r.id === value) ?? (justKept?.id === value ? justKept : undefined))
    : undefined;

  if (value && take) {
    return (
      <div className="space-y-1">
        <audio
          controls
          preload="metadata"
          src={recordingURL(media.worksheetId, take.id)}
          className="w-full max-w-sm"
          aria-label={label}
          onError={() => checkReason(recordingURL(media.worksheetId, take.id))}
        />
        {reason ? <DriveFileNotice reason={reason} /> : null}
        <p className="font-mono text-xs text-faint">{clock(take.duration_seconds)}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined, true)}>
            {t("recordings.clear")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={async () => {
              const failed = await deleteTake(media.worksheetId, take.id);
              if (failed !== null) {
                setError(failed || t("recordings.deleteFailed"));
                return;
              }
              revalidator.revalidate();
            }}
          >
            {t("recordings.delete")}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (value) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-warning">{t("recordings.missing")}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined, true)}>
          {t("recordings.clear")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Recorder
        label={label}
        onKeep={async (audio, type, seconds) => {
          const kept = await uploadTake(media.worksheetId, audio, type, seconds);
          if (typeof kept === "string") return kept || t("recordings.keepFailed");
          if ("driveReason" in kept) return kept;
          setJustKept(kept);
          onChange(kept.id, true);
          return null;
        }}
      />
      {media.recordings.length > 0 ? (
        <select
          value=""
          onChange={(e) => e.target.value && onChange(e.target.value, true)}
          aria-label={`${t("recordings.useKept")}: ${label}`}
          className="w-auto min-w-40 rounded-md border border-control-border bg-card px-3 py-2 text-sm"
        >
          <option value="">{t("recordings.useKept")}</option>
          {media.recordings.map((r) => (
            <option key={r.id} value={r.id}>
              {t("recordings.takeOption", { length: clock(r.duration_seconds), date: r.created_at.slice(0, 10) })}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
