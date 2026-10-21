/**
 * drive.server.ts
 * The Google Drive connector's thin API module. Server-side only.
 *
 * Same shape as kb.server.ts: every function takes the session's user id and
 * hands it to apiFetch. The one addition is `loadDrive`, which answers "may
 * this page show Drive at all" — and answers it from BOTH sides, because either
 * side can be unconfigured on its own: the BFF without a Picker key cannot show
 * the Picker, and an API without a Google client has no Drive routes (it
 * answers 404, exactly as for a route that never existed).
 */
import { apiFetch, ApiError } from "~/lib/api.server";
import { driveConfigured, GOOGLE_API_KEY, GOOGLE_PICKER_APP_ID } from "~/lib/env.server";
import type {
  DriveGrant,
  DriveStatus,
  ImportReport,
  PickedItem,
  PickerConfig,
  SyncReport,
} from "~/lib/drive-types";

export type { DriveGrant, DriveStatus, ImportReport, PickedItem, SyncReport } from "~/lib/drive-types";

/** What a page needs to decide whether, and how, to show Drive. */
export type DriveAvailability = { picker: PickerConfig; status: DriveStatus } | null;

function kbPath(kbId: string, rest: string): string {
  return `/v1/kb/${encodeURIComponent(kbId)}/drive/${rest}`;
}

export function driveStatus(userId: string) {
  return apiFetch<DriveStatus>("/v1/connectors/drive/status", userId);
}

/**
 * Resolves Drive for a page, or null when it must not appear.
 *
 * A 404 from the status route means the API was started without a Google
 * client and never registered the Drive routes. Any OTHER failure is thrown:
 * an API that is down is not an API without Drive, and hiding the section
 * would make an outage look like a configuration choice.
 */
export async function loadDrive(userId: string): Promise<DriveAvailability> {
  if (!driveConfigured()) return null;
  try {
    const status = await driveStatus(userId);
    if (!status.configured) return null;
    return {
      picker: { apiKey: GOOGLE_API_KEY ?? "", appId: GOOGLE_PICKER_APP_ID ?? "" },
      status,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function listDriveGrants(userId: string, kbId: string) {
  return apiFetch<{ grants: DriveGrant[] }>(kbPath(kbId, "grants"), userId);
}

export function importFromDrive(userId: string, kbId: string, picked: PickedItem[]) {
  return apiFetch<ImportReport>(kbPath(kbId, "import"), userId, {
    method: "POST",
    body: { picked },
  });
}

export function syncDrive(userId: string) {
  return apiFetch<SyncReport>("/v1/connectors/drive/sync", userId, { method: "POST", body: {} });
}

export function disconnectDrive(userId: string) {
  return apiFetch<{ connected: boolean }>("/v1/connectors/drive", userId, { method: "DELETE" });
}

/**
 * Posts the tokens from a finished consent to the API, which encrypts and
 * keeps them. After this call the refresh token exists nowhere in this process.
 */
export function saveDriveCredentials(
  userId: string,
  body: {
    refresh_token: string;
    access_token: string;
    expires_in: number;
    scope: string;
    google_sub?: string;
    email?: string;
  },
) {
  return apiFetch<{ connected: boolean }>("/v1/connectors/drive/credentials", userId, {
    method: "POST",
    body,
  });
}

/** An access token for the Picker. Never the refresh token; see driveapi. */
export function pickerToken(userId: string) {
  return apiFetch<{ access_token: string }>("/v1/connectors/drive/picker-token", userId, {
    method: "POST",
    body: {},
  });
}

/**
 * Validates the Picker's selection before it is forwarded.
 *
 * The API re-checks every id against Drive and treats `kind` as a hint, so this
 * is not the security boundary. It exists so a malformed body is refused here
 * with a sentence rather than as a 400 from two hops away, and so nothing but
 * `{id, kind}` pairs ever reaches the API from a browser-supplied string.
 */
export function parsePicked(raw: string): PickedItem[] | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length === 0) return null;

  const out: PickedItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { id, kind } = item as { id?: unknown; kind?: unknown };
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) return null;
    if (kind !== "file" && kind !== "folder") return null;
    out.push({ id, kind });
  }
  return out;
}
