/**
 * auth.drive.tsx — starts the Google Drive consent. Resource route: it only
 * redirects. Its helper calls requireUserId, because connecting Drive is
 * something a signed-in user does to their own account.
 */
import type { Route } from "./+types/auth.drive";
import { startDriveConnect } from "~/auth/drive.server";

export async function loader({ request }: Route.LoaderArgs) {
  return startDriveConnect(request);
}
