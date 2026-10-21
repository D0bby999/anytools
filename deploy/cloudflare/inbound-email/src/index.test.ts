/**
 * The Worker against a fake app: what it posts, and what each answer does to
 * the message. Run from ui/web: npx vitest run ../../deploy/cloudflare/inbound-email
 */
import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { sign } from "./index";

const env = { INBOUND_URL: "https://anytools.test/inbound/email", INBOUND_SECRET: "test-secret" };
const raw = "Subject: Hi\r\n\r\nBody\r\n";

function message() {
  const rejected: string[] = [];
  return {
    rejected,
    msg: {
      to: "abc@in.anytools.world",
      raw: new Response(raw).body!,
      rawSize: raw.length,
      setReject: (reason: string) => rejected.push(reason),
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("the inbound Worker", () => {
  it("signs exactly what internal/inbound checks", async () => {
    const digest = createHash("sha256").update(raw).digest("hex");
    const want = createHmac("sha256", "test-secret").update(`1700000000.${digest}`).digest("hex");
    expect(await sign("test-secret", "1700000000", new TextEncoder().encode(raw).buffer as ArrayBuffer)).toBe(want);
  });

  it("posts the raw message with its recipient and signature", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { msg, rejected } = message();
    await worker.email(msg, env);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe(env.INBOUND_URL);
    expect(headers["X-Inbound-Recipient"]).toBe("abc@in.anytools.world");
    expect(headers["X-Inbound-Signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(raw);
    expect(rejected).toEqual([]);
  });

  it("bounces what the app refuses, and throws for a retry on anything else", async () => {
    for (const [status, bounce] of [[404, "Unknown AnyLearn address"], [429, "This AnyLearn address has received its messages for today"]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
      const { msg, rejected } = message();
      await worker.email(msg, env);
      expect(rejected).toEqual([bounce]);
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(worker.email(message().msg, env)).rejects.toThrow(/503/);
  });
});
