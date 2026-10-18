/**
 * app.api.timezone.ts
 * Resource route (action only): the browser reports its time zone once.
 *
 * "Today" in the learning features is the learner's calendar day, and the
 * server cannot know the learner's zone. The app shell posts
 * Intl.DateTimeFormat().resolvedOptions().timeZone here while the account has
 * no zone yet. `only_if_unset` means this report never overwrites a zone the
 * learner picked in Settings → Account, even from a second device.
 */
import type { Route } from "./+types/app.api.timezone";
import { requireUserId } from "~/lib/auth.server";
import { apiFetch } from "~/lib/api.server";

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const timezone = String(form.get("timezone") ?? "").trim();
  if (!timezone) return Response.json({ ok: false }, { status: 400 });
  try {
    await apiFetch("/v1/me/timezone", userId, {
      method: "PUT",
      body: { timezone, only_if_unset: true },
    });
    return Response.json({ ok: true });
  } catch {
    // A zone the API does not know (an odd browser) leaves the account on
    // UTC; Settings still lets the learner pick one. Nothing to show here.
    return Response.json({ ok: false }, { status: 400 });
  }
}
