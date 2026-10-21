/**
 * share-route.test.ts
 * The /share page (the private design notes, phase 4): the loader
 * finds the link and offers the knowledge base used last; the action adds the
 * link as "Add a link" does, creates a first knowledge base when there is
 * none, remembers the choice and goes to that knowledge base.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api.internal:8080", API_TOKEN: "t", isProduction: false }));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));
const kb = { listKBs: vi.fn(), addLink: vi.fn(), createKB: vi.fn() };
vi.mock("~/lib/kb.server", () => kb);

const { loader, action } = await import("~/routes/share");
const { ApiError } = await import("~/lib/api.server");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function load(qs: string, cookie = "") {
  const request = new Request(`http://localhost/share?${qs}`, { headers: cookie ? { Cookie: cookie } : {} });
  return loader({ request, params: {}, context: {} } as unknown as Parameters<typeof loader>[0]);
}

function post(fields: Record<string, string>) {
  const request = new Request("http://localhost/share", { method: "POST", body: new URLSearchParams(fields) });
  return action({ request, params: {}, context: {} } as unknown as Parameters<typeof action>[0]);
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  kb.listKBs.mockReset().mockResolvedValue({
    knowledge_bases: [{ kb: { id: A, name: "Papers" } }, { kb: { id: B, name: "Videos" } }],
  });
  kb.addLink.mockReset().mockResolvedValue({ document: { id: "d1" } });
  kb.createKB.mockReset().mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" });
});

describe("the share page", () => {
  it("finds the link in text and offers the knowledge base used last", async () => {
    const data = await load("text=A%20talk%20https%3A%2F%2Fyoutu.be%2FarJ7oStGLkU", `x=1; al_share_kb=${B}`);
    expect(data).toEqual({
      link: "https://youtu.be/arJ7oStGLkU",
      title: "A talk",
      kbs: [
        { id: A, name: "Papers" },
        { id: B, name: "Videos" },
      ],
      selected: B,
    });
    expect((await load("text=no%20link")).link).toBeNull();
    // A remembered knowledge base that is gone falls back to the first.
    expect((await load("url=https%3A%2F%2Fexample.com", "al_share_kb=44444444-4444-4444-8444-444444444444")).selected).toBe(A);
  });

  it("adds the link, remembers the knowledge base and opens it", async () => {
    const res = (await post({ url: "https://example.com/post", kb: B })) as Response;
    expect(kb.addLink).toHaveBeenCalledWith("user-1", B, "https://example.com/post", false);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/knowledge/${B}`);
    expect(res.headers.get("Set-Cookie")).toContain(`al_share_kb=${B}`);
  });

  it("makes a first knowledge base when there is none", async () => {
    await post({ url: "https://example.com/post", name: "Shared links" });
    expect(kb.createKB).toHaveBeenCalledWith("user-1", "Shared links");
    expect(kb.addLink).toHaveBeenCalledWith("user-1", "33333333-3333-4333-8333-333333333333", "https://example.com/post", false);
  });

  it("refuses what is not a web link, and passes the API's sentence on", async () => {
    expect(await post({ url: "javascript:alert(1)", kb: A })).toEqual({ error: "" });
    expect(kb.addLink).not.toHaveBeenCalled();
    kb.addLink.mockRejectedValueOnce(new ApiError(400, "that page could not be read"));
    expect(await post({ url: "https://example.com/x", kb: A })).toEqual({ error: "that page could not be read" });
  });
});
