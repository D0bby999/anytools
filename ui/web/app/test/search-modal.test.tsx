/**
 * search-modal.test.tsx
 * The ⌘K search (plan 261020-2246, phase 06), after up's own search tests:
 * pages by their tree path, the learner's titles with accents folded, the
 * empty state as a status, and focus going back to whatever opened it.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, redirect, RouterProvider, useLocation } from "react-router";
import { initI18n } from "~/lib/i18n";
import { fold, SearchModal } from "~/components/layout/search-modal";
import { openSearch } from "~/components/layout/top-nav";
import type { SearchIndexItem } from "~/lib/nav-tree";

beforeAll(() => {
  initI18n("en");
});
afterEach(cleanup);

const own: SearchIndexItem[] = [{ title: "Tiếng Việt", to: "/knowledge/kb-vi", section: "nav.knowledge" }];

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function show() {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <>
            <button type="button" onClick={openSearch}>
              Search
            </button>
            <Where />
            <SearchModal loadIndex={async () => own} />
          </>
        ),
      },
    ],
    { initialEntries: ["/home"] },
  );
  return render(<RouterProvider router={router} />);
}

async function openFromButton() {
  const button = screen.getByRole("button", { name: "Search" });
  button.focus();
  fireEvent.click(button);
  return { button, input: await screen.findByRole("combobox", { name: "Search" }) };
}

describe("the search modal", () => {
  it("folds accents one character for one", () => {
    expect(fold("Tiếng Việt Đọc")).toBe("tieng viet doc");
  });

  it("finds a page by its tree path and opens it on Enter", async () => {
    show();
    const { input } = await openFromButton();
    expect(screen.getByRole("dialog", { name: "Search" })).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(input);
    await userEvent.type(input, "bank");
    const option = screen.getByRole("option", { selected: true });
    expect(option.textContent).toContain("Practise");
    expect(option.textContent).toMatch(/Quiz.*Question bank/);
    expect(input).toHaveAttribute("aria-activedescendant", option.id);
    await userEvent.keyboard("{Enter}");
    expect(screen.getByTestId("where").textContent).toBe("/quiz/bank");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts a new conversation from anywhere", async () => {
    let posted = false;
    const router = createMemoryRouter(
      [
        {
          path: "*",
          element: (
            <>
              <button type="button" onClick={openSearch}>
                Search
              </button>
              <Where />
              <SearchModal loadIndex={async () => own} />
            </>
          ),
        },
        {
          path: "/chat",
          action: () => {
            posted = true;
            return redirect("/chat/new-one");
          },
        },
      ],
      { initialEntries: ["/home"] },
    );
    render(<RouterProvider router={router} />);
    const { input } = await openFromButton();
    await userEvent.type(input, "new conv");
    expect(screen.getByRole("option", { selected: true }).textContent).toMatch(/Chat.*New conversation/);
    await userEvent.keyboard("{Enter}");
    await screen.findByText("/chat/new-one");
    expect(posted).toBe(true);
  });

  it("matches the learner's own titles without their accents", async () => {
    show();
    const { input } = await openFromButton();
    await userEvent.type(input, "tieng");
    const option = await screen.findByRole("option", { name: /Tiếng Việt/ });
    expect(option.querySelector("mark")?.textContent).toBe("Tiếng");
  });

  it("moves through results with the arrow keys", async () => {
    show();
    const { input } = await openFromButton();
    await userEvent.type(input, "mastery");
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    await userEvent.keyboard("{ArrowDown}");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(options[options.length - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("says when nothing matches, as a status", async () => {
    show();
    const { input } = await openFromButton();
    await userEvent.type(input, "qqzzxx");
    expect(screen.getByRole("status").textContent).toBe("No results for “qqzzxx”");
  });

  it("closes on Escape with focus back on the search button, and keeps the query", async () => {
    show();
    const { button, input } = await openFromButton();
    await userEvent.type(input, "loop");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await Promise.resolve();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect((await screen.findByRole("combobox")).getAttribute("value")).toBe("loop");
  });

  it("opens with Ctrl K and with / outside a field, and returns focus to where it was", async () => {
    show();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("the search index route", () => {
  it("asks who is signed in and reads only that learner's lists", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/routes/app.api.search-index.ts", "utf8");
    expect(src).toMatch(/await requireUser\(request\)/);
    expect(src).not.toMatch(/export async function action/);
    // Every source is called with the user's id, never a value from the request.
    for (const call of src.match(/\b(listKBs|listNotebooks|listBooks|listSessions|listStates)\([^)]*\)/g) ?? []) {
      expect(call).toMatch(/\(id\)$/);
    }
    expect(readFileSync("app/routes.ts", "utf8")).toContain('"app/api/search-index"');
  });
});
