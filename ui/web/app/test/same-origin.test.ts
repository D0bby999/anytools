// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({ APP_URL: "https://learn.example.com" }));
const { crossSiteWriteReason, assertSameOrigin } = await import("~/lib/same-origin.server");

function req(method: string, headers: Record<string, string>) {
  return new Request("https://learn.example.com/knowledge/1", { method, headers });
}

describe("crossSiteWriteReason", () => {
  it("lets reads through whatever their origin", () => {
    expect(crossSiteWriteReason(req("GET", { Origin: "https://evil.test" }))).toBeNull();
  });

  it("lets same-site writes through, by Host or by APP_URL", () => {
    expect(crossSiteWriteReason(req("POST", { Origin: "https://learn.example.com", Host: "learn.example.com" }))).toBeNull();
    expect(crossSiteWriteReason(req("POST", { Origin: "http://localhost:5173", Host: "localhost:5173" }))).toBeNull();
    expect(crossSiteWriteReason(req("POST", { Origin: "https://learn.example.com", Host: "web:3000" }))).toBeNull();
  });

  it("refuses a write from another site, an opaque origin, or a cross-site fetch", () => {
    expect(crossSiteWriteReason(req("POST", { Origin: "https://evil.test", Host: "learn.example.com" }))).toMatch(/not this site/);
    expect(crossSiteWriteReason(req("DELETE", { Origin: "https://learn.example.com.evil.test", Host: "learn.example.com" }))).not.toBeNull();
    expect(crossSiteWriteReason(req("POST", { Origin: "null" }))).toMatch(/opaque/);
    expect(crossSiteWriteReason(req("POST", { "Sec-Fetch-Site": "cross-site" }))).toMatch(/cross-site/);
  });

  it("allows a write with no Origin and no fetch metadata (a non-browser client holds no victim cookie)", () => {
    expect(crossSiteWriteReason(req("POST", {}))).toBeNull();
  });

  it("assertSameOrigin throws a 403 response", () => {
    try {
      assertSameOrigin(req("POST", { Origin: "https://evil.test", Host: "learn.example.com" }));
      throw new Error("did not throw");
    } catch (e) {
      expect((e as Response).status).toBe(403);
    }
  });
});
