/**
 * auth.callback.$provider.tsx
 * Where Google and GitHub redirect back to. Resource route: it only redirects.
 */
import type { Route } from "./+types/auth.callback.$provider";
import { handleOAuthCallback } from "~/auth/callback.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return handleOAuthCallback(request, params.provider);
}
