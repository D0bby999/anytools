/**
 * app.api.save-to-drive.ts
 * Resource route (action only): "Save to my Drive" beside each "Download as
 * Markdown" (drive-user-storage phase 2).
 *
 * The API resolves the worksheet, video, book or notebook with the caller's
 * id first, renders the same Markdown the download serves, and writes it into
 * the "Exports" folder of the learner's Drive. Its action calls requireUserId.
 */
import type { Route } from "./+types/app.api.save-to-drive";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { saveToDrive } from "~/lib/storage.server";
import { exportErrorKey, isExportKind } from "~/lib/storage-types";
import { requireUUID } from "~/lib/turns";

export type SaveToDriveData = { ok: true; url: string; name: string } | { ok: false; errorKey: string };

export async function action({ request }: Route.ActionArgs): Promise<SaveToDriveData> {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const kind = String(form.get("kind") ?? "");
  if (!isExportKind(kind)) return { ok: false, errorKey: "export.failed" };
  const id = requireUUID(String(form.get("id") ?? ""));
  const language = String(form.get("language") ?? "").slice(0, 16);
  try {
    const saved = await saveToDrive(userId, kind, id, language);
    return { ok: true, url: saved.url, name: saved.name };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, errorKey: exportErrorKey(error.code) };
    throw error;
  }
}
