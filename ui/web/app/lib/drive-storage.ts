/**
 * drive-storage.ts
 * Why a learner's own file, kept in their Google Drive, could not be read or
 * written (drive-user-storage phase 3). The API answers each with its own
 * code: 409 drive_reconnect, 410 drive_file_removed, 507 drive_full
 * (internal/blob/unavailable.go). Nothing is lost in any of them; search and
 * chat keep working from the text on the server.
 */

export const DRIVE_REASONS = ["drive_reconnect", "drive_file_removed", "drive_full"] as const;
export type DriveReason = (typeof DRIVE_REASONS)[number];

/** The reason a code names, or null for any other answer. */
export function driveReason(code: unknown): DriveReason | null {
  return typeof code === "string" && (DRIVE_REASONS as readonly string[]).includes(code) ? (code as DriveReason) : null;
}

/** The locale key (common namespace) of a reason's sentence. */
export function driveReasonKey(reason: DriveReason): string {
  switch (reason) {
    case "drive_reconnect":
      return "driveStorage.reconnect";
    case "drive_file_removed":
      return "driveStorage.removed";
    case "drive_full":
      return "driveStorage.full";
  }
}

/**
 * Asks a file's URL why it would not load. A media element and pdf.js say
 * only that loading failed; the answer's JSON body says why. One byte is
 * asked for, so a file that does load costs nothing to check.
 */
export async function probeDriveReason(url: string, fetcher: typeof fetch = fetch): Promise<DriveReason | null> {
  try {
    const res = await fetcher(url, { headers: { Range: "bytes=0-0" } });
    if (res.ok) return null;
    const body: unknown = await res.json().catch(() => null);
    return driveReason(body && typeof body === "object" ? (body as { code?: unknown }).code : undefined);
  } catch {
    return null;
  }
}
