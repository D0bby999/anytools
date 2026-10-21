/**
 * drive-types.ts
 * The Drive connector's wire shapes, in a module with NO server imports.
 *
 * Apart from drive.server.ts for the same reason kb-types.ts is apart from
 * kb.server.ts: components render these, and a component that imports a
 * `.server` module drags the gateway token toward the client bundle.
 */

/**
 * Grant states, mirroring internal/connectors/drive. `re-pick` is what Google's
 * 403 insufficientFilePermissions turns into: the app no longer has the file,
 * and only picking it again gives it back.
 */
export type GrantState = "active" | "re-pick" | "removed";

/** Mirrors drive.Grant. */
export type DriveGrant = {
  id: string;
  kb_id: string;
  file_id: string;
  kind: "file" | "folder";
  parent_file_id?: string;
  name: string;
  mime: string;
  modified_time?: string;
  state: GrantState;
  last_error?: string;
  document_id?: string;
  granted_at: string;
  synced_at?: string;
  updated_at: string;
};

/** Mirrors drive.SyncState as the API serialises it. */
export type DriveSyncState = {
  last_sync_at?: string;
  last_error?: string;
  rebaselines: number;
};

/** Mirrors drive.FeatureState: one Google feature for this learner. */
export type GoogleFeature = {
  id: "drive" | "calendar" | "classroom" | "photos";
  scopes: string[];
  sensitive: boolean;
  available: boolean;
  granted: boolean;
};

/** Mirrors drive.Status. */
export type DriveStatus = {
  connected: boolean;
  configured: boolean;
  email?: string;
  scope?: string;
  needs_reconnect: boolean;
  last_error?: string;
  connected_at?: string;
  sync?: DriveSyncState;
  grants: number;
  re_pick: number;
  removed: number;
  /**
   * The learner's own files kept in this Drive (drive-user-storage phase 3),
   * counted while disconnected too. Older APIs leave them out.
   */
  files_in_drive?: number;
  bytes_in_drive?: number;
  /** The Google feature catalogue for this learner; older APIs leave it out. */
  features?: GoogleFeature[];
};

/** What the Picker hands back, and what POST /drive/import takes. */
export type PickedItem = { id: string; kind: "file" | "folder" };

/** Mirrors drive.ImportOutcome. */
export type ImportOutcome = {
  file_id: string;
  name: string;
  kind: string;
  state: string;
  document_id?: string;
  children?: number;
  error?: string;
  /** The storage reason's code when the learner's Drive refused the copy. */
  code?: string;
};

/** Mirrors drive.ImportReport. */
export type ImportReport = {
  kb_id: string;
  imported: number;
  failed: number;
  items: ImportOutcome[];
};

/** Mirrors drive.SyncReport, trimmed to what the UI reads. */
export type SyncReport = {
  baselined: boolean;
  rebaselined: boolean;
  checked: number;
  reimported: number;
  re_pick: number;
  removed: number;
  failed: number;
};

/**
 * The browser-side Picker configuration. Present only when the whole Drive
 * path is configured on both sides; its absence is how a component knows to
 * render nothing.
 */
export type PickerConfig = { apiKey: string; appId: string };

/**
 * The query flags /auth/drive/callback redirects back with. Closed, so the
 * page can only ever render a message it has copy for.
 */
export const DRIVE_NOTICES = [
  "connected",
  "denied",
  "failed",
  "no_refresh",
  // Learning-tool-connections phase 1: another Google account than the one
  // connected; a feature unticked at Google; a feature not offered yet.
  "other_account",
  "partial",
  "unavailable",
  "school_blocked",
] as const;
export type DriveNotice = (typeof DRIVE_NOTICES)[number];

export function parseDriveNotice(value: string | null): DriveNotice | null {
  return (DRIVE_NOTICES as readonly string[]).includes(value ?? "") ? (value as DriveNotice) : null;
}
