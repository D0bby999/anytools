/**
 * code-editor-early.test.tsx
 * Text typed in the plain box before CodeMirror has loaded is the text the
 * editor starts with (independent review, M13).
 */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const docs: string[] = [];
class FakeView {
  static theme = () => [];
  static updateListener = { of: () => [] };
  static contentAttributes = { of: () => [] };
  state: { doc: { toString: () => string; length: number } };
  constructor({ doc }: { doc: string }) {
    docs.push(doc);
    this.state = { doc: { toString: () => doc, length: doc.length } };
  }
  dispatch() {}
  focus() {}
  destroy() {}
}
const anything: unknown = new Proxy(() => ({}), { get: () => anything, apply: () => ({}) });
vi.mock("codemirror", () => ({ basicSetup: [], EditorView: FakeView }));
vi.mock("@codemirror/lang-python", () => ({ python: () => [] }));
vi.mock("@codemirror/view", () => ({ keymap: { of: () => [] } }));
vi.mock("@codemirror/commands", () => ({ indentWithTab: {} }));
vi.mock("@codemirror/language", () => ({ HighlightStyle: { define: () => ({}) }, syntaxHighlighting: () => [], indentUnit: { of: () => [] } }));
vi.mock("@lezer/highlight", () => ({ tags: anything }));

const { CodeEditor } = await import("~/components/quiz/code-editor");

function Editor() {
  const [value, setValue] = useState("def leap_year(year):\n    pass\n");
  return <CodeEditor id="ed" value={value} onChange={setValue} onRun={() => {}} label="Your code" />;
}

describe("the code editor", () => {
  it("starts from what was typed before it loaded", async () => {
    render(<Editor />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "def leap_year(year):\n    return True\n" } });
    await waitFor(() => expect(docs).toHaveLength(1));
    expect(docs[0]).toBe("def leap_year(year):\n    return True\n");
  });
});
