import type { Route } from "./+types/app.api.quick-setup";
import { requireUserId } from "~/lib/auth.server";
import { formErrorMessage, quickSetup } from "~/lib/byok.server";
import type { QuickSetupResult } from "~/lib/byok.types";
import { requireUUID } from "~/lib/turns";

/**
 * Quick setup's POST (the private design notes, phase 2): one
 * connection for every task with none yet. Called from the dialog on a
 * provider's page and on Routes; the routes it writes go through the same
 * PUT /v1/byok/routes/{function} the chains do.
 */
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const id = requireUUID(String(form.get("connection") ?? ""));
  let body: QuickSetupResult;
  try {
    body = {
      ok: true,
      ...(await quickSetup(userId, id, {
        chat: String(form.get("chat_model") ?? "").trim(),
        embed: String(form.get("embed_model") ?? "").trim(),
      })),
    };
  } catch (error) {
    body = { ok: false, error: formErrorMessage(error, "The tasks could not be set. Try again.") };
  }
  // 200 either way, as app.api.byok-models answers: the dialog reads `ok`.
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
