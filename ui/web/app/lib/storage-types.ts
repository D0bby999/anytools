/**
 * storage-types.ts
 * Settings → Storage's shapes, and the words for them, shared by the page,
 * its action and "Save to my Drive" (drive-user-storage phase 2). No server
 * imports: components use these too.
 */

export type FileStorage = "server" | "drive";

export type MoveState = {
  id: string;
  direction: "to_drive" | "to_server";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  done: number;
  total: number;
  done_bytes: number;
  total_bytes: number;
  /** A code, never the job's own text. */
  error?: "drive_full" | "drive_reconnect" | "move_failed";
};

/** GET /v1/me/file-storage. */
export type StorageStatus = {
  storage: FileStorage;
  drive: { configured: boolean; ready: boolean; reason?: "drive_not_connected" | "drive_reconnect" };
  usage: {
    server_files: number;
    server_bytes: number;
    drive_files: number;
    drive_bytes: number;
    drive_missing: number;
  };
  move: MoveState | null;
};

/** What "Save to my Drive" can save, and the API route of each. */
export const EXPORT_KINDS = ["worksheet", "study_notes", "book", "notebook"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export function isExportKind(v: string): v is ExportKind {
  return (EXPORT_KINDS as readonly string[]).includes(v);
}

export function moveRunning(move: MoveState | null): boolean {
  return move?.status === "queued" || move?.status === "running";
}

/**
 * A size the way a person reads it: "2.1 GB", "640 KB", "12 bytes". Decimal
 * units, as Google Drive shows them.
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return `${Math.max(0, Math.round(n || 0))} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i] ?? "TB"}`;
}

/** The API's refusal codes, as storage:errors.* keys. */
export function storageErrorKey(code: string | undefined): string {
  switch (code) {
    case "move_running":
      return "errors.running";
    case "drive_not_connected":
      return "errors.notConnected";
    case "drive_reconnect":
      return "errors.reconnect";
    case "drive_full":
      return "errors.full";
    case "drive_failed":
      return "errors.unreachable";
    case "drive_unavailable":
      return "errors.unavailable";
    default:
      return "errors.generic";
  }
}

/** The API's refusal codes for "Save to my Drive", as storage:export.* keys. */
export function exportErrorKey(code: string | undefined): string {
  switch (code) {
    case "drive_storage_off":
      return "export.storageOff";
    case "drive_not_connected":
    case "drive_reconnect":
      return "export.reconnect";
    case "drive_full":
      return "export.full";
    default:
      return "export.failed";
  }
}
