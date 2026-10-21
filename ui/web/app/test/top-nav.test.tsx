/**
 * top-nav.test.tsx
 * The VPNavBar-style top nav (plan 261020-2246, phase 03): the four links,
 * the search button's event, the flyouts' aria-expanded, and the phone's nav
 * screen opening from the hamburger and closing on Escape with focus back.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { OPEN_SEARCH_EVENT, TopNav } from "~/components/layout/top-nav";
import { Switch } from "~/components/doc/switch";

beforeAll(() => {
  initI18n("en");
});
afterEach(cleanup);

function show(path = "/home") {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <>
            <TopNav displayName="Local owner" email="owner@anytools.local" />
            <main>
              <p>page</p>
            </main>
          </>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

describe("the top nav", () => {
  it("has the four main links, the current one marked by section", () => {
    show("/documents/abc");
    const nav = screen.getAllByRole("navigation", { name: "Main navigation" })[0]!;
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Home", "Knowledge", "Chat", "Loop"]);
    expect(within(nav).getByRole("link", { name: "Knowledge" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Chat" })).not.toHaveAttribute("aria-current");
  });

  it("raises the open-search event from its search button", () => {
    show();
    const listener = vi.fn();
    window.addEventListener(OPEN_SEARCH_EVENT, listener);
    fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_SEARCH_EVENT, listener);
  });

  it("opens the language flyout with aria-expanded and closes it on Escape", () => {
    show();
    const button = screen.getAllByRole("button", { name: "Change language" })[0]!;
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button", { name: "Tiếng Việt" }).length).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(button);
  });

  it("opens the nav screen from the hamburger; Escape closes it and focus returns", async () => {
    const { container } = show();
    const hamburger = screen.getByRole("button", { name: "Mobile navigation" });
    expect(hamburger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(hamburger);
    expect(hamburger).toHaveAttribute("aria-expanded", "true");
    const screenEl = container.querySelector("#lp-nav-screen")!;
    expect(screenEl).not.toBeNull();
    // The page behind is inert; the nav is not.
    expect(container.querySelector("main")).toHaveAttribute("inert");
    expect(hamburger.closest("[inert]")).toBeNull();
    expect(document.activeElement?.textContent).toBe("Home");
    expect(within(screenEl as HTMLElement).getByRole("switch")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector("#lp-nav-screen")).toBeNull();
    expect(container.querySelector("main")).not.toHaveAttribute("inert");
    await Promise.resolve();
    expect(document.activeElement).toBe(hamburger);
  });
});

describe("the switch", () => {
  it("is a role=switch that flips aria-checked", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} aria-label="Dark theme" />);
    const sw = screen.getByRole("switch", { name: "Dark theme" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("takes its name from a visible label", () => {
    render(<Switch checked onCheckedChange={() => {}} label="Appearance" />);
    expect(screen.getByRole("switch", { name: "Appearance" })).toHaveAttribute("aria-checked", "true");
  });
});
