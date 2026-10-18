import { useCallback, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { driveReasonKey, probeDriveReason, type DriveReason } from "~/lib/drive-storage";

/**
 * drive-file-notice.tsx
 * One sentence saying why a file kept in the learner's Google Drive cannot be
 * opened (drive-user-storage phase 3), with what to do: reconnect, upload it
 * again or delete it, or free space. Used by the document viewer, the media
 * player, the worksheet recordings and the audio overviews.
 */
export function DriveFileNotice({ reason, className = "" }: { reason: DriveReason; className?: string }) {
  const { t } = useTranslation("common");
  return (
    <p role="status" data-drive-reason={reason} className={`text-sm leading-prose text-foreground ${className}`}>
      {t(driveReasonKey(reason))}
      {reason === "drive_reconnect" ? (
        <>
          {" "}
          <Link to="/settings" className="text-primary underline underline-offset-4">
            {t("driveStorage.reconnectLink")}
          </Link>
        </>
      ) : null}
    </p>
  );
}

/**
 * The reason a file URL would not load, asked once its element reports an
 * error. Any other failure leaves it null, and the caller's own fallback
 * stands.
 */
export function useDriveReason(): [DriveReason | null, (url: string) => void] {
  const [reason, setReason] = useState<DriveReason | null>(null);
  const check = useCallback((url: string) => {
    void probeDriveReason(url).then(setReason);
  }, []);
  return [reason, check];
}
