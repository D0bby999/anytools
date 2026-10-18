/**
 * auth.drive.callback.tsx
 * Where Google sends the user back after the Drive consent. Resource route: it
 * only redirects, and it never mints a session — see ~/auth/drive.server.
 */
import type { Route } from "./+types/auth.drive.callback";
import { handleDriveCallback } from "~/auth/drive.server";

export async function loader({ request }: Route.LoaderArgs) {
  return handleDriveCallback(request);
}
