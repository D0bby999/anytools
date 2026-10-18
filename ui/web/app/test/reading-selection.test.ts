/**
 * reading-selection.test.ts
 * Which text and which page a reader's selection is filed under — the page is
 * what a saved note and a tutor answer later reopen at.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readSelection, transcriptPage } from "~/lib/reading-selection";
import { MAX_SELECTION, sourceHref } from "~/lib/reading-types";

function pages(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <section data-page="3" id="page-3"><p>First   page
      text.</p></section>
    <section data-page="4" id="page-4"><p>Second page text.</p></section>`;
  document.body.append(root);
  return root;
}

function select(root: HTMLElement, from: string, to: string) {
  const range = document.createRange();
  range.setStart(root.querySelector(from)!.firstChild!, 0);
  const end = root.querySelector(to)!.firstChild!;
  range.setEnd(end, end.textContent!.length);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return sel;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("readSelection", () => {
  it("files a selection under the page it starts on, with whitespace collapsed", () => {
    const root = pages();
    const sel = select(root, "#page-3 p", "#page-4 p");
    const got = readSelection(root, sel);
    expect(got?.page).toBe(3);
    expect(got?.text).toBe("First page text. Second page text.");
  });

  it("ignores a collapsed selection and one outside the reader", () => {
    const root = pages();
    expect(readSelection(root, window.getSelection())).toBeNull();

    const outside = document.createElement("p");
    outside.textContent = "Not the document";
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    window.getSelection()!.addRange(range);
    expect(readSelection(root, window.getSelection())).toBeNull();
  });

  it("trims to what the API accepts instead of sending a selection it will refuse", () => {
    const root = document.createElement("div");
    root.innerHTML = `<section data-page="1"><p>${"a".repeat(MAX_SELECTION + 50)}</p></section>`;
    document.body.append(root);
    const sel = select(root, "p", "p");
    expect(readSelection(root, sel)?.text).toHaveLength(MAX_SELECTION);
  });
});

describe("transcriptPage", () => {
  it("reads the page from the line readingapi stores", () => {
    // Same literal as internal/capabilities/reading TestTranscriptMessageFormatIsTheWebContract.
    expect(transcriptPage("Explain this (page 12):\n\n> Parametric memory")).toBe(12);
    expect(transcriptPage("Translate this:\n\n> (page 9): not the head")).toBe(0);
  });
});

describe("sourceHref", () => {
  it("sends document and reading notes back to the page, and chat notes to the session", () => {
    expect(sourceHref({ kind: "document", id: "d1", page: 4 })).toBe("/documents/d1?page=4");
    expect(sourceHref({ kind: "reading", id: "d1" })).toBe("/documents/d1");
    expect(sourceHref({ kind: "session", id: "s1" })).toBe("/chat/s1");
    expect(sourceHref({ kind: "question", id: "q1" })).toBeNull();
    expect(sourceHref({})).toBeNull();
  });
});
