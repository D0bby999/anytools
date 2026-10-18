/**
 * knowledge.$kbId.upload.ts
 * Resource route (action only): one file added to a knowledge base, its
 * body streamed to the API as it arrives (up-methods phase 15).
 *
 * The knowledge base page's own action reads `request.formData()`, which
 * holds the whole file in this process before forwarding it. Fine at 50 MB;
 * not for a 500 MB recording. The dropzone posts here instead, and the body
 * goes to the API untouched (kb.server.streamUpload). The answers are the
 * page action's upload answers, so the dropzone reads them the same way.
 */
import type { Route } from "./+types/knowledge.$kbId.upload";
import { requireUser } from "~/lib/auth.server";
import { streamUpload } from "~/lib/kb.server";
import { driveReason } from "~/lib/drive-storage";

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  // The file's name, for the message, from the dropzone's query string: the
  // body is not parsed here.
  const name = new URL(request.url).searchParams.get("name")?.slice(0, 200) ?? "";
  const result = await streamUpload(user.id, params.kbId, request);
  if (result.status >= 400) {
    const reason = driveReason(result.code);
    return {
      uploadErrorKey: "errors.uploadFailed",
      uploadErrorDetail: result.error ? (name ? `${name}: ${result.error}` : result.error) : name,
      // A file the learner keeps in Google Drive that Drive refused
      // (drive-user-storage phase 3): the dropzone says why, and what to do.
      ...(reason ? { driveReason: reason } : {}),
    };
  }
  return { uploaded: name };
}
