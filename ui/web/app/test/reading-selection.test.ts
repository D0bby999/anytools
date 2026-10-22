/**
 * reading-selection.test.ts
 * Which text and which page a reader's selection is filed under — the page is
 * what a saved note and a tutor answer later reopen at.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readSelection, storedActionHead, transcriptAction, transcriptHead, transcriptPage } from "~/lib/reading-selection";
import vi from "../../public/locales/vi/reading.json";
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

// A fake t over the real Vietnamese file, with i18next's {{x}} interpolation.
function viT(key: string, options?: Record<string, unknown>): string {
  const value = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], vi);
  if (typeof value !== "string") throw new Error(`no vi string for ${key}`);
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ""));
}

describe("transcriptAction", () => {
  it("knows the four heads readingapi stores, whatever the interface language", () => {
    // Same four as internal/capabilities/reading TestActionLabelsAreTheWebContract.
    expect(transcriptAction("Explain this (page 12):\n\n> x")).toBe("explain");
    expect(transcriptAction("Vocabulary here (page 1):\n\n> x")).toBe("vocab");
    expect(transcriptAction("Quiz me on this:\n\n> x")).toBe("quiz");
    expect(transcriptAction("Translate this (at 1:05):\n\n> x")).toBe("translate");
    expect(transcriptAction("What does this mean?")).toBeNull();
    expect(transcriptAction("Vocabulary here is thin")).toBeNull();
  });

  it("builds the pending question as the stored line, so nothing changes when the transcript arrives", () => {
    expect(storedActionHead("vocab", { page: 3 })).toBe("Vocabulary here (page 3)");
    expect(storedActionHead("explain", { clock: "2:10" })).toBe("Explain this (at 2:10)");
    expect(storedActionHead("quiz", {})).toBe("Quiz me on this");
    expect(transcriptPage(`${storedActionHead("vocab", { page: 3 })}:\n\n> x`)).toBe(3);
  });
});

describe("transcriptHead", () => {
  it("shows the stored line in the interface language and leaves the quote alone", () => {
    expect(transcriptHead("Vocabulary here (page 1):\n\n> hands the turn back", viT)).toBe(
      "Từ vựng ở đây (trang 1):\n\n> hands the turn back",
    );
    expect(transcriptHead("Explain this (at 1:05):\n\n> x", viT)).toBe("Giải thích đoạn này (lúc 1:05):\n\n> x");
    expect(transcriptHead("Quiz me on this:\n\n> x", viT)).toBe("Kiểm tra tôi về đoạn này:\n\n> x");
    expect(transcriptHead("A typed question", viT)).toBe("A typed question");
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
