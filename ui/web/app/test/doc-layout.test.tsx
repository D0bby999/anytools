/**
 * doc-layout.test.tsx
 * The VPDoc pieces of the shell (plan 261020-2246, phase 05): the pager in
 * NAV_TREE order, the outline read from the page's headings with stable ids,
 * and the dropdown's Return to top.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { DocPager, usePager } from "~/components/layout/doc-pager";
import { Outline, slugify, useOutline } from "~/components/layout/outline";
import { OutlineDropdown } from "~/components/layout/outline-dropdown";

beforeAll(() => {
  initI18n("en");
});
afterEach(cleanup);

function PagerAt() {
  return <DocPager pager={usePager()} />;
}

function at(path: string, element: React.ReactElement, handle?: unknown) {
  const router = createMemoryRouter([{ path: "*", element, handle }], { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe("the pager", () => {
  it("pages /quiz/bank between Quiz and Practice", () => {
    at("/quiz/bank", <PagerAt />);
    const pager = screen.getByRole("navigation", { name: "Pager" });
    const [prev, next] = within(pager).getAllByRole("link");
    expect(prev).toHaveAttribute("href", "/quiz");
    expect(prev!.textContent).toBe("Previous pageQuiz");
    expect(next).toHaveAttribute("href", "/quiz/practice");
    expect(next!.textContent).toBe("Next pagePractice");
  });

  it("draws nothing on a detail page, or when the route says false", () => {
    at("/chat/s-1", <PagerAt />);
    expect(screen.queryByRole("navigation", { name: "Pager" })).toBeNull();
    cleanup();
    at("/quiz/bank", <PagerAt />, { pager: false });
    expect(screen.queryByRole("navigation", { name: "Pager" })).toBeNull();
  });

  it("takes a route's own pager", () => {
    at("/books/b/chapters/2", <PagerAt />, { pager: () => ({ prev: { to: "/books/b/chapters/1", label: "One" } }) });
    expect(screen.getByRole("link", { name: /One/ })).toHaveAttribute("href", "/books/b/chapters/1");
  });
});

function Page() {
  const entries = useOutline();
  return (
    <>
      <main id="lp-main">
        <h1>Title</h1>
        <h2>Tiếng Việt cơ bản</h2>
        <h3>Đọc hiểu</h3>
        <h2 id="kept">Own id</h2>
        <h2 data-outline-ignore>Skipped</h2>
        <aside>
          <h2>Panel heading</h2>
        </aside>
      </main>
      <Outline entries={entries} />
      <div className="relative">
        <OutlineDropdown entries={entries} />
      </div>
    </>
  );
}

describe("the outline", () => {
  it("slugs accents away, Vietnamese included", () => {
    expect(slugify("Tiếng Việt cơ bản")).toBe("tieng-viet-co-ban");
    expect(slugify("Đọc hiểu")).toBe("doc-hieu");
    expect(slugify("!!!")).toBe("section");
  });

  it("lists the page's h2 and h3, giving ids, skipping ignored and panel headings", async () => {
    at("/knowledge", <Page />);
    const nav = await screen.findByRole("navigation", { name: "On this page" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#tieng-viet-co-ban", "#doc-hieu", "#kept"]);
    expect(screen.getByRole("heading", { name: "Tiếng Việt cơ bản" })).toHaveAttribute("id", "tieng-viet-co-ban");
    // The h3 sits indented under its h2.
    expect(links[1]!.closest("li")).toHaveClass("pl-3");
  });

  it("opens the dropdown with Return to top, and closes it on Escape", async () => {
    at("/knowledge", <Page />);
    const button = await screen.findByRole("button", { name: "On this page" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Return to top" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(button).toHaveAttribute("aria-expanded", "false"));
    expect(document.activeElement).toBe(button);
  });
});

describe("the article measure beside the aside", () => {
  it("narrows to 688 for an outline or an owned panel, and keeps 780 for the reader", async () => {
    const { narrowsBesideAside } = await import("~/routes/app-layout");
    expect(narrowsBesideAside([undefined], false)).toBe(false);
    expect(narrowsBesideAside([undefined], true)).toBe(true);
    expect(narrowsBesideAside([{ ownsPanel: true }], false)).toBe(true);
    expect(narrowsBesideAside([{ ownsPanel: true, measure: "read" }], true)).toBe(false);
  });
});
