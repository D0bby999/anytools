/**
 * toolkit.$id.recordings.ts
 * Resource route (action only): keep one take on a worksheet (up-methods
 * phase 7). The browser posts a multipart form with an `audio` part and its
 * `duration_seconds`; the API checks everything and its answer comes back as
 * JSON. Not under app-layout, so it calls requireUser itself.
 */
import type { Route } from "./+types/toolkit.$id.recordings";
import { requireUser } from "~/lib/auth.server";
import { MAX_RECORDING_REQUEST, uploadRecording } from "~/lib/worksheets.server";

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  // Refused by size before the body is buffered here.
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(length) || length > MAX_RECORDING_REQUEST) {
    return Response.json({ error: "A recording is at most 10 MB." }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "The recording could not be read." }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof File)) return Response.json({ error: "Send the recording." }, { status: 400 });
  return uploadRecording(user.id, params.id, audio, String(form.get("duration_seconds") ?? ""));
}
