/**
 * tools/bounded-read.server.ts
 * Read a body, a request's or an upstream response's, without trusting its
 * size: stop and refuse at `max` bytes, whatever Content-Length claimed. The
 * public tool routes (api.curl-convert.ts, api.fx.ts) take bodies from anyone
 * and from a third-party host, so neither may be read whole.
 */

export class BodyTooLargeError extends Error {
  constructor(readonly max: number) {
    super(`body is larger than ${max} bytes`);
    this.name = "BodyTooLargeError";
  }
}

/** The body as UTF-8 text, or BodyTooLargeError past `max` bytes. */
export async function readTextLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new BodyTooLargeError(max);
      chunks.push(value);
    }
  } finally {
    // Stops the rest of an oversized body; a no-op once it has ended.
    await reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
