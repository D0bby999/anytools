/**
 * cal.$file.ts
 * GET /cal/<token>.ics — the study calendar feed a calendar app subscribes to
 * (learning-tool-connections phase 2). No session: the token is the
 * credential, so a wrong one is a plain 404, the same as a rotated one.
 */
import type { Route } from "./+types/cal.$file";
import { readCalendarFeed } from "~/lib/calendar.server";

export async function loader({ params }: Route.LoaderArgs) {
  const match = /^([A-Za-z0-9_-]{20,100})\.ics$/.exec(params.file ?? "");
  if (!match) throw new Response("Not found", { status: 404 });
  const ics = await readCalendarFeed(match[1]!);
  if (ics === null) throw new Response("Not found", { status: 404 });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
