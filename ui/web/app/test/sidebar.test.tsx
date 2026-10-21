/**
 * sidebar.test.tsx
 * The VPSidebar-style sidebar and drawer (plan 261020-2246, phase 04): groups
 * fold and open around the current page, aria-expanded tells the truth, and
 * the drawer below 960 traps focus and gives it back to Menu.
 */
import { useRef, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { Sidebar } from "~/components/layout/sidebar";
import { LocalNav } from "~/components/layout/local-nav";

beforeAll(() => {
  initI18n("en");
});
afterEach(cleanup);

function show(path: string) {
  const router = createMemoryRouter([{ path: "*", element: <Sidebar /> }], { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

const group = (name: string) => screen.getByRole("button", { name });

describe("the sidebar", () => {
  it("opens the group and item that hold the current page, and folds the rest", () => {
    show("/quiz/bank");
    // Practise has no `collapsed`: a plain heading, always open, no caret.
    expect(screen.queryByRole("button", { name: "Part III: Practise" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Part III: Practise" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle Quiz" })).toHaveAttribute("aria-expanded", "true");
    const bank = screen.getByRole("link", { name: /Question bank/ });
    expect(bank).toHaveAttribute("aria-current", "page");
    expect(bank.textContent).toContain("Current section");
    // The parent of the current page is marked has-active (ink), not current.
    expect(screen.getByRole("link", { name: "Quiz" })).not.toHaveAttribute("aria-current");
    // Settings is one row to its page (owner, 2026-10-21); its sections are
    // the page's own tabs, so none of them is listed here.
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link", { name: "Account" })).toBeNull();
    expect(screen.getByRole("button", { name: "Toggle Mastery" })).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles a group by click and by Space", async () => {
    show("/home");
    const appendix = group("Appendix");
    fireEvent.click(appendix);
    expect(appendix).toHaveAttribute("aria-expanded", "true");
    const items = document.getElementById(appendix.getAttribute("aria-controls")!)!;
    expect(within(items).getAllByRole("link")).toHaveLength(2);
    appendix.focus();
    await userEvent.keyboard(" ");
    expect(appendix).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{Enter}");
    expect(appendix).toHaveAttribute("aria-expanded", "true");
  });

  it("lights the Settings row on every Settings tab", () => {
    show("/settings/account");
    const settings = screen.getByRole("link", { name: /Settings/ });
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(settings.textContent).toContain("Current section");
  });

  it("lights Knowledge for a document; top-level rows carry a decorative icon, child rows none", () => {
    show("/documents/abc");
    const knowledge = screen.getByRole("link", { name: /Knowledge/ });
    expect(knowledge).toHaveAttribute("aria-current", "page");
    // Owner, 2026-10-21: icons so a row is found by shape (up's sidebar has none).
    expect(knowledge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("link", { name: "Quiz" }).querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Question bank/, hidden: true }).querySelector("svg")).toBeNull();
  });

  it("is a labelled navigation inside an aside", () => {
    show("/home");
    expect(screen.getByRole("navigation", { name: "Sidebar navigation" }).closest("aside")).not.toBeNull();
  });
});

function Shell() {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  return (
    <>
      <LocalNav drawerOpen={open} onMenu={() => setOpen((o) => !o)} menuRef={menu} />
      <Sidebar open={open} onClose={() => setOpen(false)} returnTo={menu} />
      <main>
        <a href="#x">page link</a>
      </main>
    </>
  );
}

describe("the drawer", () => {
  it("opens from Menu, makes the page inert, closes on Escape and returns focus", async () => {
    // jsdom has no matchMedia, which the drawer reads as a narrow screen.
    const router = createMemoryRouter([{ path: "*", element: <Shell /> }], { initialEntries: ["/home"] });
    const { container } = render(<RouterProvider router={router} />);
    const aside = container.querySelector("#lp-sidebar")!;
    expect(aside).toHaveAttribute("inert");
    const menu = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(aside).not.toHaveAttribute("inert");
    expect(container.querySelector("main")).toHaveAttribute("inert");
    expect(aside.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(aside).toHaveAttribute("inert");
    expect(container.querySelector("main")).not.toHaveAttribute("inert");
    await Promise.resolve();
    expect(document.activeElement).toBe(menu);
  });
});
