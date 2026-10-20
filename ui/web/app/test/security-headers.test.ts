/**
 * security-headers.test.ts
 * The CSP, directive by directive. Learning-depth phase 4 widened exactly two
 * of them for YouTube video documents — frame-src (the privacy-enhanced
 * player) and img-src (thumbnails) — and this pins that nothing broader came
 * with them: no youtube.com frame, no YouTube script, and the browser still
 * talks to no origin but this one.
 */
import { describe, expect, it } from "vitest";
import { applyCachePolicy, applySecurityHeaders, contentSecurityPolicy } from "~/lib/security-headers.server";
import { handleDataRequest } from "~/entry.server";
import { createUserSession, getSession, resendSession } from "~/lib/session.server";

function directives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

describe("contentSecurityPolicy", () => {
  const csp = directives(contentSecurityPolicy("n0nce"));

  it("frames YouTube only through its privacy-enhanced host", () => {
    const frames = csp.get("frame-src") ?? [];
    expect(frames).toContain("https://www.youtube-nocookie.com");
    expect(frames).toEqual(["https://docs.google.com", "https://drive.google.com", "https://www.youtube-nocookie.com"]);
    for (const value of frames) {
      expect(value).not.toContain("*");
      expect(value).not.toBe("https://www.youtube.com");
      expect(value).not.toBe("https:");
    }
  });

  it("allows video thumbnails from i.ytimg.com and no other new image host", () => {
    expect(csp.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://lh3.googleusercontent.com",
      "https://ssl.gstatic.com",
      "https://www.gstatic.com",
      "https://i.ytimg.com",
    ]);
  });

  it("changes nothing else: scripts, connections and framing are as before", () => {
    expect(csp.get("script-src")).toEqual(["'self'", "'nonce-n0nce'", "https://apis.google.com", "'wasm-unsafe-eval'"]);
    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(contentSecurityPolicy("n0nce")).not.toMatch(/youtube\.com(?!-)/);
  });

  it("is only sent in production", () => {
    const dev = new Headers();
    applySecurityHeaders(dev, "n", false);
    expect(dev.get("Content-Security-Policy")).toBeNull();
    const prod = new Headers();
    applySecurityHeaders(prod, "n", true);
    expect(prod.get("Content-Security-Policy")).toContain("frame-src");
  });
});

// Up-methods phase 7: recordings. The preview before "Keep" is a blob: URL
// and a kept take is streamed from this origin; the microphone is this
// origin's only, never a framed page's.
describe("recordings", () => {
  it("plays media from this origin and the recorder's blob: preview, nothing else", () => {
    expect(directives(contentSecurityPolicy("n0nce")).get("media-src")).toEqual(["'self'", "blob:"]);
  });

  it("allows the microphone (and, for the QR scanner, the camera) for this origin only", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "n", true);
    expect(headers.get("Permissions-Policy")).toBe("camera=(self), microphone=(self), geolocation=(), payment=()");
    expect(headers.get("Content-Security-Policy")).toContain("media-src 'self' blob:");
    const dev = new Headers();
    applySecurityHeaders(dev, "n", false);
    expect(dev.get("Permissions-Policy")).toBe("camera=(self), microphone=(self), geolocation=(), payment=()");
  });
});

// AnyTools phase 3c: the public tools run WebAssembly and one reads the
// camera. That is all the policy gained for them.
describe("the public tools", () => {
  const csp = directives(contentSecurityPolicy("n0nce"));

  it("may compile WebAssembly, and still may not eval JavaScript", () => {
    expect(csp.get("script-src")).toContain("'wasm-unsafe-eval'");
    expect(csp.get("script-src")).not.toContain("'unsafe-eval'");
    expect(csp.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("fetch their run-time files from this origin only", () => {
    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.get("worker-src")).toEqual(["'self'", "blob:"]);
    expect(csp.get("font-src")).toEqual(["'self'", "data:"]);
  });
});

// AnyTools phase 3: font-converter (HarfBuzz), sql-playground (sql.js) and
// barcode-generator (zxing-wasm) compile WebAssembly in the page. That needs
// 'wasm-unsafe-eval', which allows WebAssembly compilation only; script eval
// stays forbidden (protobuf-decoder was rebuilt not to need it, and ajv runs
// in a worker).
describe("tools", () => {
  const csp = directives(contentSecurityPolicy("n0nce"));

  it("lets a page compile WebAssembly, and still evaluates no string as script", () => {
    expect(csp.get("script-src")).toContain("'wasm-unsafe-eval'");
    expect(csp.get("script-src")).not.toContain("'unsafe-eval'");
    expect(csp.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("keeps workers to this origin and blob:, and connections to this origin", () => {
    expect(csp.get("worker-src")).toEqual(["'self'", "blob:"]);
    expect(csp.get("connect-src")).toEqual(["'self'"]);
  });
});

// Cloudflare kept documents for hours: after a deploy they named scripts that
// were gone, and a signed-in page could have reached someone else.
describe("caching", () => {
  it("lets no shared cache keep a document", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "n", true);
    expect(headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("keeps a route's own Cache-Control", () => {
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    applyCachePolicy(headers);
    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("applies to client navigation's data too", async () => {
    const response = await handleDataRequest(new Response("{}"), { request: new Request("https://a.example/x.data") });
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});

// Cloudflare's rule stores HTML whatever Cache-Control says, but never a
// response that sets a cookie: a signed-in visitor's always does.
describe("a signed-in visitor's response", () => {
  const signedIn = async () =>
    new Request("https://a.example/home", { headers: { Cookie: (await createUserSession(new Request("https://a.example/"), "u1")).split(";")[0]! } });

  it("sets their session cookie again, still theirs", async () => {
    const request = await signedIn();
    const headers = new Headers();
    await resendSession(request, headers);
    const cookie = headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^__anytools_session=/);
    const again = await getSession(new Request("https://a.example/", { headers: { Cookie: cookie.split(";")[0]! } }));
    expect(again.get("userId")).toBe("u1");
  });

  it("sets nothing for a visitor who is not signed in", async () => {
    const headers = new Headers();
    await resendSession(new Request("https://a.example/vi/tools"), headers);
    expect(headers.get("Set-Cookie")).toBeNull();
  });

  it("leaves a route's own cookie alone (signing out)", async () => {
    const headers = new Headers({ "Set-Cookie": "__anytools_session=; Max-Age=0" });
    await resendSession(await signedIn(), headers);
    expect(headers.get("Set-Cookie")).toBe("__anytools_session=; Max-Age=0");
  });

  it("goes on client navigation's data too", async () => {
    const response = await handleDataRequest(new Response("{}"), { request: await signedIn() });
    expect(response.headers.get("Set-Cookie")).toMatch(/^__anytools_session=/);
  });
});
