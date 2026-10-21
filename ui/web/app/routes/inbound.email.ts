/**
 * inbound.email.ts
 * POST /inbound/email — where the Cloudflare Email Worker delivers a signed
 * message (learning-tool-connections phase 4). No session: the signature,
 * checked by the API, is the credential. Anything but POST is a 405.
 */
import type { Route } from "./+types/inbound.email";
import { forwardInbound } from "~/lib/inbound.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  return forwardInbound(request);
}

export function loader() {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}
