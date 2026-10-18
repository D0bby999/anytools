import { useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { FolderInput } from "lucide-react";
import { Button } from "~/components/ui/button";
import { openDrivePicker } from "~/lib/google-picker.client";
import type { ImportReport, PickerConfig } from "~/lib/drive-types";
import { driveReason } from "~/lib/drive-storage";
import { DriveFileNotice } from "~/components/storage/drive-file-notice";

/**
 * drive-picker.tsx
 *
 * The button that opens the Google Picker and hands its selection to the
 * knowledge base's action.
 *
 * Three steps on one click, in this order: ask this server for an access token
 * (POST, never in loader data — see app.api.drive.picker-token), open Google's
 * Picker with it, and submit the picked `{id, kind}` pairs to the route action,
 * which forwards them to the API. The token lives in this closure for as long
 * as the Picker is open and is not stored anywhere.
 *
 * The same component is "Add from Drive" and "Pick more"; only the label
 * differs. Under drive.file a file added to a picked folder LATER is invisible
 * to the app until the user picks it, so Pick more is not a convenience — it is
 * the only way in.
 */

/** Why the Picker did not open, as an i18n key under `drive.errors`. */
type OpenError = "reconnect" | "notConnected" | "pickerFailed";

export function DrivePickerButton({
  kbId,
  picker,
  label,
  variant = "outline",
}: {
  kbId: string;
  picker: PickerConfig;
  label: string;
  variant?: "default" | "outline";
}) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<{ driveReport?: ImportReport; driveErrorKey?: string; driveErrorDetail?: string }>();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<OpenError | null>(null);

  const importing = fetcher.state !== "idle";

  async function pick() {
    setOpenError(null);
    setOpening(true);
    try {
      const res = await fetch("/app/api/drive/picker-token", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
      if (!res.ok || !body.access_token) {
        setOpenError(
          body.error === "needs_reconnect"
            ? "reconnect"
            : body.error === "not_connected"
              ? "notConnected"
              : "pickerFailed",
        );
        return;
      }

      const picked = await openDrivePicker({
        apiKey: picker.apiKey,
        appId: picker.appId,
        accessToken: body.access_token,
        title: t("drive.pickerTitle"),
      });
      if (!picked || picked.length === 0) return;

      fetcher.submit(
        { intent: "drive-import", picked: JSON.stringify(picked) },
        { method: "post", action: `/knowledge/${kbId}` },
      );
    } catch {
      setOpenError("pickerFailed");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div>
      <Button type="button" variant={variant} size="sm" disabled={opening || importing} onClick={pick}>
        <FolderInput aria-hidden="true" />
        {importing ? t("drive.importing") : label}
      </Button>

      {openError ? (
        <p role="alert" className="mt-2 text-sm leading-snug text-destructive">
          {t(`drive.errors.${openError}`)}
        </p>
      ) : null}
      <ImportResult data={fetcher.data} />
    </div>
  );
}

/**
 * What one Picker submission did, per item.
 *
 * A batch the user assembled by hand gets an answer per file: "3 added, 1
 * failed" with no names would send them hunting for which one. Items that
 * succeeded are summarised; items that did not are listed with the API's own
 * sentence, which is written for a person (drive.userFacingImportError).
 */
export function ImportResult({ data }: { data: unknown }) {
  const { t } = useTranslation("knowledge");
  if (!data || typeof data !== "object") return null;

  if ("driveErrorKey" in data) {
    const { driveErrorKey, driveErrorDetail } = data as { driveErrorKey: string; driveErrorDetail?: string };
    // Refused by the learner's own storage Drive (drive-user-storage phase 5).
    const refusedBy = driveReason((data as { driveReason?: unknown }).driveReason);
    if (refusedBy) return <DriveFileNotice reason={refusedBy} className="mt-2" />;
    return (
      <p role="alert" className="mt-2 text-sm leading-snug text-destructive">
        {t(driveErrorKey)}
        {driveErrorDetail ? ` ${driveErrorDetail}` : ""}
      </p>
    );
  }

  if (!("driveReport" in data)) return null;
  const report = (data as { driveReport: ImportReport }).driveReport;
  const problems = report.items.filter((item) => item.error);

  return (
    <div role="status" className="mt-2 text-sm leading-snug">
      <p className="text-muted-foreground">{t("drive.imported", { count: report.imported })}</p>
      {problems.length > 0 ? (
        <ul className="mt-1 grid gap-1">
          {problems.map((item) => {
            // A copy the learner's Drive refused says why, with what to do.
            const refusedBy = driveReason(item.code);
            return refusedBy ? (
              <li key={item.file_id}>
                <span className="text-sm font-medium">{item.name || item.file_id}</span>
                <DriveFileNotice reason={refusedBy} />
              </li>
            ) : (
              <li key={item.file_id} className="text-destructive">
                <span className="font-medium">{item.name || item.file_id}</span>
                {`: ${item.error}`}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
