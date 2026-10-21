/**
 * tool-runtime.$.ts
 * `/tool-runtime/<package>@<version>/…`: a tool's run-time files, cached for
 * a year (lib/tools/runtime-files.server.ts). Loader only, no sign-in: the
 * public tool pages load them.
 */
import type { Route } from "./+types/tool-runtime.$";
import { RUNTIME_ROOT, runtimeFile } from "~/lib/tools/runtime-files.server";

export async function loader({ params, request }: Route.LoaderArgs) {
  const file = await runtimeFile(RUNTIME_ROOT, `${params.pkg}/${params["*"] ?? ""}`, request.headers.get("Accept-Encoding"), request.method);
  if (!file) throw new Response("Not found", { status: 404 });
  return file;
}
