/**
 * documents.$docId.speaking-check.ts
 * Resource route (action only): the read-aloud check on a passage of this
 * document (plans/261020-1155-open-source-adds, phase 2). The browser posts
 * the take, the page and the passage; the workspace is opened here for the
 * document, as the reader's own action does, so no posted workspace id has to
 * be trusted. Not under app-layout, so it calls requireUser itself.
 */
import type { Route } from "./+types/documents.$docId.speaking-check";
import { requireUser } from "~/lib/auth.server";
import { checkReadingAloud, MAX_SPEAKING_REQUEST, openWorkspace } from "~/lib/reading.server";

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
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
  if (!(audio instanceof File)) return Response.json({ error: "Record yourself reading it first." }, { status: 400 });
  const workspace = await openWorkspace(user.id, params.docId);
  return checkReadingAloud(user.id, workspace.id, Number(form.get("page") ?? 0) || 0, String(form.get("text") ?? ""), audio);
}
