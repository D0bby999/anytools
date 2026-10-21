/**
 * app.api.dictate.ts
 * Resource route (action only): a question spoken into the chat composer,
 * where the browser has no speech recognition of its own (plan 261021-1100
 * phase 2). The take goes to the learner's speech-to-text route, or the
 * server's engine, and its text comes back; nothing is kept. The action
 * calls requireUserId.
 */
import type { Route } from "./+types/app.api.dictate";
import { requireUserId } from "~/lib/auth.server";
import { dictateQuestion, MAX_SPEAKING_REQUEST } from "~/lib/reading.server";

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(length) || length > MAX_SPEAKING_REQUEST) {
    return Response.json({ error: "A take is at most 30 seconds." }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "The recording could not be read." }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof File)) return Response.json({ error: "Record your question first." }, { status: 400 });
  return dictateQuestion(userId, audio, String(form.get("lang") ?? ""));
}
