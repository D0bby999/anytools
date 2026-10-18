/**
 * auth.google.tsx — starts Google sign-in. Resource route: it only redirects.
 */
import type { Route } from "./+types/auth.google";
import { startOAuth } from "~/auth/start.server";

export async function loader({ request }: Route.LoaderArgs) {
  return startOAuth(request, "google");
}
