/**
 * auth.app.$provider.tsx — starts the Canva or Notion consent
 * (learning-tool-connections phases 8 and 9). Resource route: it redirects.
 */
import type { Route } from "./+types/auth.app.$provider";
import { startAppConnect } from "~/auth/apps.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return startAppConnect(request, params.provider);
}
