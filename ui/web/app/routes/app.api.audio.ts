/**
 * app.api.audio.ts
 * Resource route (action only): start, speak, cancel or delete an audio overview
 * (learning depth, phase 10), for the Knowledge and Research pages alike.
 * Their loaders revalidate after the fetcher returns. Its action calls
 * requireUserId.
 */
import type { Route } from "./+types/app.api.audio";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { cancelOverview, createOverview, deleteOverview, speakOverview } from "~/lib/audio.server";

export type AudioActionData = { ok: true } | { ok: false; error: string };

export async function action({ request }: Route.ActionArgs): Promise<AudioActionData> {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  try {
    if (intent === "create") {
      const language = String(form.get("language") ?? "");
      await createOverview(userId, {
        kb_id: String(form.get("kbId") ?? "") || undefined,
        report_id: String(form.get("reportId") ?? "") || undefined,
        minutes: Number(form.get("minutes") ?? 5) || 5,
        language: language === "en" || language === "vi" ? language : "",
        topic: String(form.get("topic") ?? "") || undefined,
      });
      return { ok: true };
    }
    if (intent === "speak") {
      const engine = String(form.get("engine") ?? "");
      if (engine !== "builtin" && engine !== "byok") return { ok: false, error: "Choose who speaks it first." };
      const connection = String(form.get("connectionId") ?? "");
      await speakOverview(userId, id, engine === "byok" ? { engine, connection_id: connection } : { engine });
      return { ok: true };
    }
    if (intent === "cancel") {
      await cancelOverview(userId, id);
      return { ok: true };
    }
    if (intent === "delete") {
      await deleteOverview(userId, id);
      return { ok: true };
    }
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    throw error;
  }
  return { ok: false, error: "unknown intent" };
}
