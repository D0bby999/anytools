import type { Route } from "./+types/app.api.byok-models";
import { requireUserId } from "~/lib/auth.server";
import { formErrorMessage, listModels } from "~/lib/byok.server";
import type { ModelsData } from "~/lib/byok.types";
import { requireUUID } from "~/lib/turns";

/**
 * One connection's models, for the model picker and the provider page (plan
 * 261021-1100 phase 4): what the provider lists for the learner's key, and
 * the ones they added. A GET the browser makes only when a picker opens or a
 * list is shown, since each asks the provider (the API budgets it as a
 * verify).
 */
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const id = requireUUID(new URL(request.url).searchParams.get("connection") ?? "");
  let body: ModelsData;
  try {
    body = { ok: true, ...(await listModels(userId, id)) };
  } catch (error) {
    body = { ok: false, error: formErrorMessage(error, "The models could not be listed.") };
  }
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
