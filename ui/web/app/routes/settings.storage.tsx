/**
 * settings.storage.tsx
 * Storage moved out of Settings to /storage (2026-10-21). This keeps the old
 * address working, query string included: Google Drive's consent screen and
 * older links return here.
 */
import { redirect } from "react-router";
import type { Route } from "./+types/settings.storage";

export function loader({ request }: Route.LoaderArgs) {
  const { search } = new URL(request.url);
  return redirect(`/storage${search}`);
}
