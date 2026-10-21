/**
 * The inbound mail Worker (learning-tool-connections phase 4).
 *
 * For each message: read the raw bytes, sign them, and post them to the app.
 * The signature is hex HMAC-SHA256 over "<unix seconds>.<hex sha256 of the
 * raw message>" with INBOUND_SECRET; internal/inbound checks it, and refuses
 * one older than five minutes.
 *
 * The app's answer decides the message's fate: a refusal it means (unknown
 * address, too large, over the daily limit, not an email) bounces with a
 * reason; anything else throws, so Email Routing reports a temporary failure
 * and the sending server tries again later.
 */
export interface Env {
  INBOUND_URL: string;
  INBOUND_SECRET: string;
}

type Message = {
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
};

const MAX_BYTES = 25 * 1024 * 1024;

const BOUNCES: Record<number, string> = {
  404: "Unknown AnyLearn address",
  413: "Message larger than 25 MB",
  422: "Not a readable email",
  429: "This AnyLearn address has received its messages for today",
};

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sign(secret: string, timestamp: string, raw: ArrayBuffer): Promise<string> {
  const digest = hex(await crypto.subtle.digest("SHA-256", raw));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${digest}`)));
}

export default {
  async email(message: Message, env: Env): Promise<void> {
    if (message.rawSize > MAX_BYTES) {
      message.setReject(BOUNCES[413]!);
      return;
    }
    const raw = await new Response(message.raw).arrayBuffer();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const res = await fetch(env.INBOUND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "message/rfc822",
        "X-Inbound-Recipient": message.to,
        "X-Inbound-Timestamp": timestamp,
        "X-Inbound-Signature": await sign(env.INBOUND_SECRET, timestamp, raw),
      },
      body: raw,
    });
    if (res.ok) return;
    const bounce = BOUNCES[res.status];
    if (bounce) {
      message.setReject(bounce);
      return;
    }
    throw new Error(`AnyLearn answered ${res.status}; try again later`);
  },
};
