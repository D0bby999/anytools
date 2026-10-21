/**
 * app.api.chat-feedback.ts
 * Resource route: Like / Dislike under a chat answer (plan 261021-1100,
 * after postclaw's per-answer ratings).
 *
 * The action records one rating (`intent=put`) or retracts it
 * (`intent=delete`); the conversation's loader reads them.
 * The API checks that the message is the caller's answer and copies the
 * provider and model that answered; nothing here names a model. The action
 * calls requireUserId.
 */
import type { Route } from "./+types/app.api.chat-feedback";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { deleteFeedback, putFeedback, type ChatFeedback } from "~/lib/chat.server";
import { requireUUID } from "~/lib/turns";

export type FeedbackActionData = { ok: true; feedback: ChatFeedback | null } | { ok: false; error: string };

const reply = (body: FeedbackActionData) => Response.json(body, { headers: { "Cache-Control": "private, no-store" } });

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const messageId = requireUUID(String(form.get("messageId") ?? ""));
  try {
    if (form.get("intent") === "delete") {
      await deleteFeedback(userId, messageId);
      return reply({ ok: true, feedback: null });
    }
    const rating = form.get("rating") === "bad" ? "bad" : "good";
    const category = String(form.get("category") ?? "");
    const comment = String(form.get("comment") ?? "").trim();
    const feedback = await putFeedback(userId, messageId, {
      rating,
      ...(rating === "bad" && category ? { category } : {}),
      ...(rating === "bad" && comment ? { comment } : {}),
    });
    return reply({ ok: true, feedback });
  } catch (error) {
    if (error instanceof ApiError) return reply({ ok: false, error: error.message });
    throw error;
  }
}
