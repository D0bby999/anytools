/**
 * app.api.low-day.ts
 * Resource route (action only): the Home "Low day" switch. It sets or clears
 * a cookie for the learner's current local day; nothing is stored on the
 * server (see low-day.server.ts).
 */
import type { Route } from "./+types/app.api.low-day";
import { requireUser } from "~/lib/auth.server";
import { localDay } from "~/lib/local-day";
import { lowDayHeader } from "~/lib/low-day.server";

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const on = form.get("on") === "1";
  const header = await lowDayHeader(on, user.id, localDay(user.timezone));
  return Response.json({ ok: true, on }, { headers: { "Set-Cookie": header } });
}
