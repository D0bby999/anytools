/**
 * app.api.retell.ts
 * Resource route (action only): "Close it and retell" (up-methods phase 11).
 *
 * The learner's retell of an answer, written with the answer hidden, is saved
 * on that answer. The API checks that the message is the caller's answer and
 * that its question carried their own version; saving again replaces it.
 * Chat and Solve both post here. Its action calls requireUserId.
 */
import type { Route } from "./+types/app.api.retell";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { saveRetell } from "~/lib/chat.server";
import { MAX_RETELL, type Retell } from "~/lib/own-version";
import { requireUUID } from "~/lib/turns";

export type RetellActionData = { ok: true; retell: Retell } | { ok: false; error: string };

export async function action({ request }: Route.ActionArgs): Promise<RetellActionData> {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const messageId = requireUUID(String(form.get("messageId") ?? ""));
  const text = String(form.get("text") ?? "").trim();
  if (text === "" || [...text].length > MAX_RETELL) {
    return { ok: false, error: "A retell is 1 to 4000 characters." };
  }
  try {
    const { retell } = await saveRetell(userId, messageId, text);
    return { ok: true, retell };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    throw error;
  }
}
