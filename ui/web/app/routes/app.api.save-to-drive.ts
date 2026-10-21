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

export type SaveToDriveData = { ok: true; url: string; name: string } | { ok: false; errorKey: string; code?: string };

/** Where an export can go besides the Exports folder (learning-tool-connections). */
const TARGETS = ["notebooklm", "canva", "notion"] as const;

export async function action({ request }: Route.ActionArgs): Promise<SaveToDriveData> {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const kind = String(form.get("kind") ?? "");
  if (!isExportKind(kind)) return { ok: false, errorKey: "export.failed" };
  const id = requireUUID(String(form.get("id") ?? ""));
  const language = String(form.get("language") ?? "").slice(0, 16);
  // Learning-tool-connections: the same export, sent to NotebookLM (a Google
  // Doc), Canva (a Canva Doc) or Notion (a page).
  const to = String(form.get("to") ?? "");
  const target = (TARGETS as readonly string[]).includes(to) ? to : undefined;
  try {
    const saved = await saveToDrive(userId, kind, id, language, target);
    return { ok: true, url: saved.url, name: saved.name };
  } catch (error) {
    if (error instanceof ApiError) {
      // An app's own refusal (not connected, nowhere to put it) is passed on
      // by code; the Drive refusals keep their sentence.
      return target ? { ok: false, errorKey: exportErrorKey(error.code), code: error.code } : { ok: false, errorKey: exportErrorKey(error.code) };
    }
    throw error;
  }
}
