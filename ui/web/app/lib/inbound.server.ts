/**
 * inbound.server.ts
 * Email in (learning-tool-connections phase 4): the learner's address, where
 * its messages go, and the forward a delivery from the Cloudflare Email
 * Worker becomes. That forward carries no user: the Worker's signature,
 * checked by the API, is the credential, so it passes the headers and the raw
 * bytes through untouched.
 */
import { apiFetch } from "~/lib/api.server";
import { API_BASE, API_TOKEN } from "~/lib/env.server";
import type { InboundView } from "~/lib/inbound-types";

export function getInbound(userId: string) {
  return apiFetch<InboundView>("/v1/inbound/address", userId);
}

export function setInboundKB(userId: string, kbId: string) {
  return apiFetch<InboundView>("/v1/inbound/address", userId, { method: "PUT", body: { kb_id: kbId } });
}

export function rotateInbound(userId: string) {
  return apiFetch<InboundView>("/v1/inbound/address/rotate", userId, { method: "POST", body: {} });
}

const FORWARDED = ["X-Inbound-Recipient", "X-Inbound-Timestamp", "X-Inbound-Signature"] as const;

/** 25 MiB, the API's limit, plus the slack a header block takes. */
export const MAX_INBOUND_BYTES = 25 * 1024 * 1024;

/** Forwards one delivery to the API and answers with its status. */
export async function forwardInbound(request: Request): Promise<Response> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > MAX_INBOUND_BYTES) return new Response("too large", { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_INBOUND_BYTES) return new Response("too large", { status: 413 });
  const headers: Record<string, string> = { "Content-Type": "message/rfc822" };
  for (const name of FORWARDED) headers[name] = request.headers.get(name) ?? "";
  if (API_TOKEN) headers.Authorization = `Bearer ${API_TOKEN}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/inbound/email`, { method: "POST", headers, body });
  } catch {
    return new Response("unavailable", { status: 503 });
  }
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
