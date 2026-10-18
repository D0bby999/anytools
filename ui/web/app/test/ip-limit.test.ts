// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clientIP, createIPLimiter } from "~/lib/ip-limit.server";

describe("clientIP", () => {
  it("takes the address nginx appended, not one the client sent", () => {
    const r = new Request("http://x/", { headers: { "X-Forwarded-For": "6.6.6.6, 203.0.113.9" } });
    expect(clientIP(r)).toBe("203.0.113.9");
    expect(clientIP(new Request("http://x/"))).toBe("unknown");
  });
});

describe("createIPLimiter", () => {
  it("spends a burst per address, refills over time, and keeps addresses apart", () => {
    let t = 0;
    const allow = createIPLimiter(60, 2, () => t);
    expect([allow("a"), allow("a"), allow("a")]).toEqual([true, true, false]);
    expect(allow("b")).toBe(true);
    t += 1000; // 60/min = one token a second
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(false);
  });
});
