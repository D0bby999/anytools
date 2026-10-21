/**
 * Code, diff and terminal blocks in RichText (postclaw parity, phase 3):
 * shiki loads only for a fence, a streamed fence turns into a block once it
 * is closed, and diff and terminal output render from parsed data.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RichText } from "~/components/rich-text";
import { initI18n } from "~/lib/i18n";

const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock("~/lib/highlight", async (importOriginal) => {
  loads.count++;
  return importOriginal();
});

beforeAll(async () => {
  await initI18n("en");
});

function renderRich(text: string, streaming = false) {
  const ui = <RichText text={text} sources={[]} streaming={streaming} listen={false} />;
  const router = createMemoryRouter([{ path: "/", element: ui }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />).container;
}

describe("code blocks", () => {
  // First in the file: the module registry is per file, so a count of zero
  // here means prose (and an inline code span) never imported the highlighter.
  it("does not load the highlighter for prose", async () => {
    const root = renderRich("Just **words**, a list:\n\n- one\n- `two`\n\nand $x^2$.");
    await new Promise((r) => setTimeout(r, 50));
    expect(loads.count).toBe(0);
    expect(root.querySelector(".lp-code")).toBeNull();
  });

  it("frames a fence with its language and a Copy, then colours it", async () => {
    const root = renderRich("```python\ndef f():\n    return 1\n```");
    const frame = root.querySelector('.lp-code[data-block="code"]')!;
    expect(frame.querySelector("figcaption")?.textContent).toContain("python");
    expect(frame.querySelector("figcaption button")?.textContent).toBe("Copy");
    expect(frame.querySelector("pre")?.textContent).toBe("def f():\n    return 1");
    await waitFor(() => expect(frame.querySelector("code[data-highlighted]")).not.toBeNull());
    expect(loads.count).toBe(1);
    const def = [...frame.querySelectorAll("code span")].find((s) => s.textContent === "def") as HTMLElement;
    expect(def.style.color).toBe("var(--lp-code-token-keyword)");
    expect(frame.querySelector("pre")?.textContent).toBe("def f():\n    return 1");
  });

  it("names a fence without a language Code and leaves it plain", () => {
    const root = renderRich("```\nplain words\n```");
    expect(root.querySelector(".lp-code figcaption")?.textContent).toContain("Code");
    expect(root.querySelector(".lp-code code[data-highlighted]")).toBeNull();
  });

  it("while streaming, keeps an open fence plain and frames it once closed", () => {
    const open = renderRich("Here:\n\n```js\nconst a = 1;", true);
    expect(open.querySelector(".lp-code")).toBeNull();
    expect(open.querySelector("pre")?.textContent).toContain("const a = 1;");

    const closed = renderRich("Here:\n\n```js\nconst a = 1;\n```\n\nAnd th", true);
    expect(closed.querySelector('.lp-code[data-block="code"] pre')?.textContent).toBe("const a = 1;");
  });

  it("draws a diagram fence only when the answer is complete", () => {
    const live = renderRich("```mermaid\ngraph TD; A-->B\n```\n\nmore", true);
    expect(live.querySelector(".lp-code")).toBeNull();
    expect(live.querySelector("pre")).not.toBeNull();
  });
});

describe("diff blocks", () => {
  it("shows signs and counts, and copies the diff as written", () => {
    const text = "@@ -1 +1 @@\n-old line\n+new line\n same";
    const root = renderRich("```diff\n" + text + "\n```");
    const frame = root.querySelector('.lp-code[data-block="diff"]')!;
    const rows = [...frame.querySelectorAll(".lp-diff-row")].map((r) => [
      r.getAttribute("data-diff"),
      r.querySelector(".lp-diff-sign")?.textContent,
    ]);
    expect(rows).toEqual([
      ["hunk", ""],
      ["remove", "−"],
      ["add", "+"],
      ["context", ""],
    ]);
    expect(frame.querySelector("figcaption")?.textContent).toContain("1 lines added, 1 removed");
  });
});

describe("terminal blocks", () => {
  it("renders colour codes as theme inks, never as markup", () => {
    const root = renderRich("```ansi\n\u001b[31m<b>FAIL</b>\u001b[0m 2 tests\n```");
    const frame = root.querySelector('.lp-code[data-block="terminal"]')!;
    expect(frame.querySelector("figcaption")?.textContent).toContain("Terminal output");
    const red = [...frame.querySelectorAll("code span span")].find((s) => s.textContent === "<b>FAIL</b>") as HTMLElement;
    expect(red.style.color).toBe("var(--lp-code-ansi-red)");
    expect(frame.querySelector("b")).toBeNull();
    expect(frame.querySelector("pre")?.textContent).toBe("<b>FAIL</b> 2 tests");
  });

  it("reads a fence holding colour codes as terminal output whatever its tag", () => {
    const root = renderRich("```\n\u001b[32mok\u001b[0m\n```");
    expect(root.querySelector('.lp-code[data-block="terminal"]')).not.toBeNull();
  });
});
