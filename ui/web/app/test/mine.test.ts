/**
 * The "Mine" pages' data: files and links told apart, a link's host, and
 * every knowledge base's documents joined newest first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLinkDocument, linkHost } from "~/lib/mine";

const listKBs = vi.fn();
const listDocuments = vi.fn();
vi.mock("~/lib/kb.server", () => ({
  listKBs: (...a: unknown[]) => listKBs(...a),
  listDocuments: (...a: unknown[]) => listDocuments(...a),
}));

const { listMine, listMineOf } = await import("~/lib/mine.server");

const kb = (id: string, name: string, updated: string) => ({ kb: { id, name, updated_at: updated } });
const doc = (id: string, kbId: string, updated: string, extra: Record<string, unknown> = {}) => ({
  id,
  kb_id: kbId,
  title: id,
  source_kind: "upload",
  updated_at: updated,
  ...extra,
});

describe("files and links", () => {
  it("calls anything fetched from an address a link, and an upload a file", () => {
    expect(isLinkDocument({ source_kind: "upload" })).toBe(false);
    expect(isLinkDocument({ source_kind: "upload", source_url: "https://example.com" })).toBe(true);
    expect(isLinkDocument({ source_kind: "youtube" })).toBe(true);
    expect(isLinkDocument({ source_kind: "site_page", site_id: "s" })).toBe(true);
    expect(isLinkDocument({ source_kind: "repo_file", repo_id: "r" })).toBe(true);
  });

  it("names a link by its host, without www, and nothing for a bad address", () => {
    expect(linkHost("https://www.youtube.com/watch?v=x")).toBe("youtube.com");
    expect(linkHost("https://en.wikipedia.org/wiki/Cell")).toBe("en.wikipedia.org");
    expect(linkHost("not a url")).toBe("");
    expect(linkHost(undefined)).toBe("");
  });
});

describe("listMine", () => {
  beforeEach(() => {
    listKBs.mockResolvedValue({ knowledge_bases: [kb("a", "Biology", "2026-10-01"), kb("b", "History", "2026-10-20")] });
    listDocuments.mockImplementation((_user: string, kbId: string) =>
      Promise.resolve({
        documents:
          kbId === "a"
            ? [doc("old.pdf", "a", "2026-10-02"), doc("page", "a", "2026-10-21", { source_url: "https://x.org/p" })]
            : [doc("new.md", "b", "2026-10-19")],
      }),
    );
  });

  it("joins every base's documents with the base's name, newest first", async () => {
    const { kbs, documents } = await listMine("u1");
    expect(listDocuments).toHaveBeenCalledWith("u1", "a");
    expect(listDocuments).toHaveBeenCalledWith("u1", "b");
    expect(documents.map((d) => [d.id, d.kb_name])).toEqual([
      ["page", "Biology"],
      ["new.md", "History"],
      ["old.pdf", "Biology"],
    ]);
    // The base worked in last comes first: it is the default target.
    expect(kbs).toEqual([
      { id: "b", name: "History" },
      { id: "a", name: "Biology" },
    ]);
  });

  it("keeps only the files or only the links", async () => {
    expect((await listMineOf("u1", "files")).documents.map((d) => d.id)).toEqual(["new.md", "old.pdf"]);
    expect((await listMineOf("u1", "links")).documents.map((d) => d.id)).toEqual(["page"]);
  });
});
