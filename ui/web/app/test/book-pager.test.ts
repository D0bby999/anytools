/**
 * book-pager.test.ts
 *
 * A book chapter pages through its own book, not NAV_TREE's neighbours
 * (plan 261020-2246, phase 08): `handle.pager` on
 * routes/books.$bookId.chapters.$chapterId reads the book's own chapter
 * list, already in the loader's data, and finds the chapter before and
 * after the one being read, by its id — not by array position alone, so a
 * chapter missing from the list (defensive) never points the pager at the
 * wrong neighbour.
 */
import { describe, expect, it } from "vitest";
import type { UIMatch } from "react-router";
import { chapterPager, handle } from "~/routes/books.$bookId.chapters.$chapterId";
import type { Book, Chapter } from "~/lib/book-types";


const chapter = (over: Partial<Chapter>): Chapter => ({
  id: "ch1",
  book_id: "b1",
  ord: 1,
  title: "One",
  objectives: [],
  prereqs: [],
  anchors: [],
  status: "ready",
  blocks: 0,
  ready: 0,
  stale: false,
  estimated_calls: 0,
  ...over,
});

const chapters = [
  chapter({ id: "ch1", ord: 1, title: "One" }),
  chapter({ id: "ch2", ord: 2, title: "Two" }),
  chapter({ id: "ch3", ord: 3, title: "Three" }),
];

const book: Book = {
  id: "b1",
  kb_id: "kb1",
  title: "Retrieval",
  goal: "",
  length: chapters.length,
  status: "confirmed",
  proposal: { title: "Retrieval", audience: "", chapters: [] },
  chapters,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  compiling: false,
  estimated_calls: 0,
};

const view = (chapter: Chapter) => ({ chapter, blocks: [] });

describe("chapterPager", () => {
  it("points at the previous and next chapter from the middle", () => {
    const pager = chapterPager({ book, view: view(chapters[1]!) });
    expect(pager?.prev).toEqual({ to: "/books/b1/chapters/ch1", label: "One" });
    expect(pager?.next).toEqual({ to: "/books/b1/chapters/ch3", label: "Three" });
  });

  it("has no previous link at the first chapter", () => {
    const pager = chapterPager({ book, view: view(chapters[0]!) });
    expect(pager?.prev).toBeUndefined();
    expect(pager?.next).toEqual({ to: "/books/b1/chapters/ch2", label: "Two" });
  });

  it("has no next link at the last chapter", () => {
    const pager = chapterPager({ book, view: view(chapters[2]!) });
    expect(pager?.next).toBeUndefined();
    expect(pager?.prev).toEqual({ to: "/books/b1/chapters/ch2", label: "Two" });
  });

  it("returns null for a chapter the book's own list does not carry", () => {
    expect(chapterPager({ book, view: view(chapter({ id: "ghost", ord: 9 })) })).toBeNull();
  });

  it("returns null before the loader has data", () => {
    expect(chapterPager(undefined)).toBeNull();
  });
});

describe("the route's handle.pager", () => {
  it("reads the same book and chapter off a fake match's data", () => {
    if (typeof handle.pager !== "function") throw new Error("handle.pager is not a function");
    const fakeMatch = { data: { book, view: view(chapters[0]!) } } as unknown as UIMatch;
    const pager = handle.pager(fakeMatch);
    expect(pager?.prev).toBeUndefined();
    expect(pager?.next).toEqual({ to: "/books/b1/chapters/ch2", label: "Two" });
  });
});
