/**
 * save-to-drive.tsx
 * "Save to my Drive", beside each "Download as Markdown" (drive-user-storage
 * phase 2). It appears only while the learner keeps their files in Drive,
 * and saves the same Markdown the download gives into the "Exports" folder,
 * then links to the file.
 */
import { useFetcher, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { CloudUpload, ExternalLink } from "lucide-react";
import type { SaveToDriveData } from "~/routes/app.api.save-to-drive";
import type { ExportKind, FileStorage } from "~/lib/storage-types";

/** The learner's choice, from the app shell's loader. Server when unknown. */
export function useFileStorage(): FileStorage {
  const data = useRouteLoaderData("routes/app-layout") as { fileStorage?: FileStorage } | undefined;
  return data?.fileStorage === "drive" ? "drive" : "server";
}

/** A link only to Google Drive itself, whatever the answer said. */
function driveLink(url: string): string | null {
  return url.startsWith("https://drive.google.com/") ? url : null;
}

export function SaveToDrive({
  kind,
  id,
  language,
  storage,
}: {
  kind: ExportKind;
  id: string;
  language?: string;
  /** Overrides the shell's choice; tests and pages outside the shell pass it. */
  storage?: FileStorage;
}) {
  const { t } = useTranslation("storage");
  const shell = useFileStorage();
  const fetcher = useFetcher<SaveToDriveData>();
  if ((storage ?? shell) !== "drive") return null;
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;
  const link = result?.ok ? driveLink(result.url) : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <fetcher.Form method="post" action="/app/api/save-to-drive">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        {language !== undefined ? <input type="hidden" name="language" value={language} /> : null}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 text-sm text-primary underline underline-offset-4 disabled:opacity-50"
        >
          <CloudUpload aria-hidden="true" className="size-4" />
          {busy ? t("export.saving") : t("export.save")}
        </button>
      </fetcher.Form>
      {result?.ok ? (
        <span role="status" className="inline-flex items-center gap-2 text-sm">
          {t("export.saved")}
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1 text-primary underline underline-offset-4"
            >
              {t("export.open")}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          ) : null}
        </span>
      ) : null}
      {result && !result.ok ? (
        <span role="alert" className="text-sm text-destructive">
          {t(result.errorKey)}
        </span>
      ) : null}
    </span>
  );
}
