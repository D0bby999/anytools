/**
 * app.api.diagram.ts
 * Resource route (action only): "Draw it" and its one repair (learning
 * depth, phase 5).
 *
 * - `intent=draw` draws one of the learner's assistant messages (a chat
 *   answer, a solution, a tutor answer); the API appends the diagram after it.
 * - `intent=repair` sends Mermaid's own parse error for a diagram the browser
 *   could not draw; the API allows this once per diagram.
 *
 * The page's loaders revalidate after the fetcher returns, which is how the
 * new or repaired diagram appears. Its action calls requireUserId.
 */
import type { Route } from "./+types/app.api.diagram";
import { requireUserId } from "~/lib/auth.server";
import { ApiError, apiFetch } from "~/lib/api.server";

/** The diagram message the API stored (or repaired). */
export type DiagramMessage = { id: string; content: string };

export type DiagramActionData = { ok: true; message: DiagramMessage } | { ok: false; error: string; code?: string };

type ApiResult = { message: DiagramMessage };

export async function action({ request }: Route.ActionArgs): Promise<DiagramActionData> {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "draw") {
      const res = await apiFetch<ApiResult>("/v1/visualize", userId, {
        method: "POST",
        body: { message_id: String(form.get("messageId") ?? ""), request: String(form.get("request") ?? "") },
      });
      return { ok: true, message: { id: res.message.id, content: res.message.content } };
    }
    if (intent === "repair") {
      const id = String(form.get("diagramId") ?? "");
      const res = await apiFetch<ApiResult>(`/v1/visualize/${encodeURIComponent(id)}/repair`, userId, {
        method: "POST",
        body: { error: String(form.get("error") ?? "").slice(0, 500) },
      });
      return { ok: true, message: { id: res.message.id, content: res.message.content } };
    }
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message, code: error.code };
    throw error;
  }
  return { ok: false, error: "unknown intent" };
}
