/**
 * share.test.ts
 * Share to AnyLearn (the private design notes, phase 4): the link a
 * share carries, wherever the sharing app put it, and the manifest's share
 * target pointing at the route that reads it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pickLink, sharedTitle } from "~/lib/share";

describe("the link in a share", () => {
  it("takes url first, then a link inside text, then title", () => {
    expect(pickLink({ url: "https://example.com/a", text: "see https://other.example/b" })).toBe("https://example.com/a");
    expect(pickLink({ text: "Inside the Mind of a Master Procrastinator https://youtu.be/arj7oStGLkU" })).toBe(
      "https://youtu.be/arj7oStGLkU",
    );
    expect(pickLink({ title: "https://example.com/podcast.xml" })).toBe("https://example.com/podcast.xml");
  });

  it("drops the punctuation a sentence leaves after a link", () => {
    expect(pickLink({ text: "Read this (https://example.com/post)." })).toBe("https://example.com/post");
    expect(pickLink({ text: "First https://a.example/x, then https://b.example/y" })).toBe("https://a.example/x");
  });

  it("refuses what is not a web link", () => {
    expect(pickLink({ text: "no link here" })).toBeNull();
    expect(pickLink({ url: "javascript:alert(1)" })).toBeNull();
    expect(pickLink({ url: "file:///etc/passwd", text: "ftp://example.com/x" })).toBeNull();
    expect(pickLink({ url: "http://localhost/x" })).toBeNull();
    expect(pickLink({})).toBeNull();
  });

  it("keeps a title that says more than the link", () => {
    expect(sharedTitle({ title: "A talk" }, "https://youtu.be/x")).toBe("A talk");
    expect(sharedTitle({ title: "https://youtu.be/x", text: "A talk https://youtu.be/x" }, "https://youtu.be/x")).toBe("A talk");
    expect(sharedTitle({}, null)).toBe("");
  });
});

describe("the manifest's share target", () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "manifest.webmanifest"), "utf8"));
  const routes = readFileSync(join(__dirname, "..", "routes.ts"), "utf8");

  it("is a GET to /share with the three fields the page reads", () => {
    expect(manifest.share_target).toEqual({
      action: "/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    });
    expect(routes).toContain('route("share", "routes/share.tsx")');
  });
});
