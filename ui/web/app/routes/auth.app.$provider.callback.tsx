/**
 * auth.app.$provider.callback.tsx — where Canva or Notion sends the learner
 * back (learning-tool-connections phases 8 and 9).
 */
import type { Route } from "./+types/auth.app.$provider.callback";
import { handleAppCallback } from "~/auth/apps.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  return handleAppCallback(request, params.provider);
}
