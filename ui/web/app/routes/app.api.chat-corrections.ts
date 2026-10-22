/**
 * app.api.chat-corrections.ts
 * Resource route (action only): "Save mistakes to review" under a chat
 * answer (the private design notes, phase 3).
 *
 * - `intent=find` asks the learner's chat model once for the mistakes the
 *   answer corrected (POST /v1/chat/messages/{id}/corrections).
 * - `intent=save` keeps the ticked ones as words to learn, due today
 *   (…/corrections/save); `items` is their JSON.
 */
import type { Route } from "./+types/app.api.chat-corrections";
import { requireUserId } from "~/lib/auth.server";
import { ApiError, apiFetch } from "~/lib/api.server";
import { requireUUID } from "~/lib/turns";

export type ChatCorrection = { wrong: string; right: string; why: string; sentence?: string };

export type CorrectionsData =
  | { ok: true; intent: "find"; corrections: ChatCorrection[]; lang: string }
  | { ok: true; intent: "save"; created: number }
  | { ok: false; error: string };

export async function action({ request }: Route.ActionArgs): Promise<CorrectionsData> {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const id = encodeURIComponent(requireUUID(String(form.get("messageId") ?? "")));
  try {
    if (form.get("intent") === "save") {
      const items = JSON.parse(String(form.get("items") ?? "[]")) as unknown;
      const res = await apiFetch<{ created: number }>(`/v1/chat/messages/${id}/corrections/save`, userId, {
        method: "POST",
        body: { lang: String(form.get("lang") ?? ""), items },
      });
      return { ok: true, intent: "save", created: res.created };
    }
    const res = await apiFetch<{ corrections: ChatCorrection[]; lang: string }>(`/v1/chat/messages/${id}/corrections`, userId, {
      method: "POST",
    });
    return { ok: true, intent: "find", corrections: res.corrections, lang: res.lang };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    if (error instanceof SyntaxError) return { ok: false, error: "" };
    throw error;
  }
}
