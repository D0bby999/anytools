/**
 * auth.github.tsx — starts GitHub sign-in. Resource route: it only redirects.
 */
import type { Route } from "./+types/auth.github";
import { startOAuth } from "~/auth/start.server";

export async function loader({ request }: Route.LoaderArgs) {
  return startOAuth(request, "github");
}
